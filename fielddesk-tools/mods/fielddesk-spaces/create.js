// The New space dialog: a name, a repo picked by fuzzy search over the person's GitHub repos,
// a starter (typed or pasted text, dropped or pasted files) and an agent, picked by its logo.
// Create opens the space in the repo's checkout (cloning it first when it isn't here) with the
// agent running and the starter as its first message.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import {
  closeOverlay, exec, home, knownAgents, notify, pickFiles, props, readTextFile, run, setShared, shared, theme, writeTextFile,
} from "herdr";
import {
  agentTiles, composeTask, isStale, parseLocalIndex, parseRepoList, pushRecent, rankRepos, repoFolder, spaceArgs,
  spaceName, tilde,
} from "./repos.js";

const RECENT = "fielddesk-spaces.recentRepos";
const LAST_AGENT = "fielddesk-spaces.lastAgent";
const OWNERS = ["Teifi-Digital", "oleg-koval"];
const RESULT_ROWS = 6;
const cacheFile = () => `${home()}/.cache/fielddesk/repos.json`;
// The macOS screenshot thumbnail hands over a file that goes soon after the drag, so dropped
// and pasted files are copied here before the message names them.
const attachDir = () => `${home()}/.cache/herdr-threads`;
const threadsDir = () => `${home()}/.herdr/threads`;
const icon = (name) => svg(`mods/workspace-chrome/${name}.svg`);
const baseName = (path) => path.replace(/\/+$/, "").split("/").pop() || path;
const safeName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, "-");

// The main checkout of every repo in the usual folders, as "<folder>\t<origin url>\td" lines.
// One awk over the .git/config files: a git process per folder took 4 s for 500 folders.
const SCAN = String.raw`cd "$HOME" && awk 'FNR==1{o=0} /^\[remote "origin"\]/{o=1;next} /^\[/{o=0} o&&$1=="url"{f=FILENAME; sub(/\/\.git\/config$/,"",f); print ENVIRON["HOME"] "/" f "\t" $3 "\td"; nextfile}' Work/01_projects/*/.git/config projects/personal/active/*/.git/config code/*/.git/config 2>/dev/null; true`;

// AppleScript writes the clipboard's image (a screenshot, say) to a PNG; fails when there is none.
const pasteImageScript = (path) => [
  `set f to open for access POSIX file "${path}" with write permission`,
  "try",
  "write (the clipboard as «class PNGf») to f",
  "on error e",
  "close access f",
  "error e",
  "end try",
  "close access f",
].flatMap((line) => ["-e", line]);

async function fetchRepos() {
  const lists = await Promise.all(OWNERS.map(async (owner) => {
    const r = await exec("gh", ["repo", "list", owner, "--limit", "1000", "--no-archived",
      "--json", "nameWithOwner,description,pushedAt,isArchived"], { timeout: 60000 });
    if (r.code !== 0) throw new Error(r.stderr?.trim() || `gh repo list ${owner} failed`);
    return parseRepoList(JSON.parse(r.stdout));
  }));
  return lists.flat();
}

export class CreateSpace {
  init(_props, cx) {
    this.repos = [];
    this.reposState = "loading"; // loading | ready | failed
    this.index = {};
    this.repo = null;
    this.results = [];
    this.sel = 0;
    this.showResults = false;
    this.files = [];
    this.agents = agentTiles(shared("new-menu.agents")?.[""] ?? []);
    this.pick = shared(LAST_AGENT) ?? this.agents[0]?.key;
    this.busy = null;
    this.handle = cx.focus_handle();
    this.makeInputs();
    this.bindKeys(cx);
    this.name.focus();
    cx.timer.after(300, () => this.name.focus());
    cx.spawn(async (cx) => this.loadRepos(cx));
    this.indexed = new Promise((resolve) => cx.spawn(async (cx) => resolve(await this.loadIndex(cx))));
    cx.spawn(async (cx) => this.loadAgents(cx));
  }

