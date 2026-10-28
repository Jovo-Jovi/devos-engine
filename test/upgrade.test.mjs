import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildManifest, manifestText } from "../tools/build-manifest.mjs";
import { planUpgrade } from "../lib/upgrade.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function git(args, cwd) {
  if (!cwd) throw new Error("git cwd required");
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function devos(args, cwd, env) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    env,
  });
}

function initRepo(dir) {
  assert.equal(git(["init", "-b", "main"], dir).status, 0);
  for (const [key, value] of [
    ["user.email", "devos@example.com"],
    ["user.name", "devos"],
    ["core.autocrlf", "false"],
    ["maintenance.auto", "false"],
    ["gc.auto", "0"],
  ]) {
    assert.equal(git(["config", key, value], dir).status, 0, key);
  }
}

function commitAll(dir, message) {
  assert.equal(git(["add", "-A"], dir).status, 0);
  const committed = git(["commit", "-m", message], dir);
  assert.equal(committed.status, 0, committed.stderr);
}

function file(sha) {
  return { path: "doc.txt", sha256: sha };
}

function planned(installed, shipped, current) {
  return planUpgrade({ files: installed }, { files: shipped }, current);
}

function outcome(installed, shipped, current) {
  const plan = planned(installed, shipped, current);
  assert.equal(plan.length, 1);
  return plan[0];
}

test("upgrade.test.mjs plan add", () => {
  assert.equal(outcome([], [file("n")], { "doc.txt": null }).outcome, "add");
});

test("upgrade.test.mjs plan adopt an identical new file", () => {
  assert.equal(outcome([], [file("n")], { "doc.txt": "n" }).outcome, "adopt");
});

test("upgrade.test.mjs plan conflict when a new file already exists", () => {
  const item = outcome([], [file("n")], { "doc.txt": "other" });
  assert.equal(item.outcome, "conflict");
  assert.equal(item.reason, "exists, not installed by devos");
});

test("upgrade.test.mjs plan drop", () => {
  assert.equal(outcome([file("L")], [], { "doc.txt": null }).outcome, "drop");
});

test("upgrade.test.mjs plan remove", () => {
  assert.equal(outcome([file("L")], [], { "doc.txt": "L" }).outcome, "remove");
});

test("upgrade.test.mjs plan conflict when a local edit was removed upstream", () => {
  const item = outcome([file("L")], [], { "doc.txt": "other" });
  assert.equal(item.outcome, "conflict");
  assert.equal(item.reason, "edited locally, removed upstream");
});

test("upgrade.test.mjs plan same", () => {
  assert.equal(outcome([file("L")], [file("L")], { "doc.txt": "L" }).outcome, "same");
});

test("upgrade.test.mjs plan kept", () => {
  for (const current of ["other", null]) {
    assert.equal(outcome([file("L")], [file("L")], { "doc.txt": current }).outcome, "kept");
  }
});

test("upgrade.test.mjs plan update", () => {
  assert.equal(outcome([file("L")], [file("N")], { "doc.txt": "L" }).outcome, "update");
});

test("upgrade.test.mjs plan adopt an upstream change already on disk", () => {
  assert.equal(outcome([file("L")], [file("N")], { "doc.txt": "N" }).outcome, "adopt");
});

test("upgrade.test.mjs plan conflict when both sides changed", () => {
  const item = outcome([file("L")], [file("N")], { "doc.txt": "other" });
  assert.equal(item.outcome, "conflict");
  assert.equal(item.reason, "edited locally and changed upstream");
});

test("upgrade.test.mjs plan conflict when a local delete changed upstream", () => {
  const item = outcome([file("L")], [file("N")], { "doc.txt": null });
  assert.equal(item.outcome, "conflict");
  assert.equal(item.reason, "deleted locally and changed upstream");
});

