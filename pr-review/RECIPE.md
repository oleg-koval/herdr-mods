# PR Review

A review board with a queue, repository filters, retry actions and an optional macOS Dock badge. It requires a separate, compatible `pr-autoreview` engine with `panel --json` support. This pack includes only the Herdr interface.

Copy both folders under [mods](mods/) into Herdr's `mods/` directory. Open a tab using `mod: "pr-review"` and `props: { "role": "board" }`, or open `pr-review-guard` and bind a key to `pr-review-guard.open`. Set the board's `bin` prop to use a custom executable path.

**Review setup** (the last view in the sidebar) chooses what the engine runs: the default for every repo, plus an override per repo. Edit opens a form: a searchable list of the review skills found on the machine (user skills and installed plugins whose name or description mentions a review), a model, and the skill's optional parameters. Parameters come from the skill's `argument-hint`: `[a|b|c]` becomes choices, `[--flag]` a switch, `[--flag a|b]` choices for that flag and `[--flag <x>]` a text box. Flags the engine controls itself (`--post`, `--fix`, `--no-fix`, `--no-artifact`) are never offered. Only the engine's built-in skill is marked tested; any other skill may fail under the engine's tool guard. It needs the engine commands `review-config` and `skills`; an older engine shows "engine too old".

**Why** (a button on a failed, human-needed or colliding PR, and on a Run that errored; Ctrl-W) explains the recorded reasons in plain words with likely causes and next steps, then shows what the run's log says: how the run ended, guard denials, failed tool calls and the CLI's own error output. It can open the log and retry a failed PR. It needs the engine command `why`.

The engine may read local review state and perform GitHub actions when you choose them. The board reads the engine's supported-command marker before invoking it. The optional guard refreshes the Dock count; close its overlay before removing it.

Verify that a missing engine is reported as unavailable and that an installed compatible engine yields the expected queue.
