// The engine behind one copy of the mod, shared by the board (pr-review) and the guard (pr-review-guard).
// Herdr mods cannot import outside their own folder, so both folders carry an identical copy of this file
// and of rules.js; rules.test.mjs fails when they drift.

import { exec, home, props, readTextFile } from "herdr";
import { ENGINE_MARK, cli, execFailure, execTimeout, panelPath, parseSnapshot } from "./rules.js";

const GATE_RETRY_MS = 120000;

const firstLine = (s) => String(s ?? "").trim().split("\n")[0] ?? "";

// It refuses every call until its panel module knows `--json`
// (an older one would ignore the flag, write an HTML page and start a web server).
export function makeEngine(bin) {
  let ready = false;
  let checkedAt = 0;

  // A call that failed may mean the engine changed under us: the next call checks the marker again.
  const drop = () => {
    ready = false;
    checkedAt = 0;
  };

  async function gate(force) {
    if (ready) return true;
    const now = Date.now();
    if (!force && checkedAt && now - checkedAt < GATE_RETRY_MS) return false;
    checkedAt = now;
    try {
      const link = await exec("readlink", [bin]);
      const text = await readTextFile(panelPath(bin, link.code === 0 ? link.stdout.trim() : ""));
      ready = typeof text === "string" && text.includes(ENGINE_MARK);
    } catch {
      ready = false;
    }
    return ready;
  }

  const tooOld = { old: true, error: "engine too old: update dotfiles (needs `pr-autoreview panel --json`)" };

  // Runs a panel command that prints the fresh document.
  async function panel(argv, force = false) {
    if (!(await gate(force))) return tooOld;
    try {
      const r = await exec(bin, argv, { timeout: execTimeout(argv) });
      if (r.code !== 0) {
        drop();
        return { error: `engine exit ${r.code}: ${firstLine(r.stderr) || firstLine(r.stdout)}` };
      }
      const out = parseSnapshot(r.stdout);
      if (out.error) drop();
      return out;
    } catch (err) {
      drop();
      return { error: execFailure(err, execTimeout(argv)) };
    }
  }

  // Runs a command that prints text; the caller refetches afterwards.
  async function command(argv) {
    if (!(await gate(false))) return tooOld;
    try {
      const r = await exec(bin, argv, { timeout: execTimeout(argv) });
      if (r.code === 0) return { ok: true };
      drop();
      return { error: `engine exit ${r.code}: ${firstLine(r.stderr) || firstLine(r.stdout)}` };
    } catch (err) {
      drop();
      return { error: execFailure(err, execTimeout(argv)) };
    }
  }

  return { panel, command, read: (force) => panel(cli.read(), force) };
}

export function engineBin() {
  const given = props()?.bin;
  if (typeof given === "string" && given.startsWith("/")) return given;
  try {
    const saved = globalThis.localStorage?.getItem("pr-review.bin");
    if (saved && saved.startsWith("/")) return saved;
  } catch {}
  return `${home()}/bin/pr-autoreview`;
}
