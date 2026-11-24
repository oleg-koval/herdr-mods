// Agent brief: one row per agent with its status and the one-line context its session keeps in the
// configured context label. The circle of an idle or done agent cools from hot to cold as its prompt
// cache ages, and a "cold" mark appears once it has expired: both come from the Cache Expiry mod
// (shared("cache-expiry.heat")). Without that mod the circles keep their status colour.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, run, theme, shared, setAgentOrder, settings } from "herdr";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export default class AgentBrief extends View {
  render(_cx) {
    const t = theme();
    const contextLabel = settings().herdr_context_label || "herdr.context";
    const heat = shared("cache-expiry.heat") ?? {};
    const labels = Object.fromEntries(terminals().map((x) => [x.address, x.labels ?? {}]));
    const list = [...agents()].sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.seq - a.seq);
    setAgentOrder(list.map((a) => a.address));
    const color = { blocked: t.blocked, done: t.done, working: t.working, idle: t.idle };
    return v_flex().size_full().bg(t.chrome).p(8).gap(2).text_size(12.5).overflow_y_scrollbar().children(
      list.map((a) => {
        const context = labels[a.address]?.[contextLabel];
        const h = heat[a.address];
        // working and blocked keep their status colour: their cache is busy, not cooling
        const dot = h?.color && (a.status === "idle" || a.status === "done") ? h.color : (color[a.status] ?? t.unknown);
        return v_flex().id(`brief-${a.address}`).px(8).py(5).rounded(7).gap(1)
          .when(a.focused, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("agent.focus", { terminal: a.address }))
          .child(h_flex().gap(6).items_center()
            .child(div().w(8).h(8).rounded(4).flex_none().bg(dot))
            .child(div().flex_1().truncate().text_color(t.foreground).child(`${a.space_name} / ${a.tab_name || a.title}`))
            .when(Boolean(h?.cold), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child(`cold ${h.idleMin}m`))))
          .when(Boolean(context), (el) => el.child(div().pl(14).truncate().text_size(11.5).text_color(t.muted).child(context)));
      }),
    );
  }
}
