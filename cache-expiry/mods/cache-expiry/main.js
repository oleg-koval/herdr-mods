// Cache expiry: when a Claude conversation's prompt cache goes cold. It publishes, for every Claude
// agent, a circle colour that cools from hot to cold as the cache ages (shared("cache-expiry.heat"),
// read by agent-brief), and posts one toast, naming the space and tab, when you switch to a cold
// conversation before you type. Settings: config.json beside this file, read once a minute.

import { View, div } from "gpui-kit";
import { agents, focused, exec, home, appHome, readTextFile, notify, setShared, checking } from "herdr";
import { readConfig, lastUsage, heatOf, coldness, mixHex } from "./cold.js";

const CONFIG = () => `${appHome()}/mods/cache-expiry/config.json`;

export default class CacheExpiry extends View {
  init(_props, cx) {
    this.config = readConfig(null).config;
    this.usage = {}; // address -> { at, tokens } from the transcript herdr-hook.sh recorded
    this.warned = {}; // address -> the cold spell already toasted
    this.problem = null;
    this.published = "";
    this.lastFocus = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(60_000, (cx) => this.refresh(cx));
    cx.timer.every(5_000, () => this.publish());
    cx.timer.every(1_500, () => this.watchFocus());
  }

  // Re-reads config.json and each Claude agent's transcript tail. The colours are recomputed from
  // these stored timestamps every 5 s, so the circles move without a read per tick.
  refresh(cx) {
    cx.spawn(async (cx) => {
      const read = readConfig(await readTextFile(CONFIG()));
      this.config = read.config;
      if (read.problem && read.problem !== this.problem) {
        this.problem = read.problem;
        notify({ title: "Cache expiry: config not used", body: read.problem, level: "warning", timeout: 10_000 });
      }
      const next = {};
      for (const a of agents().filter((x) => x.app === "claude-code")) {
        const path = (await readTextFile(`${home()}/.local/state/herdr-idle/${a.address}`))?.trim();
        if (!path) continue;
        const tail = await exec("tail", ["-n", "400", path], { timeout: 5_000 }).catch(() => null);
        const u = lastUsage(tail?.stdout ?? "");
        if (u) next[a.address] = u;
      }
      this.usage = next;
      this.publish();
      cx.notify();
    });
  }

  publish() {
    const { ttlMinutes, minTokens, circle } = this.config;
    const ttlMs = ttlMinutes * 60_000;
    const now = Date.now();
    const heat = {};
    for (const [address, u] of Object.entries(this.usage)) {
      const h = heatOf(u, now, ttlMs);
      if (h === null) continue;
      heat[address] = {
        color: circle.enabled ? mixHex(circle.hot, circle.cold, h) : null,
        cold: coldness(u, now, { ttlMs, minTokens }) !== null,
        idleMin: Math.floor((now - u.at) / 60_000),
      };
    }
    // every mod re-renders on a set, so only publish when something the drawing shows has changed
    const text = JSON.stringify(heat);
    if (text === this.published) return;
    this.published = text;
    setShared("cache-expiry.heat", heat);
  }

  watchFocus() {
    const now = focused()?.terminal ?? null;
    if (now === this.lastFocus) return;
    this.lastFocus = now;
    if (!now || !this.config.toast) return;
    const u = this.usage[now];
    const cold = u && coldness(u, Date.now(), { ttlMs: this.config.ttlMinutes * 60_000, minTokens: this.config.minTokens });
    // one toast per cold spell: a new turn gives the terminal a new idle time
    if (!cold || this.warned[now] === cold.since) return;
    this.warned = { ...this.warned, [now]: cold.since };
    const a = agents().find((x) => x.address === now);
    const where = a ? `${a.space_name} / ${a.tab_name || a.title}` : now;
    notify({
      title: `${where}: cache expired`,
      body: `Idle ${cold.idleMin} min, ~${Math.round(cold.tokens / 1000)}k tokens. Your next prompt rewrites all of it at the cache-write price. If the task changed, /clear and continue from a short handoff.`,
      level: "warning",
      timeout: this.config.toastSeconds * 1000,
    });
  }

  render() {
    return div();
  }
}
