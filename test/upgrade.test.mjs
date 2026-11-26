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
// E85d (D-E19): the engine's version from package.json, so a release candidate's bump changes no line here
// (test/version.test.mjs names it).
const VERSION = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
// The release a staged engine has: X.Y.Z after X.Y.Z-rc.N, X.Y.(Z+1) after X.Y.Z.
const NEXT = nextRelease(VERSION);

function nextRelease(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-rc\.\d+)?$/.exec(version);
  if (!match) throw new Error(`not a release or a release candidate: ${version}`);
  return match[4] ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
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
  const pkg = readFileSync(pkgPath, "utf8").replace(`"version": "${VERSION}"`, `"version": "${NEXT}"`);
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
    assert.equal(result.stdout.includes(`devos upgrade ${VERSION} to ${NEXT}: 1 updated, 0 added, 0 removed, 0 conflicts`), true, result.stdout);
    assert.deepEqual(names(staged.project, `main..devos/upgrade-${NEXT}`), ["devos/engine.lock.json", "devos/prompts/doctor.md"]);
    assert.equal(git(["log", "-1", "--format=%s", `devos/upgrade-${NEXT}`], staged.project).stdout.trim(), `DEV_OS upgrade ${VERSION} to ${NEXT}`);
    const branchLock = JSON.parse(git(["show", `devos/upgrade-${NEXT}:devos/engine.lock.json`], staged.project).stdout);
    assert.equal(branchLock.engine_version, NEXT);
    assert.equal(branchLock.files.length, JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8")).files.length);
    assert.equal(git(["show", `devos/upgrade-${NEXT}:devos/prompts/doctor.md`], staged.project).stdout.includes("Upgrade test line."), true);
    const remote = git(["ls-remote", "origin", `refs/heads/devos/upgrade-${NEXT}`], staged.project);
    assert.equal(remote.status, 0, remote.stderr);
    assert.equal(remote.stdout.includes(`refs/heads/devos/upgrade-${NEXT}`), true, remote.stdout);
    const seen = readFileSync(staged.log, "utf8");
    for (const needle of ["pr create", "--base", "main", `DEV_OS upgrade ${VERSION} to ${NEXT}`]) {
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
    assert.equal(result.stdout.includes(`devos upgrade ${VERSION} to ${NEXT}: 0 updated, 0 added, 0 removed, 1 conflicts`), true, result.stdout);
    const body = readFileSync(path.join(staged.project, ".git", "devos-upgrade-body.md"), "utf8");
    assert.equal(body.includes("- devos/prompts/doctor.md — edited locally and changed upstream"), true, body);
    const doctor = readFileSync(path.join(staged.project, "devos", "prompts", "doctor.md"), "utf8");
    assert.equal(doctor.includes("Project edit line."), true);
    assert.equal(doctor.includes("Upgrade test line."), false);
    assert.deepEqual(names(staged.project, `main..devos/upgrade-${NEXT}`), ["devos/engine.lock.json"]);
    const mainLock = JSON.parse(git(["show", "main:devos/engine.lock.json"], staged.project).stdout);
    const branchLock = JSON.parse(git(["show", `devos/upgrade-${NEXT}:devos/engine.lock.json`], staged.project).stdout);
    const doctorSha = (lock) => lock.files.find((file) => file.path === "devos/prompts/doctor.md").sha256;
    assert.equal(doctorSha(branchLock), doctorSha(mainLock));
    assert.equal(branchLock.engine_version, NEXT);
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
    const result = devos(["upgrade", "--pre"], project); // E85d: this engine may be a release candidate
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
    const result = devos(["upgrade", "--pre"], project); // E85d: this engine may be a release candidate
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(`devos: up to date (${VERSION})`), true, result.stdout);
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
    assert.equal(result.stdout.includes(`devos: branch devos/upgrade-${NEXT} committed locally (--local)`), true, result.stdout);
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
    assert.equal(lock.engine_version, VERSION);
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
    assert.equal(result.stdout.includes(`devos: branch devos/upgrade-${NEXT} is committed; push it and open the pull request by hand, or delete it to retry`), true, result.stdout);
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
    assert.equal(git(["rev-list", "--count", `main..devos/upgrade-${NEXT}`], staged.project).stdout.trim(), "1");
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs --local stages an engine file the project's .gitignore leaves out", () => {
  const staged = stage({
    mutate(dir) {
      writeFileSync(path.join(dir, "payload", "files", "devos", "prompts", "extra.md"), "Extra prompt.\n");
    },
  });
  try {
    const ignore = path.join(staged.project, ".gitignore");
    writeFileSync(ignore, `${readFileSync(ignore, "utf8").replaceAll("\r\n", "\n")}devos/prompts/extra.md\n`);
    commitAll(staged.project, "ignore an engine path");
    const result = spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", "--local"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: staged.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const branch = `devos/upgrade-${JSON.parse(readFileSync(path.join(staged.next, "package.json"), "utf8")).version}`;
    const shown = git(["show", `${branch}:devos/prompts/extra.md`], staged.project);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(shown.stdout, "Extra prompt.\n");
    assert.equal(names(staged.project, `main..${branch}`).includes("devos/prompts/extra.md"), true);
  } finally {
    cleanup(staged.parent);
  }
});

