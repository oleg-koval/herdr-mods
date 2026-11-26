// Pure: one temperature row per Claude or Codex agent, from the heat this mod publishes.
// Temperature runs from 0 (hot, just used) to 1 (cold); null means no sample yet.

import { heatOf, mixHex } from "./cold.js";

const APPS = { "claude-code": "Claude", codex: "Codex" };
// Codex starts a new conversation with /new; Claude with /clear. Both compact with /compact.
const CLEAR = { "claude-code": "/clear", codex: "/new" };
const CLEARABLE = new Set(["idle", "done"]);

/** "12m", "2h 5m", "3d" */
export function idleText(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

// Against the session's own cache lifetime (heat's ttlMs), or `fallbackMs` for heat published
// before it carried one.
function timedRow(h, now, fallbackMs) {
  const ttlMs = typeof h.ttlMs === "number" ? h.ttlMs : fallbackMs;
  const temp = heatOf({ at: h.at }, now, ttlMs);
  const idleMin = Math.floor((now - h.at) / 60_000);
  const left = Math.ceil((ttlMs - (now - h.at)) / 60_000);
  return { temp, detail: temp < 1 ? `warm · cold in ${idleText(left)}` : `cold · idle ${idleText(idleMin)}` };
}

function claudeRow(h, now, fallbackMs) {
  if (typeof h?.at !== "number") return { temp: null, detail: "no turn recorded yet" };
  return timedRow(h, now, fallbackMs);
}

// Timed when the sample says when the request ran; else the cache-hit rate, as before.
function codexRow(h, now, fallbackMs) {
  if (typeof h?.codexHit !== "number") return { temp: null, detail: "no cache sample yet" };
  if (typeof h.at !== "number") return { temp: 1 - h.codexHit / 100, detail: `${h.codexHit}% cached on the last request` };
  const timed = timedRow(h, now, fallbackMs);
  return { temp: timed.temp, detail: `${timed.detail} · ${h.codexHit}% cached` };
}

/** "246k" */
export const kTokens = (n) => `${Math.round(n / 1000)}k`;

/** Rows for every Claude and Codex agent, hottest first; agents without a sample go last. */
export function sessionRows(agents, heat, now, { ttlMinutes, hot, cold, compactTokens = Infinity }) {
  const ttlMs = ttlMinutes * 60_000;
  const rows = agents.filter((a) => a.app in APPS).map((a) => {
    const h = heat?.[a.address];
    const { temp, detail } = a.app === "codex" ? codexRow(h, now, ttlMs) : claudeRow(h, now, ttlMs);
    // Context: the input of the newest request (Claude: input + cache reads + cache writes).
    const context = typeof h?.tokens === "number" ? h.tokens : null;
    return {
      address: a.address,
      app: APPS[a.app],
      where: `${a.space_name} / ${a.tab_name || a.title}`,
      status: a.status,
      focused: Boolean(a.focused),
      temp,
      color: temp === null ? null : mixHex(hot, cold, temp),
      detail,
      clear: CLEAR[a.app],
      clearable: CLEARABLE.has(a.status),
      context,
      large: context !== null && context >= compactTokens,
    };
  });
  return rows.sort((a, b) => (a.temp ?? 2) - (b.temp ?? 2));
}

/** "2 warm · 3 cold · 1 unsampled" over the rows. */
export function rowsSummary(rows) {
  const warm = rows.filter((r) => r.temp !== null && r.temp < 1).length;
  const cold = rows.filter((r) => r.temp === 1).length;
  const none = rows.filter((r) => r.temp === null).length;
  if (!rows.length) return "No Claude or Codex sessions open";
  return [`${warm} warm`, `${cold} cold`, none ? `${none} unsampled` : ""].filter(Boolean).join(" · ");
}
