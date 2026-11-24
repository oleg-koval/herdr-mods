import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, lineageRows, withIdleAge, workerRows } from "./workers.js";

test("includes pane-less children, nested children and inline workers with their owners", () => {
  const terms = [
    { address: "m/t1", state: "live", records: { qa: { state: "working", title: "Validate build" }, "qa/browser": { state: "idle" }, noise: {} } },
    { address: "m/t2", name: "Review", parent: "m/t1", state: "live", status: "error" },
    { address: "m/t3", parent: "m/t2", state: "live" },
    { address: "m/t4", parent: "m/t1", state: "finished", status: "working" },
  ];
  const agents = [{ address: "m/t1", tab_name: "Release", status: "working" }, { address: "m/t2" }];
  const rows = workerRows(terms, agents);
  assert.deepEqual(rows.map(({ name, parent, status, target, command }) => [name, parent, status, target, command]), [
    ["Validate build", "Release", "live", "m/t1", "agent.focus"],
    ["browser", "Release", "idle", "m/t1", "agent.focus"],
    ["Review", "Release", "blocked", "m/t2", "agent.focus"],
    ["m/t3", "Review", "live", "m/t3", "terminal.peek"],
    ["m/t4", "Release", "done", "m/t4", null],
  ]);
  assert.equal(rows[3].detail, "No status reported");
  const tree = lineageRows(agents, rows);
  assert.deepEqual(tree.map(({ name, guides, branch }) => [name, guides, branch]), [
    ["Release", [], null], ["Validate build", [], "tee"], ["browser", [true], "elbow"],
    ["Review", [], "tee"], ["m/t3", [true], "elbow"], ["m/t4", [], "elbow"],
  ]);
});

test("stale means one hour continuously observed idle, never an old working or blocked session", () => {
  const idle = { id: "idle", status: "idle" };
  const first = withIdleAge([idle], new Map(), 100);
  assert.equal(withIdleAge([idle], first.idleSince, 99 + STALE_MS).rows[0].status, "idle");
  assert.equal(withIdleAge([idle], first.idleSince, 100 + STALE_MS).rows[0].status, "stale");
  for (const status of ["live", "blocked", "done"]) {
    const changed = withIdleAge([{ ...idle, status }], first.idleSince, 100 + STALE_MS);
    assert.equal(changed.rows[0].status, status);
    assert.equal(changed.idleSince.size, 0);
  }
  const absent = withIdleAge([], first.idleSince, 100 + STALE_MS);
  assert.equal(withIdleAge([idle], absent.idleSince, 100 + STALE_MS).rows[0].status, "idle");
});

test("missing parents and malformed cycles leave workers visible exactly once", () => {
  const rows = lineageRows([], [
    { key: "child", parentKey: "missing", parent: "Lost parent" },
    { key: "a", parentKey: "b" }, { key: "b", parentKey: "a" },
  ]);
  assert.deepEqual(rows.map((row) => row.key), ["missing", "child", "a", "b"]);
  assert.equal(rows[0].status, "unknown");
});
