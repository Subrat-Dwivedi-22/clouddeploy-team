import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { deploymentManifest } from "../src/kube.js";

test("password hashes are salted and verification rejects a wrong password", async () => {
  const hash = await hashPassword("password-demo");
  assert.notEqual(hash, await hashPassword("password-demo"));
  assert.equal(await verifyPassword("password-demo", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("workloads carry project-specific selectors and restricted container settings", () => {
  const project = { id: "some-id", image: "example.test/demo:v1", port: 8080, replicas: 2 };
  const first = deploymentManifest(project, "a");
  const next = deploymentManifest(project, "b");
  const pod = first.spec.template.spec;
  assert.deepEqual(first.spec.selector.matchLabels, first.spec.template.metadata.labels);
  assert.notDeepEqual(first.spec.template.metadata.annotations, next.spec.template.metadata.annotations);
  assert.equal(first.spec.replicas, 2);
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.securityContext.runAsNonRoot, true);
  assert.equal(pod.containers[0].readinessProbe.tcpSocket?.port, 8080);
  const compact = deploymentManifest({ ...project, healthPath: "/ready", resourceProfile: "compact" }, "c").spec.template.spec.containers[0];
  assert.deepEqual(compact.readinessProbe.httpGet, { path: "/ready", port: 8080 });
  assert.deepEqual(compact.resources.limits, { cpu: "100m", memory: "64Mi" });
  assert.deepEqual(pod.containers[0].securityContext.capabilities.drop, ["ALL"]);
});
