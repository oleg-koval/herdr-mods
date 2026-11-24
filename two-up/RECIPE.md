# Two-up

Limit split shortcuts to two terminals per tab. Companion tools can open in movable windows when the tab is full.

Copy [mods/two-up](mods/two-up/) into Herdr's `mods/` directory. Mount the mod in a zero-width block and bind your preferred split shortcuts to `two-up.right` and `two-up.down`. The example layouts already supply the block.

The guard warns if another route creates a third terminal. Optional tool commands require the relevant executable on your PATH. Finder actions use macOS `open`. Peek windows start terminals through herdr-core and the window's Close action ends that companion terminal.

Verify the first split works, the second shortcut is refused, and an installed companion tool can open in a separate window.