function upgradeLocal(staged, input = "") {
  return spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", "--local"], {
    cwd: staged.project,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: staged.env,
  });
}

function failingHook(project) {
  const hooks = path.join(project, "hooks");
  mkdirSync(hooks);
  const hook = path.join(hooks, "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  assert.equal(git(["add", "--", "hooks/pre-commit"], project).status, 0);
  const hookCommit = git(["commit", "-m", "hook"], project);
  assert.equal(hookCommit.status, 0, hookCommit.stderr);
  assert.equal(git(["config", "core.hooksPath", "hooks"], project).status, 0);
}

function untrack(project, rel) {
  const ignore = path.join(project, ".gitignore");
  writeFileSync(ignore, `${readFileSync(ignore, "utf8").replaceAll("\r\n", "\n")}${rel}\n`);
  assert.equal(git(["rm", "-q", "--cached", "--", rel], project).status, 0);
  commitAll(project, `ignore ${rel}`);
}

test("upgrade.test.mjs rolls back an engine file HEAD does not track (E62)", { skip: windows }, () => {
  const staged = stage({});
  try {
    const rel = "devos/prompts/doctor.md";
    untrack(staged.project, rel);
    const before = readFileSync(path.join(staged.project, ...rel.split("/")));
    failingHook(staged.project);
    const result = upgradeLocal(staged);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: upgrade failed; rolled back, nothing changed"), true, result.stdout);
    assert.equal(readFileSync(path.join(staged.project, ...rel.split("/"))).equals(before), true);
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
    assert.equal(git(["branch", "--show-current"], staged.project).stdout.trim(), "main");
    assert.equal(git(["branch", "--list", "devos/*"], staged.project).stdout.trim(), "");
    const lock = JSON.parse(readFileSync(path.join(staged.project, "devos", "engine.lock.json"), "utf8"));
    assert.equal(lock.engine_version, VERSION);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs removes an engine file HEAD does not track (E62)", () => {
  const rel = "devos/prompts/doctor.md";
  const staged = stage({
    mutate(dir) {
      rmSync(path.join(dir, "payload", "files", ...rel.split("/")));
    },
  });
  try {
    untrack(staged.project, rel);
    const result = upgradeLocal(staged);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(", 1 removed, 0 conflicts"), true, result.stdout);
    assert.equal(existsSync(path.join(staged.project, ...rel.split("/"))), false);
    assert.deepEqual(names(staged.project, `main..devos/upgrade-${NEXT}`), ["devos/engine.lock.json"]);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs names a version that is neither a release nor a release candidate (E62, E85d)", () => {
  const staged = stage({
    mutate(dir) {
      const pkgPath = path.join(dir, "package.json");
      writeFileSync(pkgPath, readFileSync(pkgPath, "utf8").replace(`"version": "${NEXT}"`, `"version": "${NEXT}-beta.1"`));
    },
  });
  try {
    const result = upgradeLocal(staged);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), `devos: this engine's package.json names engine "${NEXT}-beta.1", which is neither a release (X.Y.Z) nor a release candidate (X.Y.Z-rc.N); devos upgrade runs between those`);
    assert.equal(result.stderr, "");
    const lockPath = path.join(staged.project, "devos", "engine.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.engine_version = `${VERSION}-beta.2`;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    commitAll(staged.project, "a beta lock");
    const fromLock = devos(["upgrade", "--local"], staged.project, staged.env);
    assert.equal(fromLock.status, 1, fromLock.stdout + fromLock.stderr);
    assert.equal(fromLock.stdout.trim(), `devos: devos/engine.lock.json in this project names engine "${VERSION}-beta.2", which is neither a release (X.Y.Z) nor a release candidate (X.Y.Z-rc.N); devos upgrade runs between those`);
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
  } finally {
    cleanup(staged.parent);
  }
});

// E85d (D-E19): a release candidate, for a test project. The next candidate after a version: X.Y.Z-rc.(N+1) after
// X.Y.Z-rc.N, X.Y.(Z+1)-rc.1 after X.Y.Z.
function nextCandidate(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`not a release or a release candidate: ${version}`);
  return match[4] ? `${match[1]}.${match[2]}.${match[3]}-rc.${Number(match[4]) + 1}` : `${match[1]}.${match[2]}.${Number(match[3]) + 1}-rc.1`;
}
const CANDIDATE = nextCandidate(VERSION);