function fillRelease(dir, mutate) {
  mkdirSync(dir);
  cpSync(path.join(root, "package.json"), path.join(dir, "package.json"));
  cpSync(path.join(root, "bin"), path.join(dir, "bin"), { recursive: true });
  cpSync(path.join(root, "lib"), path.join(dir, "lib"), { recursive: true });
  cpSync(path.join(root, "payload"), path.join(dir, "payload"), { recursive: true });
  const pkgPath = path.join(dir, "package.json");
  const pkg = readFileSync(pkgPath, "utf8").replace("\"version\": \"1.3.1\"", "\"version\": \"1.3.2\"");
  writeFileSync(pkgPath, pkg);
  if (mutate) mutate(dir);
  else {
    const doctor = path.join(dir, "payload", "files", "devos", "prompts", "doctor.md");
    let text = readFileSync(doctor, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    text += "Upgrade test line.\n";
    writeFileSync(doctor, text);
  }
  writeFileSync(path.join(dir, "payload", "manifest.json"), manifestText(buildManifest(dir)));
}

function makeNext(dir) {
  fillRelease(dir);
}

function writeStub(dir) {
  if (windows) {
    writeFileSync(path.join(dir, "gh-log.mjs"), "import { appendFileSync } from \"node:fs\";\nappendFileSync(process.env.DEVOS_GH_LOG, process.argv.slice(2).join(\" \") + \"\\n\");\n");
    writeFileSync(path.join(dir, "gh.cmd"), "@echo off\r\nnode \"%~dp0gh-log.mjs\" %*\r\n");
    return;
  }
  const stub = path.join(dir, "gh");
  writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$DEVOS_GH_LOG\"\n");
  chmodSync(stub, 0o755);
}

function stage(options) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-upgrade-"));
  const project = path.join(parent, "project");
  const next = path.join(parent, "next");
  const stubs = path.join(parent, "bin");
  mkdirSync(project);
  mkdirSync(stubs);
  initRepo(project);
  const installed = devos(["install", project, "--key", "DEMO"], project);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  commitAll(project, "install");
  if (options.edit) {
    const doctor = path.join(project, "devos", "prompts", "doctor.md");
    let text = readFileSync(doctor, "utf8");
    if (!text.endsWith("\n")) text += "\n";
    text += "Project edit line.\n";
    writeFileSync(doctor, text);
    commitAll(project, "edit doctor");
  }
  if (options.origin) {
    const origin = path.join(parent, "origin.git");
    assert.equal(git(["init", "--bare", "-b", "main", origin], parent).status, 0);
    assert.equal(git(["remote", "add", "origin", origin], project).status, 0);
    const pushed = git(["push", "-u", "origin", "main"], project);
    assert.equal(pushed.status, 0, pushed.stderr);
  }
  if (options.missingOrigin) {
    assert.equal(git(["remote", "add", "origin", path.join(parent, "missing.git")], project).status, 0);
  }
  fillRelease(next, options.mutate);
  writeStub(stubs);
  const log = path.join(parent, "gh-log.txt");
  const env = {
    ...process.env,
    PATH: `${stubs}${path.delimiter}${process.env.PATH}`,
    DEVOS_GH_LOG: log,
    GIT_TERMINAL_PROMPT: "0",
  };
  return { parent, project, next, log, env };
}

function names(dir, range) {
  const diff = git(["diff", "--name-only", range], dir);
  assert.equal(diff.status, 0, diff.stderr);
  return diff.stdout.split(/\r?\n/).filter(Boolean).sort();
}

