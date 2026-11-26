// Pure: how warm a Claude conversation's prompt cache still is. Same maths as stale-cache-nudge.sh.

// Each provider's own cache lifetime, used unless "Provider cache time" is turned off.
// Claude writes its cache for 1 h or 5 min and says which in every request's usage
// (cache_creation.ephemeral_1h_input_tokens / ephemeral_5m_input_tokens); before a session has
// shown either, it counts as 1 h. OpenAI keeps a prefix at least 30 min after its last use on
// GPT-5.6 and later ("30m" default) and typically about 30 min on GPT-5.5:
// https://developers.openai.com/api/docs/guides/prompt-caching
export const PROVIDER_TTL_MS = Object.freeze({
  claude1h: 60 * 60_000,
  claude5m: 5 * 60_000,
  claudeUnknown: 60 * 60_000,
  codex: 30 * 60_000,
});

export const DEFAULTS = Object.freeze({
  ttlAuto: true, // each provider's own cache time; off uses ttlMinutes for every session
  ttlMinutes: 55, // the manual time, when ttlAuto is off
  minTokens: 80_000, // below this a rewrite is not worth a warning
  compactTokens: 200_000, // a conversation this big gets a Compact button
  toast: true,
  toastSeconds: 12,
  circle: Object.freeze({ enabled: true, hot: "#ff6b35", cold: "#4a9eff" }),
});

/** The shared keys the settings dialog and Settings > Mods write; mod.json declares the same ones. */
export const KEYS = Object.freeze({
  ttlAuto: "cache-expiry.ttlAuto",
  ttl: "cache-expiry.ttl",
  minTokens: "cache-expiry.minTokens",
  compactTokens: "cache-expiry.compactTokens",
  toast: "cache-expiry.toast",
  toastSeconds: "cache-expiry.toastSeconds",
  circles: "cache-expiry.circles",
  hot: "cache-expiry.hot",
  cold: "cache-expiry.cold",
});

export const LIMITS = Object.freeze({
  ttlMinutes: { min: 5, max: 600, step: 5 },
  minTokens: { min: 0, max: 1_000_000, step: 10_000 },
  compactTokens: { min: 50_000, max: 1_000_000, step: 25_000 },
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
    ttlAuto: bool(get(KEYS.ttlAuto), DEFAULTS.ttlAuto),
    ttlMinutes: inRange(durationMinutes(get(KEYS.ttl)), DEFAULTS.ttlMinutes, LIMITS.ttlMinutes),
    minTokens: inRange(get(KEYS.minTokens), DEFAULTS.minTokens, LIMITS.minTokens),
    compactTokens: inRange(get(KEYS.compactTokens), DEFAULTS.compactTokens, LIMITS.compactTokens),
    toast: bool(get(KEYS.toast), DEFAULTS.toast),
    toastSeconds: inRange(get(KEYS.toastSeconds), DEFAULTS.toastSeconds, LIMITS.toastSeconds),
    circle: {
      enabled: bool(get(KEYS.circles), DEFAULTS.circle.enabled),
      hot: hex(get(KEYS.hot), DEFAULTS.circle.hot),
      cold: hex(get(KEYS.cold), DEFAULTS.circle.cold),
    },
  };
}

/**
 * The shared values for what an old config.json customised: only valid values that differ from
 * the defaults. Missing, unreadable or invalid files give {}.
 */
export function legacySettings(text) {
  let raw;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const circle = raw.circle && typeof raw.circle === "object" ? raw.circle : {};
  const candidates = [
    [KEYS.ttl, { n: raw.ttlMinutes, unit: "minute" }],
    [KEYS.minTokens, raw.minTokens],
    [KEYS.toast, raw.toast],
    [KEYS.toastSeconds, raw.toastSeconds],
    [KEYS.circles, circle.enabled],
    [KEYS.hot, circle.hot],
    [KEYS.cold, circle.cold],
  ];
  const defaults = readSettings(() => undefined);
  return Object.fromEntries(candidates.filter(([key, value]) => {
    const alone = readSettings((k) => (k === key ? value : undefined));
    return JSON.stringify(alone) !== JSON.stringify(defaults);
  }));
}

/** A stepped number kept inside its limits. */
export function stepped(value, delta, { min, max }) {
  return Math.min(max, Math.max(min, value + delta));
}

/** The cache lifetime one Claude request wrote, from its usage; null when it wrote none. */
export function writtenTtlMs(usage) {
  const c = usage?.cache_creation;
  if (!c || typeof c !== "object") return null;
  if (c.ephemeral_1h_input_tokens > 0) return PROVIDER_TTL_MS.claude1h;
  if (c.ephemeral_5m_input_tokens > 0) return PROVIDER_TTL_MS.claude5m;
  return null;
}

/**
 * The newest assistant turn in a transcript tail: { at: ms, tokens, ttlMs } or null. ttlMs is the
 * lifetime of the newest cache write (a turn that only reads keeps it), null when none is in the tail.
 */
export function lastUsage(tail) {
  let last = null;
  let ttlMs = null;
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
    ttlMs = writtenTtlMs(u) ?? ttlMs;
    last = { at, tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) };
  }
  return last && { ...last, ttlMs };
}

/** The cache lifetime to count a session against: the manual time, else its provider's own. */
export function ttlMsFor(settings, app, usage) {
  if (!settings.ttlAuto) return settings.ttlMinutes * 60_000;
  if (app === "codex") return PROVIDER_TTL_MS.codex;
  return usage?.ttlMs ?? PROVIDER_TTL_MS.claudeUnknown;
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

/**
 * { cold, warm, nextColdMin } over every tracked cache, each against its own lifetime
 * (`ttlOf(usage)`); nextColdMin is null when none is warm.
 */
export function summarize(usage, now, ttlOf) {
  const left = Object.values(usage).map((u) => ttlOf(u) - (now - u.at)).filter((ms) => ms > 0)
    .map((ms) => Math.ceil(ms / 60_000));
  return {
    cold: Object.keys(usage).length - left.length,
    warm: left.length,
    nextColdMin: left.length ? Math.min(...left) : null,
  };
}

export function stripText({ cold, warm, nextColdMin }) {
  if (cold + warm === 0) return "No Claude caches tracked";
  const next = nextColdMin === null ? "" : ` · next cold in ${nextColdMin}m`;
  return `Claude cache: ${cold} cold · ${warm} warm${next}`;
}
