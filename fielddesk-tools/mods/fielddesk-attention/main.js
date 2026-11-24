import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, checking, run, terminals, theme } from "herdr";
import { lineageRows, withIdleAge, workerRows } from "./workers.js";

const statuses = {
  blocked: ["Blocked", "blocked"], stale: ["Stale", "working"], live: ["Live", "working"],
  idle: ["Idle", "muted"], done: ["Done", "done"], unknown: ["Unknown", "muted"],
};
const rank = { blocked: 0, done: 1, working: 2, idle: 3 };

function treeGuides(t, row) {
  const line = (el) => el.border_l(1).border_color(t.input);
  return h_flex().h_full().flex_none().children(row.guides.slice(-4).map((visible) =>
    div().w(12).h_full().flex_none().when(visible, line)))
    .child(v_flex().w(12).h_full().flex_none()
      .child(line(div().flex_1()).border_b(1))
      .child(div().flex_1().when(row.branch === "tee", line)));
}

function sessionRow(t, row) {
  const root = !row.branch;
  const [label, color] = statuses[row.status];
  const unreported = row.detail === "No status reported";
  return h_flex().id(`fielddesk-${row.key}`).h(root ? 35 : 26).px(8).gap(6).items_center().flex_none()
    .when(root, (el) => el.mt(4).rounded(5).bg(row.focused ? t.selected : t.surface))
    .when(Boolean(row.command), (el) => el.role("button")
      .accessibility_label([row.name, label, row.detail].filter(Boolean).join(", "))
      .hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_click(() => run(row.command, { terminal: row.target })))
    .when(!root, (el) => el.child(treeGuides(t, row)))
    .child(v_flex().flex_1().min_w(0)
      .child(div().truncate().font_weight(root ? 600 : 400).text_color(t.foreground).child(row.name))
      .when(root && Boolean(row.detail), (el) => el.child(div().truncate().text_size(10).text_color(t.muted).child(row.detail))))
    .child(div().flex_none().w(53).text_right().text_size(11).text_color(t[unreported ? "muted" : color]).child(unreported ? "No report" : label));
}

export default class Attention extends View {
  init(_props, cx) {
    this.idleSince = new Map();
    if (!checking()) cx.timer.every(60_000, (cx) => {
      if (this.idleSince.size) cx.notify();
    });
  }

  render() {
    const t = theme();
    const list = [...agents()].sort((a, b) => rank[a.status] - rank[b.status] || b.seq - a.seq);
    const workers = withIdleAge(workerRows(terminals(), list), this.idleSince, Date.now());
    this.idleSince = workers.idleSince;
    const rows = lineageRows(list, workers.rows);
    return v_flex().id("fielddesk-attention").size_full().bg(t.chrome).p(12).gap(4).text_size(13)
      .child(h_flex().justify_between().items_center().px(2).pb(6).gap(4)
        .child(div().text_color(t.foreground).text_size(15).child("Session tree"))
        .child(div().text_color(t.muted).text_size(11).child(`${workers.rows.length} subagent${workers.rows.length === 1 ? "" : "s"}`)))
      .when(!rows.length, (el) => el.child(div().px(2).text_size(11).text_color(t.muted).child("No agents reporting status")))
      .child(v_flex().id("fielddesk-lineage").flex_1().min_h(0).overflow_y_scrollbar()
        .children(rows.map((row) => sessionRow(t, row))));
  }
}
