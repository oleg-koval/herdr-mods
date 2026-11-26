// The edge for handovers: files under ~/.local/state/herdr-handover and the prompts sent with hc.
// Lifecycle and wording live in handover.js.

import { exec, home, readTextFile, writeTextFile, terminals } from "herdr";
import {
  handoverPaths, sessionKey, parseMeta, handoverState, handoverPrompt, applyPrompt, stamp, delivered, parseProbe,
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
    if (meta) states[address] = handoverState(meta, names.has(`${address}.md`), sessionKey(labelsOf(address)), Date.now());
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

const DELIVERY_CHECKS = 15;

async function probe(address) {
  const result = await exec("hc", ["get", address, "--json"], { timeout: 5_000 }).catch(() => null);
  return result?.code === 0 ? parseProbe(result.stdout) : null;
}

// One check a second; resolves true as soon as the session reacts, false after `left` checks.
async function awaitDelivery(address, before, left) {
  if (left <= 0) return false;
  await exec("sleep", ["1"]);
  return delivered(before, await probe(address)) || awaitDelivery(address, before, left - 1);
}

/** Hands the handover to the fresh session; files it under applied/ only once the session reacted. */
export async function applyHandover(address) {
  const paths = handoverPaths(home(), address);
  const archived = `${paths.applied}/${address}-${stamp(Date.now())}.md`;
  await exec("mkdir", ["-p", paths.applied]);
  const copied = await exec("cp", [paths.md, archived]);
  if (copied.code !== 0) throw new Error(copied.stderr.trim() || "the handover file is gone");
  const before = await probe(address);
  const discard = () => exec("rm", ["-f", archived]);
  const ok = await send(address, applyPrompt(archived))
    .then(() => awaitDelivery(address, before, DELIVERY_CHECKS))
    .catch(async (error) => { await discard(); throw error; });
  if (!ok) {
    await discard();
    throw new Error("The session did not pick up the prompt. The handover is kept: press play again.");
  }
  await exec("rm", ["-f", paths.md, paths.meta]);
  return archived;
}
