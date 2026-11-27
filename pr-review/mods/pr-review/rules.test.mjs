import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEEDS_YOU, actionsFor, age, clampIndex, cli, countdown, failedCount, filterRows, matches, money, needsCount,
  pageOf, paginate, parseSnapshot, prUrl, pullsUrl, shortRepo, statusMeta, viewCount, viewRows,
  findTab, miniStatus, execFailure, execTimeout, EXEC_MS, SYNC_MS, panelPath, reviewPathOk, VIEWS, VIEW_LABEL, nextView,
  BUILTIN_SETTING, chooseSkill, commandPreview, describeSetting, filterSkills, formFor, logPathOk, overrideCount, setModel, setParam,
  setupRows, toPayload, whySections,
} from "./rules.js";

const pr = (n, status, extra = {}) => ({
  id: `example-org/app#${n}`, repo: "example-org/app", number: n, url: `https://github.com/example-org/app/pull/${n}`,
  title: `change ${n}`, author: "sam", status, reasons: [], review_file: null, updated_at: `2026-11-19T${10 + n}:00:00+00:00`, ...extra,
});
const snap = () => ({
  counts: { DONE: 2, HUMAN_NEEDED: 1, FAILED: 1, QUEUED: 3 },
  prs: [pr(1, "DONE"), pr(2, "HUMAN_NEEDED", { reasons: ["CI red", "large: 1334 lines"], review_file: "/tmp/r.md" }), pr(3, "FAILED"), pr(4, "DONE")],
  repos: [
    { repo: "example-org/zeta", off: false, open: 3 }, { repo: "example-org/helm", off: true }, { repo: "example-org/alpha", off: false },
  ],
  runs: [{ pr_id: "example-org/app#2", attempt: 1, url: "https://github.com/example-org/app/pull/2", error: false }],
});

test("needs-you counts what the old card counted", () => {
  assert.equal(needsCount(snap()), 2);
  assert.equal(failedCount(snap()), 1);
  assert.ok(NEEDS_YOU.has("COLLISION") && NEEDS_YOU.has("NEW_COMMITS_SINCE_YOUR_REVIEW") && !NEEDS_YOU.has("DONE"));
});

test("views: needs shows only attention rows, newest first; all shows everything", () => {
  assert.deepEqual(viewRows(snap(), "needs").map((r) => r.pr.number), [3, 2]);
  assert.equal(viewRows(snap(), "all").length, 4);
  assert.equal(viewCount(snap(), "needs"), 2);
  assert.equal(viewCount(snap(), "repos"), 3);
});

test("repos: watched first, alphabetical, ignored last", () => {
  assert.deepEqual(viewRows(snap(), "repos").map((r) => shortRepo(r.repo.repo)), ["alpha", "zeta", "helm"]);
});

test("filter: every word must match; reasons and repo are searchable", () => {
  const rows = viewRows(snap(), "all");
  assert.deepEqual(filterRows(rows, "ci red").map((r) => r.pr.number), [2]);
  assert.deepEqual(filterRows(rows, "app #3").map((r) => r.pr.number), [3]);
  assert.deepEqual(filterRows(rows, "failed sam").map((r) => r.pr.number), [3]);
  assert.equal(filterRows(rows, "   ").length, 4);
  assert.equal(filterRows(rows, "nonexistent").length, 0);
});

test("filter tolerates a dropped letter but not a different word", () => {
  assert.ok(matches("sttlement", "SAP settlement preview"));
  assert.ok(!matches("xyz", "SAP settlement preview"));
  assert.ok(!matches("ab", "alpha"));  // two letters: substring only, no in-order guessing
});

test("paginate: slices, clamps and reports 1-based ranges", () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({ key: i }));
  const p0 = paginate(rows, 0, 20);
  assert.deepEqual([p0.slice.length, p0.pages, p0.from, p0.to, p0.total], [20, 3, 1, 20, 53]);
  const last = paginate(rows, 99, 20);
  assert.deepEqual([last.page, last.slice.length, last.from, last.to], [2, 13, 41, 53]);
  const none = paginate([], 0, 20);
  assert.deepEqual([none.pages, none.from, none.to, none.total], [1, 0, 0, 0]);
});