  makeInputs() {
    this.name = InputState.new({ placeholder: "Space name" });
    this.name.on("change", (_e, cx) => cx.notify());
    this.name.on("submit", (_e, cx) => this.submit(cx));
    this.name.on("focus", (_e, cx) => { this.showResults = false; cx.notify(); });
    this.query = InputState.new({ placeholder: "Repository" });
    this.query.on("change", (_e, cx) => this.onQuery(cx));
    this.query.on("focus", (_e, cx) => { this.showResults = !this.repo; this.refreshResults(); cx.notify(); });
    this.query.on("submit", (_e, cx) => (this.showResults && this.results.length ? this.choose(this.results[this.sel], cx) : this.submit(cx)));
    this.starter = TextareaState.new({ placeholder: "Drop files or paste text to start the conversation" });
    this.starter.set_auto_grow(2, 8);
    this.starter.on("change", (_e, cx) => cx.notify());
    this.starter.on("focus", (_e, cx) => { this.showResults = false; cx.notify(); });
    this.starter.on("submit", (e, cx) => { if (!e?.shift) this.submit(cx); });
    this.starter.on("paste_other", (_e, cx) => this.pasteImage(cx));
  }

  // An Input's own Up/Down bindings take those keys before on_key_down sees them; while the
  // results show, the root declares "RepoResults" and these bindings win instead.
  bindKeys(cx) {
    try {
      const keys = { up: "repo_results_up", down: "repo_results_down", tab: "repo_results_pick" };
      const where = ["RepoResults", "RepoResults > Input"];
      cx.bind_keys(where.flatMap((context) => Object.entries(keys).map(([keystroke, action]) => ({ keystroke, action, context }))));
    } catch {}
  }

  async loadRepos(cx) {
    let cached = null;
    let text = null;
    try {
      text = await readTextFile(cacheFile());
      cached = JSON.parse(text ?? "null");
    } catch {}
    if (Array.isArray(cached?.repos)) {
      this.repos = cached.repos;
      this.reposState = "ready";
      this.refreshResults();
      cx.notify();
    }
    if (!isStale(cached?.at, Date.now())) return;
    try {
      const repos = await fetchRepos();
      this.repos = repos;
      this.reposState = "ready";
      await exec("mkdir", ["-p", `${home()}/.cache/fielddesk`]);
      await writeTextFile(cacheFile(), JSON.stringify({ at: Date.now(), repos }), text).catch(() => null);
    } catch (error) {
      if (this.reposState !== "ready") this.reposState = "failed";
      this.reposError = String(error?.message ?? error);
    }
    this.refreshResults();
    cx.notify();
  }

  async loadIndex(cx) {
    try {
      const r = await exec("sh", ["-c", SCAN], { timeout: 20000 });
      this.index = parseLocalIndex(r.stdout);
    } catch {}
    cx.notify();
  }

  async loadAgents(cx) {
    try {
      this.agents = agentTiles(await knownAgents());
    } catch {}
    if (!this.agents.some((agent) => agent.key === this.pick)) this.pick = this.agents[0]?.key;
    cx.notify();
  }

  onQuery(cx) {
    const typed = this.query.value();
    if (this.repo && typed !== this.repo.full) this.repo = null;
    this.showResults = !this.repo;
    this.sel = 0;
    this.refreshResults();
    cx.notify();
  }

  refreshResults() {
    this.results = rankRepos(this.repos, this.repo ? "" : this.query.value(), shared(RECENT) ?? [], RESULT_ROWS);
    this.sel = Math.min(this.sel, Math.max(0, this.results.length - 1));
  }

  choose(repo, cx) {
    if (!repo) return;
    this.repo = repo;
    this.query.set_value(repo.full);
    this.showResults = false;
    this.starter.focus();
    cx.notify();
  }

  clearRepo(cx) {
    this.repo = null;
    this.query.set_value("");
    this.query.focus();
    cx.notify();
  }

  moveSel(by, cx) {
    this.sel = Math.max(0, Math.min(this.results.length - 1, this.sel + by));
    cx.notify();
  }

