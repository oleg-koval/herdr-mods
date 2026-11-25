import { test } from "node:test";
import assert from "node:assert/strict";
import { rowDetail, cacheDot } from "./row.js";

test("rowDetail adds the context after the space, and skips what is missing", () => {
  assert.equal(rowDetail("vlag", "fix checkout rounding"), "vlag · fix checkout rounding");
  assert.equal(rowDetail("vlag", "  "), "vlag");
  assert.equal(rowDetail("vlag", undefined), "vlag");
  assert.equal(rowDetail(undefined, "note"), "note");
});

test("cacheDot shows only for idle and done agents with a published colour", () => {
  const warm = { color: "#c08a6a", cold: false, idleMin: 12 };
  assert.deepEqual(cacheDot(warm, "idle"), { color: "#c08a6a", tooltip: "Cache warm · idle 12 min" });
  assert.deepEqual(cacheDot({ ...warm, cold: true, idleMin: 67 }, "done").tooltip, "Cache expired · idle 67 min");
  assert.equal(cacheDot(warm, "working"), null);
  assert.equal(cacheDot(warm, "blocked"), null);
  assert.equal(cacheDot({ codexHit: 80 }, "idle"), null, "a Codex entry has no colour");
  assert.equal(cacheDot(undefined, "idle"), null);
});
