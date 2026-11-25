import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allToggleLabel, avatarColor, avatarLetter, closeConfirm, expandAll, isExpanded, liveSelection, mergeConfirm,
  mergeSummary, planMerge, renamePlan, renamed, rowTail, selectState, tabLabel, tally, toggleAllSelected,
  toggleExpanded, toggleSelected,
} from "./plan.js";

const tab = (id, name, extra = {}) => ({ id, name, named: true, active: false, status: null, ...extra });
const space = (id, name, tabs, extra = {}) => ({ id, name, machine: null, branch: null, active: false, status: null, tabs, ...extra });
const spaces = [
  space("s1", "alpha", [tab("a1", "build")]),
  space("s2", "beta", [tab("b1", "1", { named: false }), tab("b2", "logs")]),
  space("s3", "gamma", [tab("c1", "ui")]),
  space("s4", "remote", [tab("d1", "x")], { machine: "box" }),
];
const panes = [
  { pane: "p1", terminal: "t1", tab: "a1" },
  { pane: "p2", terminal: "t2", tab: "b1" },
  { pane: "p3", terminal: "t3", tab: "b1" },
  { pane: "p4", terminal: "t4", tab: "b2" },
  { pane: "p5", terminal: null, mod: "files", tab: "c1" },
  { pane: "p6", terminal: "box/t9", tab: "d1" },
];

test("toggleSelected adds and removes without touching the input", () => {
  const before = ["s1"];
  assert.deepEqual(toggleSelected(before, "s2"), ["s1", "s2"]);
  assert.deepEqual(toggleSelected(before, "s1"), []);
  assert.deepEqual(before, ["s1"]);
});

test("liveSelection keeps list order and drops spaces that are gone", () => {
  assert.deepEqual(liveSelection(["s3", "gone", "s1"], spaces), ["s1", "s3"]);
});

