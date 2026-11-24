import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig, DEFAULTS, lastUsage, heatOf, coldness, mixHex } from "../cache-expiry/cold.js";

const MIN = 60_000;
const TTL = 55 * MIN;

test("mixHex runs hot to cold, and midpoints blend", () => {
  assert.equal(mixHex("#ff6b35", "#4a9eff", 0), "#ff6b35");
  assert.equal(mixHex("#ff6b35", "#4a9eff", 1), "#4a9eff");
  assert.equal(mixHex("#000", "#fff", 0.5), "#808080");
  assert.equal(mixHex("#000000", "#ffffff", 2), "#ffffff", "clamped above 1");
  assert.throws(() => mixHex("red", "#fff", 0.5));
});

test("heatOf is 0 fresh, linear, 1 once expired, null without usage", () => {
  const now = 1_000_000_000;
  assert.equal(heatOf({ at: now, tokens: 1 }, now, TTL), 0);
  assert.equal(heatOf({ at: now - TTL / 2, tokens: 1 }, now, TTL), 0.5);
  assert.equal(heatOf({ at: now - 2 * TTL, tokens: 1 }, now, TTL), 1);
  assert.equal(heatOf(null, now, TTL), null);
});

test("coldness warns only past the TTL and above the token floor", () => {
  const now = 1_000_000_000;
  const opts = { ttlMs: TTL, minTokens: 80_000 };
  assert.equal(coldness({ at: now - 67 * MIN, tokens: 291_000 }, now, opts).idleMin, 67);
  assert.equal(coldness({ at: now - 10 * MIN, tokens: 291_000 }, now, opts), null, "still warm");
  assert.equal(coldness({ at: now - 67 * MIN, tokens: 5_000 }, now, opts), null, "too small");
});

test("readConfig: missing file gives defaults, bad values fall back one by one", () => {
  assert.deepEqual(readConfig(null), { config: DEFAULTS, problem: null });
  const { config, problem } = readConfig(JSON.stringify({
    ttlMinutes: -3,
    toast: "yes",
    circle: { enabled: false, hot: "orange", cold: "#123" },
  }));
  assert.equal(problem, null);
  assert.equal(config.ttlMinutes, DEFAULTS.ttlMinutes);
  assert.equal(config.toast, DEFAULTS.toast);
  assert.equal(config.circle.enabled, false);
  assert.equal(config.circle.hot, DEFAULTS.circle.hot);
  assert.equal(config.circle.cold, "#123");
});

test("readConfig: invalid JSON reports a problem and uses defaults", () => {
  const { config, problem } = readConfig("{ nope");
  assert.match(problem, /not valid JSON/);
  assert.equal(config, DEFAULTS);
});

test("lastUsage takes the newest assistant usage with its timestamp", () => {
  const tail = [
    JSON.stringify({ timestamp: "2026-11-24T10:00:00Z", message: { role: "assistant", usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } } }),
    JSON.stringify({ timestamp: "2026-11-24T10:05:00Z", message: { role: "user", usage: { input_tokens: 99 } } }),
    "not json \"usage\"",
    JSON.stringify({ timestamp: "2026-11-24T10:30:00Z", message: { role: "assistant", usage: { input_tokens: 10, cache_read_input_tokens: 20 } } }),
  ].join("\n");
  assert.deepEqual(lastUsage(tail), { at: Date.parse("2026-11-24T10:30:00Z"), tokens: 30 });
});