test("selection index maps to a page and clamps", () => {
  assert.equal(pageOf(0, 20), 0);
  assert.equal(pageOf(39, 20), 1);
  assert.equal(pageOf(40, 20), 2);
  assert.equal(clampIndex(9, 3), 2);
  assert.equal(clampIndex(-4, 3), 0);
  assert.equal(clampIndex(5, 0), 0);
});

test("actions: retry only on FAILED, review only with a file, repo toggle names the next state", () => {
  const rows = viewRows(snap(), "all");
  const ids = (n) => actionsFor(rows.find((r) => r.pr.number === n)).map((a) => a.id);
  assert.deepEqual(ids(3), ["open", "why", "retry"]);
  assert.deepEqual(ids(2), ["open", "why", "review"]);
  assert.deepEqual(ids(1), ["open"]);
  const repoRows = viewRows(snap(), "repos");
  assert.equal(actionsFor(repoRows[0])[1].label, "Ignore");
  assert.equal(actionsFor(repoRows[2])[1].label, "Watch");
  // Enter (the primary action) never mutates: it opens the repo's PR list.
  assert.deepEqual(repoRows.map((r) => actionsFor(r).find((a) => a.primary).id), ["pulls", "pulls", "pulls"]);
  assert.ok(actionsFor(viewRows(snap(), "runs")[0]).every((a) => a.id === "open"));
  const failedRun = { kind: "run", run: { pr_id: "example-org/app#3", error: true } };
  assert.deepEqual(actionsFor(failedRun).map((a) => a.id), ["open", "why"]);
});

test("status meta has a fallback for an unknown status", () => {
  assert.equal(statusMeta("HUMAN_NEEDED").tone, "blocked");
  assert.deepEqual(statusMeta("WEIRD"), { glyph: "·", tone: "dim", label: "weird" });
});

test("age and countdown", () => {
  const now = Date.parse("2026-11-19T22:00:00Z");
  assert.equal(age("2026-11-19T21:59:30Z", now), "now");
  assert.equal(age("2026-11-19T21:30:00Z", now), "30m");
  assert.equal(age("2026-11-19T16:00:00Z", now), "6h");
  assert.equal(age("2026-11-16T22:00:00Z", now), "3d");
  assert.equal(age(null, now), "");
  assert.equal(countdown(252), "4:12");
  assert.equal(countdown(null), "?");
  assert.equal(money(3.1), "$3.10");
  assert.equal(money(null), "?");
});

test("cli argv: actions are fixed arrays, repos switch on the flag", () => {
  assert.deepEqual(cli.pause(), ["panel", "--toggle-pause", "--json"]);
  assert.deepEqual(cli.retry("o/r#1"), ["retry", "o/r#1"]);
  assert.deepEqual(cli.repo("o/r", true), ["repos", "disable", "o/r"]);
  assert.deepEqual(cli.repo("o/r", false), ["repos", "enable", "o/r"]);
});

test("urls: only owner/name repos and github.com PR links pass", () => {
  assert.equal(pullsUrl("example-org/app"), "https://github.com/example-org/app/pulls");
  assert.equal(pullsUrl("a/b; rm -rf /"), null);
  assert.equal(pullsUrl("nope"), null);
  assert.equal(prUrl("https://github.com/o/r/pull/1"), "https://github.com/o/r/pull/1");
  assert.equal(prUrl("file:///etc/passwd"), null);
  assert.equal(prUrl("https://evil.example/o/r/pull/1"), null);
});

