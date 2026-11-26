import assert from "node:assert/strict";
import { test } from "node:test";
import { codexSamples, codexStripText, hitRate } from "./codex.js";

const agent = (address, app = "codex") => ({ address, app });
const terminal = (address, session, usage) => ({
  address, labels: { "codex.cache.session": session, "codex.cache.usage": usage },
});

test("only a matching, valid Codex report is sampled and zero hits stay visible", () => {
  const agents = [agent("t1"), agent("t2"), agent("t3"), agent("t4"), agent("t5", "claude-code"), agent("t6")];
  const terminals = [
    terminal("t1", "abc", "abc:100:0"),
    terminal("t2", "def", "abc:100:50"),
    terminal("t3", "abc", "abc:100:101"),
    terminal("t4", "abc", "abc:9007199254740999:1"),
    terminal("t5", "abc", "abc:100:50"),
  ];
  const result = codexSamples(agents, terminals);
  assert.deepEqual(result, { count: 5, samples: { t1: { input: 100, cached: 0 } } });
  assert.equal(codexStripText(result), "Codex: 1/5 sampled · 0% hit");
});

test("the strip aggregates tokens, leaves missing usage unknown and hides without Codex sessions", () => {
  assert.equal(hitRate(750, 1_000), 75);
  assert.equal(codexStripText({ count: 3, samples: { t1: { input: 100, cached: 100 }, t2: { input: 900, cached: 0 } } }),
    "Codex: 2/3 sampled · 10% hit");
  assert.equal(codexStripText({ count: 1, samples: {} }), "Codex: 0/1 sampled");
  assert.equal(codexStripText({ count: 0, samples: {} }), "");
});

test("local samples fill missing reports and a valid hook report takes priority", () => {
  const agents = [agent("t1"), agent("t2"), agent("t3", "claude-code")];
  const local = { t1: { input: 100, cached: 1 }, t2: { input: 50, cached: 25 }, t3: { input: 30, cached: 15 } };
  assert.deepEqual(codexSamples(agents, [terminal("t1", "abc", "abc:100:0")], local), {
    count: 2, samples: { t1: { input: 100, cached: 0 }, t2: { input: 50, cached: 25 } },
  });
});

test("a report with the request time carries it; a bad time is dropped", () => {
  const agents = [agent("t1"), agent("t2")];
  const terminals = [terminal("t1", "abc", "abc:100:40:1795600000000"), terminal("t2", "abc", "abc:100:40:0")];
  assert.deepEqual(codexSamples(agents, terminals).samples, {
    t1: { input: 100, cached: 40, at: 1795600000000 },
    t2: { input: 100, cached: 40 },
  });
});
