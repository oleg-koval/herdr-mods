import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handoverPaths, sessionKey, parseMeta, handoverState, handoverPrompt, applyPrompt, stamp, delivered, parseProbe, CLEAR_SETTLE_MS,
} from "./handover.js";

test("handoverPaths keeps every file under one state folder", () => {
  assert.deepEqual(handoverPaths("/h", "t7c"), {
    dir: "/h/.local/state/herdr-handover",
    md: "/h/.local/state/herdr-handover/t7c.md",
    meta: "/h/.local/state/herdr-handover/t7c.json",
    applied: "/h/.local/state/herdr-handover/applied",
  });
});

test("sessionKey reads the Claude or Codex conversation label", () => {
  assert.equal(sessionKey({ "claude.session": "a" }), "a");
  assert.equal(sessionKey({ "codex.cache.session": "b" }), "b");
  assert.equal(sessionKey({}), null);
  assert.equal(sessionKey(undefined), null);
});

test("parseMeta rejects junk", () => {
  assert.equal(parseMeta("nope"), null);
  assert.equal(parseMeta("{}"), null);
  assert.deepEqual(parseMeta('{"requested_at":1,"session":"a"}'), { requested_at: 1, session: "a" });
});

test("handoverState: requested, saved, then ready once cleared", () => {
  const meta = { requested_at: 1, session: "a" };
  const none = { requested: false, saved: false, cleared: false, clearing: false, ready: false };
  assert.deepEqual(handoverState(null, true, "a", 0), none);
  assert.deepEqual(handoverState(meta, false, "a", 0), { ...none, requested: true });
  assert.deepEqual(handoverState(meta, true, "a", 0), { ...none, saved: true });
  assert.deepEqual(handoverState(meta, true, "b", 0), { ...none, saved: true, cleared: true, ready: true });
  assert.equal(handoverState({ requested_at: 1, session: null }, true, "b", 0).ready, false);
  assert.equal(handoverState({ requested_at: 1, session: "a" }, true, null, 0).ready, false);
});

test("handoverState: a Clear from the dialog counts only after the settle time", () => {
  const meta = { requested_at: 1, session: null, cleared_at: 1_000 };
  const early = handoverState(meta, true, null, 1_000 + CLEAR_SETTLE_MS - 1);
  assert.deepEqual([early.ready, early.clearing], [false, true]);
  const late = handoverState(meta, true, null, 1_000 + CLEAR_SETTLE_MS);
  assert.deepEqual([late.ready, late.clearing], [true, false]);
  // A relabelled conversation is proof the new one started, so it does not wait.
  assert.equal(handoverState({ ...meta, session: "a" }, true, "b", 1_000).ready, true);
});

test("delivered: a new turn or a working session, never a missing probe", () => {
  assert.equal(delivered({ turn: 10, state: "idle" }, { turn: 10, state: "idle" }), false);
  assert.equal(delivered({ turn: 10, state: "idle" }, { turn: 11, state: "idle" }), true);
  assert.equal(delivered({ turn: 10, state: "idle" }, { turn: 10, state: "working" }), true);
  assert.equal(delivered(null, { turn: 10, state: "working" }), true);
  assert.equal(delivered(null, { turn: 11, state: "idle" }), false);
  assert.equal(delivered({ turn: 10, state: "idle" }, null), false);
});

test("parseProbe reads turn and status from hc get --json", () => {
  assert.deepEqual(parseProbe('{"turn":11,"status":{"app":"codex","state":"idle"}}'), { turn: 11, state: "idle" });
  assert.deepEqual(parseProbe('{"turn":3}'), { turn: 3, state: null });
  assert.equal(parseProbe("nope"), null);
  assert.equal(parseProbe('{"status":{}}'), null);
});

test("prompts name the file", () => {
  assert.match(handoverPrompt("/x/t1.md"), /\/x\/t1\.md/);
  assert.match(applyPrompt("/x/a.md"), /\/x\/a\.md/);
  assert.equal(stamp(new Date(2026, 10, 25, 16, 30, 5).getTime()), "20261125-163005");
});