test("parseSnapshot rejects non-JSON and incomplete documents with a reason, never a zero", () => {
  assert.match(parseSnapshot("/Users/x/.cache/pr-autoreview.html").error, /update dotfiles/);
  assert.match(parseSnapshot('{"prs":[]}').error, /missing/);
  assert.equal(parseSnapshot(JSON.stringify(snap())).snap.prs.length, 4);
});

test("panelPath follows the bin symlink to the engine checkout", () => {
  assert.equal(panelPath("/h/bin/pr-autoreview", "/g/dotfiles/home/bin/pr-autoreview"), "/g/dotfiles/home/bin/pr_autoreview/panel.py");
  assert.equal(panelPath("/h/bin/pr-autoreview", "../g/pr-autoreview"), "/h/bin/../g/pr_autoreview/panel.py");
  assert.equal(panelPath("/x/bin/pr-autoreview", ""), "/x/bin/pr_autoreview/panel.py");
});

test("reviewPathOk accepts only .md files under the engine's reviews folder", () => {
  const home = "/Users/o";
  const ok = `${home}/.local/state/pr-autoreview/reviews/a-1.md`;
  assert.equal(reviewPathOk(ok, home), true);
  assert.equal(reviewPathOk(`${home}/.local/state/pr-autoreview/reviews/../../x.md`, home), false);
  assert.equal(reviewPathOk(`${home}/.ssh/id_rsa`, home), false);
  assert.equal(reviewPathOk(`${home}/.local/state/pr-autoreview/reviews/a.sh`, home), false);
  assert.equal(reviewPathOk(null, home), false);
});

test("findTab matches by name across spaces; miniStatus never turns an error into ok", () => {
  const spaces = [{ tabs: [{ id: "a", name: "x" }] }, { tabs: [{ id: "b", name: "PR review" }] }];
  assert.equal(findTab(spaces, "PR review").id, "b");
  assert.equal(findTab(spaces, "nope"), null);
  assert.deepEqual(miniStatus("DM", { live: true }), { text: "DM ok", tone: "done" });
  assert.deepEqual(miniStatus("DM", { live: false }), { text: "DM paused", tone: "dim" });
  assert.equal(miniStatus("DM", { live: true, intake_error: "intake run rc 1" }).tone, "blocked");
  assert.equal(miniStatus("Team", { error: "boom" }).text, "Team boom");
  assert.equal(miniStatus("Team", undefined).tone, "blocked");
});

test("a typed repo prefix plus number finds the PR (arh2053)", () => {
  const rows = viewRows({ prs: [{ ...pr(2053, "DONE"), repo: "example-org/arh-fixture-apps" }, pr(7, "DONE")], repos: [], runs: [], counts: {} }, "all");
  assert.deepEqual(filterRows(rows, "arh2053").map((r) => r.pr.number), [2053]);
});

