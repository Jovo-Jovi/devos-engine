import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { run, which } from "../lib/which.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";

function devos(args, env, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    cwd,
  });
}

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("command.test.mjs profile stores choices and refuses a value-like string", () => {
  const refused = tempDir("devos-profile-");
  try {
    const bad = devos(["profile", "set", "github_owner", "ghp_example"], { DEVOS_HOME: refused });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /devos: profile refused a value-like string/);
    assert.equal(existsSync(path.join(refused, ".devos", "profile.json")), false);
  } finally {
    rmSync(refused, { recursive: true, force: true });
  }

  const home = tempDir("devos-profile-");
  try {
    const owner = devos(["profile", "set", "github_owner", "Ada-Dev"], { DEVOS_HOME: home });
    assert.equal(owner.status, 0, owner.stderr);
    const accounts = devos(["profile", "set", "cursor_accounts", "2"], { DEVOS_HOME: home });
    assert.equal(accounts.status, 0, accounts.stderr);
    const shown = devos(["profile", "show"], { DEVOS_HOME: home });
    assert.equal(shown.status, 0);
    assert.deepEqual(JSON.parse(shown.stdout), { github_owner: "Ada-Dev", cursor_accounts: 2 });

    const file = path.join(home, ".devos", "profile.json");
    const before = readFileSync(file, "utf8");
    const visibility = devos(["profile", "set", "visibility", "secret"], { DEVOS_HOME: home });
    assert.equal(visibility.status, 1);
    assert.match(visibility.stdout, /devos: profile visibility must be private or public/);
    assert.equal(readFileSync(file, "utf8"), before);

    const stack = devos(["profile", "set", "default_stack", "task-runner-app"], { DEVOS_HOME: home });
    assert.equal(stack.status, 0, stack.stderr);
    const after = JSON.parse(devos(["profile", "show"], { DEVOS_HOME: home }).stdout);
    assert.equal(after.default_stack, "task-runner-app");
    assert.equal(after.cursor_accounts, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("command.test.mjs roster import, same-model doctor, detect and status", () => {
  const home = tempDir("devos-roster-");
  const stubs = tempDir("devos-stubs-");
  const outside = tempDir("devos-outside-");
  try {
    const roster = {
      reviewer: { id: "cursor", tool: "cursor", model: "claude-opus-5-5" },
      reviewer_light: null,
      pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "" }],
      policy: "reviewer-picks",
    };
    const file = path.join(home, "in.json");
    writeFileSync(file, JSON.stringify(roster));
    const imported = devos(["agents", "import", file], { DEVOS_HOME: home });
    assert.equal(imported.status, 0, imported.stderr);
    const shown = devos(["agents", "show"], { DEVOS_HOME: home });
    assert.equal(shown.status, 0, shown.stderr);
    assert.deepEqual(JSON.parse(shown.stdout), roster);

    roster.pool[0].model = "claude-opus-5-5";
    writeFileSync(file, JSON.stringify(roster));
    const again = devos(["agents", "import", file], { DEVOS_HOME: home });
    assert.equal(again.status, 0, again.stderr);
    const doctor = devos(["doctor"], { DEVOS_HOME: home, PATH: "" });
    assert.equal(doctor.status, 1);
    const warning = "devos: warning: cursor-grok uses claude-opus-5-5, the same model as the reviewer";
    const gh = "devos: gh is not installed. Install the GitHub CLI, then run: gh auth login";
    assert.equal(doctor.stdout.includes(warning), true, doctor.stdout);
    assert.equal(doctor.stdout.includes(gh), true, doctor.stdout);
    assert.equal(doctor.stdout.indexOf(warning) < doctor.stdout.indexOf(gh), true);

    if (windows) {
      writeFileSync(path.join(stubs, "claude.cmd"), "@exit /b 0\r\n");
      writeFileSync(path.join(stubs, "agent.cmd"), "@exit /b 0\r\n");
    } else {
      for (const name of ["claude", "agent"]) {
        const stub = path.join(stubs, name);
        writeFileSync(stub, "#!/bin/sh\nexit 0\n");
        chmodSync(stub, 0o755);
      }
    }
    const detect = devos(["agents", "detect"], { DEVOS_HOME: home, PATH: stubs });
    assert.equal(detect.status, 0, detect.stderr);
    assert.equal(detect.stdout, "claude installed signed-in\ncursor installed signed-in\n");

    const status = devos(["status"], { DEVOS_HOME: home }, outside);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stdout, "devos: no project here\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(stubs, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("command.test.mjs which marks a cmd stub and misses a command", () => {
  const dir = tempDir("devos-which-");
  const previous = process.env.PATH;
  try {
    if (windows) writeFileSync(path.join(dir, "sample.cmd"), "@exit /b 0\r\n");
    else {
      const stub = path.join(dir, "sample");
      writeFileSync(stub, "#!/bin/sh\nexit 0\n");
      chmodSync(stub, 0o755);
    }
    process.env.PATH = dir;
    const found = which("sample");
    assert.ok(found);
    assert.equal(found.viaShell, windows);
    assert.equal(which("missing-command-xyz"), null);
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("command.test.mjs run quotes a shell path that contains a space", () => {
  const parent = tempDir("devos-quote-");
  const previous = process.env.PATH;
  try {
    const dir = windows ? path.join(parent, "with space") : parent;
    if (windows) mkdirSync(dir);
    if (windows) writeFileSync(path.join(dir, "sample.cmd"), "@echo quoted-ok\r\n");
    else {
      const stub = path.join(dir, "sample");
      writeFileSync(stub, "#!/bin/sh\necho quoted-ok\n");
      chmodSync(stub, 0o755);
    }
    process.env.PATH = dir;
    const result = run("sample", []);
    assert.ok(result);
    assert.equal(result.status, 0);
    if (windows) {
      assert.equal(result.stdout.includes("quoted-ok"), true, result.stdout);
      console.log('run("sample", []) exited 0; stdout contained quoted-ok');
    }
  } finally {
    process.env.PATH = previous;
    rmSync(parent, { recursive: true, force: true });
  }
});

test("command.test.mjs run keeps one cmd argument that contains a space", () => {
  const dir = tempDir("devos-arg-");
  const previous = process.env.PATH;
  try {
    if (windows) writeFileSync(path.join(dir, "sample.cmd"), "@echo off\r\necho %~1\r\n");
    else {
      const stub = path.join(dir, "sample");
      writeFileSync(stub, "#!/bin/sh\nexit 0\n");
      chmodSync(stub, 0o755);
    }
    process.env.PATH = dir;
    const result = run("sample", ["a b"]);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr);
    if (windows) assert.equal(result.stdout.includes("a b"), true, result.stdout);
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
