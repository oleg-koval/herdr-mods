export const STALE_MS = 60 * 60 * 1000;
const STATES = { working: "live", blocked: "blocked", error: "blocked", idle: "idle", done: "done" };
const recordKey = (address, id) => JSON.stringify([address, id]);
const terminalName = (t) => t?.name || t?.title || t?.address;

function workerStatus(state, process) {
  if (process === "finished") return "done";
  return Object.hasOwn(STATES, state) ? STATES[state] : "live";
}

export function workerRows(terms, agents) {
  const byAddress = new Map(terms.map((t) => [t.address, t]));
  const listed = new Map(agents.map((a) => [a.address, a]));
  const nameOf = (id) => listed.get(id)?.tab_name || terminalName(byAddress.get(id)) || id;
  return terms.flatMap((t) => {
    const ownerOpen = t.state === "live" ? (listed.has(t.address) ? "agent.focus" : "terminal.peek") : null;
    const terminal = t.parent ? [{
      id: JSON.stringify([t.address, t.created_ms]), key: t.address, parentKey: t.parent,
      target: t.address, name: terminalName(t),
      parent: nameOf(t.parent), status: workerStatus(t.status, t.state), command: ownerOpen,
      detail: t.state === "live" && !t.status ? "No status reported" : t.address,
    }] : [];
    const reports = t.state === "live" ? Object.entries(t.records ?? {}).flatMap(([id, record]) =>
      record?.state ? [{
        id: JSON.stringify([t.address, t.created_ms, id]), key: recordKey(t.address, id),
        parentKey: t.records[id.slice(0, id.lastIndexOf("/"))]?.state && id.includes("/")
          ? recordKey(t.address, id.slice(0, id.lastIndexOf("/"))) : t.address,
        target: t.address, name: record.title || id.split("/").at(-1) || id,
        parent: nameOf(t.address), status: workerStatus(record.state), command: ownerOpen, detail: "In session",
      }] : []) : [];
    return [...terminal, ...reports];
  });
}

export function lineageRows(agents, workers) {
  const keys = new Set(workers.map((row) => row.key));
  const roots = agents.filter((a) => !keys.has(a.address)).map((a) => ({
    key: a.address, name: a.tab_name || a.title || "Agent", detail: a.space_name,
    status: workerStatus(a.status), command: "agent.focus", target: a.address, focused: a.focused,
  }));
  const known = new Set([...keys, ...roots.map((row) => row.key)]);
  const missing = new Map(workers.filter((row) => !known.has(row.parentKey)).map((row) => [row.parentKey, row.parent]));
  const anchors = [...missing].map(([key, name]) => ({ key, name, status: "unknown", detail: "Parent status unavailable" }));
  const children = new Map();
  for (const row of workers) children.set(row.parentKey, [...(children.get(row.parentKey) ?? []), row]);
  const seen = new Set();
  const walk = (row, guides = [], branch = null) => {
    if (seen.has(row.key)) return [];
    seen.add(row.key);
    const kids = children.get(row.key) ?? [];
    const next = branch ? [...guides, branch === "tee"] : guides;
    return [{ ...row, guides, branch }, ...kids.flatMap((kid, i) => walk(kid, next, i === kids.length - 1 ? "elbow" : "tee"))];
  };
  return [...roots, ...anchors, ...workers].flatMap((row) => walk(row));
}

export function withIdleAge(rows, previous, now) {
  const idleSince = new Map(rows.filter((row) => row.status === "idle")
    .map((row) => [row.id, previous.get(row.id) ?? now]));
  return { idleSince, rows: rows.map((row) => {
    const minutes = Math.floor((now - (idleSince.get(row.id) ?? now)) / 60_000);
    return minutes >= STALE_MS / 60_000 ? { ...row, status: "stale", detail: `Idle ${minutes}m` } : row;
  }) };
}
