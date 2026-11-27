import { test } from "node:test";
import assert from "node:assert/strict";
import { closeTargets, forkSource, pinPlan, tabMenuItems, shortcutFor } from "./items.js";

const agent = (address, extra) => ({ address, tab: "tb1", app: "claude-code", focused: false, seq: 1, tab_name: "", title: "Claude Code", ...extra });

test("forkSource prefers the focused Claude session, then the most recent, and ignores other tabs and apps", () => {
  assert.equal(forkSource("tb1", [agent("t1", { seq: 5 }), agent("t2", { focused: true })]).address, "t2");
  assert.equal(forkSource("tb1", [agent("t1", { seq: 5 }), agent("t2", { seq: 9 })]).address, "t2");
  assert.equal(forkSource("tb1", [agent("t1", { app: "codex" }), agent("t2", { tab: "tb2" })]), null);
});

test("tabMenuItems adds Fork session only for a tab with a Claude session", () => {
  const target = { id: "tb1", space: "sp1" };
  const withClaude = tabMenuItems(target, [agent("t1", { tab_name: "PR review" })]);
  assert.deepEqual(withClaude.map((i) => i.label).slice(0, 3), ["Rename", "New tab", "Fork session"]);
  assert.deepEqual(withClaude[2].fork, { address: "t1", title: "PR review" });
  assert.deepEqual(tabMenuItems(target, []).map((i) => i.label).slice(0, 3), ["Rename", "New tab", "Pin tab"]);
});

test("the menu offers Pin or Unpin and the browser-style closes", () => {
  const ctx = { tabIds: ["a", "b", "c", "d"], pinned: ["a"] };
  assert.deepEqual(tabMenuItems({ id: "c", space: "sp1" }, [], ctx).map((i) => i.label),
    ["Rename", "New tab", "Pin tab", "Close", "Close others", "Close to the right", "Close to the left"]);
  assert.equal(tabMenuItems({ id: "a", space: "sp1" }, [], ctx)[2].label, "Unpin tab");
});

test("bulk closes name only unpinned tabs on the chosen side and are disabled when there are none", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual(closeTargets("others", ids, ["a", "e"], "c"), ["b", "d"]);
  assert.deepEqual(closeTargets("right", ids, ["d"], "b"), ["c", "e"]);
  assert.deepEqual(closeTargets("left", ids, ["a"], "d"), ["b", "c"]);
  assert.deepEqual(closeTargets("right", ids, [], "gone"), []);
  const items = tabMenuItems({ id: "b", space: "sp1" }, [], { tabIds: ["a", "b"], pinned: ["a"] });
  const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
  assert.equal(byLabel["Close to the left"].disabled, true);
  assert.equal(byLabel["Close to the right"].disabled, true);
  assert.equal(byLabel["Close others"].disabled, true);
  assert.deepEqual(byLabel["Close"].args, { id: "b" });
});

test("pinPlan puts a pinned tab at the end of the pinned group and an unpinned one at the start of the rest", () => {
  assert.deepEqual(pinPlan(["a", "b", "c", "d"], ["a"], "d"), { pinned: ["a", "d"], moveTo: 2 });
  assert.deepEqual(pinPlan(["a", "b", "c"], [], "c"), { pinned: ["c"], moveTo: 1 });
  assert.deepEqual(pinPlan(["a", "b", "c", "d"], ["a", "b"], "a"), { pinned: ["b"], moveTo: 2 });
});

test("pinPlan drops pinned ids that no longer exist", () => {
  assert.deepEqual(pinPlan(["a", "b"], ["a", "closed"], "b", ["a", "b"]), { pinned: ["a", "b"], moveTo: 2 });
});

test("shortcutFor finds the bound key and skips the palette pseudo-binding", () => {
  const bindings = [{ action: "tab.new", keys: "command" }, { action: "tab.new", keys: "cmd-t" }, { action: "tab.rename", keys: "f2" }];
  assert.equal(shortcutFor(bindings, "tab.new"), "cmd-t");
  assert.equal(shortcutFor(bindings, "tab.rename"), "f2");
  assert.equal(shortcutFor(bindings, "tab.close"), "");
});
