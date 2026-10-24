import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, flow, init, runs, stage, toolRuns } from "./harness.mjs";
import { BLUEPRINT_POINTER } from "../lib/init.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";

function checklist(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line.startsWith("✓ ") || line.startsWith("· "));
}

function resume(staged, args, input, extraEnv = {}) {
  return spawnSync(process.execPath, [bin, ...args, staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: { ...staged.env, ...extraEnv },
  });
}

function workflowRuns(parent) {
  const log = path.join(parent, "gh.log");
  if (!existsSync(log)) return 0;
  return readFileSync(log, "utf8").split(/\r?\n/).filter((line) => line.startsWith("workflow run")).length;
}

function logGit(stubs) {
  const script = `import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const log = process.env.DEVOS_GIT_LOG;
if (log) appendFileSync(log, args.join(" ") + "\\n");
const env = { ...process.env, PATH: process.env.DEVOS_REAL_PATH ?? "" };
const result = spawnSync("git", args, { cwd: process.cwd(), env, encoding: "utf8", windowsHide: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`;
  writeFileSync(path.join(stubs, "git-stub.mjs"), script);
  if (windows) {
    writeFileSync(path.join(stubs, "git.cmd"), "@node \"%~dp0git-stub.mjs\" %*\r\n");
    return;
  }
  const launcher = path.join(stubs, "git");
  writeFileSync(launcher, `#!/usr/bin/env node\n${script}`);
  chmodSync(launcher, 0o755);
}

