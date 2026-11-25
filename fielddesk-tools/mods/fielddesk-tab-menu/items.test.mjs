import { test } from "node:test";
import assert from "node:assert/strict";
import { forkSource, tabMenuItems, shortcutFor } from "./items.js";

const agent = (address, extra) => ({ address, tab: "tb1", app: "claude-code", focused: false, seq: 1, tab_name: "", title: "Claude Code", ...extra });

test("forkSource prefers the focused Claude session, then the most recent, and ignores other tabs and apps", () => {
  assert.equal(forkSource("tb1", [agent("t1", { seq: 5 }), agent("t2", { focused: true })]).address, "t2");
  assert.equal(forkSource("tb1", [agent("t1", { seq: 5 }), agent("t2", { seq: 9 })]).address, "t2");
  assert.equal(forkSource("tb1", [agent("t1", { app: "codex" }), agent("t2", { tab: "tb2" })]), null);
});

test("tabMenuItems adds Fork session only for a tab with a Claude session", () => {
  const target = { id: "tb1", space: "sp1" };
  const withClaude = tabMenuItems(target, [agent("t1", { tab_name: "PR review" })]);
  assert.deepEqual(withClaude.map((i) => i.label), ["Rename", "New tab", "Fork session", "Close"]);
  assert.deepEqual(withClaude[2].fork, { address: "t1", title: "PR review" });
  assert.deepEqual(tabMenuItems(target, []).map((i) => i.label), ["Rename", "New tab", "Close"]);
});

test("shortcutFor finds the bound key and skips the palette pseudo-binding", () => {
  const bindings = [{ action: "tab.new", keys: "command" }, { action: "tab.new", keys: "cmd-t" }, { action: "tab.rename", keys: "f2" }];
  assert.equal(shortcutFor(bindings, "tab.new"), "cmd-t");
  assert.equal(shortcutFor(bindings, "tab.rename"), "f2");
  assert.equal(shortcutFor(bindings, "tab.close"), "");
});
