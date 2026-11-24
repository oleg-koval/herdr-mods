// Pure: how warm a Claude conversation's prompt cache still is. Same maths as stale-cache-nudge.sh.

export const DEFAULTS = Object.freeze({
  ttlMinutes: 55, // just under the 1 h prompt-cache TTL: the cache is cold from here on
  minTokens: 80_000, // below this a rewrite is not worth a warning
  toast: true,
  toastSeconds: 12,
  circle: Object.freeze({ enabled: true, hot: "#ff6b35", cold: "#4a9eff" }),
});

/** The shared keys the settings dialog and Settings > Mods write; mod.json declares the same ones. */
export const KEYS = Object.freeze({
  ttl: "cache-expiry.ttl",
  minTokens: "cache-expiry.minTokens",
  toast: "cache-expiry.toast",
  toastSeconds: "cache-expiry.toastSeconds",
  circles: "cache-expiry.circles",
  hot: "cache-expiry.hot",
  cold: "cache-expiry.cold",
});

export const LIMITS = Object.freeze({
  ttlMinutes: { min: 5, max: 600, step: 5 },
  minTokens: { min: 0, max: 1_000_000, step: 10_000 },
  toastSeconds: { min: 3, max: 60, step: 1 },
});

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const UNIT_MINUTES = { minute: 1, hour: 60 };

/** Minutes from a Herdr duration setting ({ n, unit }), or a bare number of minutes; else null. */
export function durationMinutes(v) {
  if (typeof v === "number") return v;
  if (!v || typeof v !== "object" || !(v.unit in UNIT_MINUTES)) return null;
  const n = Number(v.n);
  return Number.isFinite(n) ? n * UNIT_MINUTES[v.unit] : null;
}

/** The settings in force: each stored value over DEFAULTS. Unset or invalid values use the default. */
export function readSettings(get) {
  const inRange = (v, d, { min, max }) => (typeof v === "number" && v >= min && v <= max ? v : d);
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  const hex = (v, d) => (typeof v === "string" && HEX.test(v) ? v : d);
  return {
    ttlMinutes: inRange(durationMinutes(get(KEYS.ttl)), DEFAULTS.ttlMinutes, LIMITS.ttlMinutes),
    minTokens: inRange(get(KEYS.minTokens), DEFAULTS.minTokens, LIMITS.minTokens),
    toast: bool(get(KEYS.toast), DEFAULTS.toast),
    toastSeconds: inRange(get(KEYS.toastSeconds), DEFAULTS.toastSeconds, LIMITS.toastSeconds),
    circle: {
      enabled: bool(get(KEYS.circles), DEFAULTS.circle.enabled),
      hot: hex(get(KEYS.hot), DEFAULTS.circle.hot),
      cold: hex(get(KEYS.cold), DEFAULTS.circle.cold),
    },
  };
}

/** A stepped number kept inside its limits. */
export function stepped(value, delta, { min, max }) {
  return Math.min(max, Math.max(min, value + delta));
}

/** The newest assistant turn in a transcript tail: { at: ms, tokens } or null. */
export function lastUsage(tail) {
  let last = null;
  for (const line of String(tail).split("\n")) {
    if (!line.includes('"usage"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const u = row?.message?.role === "assistant" ? row.message.usage : null;
    const at = Date.parse(row?.timestamp ?? "");
    if (!u || Number.isNaN(at)) continue;
    last = { at, tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) };
  }
  return last;
}

/** 0 when the newest turn just finished, 1 once it is ttlMs old; null when there is no usage. */
export function heatOf(usage, now, ttlMs) {
  if (!usage || !(ttlMs > 0)) return null;
  return Math.min(1, Math.max(0, (now - usage.at) / ttlMs));
}

/** { idleMin, tokens, since } when the cache has expired on a conversation big enough to warn about. */
export function coldness(usage, now, { ttlMs, minTokens }) {
  if (!usage) return null;
  const idle = now - usage.at;
  if (idle < ttlMs || usage.tokens < minTokens) return null;
  return { idleMin: Math.floor(idle / 60_000), tokens: usage.tokens, since: usage.at };
}

/** "#rrggbb" blended from `hot` (t = 0) to `cold` (t = 1). */
export function mixHex(hot, cold, t) {
  const a = rgb(hot);
  const b = rgb(cold);
  const k = Math.min(1, Math.max(0, t));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join("");
}

function rgb(hex) {
  if (!HEX.test(hex)) throw new Error(`not a #rgb or #rrggbb colour: ${hex}`);
  const s = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/**
 * Folds one transcript read into { usage, seqs }. Reads overlap (the minute scan, a focus, a status
 * change), so a read that started before the one already applied is dropped. "failed" (tail timed
 * out or errored) keeps the last known usage; "absent" (no transcript, or no assistant turn) clears it.
 */
export function applyRead(state, address, seq, result) {
  if (seq <= (state.seqs[address] ?? 0)) return state;
  const seqs = { ...state.seqs, [address]: seq };
  if (result.state === "ok") return { usage: { ...state.usage, [address]: result.usage }, seqs };
  if (result.state === "absent") {
    const { [address]: _gone, ...usage } = state.usage;
    return { usage, seqs };
  }
  return { usage: state.usage, seqs };
}

/** Drops terminals that are no longer Claude agents. */
export function keepOnly(state, addresses) {
  const keep = new Set(addresses);
  const pick = (map) => Object.fromEntries(Object.entries(map).filter(([address]) => keep.has(address)));
  return { usage: pick(state.usage), seqs: pick(state.seqs) };
}

/** { cold, warm, nextColdMin } over every tracked cache; nextColdMin is null when none is warm. */
export function summarize(usage, now, ttlMs) {
  const idles = Object.values(usage).map((u) => now - u.at);
  const left = idles.filter((idle) => idle < ttlMs).map((idle) => Math.ceil((ttlMs - idle) / 60_000));
  return {
    cold: idles.length - left.length,
    warm: left.length,
    nextColdMin: left.length ? Math.min(...left) : null,
  };
}

export function stripText({ cold, warm, nextColdMin }) {
  if (cold + warm === 0) return "No Claude caches tracked";
  const next = nextColdMin === null ? "" : ` · next cold in ${nextColdMin}m`;
  return `Claude cache: ${cold} cold · ${warm} warm${next}`;
}
