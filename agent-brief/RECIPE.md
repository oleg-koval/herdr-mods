# Agent Brief

A compact list of agents with their statuses and optional one-line context. Selecting a row takes you to the agent.

Copy [mods/agent-brief](mods/agent-brief/) into Herdr's `mods/` directory. Open `mod.open:agent-brief` from the command palette or mount the mod in a layout block.

The mod reads the `herdr.context` terminal label by default. Set `herdr_context_label` in Herdr's `settings.json` to use an existing label. The cooling circles and the "cold" mark come from the [Cache Expiry](../cache-expiry/README.md) mod; it is required for those, so install it alongside this one. Without it the agent list still works and the circles keep their status colour.

Verify that agent rows update as sessions change and that clicking a row focuses the corresponding terminal.
