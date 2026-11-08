import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { handedOver, handOver } from "../lib/handover.mjs";
import { cleanup, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === ".git" ? [] : walk(abs, base);
    return [path.relative(base, abs).split(path.sep).join("/")];
  }).sort();
}

function write(dir, rel, text) {
  const abs = path.join(dir, ...rel.split("/"));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const PLAN = ["README.md", "SETUP.md", "docs/GLOSSARY.md", "docs/PHASES.md", "docs/fences/T01.md", "devos/answers.json"];

test("handover.test.mjs (a) the handover removes DEV_OS's automation, keeps the plan, docs/method/ and the settings written at setup, and records it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-handover-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    for (const rel of PLAN) write(dir, rel, rel === "devos/answers.json" ? `${JSON.stringify({ name: "Demo", cycle: "local" }, null, 2)}\n` : `${rel}\n`);
    write(dir, "CLAUDE.md", "# Reviewer rules\n");
    write(dir, ".devos/blueprint-input.md", "input\n");
    const method = readdirSync(path.join(dir, "docs", "method")).map((name) => `docs/method/${name}`);
    assert.equal(method.length, 6);
    assert.equal(handedOver(JSON.parse(readFileSync(path.join(dir, "devos", "answers.json"), "utf8"))), false);
    const removed = handOver(dir, "1.9.0", "2026-11-05");
    for (const rel of ["devos/engine.lock.json", "devos.config.json", "CLAUDE.md", ".devos/", "scripts/devos/run-checks.mjs", "scripts/guards/run-all.mjs", ".github/workflows/devos-cycle.yml", ".claude/settings.json", ".cursor/mcp.example.json"]) {
      assert.equal(removed.includes(rel), true, rel);
    }
    assert.deepEqual(walk(dir), [
      ".cursor/rules/10-security-data.mdc",
      ".cursor/rules/30-vocabulary.mdc",
      ".gitattributes",
      ".gitignore",
      "README.md",
      "SETUP.md",
      "devos/answers.json",
      "devos/prices.json",
      "devos/project.json",
      "docs/GLOSSARY.md",
      "docs/PHASES.md",
      "docs/fences/T01.md",
      ...method,
    ].sort());
    for (const folder of ["scripts", ".github", ".claude", "devos/prompts", ".devos"]) assert.equal(existsSync(path.join(dir, ...folder.split("/"))), false, folder);
    const answers = JSON.parse(readFileSync(path.join(dir, "devos", "answers.json"), "utf8"));
    assert.deepEqual(answers, { name: "Demo", cycle: "local", handover: { engine: "1.9.0", on: "2026-11-05" } });
    assert.equal(handedOver(answers), true);
    assert.deepEqual(handOver(dir, "2.0.0", "2027-01-01"), []);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "devos", "answers.json"), "utf8")).handover, { engine: "1.9.0", on: "2026-11-05" });
  } finally {
    cleanup(dir);
  }
});

// The answers of a default devos init --local (local-mode.test.mjs keeps the same list).
const LOCAL_FLOW = ["accept", "", "", "", "", "", "", "", "", "", "database none", "", "auth none", "", "email none", "", "", "", "", "Demo Shop", "A small shop.", "Customers", "", "", "", "", "approve", ""].join("\n") + "\n";