  attach(paths, cx) {
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", attachDir()]).catch(() => null);
      for (const src of paths) {
        if (this.files.some((file) => file.src === src)) continue;
        const entry = { src, path: src, name: baseName(src), copying: true };
        this.files = [...this.files, entry];
        cx.notify();
        const dest = `${attachDir()}/${Date.now()}-${safeName(entry.name)}`;
        const copied = await exec("cp", ["-R", src, dest]).then((r) => r.code === 0, () => false);
        this.files = this.files.map((file) => (file === entry ? { ...file, path: copied ? dest : src, copying: false } : file));
        cx.notify();
      }
    });
  }

  pasteImage(cx) {
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", attachDir()]).catch(() => null);
      const path = `${attachDir()}/${Date.now()}-pasted.png`;
      const r = await exec("osascript", pasteImageScript(path)).catch(() => null);
      if (r?.code !== 0) return;
      this.files = [...this.files, { src: path, path, name: "pasted image.png", copying: false }];
      cx.notify();
    });
  }

  browse(cx) {
    cx.spawn(async (cx) => {
      const paths = await pickFiles({ prompt: "Attach", multiple: true }).catch(() => null);
      if (paths?.length) this.attach(paths, cx);
    });
  }

  removeFile(src, cx) {
    this.files = this.files.filter((file) => file.src !== src);
    cx.notify();
  }

  submit(cx) {
    if (this.busy || this.files.some((file) => file.copying)) return;
    const agent = this.agents.find((tile) => tile.key === this.pick) ?? this.agents.at(-1);
    const repo = this.repo;
    const name = spaceName(this.name.value(), repo);
    const task = composeTask(this.starter.value(), this.files);
    this.busy = "Opening…";
    cx.notify();
    cx.spawn(async (cx) => {
      // The checkout scan may still be running: a repo it hasn't found yet would be cloned again.
      await this.indexed;
      const target = repo ? repoFolder(repo, this.index, home()) : { folder: threadsDir(), cloned: false };
      if (repo && !target.cloned) {
        this.busy = `Cloning ${repo.full}…`;
        cx.notify();
      }
      const args = spaceArgs({ name, folder: target.folder, agent, task });
      const ready = repo
        ? await this.ensureCloned(repo, target)
        : await exec("mkdir", ["-p", target.folder]).then((r) => r.code === 0, () => false);
      if (!ready) {
        this.busy = null;
        cx.notify();
        return;
      }
      run("space.new", args);
      if (repo) setShared(RECENT, pushRecent(shared(RECENT) ?? [], repo.full));
      if (agent) setShared(LAST_AGENT, agent.key);
      closeOverlay(props().overlay);
    });
  }

  async ensureCloned(repo, target) {
    if (target.cloned) return true;
    // A folder already at the clone target is used as it is, never cloned over.
    const exists = await exec("test", ["-e", target.folder]).then((r) => r.code === 0, () => false);
    if (exists) return true;
    const r = await exec("gh", ["repo", "clone", repo.full, target.folder], { timeout: 600000 }).catch((error) => ({ code: 1, stderr: String(error) }));
    if (r.code === 0) return true;
    notify({ title: `Couldn't clone ${repo.full}`, body: (r.stderr ?? "").trim().split("\n").pop() || "gh repo clone failed", level: "error", timeout: 8000 });
    return false;
  }

  // ── render ─────────────────────────────────────────────────────────────

  nameField(t) {
    return Input.new(this.name).h(36).px(0).border_0().bg(t.popover)
      .text_size(18).font_semibold().text_color(t.foreground);
  }

  repoField(t) {
    const where = this.repo ? repoFolder(this.repo, this.index, home()) : null;
    return h_flex().h(32).gap(8).items_center()
      .child(icon(this.repo ? "git-branch" : "search").size(14).flex_none().text_color(this.repo ? t.foreground : t.dim))
      .child(div().flex_1().min_w(0).child(Input.new(this.query).h(30).px(0).border_0().bg(t.popover).text_size(13).text_color(t.foreground)))
      .when(Boolean(where), (el) => el
        .child(div().flex_none().max_w(220).truncate().text_size(11.5).text_color(t.dim)
          .child(where.cloned ? tilde(where.folder, home()) : `clones to ${tilde(where.folder, home())}`))
        .child(h_flex().id("fd-new-repo-clear").role("button").accessibility_label("Clear repository").size(20).flex_none()
          .items_center().justify_center().rounded(5).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.clearRepo(cx))
          .child(icon("x").size(11))))
      .when(!this.repo && this.reposState === "loading" && !this.repos.length, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Loading repos…")))
      .when(!this.repo && this.reposState === "failed", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.blocked).tooltip(this.reposError ?? "").child("Couldn't list repos")));
  }

  resultRow(t, repo, i) {
    const on = i === this.sel;
    const where = repoFolder(repo, this.index, home());
    return h_flex().id(`fd-new-repo-${i}`).h(28).pl(22).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => this.choose(repo, cx))
      .child(div().flex_none().max_w(220).truncate().text_size(12.5).text_color(t.foreground).child(repo.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(repo.owner))
      .child(div().flex_none().max_w(200).truncate().text_size(11).text_color(where.cloned ? t.muted : t.dim)
        .child(where.cloned ? tilde(where.folder, home()) : "clone"));
  }

  resultList(t) {
    if (!this.results.length) {
      const empty = this.reposState === "ready" ? "No matching repo" : "";
      return div().h(28).pl(22).flex().items_center().text_size(11.5).text_color(t.dim).child(empty);
    }
    return v_flex().gap(1).children(this.results.map((repo, i) => this.resultRow(t, repo, i)));
  }

  fileChip(t, file, i) {
    return h_flex().id(`fd-new-file-${i}`).h(24).pl(8).pr(4).gap(5).items_center().rounded(6).flex_none()
      .bg(t.raised).text_size(11.5).text_color(file.copying ? t.dim : t.foreground)
      .child(icon("file-text").size(11).text_color(t.dim))
      .child(div().max_w(160).truncate().child(file.name))
      .child(h_flex().id(`fd-new-file-x-${i}`).role("button").accessibility_label(`Remove ${file.name}`).size(16)
        .items_center().justify_center().rounded(4).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.removeFile(file.src, cx))
        .child(icon("x").size(10)));
  }

  starterBox(t, terminal) {
    return v_flex().id("fd-new-starter").gap(6).p(10).rounded(10).border_1().border_dashed().border_color(t.input)
      .when(terminal, (el) => el.opacity(0.45))
      .child(Textarea.new(this.starter).px(0).py(0).border_0().bg(t.popover).text_size(13).text_color(t.foreground))
      .child(h_flex().id("fd-new-files").gap(6).items_center().overflow_x_scroll()
        .children(this.files.map((file, i) => this.fileChip(t, file, i)))
        .child(h_flex().id("fd-new-attach").role("button").accessibility_label("Attach files").h(24).px(6).gap(4).flex_none()
          .items_center().rounded(6).text_size(11.5).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.browse(cx))
          .child(icon("plus").size(11)).child(this.files.length ? "" : "Attach")));
  }

  agentTile(t, agent) {
    const on = agent.key === this.pick;
    const logo = agent.tint ? svg(agent.icon).size(18).text_color(t.foreground) : image(agent.icon).size(18);
    return h_flex().id(`fd-new-agent-${agent.key}`).role("radio_button").accessibility_label(agent.name).tooltip(agent.name)
      .size(34).flex_none().items_center().justify_center().rounded(9).cursor_pointer().border_1()
      .border_color(on ? t.accent : "#00000000")
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.opacity(0.5).hover((s) => s.opacity(1).bg(t.hover)))
      .on_click((_e, cx) => { this.pick = agent.key; cx.notify(); })
      .child(logo);
  }

  footer(t) {
    const waiting = Boolean(this.busy) || this.files.some((file) => file.copying);
    return h_flex().gap(6).items_center()
      .children(this.agents.map((agent) => this.agentTile(t, agent)))
      .child(div().flex_1())
      .when(Boolean(this.busy), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.busy)))
      .child(h_flex().id("fd-new-create").role("button").accessibility_label("Create space").h(32).px(14).gap(8).items_center().rounded(8)
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium()
        .when(waiting, (el) => el.opacity(0.5))
        .when(!waiting, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.submit(cx)))
        .child("Create").child(div().text_size(11).opacity(0.6).child("↵")));
  }

  render() {
    const t = theme();
    const terminal = this.pick === "terminal";
    return v_flex().id("fd-new-space").track_focus(this.handle).w_full().px(18).pt(14).pb(16).gap(10)
      .bg(t.popover).text_color(t.foreground)
      .when(this.showResults, (el) => el.key_context("RepoResults"))
      .on_action("repo_results_up", (_e, cx) => this.moveSel(-1, cx))
      .on_action("repo_results_down", (_e, cx) => this.moveSel(1, cx))
      .on_action("repo_results_pick", (_e, cx) => this.choose(this.results[this.sel], cx))
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.showResults) this.showResults = false;
        else closeOverlay(props().overlay);
        cx.stop_propagation();
        cx.notify();
      })
      .on_drop((e, cx) => { if (e.paths?.length) this.attach(e.paths, cx); })
      .child(h_flex().items_center()
        .child(div().flex_1().child(this.nameField(t)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("esc")))
      .child(div().h(1).bg(t.border))
      .child(this.repoField(t))
      .when(this.showResults, (el) => el.child(this.resultList(t)))
      .child(this.starterBox(t, terminal))
      .child(this.footer(t));
  }

  closing() {
    for (const state of [this.name, this.query, this.starter]) state?.release();
  }
}
