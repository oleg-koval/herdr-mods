import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contextLabelFrom } from "./label.js";

test("contextLabelFrom reads herdr_context_label from settings.json, else herdr.context", () => {
  assert.equal(contextLabelFrom(JSON.stringify({ herdr_context_label: "my.context" })), "my.context");
  assert.equal(contextLabelFrom(JSON.stringify({ herdr_context_label: "  " })), "herdr.context");
  assert.equal(contextLabelFrom(JSON.stringify({ zoom: 1 })), "herdr.context");
  assert.equal(contextLabelFrom("{ broken"), "herdr.context");
  assert.equal(contextLabelFrom(null), "herdr.context");
});

test("every mod that reads the context label keeps the same copy", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const mine = read("./label.js");
  assert.equal(read("../fielddesk-handoff/label.js"), mine);
  assert.equal(read("../../../agent-brief/mods/agent-brief/label.js"), mine);
});
