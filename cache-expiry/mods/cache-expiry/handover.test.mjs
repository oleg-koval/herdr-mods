import { test } from "node:test";
import assert from "node:assert/strict";
import { handoverPaths, sessionKey, parseMeta, handoverState, handoverPrompt, applyPrompt, stamp } from "./handover.js";

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
  assert.deepEqual(handoverState(null, true, "a"), { requested: false, saved: false, cleared: false, ready: false });
  assert.deepEqual(handoverState(meta, false, "a"), { requested: true, saved: false, cleared: false, ready: false });
  assert.deepEqual(handoverState(meta, true, "a"), { requested: false, saved: true, cleared: false, ready: false });
  assert.deepEqual(handoverState(meta, true, "b"), { requested: false, saved: true, cleared: true, ready: true });
  assert.equal(handoverState({ requested_at: 1, session: null }, true, "b").ready, false);
  assert.equal(handoverState({ requested_at: 1, session: null, cleared_at: 2 }, true, null).ready, true);
  assert.equal(handoverState({ requested_at: 1, session: "a" }, true, null).ready, false);
});

test("prompts name the file", () => {
  assert.match(handoverPrompt("/x/t1.md"), /\/x\/t1\.md/);
  assert.match(applyPrompt("/x/a.md"), /\/x\/a\.md/);
  assert.equal(stamp(new Date(2026, 10, 25, 16, 30, 5).getTime()), "20261125-163005");
});
