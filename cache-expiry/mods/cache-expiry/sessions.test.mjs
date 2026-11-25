import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionRows, rowsSummary, idleText } from "./sessions.js";

const now = 10 * 60 * 60_000;
const opts = { ttlMinutes: 60, hot: "#ff0000", cold: "#0000ff" };
const agent = (address, app, status = "idle", extra = {}) =>
  ({ address, app, status, space_name: "S", tab_name: address, title: "", focused: false, ...extra });

test("idleText: minutes, hours and days", () => {
  assert.equal(idleText(12), "12m");
  assert.equal(idleText(120), "2h");
  assert.equal(idleText(125), "2h 5m");
  assert.equal(idleText(3 * 24 * 60 + 5), "3d");
});

test("sessionRows: Claude warmth from the last turn, Codex from its hit rate, hottest first", () => {
  const rows = sessionRows([
    agent("t1", "claude-code"), agent("t2", "codex"), agent("t3", "claude-code"),
    agent("t4", "shell"), agent("t5", "claude-code", "working"),
  ], {
    t1: { at: now - 30 * 60_000, tokens: 120_000 },
    t2: { codexHit: 90 },
    t3: { at: now - 90 * 60_000, tokens: 5_000 },
  }, now, opts);
  assert.deepEqual(rows.map((r) => r.address), ["t2", "t1", "t3", "t5"]);
  const [codex, warm, cold, none] = rows;
  assert.equal(codex.clear, "/new");
  assert.equal(warm.clear, "/clear");
  assert.equal(warm.temp, 0.5);
  assert.equal(warm.detail, "warm · cold in 30m · 120k tokens");
  assert.equal(cold.temp, 1);
  assert.equal(cold.color, "#0000ff");
  assert.equal(cold.detail, "cold · idle 1h 30m · 5k tokens");
  assert.equal(none.temp, null);
  assert.equal(none.color, null);
  assert.equal(none.clearable, false);
  assert.equal(warm.clearable, true);
});

test("rowsSummary counts warm, cold and unsampled", () => {
  assert.equal(rowsSummary([]), "No Claude or Codex sessions open");
  assert.equal(rowsSummary([{ temp: 0.2 }, { temp: 1 }, { temp: null }]), "1 warm · 1 cold · 1 unsampled");
  assert.equal(rowsSummary([{ temp: 0.2 }]), "1 warm · 0 cold");
});
