import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readSettings, durationMinutes, stepped, legacySettings, DEFAULTS, KEYS, LIMITS,
  lastUsage, heatOf, coldness, mixHex, applyRead, keepOnly, summarize, stripText,
} from "./cold.js";

test("applyRead: ok sets, absent clears, failed keeps the last known usage", () => {
  const old = { at: 1, tokens: 10 };
  const fresh = { at: 2, tokens: 20 };
  const start = { usage: { t1: old }, seqs: { t1: 1 } };
  assert.deepEqual(applyRead(start, "t1", 2, { state: "ok", usage: fresh }).usage, { t1: fresh });
  assert.deepEqual(applyRead(start, "t1", 2, { state: "absent" }).usage, {});
  assert.deepEqual(applyRead(start, "t1", 2, { state: "failed" }).usage, { t1: old });
});

test("applyRead: a read that started before the applied one is dropped", () => {
  const newer = applyRead({ usage: {}, seqs: {} }, "t1", 5, { state: "ok", usage: { at: 50, tokens: 1 } });
  const late = applyRead(newer, "t1", 3, { state: "ok", usage: { at: 30, tokens: 1 } });
  assert.equal(late.usage.t1.at, 50);
  assert.equal(applyRead(newer, "t1", 4, { state: "absent" }).usage.t1.at, 50);
});

test("keepOnly drops terminals that are gone", () => {
  const state = { usage: { a: { at: 1, tokens: 1 }, b: { at: 1, tokens: 1 } }, seqs: { a: 1, b: 2 } };
  assert.deepEqual(keepOnly(state, ["b"]), { usage: { b: { at: 1, tokens: 1 } }, seqs: { b: 2 } });
});

test("summarize and stripText count cold and warm caches", () => {
  const now = 1_000_000_000;
  const usage = { a: { at: now - 70 * MIN, tokens: 1 }, b: { at: now - 50 * MIN, tokens: 1 }, c: { at: now - 10 * MIN, tokens: 1 } };
  const s = summarize(usage, now, TTL);
  assert.deepEqual(s, { cold: 1, warm: 2, nextColdMin: 5 });
  assert.equal(stripText(s), "Claude cache: 1 cold · 2 warm · next cold in 5m");
  assert.equal(stripText(summarize({}, now, TTL)), "No Claude caches tracked");
  assert.equal(stripText(summarize({ a: usage.a }, now, TTL)), "Claude cache: 1 cold · 0 warm");
});

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

test("readSettings: unset gives defaults, bad values fall back one by one", () => {
  assert.deepEqual(readSettings(() => undefined), { ...DEFAULTS, circle: { ...DEFAULTS.circle } });
  assert.deepEqual(readSettings(() => null), { ...DEFAULTS, circle: { ...DEFAULTS.circle } });
  const stored = {
    [KEYS.ttl]: { n: -3, unit: "minute" },
    [KEYS.toast]: "yes",
    [KEYS.circles]: false,
    [KEYS.hot]: "orange",
    [KEYS.cold]: "#123",
    [KEYS.minTokens]: 5_000_000,
  };
  const c = readSettings((key) => stored[key]);
  assert.equal(c.ttlMinutes, DEFAULTS.ttlMinutes);
  assert.equal(c.toast, DEFAULTS.toast);
  assert.equal(c.minTokens, DEFAULTS.minTokens);
  assert.equal(c.circle.enabled, false);
  assert.equal(c.circle.hot, DEFAULTS.circle.hot);
  assert.equal(c.circle.cold, "#123");
});

test("durationMinutes reads Herdr durations and bare minutes", () => {
  assert.equal(durationMinutes({ n: 2, unit: "hour" }), 120);
  assert.equal(durationMinutes({ n: 40, unit: "minute" }), 40);
  assert.equal(durationMinutes(30), 30);
  assert.equal(durationMinutes({ n: 1, unit: "day" }), null);
  assert.equal(durationMinutes(undefined), null);
});

test("legacySettings imports only valid, customised config.json values", () => {
  const text = JSON.stringify({
    ttlMinutes: 40,
    minTokens: 80_000,
    toast: false,
    toastSeconds: 999,
    circle: { enabled: true, hot: "#ef4444", cold: "blue" },
  });
  assert.deepEqual(legacySettings(text), {
    [KEYS.ttl]: { n: 40, unit: "minute" },
    [KEYS.toast]: false,
    [KEYS.hot]: "#ef4444",
  });
  assert.deepEqual(legacySettings(null), {});
  assert.deepEqual(legacySettings("{ nope"), {});
  assert.deepEqual(legacySettings("[1]"), {});
});

test("stepped stays inside its limits", () => {
  assert.equal(stepped(55, 5, LIMITS.ttlMinutes), 60);
  assert.equal(stepped(5, -5, LIMITS.ttlMinutes), 5);
  assert.equal(stepped(60, 1, LIMITS.toastSeconds), 60);
});

test("mod.json declares every setting key with the code's defaults", () => {
  const manifest = JSON.parse(readFileSync(new URL("./mod.json", import.meta.url), "utf8"));
  const declared = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]));
  assert.deepEqual(Object.keys(declared).sort(), Object.values(KEYS).sort());
  const fromManifest = readSettings((key) => declared[key]);
  assert.deepEqual(fromManifest, { ...DEFAULTS, circle: { ...DEFAULTS.circle } });
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
