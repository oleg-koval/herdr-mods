import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, focused, notify, panes, readTextFile, spaces, terminals, theme } from "herdr";
import { resumeNote } from "./note.js";
import { DEFAULT_CONTEXT_LABEL, contextLabelFrom } from "./label.js";

export default class Handoff extends View {
  init(_props, cx) {
    this.contextLabel = DEFAULT_CONTEXT_LABEL;
    cx.spawn(async (cx) => {
      this.contextLabel = contextLabelFrom(await readTextFile(`${appHome()}/settings.json`).catch(() => null));
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const focus = focused();
    const space = spaces().find((entry) => entry.id === focus?.space);
    const pane = panes().find((entry) => entry.pane === focus?.pane);
    const tab = space?.tabs.find((entry) => entry.id === focus?.tab);
    const terminal = terminals().find((entry) => entry.address === focus?.terminal);
    const context = terminal?.labels?.[this.contextLabel];
    const note = resumeNote({ space: space?.name, tab: tab?.name, folder: focus?.cwd, branch: pane?.branch, context });
    return v_flex().id("fielddesk-handoff").size_full().p(12).gap(8).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(h_flex().items_center().justify_between().gap(6)
        .child(div().text_color(t.foreground).text_size(15).child("Handoff"))
        .when(Boolean(focus?.terminal), (el) => el.child(div().id("fielddesk-copy").role("button").px(7).py(4).rounded(4)
          .text_size(11).text_color(t.accent).hover((s) => s.bg(t.hover)).cursor_pointer().on_click((_e, cx) => {
            cx.write_to_clipboard(note);
            notify({ title: "Resume note copied", level: "info", timeout: 2200 });
          }).child("Copy resume note"))))
      .child(div().truncate().text_size(12).text_color(t.muted).child(focus?.terminal ? (tab?.name ?? "Current session") : "Select a terminal"))
      .child(div().id("fielddesk-context").flex_1().min_h(0).p(8).rounded(5).bg(t.surface).overflow_y_scrollbar()
        .text_color(t.foreground).child(typeof context === "string" && context.trim() ? context : "No context note recorded"));
  }
}
