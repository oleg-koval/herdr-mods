// Pure rules for the pr-review board. No herdr imports: node can test this file.
//
// Input is the document `pr-autoreview panel --json` prints (see snapshot() in the dotfiles repo's
// pr_autoreview/panel.py). Nothing here reads the clock, the disk or the app.

export const VIEWS = ["needs", "all", "repos", "runs", "setup"];
// "running" is not in the sidebar: it opens from the "running" status line, so a review in
// progress can be found without scanning All PRs.
export const VIEW_LABEL = { needs: "Needs you", all: "All PRs", repos: "Repos", runs: "Runs", setup: "Review setup", running: "Reviewing now" };

// Tab / Shift-Tab order. From a view outside the sidebar (Reviewing now), Tab goes to the first
// sidebar view and Shift-Tab to the last, as if it sat just past the end of the list.
export function nextView(view, step) {
  const at = VIEWS.indexOf(view);
  const from = at >= 0 ? at : step > 0 ? -1 : VIEWS.length;
  return VIEWS[(from + step + VIEWS.length) % VIEWS.length];
}

// What the old panel's "Needs you" card counted: a person has to act.
export const NEEDS_YOU = new Set(["HUMAN_NEEDED", "FAILED", "COLLISION", "NEW_COMMITS_SINCE_YOUR_REVIEW"]);

// A per-PR retry only works on FAILED (runner.retry); HUMAN_NEEDED needs a person, never a retry.
export const RETRYABLE = new Set(["FAILED"]);

// "Why" explains a PR that failed or needs a person; it is a read, so any of these can use it.
export const WHYABLE = new Set(["FAILED", "HUMAN_NEEDED", "COLLISION"]);

const STATUS = {
  HUMAN_NEEDED: { glyph: "▲", tone: "blocked", label: "human needed" },
  FAILED: { glyph: "✕", tone: "blocked", label: "failed" },
  COLLISION: { glyph: "▲", tone: "blocked", label: "your draft exists" },
  NEW_COMMITS_SINCE_YOUR_REVIEW: { glyph: "↻", tone: "done", label: "new commits" },
  READY: { glyph: "●", tone: "done", label: "ready to submit" },
  RUNNING: { glyph: "◐", tone: "working", label: "reviewing" },
  QUEUED: { glyph: "○", tone: "idle", label: "queued" },
  DONE: { glyph: "✓", tone: "idle", label: "done" },
};
export const statusMeta = (status) => STATUS[status] ?? { glyph: "·", tone: "dim", label: String(status ?? "?").toLowerCase() };

export const needsCount = (snap) => snap.prs.filter((p) => NEEDS_YOU.has(p.status)).length;
export const failedCount = (snap) => snap.prs.filter((p) => RETRYABLE.has(p.status)).length;
export const queuedCount = (snap) => snap.counts?.QUEUED ?? 0;

export const shortRepo = (repo) => String(repo ?? "").split("/").pop();

// Rows are plain objects with a `text` blob to search and a stable `key`.
const prRow = (p) => ({
  kind: "pr", key: p.id, pr: p,
  text: [p.repo, `#${p.number}`, `${shortRepo(p.repo).replace(/[^a-z0-9]/gi, "")}${p.number}`, p.title, p.author, p.status, statusMeta(p.status).label, ...(p.reasons ?? [])].join(" "),
});
const repoRow = (r) => ({ kind: "repo", key: r.repo, repo: r, text: `${r.repo} ${r.off ? "ignored" : "watched"}` });
const runRow = (r) => ({ kind: "run", key: `${r.pr_id}/${r.attempt}`, run: r, text: `${r.pr_id} attempt ${r.attempt} ${r.error ? "error" : "ok"}` });

// ---- Review setup: which skill the engine runs, per repo

export const BUILTIN_SETTING = { skill: "olko-github-pr:lekker-review", model: "sonnet", params: {} };
export const shortSkill = (command) => String(command ?? "").split(":").pop();
export const SCOPE_RE = /^(default|[\w.-]+\/[\w.-]+)$/;

