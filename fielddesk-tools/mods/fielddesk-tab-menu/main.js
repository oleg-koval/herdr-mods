// Tab menu: Herdr's tab right-click items plus "Fork session" (opens the thread-fork dialog on the
// tab's Claude session), Pin/Unpin and the browser-style bulk closes. Opened as a popup with props { target: { id, space }, overlay } by
// a tab strip whose right-click points here instead of Herdr's own `menu` mod.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, closeOverlay, keys, notify, openOverlay, props, run, setShared, shared, spaces, terminals, theme } from "herdr";
import { PINNED_KEY, shortcutFor, tabMenuItems } from "./items.js";

export default class TabMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  list() {
    const target = props()?.target ?? {};
    const all = spaces();
    const tabIds = (all.find((s) => s.id === target.space)?.tabs ?? []).map((t) => t.id);
    const pinned = shared(PINNED_KEY);
    return tabMenuItems(target, agents(), {
      tabIds,
      pinned: Array.isArray(pinned) ? pinned : [],
      terminals: terminals(),
      known: all.flatMap((s) => s.tabs.map((t) => t.id)),
    });
  }

  // Next enabled row in a direction, wrapping; the list is never all disabled (Rename is always on).
  step(list, from, by) {
    let at = from;
    do at = (at + by + list.length) % list.length; while (list[at].disabled);
    return at;
  }

  choose(item, cx) {
    if (item.disabled) return;
    if (item.copy) cx.write_to_clipboard(item.copy);
    closeOverlay(props()?.overlay);
    if (item.copy) notify({ title: `${item.label.replace("Copy ", "Copied ")}`, level: "info", timeout: 2200 });
    else if (item.fork) openOverlay({ mod: "thread-fork", kind: "dialog", width: 720, height: 600, props: item.fork });
    else if (item.pin) {
      setShared(PINNED_KEY, item.pin.value);
      run("tab.move", { id: item.pin.id, index: item.pin.moveTo });
    } else if (item.closes) for (const id of item.closes) run("tab.close", { id });
    else run(item.command, item.args);
  }

  render() {
    const t = theme();
    const list = this.list();
    const bindings = keys();
    return v_flex().id("fielddesk-tab-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = this.step(list, this.at, 1);
        else if (e.key === "up") this.at = this.step(list, this.at, -1);
        else if (e.key === "enter") return this.choose(list[this.at], cx);
        else if (e.key === "escape") return closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((item, i) => v_flex()
        .when(Boolean(item.separated), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`tab-menu-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(item.disabled ? t.dim : t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .when(!item.disabled, (el) => el.hover((s) => s.bg(t.hover)).cursor_pointer())
          .on_click((_e, cx) => this.choose(item, cx))
          .child(svg(`mods/workspace-chrome/${item.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(item.label))
          .child(div().text_size(11).text_color(t.dim).child(item.command ? shortcutFor(bindings, item.command) : "")))));
  }
}
