import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { checking, exec, focused, nextCommand, notify, openOverlay, panes, run, spaces, theme } from "herdr";
import { checkJevDashboard } from "./jev.js";

const jevStates = {
  checking: ["Checking", "muted"],
  connected: ["Connected", "#16a34a"],
  unreachable: ["Unreachable", "blocked"],
  unknown: ["Unknown", "muted"],
};

function action(t, id, icon, label, click) {
  return h_flex().id(`fielddesk-${id}`).role("button").accessibility_label(label).tooltip(label)
    .size(28).items_center().justify_center().rounded(4).flex_none()
    .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().on_click(click)
    .child(svg(`mods/workspace-chrome/${icon}.svg`).size(16));
}

export default class RepositoryStrip extends View {
  init(_props, cx) {
    this.jevStatus = "checking";
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "new-task") this.openTask();
      }
    });
    this.refreshJev(cx);
    cx.timer.every(15_000, (cx) => this.refreshJev(cx));
  }

  refreshJev(cx) {
    cx.spawn(async (cx) => {
      const status = await checkJevDashboard(exec);
      if (status === this.jevStatus) return;
      this.jevStatus = status;
      cx.notify();
    });
  }

  openTask() {
    const focus = focused();
    const space = spaces().find((entry) => entry.id === focus?.space);
    const folder = space?.folder || focus?.cwd;
    if (!space || !folder) return;
    openOverlay({
      mod: "fielddesk-task", kind: "dialog", width: 420,
      props: { space: space.id, folder, machine: space.machine },
    });
  }

  render() {
    const t = theme();
    const focus = focused();
    const space = spaces().find((entry) => entry.id === focus?.space);
    const pane = panes().find((entry) => entry.pane === focus?.pane);
    const folder = focus?.cwd || space?.folder || "";
    const project = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? space?.name ?? "No workspace";
    const [jevLabel, jevColor] = jevStates[this.jevStatus];
    const jevTooltip = `Jev dashboard: ${jevLabel}`;
    return h_flex().size_full().min_w(0).px(12).gap(9).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_none().text_color(t.accent).child("Fielddesk"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted)
        .child([project, pane?.branch, space?.machine ?? (space ? "Local" : null)].filter(Boolean).join("  /  ")))
      .when(Boolean(space && folder), (el) => el.child(action(t, "new-task", "folder-plus", "New task", () => this.openTask())))
      .when(Boolean(folder), (el) => el.child(action(t, "copy-folder", "files", "Copy path", (_e, cx) => {
        cx.write_to_clipboard(folder);
        notify({ title: "Folder path copied", level: "info", timeout: 2200 });
      })))
      .child(action(t, "rail-toggle", "panel-right", "Toggle desk panel", () => run("layout.toggle", { id: "fielddesk-rail" })))
      .child(h_flex().id("fielddesk-jev-status").role("status").accessibility_label(jevTooltip).tooltip(jevTooltip)
        .size(24).flex_none().items_center().justify_center()
        .child(div().size(8).rounded_full().bg(t[jevColor] ?? jevColor)));
  }
}