test("selectState and toggleAllSelected: none, some, all", () => {
  assert.equal(selectState([], spaces), "none");
  assert.equal(selectState(["s1"], spaces), "some");
  assert.equal(selectState(["s1", "s2", "s3", "s4"], spaces), "all");
  assert.equal(selectState(["gone"], spaces), "none");
  assert.deepEqual(toggleAllSelected([], spaces), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(toggleAllSelected(["s1"], spaces), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(toggleAllSelected(["s1", "s2", "s3", "s4"], spaces), []);
});

test("expansion stores only open spaces and flips the header label", () => {
  const open = toggleExpanded({}, "s1");
  assert.deepEqual(open, { s1: true });
  assert.equal(isExpanded(open, "s1"), true);
  assert.equal(isExpanded(open, "s2"), false);
  assert.deepEqual(toggleExpanded(open, "s1"), {});
  assert.deepEqual(toggleExpanded(undefined, "s1"), { s1: true });
  assert.equal(allToggleLabel({}, spaces), "Expand all");
  assert.equal(allToggleLabel(open, spaces), "Collapse all");
  assert.equal(allToggleLabel({ gone: true }, spaces), "Expand all");
  assert.equal(Object.keys(expandAll(spaces)).length, 4);
  assert.equal(allToggleLabel(expandAll(spaces), spaces), "Collapse all");
});

test("renamed is prefix + name + suffix, and renamePlan skips unchanged names", () => {
  assert.equal(renamed("api", "fd-", " (old)"), "fd-api (old)");
  assert.equal(renamed("api", "", ""), "api");
  assert.deepEqual(renamePlan(spaces, ["s2", "s1"], "x-", ""), [
    { id: "s1", from: "alpha", name: "x-alpha" },
    { id: "s2", from: "beta", name: "x-beta" },
  ]);
  assert.deepEqual(renamePlan(spaces, ["s1"], "", ""), []);
});

test("planMerge moves every other selected space into the first one in list order", () => {
  const plan = planMerge(spaces, panes, ["s3", "s2", "s1"]);
  assert.equal(plan.target.id, "s1");
  assert.deepEqual(plan.sources.map((s) => s.id), ["s2", "s3"]);
  assert.deepEqual(plan.moves, [
    { space: "s2", tabName: null, terminals: ["t2", "t3"] },
    { space: "s2", tabName: "logs", terminals: ["t4"] },
  ]);
  assert.equal(plan.stranded, 1, "gamma's only tab holds a mod pane, so it can't move");
  assert.deepEqual(plan.skipped, []);
});

test("planMerge leaves other machines out and handles a lone or empty selection", () => {
  const plan = planMerge(spaces, panes, ["s1", "s4"]);
  assert.deepEqual(plan.sources, []);
  assert.deepEqual(plan.skipped.map((s) => s.id), ["s4"]);
  assert.deepEqual(plan.moves, []);
  assert.equal(planMerge(spaces, panes, []).target, null);
  assert.deepEqual(planMerge(spaces, panes, ["s2"]).sources, []);
});

test("tally counts spaces, tabs, terminals with a pane and live agents", () => {
  const agents = [
    { space: "s2", status: "working" }, { space: "s2", status: "idle" }, { space: "s1", status: "blocked" },
  ];
  assert.deepEqual(tally(spaces, panes, agents, ["s2", "s3"]), { spaces: 2, tabs: 3, terminals: 3, agents: 2, working: 1 });
  assert.deepEqual(tally(spaces, panes, [], ["gone"]), { spaces: 0, tabs: 0, terminals: 0, agents: 0, working: 0 });
});

test("mergeConfirm names the target, the counts and what is not merged", () => {
  const plan = planMerge(spaces, panes, ["s1", "s2", "s3", "s4"]);
  const t = tally(spaces, panes, [{ space: "s2", status: "working" }], plan.sources.map((s) => s.id));
  const { title, detail } = mergeConfirm(plan, t);
  assert.equal(title, "Merge 2 spaces into “alpha”?");
  assert.match(detail, /Moves 2 tabs \(3 terminals\) from “beta”, “gamma”\./);
  assert.match(detail, /1 live agent \(1 working\) move\./);
  assert.match(detail, /1 tab with no terminal stays/);
  assert.match(detail, /1 space on another machine isn't merged\./);
  const none = mergeConfirm(planMerge(spaces, panes, ["s1", "s2"]), tally(spaces, panes, [], ["s2"]));
  assert.match(none.detail, /No live agents\./);
  assert.equal(mergeConfirm(planMerge(spaces, panes, ["s2", "s3"]), tally(spaces, panes, [], ["s3"])).title, "Merge 1 space into “beta”?");
});

test("closeConfirm shows spaces, tabs, terminals and agents that stop", () => {
  const t = tally(spaces, panes, [{ space: "s1", status: "idle" }, { space: "s2", status: "working" }], ["s1", "s2"]);
  assert.deepEqual(closeConfirm(t), {
    title: "Close 2 spaces?",
    detail: "Ends 3 tabs and 4 terminals. 2 live agents (1 working) stop. This can't be undone.",
  });
  assert.match(closeConfirm(tally(spaces, panes, [], ["s3"])).detail, /No live agents\./);
});

test("mergeSummary is a success only when everything moved and the sources closed", () => {
  const plan = planMerge(spaces, panes, ["s1", "s2"]);
  assert.deepEqual(mergeSummary(plan, { moved: 3, failed: [] }, []), {
    title: "Spaces merged", body: "Moved 3 of 3 terminals into “alpha”.", level: "success",
  });
  const bad = mergeSummary(plan, { moved: 2, failed: [{ terminal: "t3", step: "adopt" }] }, [spaces[1]]);
  assert.equal(bad.level, "warning");
  assert.match(bad.body, /Moved 2 of 3 terminals/);
  assert.match(bad.body, /Not moved: t3 \(adopt\)/);
  assert.match(bad.body, /Still open: “beta”/);
});

test("row text: tab label, tail, avatar", () => {
  assert.equal(tabLabel(tab("x", "logs")), "logs");
  assert.equal(tabLabel(tab("x", "2", { named: false })), "Tab 2");
  assert.equal(rowTail(space("s", "n", [], { machine: "box", branch: "dev" })), "box");
  assert.equal(rowTail(space("s", "n", [], { branch: "main" })), "");
  assert.equal(rowTail(space("s", "n", [], { branch: "fix-x" })), "fix-x");
  assert.equal(rowTail(space("s", "n", [])), "");
  assert.equal(avatarLetter("alpha"), "A");
  assert.equal(avatarLetter("🚀 launch"), "🚀");
  assert.equal(avatarLetter(""), "?");
});

test("avatarColor prefers the stored colour, resolves theme names and falls back by position", () => {
  const colors = { ansi6: "#111", ansi3: "#222", accent: "#999" };
  assert.equal(avatarColor("#abcdef", 0, colors), "#abcdef");
  assert.equal(avatarColor("ansi3", 0, colors), "#222");
  assert.equal(avatarColor(undefined, 0, colors), "#111");
  assert.equal(avatarColor(undefined, 1, colors), "#222");
  assert.equal(avatarColor("unknown", 0, colors), "#999");
});
