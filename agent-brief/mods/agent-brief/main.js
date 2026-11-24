// Agent brief: one row per agent with its status, the one-line context its session keeps in the
// configured context label, and a "cold" mark when its prompt cache has expired. Switching to a cold
// Claude terminal posts one toast, before you type: the prompt you send next rewrites the whole
// conversation at the cache-write price, so that is the moment to /clear or /compact instead.
// Ported from agterm's title-bar context line and its session.selected idle HUD.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, run, theme, exec, home, readTextFile, notify, setAgentOrder, checking, settings } from "herdr";
import { coldness, lastUsage } from "./cold.js";

const STALE_MS = 55 * 60 * 1000; // just under the 1 h prompt-cache TTL
const MIN_TOKENS = 80_000; // below this a rewrite is not worth a warning
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export default class AgentBrief extends View {
  init(_props, cx) {
    this.cold = {};
    this.warned = {};
    this.lastFocus = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(60_000, (cx) => this.refresh(cx));
    cx.timer.every(1_500, (cx) => this.watchFocus(cx));
  }

  // address -> { idleMin, tokens } for every Claude agent whose cache is cold, from the transcript
  // herdr-hook.sh recorded for that terminal.
  refresh(cx) {
    cx.spawn(async (cx) => {
      const next = {};
      for (const a of agents().filter((x) => x.app === "claude-code")) {
        const path = (await readTextFile(`${home()}/.local/state/herdr-idle/${a.address}`))?.trim();
        if (!path) continue;
        const tail = await exec("tail", ["-n", "400", path], { timeout: 5_000 }).catch(() => null);
        const cold = coldness(lastUsage(tail?.stdout ?? ""), Date.now(), { staleMs: STALE_MS, minTokens: MIN_TOKENS });
        if (cold) next[a.address] = cold;
      }
      this.cold = next;
      cx.notify();
    });
  }

  watchFocus(_cx) {
    const now = focused()?.terminal ?? null;
    if (now === this.lastFocus) return;
    this.lastFocus = now;
    const cold = now && this.cold[now];
    // one toast per cold spell: a new turn gives the terminal a new idle time and a new key
    if (!cold || this.warned[now] === cold.since) return;
    this.warned = { ...this.warned, [now]: cold.since };
    notify({
      title: `Cache expired: idle ${cold.idleMin} min, ~${Math.round(cold.tokens / 1000)}k tokens`,
      body: "Your next prompt rewrites all of it at the cache-write price. If the task changed, /clear and continue from a short handoff.",
      level: "warning",
      timeout: 12_000,
    });
  }

  render(_cx) {
    const t = theme();
    const contextLabel = settings().herdr_context_label || "herdr.context";
    const labels = Object.fromEntries(terminals().map((x) => [x.address, x.labels ?? {}]));
    const list = [...agents()].sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.seq - a.seq);
    setAgentOrder(list.map((a) => a.address));
    const color = { blocked: t.blocked, done: t.done, working: t.working, idle: t.idle };
    return v_flex().size_full().bg(t.chrome).p(8).gap(2).text_size(12.5).overflow_y_scrollbar().children(
      list.map((a) => {
        const context = labels[a.address]?.[contextLabel];
        const cold = this.cold[a.address];
        return v_flex().id(`brief-${a.address}`).px(8).py(5).rounded(7).gap(1)
          .when(a.focused, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("agent.focus", { terminal: a.address }))
          .child(h_flex().gap(6).items_center()
            .child(div().w(8).h(8).rounded(4).flex_none().bg(color[a.status] ?? t.unknown))
            .child(div().flex_1().truncate().text_color(t.foreground).child(`${a.space_name} / ${a.tab_name || a.title}`))
            .when(Boolean(cold), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child(`cold ${cold.idleMin}m`))))
          .when(Boolean(context), (el) => el.child(div().pl(14).truncate().text_size(11.5).text_color(t.muted).child(context)));
      }),
    );
  }
}
