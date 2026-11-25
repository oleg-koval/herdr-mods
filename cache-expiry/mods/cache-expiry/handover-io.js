// The edge for handovers: files under ~/.local/state/herdr-handover and the prompts sent with hc.
// Lifecycle and wording live in handover.js.

import { exec, home, readTextFile, writeTextFile, terminals } from "herdr";
import { handoverPaths, sessionKey, parseMeta, handoverState, handoverPrompt, applyPrompt, stamp } from "./handover.js";

const labelsOf = (address) => terminals().find((t) => t.address === address)?.labels ?? {};

// hc wraps text sent from inside a Herdr terminal in <hc from=...> tags, and a wrapped "/clear" is
// read as a message, not a command. Herdr started from such a terminal would inherit its id.
export async function send(address, text) {
  const result = await exec("env", ["-u", "HC_TERMINAL_ID", "hc", "send", address, text], { timeout: 30_000 });
  if (result?.code !== 0) throw new Error((result?.stderr || "hc send failed").trim());
}

async function writeMeta(path, meta) {
  const current = await readTextFile(path);
  await writeTextFile(path, JSON.stringify(meta) + "\n", current);
}

/** { address: handoverState } for the given terminals that have a handover in progress. */
export async function scanHandovers(addresses) {
  const { dir } = handoverPaths(home(), "");
  const listing = await exec("ls", ["-1", dir], { timeout: 5_000 }).catch(() => null);
  const names = new Set(listing?.code === 0 ? listing.stdout.split("\n") : []);
  const states = {};
  for (const address of addresses) {
    if (!names.has(`${address}.json`)) continue;
    const paths = handoverPaths(home(), address);
    const meta = parseMeta(await readTextFile(paths.meta).catch(() => null));
    if (meta) states[address] = handoverState(meta, names.has(`${address}.md`), sessionKey(labelsOf(address)));
  }
  return states;
}

/** Asks the session to write its handover; an older unapplied one is replaced. */
export async function requestHandover(address) {
  const paths = handoverPaths(home(), address);
  await exec("mkdir", ["-p", paths.dir]);
  await exec("rm", ["-f", paths.md]);
  await writeMeta(paths.meta, { requested_at: Date.now(), session: sessionKey(labelsOf(address)) });
  await send(address, handoverPrompt(paths.md));
  return paths.md;
}

/** Notes a clear made from this mod, for sessions whose hooks do not relabel the terminal. */
export async function markCleared(address) {
  const paths = handoverPaths(home(), address);
  const meta = parseMeta(await readTextFile(paths.meta).catch(() => null));
  if (meta) await writeMeta(paths.meta, { ...meta, cleared_at: Date.now() });
}

/** Moves the handover out of the way (kept under applied/) and hands it to the fresh session. */
export async function applyHandover(address) {
  const paths = handoverPaths(home(), address);
  const archived = `${paths.applied}/${address}-${stamp(Date.now())}.md`;
  await exec("mkdir", ["-p", paths.applied]);
  const moved = await exec("mv", [paths.md, archived]);
  if (moved.code !== 0) throw new Error(moved.stderr.trim() || "the handover file is gone");
  await exec("rm", ["-f", paths.meta]);
  await send(address, applyPrompt(archived));
  return archived;
}
