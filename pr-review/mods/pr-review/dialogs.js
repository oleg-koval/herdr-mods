// The two dialogs the board opens (role "setup" and role "why"). Not Views: pr-review's own View
// creates one and forwards init/render, so both share the board's engine.js and rules.js.
//
// Setup: pick the review skill, its model and its params for the default or one repo, then Save.
// Why: what the engine found when a PR failed or needs a person.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, home, props, setShared } from "herdr";
import {
  BUILTIN_SETTING, PR_ID_RE, chooseSkill, cli, commandPreview, describeSetting, filterSkills, formFor, logPathOk, setModel,
  setParam, toPayload, whySections,
} from "./rules.js";
import { engineBin, makeEngine } from "./engine.js";

// Tells the board (and any other copy) to read again: every mod re-renders when a shared value changes.
const changed = () => setShared("pr-review.changed", Date.now());

const chip = (t, id, label, on, onClick, { warn = false } = {}) =>
  div().id(id).px(9).py(3).rounded(6).border_1().text_size(11.5).cursor_pointer()
    .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.surface)
    .text_color(on ? t.foreground : warn ? (t.ansi3 ?? t.blocked) : t.muted)
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);

const action = (t, id, label, onClick, { primary = false, disabled = false } = {}) =>
  div().id(id).px(12).py(5).rounded(6).border_1().text_size(12).border_color(primary ? t.solid : t.border)
    .bg(primary ? t.solid : t.raised).text_color(disabled ? t.dim : primary ? t.solid_foreground : t.foreground)
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }))
    .child(label);

const shell = (t, title, body, footer, onKey, handle) =>
  v_flex().id("pr-review-dialog").track_focus(handle).size_full().min_h(0).p(18).gap(10).rounded(8).bg(t.popover).text_size(13)
    .on_key_down((e, cx) => {
      if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } else onKey?.(e, cx);
    })
    .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
    .child(body)
    .child(h_flex().justify_end().gap(8).child(footer));

export class SetupPane {
  init(cx) {
    this.engine = makeEngine(engineBin());
    this.scope = props()?.scope ?? "default";
    this.data = null;
    this.error = null;
    this.busy = false;
    this.form = null;
    this.inputs = {};
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search review skills…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.search.focus();
    cx.timer.after(600, () => this.search.focus());
    cx.spawn(async (cx) => {
      const r = await this.engine.json(cli.reviewConfig());
      if (r.data) {
        this.data = r.data;
        const own = this.scope === "default" ? r.data.config.default : r.data.config.repos[this.scope] ?? null;
        this.form = formFor(own, this.scope === "default" ? null : r.data.config.default);
        this.hasOwn = Boolean(own);
        this.rebuildInputs();
      } else this.error = r.error;
      cx.notify();
    });
  }

  skillInfo() {
    return this.data?.skills.find((s) => s.command === this.form?.skill) ?? null;
  }

  rebuildInputs() {
    this.inputs = {};
    for (const f of this.skillInfo()?.params ?? []) {
      if (f.kind !== "text") continue;
      const state = InputState.new({ placeholder: f.hint ?? f.label });
      state.set_value(String(this.form.params[f.id] ?? ""));
      state.on("change", (_e, cx) => { this.form = setParam(this.form, f.id, state.value().trim()); cx.notify(); });
      this.inputs[f.id] = state;
    }
  }

