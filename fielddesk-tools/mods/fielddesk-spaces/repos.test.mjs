import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentTiles, composeTask, expandHome, fuzzyScore, isStale, listCommands, ownerRepoOf, parseLocalIndex, parseRepoList,
  pushRecent, rankRepos, repoConfigFrom, repoFolder, scanScript, spaceArgs, spaceName, tilde, TERMINAL, RECENT_MAX,
  REPO_TTL_MS,
} from "./repos.js";

const repo = (full, extra = {}) => {
  const [owner, name] = full.split("/");
  return { full, owner, name, description: "", pushedAt: "", ...extra };
};
const repos = [
  repo("Teifi-Digital/gic-integrations", { pushedAt: "2026-11-20" }),
  repo("Teifi-Digital/gic-live", { pushedAt: "2026-11-25" }),
  repo("Teifi-Digital/magic-tools", { pushedAt: "2026-01-01" }),
  repo("oleg-koval/herdr-mods", { pushedAt: "2026-11-26" }),
  repo("oleg-koval/ai-dotfiles", { pushedAt: "2026-11-24" }),
];

test("parseRepoList drops archived and malformed rows", () => {
  const got = parseRepoList([
    { nameWithOwner: "o/a", description: "d", pushedAt: "x", isArchived: false },
    { nameWithOwner: "o/old", isArchived: true },
    { description: "no name" },
    null,
  ]);
  assert.deepEqual(got, [{ full: "o/a", owner: "o", name: "a", description: "d", pushedAt: "x" }]);
  assert.deepEqual(parseRepoList(null), []);
});

test("isStale: missing or older than the TTL", () => {
  assert.equal(isStale(undefined, 10), true);
  assert.equal(isStale(0, REPO_TTL_MS), false);
  assert.equal(isStale(0, REPO_TTL_MS + 1), true);
});

test("ownerRepoOf reads https, ssh and scp-style remotes", () => {
  assert.equal(ownerRepoOf("https://github.com/Teifi-Digital/gic-live.git"), "teifi-digital/gic-live");
  assert.equal(ownerRepoOf("git@github.com:oleg-koval/herdr-mods.git"), "oleg-koval/herdr-mods");
  assert.equal(ownerRepoOf("ssh://git@github.com/oleg-koval/x/"), "oleg-koval/x");
  assert.equal(ownerRepoOf(""), null);
});

test("parseLocalIndex picks the checkout named like the repo, then a main checkout", () => {
  const out = [
    "/h/Work/01_projects/gic-live-1247\thttps://github.com/Teifi-Digital/gic-live.git\td",
    "/h/Work/01_projects/gic-live/\tgit@github.com:Teifi-Digital/gic-live.git\td",
    "/h/Work/01_projects/gic-1488-pr891\thttps://github.com/Teifi-Digital/gic-integrations\tf",
    "/h/Work/01_projects/gic-int-main\thttps://github.com/Teifi-Digital/gic-integrations\td",
    "/h/scratch\t",
    "",
  ].join("\n");
  assert.deepEqual(parseLocalIndex(out), {
    "teifi-digital/gic-live": "/h/Work/01_projects/gic-live",
    "teifi-digital/gic-integrations": "/h/Work/01_projects/gic-int-main",
  });
});

test("parseLocalIndex reads two-column lines as main checkouts", () => {
  assert.deepEqual(parseLocalIndex("/h/code/x\thttps://github.com/o/x.git"), { "o/x": "/h/code/x" });
});

const config = repoConfigFrom(JSON.stringify({
  fielddesk_repos: { owners: ["Teifi-Digital", "oleg-koval"], cloneDir: "~/src", roots: { "Teifi-Digital": "~/Work/01_projects/" } },
}), "/h");

test("repoConfigFrom reads fielddesk_repos and falls back to ~/code", () => {
  assert.deepEqual(config, {
    owners: ["Teifi-Digital", "oleg-koval"], scan: ["/h/src"], cloneDir: "/h/src", roots: { "teifi-digital": "/h/Work/01_projects/" },
  });
  const fallback = { owners: [], scan: ["/h/code"], cloneDir: "/h/code", roots: {} };
  assert.deepEqual(repoConfigFrom("not json", "/h"), fallback);
  assert.deepEqual(repoConfigFrom(JSON.stringify({ fielddesk_repos: { owners: "x", scan: [1, " ", "/abs"], roots: { a: 3 } } }), "/h"),
    { owners: [], scan: ["/abs"], cloneDir: "/h/code", roots: {} });
});

test("expandHome only rewrites a leading ~", () => {
  assert.equal(expandHome("~", "/h"), "/h");
  assert.equal(expandHome("~/x", "/h"), "/h/x");
  assert.equal(expandHome("/a/~/b", "/h"), "/a/~/b");
});

test("repoFolder: the local checkout, else a clone target by owner, else cloneDir", () => {
  const index = { "teifi-digital/gic-live": "/h/Work/01_projects/gic-live" };
  assert.deepEqual(repoFolder(repos[1], index, config), { folder: "/h/Work/01_projects/gic-live", cloned: true });
  assert.deepEqual(repoFolder(repos[0], index, config), { folder: "/h/Work/01_projects/gic-integrations", cloned: false });
  assert.deepEqual(repoFolder(repos[3], {}, config), { folder: "/h/src/herdr-mods", cloned: false });
});

