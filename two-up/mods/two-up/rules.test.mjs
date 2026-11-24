import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS, MAX_TERMINALS, countTerminals, decide, overCap, popupArgs, popupLayout,
} from "./rules.js";

const term = (tab, n) => ({ pane: `p${tab}${n}`, terminal: `t${tab}${n}`, tab });
const mod = (tab) => ({ pane: `m${tab}`, terminal: null, mod: "files", tab });

test("cap is two", () => assert.equal(MAX_TERMINALS, 2));

test("mod panes do not count as terminals", () => {
  assert.equal(countTerminals([term("a", 1), mod("a"), mod("a")], "a"), 1);
});

test("counts per tab", () => {
  const panes = [term("a", 1), term("a", 2), term("b", 1)];
  assert.equal(countTerminals(panes, "a"), 2);
  assert.equal(countTerminals(panes, "b"), 1);
});

test("decide allows the second terminal and refuses the third", () => {
  assert.equal(decide(1), "allow");
  assert.equal(decide(2), "refuse");
  assert.equal(decide(3), "refuse");
});

test("overCap names only tabs above the cap", () => {
  const panes = [term("a", 1), term("a", 2), term("a", 3), term("b", 1), term("b", 2), mod("b")];
  assert.deepEqual(overCap(panes), [{ tab: "a", count: 3 }]);
});

test("popup runs detached, removed on exit, with no parent", () => {
  const args = popupArgs("/tmp/x", ["lazygit"]);
  for (const flag of ["--bg", "--rm", "--no-parent", "--json"]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(-2), ["--", "lazygit"]);
  assert.equal(args[args.indexOf("--cwd") + 1], "/tmp/x");
  assert.ok(!popupArgs(null, ["yazi"]).includes("--cwd"));
});

test("popup layout puts the terminal under a bar for the same mod", () => {
  const layout = popupLayout("t9", "yazi");
  assert.equal(layout.children[0].content.mod, "two-up");
  assert.equal(layout.children[0].content.props.role, "bar");
  assert.deepEqual(layout.children[1].content, { terminal: "t9" });
});

test("every action has a known kind, and programs carry argv", () => {
  for (const [name, a] of Object.entries(ACTIONS)) {
    assert.ok(["split", "program", "exec", "window"].includes(a.kind), name);
    if (a.kind !== "split") assert.ok(Array.isArray(a.argv), name);
    if (a.kind === "split" || a.kind === "program") assert.ok(["right", "down"].includes(a.direction), name);
  }
});
