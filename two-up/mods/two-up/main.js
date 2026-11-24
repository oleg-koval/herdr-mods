// two-up: keeps a tab to two terminals, the way an agterm session was one shell plus one split.
//
// Splits go through key actions ("cmd-d": "two-up.right"), so the cap is checked before a
// terminal exists and nothing is ever closed. Programs that would be a third terminal
// (lazygit, yazi) open in a movable window instead, like agterm's overlays. Any other route
// past the cap (menus, pane headers) gets a warning, not a close.
//
// Role "bar" is the title bar of such a window; no role is the always-on guard.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  checking, closeOverlay, exec, focused, hc, nextCommand, notify, openOverlay, panes, props, run, theme,
} from "herdr";
import {
  ACTIONS, MAX_TERMINALS, countTerminals, decide, overCap, popupArgs, popupLayout, refusal,
} from "./rules.js";

export default class TwoUp extends View {
  init(initial, cx) {
    this.warned = new Set();
    if (initial?.role === "bar" || checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        this.handle(command, cx);
      }
    });
  }

  handle(command, cx) {
    const action = ACTIONS[command];
    const here = focused();
    if (!action || !here?.tab) {
      notify({ title: "two-up", body: `unknown action ${command}`, level: "error" });
      return;
    }
    if (action.kind === "exec") {
      const [program, ...rest] = action.argv;
      cx.spawn(async () => { await exec(program, [...rest, here.cwd ?? "."]).catch(() => null); });
      return;
    }
    if (action.kind === "window") {
      cx.spawn((cx) => this.popup(action.argv, here.cwd));
      return;
    }
    const count = countTerminals(panes(), here.tab);
    if (decide(count) === "allow") {
      run("pane.split", {
        direction: action.direction,
        ...(here.pane ? { pane: here.pane } : {}),
        ...(action.argv ? { argv: action.argv } : {}),
      });
    } else if (action.kind === "program") {
      cx.spawn((cx) => this.popup(action.argv, here.cwd));
    } else {
      notify({ ...refusal(count), level: "warning", timeout: 4000 });
    }
  }

  async popup(argv, cwd) {
    try {
      const r = await hc(popupArgs(cwd, argv));
      const terminal = JSON.parse(r.stdout).address;
      openOverlay({
        kind: "window", key: `two-up-${terminal}`, width: 0.8, height: 0.8,
        layout: popupLayout(terminal, argv[0]),
      });
    } catch (err) {
      notify({ title: "two-up: could not open window", body: String(err), level: "error" });
    }
  }

  bar() {
    const t = theme();
    const { terminal, title, overlay } = props();
    return h_flex().size_full().items_center().px(10).gap(8).bg(t.chrome).text_size(12)
      .child(div().flex_1().truncate().text_color(t.muted).child(title ?? terminal))
      .child(
        div().id("close").px(8).rounded(4).text_color(t.foreground).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => {
            run("terminal.kill", { terminal });
            closeOverlay(overlay);
          })
          .child("Close"),
      );
  }

  render() {
    if (props()?.role === "bar") return this.bar();
    for (const { tab, count } of overCap(panes())) {
      const key = `${tab}:${count}`;
      if (this.warned.has(key)) continue;
      this.warned.add(key);
      notify({
        title: `${count} terminals in one tab (max ${MAX_TERMINALS})`,
        body: "Something split past the cap. Close one, or move work to a new tab with Cmd-T.",
        level: "warning",
      });
    }
    return div().size_full();
  }
}
