import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, panes, props, run, spaces, theme } from "herdr";

function context(t) {
  const space = spaces().find(s => s.active);
  if (!space) return div();
  const tab = space.tabs.find(s => s.active);
  const pane = panes().find(p => p.tab === tab?.id && p.focused);
  const branch = pane ? pane.branch : space.branch;
  return h_flex().min_w(0).gap(8).items_center()
    .child(div().max_w(84).truncate().text_color(t.foreground).tooltip(space.name).child(space.name))
    .when(Boolean(branch), el => el.child(
      h_flex().min_w(0).gap(5).items_center().text_color(t.muted)
        .child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none())
        .child(div().min_w(0).truncate().tooltip(branch).child(branch)),
    ));
}

function attention(t) {
  const blocked = agents().filter(agent => agent.status === "blocked");
  const first = blocked[0];
  if (!first) return div();
  const label = blocked.length === 1 ? "1 needs you" : `${blocked.length} need you`;
  return h_flex().id("header-needs-you").h(26).px(8).gap(6).items_center().rounded(6)
    .bg(t.raised).text_color(t.blocked).hover(s => s.bg(t.hover))
    .tooltip("Go to the first agent that needs you")
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click(() => run("agent.focus", { terminal: first.address }))
    .child(div().size(6).rounded(3).bg(t.blocked))
    .child(label);
}

export default class CompactHeader extends View {
  render() {
    const t = theme();
    const showAttention = props()?.attention === true;
    return h_flex().size_full().min_w(0).overflow_hidden().px(10).items_center()
      .bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .when(showAttention, el => el.justify_end())
      .child(showAttention ? attention(t) : context(t));
  }
}
