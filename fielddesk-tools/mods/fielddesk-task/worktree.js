export function taskBranch(title) {
  const slug = title.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  if (!slug || slug.length > 64) throw new Error("Use a shorter task name with letters or numbers (up to 64 characters).");
  return `task/${slug}`;
}

export async function taskWorktree(git, folder, root, branch) {
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const name = common.endsWith("/.git") ? common.split("/").at(-2) : common.split("/").at(-1);
  const worktrees = await git(folder, ["worktree", "list", "--porcelain", "-z"]);
  const existing = worktrees.split("\0\0").map((entry) => entry.split("\0"))
    .find((entry) => entry.includes(`branch refs/heads/${branch}`));
  if (existing) {
    if (existing.some((line) => line.startsWith("prunable"))) {
      throw new Error("Git still has a record for this worktree, but the folder is missing.");
    }
    return existing[0].slice("worktree ".length);
  }
  const path = `${root}/${name}/${branch.slice("task/".length)}`;
  await git(folder, ["worktree", "add", "-b", branch, path, "HEAD"]);
  return path;
}
