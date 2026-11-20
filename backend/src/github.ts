import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ClusterError, type Kubernetes } from "./kube.js";

const slug = /^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i;
export const repositoryUrl = z.string().trim().max(240).transform((value) =>
  value.replace(/\/$/, "").replace(/\.git$/i, "")
).refine((value) => value.startsWith("https://github.com/") &&
  slug.test(value.slice(19)) && ![".", ".."].includes(value.split("/").pop()!), "Use a public https://github.com/owner/repository URL.");

const builder = (process.env.GITHUB_BUILD_REPOSITORY ?? "").toLowerCase();
const token = process.env.GITHUB_BUILD_TOKEN;
export const builderReady = () => slug.test(builder) && Boolean(token);

async function github(path: string, authenticated: boolean, body?: unknown) {
  try {
    const response = await fetch("https://api.github.com/repos/" + path, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(4500),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10",
        ...(authenticated ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404 && path.includes("/contents/")) throw new ClusterError(422, "File missing from the selected repository: " + path.split("/contents/")[1].split("?")[0]);
    if (!response.ok) throw new ClusterError(502, `GitHub returned HTTP ${response.status}. Check the public repository, workflow and builder permissions.`);
    return await response.json();
  } catch (error) {
    if (error instanceof ClusterError) throw error;
    throw new ClusterError(502, "GitHub could not be reached.");
  }
}

type BuildChoice = { buildMode: string; buildFolder: string; entryFile: string; npmBuild: boolean; port: number };
export async function queueBuild(url: string, revision: string, choice?: BuildChoice) {
  if (!builderReady()) throw new ClusterError(503, "The GitHub builder needs operator setup.");
  const source = repositoryUrl.parse(url).slice(19);
  const { sha } = await github(source + "/commits/HEAD", false);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new ClusterError(422, "Could not resolve the default branch.");
  const inputs: Record<string,string> = { source, sha, revision };
  if (choice && choice.buildMode !== "auto") {
    const {buildMode, buildFolder, entryFile, npmBuild} = choice;
    const file = buildMode === "node" ? "package.json" : entryFile;
    if (buildMode !== "docker" && choice.port !== 8080) throw new ClusterError(422, "Simple websites and Node.js apps use port 8080.");
    if (buildMode === "static" && !/^[\w-][\w.-]*\.html$/i.test(file)) throw new ClusterError(422, "Enter an HTML filename within the website folder.");
    const path = buildFolder === "." ? file : buildFolder + "/" + file;
    const info = await github(source + "/contents/" + path + "?ref=" + sha, false);
    if (info.type !== "file") throw new ClusterError(422, "Select a regular file: " + path);
    if (buildMode === "node") {
      let pkg;
      try { pkg = JSON.parse(Buffer.from(info.content, "base64").toString("utf8")); }
      catch { throw new ClusterError(422, "Could not read package.json as JSON."); }
      if (!pkg?.scripts?.start || typeof pkg.scripts.start !== "string") throw new ClusterError(422, "package.json needs an npm start script.");
      if (npmBuild && typeof pkg.scripts.build !== "string") throw new ClusterError(422, "Add a build script or turn off the npm build step.");
    }
    Object.assign(inputs, { mode: buildMode, folder: buildFolder, entry: file, npm_build: String(npmBuild) });
  }
  const run = await github(builder + "/actions/workflows/source-build.yml/dispatches", true, {
    ref: process.env.GITHUB_BUILD_REF || "main", inputs,
  });
  if (!Number.isSafeInteger(run.workflow_run_id)) throw new ClusterError(502, "GitHub did not return a build ID.");
  return { commitSha: sha, runId: String(run.workflow_run_id), image: `ghcr.io/${builder}-apps:${revision}`,
    detail: `Commit ${sha.slice(0, 12)} · https://github.com/${builder}/actions/runs/${run.workflow_run_id}` };
}

export function startBuildWorker(db: PrismaClient, kube: Kubernetes) {
  if (!builderReady() || !kube.enabled) return;
  async function reconcile() {
    try {
      const builds = await db.deployment.findMany({ where: { outcome: "Building" }, orderBy: { createdAt: "asc" } });
      for (const build of builds) {
        let failure = "";
        let buildSeconds: number | null = null;
        if (Date.now() - build.createdAt.getTime() > 45 * 60_000) failure = "Build timed out.";
        else {
          const run = await github(builder + "/actions/runs/" + build.runId, true).catch(() => null);
          if (!run || run.status !== "completed") continue;
          const elapsed = Date.parse(run.updated_at) - Date.parse(run.run_started_at);
          if (Number.isFinite(elapsed) && elapsed >= 0) buildSeconds = Math.round(elapsed / 1000);
          if (run.conclusion !== "success") failure = "GitHub build " + run.conclusion + ".";
        }
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${build.projectId} FOR UPDATE`;
          const current = await tx.deployment.findUnique({ where: { id: build.id } });
          if (current?.outcome !== "Building") return;
          if (!failure) {
            try {
              await kube.deploy({ ...build, id: build.projectId }, build.id);
              await tx.project.update({ where: { id: build.projectId }, data: { image: build.image } });
            } catch (error) {
              if (!(error instanceof ClusterError)) throw error;
              failure = error.message;
            }
          }
          await tx.deployment.update({ where: { id: build.id }, data: {
            buildSeconds, outcome: failure ? "Failed" : "Accepted", detail: (failure || "Rollout requested.") + " " + build.detail,
          } });
        }, { timeout: 12_000 });
      }
    } catch (error) { console.error("Build reconciliation failed", error); }
    finally { setTimeout(reconcile, 8000).unref(); }
  }
  void reconcile();
}
