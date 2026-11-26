// pr-review: the PR-autoreview board, a tab of its own (Ctrl-Cmd-R).
//
// Role "board" is the tab: views, filter, pages, a button row per PR. The always-on guard (chord and Dock
// badge) is the separate mod pr-review-guard.
// The data is `pr-autoreview panel --json`; every decision about it lives in rules.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { checking, closeOverlay, exec, home, nextCommand, props, settings, theme } from "herdr";
import {
  PR_ID_RE, REPO_RE, VIEWS, VIEW_LABEL, actionsFor, age, clampIndex, cli, countdown, failedCount,
  filterRows, miniStatus, money, nextView, pageOf, paginate, prUrl,
  pullsUrl, queuedCount, reviewPathOk, shortRepo, statusMeta, viewCount, viewRows,
} from "./rules.js";
import { engineBin, makeEngine } from "./engine.js";

const ROW_H = 52;
const REFRESH_MS = 30000;

export default class PrReview extends View {
  init(_props, cx) {
    if (props()?.role === "board") this.initBoard(cx);
    // The guard used to live here as a kept window recorded with this mod and no role; close it once.
    else if (props()?.overlay) closeOverlay(props().overlay);
  }

  // ---------- board ----------

  initBoard(cx) {
    this.engine = makeEngine(engineBin());
    // props.view / props.query open the board already filtered (a deep link, and how the screenshots are taken).
    this.view = VIEWS.includes(props()?.view) ? props().view : "needs";
    this.query = typeof props()?.query === "string" ? props().query : "";
    this.sel = 0;
    this.pageSize = 8;
    this.snap = null;
    this.okAt = 0;
    this.error = null;
    this.note = null;
    this.busy = false;
    this.acting = false;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Filter…" });
    if (this.query) this.input.set_value(this.query);
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.sel = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.act(this.current(), null, cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    if (checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.input.focus();
      }
    });
    this.refresh(cx, true);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx, false));
  }

  rows() {
    return this.snap ? filterRows(viewRows(this.snap, this.view), this.query) : [];
  }

  current() {
    const rows = this.rows();
    return rows[clampIndex(this.sel, rows.length)] ?? null;
  }

  // Overlapping fetches never stack: a second call while one runs does nothing.
  refresh(cx, force) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const seq = this.startRead();
      const r = await this.engine.read(force);
      this.busy = false;
      this.take(r, seq);
      cx.notify();
    });
  }

  // A refresh and a write can read at the same time; numbering reads by when they started lets
  // take() drop one that started before the snapshot already on screen.
  startRead() {
    this.readSeq = (this.readSeq ?? 0) + 1;
    return this.readSeq;
  }

  take(r, seq) {
    if (seq < (this.takenSeq ?? 0)) return;
    this.takenSeq = seq;
    if (r.snap) {
      this.snap = r.snap;
      this.okAt = Date.now();
      this.error = null;
    } else {
      this.error = r.error;
    }
  }

  // Writes: perform one engine action, then show the fresh document. One at a time.
  write(label, argv, printsJson, cx) {
    if (this.acting) return;
    this.acting = true;
    this.note = { text: `${label}…`, tone: "dim" };
    cx.notify();
    cx.spawn(async (cx) => {
      let seq = this.startRead();
      let r = printsJson ? await this.engine.panel(argv) : await this.engine.command(argv);
      if (r.ok) {
        seq = this.startRead();
        r = await this.engine.read();
      }
      this.acting = false;
      if (r.snap) {
        this.take(r, seq);
        this.note = { text: `${label}: done`, tone: "done" };
      } else {
        this.note = { text: `${label}: ${r.error}`, tone: "blocked" };
      }
      cx.notify();
    });
  }

  openUrl(url, cx) {
    if (!url) {
      this.note = { text: "refused to open: not a github.com link", tone: "blocked" };
      cx.notify();
      return;
    }
    cx.spawn(async () => {
      await exec("open", [url]).catch(() => null);
    });
  }

  openReview(file, cx) {
    cx.spawn(async (cx) => {
      let path = null;
      try {
        const r = await exec("realpath", [String(file)]);
        if (r.code === 0) path = r.stdout.trim();
      } catch {}
      if (reviewPathOk(path, home())) {
        await exec("open", [path]).catch(() => null);
      } else {
        this.note = { text: "review file missing or outside the reviews folder", tone: "blocked" };
        cx.notify();
      }
    });
  }

  // id null: the row's primary action (Enter).
  act(row, id, cx) {
    if (!row) return;
    const options = actionsFor(row);
    const action = id ? options.find((a) => a.id === id) : options.find((a) => a.primary);
    if (!action) return;
    if (row.kind === "pr" || row.kind === "run") {
      const subject = row.kind === "pr" ? row.pr : row.run;
      if (action.id === "open") this.openUrl(prUrl(subject.url), cx);
      else if (action.id === "review") this.openReview(row.pr.review_file, cx);
      else if (action.id === "retry" && PR_ID_RE.test(row.pr.id)) this.write(`Retry ${shortRepo(row.pr.repo)}#${row.pr.number}`, cli.retry(row.pr.id), false, cx);
    } else if (row.kind === "repo") {
      if (action.id === "pulls") this.openUrl(pullsUrl(row.repo.repo), cx);
      else if (action.id === "toggle" && REPO_RE.test(row.repo.repo)) {
        this.write(`${row.repo.off ? "Watch" : "Ignore"} ${shortRepo(row.repo.repo)}`, cli.repo(row.repo.repo, !row.repo.off), false, cx);
      }
    }
  }

  setView(view, cx) {
    this.view = view;
    this.sel = 0;
    this.input.focus();
    cx.notify();
  }

  cycleView(step, cx) {
    this.setView(nextView(this.view, step), cx);
  }

  key(e, cx) {
    const k = e.key;
    const total = this.rows().length;
    if (k === "escape") {
      if (!this.query) return;
      this.query = "";
      this.input.set_value("");
      this.sel = 0;
    } else if (k === "down") this.sel = clampIndex(this.sel + 1, total);
    else if (k === "up") this.sel = clampIndex(this.sel - 1, total);
    else if (k === "pagedown") this.sel = clampIndex(this.sel + this.pageSize, total);
    else if (k === "pageup") this.sel = clampIndex(this.sel - this.pageSize, total);
    else if (k === "tab") this.cycleView(e.modifiers.shift ? -1 : 1, cx);
    else if (k === "o" && e.modifiers.control) this.act(this.current(), "review", cx);
    else if (k === "r" && e.modifiers.control) this.act(this.current(), "retry", cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---------- drawing ----------

  button(t, id, label, onClick, { primary = false, disabled = false } = {}) {
    return div()
      .id(id)
      .px(8)
      .py(3)
      .rounded(5)
      .border_1()
      .border_color(t.border)
      .text_size(11)
      .text_color(disabled ? t.dim : primary ? t.foreground : t.muted)
      .when(!disabled, (el) =>
        el.cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => {
          cx.stop_propagation();
          onClick(cx);
          this.input.focus();
        }),
      )
      .child(label);
  }

  rowButtons(t, row, i) {
    return h_flex()
      .gap(4)
      .flex_none()
      .children(actionsFor(row).map((a) => this.button(t, `a-${row.key}-${a.id}`, a.label, (cx) => { this.sel = i; this.act(row, a.id, cx); cx.notify(); }, { primary: a.primary })));
  }

  line(t, row, i, on) {
    const base = h_flex()
      .id(`row-${row.key}`)
      .h(ROW_H)
      .mx(6)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.sel = i; this.input.focus(); cx.notify(); });
    const now = Date.now();
    const text = (top, bottom) =>
      v_flex().flex_1().min_w(0).gap(2).justify_center().child(top).child(div().truncate().text_size(11).text_color(t.dim).child(bottom));

    if (row.kind === "pr") {
      const p = row.pr;
      const meta = statusMeta(p.status);
      const top = h_flex().gap(6).items_center().min_w(0)
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`${shortRepo(p.repo)} #${p.number}`))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(p.title ?? ""));
      const bottom = [`@${p.author ?? "?"}`, age(p.updated_at, now), meta.label, ...(p.reasons ?? [])].filter(Boolean).join(" · ");
      return base.child(div().w(14).flex_none().text_color(t[meta.tone] ?? t.dim).child(meta.glyph)).child(text(top, bottom)).child(this.rowButtons(t, row, i));
    }
    if (row.kind === "repo") {
      const r = row.repo;
      const n = (v) => (v == null ? "?" : String(v));
      const top = div().truncate().text_size(13).text_color(r.off ? t.dim : t.foreground).child(r.repo);
      const bottom = `${n(r.open)} open · ${n(r.prod)} prod · ${n(r.merged)} merged today${r.off ? " · ignored" : ""}`;
      const knob = div().size(10).rounded(5).bg(t.foreground).when(!r.off, (el) => el.ml(12));
      const sw = h_flex().w(26).h(14).flex_none().px(2).items_center().rounded(7).bg(r.off ? t.border : t.done).child(knob);
      return base.child(sw).child(text(top, bottom)).child(this.rowButtons(t, row, i));
    }
    const r = row.run;
    const top = div().truncate().text_size(13).text_color(t.foreground).child(`${shortRepo(r.pr_id.split("#")[0])} #${r.pr_id.split("#")[1]} · attempt ${r.attempt}`);
    const bottom = [money(r.cost), r.minutes == null ? "" : `${Math.round(r.minutes)} min`, age(r.at, now), r.error ? "error" : ""].filter(Boolean).join(" · ");
    return base
      .child(div().w(14).flex_none().text_color(r.error ? t.blocked : t.done).child(r.error ? "✕" : "✓"))
      .child(text(top, r.pr_id.split("#")[0] + " · " + bottom))
      .child(this.rowButtons(t, row, i));
  }

  rail(t) {
    const snap = this.snap;
    const item = (v) =>
      h_flex()
        .id(`view-${v}`)
        .h(30)
        .px(10)
        .items_center()
        .rounded(7)
        .text_size(13)
        .cursor_pointer()
        .text_color(this.view === v ? t.foreground : t.muted)
        .when(this.view === v, (el) => el.bg(t.hover).font_semibold())
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.setView(v, cx))
        .child(div().flex_1().child(VIEW_LABEL[v]))
        .child(div().text_size(11).text_color(t.dim).child(snap ? String(viewCount(snap, v)) : ""));
    const small = (text, color) => div().text_size(11).truncate().text_color(color ?? t.muted).child(text);
    const warn = t.ansi3 ?? t.blocked;

    const status = [];
    if (snap) {
      status.push(small(snap.live ? "● live" : "❚❚ paused", snap.live ? t.done : warn));
      if (snap.stale) status.push(small("heartbeat STALE", t.blocked));
      const running = `${snap.running}/${snap.max_concurrent} running · ${queuedCount(snap)} queued`;
      status.push(snap.running > 0
        ? div().id("pr-review-running").text_size(11).truncate().cursor_pointer()
          .text_color(this.view === "running" ? t.foreground : t.working ?? t.muted)
          .hover((s) => s.text_color(t.foreground)).tooltip("Show the PRs being reviewed now")
          .on_click((_e, cx) => this.setView("running", cx)).child(running)
        : small(running));
      status.push(small(`${money(snap.cost_today)} today · ${snap.runs_today} runs`));
      if (snap.denials_today > 0) status.push(small(`${snap.denials_today} guard denials`, warn));
      for (const m of [miniStatus("DM", snap.dm), miniStatus("Team", snap.team)]) status.push(small(m.text, t[m.tone] ?? t.dim));
    }
    const failed = snap ? failedCount(snap) : 0;
    const act = (id, label, argv) =>
      this.button(t, id, label, (cx) => this.write(label, argv, true, cx), { disabled: this.acting || !this.snap });

    return v_flex()
      .w(190)
      .flex_none()
      .h_full()
      .p(12)
      .gap(2)
      .bg(t.chrome)
      .border_r(1)
      .border_color(t.border)
      .child(div().px(10).pb(8).text_size(15).font_semibold().text_color(t.foreground).child("PR review"))
      .children(VIEWS.map(item))
      .child(v_flex().flex_1().gap(3).px(10).pt(14).children(status))
      .child(
        v_flex()
          .gap(6)
          .when(snap, (el) => el.child(act("pause", snap.live ? "Pause" : "Resume", cli.pause())))
          .when(failed > 0, (el) => el.child(act("retry-failed", `Retry failed (${failed})`, cli.retryFailed())))
          // Refresh asks GitHub (a sync), so a PR assigned a moment ago shows up; before the first
          // snapshot it can only re-read, since a sync needs a working engine.
          .child(
            snap
              ? act("refresh", this.acting ? "Refreshing…" : "Refresh", cli.sync())
              : this.button(t, "refresh", this.busy ? "Refreshing…" : "Refresh", (cx) => this.refresh(cx, true), { disabled: this.busy }),
          ),
      );
  }

  banner(t) {
    const now = Date.now();
    const notes = [];
    // Before any good data the body shows the reason; the banner is for stale data only.
    if (this.error && this.snap) {
      const mins = Math.floor((now - this.okAt) / 60000);
      notes.push({ text: `couldn't refresh: ${this.error} · data from ${mins < 1 ? "under a minute" : `${mins}m`} ago`, color: t.ansi3 ?? t.blocked });
    }
    if (this.note) notes.push({ text: this.note.text, color: t[this.note.tone] ?? t.dim });
    return notes.map((n, i) => div().id(`note-${i}`).px(14).py(5).text_size(11).truncate().text_color(n.color).child(n.text));
  }

  main(t) {
    const rows = this.rows();
    this.sel = clampIndex(this.sel, rows.length);
    const page = paginate(rows, pageOf(this.sel, this.pageSize), this.pageSize);
    const snap = this.snap;

    let body;
    if (!snap) {
      body = div().p(24).text_size(13).text_color(this.error ? t.blocked : t.dim).child(this.error ?? "Loading…");
    } else if (!rows.length) {
      const empty = this.query.trim()
        ? `No match for "${this.query.trim()}"`
        : this.view === "needs" ? "Nothing needs you" : this.view === "running" ? "Nothing is being reviewed now" : `No ${VIEW_LABEL[this.view].toLowerCase()} yet`;
      body = div().p(24).text_size(13).text_color(t.dim).child(empty);
    } else {
      body = v_flex().children(page.slice.map((row, i) => this.line(t, row, page.page * this.pageSize + i, page.page * this.pageSize + i === this.sel)));
    }

    const elapsed = snap ? Math.round((Date.now() - this.okAt) / 1000) : 0;
    const next = snap && snap.live && snap.next_tick_s != null ? `next ${countdown(Math.max(0, snap.next_tick_s - elapsed))}` : "";
    const pager = h_flex()
      .px(14)
      .py(8)
      .gap(8)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .child(div().flex_1().text_size(11).text_color(t.dim).child(page.total ? `${page.from}-${page.to} of ${page.total}` : ""))
      .when(page.pages > 1, (el) =>
        el
          .child(this.button(t, "prev", "‹ Prev", (cx) => { this.sel = (page.page - 1) * this.pageSize; cx.notify(); }, { disabled: page.page === 0 }))
          .child(this.button(t, "next", "Next ›", (cx) => { this.sel = (page.page + 1) * this.pageSize; cx.notify(); }, { disabled: page.page >= page.pages - 1 })),
      );

    return v_flex()
      .flex_1()
      .min_w(0)
      .h_full()
      .child(
        h_flex().px(14).pt(12).pb(8).gap(12).items_center()
          .child(h_flex().flex_1().h(32).px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
            .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
          .child(div().text_size(11).text_color(t.dim).child(next)),
      )
      .children(this.banner(t))
      .child(
        v_flex()
          .id("pr-list")
          .flex_1()
          .min_h(0)
          .overflow_hidden()
          .on_size_change((size, cx) => {
            const next = Math.max(3, Math.floor(size.height / settings().zoom / ROW_H));
            if (next !== this.pageSize) {
              this.pageSize = next;
              cx.notify();
            }
          })
          .child(body),
      )
      .child(pager);
  }

  render() {
    if (props()?.role !== "board") return div().size_full();
    const t = theme();
    return h_flex()
      .id("pr-review")
      .size_full()
      .bg(t.surface)
      .text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size) => { this.size = size; })
      .child(this.rail(t))
      .child(this.main(t));
  }
}
