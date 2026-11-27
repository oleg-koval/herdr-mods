# Fielddesk Tools

Follow agents from a queue, inspect their session tree and copy a handoff without leaving the terminal. The toolbar shows the repository, offers quick actions and displays local Jev dashboard status.

![Native toolbar detail with a connected Jev indicator](preview.png)

Copy each folder under [mods](mods/) into your Herdr app's `mods/` directory. For the complete arrangement, use [Fielddesk](https://github.com/oleg-koval/herdr-layouts/tree/main/fielddesk).

- `fielddesk-repo` is a 36 px toolbar. It offers New task, Copy path and Toggle desk panel. Hover the dot for the dashboard status. It probes only `127.0.0.1:8791` using curl and makes no model requests. If the layout's side panel stack (`panel-body`) has a block with id `prs` (a pull-request list) or `review` (for example the [PR Review](../pr-review/RECIPE.md) board with `props: { "role": "board" }`), the toolbar adds a Pull requests or Review queue button that opens and closes it.
- `fielddesk-task` creates or reopens a Git worktree for a named task. It runs Git in the selected workspace and opens a terminal there after creation.
- `fielddesk-queue` orders agents by attention status. Selecting an agent focuses its pane or previews its terminal. Under each name it shows the space and the session's one-line context (the `herdr_context_label` label, `herdr.context` by default). With [Cache Expiry](../cache-expiry/README.md) installed, idle and done agents get a small dot that cools from hot to cold with their prompt cache; hover it for the idle time.
- `fielddesk-attention` shows the session tree and worker status. It reads Herdr's reported state and never starts workers.
- `fielddesk-tab-menu` is a tab right-click menu: Rename, New tab, Fork session, Pin tab / Unpin tab, Close, Close others, Close to the right and Close to the left. Fork session appears on a tab with a Claude session and opens the `thread-fork` dialog for it (install that mod too). Pinning moves the tab to the front of its space and records its id in the shared key `fielddesk.pinned-tabs`; the bulk closes never close pinned tabs. Closing calls `tab.close` per tab, so Herdr's own prompt for live agents still applies.
- `patches/fielddesk-tabs.patch` makes a tab strip that uses that menu and shows pinned tabs (a pin icon, no close button, a divider after the group, drags kept inside their group). Herdr's tab strip always opens its own `menu` and knows nothing of pins, so this is a patch on a copy of Herdr's `tabs` mod, not a mod of its own; it carries only our changes and works on whichever `tabs` version you have. Make the copy and apply it:

  ```sh
  herdr-app do mod.clone '{"name":"tabs","as":"fielddesk-tabs"}'
  cd ~/.config/herdr-app/mods/fielddesk-tabs
  patch -p1 < /path/to/herdr-mods/fielddesk-tools/patches/fielddesk-tabs.patch
  ```

  Then set `"mod": "fielddesk-tabs"` for the tab strip block in your layout (the published [Fielddesk](https://github.com/oleg-koval/herdr-layouts/tree/main/fielddesk) layout uses Herdr's own `tabs` there, so change it). If `patch` rejects a hunk after a Herdr update, re-clone `tabs` and apply the patch to the fresh copy; the hunks are small and touch only the right-click, the tab item, the drag and the strip's children.
- `fielddesk-handoff` shows session context and copies a handoff note on request. It reads the `herdr.context` terminal label by default. Set `herdr_context_label` in Herdr's `settings.json` to use an existing label.
- `fielddesk-spaces` replaces Herdr's built-in `spaces` block (`"content": { "mod": "fielddesk-spaces" }` in the layout). Each space expands to its tabs; the header has a select-all box and one Expand all / Collapse all button, and a box appears on a row's avatar on hover. With spaces selected, a bar offers Rename (prefix and suffix), Merge (every tab of the other spaces moves into the first selected one, by parking each terminal and labelling it into that space, so programs keep running but split layouts are not kept) and Close. Merge and Close ask first through Herdr's `confirm` mod with space, tab and live-agent counts. It leaves out the built-in's machine groups, worktree nesting, drag reordering and rail mode.
- The spaces header's `+` opens New space (right-click it for a blank space; `fielddesk-spaces.new` opens it from a key). Type a name, search your GitHub repos through `gh` (cached 6 hours in `~/.cache/fielddesk/repos.json`), type or paste a first message and drop or paste files, then pick the agent by its logo. Create opens the space in the repo's checkout, or clones it first; with no repo it starts in `~/.herdr/threads`. Terminal starts a plain shell and sends nothing. Which repos and folders is set in Herdr's `settings.json`; without it you get your own repos, found in and cloned to `~/code`:

  ```json
  "fielddesk_repos": {
    "owners": ["my-org", "my-user"],
    "scan": ["~/code", "~/work"],
    "cloneDir": "~/code",
    "roots": { "my-org": "~/work" }
  }
  ```

  `owners`: users or orgs to list. `scan`: folders whose subfolders are checked for a clone. `cloneDir`: where a missing repo is cloned, as `<cloneDir>/<repo>`. `roots`: a clone folder per owner.

Verify a live agent can be reached from the queue, a named task opens the expected worktree, and the Jev dot has a status tooltip.
