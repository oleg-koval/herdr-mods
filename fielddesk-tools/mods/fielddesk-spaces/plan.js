// Pure: selection, expansion, rename, merge plan and confirm text for the spaces list.
// Nothing here reads Herdr or runs a command; main.js and move.js do that.

const machineOf = (space) => space.machine ?? null;
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Ids with `id` added, or removed when already there. */
export function toggleSelected(selected, id) {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/** The selected ids that still exist, in list order (stored ids can outlive their space). */
export function liveSelection(selected, spaces) {
  return spaces.filter((space) => selected.includes(space.id)).map((space) => space.id);
}

/** "none", "some" or "all" of the listed spaces are selected. */
export function selectState(selected, spaces) {
  const live = liveSelection(selected, spaces).length;
  if (live === 0) return "none";
  return live === spaces.length ? "all" : "some";
}

/** Everything selected, unless it already is: then nothing. */
export function toggleAllSelected(selected, spaces) {
  return selectState(selected, spaces) === "all" ? [] : spaces.map((space) => space.id);
}

/** Expansion by space id; only expanded spaces are stored, so a closed space leaves no entry. */
export function isExpanded(expanded, id) {
  return expanded?.[id] === true;
}

export function toggleExpanded(expanded, id) {
  const { [id]: was, ...rest } = expanded ?? {};
  return was === true ? rest : { ...rest, [id]: true };
}

export function expandAll(spaces) {
  return Object.fromEntries(spaces.map((space) => [space.id, true]));
}

/** The one header button: collapse while anything is open, else expand. */
export function allToggleLabel(expanded, spaces) {
  return spaces.some((space) => isExpanded(expanded, space.id)) ? "Collapse all" : "Expand all";
}

export function renamed(name, prefix, suffix) {
  return `${prefix}${name}${suffix}`;
}

/** What each selected space becomes; spaces whose name would not change are left out. */
export function renamePlan(spaces, ids, prefix, suffix) {
  return spaces
    .filter((space) => ids.includes(space.id))
    .map((space) => ({ id: space.id, from: space.name, name: renamed(space.name, prefix, suffix) }))
    .filter((item) => item.name !== item.from);
}

/**
 * Merge the selected spaces into the first one in list order. A terminal moves by
 * its own address, so only tabs with terminal panes can move; mod-only tabs stay.
 * A space on another machine can't give its terminals to this one.
 */
export function planMerge(spaces, panes, ids) {
  const [target, ...rest] = spaces.filter((space) => ids.includes(space.id));
  if (!target) return { target: null, sources: [], moves: [], skipped: [], stranded: 0 };
  const sources = rest.filter((space) => machineOf(space) === machineOf(target));
  const skipped = rest.filter((space) => machineOf(space) !== machineOf(target));
  const tabsOf = sources.flatMap((space) => space.tabs.map((tab) => ({ space: space.id, tab })));
  const withTerminals = tabsOf.map(({ space, tab }) => ({
    space,
    tab,
    terminals: panes.filter((pane) => pane.tab === tab.id && pane.terminal).map((pane) => pane.terminal),
  }));
  return {
    target,
    sources,
    skipped,
    moves: withTerminals
      .filter((entry) => entry.terminals.length)
      .map(({ space, tab, terminals }) => ({ space, tabName: tab.named ? tab.name : null, terminals })),
    stranded: withTerminals.filter((entry) => !entry.terminals.length).length,
  };
}

/** Counts for confirm text: spaces, tabs, terminals with a pane, live agents (and how many work). */
export function tally(spaces, panes, agents, ids) {
  const chosen = spaces.filter((space) => ids.includes(space.id));
  const tabIds = new Set(chosen.flatMap((space) => space.tabs.map((tab) => tab.id)));
  const mine = agents.filter((agent) => ids.includes(agent.space));
  return {
    spaces: chosen.length,
    tabs: tabIds.size,
    terminals: panes.filter((pane) => pane.terminal && tabIds.has(pane.tab)).length,
    agents: mine.length,
    working: mine.filter((agent) => agent.status === "working").length,
  };
}

function agentsText(t, verb) {
  if (!t.agents) return "No live agents.";
  const working = t.working ? ` (${t.working} working)` : "";
  return `${count(t.agents, "live agent")}${working} ${verb}.`;
}

function namesText(spaces) {
  const names = spaces.map((space) => `“${space.name}”`);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
}

/** `plan`: from planMerge; `t`: the tally of its source spaces. */
export function mergeConfirm(plan, t) {
  const terminals = plan.moves.reduce((sum, move) => sum + move.terminals.length, 0);
  const notes = [
    plan.stranded ? `${count(plan.stranded, "tab")} with no terminal stays and goes with its space.` : "",
    plan.skipped.length ? `${count(plan.skipped.length, "space")} on another machine ${plan.skipped.length === 1 ? "isn't" : "aren't"} merged.` : "",
  ];
  return {
    title: `Merge ${count(plan.sources.length, "space")} into “${plan.target.name}”?`,
    detail: [
      `Moves ${count(plan.moves.length, "tab")} (${count(terminals, "terminal")}) from ${namesText(plan.sources)}.`,
      `${agentsText(t, "move")} Programs keep running; split layouts are not kept.`,
      ...notes,
    ].filter(Boolean).join(" "),
  };
}

export function closeConfirm(t) {
  return {
    title: `Close ${count(t.spaces, "space")}?`,
    detail: `Ends ${count(t.tabs, "tab")} and ${count(t.terminals, "terminal")}. ${agentsText(t, "stop")} This can't be undone.`,
  };
}

/** The toast after a merge: `result` is move.js's { moved, failed, tabs }, `remaining` the source spaces still listed. */
export function mergeSummary(plan, result, remaining) {
  const total = plan.moves.reduce((sum, move) => sum + move.terminals.length, 0);
  const clean = !result.failed.length && !remaining.length;
  const lines = [
    `Moved ${result.moved} of ${count(total, "terminal")} into “${plan.target.name}”.`,
    result.failed.length ? `Not moved: ${result.failed.map((f) => `${f.terminal} (${f.step})`).join(", ")}. They still run; see \`hc ls\`.` : "",
    remaining.length ? `Still open: ${remaining.map((space) => `“${space.name}”`).join(", ")}.` : "",
  ];
  return {
    title: clean ? "Spaces merged" : "Merge finished with problems",
    body: lines.filter(Boolean).join(" "),
    level: clean ? "success" : "warning",
  };
}

export function tabLabel(tab) {
  return tab.named ? tab.name : `Tab ${tab.name}`;
}

/** After the name: the machine a space lives on, else its branch unless it is the usual one. */
export function rowTail(space) {
  if (space.machine) return space.machine;
  const branch = space.branch ?? "";
  return branch === "main" || branch === "master" ? "" : branch;
}

/** Only a space or tab that needs you gets a mark. */
export function needsYou(status) {
  return status === "blocked" || status === "done";
}

const EMOJI_START = /^\p{Extended_Pictographic}️?/u;

/** The avatar's letter: a leading emoji whole, else the first character in capitals. */
export function avatarLetter(name) {
  return EMOJI_START.exec(name)?.[0] ?? ([...name][0]?.toUpperCase() ?? "?");
}

const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

/** A stored colour (a theme name or hex), else one by position so neighbours differ. */
export function avatarColor(stored, index, colors) {
  const pick = stored ?? PALETTE[index % PALETTE.length];
  return pick.startsWith("#") ? pick : (colors[pick] ?? colors.accent);
}
