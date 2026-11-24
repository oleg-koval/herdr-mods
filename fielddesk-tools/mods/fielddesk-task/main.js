import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { appHome, closeOverlay, exec, home, panes, props, readTextFile, run, spaces, theme } from "herdr";
import { taskBranch, taskWorktree } from "./worktree.js";

export default class Task extends View {
  init(_props, cx) {
    this.input = InputState.new({ value: "", placeholder: "Fix catalog sync" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.timer.after(100, () => this.input.focus());
    this.busy = false;
    this.error = "";
  }

  submit(cx) {
    if (this.busy) return;
    const name = this.input.value().trim();
    const { space, folder, machine, overlay } = props();
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const branch = taskBranch(name);
        if (!spaces().some((entry) => entry.id === space)) throw new Error("The project space is closed.");
        const git = async (cwd, args) => {
          const result = await exec("git", args, { cwd, on: machine, timeout: 120000 });
          if (result.code !== 0) throw new Error((result.stderr || result.stdout || "Git failed.").trim());
          return result.stdout.trimEnd();
        };
        const settings = JSON.parse(await readTextFile(`${appHome()}/settings.json`) ?? "{}");
        let directory = settings.worktrees?.directory ?? "~/.herdr/worktrees";
        if (typeof directory !== "string") throw new Error("Set a worktree folder in Herdr settings.");
        if (directory === "~" || directory.startsWith("~/")) {
          const result = machine && await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
          if (machine && (result.code !== 0 || !result.stdout.trim())) throw new Error("Could not find the remote home folder.");
          directory = (machine ? result.stdout.trim() : home()) + directory.slice(1);
        }
        if (!directory.startsWith("/")) throw new Error("Use an absolute worktree folder or a path starting with ~/.");
        const checkout = await taskWorktree(git, folder, directory.replace(/\/+$/, ""), branch);
        const project = spaces().find((entry) => entry.id === space);
        if (!project) throw new Error(`Worktree ready at ${checkout}. Reopen the project space and retry.`);
        const projectTabs = new Map(project.tabs.map((tab) => [tab.id, tab]));
        const existing = panes().find((pane) => {
          const tab = projectTabs.get(pane.tab);
          return tab && (pane.cwd === checkout || pane.cwd?.startsWith(checkout + "/") ||
            (tab.named && tab.name === name && pane.branch === branch));
        });
        if (existing) run("pane.focus", { pane: existing.pane });
        else run("tab.new", { space, folder: checkout, name });
        closeOverlay(overlay);
      } catch (error) {
        this.error = String(error.message ?? error);
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const button = (id, label, click) => div().id(id).role("button").px(10).py(6)
      .rounded(5).bg(t.surface).hover((s) => s.bg(t.hover)).cursor_pointer().on_click(click).child(label);
    return v_flex().id("fielddesk-task").w_full().p(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child("New task"))
      .child(div().text_color(t.muted).child("Create a worktree and open a named tab in this project."))
      .child(Input.new(this.input).h(34).px(8).rounded(5).border(1).border_color(t.input).bg(t.background))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().justify_end().gap(8)
        .when(!this.busy, (el) => el.child(button("task-cancel", "Cancel", () => closeOverlay(props().overlay))))
        .child(button("task-create", this.busy ? "Creating…" : "Open task", (_e, cx) => this.submit(cx))));
  }
}
