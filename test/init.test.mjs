import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { KEY_RE, keyFromName } from "../lib/install.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const fixtures = path.join(root, "test", "fixtures", "docs");

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const claudeStub = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const log = process.env.DEVOS_CLAUDE_LOG;
  appendFileSync(log, JSON.stringify({
    args,
    stdin,
    settings: existsSync(path.join(process.cwd(), ".claude", "settings.json")),
  }) + "\\n");
  const mode = process.env.STUB_MODE || "good";
  if (mode === "fail") process.exit(1);
  const docs = path.join(process.cwd(), "docs");
  mkdirSync(path.join(docs, "fences"), { recursive: true });
  if (mode === "bad-then-good" && !args.includes("--continue")) {
    writeFileSync(path.join(docs, "PHASES.md"), "No header here\\n");
    process.stdout.write('{"result":"stub summary"}');
    return;
  }
  const fixtureDir = process.env.DEVOS_FIXTURES;
  writeFileSync(path.join(docs, "PHASES.md"), readFileSync(path.join(fixtureDir, "PHASES.md")));
  writeFileSync(path.join(docs, "GLOSSARY.md"), readFileSync(path.join(fixtureDir, "GLOSSARY.md")));
  writeFileSync(path.join(docs, "fences", "T01.md"), "# T01\\n");
  process.stdout.write('{"result":"stub summary"}');
});
`;

function writeStubs(dir) {
  mkdirSync(dir);
  writeFileSync(path.join(dir, "claude-stub.mjs"), claudeStub);
  if (windows) {
    writeFileSync(path.join(dir, "claude.cmd"), "@node \"%~dp0claude-stub.mjs\" %*\r\n");
    writeFileSync(path.join(dir, "gh.cmd"), "@exit /b 0\r\n");
    return;
  }
  const claude = path.join(dir, "claude");
  writeFileSync(claude, `#!/usr/bin/env node\n${claudeStub}`);
  chmodSync(claude, 0o755);
  const gh = path.join(dir, "gh");
  writeFileSync(gh, "#!/bin/sh\nexit 0\n");
  chmodSync(gh, 0o755);
}

function stage(options = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-init-"));
  const project = path.join(parent, "project");
  const stubs = path.join(parent, "bin");
  const home = path.join(parent, "home");
  writeStubs(stubs);
  mkdirSync(path.join(home, ".devos"), { recursive: true });
  if (options.visibility) {
    writeFileSync(path.join(home, ".devos", "profile.json"), `${JSON.stringify({ visibility: options.visibility }, null, 2)}\n`);
  }
  if (options.seed) {
    mkdirSync(project);
    writeFileSync(path.join(project, "keep.txt"), "keep\n");
  }
  const env = {
    ...process.env,
    PATH: `${stubs}${path.delimiter}${process.env.PATH ?? ""}`,
    DEVOS_HOME: home,
    DEVOS_CLAUDE_LOG: path.join(parent, "claude.log"),
    DEVOS_FIXTURES: fixtures,
    STUB_MODE: options.mode ?? "good",
  };
  return { parent, project, env };
}

function init(staged, input) {
  return spawnSync(process.execPath, [bin, "init", staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: staged.env,
  });
}

function runs(parent) {
  const log = path.join(parent, "claude.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const accepted = [
  "accept",
  "Demo Shop",
  "A small shop.",
  "Customers",
  "",
  "",
  "",
  "",
  "",
].join("\n");

test("init.test.mjs declines the contract before creating anything", () => {
  const staged = stage();
  try {
    const result = init(staged, "no\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("contract declined"), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
    assert.equal(runs(staged.parent).length, 0);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs stops when input ends during the questions", () => {
  const staged = stage();
  try {
    const result = init(staged, "accept\nDemo\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("input ended"), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs approves a blueprint with the defaults", () => {
  const staged = stage();
  try {
    const result = init(staged, `${accepted}\napprove\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("blueprint approved"), true, result.stdout);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    assert.equal(project.project, "DEMO-SHOP");
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.stores_data, false);
    assert.equal(answers.sign_in, "none");
    assert.deepEqual(answers.languages, ["en"]);
    assert.equal(answers.deploy, "vercel");
    assert.equal(answers.visibility, "private");
    assert.equal(answers.contract_version, "0-draft");
    const called = runs(staged.parent);
    assert.equal(called.length, 1);
    assert.equal(called[0].stdin.startsWith("# Blueprint"), true);
    assert.equal(called[0].args.includes("-p"), true);
    assert.equal(called[0].args.includes("acceptEdits"), true);
    assert.equal(called[0].args.includes("--continue"), false);
    assert.equal(called[0].settings, false);
    const settings = readFileSync(path.join(staged.project, ".claude", "settings.json"));
    const payload = readFileSync(path.join(root, "payload", "files", "dot-claude", "settings.json"));
    assert.deepEqual(settings, payload);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(guards.status, 0, guards.stdout + guards.stderr);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs sends a change request as the next round", () => {
  const staged = stage();
  try {
    const result = init(staged, `${accepted}\nrename T01\napprove\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].args.includes("--continue"), true);
    assert.equal(called[1].stdin.includes("rename T01"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs repairs a failed phases check before approval", () => {
  const staged = stage({ mode: "bad-then-good" });
  try {
    const result = init(staged, `${accepted}\napprove\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].stdin.includes("guard:phases"), true, called[1].stdin);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs stops when the blueprint fails", () => {
  const staged = stage({ mode: "fail" });
  try {
    const result = init(staged, `${accepted}\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("the blueprint failed"), true, result.stdout);
    assert.equal(existsSync(path.join(staged.project, ".claude", "settings.json")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs refuses a folder that is not empty", () => {
  const staged = stage({ seed: true });
  try {
    const result = init(staged, "accept\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(runs(staged.parent).length, 0);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs takes visibility from the profile", () => {
  const staged = stage({ visibility: "public" });
  try {
    const result = init(staged, `${accepted}\napprove\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.visibility, "public");
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs keyFromName matches the key rule", () => {
  assert.equal(keyFromName("Demo Shop"), "DEMO-SHOP");
  assert.equal(keyFromName("42 things!"), "P-42-THINGS");
  for (const name of ["Demo Shop", "42 things!"]) assert.equal(KEY_RE.test(keyFromName(name)), true);
});

test("init.test.mjs contract version is 0-draft", () => {
  const first = readFileSync(path.join(root, "payload", "contract", "CONTRACT.md"), "utf8").split("\n")[0];
  assert.equal(first.endsWith("version 0-draft"), true, first);
  assert.equal(CONTRACT_VERSION, "0-draft");
});