// "lekker-review · opus · pos0=deep · crossvendor"
export function describeSetting(setting) {
  if (!setting) return "";
  const params = Object.entries(setting.params ?? {}).map(([k, v]) => (v === true ? k : `${k}=${v}`));
  return [shortSkill(setting.skill), setting.model, ...params].filter(Boolean).join(" · ");
}

const scopeRow = (scope, label, setting, fallback) => ({
  kind: "scope", key: `scope:${scope}`, scope, label, setting,
  text: `${label} ${describeSetting(setting ?? fallback)} ${setting ? "override" : "inherited"}`,
});

export function setupRows(snap) {
  const review = snap.review ?? { default: null, repos: {} };
  const own = (repo) => review.repos?.[repo] ?? null;
  const repos = snap.repos
    .map((r) => scopeRow(r.repo, r.repo, own(r.repo), review.default ?? BUILTIN_SETTING))
    .sort((a, b) => (!a.setting - !b.setting) || a.scope.localeCompare(b.scope));
  return [scopeRow("default", "Default for every repo", review.default, BUILTIN_SETTING), ...repos];
}

export const overrideCount = (snap) => Object.keys(snap.review?.repos ?? {}).length + (snap.review?.default ? 1 : 0);

// The form state for one scope: its saved setting, else what it inherits (so Save changes only what was touched).
export function formFor(setting, inherited) {
  const from = setting ?? inherited ?? BUILTIN_SETTING;
  return { skill: from.skill, model: from.model ?? BUILTIN_SETTING.model, params: { ...(from.params ?? {}) } };
}
export const chooseSkill = (form, command) => (form.skill === command ? form : { ...form, skill: command, params: {} });
export const setModel = (form, model) => ({ ...form, model });
export function setParam(form, id, value) {
  const params = { ...form.params };
  if (value === "" || value === false || value == null) delete params[id];
  else params[id] = value;
  return { ...form, params };
}
export const toPayload = (form) => ({ skill: form.skill, model: form.model, params: { ...form.params } });

// The words the saved params add after the PR link, in the skill's own order (mirrors the engine).
export function commandPreview(form, skill) {
  const words = [];
  for (const f of skill?.params ?? []) {
    const v = form.params[f.id];
    if (!v) continue;
    if (f.kind === "flag") words.push(f.flag);
    else words.push(...(f.flag ? [f.flag, v] : [v]));
  }
  return `/${form.skill} <PR link>${words.length ? ` ${words.join(" ")}` : ""}`;
}

export function filterSkills(skills, query) {
  return query.trim() ? skills.filter((s) => matches(query, `${s.command} ${s.source} ${s.description}`)) : skills;
}

// ---- Why: the engine's diagnosis as lines to draw

const ago = (iso, nowMs) => age(iso, nowMs);
export function whySections(d, nowMs = Date.now()) {
  const out = [];
  const ran = `${shortSkill(d.skill)} · ${d.model}${d.args?.length ? ` · ${d.args.join(" ")}` : ""}`;
  out.push({ title: `${statusMeta(d.status).label} · attempt ${d.attempts || 0}`, tone: statusMeta(d.status).tone, lines: [`Ran ${ran}${d.last_run_at ? ` · ${ago(d.last_run_at, nowMs)} ago` : ""}`] });
  for (const r of d.reasons ?? []) {
    out.push({ title: r.reason, tone: "blocked", lines: [r.meaning, ...r.causes.map((c) => `Could be: ${c}`), ...r.next.map((n) => `Do: ${n}`)] });
  }
  for (const r of d.other_reasons ?? []) out.push({ title: r, tone: "dim", lines: ["No explanation known for this reason yet."] });
  if (d.guard_denials > 0) out.push({ title: `${d.guard_denials} guard denial(s)`, tone: "blocked", lines: ["The safety hook refused tool calls. A skill other than lekker-review often needs tools the guard does not allow."] });
  const byLabel = new Map();
  for (const e of d.evidence ?? []) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), e.text]);
  for (const [label, lines] of byLabel) out.push({ title: `From the log: ${label}`, tone: "dim", lines });
  if (!d.run_dir) out.push({ title: "No run log", tone: "dim", lines: ["The run never started, so there is no log."] });
  else if (d.log_missing) out.push({ title: "Log missing", tone: "dim", lines: [`Expected at ${d.log_path}`] });
  return out;
}

