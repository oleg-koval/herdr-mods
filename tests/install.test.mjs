import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = 'bash "$HOME/.config/herdr-app/mods/cache-expiry/claude-hook.sh"';

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-install-"));
  const settings = path.join(home, ".claude", "settings.json");
  const run = (...args) => spawnSync("sh", [path.join(repo, "install.sh"), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir(), HERDR_MODS_SRC: repo },
  });
  const read = () => JSON.parse(fs.readFileSync(settings, "utf8"));
  const write = (value) => {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };
  const commands = (event) => (read().hooks?.[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command));
  return { home, settings, run, read, write, commands, mods: path.join(home, ".config/herdr-app/mods") };
}

test("installs the pack's mods and adds its Claude hooks with $HOME paths", () => {
  const box = sandbox();
  const r = box.run("cache-expiry");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(box.mods, "cache-expiry/main.js")));
  assert.ok(fs.existsSync(path.join(box.mods, "cache-expiry/claude-hook.sh")));
  assert.deepEqual(box.commands("SessionStart"), [HOOK]);
  assert.deepEqual(box.commands("UserPromptSubmit"), [HOOK]);
});

test("a second run backs up the old mod and adds no duplicate hooks", () => {
  const box = sandbox();
  box.run("cache-expiry");
  const before = fs.readFileSync(box.settings, "utf8");
  const r = box.run("cache-expiry");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already in/);
  assert.equal(fs.readFileSync(box.settings, "utf8"), before);
  const backups = fs.readdirSync(path.join(box.home, ".config/herdr-app/mod-backups"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^cache-expiry-\d{8}-\d{6}$/);
});

test("keeps other settings and recognises a hook added by hand with an absolute path", () => {
  const box = sandbox();
  const manual = `bash "${box.home}/.config/herdr-app/mods/cache-expiry/claude-hook.sh"`;
  box.write({
    model: "opus",
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: manual }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
    },
  });
  const r = box.run("cache-expiry");
  assert.equal(r.status, 0, r.stderr);
  const after = box.read();
  assert.equal(after.model, "opus");
  assert.deepEqual(box.commands("SessionStart"), [manual]);
  assert.deepEqual(box.commands("UserPromptSubmit"), [HOOK]);
  assert.deepEqual(box.commands("Stop"), ["echo stop"]);
  assert.ok(fs.readdirSync(path.dirname(box.settings)).some((name) => name.startsWith("settings.json.bak-")));
});

test("a symlinked settings file stays a symlink", () => {
  const box = sandbox();
  const real = path.join(box.home, "dotfiles-settings.json");
  fs.writeFileSync(real, "{}\n");
  fs.mkdirSync(path.dirname(box.settings), { recursive: true });
  fs.symlinkSync(real, box.settings);
  assert.equal(box.run("cache-expiry").status, 0);
  assert.ok(fs.lstatSync(box.settings).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(real, "utf8")).hooks.SessionStart[0].hooks[0].command, HOOK);
});

test("--no-hooks and invalid JSON leave the settings file alone and print the hooks", () => {
  const box = sandbox();
  box.write("{ not json");
  const broken = box.run("cache-expiry");
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.stdout, /isn't valid JSON/);
  assert.match(broken.stdout, /SessionStart: \{"hooks"/);
  assert.equal(fs.readFileSync(box.settings, "utf8"), "{ not json");

  box.write({});
  const skipped = box.run("--no-hooks", "cache-expiry");
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /by hand/);
  assert.deepEqual(box.read(), {});
});

test("a pack without hooks installs only mods; unknown names fail; --list lists packs", () => {
  const box = sandbox();
  const two = box.run("two-up");
  assert.equal(two.status, 0, two.stderr);
  assert.ok(fs.existsSync(path.join(box.mods, "two-up")));
  assert.equal(fs.existsSync(box.settings), false);

  const missing = box.run("nope");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no pack named nope/);
  assert.equal(box.run("../etc").status, 1);

  const list = box.run("--list");
  assert.equal(list.status, 0);
  assert.ok(list.stdout.split("\n").includes("cache-expiry"));
});
