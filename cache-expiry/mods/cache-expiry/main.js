// Cache expiry: when a Claude conversation's prompt cache goes cold. It publishes, for every Claude
// agent, a circle colour that cools from hot to cold as the cache ages (shared("cache-expiry.heat"),
// read by agent-brief), posts one toast, naming the space and tab, when you switch to a cold
// conversation before you type, and draws a one-line summary strip. Herdr runs a mod copy only
// while its block is in the layout, so the strip is what keeps this mod alive.
// Settings: config.json beside this file, read once a minute.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, focused, exec, home, appHome, readTextFile, notify, setShared, checking, theme } from "herdr";
import { readConfig, lastUsage, heatOf, coldness, mixHex, applyRead, keepOnly, summarize, stripText } from "./cold.js";

const CONFIG = () => `${appHome()}/mods/cache-expiry/config.json`;
const isClaude = (a) => a.app === "claude-code";

export default class CacheExpiry extends View {
  init(_props, cx) {
    this.config = readConfig(null).config;
    this.reads = { usage: {}, seqs: {} };
    this.seq = 0;
    this.scanning = false;
    this.statuses = {};
    this.warned = {};
    this.problem = null;
    this.published = "";
    this.lastFocus = null;
    if (checking()) return;
    this.scan(cx);
    cx.timer.every(60_000, (cx) => this.scan(cx));
    cx.timer.every(5_000, (cx) => this.tick(cx));
    cx.timer.every(1_500, (cx) => this.watchFocus(cx));
  }

  async readUsage(address) {
    try {
      const path = (await readTextFile(`${home()}/.local/state/herdr-idle/${address}`))?.trim();
      if (!path) return { state: "absent" };
      const tail = await exec("tail", ["-n", "400", path], { timeout: 5_000 });
      if (tail.code !== 0) return { state: /No such file/.test(tail.stderr) ? "absent" : "failed" };
      const usage = lastUsage(tail.stdout);
      return usage ? { state: "ok", usage } : { state: "absent" };
    } catch {
      return { state: "failed" };
    }
  }

  async load(address) {
    this.seq = this.seq + 1;
    const seq = this.seq;
    const result = await this.readUsage(address);
    this.reads = applyRead(this.reads, address, seq, result);
  }

  // A slow scan never overlaps the next one: the timer skips while one is running.
  scan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        const read = readConfig(await readTextFile(CONFIG()));
        this.config = read.config;
        if (read.problem && read.problem !== this.problem) {
          notify({ title: "Cache expiry: config not used", body: read.problem, level: "warning", timeout: 10_000 });
        }
        this.problem = read.problem;
        const live = agents().filter(isClaude).map((a) => a.address);
        for (const address of live) await this.load(address);
        this.reads = keepOnly(this.reads, live);
        this.publish();
        cx.notify();
      } finally {
        this.scanning = false;
      }
    });
  }

  // An agent that just stopped working has a new turn the last scan missed: read it now.
  tick(cx) {
    const claude = agents().filter(isClaude);
    const changed = claude.filter((a) => a.address in this.statuses && this.statuses[a.address] !== a.status);
    this.statuses = Object.fromEntries(claude.map((a) => [a.address, a.status]));
    if (changed.length) {
      cx.spawn(async (cx) => {
        for (const a of changed) await this.load(a.address);
        this.publish();
        cx.notify();
      });
    }
    this.publish();
    cx.notify();
  }

  publish() {
    const { ttlMinutes, minTokens, circle } = this.config;
    const ttlMs = ttlMinutes * 60_000;
    const now = Date.now();
    const heat = {};
    for (const [address, u] of Object.entries(this.reads.usage)) {
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

  // The toast decision waits for a fresh read of the focused terminal: the last scan can be a
  // minute old, or not have reached a terminal that just appeared.
  watchFocus(cx) {
    const now = focused()?.terminal ?? null;
    if (now === this.lastFocus) return;
    this.lastFocus = now;
    if (!now || !agents().some((a) => a.address === now && isClaude(a))) return;
    cx.spawn(async (cx) => {
      await this.load(now);
      this.publish();
      cx.notify();
      if ((focused()?.terminal ?? null) === now) this.maybeToast(now);
    });
  }

  maybeToast(address) {
    if (!this.config.toast) return;
    const u = this.reads.usage[address];
    const cold = u && coldness(u, Date.now(), { ttlMs: this.config.ttlMinutes * 60_000, minTokens: this.config.minTokens });
    // one toast per cold spell: a new turn gives the terminal a new idle time
    if (!cold || this.warned[address] === cold.since) return;
    this.warned = { ...this.warned, [address]: cold.since };
    const a = agents().find((x) => x.address === address);
    const where = a ? `${a.space_name} / ${a.tab_name || a.title}` : address;
    notify({
      title: `${where}: cache expired`,
      body: `Idle ${cold.idleMin} min, ~${Math.round(cold.tokens / 1000)}k tokens. Your next prompt rewrites all of it at the cache-write price. If the task changed, /clear and continue from a short handoff.`,
      level: "warning",
      timeout: this.config.toastSeconds * 1000,
    });
  }

  render() {
    const t = theme();
    const s = summarize(this.reads.usage, Date.now(), this.config.ttlMinutes * 60_000);
    const dot = s.cold + s.warm === 0 ? t.muted : s.cold ? this.config.circle.cold : this.config.circle.hot;
    return h_flex().size_full().px(10).gap(6).items_center().bg(t.chrome).text_size(11.5).text_color(t.muted)
      .child(div().w(8).h(8).rounded(4).flex_none().bg(dot))
      .child(div().flex_1().truncate().child(stripText(s)));
  }
}