test("listCommands: one per owner, or your own repos", () => {
  assert.deepEqual(listCommands(["a", "b"]).map((args) => args.slice(0, 3)), [["repo", "list", "a"], ["repo", "list", "b"]]);
  assert.deepEqual(listCommands([])[0].slice(0, 3), ["repo", "list", "--limit"]);
});

test("scanScript quotes each folder and keeps the glob outside the quotes", () => {
  const script = scanScript(["/h/my code/", "/h/it's"]);
  assert.match(script, / '\/h\/my code'\/\*\/\.git\/config /);
  assert.match(script, / '\/h\/it'\\''s'\/\*\/\.git\/config /);
  assert.match(script, /; true$/);
});

test("tilde shortens only folders under home", () => {
  assert.equal(tilde("/h/code/x", "/h"), "~/code/x");
  assert.equal(tilde("/hx/code", "/h"), "/hx/code");
});

test("fuzzyScore: subsequence only, prefix and word starts win", () => {
  assert.equal(fuzzyScore("xyz", "gic-live"), -1);
  assert.equal(fuzzyScore("", "anything"), 0);
  assert.ok(fuzzyScore("gl", "gic-live") > 0);
  assert.ok(fuzzyScore("gic", "gic-live") > fuzzyScore("gic", "magic-tools"));
  assert.ok(fuzzyScore("hm", "herdr-mods") > fuzzyScore("hm", "the-machine"));
});

test("rankRepos: typed query ranks by name, owner as a fallback", () => {
  assert.deepEqual(rankRepos(repos, "gic").map((r) => r.name).slice(0, 2).sort(), ["gic-integrations", "gic-live"]);
  assert.equal(rankRepos(repos, "gic").at(-1).name, "magic-tools");
  assert.deepEqual(rankRepos(repos, "oleg").map((r) => r.owner), ["oleg-koval", "oleg-koval"]);
  assert.deepEqual(rankRepos(repos, "qqq"), []);
});

test("rankRepos: empty query lists recent picks, then latest pushed", () => {
  const got = rankRepos(repos, "  ", ["Teifi-Digital/magic-tools"], 3).map((r) => r.name);
  assert.deepEqual(got, ["magic-tools", "herdr-mods", "gic-live"]);
});

test("rankRepos: a recent pick breaks a close tie", () => {
  const got = rankRepos(repos, "gic", ["Teifi-Digital/gic-integrations"]).map((r) => r.name);
  assert.equal(got[0], "gic-integrations");
});

test("pushRecent moves to front, dedupes, caps, and leaves the input alone", () => {
  const before = ["a", "b"];
  assert.deepEqual(pushRecent(before, "b"), ["b", "a"]);
  assert.deepEqual(before, ["a", "b"]);
  const many = Array.from({ length: RECENT_MAX }, (_, i) => String(i));
  assert.equal(pushRecent(many, "new").length, RECENT_MAX);
  assert.deepEqual(pushRecent(undefined, "x"), ["x"]);
});

test("agentTiles: installed only, claude/codex/pi first, Terminal last", () => {
  const agents = [
    { key: "opencode", installed: true },
    { key: "pi", installed: true },
    { key: "amp", installed: false },
    { key: "claude", installed: true },
    { key: "codex", installed: true },
  ];
  assert.deepEqual(agentTiles(agents).map((a) => a.key), ["claude", "codex", "pi", "opencode", "terminal"]);
  assert.deepEqual(agentTiles(undefined), [TERMINAL]);
});

test("spaceName: typed, else repo name, else blank", () => {
  assert.equal(spaceName("  mine ", repos[0]), "mine");
  assert.equal(spaceName("", repos[0]), "gic-integrations");
  assert.equal(spaceName("", null), "");
});

test("composeTask: text, files, both, neither", () => {
  assert.equal(composeTask("  fix it ", []), "fix it");
  assert.equal(composeTask("", []), "");
  assert.equal(composeTask("", [{ path: "/a.png" }]), "See the attached files.\n\nAttached files (read them, images included):\n- /a.png");
  assert.match(composeTask("look", [{ path: "/a" }, { path: "/b" }]), /^look\n\n.*\n- \/a\n- \/b$/);
});

test("spaceArgs: agent gets argv and task, Terminal gets neither", () => {
  const claude = { key: "claude", run: ["claude"] };
  assert.deepEqual(spaceArgs({ name: "n", folder: "/f", agent: claude, task: "t" }), { name: "n", folder: "/f", argv: ["claude"], task: "t" });
  assert.deepEqual(spaceArgs({ name: "", folder: "/f", agent: claude, task: "" }), { folder: "/f", argv: ["claude"] });
  assert.deepEqual(spaceArgs({ name: "n", folder: "/f", agent: TERMINAL, task: "t" }), { name: "n", folder: "/f" });
});
