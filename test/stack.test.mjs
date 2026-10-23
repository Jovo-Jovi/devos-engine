import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "../lib/catalogue.mjs";
import { merge } from "../payload/files/scripts/devos/config.mjs";
import { cleanup, flow, init, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS = ["install", "typecheck", "lint", "test", "build"];
const TOOLCHAINS = new Set(["node", "python", "go", "dart"]);

function menuOptions(stdout, title) {
  const start = stdout.indexOf(`${title}\n`);
  assert.equal(start >= 0, true, title);
  const end = stdout.indexOf("\n[default:", start);
  return stdout.slice(start, end).split("\n").filter((line) => /^\s+\d+\) /.test(line));
}

test("stack.test.mjs (a) every stack names a toolchain, a manifest and five commands", () => {
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  for (const stack of loadCatalogue().stacks) {
    assert.equal(TOOLCHAINS.has(stack.toolchain), true, stack.id);
    assert.equal(typeof stack.manifest === "string" && stack.manifest.length > 0, true, stack.id);
    assert.deepEqual(Object.keys(stack.commands), COMMANDS, stack.id);
    if (stack.toolchain === "node") assert.deepEqual(stack.commands, defaults.stack.commands, stack.id);
  }
});

test("stack.test.mjs (b) a FastAPI init keeps the method modules off", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ type: "api", stack: "fastapi", modules: ["", "", "", "", ""] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const note = "Supabase, R2, Firebase and Vercel deploys work with JavaScript and TypeScript stacks for now.";
    const noteAt = result.stdout.indexOf(note);
    const databaseAt = result.stdout.indexOf("Database — ");
    assert.equal(noteAt >= 0 && databaseAt > noteAt, true, result.stdout);
    assert.deepEqual(menuOptions(result.stdout, "Database — Adds the database module. Every migration waits for your merge."), ["  1) None"]);
    assert.deepEqual(menuOptions(result.stdout, "Hosting — Sets where the product is deployed. None means no deploy step. More hosts join in a later version."), ["  1) None"]);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    const config = JSON.parse(readFileSync(path.join(staged.project, "devos.config.json"), "utf8"));
    for (const file of [project, config]) {
      assert.equal(file.stack.toolchain, "python");
      assert.equal(file.stack.manifest, "pyproject.toml");
      assert.equal(file.stack.commands.test, "uv run pytest");
    }
  } finally {
    cleanup(staged.parent);
  }
});

const OK = "node -e \"process.exit(0)\"";

function defaults() {
  return JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
}

function stageFiles() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-stack-"));
  const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(staged.status, 0, staged.stderr);
  assert.equal(spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", windowsHide: true }).status, 0);
  return dir;
}