test("handover.test.mjs (b) devos init --local commits a handed-over project: the plan, and no DEV_OS script, guard, workflow, agent setting or lock", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const result = spawnSync(process.execPath, [bin, "init", "--local", staged.project], { encoding: "utf8", windowsHide: true, timeout: 180000, input: LOCAL_FLOW, env: staged.env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /devos init: handed over: \d+ DEV_OS files and folders removed; the plan, README\.md and SETUP\.md stay/);
    const tree = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: staged.project, encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean);
    for (const rel of ["README.md", "SETUP.md", "devos/answers.json", "docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md", "docs/method/PRECEDENTS.md", "docs/method/DEV_OS_V2_REVIEWER.md", ".gitignore", ".gitattributes"]) {
      assert.equal(tree.includes(rel), true, rel);
    }
    for (const prefix of ["scripts/", ".github/", ".claude/", "devos/prompts/", "devos/skills/", "devos/ci/", ".devos/"]) {
      assert.equal(tree.some((rel) => rel.startsWith(prefix)), false, prefix);
    }
    for (const rel of ["devos/engine.lock.json", "devos.config.json", "CLAUDE.md"]) assert.equal(tree.includes(rel), false, rel);
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: staged.project, encoding: "utf8", windowsHide: true }).stdout, "");
    const verify = spawnSync(process.execPath, [bin, "verify", staged.project], { encoding: "utf8", windowsHide: true, timeout: 180000, env: staged.env });
    assert.equal(verify.stdout.includes("the plan is yours; DEV_OS's automation is gone"), true, verify.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("handover.test.mjs (c) the method, the blueprint, the help, the page and the changelog say so (PR-83)", () => {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const precedents = read("payload/files/docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("| PR-83 | **Local development is a handover.**"), true);
  const blueprint = read("payload/files/devos/prompts/blueprint.md");
  assert.equal(blueprint.includes("So no fence\n   there names `scripts/devos/`, a guard or a `devos` command: T01's Done-when is each of `devos.config.json`\n   `stack.commands` exiting 0"), true);
  assert.equal(blueprint.includes("`CLAUDE.md` from the handbook's §15.1 template (not in a local project: it is handed over, PR-83)."), true);
  const help = spawnSync(process.execPath, [bin, "init", "--help"], { encoding: "utf8", windowsHide: true });
  assert.equal(help.stdout.includes("devos adopt brings DEV_OS back later."), true, help.stdout);
  const app = read("lib/ui/app.js");
  for (const needle of ["[\"handover\", \"Hand the project over\"]", "It holds the project only: nothing runs there.", "You build task T01 your own way."]) {
    assert.equal(app.includes(needle), true, needle);
  }
  assert.equal(app.includes("DEVOS_PAUSED is true"), false);
  assert.equal(read("README.md").includes("Optional: a private backup that holds the project; nothing runs there"), true);
  assert.equal(read("CHANGELOG.md").includes("- **Local development is a handover (PR-83).**"), true);
});

test("handover.test.mjs (d) a local project committed before 1.9.0 keeps DEV_OS: devos continue and devos verify never hand it over", () => {
  const staged = stage();
  try {
    mkdirSync(staged.project);
    const installed = spawnSync(process.execPath, [bin, "install", staged.project, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    write(staged.project, "devos/answers.json", `${JSON.stringify({ name: "Demo Shop", cycle: "local", modules: {} }, null, 2)}\n`);
    for (const rel of ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md", "README.md", "SETUP.md"]) write(staged.project, rel, `${rel}\n`);
    const run = (args) => spawnSync("git", args, { cwd: staged.project, encoding: "utf8", windowsHide: true, env: staged.env });
    assert.equal(run(["init", "-q", "-b", "main"]).status, 0);
    assert.equal(run(["add", "-A"]).status, 0);
    assert.equal(run(["commit", "-q", "-m", "DEV_OS bootstrap: Demo Shop"]).status, 0);
    const result = spawnSync(process.execPath, [bin, "continue", staged.project], { encoding: "utf8", windowsHide: true, timeout: 180000, input: "", env: staged.env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.includes("devos: everything is done"), true, result.stdout);
    assert.equal(result.stdout.includes("handed over"), false, result.stdout);
    assert.equal(existsSync(path.join(staged.project, "devos", "engine.lock.json")), true);
    assert.equal(existsSync(path.join(staged.project, "scripts", "devos", "run-checks.mjs")), true);
    assert.equal(run(["status", "--porcelain"]).stdout, "");
    assert.equal(run(["rev-list", "--count", "HEAD"]).stdout.trim(), "1");
    assert.equal(JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8")).handover, undefined);
  } finally {
    cleanup(staged.parent);
  }
});
