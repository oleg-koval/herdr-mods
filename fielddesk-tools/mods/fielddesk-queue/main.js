import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, machines, readTextFile, run, shared, spaces, terminals, theme } from "herdr";
import { cacheDot, rowDetail } from "./row.js";
import { DEFAULT_CONTEXT_LABEL, contextLabelFrom } from "./label.js";

const sections = [
  ["blocked", "Needs input"], ["working", "Running"], ["idle", "Idle"],
  ["done", "Done"], ["stopped", "Stopped"],
];

// The second line names the space and, when the session keeps one, its context label. The dot
// before the name is Cache Expiry's cooling colour (hover for the idle time); without that mod
// installed there is no dot.
function agentRow(t, agent, context, heat) {
  const name = agent.name;
  const dot = cacheDot(heat, agent.status);
  return v_flex().id(`fielddesk-agent-${agent.address}`).gap(2).px(9).py(7).rounded(5)
    .when(agent.focused, (el) => el.bg(t.selected))
    .when(Boolean(agent.pane) || agent.status !== "stopped", (el) => el.role("button")
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click(() => agent.pane ? run("pane.focus", { pane: agent.pane }) : run("terminal.peek", { terminal: agent.address })))
    .child(h_flex().gap(6).items_center()
      .when(Boolean(dot), (el) => el.child(div().id(`fielddesk-cache-${agent.address}`).size(6).rounded_full().flex_none()
        .bg(dot.color).tooltip(dot.tooltip)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name)))
    .child(div().truncate().text_color(t.muted).text_size(11).child(rowDetail(agent.space_name, context)));
}

export default class Attention extends View {
  init(_props, cx) {
    this.previous = new Map();
    this.stopped = new Map();
    this.contextLabel = DEFAULT_CONTEXT_LABEL;
    cx.spawn(async (cx) => {
      this.contextLabel = contextLabelFrom(await readTextFile(`${appHome()}/settings.json`).catch(() => null));
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const contextLabel = this.contextLabel;
    const heat = shared("cache-expiry.heat") ?? {};
    const projects = new Map(spaces().map((space) => [space.id, space]));
    const tabs = new Map([...projects.values()].flatMap((space) => space.tabs.map((tab) => [tab.id, tab])));
    const ready = new Set(machines().filter((machine) => machine.layout === "ready").map((machine) => machine.name));
    const all = new Map(terminals().map((term) => [term.address, term]));
    const live = [...agents()].sort((a, b) => b.seq - a.seq).map((agent) => ({
      ...agent,
      name: (tabs.get(agent.tab)?.named && agent.tab_name) || agent.title || agent.program.name,
    }));
    const shown = new Map(live.map((agent) => [agent.address, agent]));
    const helpers = [...all.values()].flatMap((term) => {
      if (shown.has(term.address) || term.state !== "live" || !term.parent || !term.program?.agent) return [];
      const visited = new Set();
      let parent = term.parent;
      while (parent && !visited.has(parent)) {
        const root = shown.get(parent);
        if (root) {
          const status = term.status === "error" ? "blocked" : term.status;
          if (!sections.some(([key]) => key === status)) return [];
          return [{ address: term.address, name: term.name || term.program.name, space: root.space, space_name: root.space_name, status }];
        }
        visited.add(parent);
        parent = all.get(parent)?.parent;
      }
      return [];
    });
    const visible = [...live, ...helpers];
    const current = new Map(visible.map((entry) => [entry.address, entry]));
    for (const [address, entry] of this.previous) {
      const space = projects.get(entry.space);
      // A disconnected machine, hidden space, or agent that still has a live terminal
      // is not evidence of a stop. Herdr can remove a finished terminal from its view.
      if (current.has(address) || all.get(address)?.state === "live" || !space || (space.machine && !ready.has(space.machine))) continue;
      this.stopped.set(address, { ...entry, pane: null, focused: false, status: "stopped" });
    }
    for (const [address, entry] of this.stopped) {
      if (current.has(address) || !projects.has(entry.space)) this.stopped.delete(address);
    }
    this.previous = current;
    const recent = [...this.stopped].slice(-8);
    this.stopped = new Map(recent);
    const list = [...visible, ...recent.reverse().map(([, entry]) => entry)];
    return v_flex().id("fielddesk-attention").size_full().bg(t.chrome).p(12).gap(10).text_size(13).overflow_y_scrollbar()
      .child(h_flex().justify_between().items_center().px(2)
        .child(div().text_color(t.foreground).text_size(15).child("Attention"))
        .child(div().text_color(t.muted).text_size(11).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)))
      .when(!list.length, (el) => el.child(div().text_color(t.muted).child("No agents reporting status")))
      .children(sections.flatMap(([status, label]) => {
        const rows = list.filter((agent) => agent.status === status);
        return rows.length ? [v_flex().gap(2)
          .child(div().px(8).text_size(11).text_color(t[status] ?? t.muted).child(`${label} · ${rows.length}`))
          .children(rows.map((agent) => agentRow(t, agent, all.get(agent.address)?.labels?.[contextLabel], heat[agent.address])))] : [];
      }));
  }
}
