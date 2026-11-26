// Pure: the New space dialog's repo search, local checkouts, clone targets, agent tiles and
// first message. Nothing here reads Herdr or runs a program; create.js does that.

export const REPO_TTL_MS = 6 * 60 * 60 * 1000;
export const RECENT_MAX = 8;
// Shown first, in this order, when installed; the rest keep Herdr's most-picked order.
const PREFERRED_AGENTS = ["claude", "codex", "pi"];
// Where a repo that is not on this machine yet gets cloned, by owner (lowercased).
const CLONE_ROOTS = { "teifi-digital": "Work/01_projects", "oleg-koval": "projects/personal/active" };
const FALLBACK_CLONE_ROOT = "code";

const lower = (s) => String(s ?? "").toLowerCase();

/** `gh repo list --json nameWithOwner,description,pushedAt,isArchived` output, archived left out. */
export function parseRepoList(json) {
  const rows = Array.isArray(json) ? json : [];
  return rows
    .filter((row) => row && typeof row.nameWithOwner === "string" && !row.isArchived)
    .map((row) => {
      const [owner, name] = row.nameWithOwner.split("/");
      return { full: row.nameWithOwner, owner, name, description: row.description ?? "", pushedAt: row.pushedAt ?? "" };
    });
}

/** Whether a cache written at `at` is older than the TTL (no cache counts as stale). */
export function isStale(at, now, ttl = REPO_TTL_MS) {
  return typeof at !== "number" || now - at > ttl;
}

/** "owner/repo", lowercased, from a git remote URL (https, ssh, scp-style); null if it isn't one. */
export function ownerRepoOf(url) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? lower(`${m[1]}/${m[2]}`) : null;
}

const folderName = (folder) => folder.split("/").pop();

// Which of two checkouts of one repo to open: a folder named like the repo, then a main
// checkout (.git is a folder) over a worktree, then the shorter name (gic-live over gic-live-1247).
function better(a, b, repoName) {
  const named = (c) => (lower(folderName(c.folder)) === repoName ? 0 : 1);
  const kind = (c) => (c.main ? 0 : 1);
  return named(a) - named(b) || kind(a) - kind(b) || folderName(a.folder).length - folderName(b.folder).length;
}

/** "<folder>\t<origin url>[\t<d|f>]" lines (d: .git is a folder) -> { "owner/repo": best folder }. */
export function parseLocalIndex(stdout) {
  const checkouts = String(stdout ?? "").split("\n").map((line) => line.split("\t"))
    .filter(([folder, url]) => folder && url)
    .map(([folder, url, kind]) => ({ key: ownerRepoOf(url), folder: folder.replace(/\/+$/, ""), main: kind !== "f" }))
    .filter((c) => c.key);
  const best = checkouts.reduce((index, c) => {
    const held = index[c.key];
    return held && better(held, c, c.key.split("/")[1]) <= 0 ? index : { ...index, [c.key]: c };
  }, {});
  return Object.fromEntries(Object.entries(best).map(([key, c]) => [key, c.folder]));
}

/** Where the repo is on this machine, else where it will be cloned. */
export function repoFolder(repo, index, home) {
  const local = index?.[lower(repo.full)];
  if (local) return { folder: local, cloned: true };
  const root = CLONE_ROOTS[lower(repo.owner)] ?? FALLBACK_CLONE_ROOT;
  return { folder: `${home}/${root}/${repo.name}`, cloned: false };
}

/** "~/x" for a folder under home, for showing. */
export function tilde(folder, home) {
  return home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;
}

const isBoundary = (text, i) => i === 0 || /[-_./\s]/.test(text[i - 1]);

/**
 * fzf-style subsequence score of `query` in `text`, higher is better; -1 when the letters are not
 * all there in order. Rewards a prefix, matches at word starts and runs of adjacent letters;
 * penalises gaps and long names so "gic" puts gic-live above magic-gic-tools.
 */
export function fuzzyScore(query, text) {
  const q = lower(query).replace(/\s+/g, "");
  const s = lower(text);
  if (!q) return 0;
  let at = -1;
  let score = 0;
  let run = 0;
  for (const ch of q) {
    const next = s.indexOf(ch, at + 1);
    if (next < 0) return -1;
    const adjacent = next === at + 1;
    run = adjacent ? run + 1 : 0;
    score += 1 + (adjacent ? 2 + run : 0) + (isBoundary(s, next) ? 3 : 0) - (adjacent || at < 0 ? 0 : Math.min(next - at - 1, 3));
    at = next;
  }
  return score + (s.startsWith(q) ? 6 : 0) + (s.includes(q) ? 4 : 0) - s.length / 50;
}

/** The repo's best score: its own name counts more than its owner. */
function repoScore(query, repo) {
  const byName = fuzzyScore(query, repo.name);
  const byFull = fuzzyScore(query, repo.full);
  return Math.max(byName < 0 ? -1 : byName + 2, byFull);
}

/** The `limit` best repos for `query`; an empty query lists recent picks, then latest pushed. */
export function rankRepos(repos, query, recent = [], limit = 6) {
  const recency = (repo) => {
    const i = recent.indexOf(repo.full);
    return i < 0 ? Infinity : i;
  };
  if (!String(query ?? "").trim()) {
    return [...repos]
      .sort((a, b) => recency(a) - recency(b) || String(b.pushedAt).localeCompare(String(a.pushedAt)))
      .slice(0, limit);
  }
  return repos
    .map((repo) => ({ repo, score: repoScore(query, repo) + (recency(repo) < Infinity ? 1.5 : 0) }))
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => b.score - a.score || a.repo.full.length - b.repo.full.length)
    .slice(0, limit)
    .map((hit) => hit.repo);
}

/** `full` moved to the front of the recent list, at most RECENT_MAX kept. */
export function pushRecent(recent, full) {
  return [full, ...(recent ?? []).filter((entry) => entry !== full)].slice(0, RECENT_MAX);
}

export const TERMINAL = { key: "terminal", name: "Terminal", icon: "icons/shell.svg", tint: true, run: null };

/** Installed agents for the logo row: preferred ones first, then Herdr's order, then Terminal. */
export function agentTiles(agents) {
  const installed = (agents ?? []).filter((agent) => agent.installed);
  const rank = (agent) => {
    const i = PREFERRED_AGENTS.indexOf(agent.key);
    return i < 0 ? PREFERRED_AGENTS.length : i;
  };
  const ordered = installed.map((agent, i) => ({ agent, i }))
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.i - b.i)
    .map(({ agent }) => agent);
  return [...ordered, TERMINAL];
}

/** The space's name: what was typed, else the repo's name, else "" (Herdr names it). */
export function spaceName(typed, repo) {
  return String(typed ?? "").trim() || repo?.name || "";
}

/** The agent's first message: the starter text and the attached files' paths; "" for none. */
export function composeTask(text, files) {
  const body = String(text ?? "").trim();
  const paths = (files ?? []).map((file) => file.path);
  if (!paths.length) return body;
  const list = `Attached files (read them, images included):\n${paths.map((path) => `- ${path}`).join("\n")}`;
  return `${body || "See the attached files."}\n\n${list}`;
}

/** The `space.new` arguments; argv and task only for an agent (a terminal has no first message). */
export function spaceArgs({ name, folder, agent, task }) {
  const args = { ...(name ? { name } : {}), ...(folder ? { folder } : {}) };
  if (!agent?.run) return args;
  return { ...args, argv: agent.run, ...(task ? { task } : {}) };
}
