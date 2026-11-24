import assert from "node:assert/strict";
import { test } from "node:test";
import { checkJevDashboard } from "./jev.js";

test("checks the loopback dashboard without proxy settings or an unbounded wait", async () => {
  const status = await checkJevDashboard(async (command, args, options) => {
    assert.equal(command, "/usr/bin/curl");
    assert.deepEqual(args, [
      "-q", "--noproxy", "*", "--silent", "--fail", "--max-time", "2",
      "http://127.0.0.1:8791/api/health",
    ]);
    assert.equal(options.timeout, 3_000);
    return { code: 0, stdout: '{"ok":true,"hermes_home":"/hermes","auth_required":false}' };
  });
  assert.equal(status, "connected");
});

test("does not report a connection without a valid Jev health response", async () => {
  for (const code of [7, 28]) {
    assert.equal(await checkJevDashboard(async () => ({ code })), "unreachable");
  }
  for (const result of [
    { code: 22 },
    { code: 0, stdout: '{"ok":true}' },
    { code: 0, stdout: 'not JSON' },
  ]) {
    assert.equal(await checkJevDashboard(async () => result), "unknown");
  }
  assert.equal(await checkJevDashboard(async () => { throw new Error("exec failed"); }), "unknown");
});
