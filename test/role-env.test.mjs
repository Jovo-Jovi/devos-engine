import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

test("role-env.test.mjs swaps a role kit and restores the original bytes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-role-"));
  try {
    const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(staged.status, 0, staged.stderr);
    assert.equal(git(["init"], dir).status, 0);
    assert.equal(git(["config", "maintenance.auto", "false"], dir).status, 0);
    assert.equal(git(["config", "gc.auto", "0"], dir).status, 0);
    assert.equal(git(["config", "user.email", "devos@example.com"], dir).status, 0);
    assert.equal(git(["config", "user.name", "devos"], dir).status, 0);
    assert.equal(git(["config", "core.autocrlf", "false"], dir).status, 0);
    assert.equal(git(["add", "-A"], dir).status, 0);
    const committed = git(["commit", "-m", "init"], dir);
    assert.equal(committed.status, 0, committed.stderr);
    const role = path.join(dir, "scripts", "devos", "role-env.mjs");
    const run = (args) => spawnSync(process.execPath, [role, ...args], { cwd: dir, encoding: "utf8", windowsHide: true });

    const swapped = run(["swap", "cursor-reviewer"]);
    assert.equal(swapped.status, 0, swapped.stderr);
    const cli = JSON.parse(readFileSync(path.join(dir, ".cursor", "cli.json"), "utf8"));
    assert.equal(cli.permissions.allow.includes("Write(docs/reviews/**)"), true);
    assert.equal(existsSync(path.join(dir, ".cursor", "hooks.json")), false);
    const restored = run(["restore"]);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(git(["status", "--porcelain"], dir).stdout, "");
    const originalCli = readFileSync(path.join(dir, ".cursor", "cli.json"));

    const claude = run(["swap", "claude-builder"]);
    assert.equal(claude.status, 0, claude.stderr);
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const deny = settings.permissions.deny;
    assert.equal(deny.includes("Edit(/src/**)"), false);
    const defaults = JSON.parse(readFileSync(path.join(dir, "devos", "engine.defaults.json"), "utf8"));
    for (const glob of defaults.surfaces.builder.deny) {
      assert.equal(deny.includes(`Edit(/${glob})`), true, glob);
      assert.equal(deny.includes(`Write(/${glob})`), true, glob);
    }
    assert.equal(run(["restore"]).status, 0);

    assert.equal(run(["swap", "cursor-reviewer"]).status, 0);
    const stashed = path.join(dir, ".devos", "role-stash", "orig", ".cursor", "cli.json");
    writeFileSync(stashed, "{\"tampered\":true}\n");
    const failed = run(["restore"]);
    assert.equal(failed.status, 1);
    assert.equal(failed.stderr.includes("role-env: restore left changes in"), true, failed.stderr);
    assert.equal(originalCli.equals(readFileSync(path.join(dir, ".cursor", "cli.json"))), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