// A staged engine that is the candidate after this one, with the doctor.md line of a staged release.
function asCandidate(dir) {
  const pkgPath = path.join(dir, "package.json");
  writeFileSync(pkgPath, readFileSync(pkgPath, "utf8").replace(`"version": "${NEXT}"`, `"version": "${CANDIDATE}"`));
  const doctor = path.join(dir, "payload", "files", "devos", "prompts", "doctor.md");
  let text = readFileSync(doctor, "utf8");
  if (!text.endsWith("\n")) text += "\n";
  writeFileSync(doctor, `${text}Upgrade test line.\n`);
}

function upgradeWith(staged, args) {
  return spawnSync(process.execPath, [path.join(staged.next, "bin", "devos.mjs"), "upgrade", ...args], {
    cwd: staged.project,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    env: staged.env,
  });
}

function setLockVersion(staged, version) {
  const lockPath = path.join(staged.project, "devos", "engine.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.engine_version = version;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  commitAll(staged.project, `the lock of engine ${version}`);
}

test("upgrade.test.mjs (E85d) a release candidate is taken only with --pre, on a branch named for it", () => {
  const staged = stage({ mutate: asCandidate });
  try {
    const plain = upgradeWith(staged, ["--local"]);
    assert.equal(plain.status, 1, plain.stdout + plain.stderr);
    assert.equal(plain.stdout.trim(), `devos: this engine is ${CANDIDATE}, a release candidate; a test project takes it with devos upgrade --pre, and a project for real work stays on releases`);
    assert.equal(git(["branch", "--list", "devos/*"], staged.project).stdout.trim(), "");
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
    const pre = upgradeWith(staged, ["--pre", "--local"]);
    assert.equal(pre.status, 0, pre.stdout + pre.stderr);
    assert.equal(pre.stdout.includes(`devos upgrade ${VERSION} to ${CANDIDATE}: 1 updated, 0 added, 0 removed, 0 conflicts`), true, pre.stdout);
    assert.equal(pre.stdout.includes(`devos: branch devos/upgrade-${CANDIDATE} committed locally (--local)`), true, pre.stdout);
    assert.deepEqual(names(staged.project, `main..devos/upgrade-${CANDIDATE}`), ["devos/engine.lock.json", "devos/prompts/doctor.md"]);
    assert.equal(JSON.parse(git(["show", `devos/upgrade-${CANDIDATE}:devos/engine.lock.json`], staged.project).stdout).engine_version, CANDIDATE);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs (E85d) a project on a release candidate takes the release with a plain devos upgrade, never an older one", () => {
  const staged = stage({});
  try {
    const newer = nextCandidate(NEXT);
    setLockVersion(staged, newer);
    const back = upgradeWith(staged, ["--local"]);
    assert.equal(back.status, 1, back.stdout + back.stderr);
    assert.equal(back.stdout.trim(), `devos: this project has engine ${newer}; this engine is ${NEXT}`);
    assert.equal(git(["branch", "--list", "devos/*"], staged.project).stdout.trim(), "");
    setLockVersion(staged, `${NEXT}-rc.1`);
    const result = upgradeWith(staged, ["--local"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(`devos upgrade ${NEXT}-rc.1 to ${NEXT}: 1 updated, 0 added, 0 removed, 0 conflicts`), true, result.stdout);
    assert.equal(JSON.parse(git(["show", `devos/upgrade-${NEXT}:devos/engine.lock.json`], staged.project).stdout).engine_version, NEXT);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs (E85d) an unknown or repeated option prints the usage", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-upgrade-"));
  try {
    for (const args of [["--pree"], ["--pre", "--pre"], ["--local", "x"]]) {
      const result = devos(["upgrade", ...args], parent);
      assert.deepEqual([result.status, result.stdout], [2, "devos upgrade [--local] [--pre]\n"], args.join(" "));
    }
  } finally {
    cleanup(parent);
  }
});

// E79 (PR-99): a project set up before 1.13.11 has agents without the efforts DEV_OS used to pick. devos upgrade asks
// for each one once, with nothing chosen, and commits the answers in devos/project.json on the upgrade branch.
function olderAgents(staged) {
  const file = path.join(staged.project, "devos", "project.json");
  const project = JSON.parse(readFileSync(file, "utf8"));
  project.agents = {
    reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
    reviewer_light: null,
    pool: [
      { id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" },
      { id: "cursor-fast", tool: "cursor", model: "grok-4.7-high-fast", default: false, note: "strengths: ui" },
    ],
    policy: "reviewer-picks",
  };
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
  assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: staged.project, encoding: "utf8", windowsHide: true }).status, 0);
  commitAll(staged.project, "older agents");
}

