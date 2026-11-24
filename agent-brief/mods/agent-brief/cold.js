// Pure: is a Claude conversation's prompt cache cold? Same maths as stale-cache-nudge.sh.

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

/** { idleMin, tokens, since } when the cache has expired on a conversation worth warning about. */
export function coldness(usage, now, { staleMs, minTokens }) {
  if (!usage) return null;
  const idle = now - usage.at;
  if (idle < staleMs || usage.tokens < minTokens) return null;
  return { idleMin: Math.floor(idle / 60_000), tokens: usage.tokens, since: usage.at };
}
