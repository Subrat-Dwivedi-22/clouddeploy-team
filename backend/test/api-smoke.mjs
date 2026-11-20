import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("registration, login, ownership isolation and project lifecycle", { timeout: 20000 }, async (t) => {
  const port = 4513;
  const server = spawn(process.execPath, ["backend/dist/index.js"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", COOKIE_SECURE: "false", KUBE_MODE: "off" },
    stdio: "inherit",
  });
  t.after(() => server.kill());
  const send = (path, body, cookie) => fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json", "X-CloudDeploy": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await send("health").catch(() => null))?.ok) { healthy = true; break; }
    await delay(200);
  }
  assert.ok(healthy, "API started and reached PostgreSQL");

  async function register() {
    const credentials = { email: `test-${randomUUID()}@example.com`, password: "test-password" };
    const response = await send("auth/register", credentials);
    assert.equal(response.status, 201);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
    return { credentials, cookie: response.headers.get("set-cookie").split(";")[0] };
  }

  assert.equal((await send("projects")).status, 401);
  const owner = await register();
  const other = await register();
  const login = await send("auth/login", owner.credentials);
  assert.equal(login.status, 200);
  assert.equal((await send("auth/login", { ...owner.credentials, password: "wrong-password" })).status, 401);
  const config = { name: "Test workload", image: process.env.ALLOWED_IMAGES.split(",")[0], port: 8080, replicas: 1 };
  const repo = { ...config, repository: "https://github.com/student/course-app.git", image: "" };
  assert.equal((await send("projects", { ...repo, repository: "https://elsewhere.test/user/repo" }, owner.cookie)).status, 400);
  const imported = await send("projects", repo, owner.cookie);
  assert.equal(imported.status, 201);
  const source = await imported.json();
  assert.equal(source.repository, "https://github.com/student/course-app");
  assert.equal((await send(`projects/${source.id}/actions`, { action: "deleteProject" }, owner.cookie)).status, 204);
  const created = await send("projects", config, owner.cookie);
  assert.equal(created.status, 201);
  const project = await created.json();
  assert.equal(project.healthPath, null);
  assert.equal(project.resourceProfile, "standard");
  const path = `projects/${project.id}`;
  assert.equal((await send(path, undefined, other.cookie)).status, 404);
  assert.equal((await send(`${path}/actions`, { action: "deleteProject" }, other.cookie)).status, 404);
  assert.equal((await (await send("projects", undefined, owner.cookie)).json()).length, 1);
  assert.equal((await send(`${path}/actions`, { action: "configure", config: { ...config, healthPath: "https://example.com" } }, owner.cookie)).status, 400);
  assert.equal((await send(`${path}/actions`, { action: "configure", config: { ...config, replicas: 2, healthPath: "/health", resourceProfile: "compact" } }, owner.cookie)).status, 204);
  const configured = await (await send(path, undefined, owner.cookie)).json();
  assert.equal(configured.replicas, 2);
  assert.equal(configured.healthPath, "/health");
  assert.equal(configured.resourceProfile, "compact");
  const status = await (await send(`${path}/status`, undefined, owner.cookie)).json();
  assert.equal(status.state, "Kubernetes disabled");
  assert.equal(status.appUrl, null);
  assert.equal((await send(`${path}/actions`, { action: "deleteProject" }, owner.cookie)).status, 204);
  assert.equal((await send(path, undefined, owner.cookie)).status, 404);
});