test("the guard mod carries identical copies of engine.js and rules.js, and a mod.json that opens its own window", () => {
  const read = (dir, file) => readFileSync(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
  for (const file of ["engine.js", "rules.js"]) assert.equal(read("pr-review-guard", file), read("pr-review", file), file);
  const guard = JSON.parse(read("pr-review-guard", "mod.json"));
  assert.equal(guard.place, "none");
  assert.equal(guard.focusable, undefined);
  assert.deepEqual(guard.overlay, { kind: "window", key: "pr-review-guard", keep: true, frame: "none", width: 1, height: 1, at: { x: 0, y: 0 } });
  const board = JSON.parse(read("pr-review", "mod.json"));
  assert.equal(board.focusable, true);
  assert.equal(board.overlay, undefined);
});

test("running view lists only reviews in progress, outside the sidebar views", () => {
  const withRun = { ...snap(), prs: [...snap().prs, pr(5, "RUNNING")] };
  assert.deepEqual(viewRows(withRun, "running").map((r) => r.pr.number), [5]);
  assert.equal(viewRows(snap(), "running").length, 0);
  assert.equal(VIEWS.includes("running"), false);
  assert.equal(VIEW_LABEL.running, "Reviewing now");
});

test("nextView cycles the sidebar, and leaves Reviewing now at the list's ends", () => {
  assert.equal(nextView("needs", 1), "all");
  assert.equal(nextView("needs", -1), "setup");
  assert.equal(nextView("setup", 1), "needs");
  assert.equal(nextView("running", 1), "needs");
  assert.equal(nextView("running", -1), "setup");
});

test("Refresh (sync) gets a longer exec timeout than a plain read", () => {
  assert.equal(execTimeout(cli.read()), EXEC_MS);
  assert.equal(execTimeout(cli.pause()), EXEC_MS);
  assert.equal(execTimeout(cli.sync()), SYNC_MS);
  assert.ok(SYNC_MS > EXEC_MS);
});

test("an exec timeout is shown as a plain sentence, any other throw keeps its text", () => {
  const timeout = new Error("`herdr.exec`: /Users/me/bin/pr-autoreview took too long");
  assert.equal(execFailure(timeout, 120000), "engine took longer than 120s; try again");
  assert.match(execFailure(new Error("spawn ENOENT"), 20000), /^could not run engine: .*spawn ENOENT/);
});

const withReview = (review) => ({ ...snap(), review });
const lekker = { command: "olko-github-pr:lekker-review", source: "plugin olko-github-pr", description: "FAANG-quality PR review", tested: true,
  params: [{ id: "pos0", kind: "choice", flag: null, options: ["scan", "deep"] }, { id: "base", kind: "text", flag: "--base" }, { id: "crossvendor", kind: "flag", flag: "--crossvendor" }] };

test("setup rows: default first, then repos with their own setting, then the rest alphabetically", () => {
  const rows = viewRows(withReview({ default: null, repos: { "example-org/zeta": { skill: "x:other", model: "opus", params: { deep: true } } } }), "setup");
  assert.deepEqual(rows.map((r) => r.scope), ["default", "example-org/zeta", "example-org/alpha", "example-org/helm"]);
  assert.equal(describeSetting(rows[1].setting), "other · opus · deep");
  assert.deepEqual(actionsFor(rows[0]).map((a) => a.id), ["edit"]);
  assert.deepEqual(actionsFor(rows[1]).map((a) => [a.id, a.label]), [["edit", "Edit"], ["reset", "Use default"]]);
  assert.equal(viewCount(withReview({ default: BUILTIN_SETTING, repos: { a: {} } }), "setup"), 2);
  assert.equal(overrideCount(snap()), 0);
  assert.equal(actionsFor(setupRows(withReview({ default: BUILTIN_SETTING, repos: {} }))[0])[1].label, "Use built-in");
});

test("setup rows are searchable by skill and by whether they override", () => {
  const rows = viewRows(withReview({ default: null, repos: { "example-org/zeta": { skill: "x:other", model: "opus" } } }), "setup");
  assert.deepEqual(filterRows(rows, "other").map((r) => r.scope), ["example-org/zeta"]);
  assert.deepEqual(filterRows(rows, "override").map((r) => r.scope), ["example-org/zeta"]);
});

test("the form starts from the saved setting, else what the scope inherits, else the built-in", () => {
  assert.deepEqual(formFor(null, null), { skill: BUILTIN_SETTING.skill, model: "sonnet", params: {} });
  assert.deepEqual(formFor(null, { skill: "x:a", model: "haiku", params: { p: 1 } }), { skill: "x:a", model: "haiku", params: { p: 1 } });
  const own = { skill: "x:b", params: { q: "v" } };
  assert.deepEqual(formFor(own, { skill: "x:a" }), { skill: "x:b", model: "sonnet", params: { q: "v" } });
});

test("form edits return new values: a new skill drops the old params, empty values are removed", () => {
  const form = formFor(null, null);
  const withParams = setParam(setParam(form, "pos0", "deep"), "crossvendor", true);
  assert.deepEqual(withParams.params, { pos0: "deep", crossvendor: true });
  assert.deepEqual(form.params, {});
  assert.deepEqual(setParam(withParams, "pos0", "").params, { crossvendor: true });
  assert.deepEqual(setParam(withParams, "crossvendor", false).params, { pos0: "deep" });
  assert.equal(chooseSkill(withParams, form.skill), withParams);
  assert.deepEqual(chooseSkill(withParams, "x:other").params, {});
  assert.equal(setModel(form, "opus").model, "opus");
  assert.deepEqual(toPayload(withParams), { skill: form.skill, model: "sonnet", params: { pos0: "deep", crossvendor: true } });
});

test("the command preview lists params in the skill's order, like the engine will", () => {
  const form = setParam(setParam(setParam(formFor(null, null), "crossvendor", true), "base", "main"), "pos0", "deep");
  assert.equal(commandPreview(form, lekker), "/olko-github-pr:lekker-review <PR link> deep --base main --crossvendor");
  assert.equal(commandPreview(formFor(null, null), lekker), "/olko-github-pr:lekker-review <PR link>");
});

test("skill search matches name, source and description", () => {
  const skills = [lekker, { command: "my-review", source: "user", description: "style checker", params: [] }];
  assert.deepEqual(filterSkills(skills, "style").map((s) => s.command), ["my-review"]);
  assert.deepEqual(filterSkills(skills, "faang").map((s) => s.command), [lekker.command]);
  assert.equal(filterSkills(skills, " ").length, 2);
});

test("why sections: reasons with causes and next steps, then guard denials, then log evidence", () => {
  const sections = whySections({
    status: "FAILED", attempts: 2, skill: "x:other-review", model: "sonnet", args: ["deep"], last_run_at: null,
    reasons: [{ reason: "exit 1", meaning: "Process ended.", causes: ["bad arg"], next: ["fix it"] }], other_reasons: ["odd"],
    guard_denials: 2, evidence: [{ label: "guard denied", text: "curl" }, { label: "guard denied", text: "wget" }],
    run_dir: "/r", log_path: "/l", log_missing: false,
  });
  assert.deepEqual(sections.map((s) => s.title), ["failed · attempt 2", "exit 1", "odd", "2 guard denial(s)", "From the log: guard denied"]);
  assert.deepEqual(sections[0].lines, ["Ran other-review · sonnet · deep"]);
  assert.deepEqual(sections[1].lines, ["Process ended.", "Could be: bad arg", "Do: fix it"]);
  assert.deepEqual(sections[4].lines, ["curl", "wget"]);
});

test("why says so when there is no log, and when the log file is gone", () => {
  const base = { status: "FAILED", attempts: 1, skill: "s", model: "m", reasons: [], evidence: [] };
  assert.equal(whySections({ ...base, run_dir: null }).at(-1).title, "No run log");
  assert.equal(whySections({ ...base, run_dir: "/r", log_missing: true, log_path: "/l" }).at(-1).title, "Log missing");
});

test("a log is opened only from the engine's logs folder", () => {
  const home = "/Users/me";
  assert.equal(logPathOk(`${home}/.local/state/pr-autoreview/logs/o+r-1-abc-1.log`, home), true);
  assert.equal(logPathOk(`${home}/.local/state/pr-autoreview/logs/../state.json`, home), false);
  assert.equal(logPathOk(`${home}/.local/state/pr-autoreview/logs/x.md`, home), false);
  assert.equal(logPathOk("/etc/passwd", home), false);
  assert.equal(logPathOk(null, home), false);
});

test("engine argv for the new commands never goes through a shell string", () => {
  assert.deepEqual(cli.reviewConfig(), ["review-config"]);
  assert.deepEqual(cli.saveReview("o/r", { skill: "s", params: { a: "x y" } }), ["review-config", "set", "o/r", '{"skill":"s","params":{"a":"x y"}}']);
  assert.deepEqual(cli.clearReview("default"), ["review-config", "clear", "default"]);
  assert.deepEqual(cli.why("o/r#1"), ["why", "o/r#1"]);
});
