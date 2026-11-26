// The edge for handovers: files under ~/.local/state/herdr-handover and the prompts sent with hc.
// Lifecycle and wording live in handover.js.

import { exec, home, readTextFile, writeTextFile, terminals } from "herdr";
import {
  handoverPaths, sessionKey, parseMeta, handoverState, handoverPrompt, applyPrompt, stamp, delivered, parseProbe,
  lockIsLive, DELIVERY_MS,
} from "./handover.js";

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
    const applying = names.has(`${address}.applying`) && await liveLock(paths.lock);
    if (meta) {
      states[address] = handoverState(meta, names.has(`${address}.md`), sessionKey(labelsOf(address)), Date.now(), applying);
    }
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

async function liveLock(path) {
  const result = await exec("stat", ["-f", "%m", path], { timeout: 5_000 }).catch(() => null);
  return result?.code === 0 && lockIsLive(Number(result.stdout.trim()), Date.now());
}

// mkdir is atomic, so only one apply per terminal gets the lock; a stale one is replaced once.
async function takeLock(path) {
  if ((await exec("mkdir", [path])).code === 0) return true;
  if (await liveLock(path)) return false;
  await exec("rmdir", [path]);
  return (await exec("mkdir", [path])).code === 0;
}

async function probe(address, timeout) {
  const result = await exec("hc", ["get", address, "--json"], { timeout }).catch(() => null);
  return result?.code === 0 ? parseProbe(result.stdout) : null;
}

// One check a second until the session reacts (true) or the deadline passes (false).
async function awaitDelivery(address, before, deadline) {
  await exec("sleep", ["1"]);
  const left = deadline - Date.now();
  if (left <= 0) return false;
  return delivered(before, await probe(address, Math.min(5_000, left))) || awaitDelivery(address, before, deadline);
}

// The archived copy is never deleted: a prompt that lands after the deadline still needs its file.
async function deliver(paths, address) {
  const archived = `${paths.applied}/${address}-${stamp(Date.now())}.md`;
  await exec("mkdir", ["-p", paths.applied]);
  const copied = await exec("cp", [paths.md, archived]);
  if (copied.code !== 0) throw new Error(copied.stderr.trim() || "the handover file is gone");
  const before = await probe(address, 5_000);
  await send(address, applyPrompt(archived));
  if (!(await awaitDelivery(address, before, Date.now() + DELIVERY_MS))) {
    throw new Error("The session did not react within 15 s. The handover is kept; check the tab before pressing play again.");
  }
  const removed = await exec("rm", ["-f", paths.md, paths.meta]);
  if (removed.code !== 0) throw new Error(`Applied, but the handover could not be removed: ${removed.stderr.trim()}`);
  return archived;
}

/** Hands the handover to the fresh session; it counts as applied only once the session reacted. */
export async function applyHandover(address) {
  const paths = handoverPaths(home(), address);
  if (!(await takeLock(paths.lock))) throw new Error("A handover is already being applied to this tab.");
  try {
    return await deliver(paths, address);
  } finally {
    await exec("rmdir", [paths.lock]);
  }
}