function writeStack(dir, stack) {
  const template = JSON.parse(readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8").replaceAll("__PROJECT_KEY__", "DEMO"));
  if (stack) template.stack = stack;
  writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(template, null, 2)}\n`);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(written.status, 0, written.stderr || written.stdout);
}

function pythonStack(install = OK) {
  return {
    toolchain: "python",
    manifest: "pyproject.toml",
    commands: {
      install,
      typecheck: OK,
      lint: "node -e \"process.exit(3)\"",
      test: OK,
      build: OK,
    },
  };
}

function runChecks(dir, args = []) {
  return spawnSync(process.execPath, ["scripts/devos/run-checks.mjs", ...args], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
}

function resultNamed(results, name) {
  return results.find((item) => item.name === name);
}

test("stack.test.mjs (c) merge keeps the chosen stack and the node default", () => {
  const engine = defaults();
  const entry = loadCatalogue().stacks.find((stack) => stack.id === "fastapi");
  const chosen = merge(engine, { stack: entry }).stack;
  delete chosen.$comment;
  assert.deepEqual(chosen, entry);
  assert.deepEqual(merge(engine, {}).stack, engine.stack);
});

test("stack.test.mjs (d) a python manifest runs stack.commands", () => {
  const dir = stageFiles();
  try {
    writeStack(dir, pythonStack());
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const result = runChecks(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(path.join(dir, ".devos", "ci-results.json"), "utf8"));
    const install = resultNamed(report.results, "install");
    assert.equal(install.status, "pass");
    assert.equal(install.required, false);
    assert.equal(resultNamed(report.results, "typecheck").status, "pass");
    const lint = resultNamed(report.results, "lint");
    assert.equal(lint.status, "fail");
    assert.equal(lint.exit, 3);
    assert.equal(resultNamed(report.results, "test").status, "pass");
    assert.equal(resultNamed(report.results, "build").status, "pass");
    assert.equal(readFileSync(path.join(dir, ".devos", "logs", "lint.log"), "utf8").startsWith("$ node -e"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("stack.test.mjs (e) a missing manifest skips the checks and still runs guards", () => {
  const dir = stageFiles();
  try {
    writeStack(dir, pythonStack());
    const result = runChecks(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(path.join(dir, ".devos", "ci-results.json"), "utf8"));
    for (const name of ["typecheck", "lint", "test", "build"]) {
      assert.equal(resultNamed(report.results, name).status, "skipped-no-package", name);
    }
    const guards = resultNamed(report.results, "guards");
    assert.equal(guards.status === "skipped-no-package", false);
    assert.equal(typeof guards.exit, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("stack.test.mjs (f) install-only stays quiet for node and reports a python failure", () => {
  const nodeDir = stageFiles();
  const pythonDir = stageFiles();
  try {
    writeStack(nodeDir);
    const nodeRun = runChecks(nodeDir, ["--install-only"]);
    assert.equal(nodeRun.status, 0, nodeRun.stdout + nodeRun.stderr);
    assert.equal(existsSync(path.join(nodeDir, ".devos", "logs", "install.log")), false);
    writeStack(pythonDir, pythonStack("node -e \"process.exit(2)\""));
    writeFileSync(path.join(pythonDir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const pythonRun = runChecks(pythonDir, ["--install-only"]);
    assert.equal(pythonRun.status, 1, pythonRun.stdout + pythonRun.stderr);
  } finally {
    rmSync(nodeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(pythonDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function countOf(text, needle) {
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

test("stack.test.mjs (g) the workflows set up the toolchain and install it", () => {
  const uses = ["astral-sh/setup-uv@v6", "actions/setup-go@v5", "subosito/flutter-action@v2"];
  const conditions = [
    "steps.tc.outputs.toolchain == 'python'",
    "steps.tc.outputs.toolchain == 'go'",
    "steps.tc.outputs.toolchain == 'dart'",
  ];
  for (const rel of ["payload/files/dot-github/workflows/devos-cycle.yml", "payload/files/dot-github/workflows/ci.yml"]) {
    const text = readFileSync(path.join(root, rel), "utf8");
    for (const line of [...uses, ...conditions]) assert.equal(countOf(text, line), 1, `${rel} ${line}`);
  }
  const cycle = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8");
  assert.equal(countOf(cycle, "run-checks.mjs --install-only"), 1);
  assert.equal(countOf(cycle, "agent -p --force --trust --approve-mcps --model \"$MODEL\" --output-format stream-json \"$(cat .devos/builder-prompt.md)\""), 2);
  assert.equal(countOf(cycle, "agent -p --force --trust --approve-mcps --model \"$MODEL\" --output-format stream-json \"$(cat .devos/reviewer-prompt.md)\""), 1);
  assert.equal(countOf(cycle, "claude -p \"$(cat .devos/builder-prompt.md)\" --model \"$MODEL\" --effort \"$EFFORT\" --output-format json --permission-mode dontAsk"), 2);
  assert.equal(countOf(cycle, "claude -p \"$(cat .devos/reviewer-prompt.md)\""), 1);
});

test("stack.test.mjs (h) a python build's output is restored", () => {
  const dir = stageFiles();
  try {
    const stack = pythonStack();
    stack.commands.build = "node -e \"require('fs').mkdirSync('.venv',{recursive:true});require('fs').writeFileSync('.venv/x','1');require('fs').writeFileSync('app-bin','1')\"";
    writeStack(dir, stack);
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(git(["add", "-A"]).status, 0);
    const committed = git(["-c", "user.email=devos@example.com", "-c", "user.name=devos", "commit", "-m", "init"]);
    assert.equal(committed.status, 0, committed.stderr);
    const result = runChecks(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(dir, "app-bin")), false);
    assert.equal(existsSync(path.join(dir, ".venv", "x")), true);
    const status = git(["status", "--porcelain"]);
    assert.equal(status.stdout, "");
    const report = JSON.parse(readFileSync(path.join(dir, ".devos", "ci-results.json"), "utf8"));
    assert.deepEqual(report.checks_modified_tracked_files, ["app-bin"]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