  send(argv, cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await this.engine.json(argv);
      this.busy = false;
      if (r.data) {
        changed();
        closeOverlay(props().overlay);
        return;
      }
      this.error = r.error;
      cx.notify();
    });
  }

  field(t, f, cx) {
    const value = this.form.params[f.id];
    const label = div().w(110).flex_none().text_size(11.5).text_color(t.muted).child(f.label);
    let control;
    if (f.kind === "choice") {
      control = h_flex().gap(5).flex_wrap().children([
        chip(t, `p-${f.id}-none`, "default", !value, (cx) => { this.form = setParam(this.form, f.id, ""); cx.notify(); }),
        ...f.options.map((o) => chip(t, `p-${f.id}-${o}`, o, value === o, (cx) => { this.form = setParam(this.form, f.id, o); cx.notify(); })),
      ]);
    } else if (f.kind === "flag") {
      control = chip(t, `p-${f.id}`, value ? "on" : "off", Boolean(value), (cx) => { this.form = setParam(this.form, f.id, !value); cx.notify(); });
    } else {
      control = h_flex().flex_1().h(28).px(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.background)
        .child(Input.new(this.inputs[f.id]).flex_1().h_full().text_size(12).text_color(t.foreground));
    }
    return h_flex().gap(10).items_center().child(label).child(div().flex_1().min_w(0).child(control));
  }

  render(t, cx) {
    const title = this.scope === "default" ? "Review setup · default for every repo" : `Review setup · ${this.scope}`;
    if (!this.data || !this.form) {
      return shell(t, title, div().p(8).text_color(this.error ? t.blocked : t.dim).child(this.error ?? "Loading skills…"),
        action(t, "close", "Close", () => closeOverlay(props().overlay)), null, this.handle);
    }
    const info = this.skillInfo();
    const skills = filterSkills(this.data.skills, this.search.value());
    const inherited = this.scope === "default" ? BUILTIN_SETTING : this.data.config.default ?? BUILTIN_SETTING;

    const list = v_flex().id("skill-list").h(170).flex_none().overflow_y_scrollbar().rounded(6).border_1().border_color(t.border)
      .children(skills.length ? skills.map((s) => {
        const on = s.command === this.form.skill;
        return v_flex().id(`skill-${s.command}`).px(10).py(5).gap(1).cursor_pointer().bg(on ? t.selected : t.popover)
          .hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.form = chooseSkill(this.form, s.command); this.rebuildInputs(); cx.notify(); })
          .child(h_flex().gap(8).items_center()
            .child(div().text_size(12.5).text_color(t.foreground).child(s.command))
            .child(div().text_size(10.5).text_color(t.dim).child(s.source))
            .child(div().flex_1())
            .child(div().text_size(10.5).text_color(s.tested ? t.done : (t.ansi3 ?? t.blocked)).child(s.tested ? "tested" : "untested")))
          .child(div().truncate().text_size(11).text_color(t.dim).child(s.description || "no description"));
      }) : [div().p(10).text_size(12).text_color(t.dim).child("No review skill matches")]);

    const model = h_flex().gap(10).items_center().child(div().w(110).flex_none().text_size(11.5).text_color(t.muted).child("Model"))
      .child(h_flex().gap(5).children(this.data.models.map((m) => chip(t, `m-${m}`, m, this.form.model === m, (cx) => { this.form = setModel(this.form, m); cx.notify(); }))));

    const params = info?.params?.length
      ? v_flex().gap(7).children(info.params.map((f) => this.field(t, f, cx)))
      : div().text_size(11.5).text_color(t.dim).child(info?.hint ? "This skill's argument hint has no optional parameters." : "This skill declares no parameters (no argument-hint).");

    const body = v_flex().flex_1().min_h(0).gap(10)
      .child(h_flex().h(30).px(10).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.search).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
      .child(list)
      .child(model)
      .child(params)
      .child(div().text_size(11).text_color(t.dim).child(`Runs: ${commandPreview(this.form, info)}  ·  inherits ${describeSetting(inherited)}`))
      .when(info && !info.tested, (el) => el.child(div().text_size(11.5).text_color(t.ansi3 ?? t.blocked)
        .child("Untested under the unattended guard. It can fail with guard denials or \"no review file saved\"; the Why button on a failed PR shows what blocked it.")))
      .when(this.error, (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)));

    const footer = h_flex().gap(8)
      .when(this.hasOwn, (el) => el.child(action(t, "clear", this.scope === "default" ? "Use built-in" : "Use default", (cx) => this.send(cli.clearReview(this.scope), cx), { disabled: this.busy })))
      .child(action(t, "cancel", "Cancel", () => closeOverlay(props().overlay)))
      .child(action(t, "save", this.busy ? "Saving…" : "Save", (cx) => this.send(cli.saveReview(this.scope, toPayload(this.form)), cx), { primary: true, disabled: this.busy }));
    return shell(t, title, body, footer, null, this.handle);
  }
}

export class WhyPane {
  init(cx) {
    this.engine = makeEngine(engineBin());
    this.prId = String(props()?.prId ?? "");
    this.diag = null;
    this.error = null;
    this.note = null;
    this.handle = cx.focus_handle();
    if (!PR_ID_RE.test(this.prId)) { this.error = "not a PR id"; return; }
    cx.spawn(async (cx) => {
      const r = await this.engine.json(cli.why(this.prId));
      if (r.data) this.diag = r.data;
      else this.error = r.error;
      cx.notify();
    });
  }

  openLog(cx) {
    cx.spawn(async (cx) => {
      let path = null;
      try {
        const r = await exec("realpath", [String(this.diag.log_path)]);
        if (r.code === 0) path = r.stdout.trim();
      } catch {}
      if (logPathOk(path, home())) await exec("open", ["-t", path]).catch(() => null);
      else { this.note = "log file missing or outside the logs folder"; cx.notify(); }
    });
  }

  retry(cx) {
    cx.spawn(async (cx) => {
      const r = await this.engine.command(cli.retry(this.prId));
      if (r.ok) { changed(); closeOverlay(props().overlay); return; }
      this.note = r.error;
      cx.notify();
    });
  }

  render(t, cx) {
    const title = `Why · ${this.prId}`;
    if (!this.diag) {
      return shell(t, title, div().p(8).text_color(this.error ? t.blocked : t.dim).child(this.error ?? "Reading the run…"),
        action(t, "close", "Close", () => closeOverlay(props().overlay)), null, this.handle);
    }
    const d = this.diag;
    const sections = whySections(d);
    const body = v_flex().id("why-body").flex_1().min_h(0).overflow_y_scrollbar().gap(10)
      .children(sections.map((s, i) => v_flex().id(`why-${i}`).gap(2)
        .child(div().text_size(12.5).font_semibold().text_color(t[s.tone] ?? t.foreground).child(s.title))
        .children(s.lines.map((line) => div().text_size(12).text_color(t.muted).child(line)))))
      .when(this.note, (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.note)));
    const footer = h_flex().gap(8)
      .when(Boolean(d.log_path) && !d.log_missing, (el) => el.child(action(t, "log", "Open log", (cx) => this.openLog(cx))))
      .when(d.status === "FAILED", (el) => el.child(action(t, "retry", "Retry", (cx) => this.retry(cx))))
      .child(action(t, "close", "Close", () => closeOverlay(props().overlay), { primary: true }));
    return shell(t, title, body, footer, null, this.handle);
  }
}

