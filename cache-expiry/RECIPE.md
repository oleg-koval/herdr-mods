# Cache Expiry

Tells you when a Claude terminal's prompt cache has gone cold. Each Claude agent's status circle cools from hot to cold as its cache ages, so you can see at a glance which conversations will be rewritten at the cache-write price on the next prompt. Switching to a cold conversation posts one toast that names its space and tab.

Copy [mods/cache-expiry](mods/cache-expiry/) into Herdr's `mods/` directory. It publishes the circle colours that [Agent Brief](../agent-brief/RECIPE.md) draws, posts the toast, and shows a one-line strip: `Claude cache: 1 cold · 2 warm · next cold in 5m`.

Herdr runs a mod only while its block is in the layout, so the strip is what keeps it working. The first time Herdr sees the folder it docks the strip at the bottom of the shown layout. Move it anywhere you like, for example under Agent Brief:

```json
{ "type": "column", "size": { "px": 300 }, "children": [
  { "type": "block", "content": { "mod": "agent-brief" }, "size": { "weight": 1 } },
  { "type": "block", "content": { "mod": "cache-expiry" }, "size": { "px": 26 }, "resizable": false }
] }
```

If you remove the block, the circles stop cooling and the toast stops.

## Settings

Click the strip (it says **Settings** on the right) to open the settings dialog, or run **Cache expiry settings** from the command palette. Every change applies at once.

| Setting | Default | What it does |
| --- | --- | --- |
| Cooling circles | on | Idle and done circles in Agent Brief cool from hot to cold. Off keeps the status colours. |
| Hot colour | Orange | A cache that was just used. |
| Cold colour | Blue | A cache that has expired. |
| Cold after | 55 min | Idle time after which the cache counts as expired. Claude's prompt cache lasts one hour. |
| Toast on a cold tab | on | When you switch to a cold Claude tab, one toast names its space and tab. |
| Toast stays | 12 s | How long the toast stays. |
| Warn from | 80k tokens | Smaller conversations get no toast and no cold mark. |

The same settings are declared in `mod.json`, so a Settings screen with a Mods page lists them too. Values are stored with `setShared` under `cache-expiry.*`; **Reset to defaults** clears them. An older install's `config.json` is imported once on first run; anything already set in the dialog wins.

The mod reads the local transcript that `herdr-hook.sh` records for each terminal in `~/.local/state/herdr-idle/<terminal>`, using `tail`. Without that hook state there is nothing to cool, and the mod does nothing.

Verify: an idle Claude terminal's circle moves from orange toward blue over the TTL, a "cold" mark appears after it, and focusing that terminal posts one toast with its space and tab in the title. Run `npm test` for the pure logic.
