import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, stage } from "./harness.mjs";
import { AGENT_START, adoptModules, plainFile, strayPaths } from "../lib/adopt.mjs";

// E36b (D-E13): from a confirmed brief, DEV_OS goes onto a new branch devos/adopt, made in a worktree outside the
// project, with the documents the AI tool writes and the baseline; the developer's checkout is never touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const AGENT = ["--agent", "claude:claude-opus-5-5"];
const FILES = {
  "package.json": JSON.stringify({ name: "demo-app", scripts: { build: "next build", test: "vitest run" }, dependencies: { next: "15.0.0", react: "19.0.0" }, devDependencies: { typescript: "5.6.0", vitest: "2.0.0" } }, null, 2),
  "app/page.tsx": "export default function Page() {\n  return null;\n}\n",
  "src/lib/contact.ts": "export const mail = \"team@example.com\";\n",
  ".github/workflows/ci.yml": "name: ci\non: push\njobs: {}\n",
  ".gitignore": "node_modules\n.env\n",
  "docs/notes.md": "# Notes\n",
  "CLAUDE.md": "# Our own notes\nUse pnpm.\n",
};

function setUp(extra = {}, tools = []) {
  const staged = stage({ tools });
  const folder = staged.project;
  for (const [file, text] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), text);
  }
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: folder, encoding: "utf8", windowsHide: true, env: staged.env });
    return { status: result.status, out: String(result.stdout ?? "") };
  };
  for (const args of [["init", "-q", "-b", "main"], ["config", "core.autocrlf", "false"], ["add", "-A"], ["commit", "-q", "-m", "the project"], ["remote", "add", "origin", "https://github.com/devtest/demo-app.git"]]) {
    assert.equal(git(args).status, 0, args.join(" "));
  }
  const run = (args, input, env = {}) => spawnSync(process.execPath, [bin, "adopt", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300000,
    input,
    env: { ...staged.env, STUB_REPO: "full", ...env },
  });
  const rounds = () => {
    const log = path.join(staged.parent, "claude.log");
    return existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const toolRounds = () => {
    const log = path.join(staged.parent, "tool.log");
    return existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  return { staged, folder, git, run, rounds, toolRounds };
}

function unchanged(t, head) {
  assert.equal(t.git(["rev-parse", "HEAD"]).out, head);
  assert.equal(t.git(["status", "--porcelain"]).out, "");
  assert.equal(t.git(["branch", "--show-current"]).out.trim(), "main");
  assert.equal(t.git(["worktree", "list"]).out.trim().split("\n").length, 1);
}

test("adopt-install.test.mjs (m) yes after the brief puts DEV_OS on devos/adopt in one commit, and the checkout stays as it was", () => {
  const t = setUp({ ".gitignore": "node_modules\n.env\n.claude/\ndocs/design/\n" });
  try {
    // The project's own hook would stop any commit; DEV_OS's commit does not run it.
    const hook = path.join(t.folder, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: committed although your .gitignore leaves them out: .claude/"), true, result.stdout);
    assert.equal(result.stdout.includes("Narrow your .gitignore, so later upgrades keep them too.\n"), true, result.stdout);
    assert.equal(result.stdout.includes(`devos: DEV_OS is on the branch devos/adopt of ${t.folder}, in one commit. The baseline holds 2 known findings of i18n, literals.\n`), true, result.stdout);
    assert.equal(result.stdout.includes("devos: your checkout is still on main, unchanged."), true, result.stdout);
    assert.equal(result.stdout.includes(".github/workflows/devos-ci.yml placed beside your own"), true, result.stdout);
    unchanged(t, head);
    assert.equal(t.git(["log", "-1", "--format=%s", "devos/adopt"]).out.trim(), "DEV_OS adopt: Demo App (engine 1.4.0)");
    assert.equal(t.git(["rev-list", "--count", "main..devos/adopt"]).out.trim(), "1");
    const files = t.git(["diff", "--name-only", "main..devos/adopt"]).out.split("\n").filter(Boolean);
    for (const file of [".github/workflows/devos-ci.yml", ".github/workflows/ci.yml", ".gitignore", "CLAUDE.md", "devos/answers.json", "devos/baseline.json", "devos/engine.lock.json", "docs/PHASES.md", "docs/fences/T01.md", ".claude/settings.json"]) {
      assert.equal(files.includes(file), true, file);
    }
    assert.equal(files.some((file) => file.startsWith("app/") || file.startsWith("src/") || file.startsWith(".devos/")), false, files.join("\n"));
    assert.equal(t.git(["show", "devos/adopt:.github/workflows/ci.yml"]).out, "name: ci (project)\non: push\njobs: {}\n");
    assert.equal(t.git(["ls-tree", "-r", "--name-only", "devos/adopt", ".claude/agents"]).out.split("\n").filter(Boolean).length > 0, true);
    assert.equal(t.git(["ls-tree", "--name-only", "devos/adopt", "docs/design/UI_ACCEPTANCE.md"]).out, "docs/design/UI_ACCEPTANCE.md\n");
    assert.equal(t.git(["show", "devos/adopt:CLAUDE.md"]).out, `# Our own notes\nUse pnpm.\n\n${AGENT_START}\n# CLAUDE.md\n\nStub reviewer rules.\n<!-- devos:end -->\n`);
    assert.equal(t.git(["show", "devos/adopt:.claude/settings.json"]).out, readFileSync(path.join(root, "payload", "files", "dot-claude", "settings.json"), "utf8").replaceAll("\r\n", "\n"));
    const answers = JSON.parse(t.git(["show", "devos/adopt:devos/answers.json"]).out);
    assert.equal(answers.key, "DEMO-APP");
    assert.equal(answers.type, "saas");
    assert.deepEqual(answers.blueprint_agent, { tool: "claude", model: "claude-opus-5-5" });
    assert.deepEqual(answers.adopted, { stage: "in-development", head: head.trim(), engine: "1.4.0" });
    const baseline = JSON.parse(t.git(["show", "devos/adopt:devos/baseline.json"]).out);
    assert.deepEqual(Object.keys(baseline.guards), ["i18n", "literals"]);
    const done = t.rounds();
    assert.equal(done.length, 2);
    assert.equal(done[1].stdin.startsWith("# DEV_OS adoption: the documents of a project that already exists\n"), true, done[1].stdin.slice(0, 80));
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (n) a tool that changes the project's own files or an engine file, stages, commits or plants a folder stops the adoption, and nothing is kept", () => {
  for (const [mode, why] of [
    ["touch-code", "devos: claude changed files outside DEV_OS's documents: app/page.tsx\n"],
    ["touch-docs", "devos: claude changed files outside DEV_OS's documents: docs/method/AUTOMATION.md, docs/notes.md\n"],
    ["commit", "devos: claude moved the branch devos/adopt\n"],
    ["settings-dir", "devos: claude changed DEV_OS's engine files: .claude/settings.json\n"],
    ["hide-engine", "devos: claude changed DEV_OS's engine files: scripts/guards/lib.mjs\n"],
  ]) {
    const t = setUp();
    try {
      const head = t.git(["rev-parse", "HEAD"]).out;
      const result = t.run([t.folder, ...AGENT], "yes\nyes\n", { STUB_ADOPT: mode });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(result.stdout.includes(why), true, result.stdout);
      assert.equal(result.stdout.includes(`devos: nothing was kept: the branch devos/adopt is removed, and ${t.folder} is as it was\n`), true, result.stdout);
      unchanged(t, head);
      assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
    } finally {
      cleanup(t.staged.parent);
    }
  }
});

test("adopt-install.test.mjs (o) files of the project's with DEV_OS's names, a tracked link where DEV_OS writes, or an older copy of DEV_OS, stop it before the brief", () => {
  const t = setUp({ ".claude/settings.json": "{\"permissions\":{\"allow\":[\"Bash(npm test)\"]}}\n", "docs/SCOPE.md": "# Our scope\n" });
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: these files of yours have DEV_OS's names and differ: .claude/settings.json. Move them aside (your .claude/settings.json can become .claude/settings.local.json, which Claude Code also reads), commit, then run devos adopt again.\ndevos: these documents of yours have the names of DEV_OS's: docs/SCOPE.md. Rename them, commit, then run devos adopt again.\n"), true, result.stdout);
    unchanged(t, head);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
    assert.equal(t.rounds().length, 0);
  } finally {
    cleanup(t.staged.parent);
  }
  const linked = setUp();
  try {
    // A link the repository tracks at devos/, made through the index so it works where links cannot be made.
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: linked.folder, input: "../elsewhere", encoding: "utf8", env: linked.staged.env }).stdout.trim();
    for (const args of [["update-index", "--add", "--cacheinfo", `120000,${blob},devos`], ["commit", "-q", "-m", "a link"], ["checkout", "--", "devos"]]) assert.equal(linked.git(args).status, 0, args.join(" "));
    const result = linked.run([linked.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: these are links in your repository where DEV_OS writes: devos. Replace them with the folders or files, commit, then run devos adopt again.\n"), true, result.stdout);
    assert.equal(linked.rounds().length, 0);
  } finally {
    cleanup(linked.staged.parent);
  }
  const copy = setUp({ "scripts/devos/runner.mjs": "export {};\n", ".github/workflows/devos-cycle.yml": "name: devos-cycle\non: push\njobs: {}\n", "docs/method/PRECEDENTS.md": "# Precedents\n\n**Live maximum: PR-39.**\n" });
  try {
    const result = copy.run([copy.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: devtest/demo-app runs an older copy of DEV_OS; adding the engine to an older copy, keeping its documents and settings, comes in a later version\n"), true, result.stdout);
    assert.equal(copy.rounds().length, 0);
    assert.equal(copy.git(["branch", "--list", "devos/adopt"]).out, "");
  } finally {
    cleanup(copy.staged.parent);
  }
});

test("adopt-install.test.mjs (p) no now keeps the brief, and devos adopt --install uses it later", () => {
  const t = setUp();
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const later = t.run([t.folder, ...AGENT], "yes\nno\n");
    assert.equal(later.status, 0, later.stdout + later.stderr);
    assert.equal(later.stdout.includes(`devos: nothing in ${t.folder} changed; add DEV_OS from this brief with devos adopt --install ${t.folder}\n`), true, later.stdout);
    unchanged(t, head);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
    const installed = t.run(["--install", t.folder, ...AGENT], "");
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    assert.equal(t.git(["rev-list", "--count", "main..devos/adopt"]).out.trim(), "1");
    unchanged(t, head);
    const again = t.run(["--install", t.folder, ...AGENT], "");
    assert.equal(again.status, 1);
    assert.equal(again.stdout.includes(`devos: ${t.folder} already has a branch devos/adopt; delete it (git branch -D devos/adopt) or finish it, then run devos adopt --install again\n`), true, again.stdout);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (q) --install needs a confirmed brief for this commit and a default branch named main", () => {
  const t = setUp();
  try {
    const none = t.run(["--install", t.folder, ...AGENT], "");
    assert.equal(none.status, 1);
    assert.equal(none.stdout.includes(`devos: there is no confirmed brief for devtest/demo-app at this commit; run devos adopt ${t.folder} first\n`), true, none.stdout);
    const master = t.run([t.folder, ...AGENT], "yes\nyes\n", { STUB_DEFAULT_BRANCH: "master" });
    assert.equal(master.status, 1, master.stdout + master.stderr);
    assert.equal(master.stdout.includes("devos: DEV_OS works on a default branch named main, and devtest/demo-app's is master; rename it on GitHub (Settings → General → Default branch), pull, then run devos adopt --install again\n"), true, master.stdout);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (r) only DEV_OS's documents may change, devos writes only plain files, and modules map to the catalogue", () => {
  const kept = new Set(["docs/notes.md", "docs/method/AUTOMATION.md", "CLAUDE.md"]);
  const changed = ["docs/PHASES.md", "docs/fences/T01.md", "docs/notes.md", "docs/method/AUTOMATION.md", "docs/app/route.ts", "app/x -> docs/route.md", "docs/café.md", "docs/LINK.md", "CLAUDE.md", ".cursor/cli.json", "devos/project.json"];
  assert.deepEqual(strayPaths(changed, kept, { isLink: (file) => file === "docs/LINK.md" }), ["docs/notes.md", "docs/method/AUTOMATION.md", "docs/app/route.ts", "app/x -> docs/route.md", "docs/LINK.md", "CLAUDE.md", ".cursor/cli.json"]);
  assert.deepEqual(strayPaths(changed, kept, { allow: ["CLAUDE.md", ".cursor/cli.json"] }).includes("CLAUDE.md"), false);
  const tree = mkdtempSync(path.join(tmpdir(), "devos-plain-"));
  try {
    mkdirSync(path.join(tree, ".claude", "settings.json"), { recursive: true });
    writeFileSync(path.join(tree, "docs.md"), "x\n");
    assert.equal(plainFile(tree, "docs.md"), path.join(tree, "docs.md"));
    assert.equal(plainFile(tree, "new/folder/file.md"), path.join(tree, "new", "folder", "file.md"));
    assert.throws(() => plainFile(tree, ".claude/settings.json"), /not a plain file/);
    assert.throws(() => plainFile(tree, "docs.md/inner.md"), /not a plain file/);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
  const modules = adoptModules({ database: ["prisma", "supabase"], auth: ["auth.js"], payments: ["stripe"], observability: ["sentry", "structured-logs"] });
  assert.equal(modules.database, "supabase");
  assert.equal(modules.auth, "none");
  assert.equal(modules.payments, "stripe");
  assert.equal(modules.observability, "sentry");
  assert.equal(modules.email, "none");
});

test("adopt-install.test.mjs (s) with Cursor, its kit writes DEV_OS's CLAUDE.md beside the project's, and DEV_OS's permissions are committed", () => {
  const t = setUp({}, ["agent"]);
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const brief = t.run([t.folder, ...AGENT], "yes\nno\n");
    assert.equal(brief.status, 0, brief.stdout + brief.stderr);
    const result = t.run(["--install", t.folder, "--agent", "cursor:grok-4.7"], "");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    unchanged(t, head);
    const [round] = t.toolRounds();
    assert.equal(round.args.at(-1), "Read the file .devos/blueprint-input.md in this folder and do exactly what it says.");
    assert.equal(round.input.startsWith("# DEV_OS adoption: the documents of a project that already exists\n"), true, round.input.slice(0, 80));
    const kit = JSON.parse(round.cli).permissions;
    assert.equal(kit.allow.includes("Write(.devos/adopt/CLAUDE.md)"), true);
    assert.equal(kit.allow.includes("Write(CLAUDE.md)"), false);
    assert.equal(kit.deny.includes("Write(CLAUDE.md)"), true);
    assert.equal(t.git(["show", "devos/adopt:.cursor/cli.json"]).out, readFileSync(path.join(root, "payload", "files", "dot-cursor", "cli.json"), "utf8").replaceAll("\r\n", "\n"));
    assert.equal(t.git(["show", "devos/adopt:CLAUDE.md"]).out, `# Our own notes\nUse pnpm.\n\n${AGENT_START}\n# CLAUDE.md\n\nStub reviewer rules.\n<!-- devos:end -->\n`);
    assert.deepEqual(JSON.parse(t.git(["show", "devos/adopt:devos/answers.json"]).out).blueprint_agent, { tool: "cursor", model: "grok-4.7" });
  } finally {
    cleanup(t.staged.parent);
  }
});
