import { test } from "node:test";
import assert from "node:assert/strict";
import { moveTerminals, stillOpen } from "./move.js";

// A fake Herdr: parking clears the labels and the pane a poll later; labelling adopts the
// terminal into the target space, in the labelled tab or a fresh one.
function world({ stuck = [], keep = true } = {}) {
  const state = { panes: [], labels: {}, keep: {}, calls: [], parking: new Set(), nextTab: 1, spaces: [] };
  const sleep = async () => {
    for (const t of state.parking) {
      state.panes = state.panes.filter((p) => p.terminal !== t);
      state.labels = { ...state.labels, [t]: {} };
    }
    state.parking = new Set();
  };
  const hc = async (args) => {
    const [cmd, terminal, ...rest] = args;
    state.calls.push(["hc", cmd, terminal, ...rest.filter((a) => a !== "--json")]);
    if (cmd === "get") return { code: 0, stdout: JSON.stringify({ labels: state.labels[terminal] ?? {}, keep: state.keep[terminal] ?? true }), stderr: "" };
    if (cmd === "label") {
      const pairs = Object.fromEntries(rest.filter((a) => a.includes("=")).map((a) => a.split("=")));
      state.labels = { ...state.labels, [terminal]: pairs };
      if (!stuck.includes(terminal)) {
        const tab = pairs["herdr.tab"] ?? `new${state.nextTab++}`;
        state.panes = [...state.panes, { pane: `p-${terminal}`, terminal, tab }];
        state.keep = { ...state.keep, [terminal]: keep };
      }
      return { code: 0, stdout: "{}", stderr: "" };
    }
    if (cmd === "keep") { state.keep = { ...state.keep, [terminal]: true }; return { code: 0, stdout: "{}", stderr: "" }; }
    return { code: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
  const run = (name, args) => {
    state.calls.push(["run", name, args]);
    if (name === "terminal.park") state.parking = new Set([...state.parking, args.terminal]);
  };
  return { state, io: { run, hc, sleep, panes: () => state.panes, spaces: () => state.spaces } };
}

const plan = {
  target: { id: "s1", name: "alpha" },
  sources: [{ id: "s2" }],
  moves: [
    { space: "s2", tabName: "logs", terminals: ["t1", "t2"] },
    { space: "s2", tabName: null, terminals: ["t3"] },
  ],
};

test("each terminal is parked, labelled into the target, and joins its tab's new tab", async () => {
  const { state, io } = world();
  state.labels = { t1: { "herdr.space": "s2" }, t2: { "herdr.space": "s2" }, t3: { "herdr.space": "s2" } };
  state.panes = ["t1", "t2", "t3"].map((t) => ({ pane: `old-${t}`, terminal: t, tab: "old" }));
  const result = await moveTerminals(plan, io);
  assert.deepEqual(result, { moved: 3, failed: [] });
  assert.deepEqual(state.labels.t1, { "herdr.space": "s1" });
  assert.deepEqual(state.labels.t2, { "herdr.space": "s1", "herdr.tab": "new1" });
  assert.deepEqual(state.labels.t3, { "herdr.space": "s1" });
  assert.deepEqual(state.panes.map((p) => [p.terminal, p.tab]), [["t1", "new1"], ["t2", "new1"], ["t3", "new2"]]);
  const rename = state.calls.filter(([kind, name]) => kind === "run" && name === "tab.rename");
  assert.deepEqual(rename, [["run", "tab.rename", { id: "new1", name: "logs" }]], "only the named tab is renamed");
  const order = state.calls.filter(([kind, name]) => kind === "run" && name === "terminal.park").map(([, , a]) => a.terminal);
  assert.deepEqual(order, ["t1", "t2", "t3"]);
});

test("labelling waits for the park to finish, so the park cannot wipe it", async () => {
  const { state, io } = world();
  state.labels = { t1: { "herdr.space": "s2" } };
  state.panes = [{ pane: "old", terminal: "t1", tab: "old" }];
  await moveTerminals({ ...plan, moves: [{ space: "s2", tabName: null, terminals: ["t1"] }] }, io);
  const labelAt = state.calls.findIndex((c) => c[0] === "hc" && c[1] === "label");
  const lastGetBefore = state.calls.slice(0, labelAt).filter((c) => c[1] === "get").length;
  assert.ok(lastGetBefore >= 2, "polled the core until the labels were gone");
});

test("core keep is switched back on when adoption left it off", async () => {
  const { state, io } = world({ keep: false });
  state.labels = { t1: { "herdr.space": "s2" } };
  state.panes = [{ pane: "old", terminal: "t1", tab: "old" }];
  await moveTerminals({ ...plan, moves: [{ space: "s2", tabName: null, terminals: ["t1"] }] }, io);
  assert.ok(state.calls.some((c) => c[0] === "hc" && c[1] === "keep" && c[2] === "t1"));
  assert.equal(state.keep.t1, true);
});

test("a terminal that never shows up is reported, and the rest still move", async () => {
  const { state, io } = world({ stuck: ["t2"] });
  state.labels = { t1: { "herdr.space": "s2" }, t2: { "herdr.space": "s2" }, t3: { "herdr.space": "s2" } };
  state.panes = ["t1", "t2", "t3"].map((t) => ({ pane: `old-${t}`, terminal: t, tab: "old" }));
  const result = await moveTerminals(plan, io);
  assert.deepEqual(result, { moved: 2, failed: [{ terminal: "t2", step: "adopt" }] });
});

test("a failing hc call is reported for that terminal and does not throw", async () => {
  const { state, io } = world();
  state.labels = { t1: { "herdr.space": "s2" } };
  state.panes = [{ pane: "old", terminal: "t1", tab: "old" }];
  const failing = { ...io, hc: async () => ({ code: 1, stdout: "", stderr: "no such terminal\nmore" }) };
  const result = await moveTerminals({ ...plan, moves: [{ space: "s2", tabName: null, terminals: ["t1"] }] }, failing);
  assert.deepEqual(result, { moved: 0, failed: [{ terminal: "t1", step: "no such terminal" }] });
});

test("remote ids lose their machine prefix in labels", async () => {
  const { state, io } = world();
  state.labels = { "box/t1": { "herdr.space": "sp2" } };
  state.panes = [{ pane: "old", terminal: "box/t1", tab: "box/old" }];
  await moveTerminals({
    target: { id: "box/sp1", name: "alpha" },
    sources: [],
    moves: [{ space: "box/sp2", tabName: null, terminals: ["box/t1"] }],
  }, io);
  assert.deepEqual(state.labels["box/t1"], { "herdr.space": "sp1" });
});

test("stillOpen lists source spaces that did not close", async () => {
  const { state, io } = world();
  state.spaces = [{ id: "s1", name: "alpha" }, { id: "s2", name: "beta" }];
  assert.deepEqual(await stillOpen(plan, io), [{ id: "s2", name: "beta" }]);
  const closed = world();
  closed.state.spaces = [{ id: "s1", name: "alpha" }];
  assert.deepEqual(await stillOpen(plan, closed.io), []);
});
