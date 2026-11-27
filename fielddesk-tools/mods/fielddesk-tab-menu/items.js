// Pure: the right-click menu for one tab. No herdr imports, so node can test it.

/** The shared key the tab strip and this menu both read: ids of pinned tabs. */
export const PINNED_KEY = "fielddesk.pinned-tabs";

// The Claude session a fork starts from: the focused one in the tab, else the most recently changed.
export function forkSource(tabId, agents) {
  const claude = agents.filter((a) => a.tab === tabId && a.app === "claude-code");
  return claude.find((a) => a.focused) ?? [...claude].sort((a, b) => b.seq - a.seq)[0] ?? null;
}

/** Tabs a bulk close may end: the ones on the chosen side of `id`, never a pinned one, never `id`. */
export function closeTargets(kind, tabIds, pinned, id) {
  const at = tabIds.indexOf(id);
  if (at < 0) return [];
  const side = kind === "others" ? tabIds.filter((t) => t !== id)
    : kind === "right" ? tabIds.slice(at + 1)
    : tabIds.slice(0, at);
  return side.filter((t) => !pinned.includes(t));
}

/** Pinned tabs sit first in their space. Pinning moves the tab to the end of that group; unpinning
 *  moves it to the start of the rest. `moveTo` is a 1-based position for `tab.move`. `known` is
 *  every tab id that still exists, so ids of closed tabs drop out of the saved set. */
export function pinPlan(tabIds, pinned, id, known = tabIds) {
  const live = pinned.filter((t) => known.includes(t));
  if (live.includes(id)) {
    const rest = live.filter((t) => t !== id);
    return { pinned: rest, moveTo: tabIds.filter((t) => rest.includes(t)).length + 1 };
  }
  return { pinned: [...live, id], moveTo: tabIds.filter((t) => live.includes(t)).length + 1 };
}

export function tabMenuItems(target, agents, ctx = {}) {
  const tabIds = ctx.tabIds ?? [target.id];
  const pinned = ctx.pinned ?? [];
  const known = ctx.known ?? tabIds;
  const isPinned = pinned.includes(target.id);
  const source = forkSource(target.id, agents);
  const plan = pinPlan(tabIds, pinned, target.id, known);
  const bulk = (kind, label, icon) => {
    const ids = closeTargets(kind, tabIds, pinned, target.id);
    return { label, icon, closes: ids, disabled: ids.length === 0 };
  };
  return [
    { label: "Rename", icon: "square-pen", command: "tab.rename", args: { id: target.id } },
    { label: "New tab", icon: "plus", command: "tab.new", args: { space: target.space } },
    ...(source ? [{ label: "Fork session", icon: "git-branch", fork: { address: source.address, title: source.tab_name || source.title } }] : []),
    { label: isPinned ? "Unpin tab" : "Pin tab", icon: isPinned ? "pin-off" : "pin", pin: { value: plan.pinned, moveTo: plan.moveTo, id: target.id }, separated: true },
    { label: "Close", icon: "x", command: "tab.close", args: { id: target.id }, separated: true },
    bulk("others", "Close others", "x"),
    bulk("right", "Close to the right", "chevron-right"),
    bulk("left", "Close to the left", "chevron-left"),
  ];
}

/** The key bound to a command in keys.json, or "" (Herdr's own pseudo-key "command" is not a key). */
export function shortcutFor(bindings, command) {
  return bindings.find((b) => b.action === command && b.keys !== "command")?.keys ?? "";
}
