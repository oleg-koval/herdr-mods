// Tab menu: Herdr's tab right-click items plus "Fork session", which opens the thread-fork dialog
// on the tab's Claude session. Opened as a popup with props { target: { id, space }, overlay } by
// a tab strip whose right-click points here instead of Herdr's own `menu` mod.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, closeOverlay, keys, openOverlay, props, run, theme } from "herdr";
import { shortcutFor, tabMenuItems } from "./items.js";

export default class TabMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  list() {
    return tabMenuItems(props()?.target ?? {}, agents());
  }

  choose(item) {
    closeOverlay(props()?.overlay);
    if (item.fork) openOverlay({ mod: "thread-fork", kind: "dialog", width: 720, height: 600, props: item.fork });
    else run(item.command, item.args);
  }

  render() {
    const t = theme();
    const list = this.list();
    const bindings = keys();
    return v_flex().id("fielddesk-tab-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") return this.choose(list[this.at]);
        else if (e.key === "escape") return closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((item, i) => v_flex()
        .when(Boolean(item.separated), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`tab-menu-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover)).cursor_pointer()
          .on_click(() => this.choose(item))
          .child(svg(`mods/workspace-chrome/${item.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(item.label))
          .child(div().text_size(11).text_color(t.dim).child(item.command ? shortcutFor(bindings, item.command) : "")))));
  }
}
