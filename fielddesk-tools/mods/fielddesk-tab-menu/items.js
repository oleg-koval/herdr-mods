// Pure: the right-click menu for one tab. No herdr imports, so node can test it.

// The Claude session a fork starts from: the focused one in the tab, else the most recently changed.
export function forkSource(tabId, agents) {
  const claude = agents.filter((a) => a.tab === tabId && a.app === "claude-code");
  return claude.find((a) => a.focused) ?? [...claude].sort((a, b) => b.seq - a.seq)[0] ?? null;
}

export function tabMenuItems(target, agents) {
  const source = forkSource(target.id, agents);
  return [
    { label: "Rename", icon: "square-pen", command: "tab.rename", args: { id: target.id } },
    { label: "New tab", icon: "plus", command: "tab.new", args: { space: target.space } },
    ...(source ? [{ label: "Fork session", icon: "git-branch", fork: { address: source.address, title: source.tab_name || source.title } }] : []),
    { label: "Close", icon: "x", command: "tab.close", args: { id: target.id }, separated: true },
  ];
}

/** The key bound to a command in keys.json, or "" (Herdr's own pseudo-key "command" is not a key). */
export function shortcutFor(bindings, command) {
  return bindings.find((b) => b.action === command && b.keys !== "command")?.keys ?? "";
}
