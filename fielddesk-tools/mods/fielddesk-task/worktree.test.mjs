import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { taskBranch, taskWorktree } from "./worktree.js";

test("task title generates a safe branch but stays intact for the caller", () => {
  assert.equal(taskBranch("Fix café / #42"), "task/fix-cafe-42");
  assert.throws(() => taskBranch(" / 🚀 "), /letters or numbers/);
});

test("one worktree per task, including retries from a linked worktree", async () => {
  const temp = mkdtempSync(join(tmpdir(), "fielddesk-task-"));
  try {
    const repo = join(temp, "Example repo");
    mkdirSync(repo);
    const git = (cwd, args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
    git(repo, ["init"]);
    git(repo, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]);
    const root = join(temp, "worktrees");
    const checkout = await taskWorktree(git, repo, root, taskBranch("Fix café"));
    assert.equal(git(checkout, ["branch", "--show-current"]), "task/fix-cafe");
    assert.equal(git(checkout, ["rev-parse", "HEAD"]), git(repo, ["rev-parse", "HEAD"]));
    assert.equal(git(await taskWorktree(git, checkout, root, taskBranch("Fix café")), ["rev-parse", "--show-toplevel"]),
      git(checkout, ["rev-parse", "--show-toplevel"]));
    assert.equal(git(repo, ["worktree", "list", "--porcelain"]).split("worktree ").length - 1, 2);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
