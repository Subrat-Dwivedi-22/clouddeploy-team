import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { randomInt } from "node:crypto";
import { readTraffic, recordTraffic } from "./traffic.mjs";

const mount = "/var/run/secrets/kubernetes.io/serviceaccount";
const projectHost = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.localhost(?::\d+)?$/i;

async function readyEndpoint(id) {
  const labels = `app.kubernetes.io/managed-by=clouddeploy,app.kubernetes.io/name=cd-${id}`;
  const [ca, token] = await Promise.all([readFile(mount + "/ca.crt"), readFile(mount + "/token", "utf8")]);
  const pods = await new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: "kubernetes.default.svc", ca, headers: { Authorization: "Bearer " + token.trim() },
      path: "/api/v1/namespaces/clouddeploy-workloads/pods?" + new URLSearchParams({ labelSelector: labels }),
      signal: AbortSignal.timeout(3500),
    }, async (res) => {
      try {
        if (res.statusCode !== 200) throw new Error("Pod lookup failed");
        let data = "";
        for await (const chunk of res) {
          data += chunk;
          if (data.length > 1_000_000) throw new Error("Pod list too large");
        }
        resolve(JSON.parse(data).items);
      } catch (error) { reject(error); }
    });
    req.on("error", reject).end();
  });
  const candidates = pods.filter((pod) => !pod.metadata.deletionTimestamp && !pod.spec.hostNetwork &&
    isIPv4(pod.status?.podIP ?? "") && pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True"));
  if (!candidates.length) return null;
  const pod = candidates[randomInt(candidates.length)];
  const port = pod.spec.containers.find((c) => c.name === "app")?.ports?.[0]?.containerPort;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { hostname: pod.status.podIP, port };
}

const server = createServer(async (req, res) => {
  const fail = (code, message) => {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(message);
  };
  if (req.headers.host === "127.0.0.1:3102" && req.url?.startsWith("/certificate?")) {
    const domain = new URL(req.url, "http://localhost").searchParams.get("domain") ?? "";
    const suffix = "." + process.env.PUBLIC_APP_DOMAIN;
    const label = domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : "";
    const project = projectHost.exec(label + ".localhost")?.[1];
    try {
      if (project && await readyEndpoint(project)) return res.writeHead(200).end();
    } catch { return fail(503, "Cluster unavailable"); }
    return fail(404, "Unknown project");
  }
  const id = projectHost.exec(req.headers.host ?? "")?.[1]?.toLowerCase();
  if (!id) return fail(404, "Open the app URL from your CloudDeploy project.");
  const began = performance.now();
  res.once("close", () => recordTraffic(id, !res.writableFinished || res.statusCode >= 400, performance.now() - began));
  if (req.headers["service-worker"]) return fail(403, "Service workers are disabled for demo previews.");
  if (!["GET", "HEAD"].includes(req.method)) return fail(405, "This demo link supports GET and HEAD requests.");
  if (!req.url?.startsWith("/") || req.url.startsWith("//")) return fail(400, "Invalid request path.");
  try {
    const endpoint = await readyEndpoint(id);
    if (!endpoint) return fail(503, "No ready replica. Check this project's status in CloudDeploy.");
    const upstream = httpRequest({ ...endpoint, method: req.method, path: req.url,
      headers: { accept: req.headers.accept ?? "*/*" }, signal: AbortSignal.timeout(15000) }, (reply) => {
      const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
      for (const name of ["content-type", "content-encoding", "content-language"]) {
        if (reply.headers[name]) headers[name] = reply.headers[name];
      }
      const location = reply.headers.location;
      if (location && URL.canParse(location, "http://" + req.headers.host + req.url)) {
        const target = new URL(location, "http://" + req.headers.host + req.url);
        if (target.origin === "http://" + req.headers.host) headers.location = target.pathname + target.search + target.hash;
      }
      res.writeHead(reply.statusCode ?? 502, headers);
      reply.on("error", () => res.destroy());
      reply.pipe(res);
    });
    res.on("close", () => upstream.destroy());
    upstream.on("error", () => fail(502, "The app did not answer the HTTP request. Check its logs and container port."));
    upstream.end();
  } catch { fail(503, "The preview service could not find a ready app. Try again shortly."); }
});
server.maxConnections = 64;
server.listen(8080, "0.0.0.0");
createServer((req, res) => {
  const id = req.url?.slice(1) ?? "";
  if (req.method !== "GET" || !projectHost.test(id + ".localhost")) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(readTraffic(id)));
}).listen(8081, "0.0.0.0");