test("upgrade.test.mjs (E79) an older project is asked once for the choices DEV_OS no longer makes, and the answers are committed", () => {
  const staged = stage({});
  try {
    olderAgents(staged);
    // An empty answer chooses nothing and asks again; then high, max for gates, medium for light reviews, fence, yes.
    const result = upgradeLocal(staged, "\nhigh\nmax\nmedium\nfence\nyes\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("DEV_OS needs 5 choices it no longer makes for you (PR-99): agents.reviewer.effort, agents.reviewer.gate_effort, agents.reviewer.light_effort, agents.pool[cursor-grok].effort, agents.raise_on_retry.\n"), true, result.stdout);
    assert.equal(result.stdout.includes("[default: none]\n(type a number; nothing is chosen for you)"), true, result.stdout);
    assert.equal(result.stdout.includes("On a retry, raise the reviewer's effort one step (Claude Code and Codex reviewers)? (yes/no): "), true, result.stdout);
    assert.deepEqual(names(staged.project, `main..devos/upgrade-${NEXT}`), ["devos.config.json", "devos/engine.lock.json", "devos/project.json", "devos/prompts/doctor.md"]);
    const agents = JSON.parse(git(["show", `devos/upgrade-${NEXT}:devos/project.json`], staged.project).stdout).agents;
    assert.deepEqual(agents.reviewer, { id: "claude-deep", tool: "claude", model: "claude-opus-5-5", effort: "high", gate_effort: "max", light_effort: "medium" });
    assert.deepEqual(agents.pool.map((item) => item.effort), ["fence", undefined]);
    assert.equal(agents.raise_on_retry, true);
    assert.deepEqual(JSON.parse(git(["show", `devos/upgrade-${NEXT}:devos.config.json`], staged.project).stdout).agents, agents);
    // Merged, the next upgrade asks nothing.
    assert.equal(git(["merge", "-q", "--ff-only", `devos/upgrade-${NEXT}`], staged.project).status, 0);
    const again = upgradeLocal(staged, "");
    assert.equal(again.stdout.includes("no longer makes for you"), false, again.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("upgrade.test.mjs (E79) with no answers nothing changes, and the upgrade says what to set; a project with no agents is told so", () => {
  const staged = stage({});
  try {
    olderAgents(staged);
    const head = git(["rev-parse", "HEAD"], staged.project).stdout;
    const ended = upgradeLocal(staged, "high\n");
    assert.equal(ended.status, 1, ended.stdout + ended.stderr);
    assert.equal(ended.stdout.trim().split("\n").at(-1), "devos: nothing changed. devos upgrade asks for agents.reviewer.effort, agents.reviewer.gate_effort, agents.reviewer.light_effort, agents.pool[cursor-grok].effort, agents.raise_on_retry in a terminal in this folder; or set them in devos/project.json, commit, and run devos upgrade again (PR-99)");
    assert.equal(git(["rev-parse", "HEAD"], staged.project).stdout, head);
    assert.equal(git(["branch", "--list", `devos/upgrade-${NEXT}`], staged.project).stdout.trim(), "");
    assert.equal(git(["status", "--porcelain"], staged.project).stdout, "");
  } finally {
    cleanup(staged.parent);
  }
  const bare = stage({});
  try {
    const result = upgradeLocal(bare, "");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: note: devos/project.json has no agents; the cycle stops until its reviewer, builders and efforts are set there (PR-99)\n"), true, result.stdout);
  } finally {
    cleanup(bare.parent);
  }
});
