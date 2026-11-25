import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle, InputState, Input } from "gpui-base";
import {
  agents, checking, closeOverlay, exec, hc, nextCommand, notify, openOverlay, panes, props, run,
  setShared, shared, spaces, theme,
} from "herdr";
import {
  allToggleLabel, avatarColor, avatarLetter, closeConfirm, expandAll, isExpanded, liveSelection, mergeConfirm,
  mergeSummary, needsYou, planMerge, renamePlan, rowTail, selectState, tabLabel, tally, toggleAllSelected,
  toggleExpanded, toggleSelected,
} from "./plan.js";
import { moveTerminals, stillOpen } from "./move.js";

const SELECTED = "fielddesk-spaces.selected";
const EXPANDED = "fielddesk-spaces.expanded";
// Merge and Close ask first through Herdr's confirm mod, which runs exactly one command. That
// command is ours, "fielddesk-spaces.<kind>"; the chosen spaces wait here until it arrives.
const PENDING = "fielddesk-spaces.pending";
const PENDING_MAX_MS = 10 * 60 * 1000;

const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`);
const io = {
  run, hc, panes, spaces,
  sleep: (ms) => exec("sleep", [String(ms / 1000)]),
};

function checkbox(t, state) {
  const on = state !== "none";
  return h_flex().size(14).flex_none().items_center().justify_center().rounded(3).border_1()
    .border_color(on ? t.accent : t.dim).when(on, (el) => el.bg(t.accent))
    .when(on, (el) => el.child(icon(state === "all" ? "check" : "minus").size(10).text_color(t.accent_foreground)));
}

function textButton(t, id, label, click, { disabled = false, danger = false } = {}) {
  return h_flex().id(id).role("button").accessibility_label(label).h(24).px(7).flex_none().items_center().rounded(5)
    .text_size(11.5).text_color(t.muted)
    .when(disabled, (el) => el.opacity(0.4))
    .when(!disabled, (el) => el.cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(danger ? t.blocked : t.foreground)).on_click(click))
    .child(label);
}

export default class FielddeskSpaces extends View {
  init(_props, cx) {
    this.rename = props()?.view === "rename";
    this.hover = null;
    this.busy = null;
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    if (this.rename) return this.initRename(cx);
    if (checking()) return;
    setShared(SELECTED, []);
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "merge") await this.applyMerge(cx);
        else if (command === "close") this.applyClose(cx);
      }
    });
  }

  async close() {
    this.prefix?.release();
    this.suffix?.release();
  }

  selection() {
    return liveSelection(shared(SELECTED) ?? [], spaces());
  }

  // Merge and Close: remember what was chosen, then let the confirm mod run our command.
  ask(kind, { title, detail }) {
    setShared(PENDING, { kind, ids: this.selection(), at: Date.now() });
    openOverlay({
      mod: "confirm", kind: "dialog", width: 420, height: 200,
      props: { title, detail, command: { name: `fielddesk-spaces.${kind}`, args: {} } },
    });
  }

  // A copy takes the plan once, so a second copy of this mod hearing the command does nothing.
  takePending(kind) {
    const pending = shared(PENDING);
    if (!pending || pending.kind !== kind || Date.now() - pending.at > PENDING_MAX_MS) return null;
    setShared(PENDING, null);
    return pending.ids;
  }

  askMerge() {
    const all = spaces();
    const plan = planMerge(all, panes(), this.selection());
    if (!plan.sources.length) return;
    const t = tally(all, panes(), agents(), plan.sources.map((space) => space.id));
    this.ask("merge", mergeConfirm(plan, t));
  }

  askClose() {
    const ids = this.selection();
    if (ids.length) this.ask("close", closeConfirm(tally(spaces(), panes(), agents(), ids)));
  }

  async applyMerge(cx) {
    const ids = this.takePending("merge");
    if (!ids || this.busy) return;
    const plan = planMerge(spaces(), panes(), liveSelection(ids, spaces()));
    if (!plan.sources.length) return;
    this.busy = "Merging…";
    cx.notify();
    try {
      const result = await moveTerminals(plan, io);
      const remaining = await stillOpen(plan, io);
      notify(mergeSummary(plan, result, remaining));
      run("space.select", { id: plan.target.id });
    } catch (error) {
      notify({ title: "Merge failed", body: String(error?.message ?? error), level: "error" });
    }
    this.busy = null;
    setShared(SELECTED, []);
    cx.notify();
  }

  applyClose(cx) {
    const ids = this.takePending("close");
    if (!ids) return;
    for (const id of liveSelection(ids, spaces())) run("space.close", { id, confirmed: true });
    setShared(SELECTED, []);
    cx.notify();
  }

  openRename() {
    openOverlay({ mod: "fielddesk-spaces", kind: "dialog", width: 380, props: { view: "rename", ids: this.selection() } });
  }

  header(t, all, expanded, picked) {
    return h_flex().h(31).px(10).gap(8).items_center().flex_none().text_size(11.5).text_color(t.dim)
      .child(h_flex().id("fielddesk-spaces-all").role("check_box").accessibility_label("Select all spaces").size(20).flex_none()
        .items_center().justify_center().cursor_pointer()
        .on_click((_e, cx) => { setShared(SELECTED, toggleAllSelected(picked, all)); cx.notify(); })
        .child(checkbox(t, selectState(picked, all))))
      .child(div().flex_1().child("Spaces"))
      .child(textButton(t, "fielddesk-spaces-toggle", allToggleLabel(expanded, all), (_e, cx) => {
        setShared(EXPANDED, allToggleLabel(expanded, all) === "Collapse all" ? {} : expandAll(all));
        cx.notify();
      }))
      .child(h_flex().id("fielddesk-spaces-new").role("button").accessibility_label("New space").tooltip("New space").size(24).flex_none()
        .items_center().justify_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new")).child(icon("plus").size(14)));
  }

  batchBar(t, all, picked) {
    const plan = planMerge(all, panes(), picked);
    const idle = !this.busy;
    return h_flex().id("fielddesk-spaces-batch").mx(8).mb(4).h(32).px(8).gap(2).items_center().flex_none().rounded(7).bg(t.raised)
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(this.busy ?? `${picked.length} selected`))
      .child(textButton(t, "fielddesk-spaces-rename", "Rename", () => this.openRename(), { disabled: !idle }))
      .child(textButton(t, "fielddesk-spaces-merge", "Merge", () => this.askMerge(), { disabled: !idle || !plan.sources.length }))
      .child(textButton(t, "fielddesk-spaces-close", "Close", () => this.askClose(), { disabled: !idle, danger: true }))
      .child(h_flex().id("fielddesk-spaces-clear").role("button").accessibility_label("Clear selection").tooltip("Clear selection")
        .size(22).flex_none().items_center().justify_center().rounded(5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { setShared(SELECTED, []); cx.notify(); })
        .child(icon("x").size(12)));
  }

  spaceRow(t, space, index, state) {
    const { picked, expanded, colors, anySelected } = state;
    const open = isExpanded(expanded, space.id);
    const chosen = picked.includes(space.id);
    const showCheck = chosen || anySelected || this.hover === space.id;
    const tail = rowTail(space);
    const fill = avatarColor(colors[space.id], index, t);
    return h_flex().id(`fielddesk-space-${space.id}`).h(30).pl(4).pr(8).gap(4).items_center().flex_none().rounded(7).cursor_pointer()
      .when(space.active, (el) => el.bg(t.selected))
      .when(!space.active && chosen, (el) => el.bg(t.hover))
      .when(!space.active && !chosen, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((hovered, cx) => {
        const next = hovered ? space.id : (this.hover === space.id ? null : this.hover);
        if (next !== this.hover) { this.hover = next; cx.notify(); }
      })
      .on_click(() => run("space.select", { id: space.id }))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: space.id } } }))
      .child(h_flex().id(`fielddesk-space-chevron-${space.id}`).role("button").accessibility_label(open ? "Collapse" : "Expand")
        .size(18).flex_none().items_center().justify_center().rounded(4).text_color(t.dim)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); setShared(EXPANDED, toggleExpanded(expanded, space.id)); cx.notify(); })
        .child(icon(open ? "chevron-down" : "chevron-right").size(12)))
      .child(h_flex().id(`fielddesk-space-pick-${space.id}`).role("check_box").accessibility_label(`Select ${space.name}`)
        .size(18).flex_none().items_center().justify_center().rounded(5)
        .when(!showCheck, (el) => el.bg(fill).text_size(10.5).font_bold().text_color("#ffffff").child(avatarLetter(space.name)))
        .when(showCheck, (el) => el.child(checkbox(t, chosen ? "all" : "none")))
        .on_click((_e, cx) => { cx.stop_propagation(); setShared(SELECTED, toggleSelected(picked, space.id)); cx.notify(); }))
      .child(div().flex_1().min_w(0).truncate().ml(5).text_color(space.active ? t.foreground : t.muted).child(space.name))
      .when(Boolean(tail), (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(tail)))
      .when(needsYou(space.status), (el) => el.child(div().flex_none().text_color(t[space.status]).child("●")));
  }

  tabRow(t, space, tab) {
    const on = space.active && tab.active;
    return h_flex().id(`fielddesk-tab-${tab.id}`).h(26).pl(46).pr(8).gap(7).items_center().flex_none().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => {
        if (!space.active) run("space.select", { id: space.id });
        run("tab.select", { id: tab.id });
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(on ? t.foreground : t.muted).child(tabLabel(tab)))
      .when(needsYou(tab.status), (el) => el.child(div().flex_none().text_color(t[tab.status]).child("●")));
  }

  // The list's direct children, and where the active space's row is among them.
  rows(t, all, state) {
    const rows = all.flatMap((space, index) => [
      this.spaceRow(t, space, index, state),
      ...(isExpanded(state.expanded, space.id) ? space.tabs.map((tab) => this.tabRow(t, space, tab)) : []),
    ]);
    const before = all.slice(0, Math.max(all.findIndex((space) => space.active), 0))
      .reduce((sum, space) => sum + 1 + (isExpanded(state.expanded, space.id) ? space.tabs.length : 0), 0);
    return { rows, activeAt: all.some((space) => space.active) ? before : -1 };
  }

  initRename(cx) {
    const make = (name) => {
      const input = InputState.new({ placeholder: name });
      input.on("change", (_e, cx) => cx.notify());
      input.on("submit", () => this.submitRename());
      input.on("focus", () => { this.field = name; });
      return input;
    };
    this.prefix = make("Prefix");
    this.suffix = make("Suffix");
    this.field = "Prefix";
    this.handle = cx.focus_handle();
    this.prefix.focus();
    cx.timer.after(600, () => this.prefix.focus());
  }

  renameItems() {
    return renamePlan(spaces(), props()?.ids ?? [], this.prefix.value(), this.suffix.value());
  }

  submitRename() {
    const items = this.renameItems();
    closeOverlay(props().overlay);
    for (const item of items) run("space.rename", { id: item.id, name: item.name });
    setShared(SELECTED, []);
  }

  renderRename() {
    const t = theme();
    const items = this.renameItems();
    const chosen = (props()?.ids ?? []).length;
    const count = `${chosen} ${chosen === 1 ? "space" : "spaces"}`;
    const field = (label, input) => v_flex().gap(5)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(Input.new(input).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground));
    const button = (id, label, primary, click, disabled = false) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5)
      .when(disabled, (el) => el.opacity(0.4))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(click))
      .child(label);
    return v_flex().id("fielddesk-spaces-rename-dialog").track_focus(this.handle).w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "tab") (this.field === "Prefix" ? this.suffix : this.prefix).focus();
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`Rename ${count}`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(field("Prefix", this.prefix))
      .child(field("Suffix", this.suffix))
      .child(v_flex().gap(3).text_size(11.5).text_color(t.muted)
        .children(items.slice(0, 3).map((item) => div().truncate().child(`${item.from}  →  ${item.name}`)))
        .when(items.length > 3, (el) => el.child(div().text_color(t.dim).child(`and ${items.length - 3} more`))))
      .child(h_flex().gap(8).justify_end()
        .child(button("fielddesk-rename-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("fielddesk-rename-apply", "Rename", true, () => this.submitRename(), !items.length)));
  }

  render() {
    if (this.rename) return this.renderRename();
    const t = theme();
    const all = spaces();
    const picked = liveSelection(shared(SELECTED) ?? [], all);
    const expanded = shared(EXPANDED) ?? {};
    const state = { picked, expanded, colors: shared("space.colors") ?? {}, anySelected: picked.length > 0 };
    const { rows, activeAt } = this.rows(t, all, state);
    const active = all.find((space) => space.active)?.id ?? null;
    const place = `${active}@${activeAt}`;
    if (place !== this.revealed) {
      this.revealed = place;
      if (activeAt >= 0) this.scroll.scroll_to_item(activeAt);
    }
    return v_flex().id("fielddesk-spaces").size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(this.header(t, all, expanded, picked))
      .when(picked.length > 0, (el) => el.child(this.batchBar(t, all, picked)))
      .child(v_flex().id("fielddesk-spaces-list").flex_1().min_h(0).px(8).pb(12).gap(1).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows));
  }
}
