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

Settings live in `mods/cache-expiry/config.json`, re-read every minute:

| Key | Default | Meaning |
| --- | --- | --- |
| `ttlMinutes` | `55` | Idle time at which the cache counts as cold. The circle is fully cold here. |
| `minTokens` | `80000` | Below this context size no toast and no cold mark. |
| `toast` | `true` | Post the toast when you focus a cold conversation. |
| `toastSeconds` | `12` | How long the toast stays. |
| `circle.enabled` | `true` | Tint idle and done circles. |
| `circle.hot` | `#ff6b35` | Colour of a freshly used cache. `#rgb` or `#rrggbb`. |
| `circle.cold` | `#4a9eff` | Colour once the cache has expired. |

A value that fails validation falls back to its default, and a file that is not valid JSON falls back to all defaults with one warning toast.

The mod reads the local transcript that `herdr-hook.sh` records for each terminal in `~/.local/state/herdr-idle/<terminal>`, using `tail`. Without that hook state there is nothing to cool, and the mod does nothing.

Verify: an idle Claude terminal's circle moves from orange toward blue over the TTL, a "cold" mark appears after it, and focusing that terminal posts one toast with its space and tab in the title. Run `npm test` for the pure logic.
