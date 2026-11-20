import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { Kubernetes } from "../dist/kube.js";

const kube = new Kubernetes();
assert.ok(kube.enabled, "Set KUBE_MODE=api and use the restricted test service account.");
const id = randomUUID();
const project = { id, image: "docker.io/nginxinc/nginx-unprivileged:stable-alpine", port: 8080, replicas: 1 };
async function expectState(state, ready) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await kube.status(id);
    if (status.state === state && status.ready === ready) return;
    await wait(2000);
  }
  throw new Error("Timed out waiting for " + state + " with " + ready + " available replicas.");
}
try {
  await kube.deploy(project, randomUUID());
  await expectState("Running", 1);
  assert.ok((await kube.logs(id)).pod);
  await kube.deploy(project, randomUUID());
  await expectState("Running", 1);
  await kube.scale(id, 2);
  await expectState("Running", 2);
  await kube.scale(id, 0);
  await expectState("Scaled to zero", 0);
} finally {
  await kube.remove(id);
}
await expectState("Not deployed", 0);
console.log("Cluster deployment, logs, redeployment, scaling and removal passed.");
