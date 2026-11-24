// Pure rules for the two-up mod. No herdr imports: node can test this file.
//
// agterm gave a session one shell plus one split, and everything else (lazygit, yazi, the
// scratch shell) was transient. A Herdr tab is that unit, so a tab may hold two terminals.

export const MAX_TERMINALS = 2;

// A login shell does not read .zshrc, which is where ~/bin joins PATH: without it every
// ~/bin script these keys start is "command not found".
const SHELL = (cmd) => ["zsh", "-lc", `PATH="$HOME/bin:$PATH"; ${cmd}`];
const SHELL_THEN_WAIT = (cmd, note) => SHELL(`${cmd}; read -k1 '?${note}'`);

// Key action name (keys.json: "two-up.<name>") -> what it does. `kind` picks the route:
//   split   an empty shell beside the focused pane
//   program a program beside the focused pane; over the cap it opens in a window instead
//   exec    a program that starts no terminal (never counts against the cap)
//   window  a program that always opens in a movable window: a dashboard, not a companion
export const ACTIONS = {
  right: { kind: "split", direction: "right" },
  down: { kind: "split", direction: "down" },
  lazygit: { kind: "program", direction: "right", argv: ["lazygit"] },
  yazi: { kind: "program", direction: "right", argv: ["yazi"] },
  day: { kind: "program", direction: "down", argv: SHELL_THEN_WAIT("herdr-day.sh", "any key closes") },
  compact: { kind: "program", direction: "down", argv: SHELL_THEN_WAIT("herdr-compact-idle", "any key closes") },
  revive: { kind: "program", direction: "down", argv: SHELL_THEN_WAIT("claude-revive", "dry run; any key closes") },
  finder: { kind: "exec", argv: ["open"] },
  mem: { kind: "window", argv: SHELL_THEN_WAIT("herdr-session-mem", "any key closes") },
  prs: { kind: "window", argv: SHELL("pr-autoreview status | less -R") },
  busy: { kind: "window", argv: SHELL("herdr-busy") },
};

export const countTerminals = (panes, tab) =>
  panes.filter((p) => p.tab === tab && p.terminal != null).length;

export const decide = (count, max = MAX_TERMINALS) => (count < max ? "allow" : "refuse");

// Tabs above the cap by any route (menus, pane headers, hc), for the backstop warning.
export const overCap = (panes, max = MAX_TERMINALS) => {
  const counts = new Map();
  for (const p of panes) {
    if (p.terminal != null) counts.set(p.tab, (counts.get(p.tab) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > max).map(([tab, count]) => ({ tab, count }));
};

// argv for `hc run`: detached, removed on exit, no parent so it is not a sub-agent of anything.
export const popupArgs = (cwd, argv) => [
  "run", "--json", "--bg", "--no-parent", "--rm", "--no-notify",
  ...(cwd ? ["--cwd", cwd] : []), "--", ...argv,
];

// Window layout: a title bar (this mod, role "bar") over the terminal.
export const popupLayout = (terminal, title) => ({
  type: "column",
  children: [
    { type: "block", size: { px: 28 }, content: { mod: "two-up", props: { role: "bar", terminal, title } } },
    { type: "block", content: { terminal } },
  ],
});

export const refusal = (count, max = MAX_TERMINALS) => ({
  title: `${count} of ${max} terminals in this tab`,
  body: "A tab is one piece of work: the agent and one companion. Cmd-T opens a new tab.",
});
