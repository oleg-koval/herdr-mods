# Compact Header

A narrow header showing the current space, branch and agent attention state. The attention control focuses the first agent that needs input.

Copy [mods/compact-header](mods/compact-header/) into Herdr's `mods/` directory. Add a block with `"content": { "mod": "compact-header" }` to a cloned layout, or use the [Shared layout](https://github.com/oleg-koval/herdr-layouts/tree/main/shared).

The mod reads Herdr state and uses the bundled workspace-chrome branch icon. Verify that switching spaces updates the label and that the attention control focuses the intended terminal.
