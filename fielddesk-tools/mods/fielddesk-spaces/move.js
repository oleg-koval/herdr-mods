// Moves terminals between spaces. Herdr has no pane.move, so each terminal is parked
// (its pane goes, the program keeps running), then labelled into the target space, which
// adopts it as a pane. Everything outside the module comes in through `io`, so the
// sequence can be tested with a fake: { run, hc, panes, spaces, sleep }.

const TRIES = 40;
const STEP_MS = 150;

// A remote id shows as "machine/id" in the app; labels on that machine use the bare id.
const localId = (id) => id.replace(/^[^/]+\//, "");

async function until(io, check) {
  for (let i = 0; i < TRIES; i += 1) {
    const found = await check();
    if (found) return found;
    await io.sleep(STEP_MS);
  }
  return null;
}

async function core(io, args) {
  const r = await io.hc([...args, "--json"]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc ${args[0]} failed`).trim());
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
}

// Parking finishes in the background and clears the labels: labelling earlier would be wiped.
const parked = (io, terminal) => until(io, async () => {
  const labels = (await core(io, ["get", terminal])).labels ?? {};
  return !labels["herdr.space"] && !io.panes().some((pane) => pane.terminal === terminal);
});

const adopted = (io, terminal) => until(io, () => io.panes().find((pane) => pane.terminal === terminal) ?? null);

// Adopting a terminal turns core keep on; parking turned it off. Checked, not assumed.
async function keepOn(io, terminal) {
  if ((await core(io, ["get", terminal])).keep !== false) return;
  await core(io, ["keep", terminal]);
}

async function moveOne(io, terminal, target, tab) {
  io.run("terminal.park", { terminal });
  if (!await parked(io, terminal)) return { step: "park" };
  const labels = [`herdr.space=${localId(target)}`, ...(tab ? [`herdr.tab=${localId(tab)}`] : [])];
  await core(io, ["label", terminal, ...labels]);
  const pane = await adopted(io, terminal);
  if (!pane) return { step: "adopt" };
  await keepOn(io, terminal);
  return { tab: pane.tab };
}

/**
 * Moves each plan tab's terminals into the target space: the first terminal of a tab
 * opens a new tab there, the rest join it, and a named tab keeps its name.
 * Resolves { moved, failed: [{ terminal, step }] }; it never throws for one terminal.
 */
export async function moveTerminals(plan, io) {
  const target = plan.target.id;
  const done = [];
  const failed = [];
  for (const move of plan.moves) {
    let tab = null;
    for (const terminal of move.terminals) {
      try {
        const out = await moveOne(io, terminal, target, tab);
        if (out.tab) {
          done.push(terminal);
          tab = tab ?? out.tab;
        } else failed.push({ terminal, step: out.step });
      } catch (error) {
        failed.push({ terminal, step: String(error?.message ?? error).split("\n")[0] });
      }
    }
    if (tab && move.tabName) io.run("tab.rename", { id: tab, name: move.tabName });
  }
  return { moved: done.length, failed };
}

/** The source spaces still listed after a moment: closing an emptied space is Herdr's to do. */
export async function stillOpen(plan, io) {
  const ids = new Set(plan.sources.map((space) => space.id));
  const gone = await until(io, () => (io.spaces().every((space) => !ids.has(space.id)) ? true : null));
  return gone ? [] : io.spaces().filter((space) => ids.has(space.id));
}