const byUpdated = (a, b) => String(b.pr.updated_at ?? "").localeCompare(String(a.pr.updated_at ?? ""));

export function viewRows(snap, view) {
  if (view === "needs") return snap.prs.filter((p) => NEEDS_YOU.has(p.status)).map(prRow).sort(byUpdated);
  if (view === "all") return snap.prs.map(prRow).sort(byUpdated);
  if (view === "running") return snap.prs.filter((p) => p.status === "RUNNING").map(prRow).sort(byUpdated);
  if (view === "repos") {
    // watched first, then ignored; alphabetical inside each group
    return snap.repos.map(repoRow).sort((a, b) => (a.repo.off - b.repo.off) || a.repo.repo.localeCompare(b.repo.repo));
  }
  if (view === "runs") return snap.runs.map(runRow);
  if (view === "setup") return setupRows(snap);
  return [];
}

export const viewCount = (snap, view) => (view === "needs" ? needsCount(snap) : view === "setup" ? overrideCount(snap) : viewRows(snap, view).length);

// Every word of the query must match the row. A word matches when it is a substring, or when its letters
// appear in order inside one token of the row (so "arh2053" or a dropped letter still finds the PR).
const inOrder = (word, token) => {
  let i = 0;
  for (const ch of token) if (ch === word[i]) i += 1;
  return i === word.length;
};
export function matches(query, text) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = text.toLowerCase();
  const tokens = hay.split(/[^a-z0-9#]+/).filter(Boolean);
  return words.every((w) => hay.includes(w) || (w.length >= 3 && tokens.some((t) => inOrder(w, t))));
}
export const filterRows = (rows, query) => (query.trim() ? rows.filter((r) => matches(query, r.text)) : rows);

export function paginate(rows, page, size) {
  const per = Math.max(1, size);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const at = Math.min(Math.max(0, page), pages - 1);
  const from = rows.length ? at * per : 0;
  const slice = rows.slice(from, from + per);
  return { slice, page: at, pages, from: rows.length ? from + 1 : 0, to: from + slice.length, total: rows.length };
}

// Selection is an index into the whole filtered list; the page follows it.
export const pageOf = (index, size) => Math.floor(Math.max(0, index) / Math.max(1, size));
export const clampIndex = (index, length) => (length ? Math.min(Math.max(0, index), length - 1) : 0);

export function age(iso, nowMs) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 90) return "now";
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const countdown = (secs) => (secs == null ? "?" : `${Math.floor(secs / 60)}:${String(Math.abs(secs) % 60).padStart(2, "0")}`);
export const money = (v) => (v == null ? "?" : `$${v.toFixed(2)}`);

// What a row's buttons can do. `primary` is what Enter does.
export function actionsFor(row) {
  if (row.kind === "pr") {
    const { pr } = row;
    return [
      { id: "open", label: "Open", primary: true },
      ...(WHYABLE.has(pr.status) ? [{ id: "why", label: "Why" }] : []),
      ...(pr.review_file ? [{ id: "review", label: "Review" }] : []),
      ...(RETRYABLE.has(pr.status) ? [{ id: "retry", label: "Retry" }] : []),
    ];
  }
  if (row.kind === "repo") {
    // Enter only reads: Watch/Ignore changes the engine's repo list, so it stays a click.
    return [{ id: "pulls", label: "PRs", primary: true }, { id: "toggle", label: row.repo.off ? "Watch" : "Ignore" }];
  }
  if (row.kind === "run") return [{ id: "open", label: "Open", primary: true }, ...(row.run.error ? [{ id: "why", label: "Why" }] : [])];
  if (row.kind === "scope") return [{ id: "edit", label: "Edit", primary: true }, ...(row.setting ? [{ id: "reset", label: row.scope === "default" ? "Use built-in" : "Use default" }] : [])];
  return [];
}

