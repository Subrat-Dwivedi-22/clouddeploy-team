import assert from "node:assert/strict";
import test from "node:test";
import { recordTraffic, readTraffic } from "./traffic.mjs";

test("aggregates per project and expires readings outside the 15-minute window", (t) => {
  const start = Date.now();
  let elapsed = 0;
  t.mock.method(Date, "now", () => start + elapsed);
  recordTraffic("first", false, 12);
  recordTraffic("first", true, 28);
  recordTraffic("second", false, 7);
  const last = readTraffic("first").at(-1);
  assert.equal(last.requests, 2);
  assert.equal(last.errors, 1);
  assert.equal(last.meanMs, 20);
  assert.equal(readTraffic("second").at(-1).meanMs, 7);
  elapsed = 16 * 60_000;
  const old = readTraffic("first");
  assert.equal(old.length, 15);
  assert.ok(old.every(row => row.requests === 0 && row.meanMs === null));
});
