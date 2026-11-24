import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeNote } from "./note.js";

test("copies recorded facts without multiline field injection", () => {
  const note = resumeNote({ space: "Checkout", tab: "Review", folder: "/work/checkout", branch: "feature/cart", context: "Review the cart\nnext" });
  assert.equal(note, "Resume this session\nSession: Checkout / Review\nFolder: /work/checkout\nBranch: feature/cart\nRecorded context: Review the cart next");
});

test("marks missing context unavailable and omits absent facts", () => {
  assert.equal(resumeNote({ context: { text: "unexpected" } }), "Resume this session\nRecorded context: unavailable");
});
