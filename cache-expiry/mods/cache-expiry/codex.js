export function codexSamples(agents, terminals, localSamples = {}) {
  const labels = Object.fromEntries(terminals.map((terminal) => [terminal.address, terminal.labels]));
  const codex = agents.filter((agent) => agent.app === "codex");
  const samples = {};
  for (const { address } of codex) {
    const local = localSamples[address];
    if (local) samples[address] = local;
    const session = labels[address]?.["codex.cache.session"];
    const report = labels[address]?.["codex.cache.usage"];
    if (typeof session !== "string" || !session || typeof report !== "string") continue;
    // session:input:cached[:at], at (ms) added by newer hooks
    const match = /^([0-9a-f-]+):([0-9]+):([0-9]+)(?::([0-9]+))?$/i.exec(report);
    if (!match || match[1] !== session) continue;
    const input = Number(match[2]);
    const cached = Number(match[3]);
    const at = match[4] === undefined ? null : Number(match[4]);
    if (Number.isSafeInteger(input) && Number.isSafeInteger(cached) && input > 0 && cached <= input) {
      samples[address] = Number.isSafeInteger(at) && at > 0 ? { input, cached, at } : { input, cached };
    }
  }
  return { count: codex.length, samples };
}

export const hitRate = (cached, input) => Math.round((100 * cached) / input);

export function codexStripText({ count, samples }) {
  if (!count) return "";
  const values = Object.values(samples);
  const input = values.reduce((sum, value) => sum + value.input, 0);
  const cached = values.reduce((sum, value) => sum + value.cached, 0);
  const rate = input ? ` · ${hitRate(cached, input)}% hit` : "";
  return `Codex: ${values.length}/${count} sampled${rate}`;
}
