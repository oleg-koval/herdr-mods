// Pure: the handover lifecycle of one terminal. A handover is a Markdown file the session writes
// about itself before a clear, applied to the fresh conversation after it.
//   requested: the meta file exists, the Markdown file not yet (the session is writing it)
//   saved:     both exist; ready once the conversation was cleared after the request
// "Cleared" means the conversation id on the terminal changed since the request (Claude's
// SessionStart hook relabels claude.session on /clear; the Codex hook relabels
// codex.cache.session), or this mod's Clear button marked it.

export const HANDOVER_DIR = ".local/state/herdr-handover";
export const SHARED_KEY = "cache-expiry.handover";

export function handoverPaths(home, address) {
  const dir = `${home}/${HANDOVER_DIR}`;
  return { dir, md: `${dir}/${address}.md`, meta: `${dir}/${address}.json`, applied: `${dir}/applied` };
}

/** The conversation id a terminal's hooks put on it, or null. */
export function sessionKey(labels) {
  const id = labels?.["claude.session"] ?? labels?.["codex.cache.session"];
  return typeof id === "string" && id ? id : null;
}

export function parseMeta(text) {
  try {
    const meta = JSON.parse(text);
    return meta && typeof meta === "object" && typeof meta.requested_at === "number" ? meta : null;
  } catch {
    return null;
  }
}

/** { requested, saved, cleared, ready } for one terminal. */
export function handoverState(meta, mdExists, key) {
  if (!meta) return { requested: false, saved: false, cleared: false, ready: false };
  const cleared = typeof meta.cleared_at === "number" ||
    (Boolean(meta.session) && Boolean(key) && key !== meta.session);
  const saved = Boolean(mdExists);
  return { requested: !saved, saved, cleared, ready: saved && cleared };
}

export function handoverPrompt(path) {
  return `Write a handover for the next session to ${path} (overwrite it). Markdown, at most 60 lines: ` +
    "1) Goal. 2) State now: what is done, with receipts (branch, PR and ticket URLs, commits). " +
    "3) Decisions and constraints worth keeping. 4) Leftover tasks as a checklist. 5) The exact next step. " +
    "Start no new work. When the file is written, reply only: handover saved.";
}

export function applyPrompt(path) {
  return `Read the handover at ${path}, which the previous session in this tab wrote before it was cleared. ` +
    "Treat it as your starting context: restate the goal and leftover tasks in a few lines, then do the next step it names.";
}

/** "20261125-163012" for an archived handover's file name. */
export function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