function gitLines(parent) {
  const log = path.join(parent, "git.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean);
}

function ghLines(parent) {
  const log = path.join(parent, "gh.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean);
}

test("continue.test.mjs (h) a fresh install with answers resumes the blueprint", () => {
  const staged = stage({ mode: "fail" });
  try {
    const failed = init(staged, flow());
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    staged.env.STUB_MODE = "good";
    const result = resume(staged, ["continue"], "approve\n\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = checklist(result.stdout);
    assert.equal(lines[0], "✓ answers (devos)");
    assert.equal(lines[1], "✓ engine files (devos)");
    assert.equal(lines[2], "· blueprint approved (you)");
    assert.equal(runs(staged.parent).length >= 2, true);
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (i) a finished project dispatches nothing", () => {
  const staged = stage();
  try {
    const built = init(staged, flow());
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const before = workflowRuns(staged.parent);
    const result = resume(staged, ["continue"], "", { STUB_REPO: "full" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lines = checklist(result.stdout);
    assert.equal(lines.length, 7, lines.join("\n"));
    assert.equal(lines.every((line) => line.startsWith("✓ ")), true, lines.join("\n"));
    assert.equal(result.stdout.includes("devos: everything is done — the cycle runs on GitHub; merge its pull requests at the gates"), true, result.stdout);
    assert.equal(workflowRuns(staged.parent), before);
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (j) an existing repository asks only for the missing key", () => {
  const staged = stage();
  try {
    const built = init(staged, flow());
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const result = resume(staged, ["continue"], "", {
      STUB_REPO: "full",
      STUB_SECRETS: '[{"name":"CURSOR_API_KEY"}]',
    });
    assert.equal(result.stdout.includes("gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo devtest/demo-shop"), true, result.stdout);
    assert.equal(result.stdout.includes("gh secret set CURSOR_API_KEY --repo devtest/demo-shop"), false, result.stdout);
    assert.equal(result.stdout.includes("to set later: CLAUDE_CODE_OAUTH_TOKEN"), true, result.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (k) an empty existing repository is adopted and pushed", () => {
  const staged = stage();
  try {
    const result = init(staged, flow(), { STUB_REPO: "empty" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: adopted the existing empty repository devtest/demo-shop"), true, result.stdout);
    const count = spawnSync("git", ["rev-list", "--count", "main"], {
      cwd: path.join(staged.parent, "remote.git"),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(count.stdout.trim(), "1", count.stderr);
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (l) a repository that already has commits is not pushed", () => {
  const staged = stage();
  try {
    logGit(staged.stubs);
    const result = init(staged, flow(), { STUB_REPO: "full" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(
      result.stdout.includes('devos: devtest/demo-shop already exists and has commits; delete it or change "name" in devos/answers.json, then run devos continue'),
      true,
      result.stdout,
    );
    assert.equal(gitLines(staged.parent).some((line) => line.startsWith("push")), false, gitLines(staged.parent).join("\n"));
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (m) init --continue prints the same checklist as continue", () => {
  const left = stage({ mode: "fail" });
  const right = stage({ mode: "fail" });
  try {
    assert.equal(init(left, flow()).status, 1);
    assert.equal(init(right, flow()).status, 1);
    left.env.STUB_MODE = "good";
    right.env.STUB_MODE = "good";
    const viaContinue = resume(left, ["continue"], "approve\n\n");
    const viaInit = resume(right, ["init", "--continue"], "approve\n\n");
    assert.equal(viaContinue.status, 0, viaContinue.stdout + viaContinue.stderr);
    assert.equal(viaInit.status, 0, viaInit.stdout + viaInit.stderr);
    assert.deepEqual(checklist(viaInit.stdout), checklist(viaContinue.stdout));
  } finally {
    cleanup(left.parent);
    cleanup(right.parent);
  }
});

test("continue.test.mjs (n) a stale answers key still names devtest/demo-shop", () => {
  const staged = stage();
  try {
    const built = init(staged, flow());
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const answersFile = path.join(staged.project, "devos", "answers.json");
    const answers = JSON.parse(readFileSync(answersFile, "utf8"));
    answers.key = "OLDKEY";
    writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
    resume(staged, ["continue"], "");
    const asked = ghLines(staged.parent).filter((line) => (
      line.startsWith("repo view ") || line.startsWith("secret list ") || line.startsWith("run list ")
    ));
    assert.equal(asked.length > 0, true, ghLines(staged.parent).join("\n"));
    assert.equal(asked.every((line) => line.includes("devtest/demo-shop")), true, asked.join("\n"));
    assert.equal(asked.some((line) => line.toLowerCase().includes("oldkey")), false, asked.join("\n"));
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (o) a model saved as a listing row is cleaned before the blueprint resumes", () => {
  const staged = stage({ mode: "fail" });
  try {
    const failed = init(staged, flow());
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    const answersFile = path.join(staged.project, "devos", "answers.json");
    const answers = JSON.parse(readFileSync(answersFile, "utf8"));
    const clean = answers.blueprint_agent.model;
    answers.blueprint_agent.model = `${clean} - Display Name​`;
    writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
    const projectFile = path.join(staged.project, "devos", "project.json");
    const project = JSON.parse(readFileSync(projectFile, "utf8"));
    const builder = project.agents.pool[0].model;
    project.agents.pool[0].model = `${builder} - Display Name`;
    writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`);
    staged.env.STUB_MODE = "good";
    const result = resume(staged, ["continue"], "approve\n\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: kept only the model id in devos/answers.json"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: kept only the model id in devos/project.json"), true, result.stdout);
    assert.equal(JSON.parse(readFileSync(answersFile, "utf8")).blueprint_agent.model, clean);
    assert.equal(JSON.parse(readFileSync(projectFile, "utf8")).agents.pool[0].model, builder);
    const config = JSON.parse(readFileSync(path.join(staged.project, "devos.config.json"), "utf8"));
    assert.equal(config.agents.pool[0].model, builder);
    const called = runs(staged.parent).at(-1);
    assert.equal(called.args[called.args.indexOf("--model") + 1], clean);
  } finally {
    cleanup(staged.parent);
  }
});

// The flow up to the blueprint's review, then the input ends: the documents are written, not approved.
const unapproved = (options) => flow(options).replace(/approve\n\n$/, "");

test("continue.test.mjs (p) a written blueprint that passes its checks goes straight to review", () => {
  const staged = stage();
  try {
    const first = init(staged, unapproved());
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.equal(first.stdout.includes("devos: input ended before setup finished"), true, first.stdout);
    assert.equal(runs(staged.parent).length, 1);
    const result = resume(staged, ["continue"], "approve\n\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: the blueprint is written and passes its checks; review it"), true, result.stdout);
    assert.equal(result.stdout.includes("devos init: blueprint approved in"), true, result.stdout);
    assert.equal(runs(staged.parent).length, 1);
  } finally {
    cleanup(staged.parent);
  }
});

test("continue.test.mjs (q) a written blueprint that fails is repaired in the agent's saved session", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const first = init(staged, unapproved({ blueprint: "Cursor CLI · grok-4.7" }));
    assert.equal(first.status, 1, first.stdout + first.stderr);
    writeFileSync(path.join(staged.project, "docs", "PHASES.md"), "No header here\n");
    const result = resume(staged, ["continue"], "approve\n\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: the written blueprint fails these checks:"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: agent fixes only what failed, in its earlier session"), true, result.stdout);
    const called = toolRuns(staged.parent);
    assert.equal(called.length, 2);
    assert.deepEqual(called[1].args.slice(-3), ["--resume", "cursor-session-1", BLUEPRINT_POINTER]);
    assert.equal(called[1].input.startsWith("Your documents and fence T01 are written, and these checks failed:"), true, called[1].input);
  } finally {
    cleanup(staged.parent);
  }
});
