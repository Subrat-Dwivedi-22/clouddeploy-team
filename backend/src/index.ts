import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./auth.js";
import { ClusterError, Kubernetes } from "./kube.js";

import { builderReady, repositoryUrl, queueBuild, startBuildWorker } from "./github.js";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error("Set JWT_SECRET to at least 32 characters.");
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
const jwtSecret = secret;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 }),
});
const kube = new Kubernetes();
const allowedImages = new Set((process.env.ALLOWED_IMAGES ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const app = express();
const sessionCookie = "clouddeploy_session";
const cookieOptions = { httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "strict", path: "/" } as const;

app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(req.method) && req.get("X-CloudDeploy") !== "1") {
    res.status(403).json({ error: "Request header required." });
    return;
  }
  next();
});
app.use(express.json({ limit: "16kb" }));
app.get("/api/health", async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

const credentials = z.object({ email: z.email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(8).max(128) });
const authLimit = rateLimit({ windowMs: 60_000, limit: 60, message: { error: "Too many attempts. Try again in a minute." } });
const dummyHash = await hashPassword(randomUUID());

function signIn(res: Response, account: { id: string; email: string }, status: number) {
  const token = jwt.sign({ sub: account.id, email: account.email }, jwtSecret, { algorithm: "HS256", issuer: "clouddeploy", expiresIn: "8h" });
  res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
  res.status(status).json({ email: account.email });
}

app.post("/api/auth/register", authLimit, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const account = await db.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  signIn(res, account, 201);
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const account = await db.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, account?.passwordHash ?? dummyHash);
  if (!account || !valid) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  signIn(res, account, 200);
});
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(sessionCookie, cookieOptions).sendStatus(204);
});

const authenticate: RequestHandler = (req, res, next) => {
  try {
    const token = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(sessionCookie + "="))?.slice(sessionCookie.length + 1);
    const user = jwt.verify(token ?? "", jwtSecret, { algorithms: ["HS256"], issuer: "clouddeploy" });
    if (typeof user === "string" || !user.sub || typeof user.email !== "string") throw new Error("Invalid session");
    res.locals.user = { id: user.sub, email: user.email };
    next();
  } catch {
    res.status(401).json({ error: "Sign in to continue." });
  }
};

app.use("/api", authenticate);
app.get("/api/session", (_req, res) => res.json({ email: res.locals.user.email, images: [...allowedImages], clusterEnabled: kube.enabled, builderEnabled: builderReady() }));

const replicas = z.int().min(0).max(3);
const config = z.object({
  buildMode: z.enum(["auto","static","docker","node"]).optional(),
  buildFolder: z.string().max(180).regex(/^(?:\.|[\w-][\w.-]*(?:\/[\w-][\w.-]*)*)$/, "Use a relative folder such as site or .").optional(),
  entryFile: z.string().max(180).regex(/^[\w-][\w.-]*(?:\/[\w-][\w.-]*)*$/, "Use a relative file path.").optional(),
  npmBuild: z.boolean().optional(),
  name: z.string().trim().min(1).max(60),
  repository: repositoryUrl.nullable().optional(),
  image: z.string().default(""),
  port: z.int().min(1024).max(65535),
  healthPath: z.string().trim().max(160).regex(/^\/(?!\/)[a-zA-Z0-9._~\/-]*$/, "Use an HTTP path such as /health.").nullable().optional(),
  resourceProfile: z.enum(["compact", "standard"]).optional(),
  replicas,
}).refine((value) => value.repository || allowedImages.has(value.image), "Select an approved image or enter a GitHub repository.");
const idSchema = z.uuid();
const fields = { id: true, name: true, buildMode: true, buildFolder: true, entryFile: true, npmBuild: true, repository: true, image: true, port: true, replicas: true, healthPath: true, resourceProfile: true, createdAt: true, updatedAt: true } as const;

app.get("/api/projects", async (_req, res) => {
  res.json(await db.project.findMany({ where: { ownerId: res.locals.user.id }, orderBy: { createdAt: "desc" }, select: fields }));
});
app.post("/api/projects", async (req, res) => {
  const data = config.parse(req.body);
  res.status(201).json(await db.project.create({ data: { ...data, image: data.repository ? "" : data.image, ownerId: res.locals.user.id }, select: fields }));
});
app.get("/api/projects/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const project = await db.project.findFirstOrThrow({
    where: { id, ownerId: res.locals.user.id },
    select: { ...fields, history: { orderBy: { createdAt: "desc" }, take: 30 } },
  });
  res.json(project);
});
app.get("/api/projects/:id/:view", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const view = z.enum(["status", "logs"]).parse(req.params.view);
  await db.project.findFirstOrThrow({ where: { id, ownerId: res.locals.user.id }, select: { id: true } });
  if (view === "logs") { res.json(await kube.logs(id)); return; }
  const status = await kube.status(id);
  const previewPort = Number(process.env.PREVIEW_PORT);
  const publicDomain = process.env.PUBLIC_APP_DOMAIN;
  const appUrl = status.state === "Running" && publicDomain ? `https://${id}.${publicDomain}/` : status.state === "Running" && Number.isInteger(previewPort) && previewPort > 0 && previewPort <= 65535
    ? `http://${id}.localhost:${previewPort}/` : null;
  const revision = status.state === "Running" && status.revision;
  const live = revision ? await db.deployment.findFirst({ where: { projectId: id, id: revision }, select: { commitSha: true } }) : null;
  let traffic = null;
  const metricsUrl = process.env.TRAFFIC_METRICS_URL || (process.env.PUBLIC_APP_DOMAIN ? "http://clouddeploy-preview:8081" : "");
  if (metricsUrl) {
    try {
      const response = await fetch(new URL("/" + id, metricsUrl), { signal: AbortSignal.timeout(1200), redirect: "error" });
      if (response.ok) traffic = await response.json();
    } catch { /* A metrics outage must not hide deployment status. */ }
  }
  res.json({ ...status, appUrl, liveCommit: live?.commitSha, traffic });
});

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), config }),
  z.object({ action: z.literal("deploy") }),
  z.object({ action: z.literal("redeploy") }),
  z.object({ action: z.literal("rollback"), releaseId: idSchema }),
  z.object({ action: z.literal("scale"), replicas }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("deleteProject") }),
]);

