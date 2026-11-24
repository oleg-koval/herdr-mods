# Agent Brief

A compact list of agents with their statuses and optional one-line context. Selecting a row takes you to the agent.

Copy [mods/agent-brief](mods/agent-brief/) into Herdr's `mods/` directory. Open `mod.open:agent-brief` from the command palette or mount the mod in a layout block.

The mod reads the `herdr.context` terminal label by default. Set `herdr_context_label` in Herdr settings to use an existing label. Optional Claude cache hints read a local transcript referenced by `~/.local/state/herdr-idle/<terminal>`, using `tail`. Without that hook state the agent list still works.

Verify that agent rows update as sessions change and that clicking a row focuses the corresponding terminal.