test("upgrade.test.mjs publishes one updated file", () => {
  const staged = stage({ origin: true });
  try {
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos upgrade 1.3.1 to 1.3.2: 1 updated, 0 added, 0 removed, 0 conflicts"), true, result.stdout);
    assert.deepEqual(names(staged.project, "main..devos/upgrade-1.3.2"), ["devos/engine.lock.json", "devos/prompts/doctor.md"]);
    assert.equal(git(["log", "-1", "--format=%s", "devos/upgrade-1.3.2"], staged.project).stdout.trim(), "DEV_OS upgrade 1.3.1 to 1.3.2");
    const branchLock = JSON.parse(git(["show", "devos/upgrade-1.3.2:devos/engine.lock.json"], staged.project).stdout);
    assert.equal(branchLock.engine_version, "1.3.2");
    assert.equal(branchLock.files.length, JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8")).files.length);
    assert.equal(git(["show", "devos/upgrade-1.3.2:devos/prompts/doctor.md"], staged.project).stdout.includes("Upgrade test line."), true);
    const remote = git(["ls-remote", "origin", "refs/heads/devos/upgrade-1.3.2"], staged.project);
    assert.equal(remote.status, 0, remote.stderr);
    assert.equal(remote.stdout.includes("refs/heads/devos/upgrade-1.3.2"), true, remote.stdout);
    const seen = readFileSync(staged.log, "utf8");
    for (const needle of ["pr create", "--base", "main", "DEV_OS upgrade 1.3.1 to 1.3.2"]) {
      assert.equal(seen.includes(needle), true, seen);
    }
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs leaves a local edit as a conflict", () => {
  const staged = stage({ origin: true, edit: true });
  try {
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos upgrade 1.3.1 to 1.3.2: 0 updated, 0 added, 0 removed, 1 conflicts"), true, result.stdout);
    const body = readFileSync(path.join(staged.project, ".git", "devos-upgrade-body.md"), "utf8");
    assert.equal(body.includes("- devos/prompts/doctor.md — edited locally and changed upstream"), true, body);
    const doctor = readFileSync(path.join(staged.project, "devos", "prompts", "doctor.md"), "utf8");
    assert.equal(doctor.includes("Project edit line."), true);
    assert.equal(doctor.includes("Upgrade test line."), false);
    assert.deepEqual(names(staged.project, "main..devos/upgrade-1.3.2"), ["devos/engine.lock.json"]);
    const mainLock = JSON.parse(git(["show", "main:devos/engine.lock.json"], staged.project).stdout);
    const branchLock = JSON.parse(git(["show", "devos/upgrade-1.3.2:devos/engine.lock.json"], staged.project).stdout);
    const doctorSha = (lock) => lock.files.find((file) => file.path === "devos/prompts/doctor.md").sha256;
    assert.equal(doctorSha(branchLock), doctorSha(mainLock));
    assert.equal(branchLock.engine_version, "1.3.2");
    assert.equal(branchLock.files.length, JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8")).files.length);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs refuses a dirty tree", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-upgrade-"));
  const project = path.join(parent, "project");
  try {
    mkdirSync(project);
    initRepo(project);
    const installed = devos(["install", project, "--key", "DEMO"], project);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    commitAll(project, "install");
    writeFileSync(path.join(project, "notes.txt"), "untracked\n");
    const result = devos(["upgrade"], project);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes("devos: the working tree is not clean; commit or stash first"), true, result.stdout);
    assert.equal(git(["branch", "--list", "devos/*"], project).stdout.trim(), "");
  } finally {
    cleanup(parent);
  }
});

test("upgrade.test.mjs reports the same engine as up to date", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-upgrade-"));
  const project = path.join(parent, "project");
  try {
    mkdirSync(project);
    initRepo(project);
    const installed = devos(["install", project, "--key", "DEMO"], project);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    commitAll(project, "install");
    const result = devos(["upgrade"], project);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: up to date (1.3.1)"), true, result.stdout);
    assert.equal(git(["branch", "--list", "devos/*"], project).stdout.trim(), "");
  } finally {
    cleanup(parent);
  }
});

test("upgrade.test.mjs --local commits without gh", () => {
  const staged = stage({});
  try {
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", "--local"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: branch devos/upgrade-1.3.2 committed locally (--local)"), true, result.stdout);
    assert.equal(existsSync(staged.log), false);
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs rolls back when config generation fails", () => {
  const staged = stage({
    mutate(dir) {
      const file = path.join(dir, "payload", "files", "devos", "engine.defaults.json");
      const defaults = JSON.parse(readFileSync(file, "utf8"));
      defaults.reviewer.deep_paths = "src/**";
      writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`);
    },
  });
  try {
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", "--local"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: upgrade failed; rolled back, nothing changed"), true, result.stdout);
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
    assert.equal(git(["branch", "--list", "devos/*"], staged.project).stdout.trim(), "");
    const lock = JSON.parse(readFileSync(path.join(staged.project, "devos", "engine.lock.json"), "utf8"));
    assert.equal(lock.engine_version, "1.3.1");
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs rolls back when the commit fails", { skip: windows }, () => {
  const staged = stage({
    mutate(dir) {
      writeFileSync(path.join(dir, "payload", "files", "devos", "prompts", "extra.md"), "Extra prompt.\n");
    },
  });
  try {
    const hooks = path.join(staged.project, "hooks");
    mkdirSync(hooks);
    const hook = path.join(hooks, "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    assert.equal(git(["add", "--", "hooks/pre-commit"], staged.project).status, 0);
    const hookCommit = git(["commit", "-m", "hook"], staged.project);
    assert.equal(hookCommit.status, 0, hookCommit.stderr);
    assert.equal(git(["config", "core.hooksPath", "hooks"], staged.project).status, 0);
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", "--local"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: upgrade failed; rolled back, nothing changed"), true, result.stdout);
    assert.equal(existsSync(path.join(staged.project, "devos", "prompts", "extra.md")), false);
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
    assert.equal(git(["branch", "--list", "devos/*"], staged.project).stdout.trim(), "");
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs keeps the branch when the push fails", () => {
  const staged = stage({ missingOrigin: true });
  try {
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: branch devos/upgrade-1.3.2 is committed; push it and open the pull request by hand, or delete it to retry"), true, result.stdout);
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
    assert.equal(git(["rev-list", "--count", "main..devos/upgrade-1.3.2"], staged.project).stdout.trim(), "1");
  } finally {
    cleanup(staged.parent);
  }
});