app.post("/api/projects/:id/actions", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = command.parse(req.body);
  const ownerId: string = res.locals.user.id;
  const result = await db.$transaction(async (tx) => {
    // Serialize configuration and cluster mutations across API processes.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const project = await tx.project.findFirstOrThrow({ where: { id, ownerId } });
    const active = await tx.deployment.findFirst({ where: { projectId: id, outcome: "Building" } });
    if (active && !["remove", "deleteProject"].includes(input.action)) {
      return new ClusterError(409, "A build is in progress. Wait for it to finish or remove the deployment.");
    }
    if (active) await tx.deployment.update({ where: { id: active.id }, data: { outcome: "Cancelled", detail: "Rollout cancelled by user." } });
    if (input.action === "configure") {
      await tx.project.update({ where: { id }, data: { ...input.config, repository: input.config.repository ?? null, image: input.config.repository ? project.image : input.config.image } });
      return null;
    }
    const desiredReplicas = input.action === "scale" ? input.replicas : project.replicas;
    const revision = randomUUID();
    const runtime = { healthPath: project.healthPath, resourceProfile: project.resourceProfile };
    let failure: ClusterError | undefined;
    try {
      switch (input.action) {
        case "rollback": {
          const source = await tx.deployment.findFirstOrThrow({ where: { projectId: id, id: input.releaseId, outcome: "Accepted", action: { in: ["deploy", "redeploy"] } } });
          if (!source.runId && !(allowedImages.has(source.image) && /@sha256:[0-9a-f]{64}$/.test(source.image))) {
            throw new ClusterError(422, "Restore requires a GitHub release or an approved digest-pinned image.");
          }
          await kube.deploy({ ...source, id }, revision);
          await tx.deployment.create({ data: { id: revision, projectId: id, action: "rollback", outcome: "Accepted",
            detail: "Restored release " + source.id, image: source.image, port: source.port, replicas: source.replicas,
            healthPath: source.healthPath, resourceProfile: source.resourceProfile, commitSha: source.commitSha } });
          return null;
        }
        case "deploy":
        case "redeploy":
          if (project.repository) {
            if (!kube.enabled) throw new ClusterError(503, "Connect Kubernetes before deploying.");
            if (process.env.PUBLIC_APP_DOMAIN) {
              const admitted = await tx.$executeRaw`INSERT INTO "BuildBudget" ("hour", "used") VALUES (date_trunc('hour', CURRENT_TIMESTAMP), 1)
                ON CONFLICT ("hour") DO UPDATE SET "used" = "BuildBudget"."used" + 1 WHERE "BuildBudget"."used" < 6`;
              if (!admitted) throw new ClusterError(409, "The demo has used its six GitHub builds for this hour. Try again next hour.");
            }
            const build = await queueBuild(project.repository, revision, project);
            await tx.deployment.create({ data: { id: revision, projectId: id, action: input.action, outcome: "Building", ...build, ...runtime, replicas: project.replicas, port: project.port } });
            return null;
          }
          if (!allowedImages.has(project.image)) throw new ClusterError(422, "The configured image is no longer approved.");
          await kube.deploy(project, revision);
          break;
        case "scale":
          await kube.scale(id, desiredReplicas);
          break;
        case "remove":
          if (!kube.enabled) throw new ClusterError(503, "Kubernetes is disabled for this instance.");
          await kube.remove(id);
          break;
        case "deleteProject":
          if (!kube.enabled && await tx.deployment.findFirst({ where: { projectId: id, action: { in: ["deploy", "redeploy"] } } })) {
            throw new ClusterError(503, "Enable Kubernetes before deleting a project with prior rollout activity.");
          }
          await kube.remove(id);
          break;
      }
    } catch (error) {
      if (!(error instanceof ClusterError)) throw error;
      failure = error;
    }
    if (!failure && input.action === "deleteProject") {
      await tx.project.delete({ where: { id } });
      return null;
    }
    if (!failure && input.action === "scale") await tx.project.update({ where: { id }, data: { replicas: desiredReplicas } });
    await tx.deployment.create({
      data: {
        id: revision, projectId: id, action: input.action, outcome: failure ? "Failed" : "Accepted",
        detail: failure?.message ?? "Kubernetes accepted the request.",
        image: project.image, port: project.port, replicas: desiredReplicas, ...runtime,
      },
    });
    return failure ?? null;
  }, { timeout: 15_000 });
  if (result) throw result;
  res.sendStatus(204);
});

app.use((_req, res) => res.status(404).json({ error: "Endpoint not found." }));
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request." });
  } else if (error instanceof ClusterError) {
    const status = [404, 409, 422, 503].includes(error.status) ? error.status : 502;
    res.status(status).json({ error: error.message });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ error: "Email already registered." });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    res.status(404).json({ error: "Project not found." });
  } else if ([400, 413].includes(error.status)) {
    res.status(error.status).json({ error: "Invalid request body." });
  } else {
    console.error(error);
    res.status(500).json({ error: "The server could not complete the request." });
  }
};
app.use(errors);
startBuildWorker(db, kube);
app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? "127.0.0.1");
