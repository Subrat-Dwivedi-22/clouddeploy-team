import assert from "node:assert/strict";
import { test } from "node:test";

test("dispatches only the pinned public source to the configured builder", async (t) => {
  process.env.GITHUB_BUILD_REPOSITORY = "team/platform";
  process.env.GITHUB_BUILD_TOKEN = "test-token";
  const { repositoryUrl, queueBuild } = await import("../src/github.js");
  for (const url of ["https://github.com.evil.test/a/b", "https://github.com/a/..", "https://github.com/a/b?ref=x", "http://github.com/a/b"]) {
    assert.equal(repositoryUrl.safeParse(url).success, false);
  }
  const sha = "a".repeat(40);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, options: RequestInit) => {
    const headers = new Headers(options.headers);
    if (++calls === 1) {
      assert.equal(input, "https://api.github.com/repos/student/web/commits/HEAD");
      assert.equal(headers.has("Authorization"), false);
      return Response.json({ sha });
    }
    assert.equal(input, "https://api.github.com/repos/team/platform/actions/workflows/source-build.yml/dispatches");
    assert.equal(headers.get("Authorization"), "Bearer test-token");
    assert.deepEqual(JSON.parse(String(options.body)).inputs, { source: "student/web", sha, revision: "release" });
    return Response.json({ workflow_run_id: 42 });
  });
  const result = await queueBuild("https://github.com/student/web.git", "release");
  assert.equal(result.image, "ghcr.io/team/platform-apps:release");
  assert.equal(result.runId, "42");
  assert.equal(result.commitSha, sha);
});

test("checks a Node app's selected package.json before dispatch", async (t) => {
  process.env.GITHUB_BUILD_REPOSITORY = "team/platform";
  process.env.GITHUB_BUILD_TOKEN = "test-token";
  const { queueBuild } = await import("../src/github.js");
  const sha = "b".repeat(40);
  let scripts: Record<string,string> = {};
  let dispatched = false;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/commits/HEAD")) return Response.json({sha});
    if (url.includes("/contents/")) {
      assert.ok(url.endsWith("/contents/apps/web/package.json?ref=" + sha));
      return Response.json({type:"file", content:Buffer.from(JSON.stringify({scripts})).toString("base64")});
    }
    const {inputs} = JSON.parse(String(options.body));
    assert.equal(inputs.mode, "node");
    assert.equal(inputs.folder, "apps/web");
    assert.equal(inputs.npm_build, "true");
    dispatched = true;
    return Response.json({workflow_run_id: 56});
  });
  const settings = {buildMode:"node", buildFolder:"apps/web", entryFile:"package.json", npmBuild:true, port:8080};
  const build = () => queueBuild("https://github.com/student/web", "release", settings);
  await assert.rejects(build, /start script/);
  scripts = {start:"node server.js"};
  await assert.rejects(build, /build script/);
  assert.equal(dispatched, false);
  scripts.build = "tsc";
  await build();
  assert.equal(dispatched, true);
});
