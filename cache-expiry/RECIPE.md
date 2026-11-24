# Cache Expiry

Tells you when a Claude terminal's prompt cache has gone cold. Each Claude agent's status circle cools from hot to cold as its cache ages, so you can see at a glance which conversations will be rewritten at the cache-write price on the next prompt. Switching to a cold conversation posts one toast that names its space and tab.

Copy [mods/cache-expiry](mods/cache-expiry/) into Herdr's `mods/` directory. It has no visible surface of its own: it publishes the circle colours that [Agent Brief](../agent-brief/RECIPE.md) draws, and posts the toast. Like the Toast mod, it has no layout block; copying the folder is enough.

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
