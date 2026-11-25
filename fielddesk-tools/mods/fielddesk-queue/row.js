// Pure: what one queue row says beyond its name.

/** The row's second line: the space, then the session's one-line context when it has one. */
export function rowDetail(spaceName, context) {
  const note = typeof context === "string" ? context.trim() : "";
  return [spaceName, note].filter(Boolean).join(" · ");
}

/**
 * The cache dot for an agent, from Cache Expiry's shared("cache-expiry.heat") entry, or null.
 * Only idle and done agents get one: a working agent's cache is in use, not cooling.
 */
export function cacheDot(heat, status) {
  if (!heat?.color || (status !== "idle" && status !== "done")) return null;
  const state = heat.cold ? "Cache expired" : "Cache warm";
  return { color: heat.color, tooltip: `${state} · idle ${heat.idleMin} min` };
}
