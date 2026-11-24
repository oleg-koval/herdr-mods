# PR Review

A review board with a queue, repository filters, retry actions and an optional macOS Dock badge. It requires a separate, compatible `pr-autoreview` engine with `panel --json` support. This pack includes only the Herdr interface.

Copy both folders under [mods](mods/) into Herdr's `mods/` directory. Open a tab using `mod: "pr-review"` and `props: { "role": "board" }`, or open `pr-review-guard` and bind a key to `pr-review-guard.open`. Set the board's `bin` prop to use a custom executable path.

The engine may read local review state and perform GitHub actions when you choose them. The board reads the engine's supported-command marker before invoking it. The optional guard refreshes the Dock count; close its overlay before removing it.

Verify that a missing engine is reported as unavailable and that an installed compatible engine yields the expected queue.
