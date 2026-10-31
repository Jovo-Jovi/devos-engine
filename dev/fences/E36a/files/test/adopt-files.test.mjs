import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup } from "./harness.mjs";
import { AGENT_END, AGENT_START, mergeAgentFile, mergeLines, placeEngineFiles } from "../lib/adopt.mjs";
import { buildManifest, manifestText } from "../tools/build-manifest.mjs";

// E36a (PR-69, D-E13): DEV_OS's files beside an existing project's own; nothing of the project's is overwritten.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const IDENTITY = ["-c", "user.name=Devos Test", "-c", "user.email=devos@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];
const PROJECT_CI = "name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ vars.MY_FLAG }}\n";
const RELEASE = "name: release\non: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ vars.RELEASE_CHANNEL }}\n";

function git(args, cwd) {
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function existing(files) {
  const folder = mkdtempSync(path.join(tmpdir(), "devos-beside-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  git(["init", "-q", "-b", "main"], folder);
  git(["add", "-A"], folder);
  git(["commit", "-q", "-m", "the project"], folder);
  return folder;
}

const read = (folder, file) => readFileSync(path.join(folder, ...file.split("/")), "utf8").replaceAll("\r\n", "\n");
const guard = (folder, name) => spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", name], { cwd: folder, encoding: "utf8", windowsHide: true });

test("adopt-files.test.mjs (a) lines are merged once after the project's own, and DEV_OS's rules follow the project's text", () => {
  assert.equal(mergeLines("node_modules\n.next\n", "# deps\nnode_modules\n.devos/\n.env\n"), "node_modules\n.next\n\n# DEV_OS (added by devos adopt)\n.devos/\n.env\n");
  assert.equal(mergeLines("node_modules\n.devos/\n.env\n", ".devos/\n.env\n"), "node_modules\n.devos/\n.env\n");
  assert.equal(mergeLines("a", "b\n"), "a\n\n# DEV_OS (added by devos adopt)\nb\n");
  const once = mergeAgentFile("# Our notes\nUse pnpm.\n", "# Reviewer rules\nBe strict.\n");
  assert.equal(once, `# Our notes\nUse pnpm.\n\n${AGENT_START}\n# Reviewer rules\nBe strict.\n${AGENT_END}\n`);
  const twice = mergeAgentFile(`${once}After DEV_OS.\n`, "# Reviewer rules\nBe stricter.\n");
  assert.equal(twice, `# Our notes\nUse pnpm.\n\n${AGENT_START}\n# Reviewer rules\nBe stricter.\n${AGENT_END}\nAfter DEV_OS.\n`);
  assert.equal(mergeAgentFile("", "Rules.\n"), `${AGENT_START}\nRules.\n${AGENT_END}\n`);
});

test("adopt-files.test.mjs (b) the project's CI stays, DEV_OS's goes beside it, and the manual names only DEV_OS's workflows", () => {
  const folder = existing({
    ".github/workflows/ci.yml": PROJECT_CI,
    ".github/workflows/release.yml": RELEASE,
    ".gitignore": "node_modules\n.next\n",
    "src/app.ts": "export const app = 1;\n",
  });
  try {
    const placed = placeEngineFiles(folder, "DEMO");
    assert.equal(placed.code, 0, JSON.stringify(placed));
    assert.deepEqual(placed.merged, [".gitignore"]);
    assert.deepEqual(placed.placed, [".github/workflows/devos-ci.yml"]);
    assert.equal(placed.renamed, true);
    assert.equal(read(folder, ".github/workflows/ci.yml"), PROJECT_CI.replace("name: ci\n", "name: ci (project)\n"));
    assert.equal(read(folder, ".github/workflows/devos-ci.yml"), read(root, "payload/files/dot-github/workflows/ci.yml"));
    assert.equal(read(folder, ".github/workflows/release.yml"), RELEASE);
    const ignore = read(folder, ".gitignore");
    assert.equal(ignore.startsWith("node_modules\n.next\n\n# DEV_OS (added by devos adopt)\n"), true, ignore);
    assert.equal(ignore.split("\n").filter((entry) => entry === "node_modules").length, 1);
    const lock = JSON.parse(read(folder, "devos/engine.lock.json"));
    assert.deepEqual(lock.files.filter((entry) => entry.at), [{ path: ".github/workflows/ci.yml", sha256: lock.files.find((entry) => entry.at).sha256, at: ".github/workflows/devos-ci.yml" }]);
    assert.equal(existsSync(path.join(folder, "devos.config.json")), true);
    const manual = guard(folder, "manual");
    assert.equal(manual.status, 0, manual.stdout);
    assert.equal(manual.stdout.startsWith("guard:manual    PASS  (117 names checked)"), true, manual.stdout);
  } finally {
    cleanup(folder);
  }
});

test("adopt-files.test.mjs (c) any other engine file that differs stops the placement, and nothing is written", () => {
  const folder = existing({
    ".claude/settings.json": "{\"permissions\":{\"allow\":[\"Bash(npm test)\"]}}\n",
    ".cursor/rules/10-security-data.mdc": "our rule\n",
    "README.md": "# Demo\n",
  });
  try {
    const placed = placeEngineFiles(folder, "DEMO");
    assert.deepEqual(placed, { code: 1, refused: [".claude/settings.json", ".cursor/rules/10-security-data.mdc"] });
    assert.equal(existsSync(path.join(folder, "devos")), false);
    assert.equal(existsSync(path.join(folder, "scripts")), false);
    assert.equal(git(["status", "--porcelain"], folder), "");
  } finally {
    cleanup(folder);
  }
});

test("adopt-files.test.mjs (d) devos upgrade updates DEV_OS's CI where it lives and never touches the project's", () => {
  const folder = existing({ ".github/workflows/ci.yml": PROJECT_CI, "README.md": "# Demo\n" });
  const next = mkdtempSync(path.join(tmpdir(), "devos-next-"));
  try {
    assert.equal(placeEngineFiles(folder, "DEMO").code, 0);
    git(["add", "-A"], folder);
    git(["commit", "-q", "-m", "DEV_OS beside the project"], folder);
    rmSync(next, { recursive: true, force: true });
    mkdirSync(next);
    for (const part of ["package.json", "bin", "lib", "payload"]) cpSync(path.join(root, part), path.join(next, part), { recursive: true });
    const pkg = path.join(next, "package.json");
    writeFileSync(pkg, readFileSync(pkg, "utf8").replace("\"version\": \"1.4.0\"", "\"version\": \"1.4.1\""));
    const ci = path.join(next, "payload", "files", "dot-github", "workflows", "ci.yml");
    writeFileSync(ci, `${readFileSync(ci, "utf8").replaceAll("\r\n", "\n")}# Upgrade test line.\n`);
    writeFileSync(path.join(next, "payload", "manifest.json"), manifestText(buildManifest(next)));
    const upgraded = spawnSync(process.execPath, [path.join(next, "bin", "devos.mjs"), "upgrade", "--local"], { cwd: folder, encoding: "utf8", windowsHide: true, timeout: 180000 });
    assert.equal(upgraded.status, 0, upgraded.stdout + upgraded.stderr);
    assert.equal(upgraded.stdout.includes("devos upgrade 1.4.0 to 1.4.1: 1 updated, 0 added, 0 removed, 0 conflicts"), true, upgraded.stdout);
    const branch = "devos/upgrade-1.4.1";
    const changed = git(["diff", "--name-only", `main..${branch}`], folder).split("\n").filter(Boolean).sort();
    assert.deepEqual(changed, [".github/workflows/devos-ci.yml", "devos/engine.lock.json"]);
    assert.equal(git(["show", `${branch}:.github/workflows/devos-ci.yml`], folder).endsWith("# Upgrade test line.\n"), true);
    assert.equal(git(["show", `${branch}:.github/workflows/ci.yml`], folder), PROJECT_CI.replace("name: ci\n", "name: ci (project)\n"));
    const lock = JSON.parse(git(["show", `${branch}:devos/engine.lock.json`], folder));
    assert.equal(lock.files.find((entry) => entry.path === ".github/workflows/ci.yml").at, ".github/workflows/devos-ci.yml");
  } finally {
    cleanup(folder);
    cleanup(next);
  }
});

test("adopt-files.test.mjs (e) without a lock the manual still names every workflow, and PR-69 records the rules", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "devos-nolock-"));
  try {
    const done = spawnSync(process.execPath, [bin, "install", folder, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: folder, windowsHide: true }).status, 0);
    writeFileSync(path.join(folder, ".github", "workflows", "release.yml"), RELEASE);
    const withLock = guard(folder, "manual");
    assert.equal(withLock.status, 0, withLock.stdout);
    rmSync(path.join(folder, "devos", "engine.lock.json"));
    const withoutLock = guard(folder, "manual");
    assert.equal(withoutLock.status, 1);
    assert.equal(withoutLock.stdout.includes("docs/method/AUTOMATION.md does not mention the workflow `release.yml`"), true, withoutLock.stdout);
    const precedents = read(root, "payload/files/docs/method/PRECEDENTS.md");
    assert.equal(precedents.includes("| PR-69 | **DEV_OS's files sit beside a project's own; nothing of the project's is overwritten.**"), true);
    assert.equal(read(root, "payload/files/docs/method/AUTOMATION.md").includes("**DEV_OS beside a project's own files (PR-69).**"), true);
  } finally {
    cleanup(folder);
  }
});
