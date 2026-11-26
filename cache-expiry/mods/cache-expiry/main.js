// Cache expiry: when a Claude conversation's prompt cache goes cold. It publishes, for every Claude
// agent, a circle colour that cools from hot to cold as the cache ages (shared("cache-expiry.heat"),
// read by agent-brief), posts one toast, naming the space and tab, when you switch to a cold
// conversation before you type, and draws a cache indicator whose dot is the focused tab's cache.
// Its layout block keeps it running. Clicking the indicator opens this mod again as a dialog
// (mod.open): every Claude and Codex session by temperature and context size, each with Compact,
// Handover, Clear and Apply buttons, and the settings. That copy only draws. The same settings are listed in Settings > Mods.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, focused, exec, home, appHome, readTextFile, notify, shared, setShared, checking, terminals, theme, props, run, closeOverlay } from "herdr";
import {
  KEYS, LIMITS, readSettings, stepped, legacySettings,
  lastUsage, heatOf, coldness, mixHex, applyRead, keepOnly, summarize, stripText, ttlMsFor, PROVIDER_TTL_MS,
} from "./cold.js";
import { codexSamples, codexStripText, hitRate } from "./codex.js";
import { sessionRows, rowsSummary, kTokens } from "./sessions.js";
import { SHARED_KEY as HANDOVER_KEY } from "./handover.js";
import { send, scanHandovers, requestHandover, markCleared, applyHandover } from "./handover-io.js";

const LEGACY_IMPORTED = "cache-expiry.legacyConfigImported";
const isClaude = (a) => a.app === "claude-code";
const conf = () => readSettings((key) => shared(key));
const HOT = [["#ff6b35", "Orange"], ["#ef4444", "Red"], ["#f59e0b", "Amber"], ["#ec4899", "Pink"]];
const COLD = [["#4a9eff", "Blue"], ["#22d3ee", "Cyan"], ["#a78bfa", "Violet"], ["#8b949e", "Grey"]];
const DANGER = "#dc2626";
const COMPACT = "#f59e0b";
const COMPACT_BG = "#f59e0b26";