// argv for the engine CLI, so the view never builds a command string by hand.
export const cli = {
  read: () => ["panel", "--json"],
  pause: () => ["panel", "--toggle-pause", "--json"],
  retryFailed: () => ["panel", "--retry-failed", "--json"],
  sync: () => ["panel", "--sync", "--json"],
  retry: (prId) => ["retry", prId],
  repo: (repo, off) => ["repos", off ? "disable" : "enable", repo],
  reviewConfig: () => ["review-config"],
  saveReview: (scope, setting) => ["review-config", "set", scope, JSON.stringify(setting)],
  clearReview: (scope) => ["review-config", "clear", scope],
  why: (prId) => ["why", prId],
};

// Refresh searches GitHub for every watched PR; under load that outlasted the 20 s every call used to get.
export const EXEC_MS = 20000;
export const SYNC_MS = 120000;
export const execTimeout = (argv) => (argv.includes("--sync") ? SYNC_MS : EXEC_MS);

// What the board shows when the engine call itself threw. herdr.exec's timeout reads "...took too long".
export function execFailure(err, ms) {
  return /took too long/i.test(String(err)) ? `engine took longer than ${ms / 1000}s; try again` : `could not run engine: ${err}`;
}

// The repo name goes into a URL and a CLI argument: only owner/name shapes pass.
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
export const PR_ID_RE = /^[\w.-]+\/[\w.-]+#\d+$/;
export const pullsUrl = (repo) => (REPO_RE.test(repo) ? `https://github.com/${repo}/pulls` : null);
export const prUrl = (url) => (typeof url === "string" && /^https:\/\/github\.com\//.test(url) ? url : null);

// A snapshot is usable only when it has the fields the board reads; an older engine prints a path instead.
export function parseSnapshot(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "engine did not print JSON: update dotfiles (panel --json)" };
  }
  const ok = data && Array.isArray(data.prs) && Array.isArray(data.repos) && Array.isArray(data.runs) && typeof data.counts === "object";
  return ok ? { snap: data } : { error: "engine JSON is missing prs, repos, runs or counts" };
}

// The engine is usable only when its panel module knows `--json`. An older one would ignore the flag,
// write an HTML page and start a web server, so the board checks this text before any call.
export const ENGINE_MARK = "snapshot_json";

// Where the engine's panel.py is, from the bin path and what `readlink` printed for it ("" when not a link).
export function panelPath(bin, linkTarget) {
  const dirOf = (p) => p.slice(0, p.lastIndexOf("/"));
  const real = linkTarget ? (linkTarget.startsWith("/") ? linkTarget : `${dirOf(bin)}/${linkTarget}`) : bin;
  return `${dirOf(real)}/pr_autoreview/panel.py`;
}

// A saved review is only opened from the engine's own folder (pass a realpath).
export const reviewPathOk = (path, home) =>
  typeof path === "string" && path.startsWith(`${home}/.local/state/pr-autoreview/reviews/`) && !path.split("/").includes("..") && path.endsWith(".md");

// A run's log is only opened from the engine's own logs folder (pass a realpath).
export const logPathOk = (path, home) =>
  typeof path === "string" && path.startsWith(`${home}/.local/state/pr-autoreview/logs/`) && !path.split("/").includes("..") && path.endsWith(".log");

export const findTab = (spaceList, name) => spaceList.flatMap((s) => s.tabs).find((t) => t.name === name) ?? null;

// One line each for the DM intake and the team load, from the snapshot's `dm` and `team` blocks.
export function miniStatus(label, block) {
  if (!block || block.error) return { text: `${label} ${block?.error ?? "unknown"}`, tone: "blocked" };
  if (block.intake_error) return { text: `${label} ${block.intake_error}`, tone: "blocked" };
  return block.live ? { text: `${label} ok`, tone: "done" } : { text: `${label} paused`, tone: "dim" };
}
