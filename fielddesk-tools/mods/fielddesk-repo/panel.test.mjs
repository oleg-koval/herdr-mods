import { test } from "node:test";
import assert from "node:assert/strict";
import { findNode, hasPanel, panelShows } from "./panel.js";

const tree = (hidden, active) => ({
  id: "root", type: "row", children: [
    { id: "work", type: "column", children: [
      { id: "panel", type: "column", hidden, children: [
        { id: "panel-body", type: "stack", active, children: [{ id: "files" }, { id: "prs" }] },
      ] },
    ] },
  ],
});

test("findNode finds nested nodes and tolerates junk", () => {
  assert.equal(findNode(tree(true, "files"), "panel-body").type, "stack");
  assert.equal(findNode(tree(true, "files"), "nope"), null);
  assert.equal(findNode(null, "panel"), null);
});

test("hasPanel is true only for a child of the panel stack", () => {
  assert.equal(hasPanel(tree(true, "files"), "prs"), true);
  assert.equal(hasPanel(tree(true, "files"), "changes"), false);
  assert.equal(hasPanel({ id: "root", children: [] }, "prs"), false);
});

test("panelShows needs the panel visible and the child active", () => {
  assert.equal(panelShows(tree(false, "prs"), "prs"), true);
  assert.equal(panelShows(tree(true, "prs"), "prs"), false);
  assert.equal(panelShows(tree(false, "files"), "prs"), false);
});