export default class CacheExpiry extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay ?? null;
    this.reads = { usage: {}, seqs: {} };
    this.seq = 0;
    this.scanning = false;
    this.statuses = {};
    this.warned = {};
    this.published = "";
    this.codex = { count: 0, samples: {} };
    this.localCodex = {};
    this.readingCodex = false;
    this.lastFocus = null;
    this.page = "sessions";
    this.armed = null;
    this.handing = false;
    this.lastSettings = JSON.stringify(conf());
    if (this.overlay || checking()) return;
    cx.spawn(async () => this.importLegacyConfig());
    this.scan(cx);
    this.scanCodex(cx);
    cx.timer.every(60_000, (cx) => this.scan(cx));
    cx.timer.every(15_000, (cx) => this.scanCodex(cx));
    cx.timer.every(5_000, (cx) => this.tick(cx));
    cx.timer.every(3_000, (cx) => this.scanHandovers(cx));
    cx.timer.every(1_500, (cx) => this.watchFocus(cx));
    cx.timer.every(500, () => this.watchSettings());
  }

  scanCodex(cx) {
    if (this.readingCodex) return;
    const { samples } = codexSamples(agents(), terminals());
    const addresses = agents().filter((a) => a.app === "codex" && /^t[a-z0-9]{1,32}$/.test(a.address) &&
      !samples[a.address]).map((a) => a.address);
    if (!addresses.length && !Object.keys(this.localCodex).length) return;
    this.readingCodex = true;
    cx.spawn(async (cx) => {
      try {
        const result = addresses.length ? await exec("python3", [
          `${appHome()}/mods/cache-expiry/codex-cache-read.py`, ...addresses,
        ], { timeout: 5_000 }) : null;
        this.localCodex = result?.code === 0 ? JSON.parse(result.stdout) : {};
      } catch {
        this.localCodex = {};
      } finally {
        this.readingCodex = false;
      }
      this.publish();
      cx.notify();
    });
  }

  // Published from this copy; the dialog copy has no timers and draws what it finds.
  scanHandovers(cx) {
    if (this.handing) return;
    this.handing = true;
    const live = agents().filter((a) => a.app === "claude-code" || a.app === "codex").map((a) => a.address);
    cx.spawn(async (cx) => {
      try {
        const states = await scanHandovers(live);
        if (JSON.stringify(states) !== JSON.stringify(shared(HANDOVER_KEY) ?? {})) {
          setShared(HANDOVER_KEY, states);
          cx.notify();
        }
      } finally {
        this.handing = false;
      }
    });
  }

  // Before the settings dialog, settings lived in config.json beside this file. Import what an
  // older install customised there once, without overwriting anything already set in the dialog.
  async importLegacyConfig() {
    if (shared(LEGACY_IMPORTED)) return;
    const text = await readTextFile(`${appHome()}/mods/cache-expiry/config.json`).catch(() => null);
    for (const [key, value] of Object.entries(legacySettings(text))) {
      if (shared(key) == null) setShared(key, value);
    }
    setShared(LEGACY_IMPORTED, true);
  }

  // The dialog is a separate copy that only writes shared keys, so the colours it changes are
  // published from here as soon as the change is seen.
  watchSettings() {
    const now = JSON.stringify(conf());
    if (now === this.lastSettings) return;
    this.lastSettings = now;
    this.publish();
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
    const c = conf();
    const now = Date.now();
    const entry = (u, ttlMs) => {
      const h = heatOf(u, now, ttlMs);
      if (h === null) return null;
      return {
        color: c.circle.enabled ? mixHex(c.circle.hot, c.circle.cold, h) : null,
        cold: coldness(u, now, { ttlMs, minTokens: c.minTokens }) !== null,
        idleMin: Math.floor((now - u.at) / 60_000),
        at: u.at,
        tokens: u.tokens,
        ttlMs,
      };
    };
    const heat = {};
    for (const [address, u] of Object.entries(this.reads.usage)) {
      const e = entry(u, ttlMsFor(c, "claude", u));
      if (e) heat[address] = e;
    }
    this.codex = codexSamples(agents(), terminals(), this.localCodex);
    for (const [address, { input, cached, at }] of Object.entries(this.codex.samples)) {
      const timed = typeof at === "number" ? entry({ at, tokens: input }, ttlMsFor(c, "codex")) : null;
      heat[address] = { ...timed, codexHit: hitRate(cached, input), tokens: input };
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
    cx.notify();
    if (!now || !agents().some((a) => a.address === now && isClaude(a))) return;
    cx.spawn(async (cx) => {
      await this.load(now);
      this.publish();
      cx.notify();
      if ((focused()?.terminal ?? null) === now) this.maybeToast(now);
    });
  }

  maybeToast(address) {
    const c = conf();
    if (!c.toast) return;
    const u = this.reads.usage[address];
    const cold = u && coldness(u, Date.now(), { ttlMs: ttlMsFor(c, "claude", u), minTokens: c.minTokens });
    // one toast per cold spell: a new turn gives the terminal a new idle time
    if (!cold || this.warned[address] === cold.since) return;
    this.warned = { ...this.warned, [address]: cold.since };
    const a = agents().find((x) => x.address === address);
    const where = a ? `${a.space_name} / ${a.tab_name || a.title}` : address;
    notify({
      title: `${where}: cache expired`,
      body: `Idle ${cold.idleMin} min, ~${Math.round(cold.tokens / 1000)}k tokens. Your next prompt rewrites all of it at the cache-write price. If the task changed, /clear and continue from a short handoff.`,
      level: "warning",
      timeout: c.toastSeconds * 1000,
    });
  }

  render() {
    return this.overlay ? this.dialog(theme(), conf()) : this.indicator(theme(), conf());
  }

  rows(c) {
    return sessionRows(agents(), shared("cache-expiry.heat") ?? {}, Date.now(),
      { ttlMinutes: c.ttlMinutes, hot: c.circle.hot, cold: c.circle.cold, compactTokens: c.compactTokens });
  }

  // The dot is the focused tab's own cache; the tooltip adds the totals over every session.
  indicator(t, c) {
    const s = summarize(this.reads.usage, Date.now(), (u) => ttlMsFor(c, "claude", u));
    const terminal = focused()?.terminal ?? null;
    const mine = this.rows(c).find((r) => r.address === terminal);
    const dot = mine?.color ?? t.muted;
    const here = mine ? `This tab (${mine.app}): ${mine.detail}` : "This tab: no Claude or Codex session";
    const tooltip = [here, stripText(s), codexStripText(this.codex)].filter(Boolean).join(" / ");
    const toolbar = Boolean(props()?.toolbar);
    return h_flex().size_full().items_center().bg(t.chrome)
      .when(toolbar, (el) => el.justify_center().border_b(1).border_color(t.border))
      .when(!toolbar, (el) => el.justify_end().pr(10))
      .child(h_flex().id("cache-expiry-status").role("button").accessibility_label(`Cache sessions. ${tooltip}`)
        .tooltip(tooltip).h(24).px(6).gap(5).items_center().rounded(4)
        .text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(() => run("mod.open", { name: "cache-expiry" }))
        .child(svg("mods/workspace-chrome/layers.svg").size(16))
        .child(div().size(8).rounded_full().bg(dot)));
  }

  dialog(t, c) {
    const tab = (id, label) => div().id(`ce-page-${id}`).px(12).py(4).rounded(6).cursor_pointer().text_size(12.5)
      .when(this.page === id, (el) => el.bg(t.raised).text_color(t.foreground))
      .when(this.page !== id, (el) => el.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => { this.page = id; this.armed = null; cx.notify(); })
      .child(label);
    return v_flex().size_full().bg(t.popover).text_color(t.foreground)
      .child(h_flex().px(20).pt(18).pb(10).items_center()
        .child(div().flex_1().text_size(16).font_semibold().child("Cache"))
        .child(h_flex().p(2).gap(2).rounded(8).bg(t.hover)
          .child(tab("sessions", "Sessions"))
          .child(tab("settings", "Settings"))))
      .child(this.page === "settings" ? this.settingsDialog(t, c) : this.sessions(t, c));
  }

  sessions(t, c) {
    const rows = this.rows(c);
    return v_flex().flex_1().min_h(0).px(20).pb(20).gap(8)
      .child(div().text_size(12.5).text_color(t.dim).child(rowsSummary(rows)))
      .child(this.gradient(t, c))
      .child(v_flex().id("ce-sessions").flex_1().min_h(0).gap(2).overflow_y_scrollbar()
        .children(rows.map((r) => this.sessionRow(t, r))))
      .child(div().pt(4).text_size(11.5).text_color(t.dim)
        .child("Save a handover, Clear, then play to carry the context and leftover tasks into the fresh conversation. Clear sends /clear to Claude and /new to Codex. Idle tabs only."))
      .child(h_flex().justify_end().pt(4)
        .child(this.button(t, "ce-done", "Done", () => closeOverlay(this.overlay))));
  }

  sessionRow(t, r) {
    const fill = r.temp === null ? 0 : Math.max(0.06, 1 - r.temp);
    const h = (shared(HANDOVER_KEY) ?? {})[r.address] ?? null;
    return h_flex().w_full().gap(10).px(8).py(7).rounded(8).items_center()
      .when(r.focused, (el) => el.bg(t.selected))
      .child(h_flex().id(`ce-go-${r.address}`).flex_1().min_w(0).gap(10).items_center().cursor_pointer()
        .tooltip("Go to this tab")
        .on_click(() => { run("agent.focus", { terminal: r.address }); closeOverlay(this.overlay); })
        .child(div().size(10).flex_none().rounded_full().bg(r.color ?? t.muted))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(13).truncate().child(r.where))
          .child(h_flex().gap(6).items_center().min_w(0)
            .when(r.context !== null, (el) => el.child(this.contextPill(t, r)))
            .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim).truncate().child(`${r.app} · ${r.detail}`)))))
      .child(div().flex_none().w(48).h(6).rounded(3).bg(t.hover).overflow_hidden()
        .child(div().h_full().rounded(3).w(Math.round(48 * fill)).bg(r.color ?? t.muted)))
      .child(h_flex().flex_none().gap(4).items_center()
        .child(this.compactButton(t, r))
        .child(this.handoverButton(t, r, h))
        .child(this.clearButton(t, r, this.armed === r.address))
        .child(this.applyButton(t, r, h)));
  }

  iconButton(t, id, icon, { enabled, lit, tip, onClick }) {
    return div().id(id).flex_none().w(28).h(26).rounded(6).border_1().flex().items_center().justify_center()
      .tooltip(tip)
      .when(!enabled, (el) => el.border_color(t.border).text_color(t.dim).opacity(0.45))
      .when(enabled, (el) => el.border_color(lit ? t.accent : t.border).bg(t.raised).cursor_pointer()
        .text_color(lit ? t.accent : t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick))
      .when(!enabled && lit, (el) => el.opacity(0.8).text_color(t.accent))
      .child(svg(`mods/cache-expiry/icons/${icon}.svg`).size(14));
  }

  // The context the newest request carried; amber from the Compact threshold on.
  contextPill(t, r) {
    return div().id(`ce-ctx-${r.address}`).flex_none().px(5).rounded(4).text_size(11)
      .bg(r.large ? COMPACT_BG : t.hover).text_color(r.large ? COMPACT : t.muted)
      .tooltip(`${r.context.toLocaleString("en-US")} tokens of context on the last request`)
      .child(`${kTokens(r.context)} ctx`);
  }

  // Grey until the context passes the Compact threshold; /compact summarises the conversation in place.
  compactButton(t, r) {
    const { compactTokens } = conf();
    const tip = !r.large ? `Compact: available from ${kTokens(compactTokens)} of context`
      : !r.clearable ? `Busy (${r.status}): compact once it is idle`
      : `Compact ${kTokens(r.context)} of context (/compact)`;
    return this.iconButton(t, `ce-compact-${r.address}`, "compact", {
      enabled: r.large && r.clearable, lit: r.large, tip,
      onClick: (_e, cx) => { this.armed = null; this.act(r, "compact", () => send(r.address, "/compact")); cx.notify(); },
    });
  }

  // Asks the session to write its context and leftover tasks to a file for the next session.
  handoverButton(t, r, h) {
    const tip = h?.requested && !r.clearable ? "Writing the handover…"
      : !r.clearable ? `Busy (${r.status}): save a handover once it is idle`
      : h?.requested ? "The handover was asked for but no file arrived. Ask again"
      : h?.saved ? "Handover saved. Save again to replace it"
      : "Save a handover: context and leftover tasks for the next session";
    return this.iconButton(t, `ce-handover-${r.address}`, "handover", {
      enabled: r.clearable, lit: Boolean(h?.saved || h?.requested), tip,
      onClick: (_e, cx) => { this.armed = null; this.act(r, "handover", () => requestHandover(r.address)); cx.notify(); },
    });
  }

  // Gray until a saved handover exists and the conversation was cleared after it.
  applyButton(t, r, h) {
    const tip = !h?.saved ? "Apply a handover: save one first"
      : !h.cleared ? "Apply a handover: clear the session first"
      : !r.clearable ? `Busy (${r.status}): apply once it is idle`
      : "Apply the saved handover to this fresh session";
    return this.iconButton(t, `ce-apply-${r.address}`, "apply", {
      enabled: Boolean(h?.ready) && r.clearable, lit: Boolean(h?.ready), tip,
      onClick: (_e, cx) => { this.act(r, "apply", () => applyHandover(r.address)); cx.notify(); },
    });
  }

  act(r, what, task) {
    const verb = { handover: "handover requested", apply: "handover applied", clear: "cleared", compact: "compacting" }[what];
    const body = {
      handover: (path) => `It is writing ${path}. Clear it once that is done, then press play.`,
      apply: (path) => `Sent ${path} to the fresh session.`,
      clear: () => `Sent ${r.clear}. Its next prompt starts from an empty context.`,
      compact: () => `Sent /compact to ${kTokens(r.context)} of context.`,
    }[what];
    task().then(
      (result) => notify({ title: `${r.where}: ${verb}`, body: body(result), level: "info", timeout: 6000 }),
      (error) => notify({ title: `${r.where}: ${what} failed`, body: String(error?.message ?? error), level: "error", timeout: 8000 }),
    );
  }

  // Two clicks: the first arms the button, the second sends the command. A clear cannot be undone.
  clearButton(t, r, armed) {
    const base = div().id(`ce-clear-${r.address}`).flex_none().w(64).h(26).rounded(6).flex().items_center()
      .justify_center().text_size(12).border_1();
    if (!r.clearable) {
      return base.border_color(t.border).text_color(t.dim).opacity(0.45)
        .tooltip(`Busy (${r.status}): clear it once it is idle`).child("Clear");
    }
    if (armed) {
      return base.border_color(DANGER).bg(DANGER).text_color("#ffffff").cursor_pointer()
        .tooltip(`Sends ${r.clear} to ${r.where}`)
        .on_click((_e, cx) => { this.armed = null; this.act(r, "clear", () => this.clear(r)); cx.notify(); })
        .child("Confirm");
    }
    return base.border_color(t.border).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`Start a fresh conversation (${r.clear})`)
      .on_click((_e, cx) => { this.armed = r.address; cx.notify(); })
      .child("Clear");
  }

  async clear(r) {
    await send(r.address, r.clear);
    await markCleared(r.address).catch(() => null);
  }

  settingsDialog(t, c) {
    // Handlers read the stored value when clicked, not the one this render saw, so two quick
    // clicks before a redraw make two steps.
    const flip = (key, read) => () => setShared(key, !read(conf()));
    const step = (key, read, sign, limits, store = (n) => n) => () =>
      setShared(key, store(stepped(read(conf()), sign * limits.step, limits)));
    const minutes = (n) => ({ n, unit: "minute" });
    const ttl = (c) => c.ttlMinutes;
    const toastSeconds = (c) => c.toastSeconds;
    const minTokens = (c) => c.minTokens;
    const compactTokens = (c) => c.compactTokens;
    return v_flex().flex_1().min_h(0).px(20).pb(20).gap(2)
      .child(div().pb(8).text_size(12.5).text_color(t.dim).child("Claude and Codex prompt-cache expiry, and observed Codex cache hits."))
      .child(this.gradient(t, c))
      .child(this.row(t, "Cooling circles", "Idle and done circles in Agent Brief cool from hot to cold.",
        this.toggle(t, "ce-circles", c.circle.enabled, flip(KEYS.circles, (s) => s.circle.enabled))))
      .child(this.row(t, "Hot colour", "A cache that was just used.", this.swatches(t, "ce-hot", HOT, c.circle.hot, KEYS.hot)))
      .child(this.row(t, "Cold colour", "A cache that has expired.", this.swatches(t, "ce-cold", COLD, c.circle.cold, KEYS.cold)))
      .child(this.row(t, "Provider cache time",
        "Claude: 1 h or 5 min, as each session writes it. Codex: 30 min (OpenAI's default). Off: your own time below.",
        this.toggle(t, "ce-ttl-auto", c.ttlAuto, flip(KEYS.ttlAuto, (s) => s.ttlAuto))))
      .when(!c.ttlAuto, (el) => el.child(this.row(t, "Cold after", "Your own time, for every Claude and Codex session.",
        this.stepper(t, "ce-ttl", `${c.ttlMinutes} min`,
          step(KEYS.ttl, ttl, -1, LIMITS.ttlMinutes, minutes),
          step(KEYS.ttl, ttl, 1, LIMITS.ttlMinutes, minutes)))))
      .child(this.row(t, "Toast on a cold tab", "Names the space and tab when you switch to it.",
        this.toggle(t, "ce-toast", c.toast, flip(KEYS.toast, (s) => s.toast))))
      .child(this.row(t, "Toast stays", null,
        this.stepper(t, "ce-toast-seconds", `${c.toastSeconds} s`,
          step(KEYS.toastSeconds, toastSeconds, -1, LIMITS.toastSeconds),
          step(KEYS.toastSeconds, toastSeconds, 1, LIMITS.toastSeconds))))
      .child(this.row(t, "Warn from", "Smaller conversations get no toast and no cold mark.",
        this.stepper(t, "ce-min-tokens", `${Math.round(c.minTokens / 1000)}k tokens`,
          step(KEYS.minTokens, minTokens, -1, LIMITS.minTokens),
          step(KEYS.minTokens, minTokens, 1, LIMITS.minTokens))))
      .child(this.row(t, "Compact from", "Sessions with more context get a Compact button.",
        this.stepper(t, "ce-compact-tokens", `${kTokens(c.compactTokens)} tokens`,
          step(KEYS.compactTokens, compactTokens, -1, LIMITS.compactTokens),
          step(KEYS.compactTokens, compactTokens, 1, LIMITS.compactTokens))))
      .child(div().flex_1().min_h(0))
      .child(h_flex().gap(8).justify_end().pt(12)
        .child(this.button(t, "ce-reset", "Reset to defaults", () => Object.values(KEYS).forEach((key) => setShared(key, null))))
        .child(this.button(t, "ce-done", "Done", () => closeOverlay(this.overlay))));
  }

  gradient(t, c) {
    const steps = 16;
    return v_flex().gap(4).pb(8)
      .child(h_flex().h(10).rounded(5).overflow_hidden().children(
        Array.from({ length: steps }, (_, i) => div().flex_1().h_full().bg(mixHex(c.circle.hot, c.circle.cold, i / (steps - 1)))),
      ))
      .child(h_flex().text_size(11).text_color(t.dim)
        .child(div().flex_1().child("just used"))
        .child(div().child(c.ttlAuto ? "cold when the provider's cache expires" : `cold at ${c.ttlMinutes} min`)));
  }

  row(t, title, about, control) {
    return h_flex().w_full().gap(16).py(10).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(13.5).child(title))
        .when(Boolean(about), (el) => el.child(div().text_size(12).text_color(t.dim).child(about))))
      .child(div().flex_none().child(control));
  }

  toggle(t, id, on, onClick) {
    return div().id(id).w(36).h(20).rounded(10).p(2).cursor_pointer().flex()
      .bg(on ? t.accent : t.hover)
      .when(on, (el) => el.justify_end())
      .on_click(onClick)
      .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
  }

  stepper(t, id, label, onMinus, onPlus) {
    const b = (k, text, f) => div().id(`${id}-${k}`).w(26).h(26).rounded(6).flex().items_center().justify_center()
      .cursor_pointer().text_size(15).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(f).child(text);
    return h_flex().items_center().gap(4)
      .child(b("minus", "−", onMinus))
      .child(div().min_w(84).text_size(13).text_center().child(label))
      .child(b("plus", "+", onPlus));
  }

  swatches(t, id, options, current, key) {
    return h_flex().gap(6).children(options.map(([hex, _name]) =>
      div().id(`${id}-${hex.slice(1)}`).w(22).h(22).rounded(11).bg(hex).cursor_pointer()
        .border_2().border_color(hex.toLowerCase() === current.toLowerCase() ? t.foreground : t.border)
        .on_click(() => setShared(key, hex)),
    ));
  }

  button(t, id, label, onClick) {
    return div().id(id).px(12).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised)
      .cursor_pointer().text_size(13).hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
  }
}
