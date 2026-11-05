import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, stage } from "./harness.mjs";
import { AGENT_START, GATE_IMPORTS, adoptModules, adoptPullBody, askDeploy, plainFile, publicText, strayPaths } from "../lib/adopt.mjs";

// E36b (D-E13): from a confirmed brief, DEV_OS goes onto a new branch devos/adopt, made in a worktree outside the
// project, with the documents the AI tool writes and the baseline; the developer's checkout is never touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const AGENT = ["--agent", "claude:claude-opus-5-5"];
// E36c: before DEV_OS writes anything, the contract, the Control Tower link, and the cycle's agents as devos init asks
// them (reviewer, light reviewer, builder pool, its strengths, the builder policy, saving them): the defaults here.
const asked = (link = "no") => `accept\n${link}\n${"\n".repeat(6)}`;
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
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}no\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(`devos: nothing was pushed; devos/adopt stays on this computer. Run devos adopt --publish ${t.folder} when ready.\n`), true, result.stdout);
    assert.equal(result.stdout.includes("devos: committed although your .gitignore leaves them out: .claude/"), true, result.stdout);
    assert.equal(result.stdout.includes("Narrow your .gitignore, so later upgrades keep them too.\n"), true, result.stdout);
    assert.equal(result.stdout.includes(`devos: DEV_OS is on the branch devos/adopt of ${t.folder}, in one commit. The baseline holds 2 known findings of i18n, literals.\n`), true, result.stdout);
    assert.equal(result.stdout.includes("devos: your checkout is still on main, unchanged."), true, result.stdout);
    assert.equal(result.stdout.includes(".github/workflows/devos-ci.yml placed beside your own"), true, result.stdout);
    unchanged(t, head);
    assert.equal(t.git(["log", "-1", "--format=%s", "devos/adopt"]).out.trim(), "DEV_OS adopt: Demo App (engine 1.9.0)");
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
    assert.deepEqual(answers.adopted, { stage: "in-development", head: head.trim(), engine: "1.9.0" });
    assert.deepEqual([answers.contract_version, answers.registry_link, answers.attachments], ["2", false, []]);
    assert.equal(typeof JSON.parse(t.git(["show", "devos/adopt:devos/project.json"]).out).agents.reviewer.model, "string");
    assert.equal(t.git(["show", "devos/adopt:SETUP.md"]).out.startsWith("# SETUP — Demo App\n\nGenerated by devos adopt from devos/setup.json."), true);
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
      const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}`, { STUB_ADOPT: mode });
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

test("adopt-install.test.mjs (o) files of the project's with DEV_OS's names, a tracked link where DEV_OS writes, or an older copy with a task under way, stop it before the brief", () => {
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
    // E38: an older copy is adopted between tasks only.
    const result = copy.run([copy.folder, ...AGENT], "yes\nyes\n", { STUB_TASK_PULLS: JSON.stringify([{ number: 61, headRefName: "task/T21" }]) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: devtest/demo-app has a task under way (task/T21, pull request #61); merge or close it first, then run devos adopt again\n"), true, result.stdout);
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
    const installed = t.run(["--install", t.folder, ...AGENT], `${asked()}no\n`);
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
    const result = t.run(["--install", t.folder, "--agent", "cursor:grok-4.7"], `${asked()}no\n`);
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

/** A bare repository that receives the pushes meant for GitHub, while the origin stays a GitHub address. */
function bareOrigin(t) {
  const bare = path.join(t.staged.parent, "origin.git").replaceAll("\\", "/");
  assert.equal(spawnSync("git", ["init", "-q", "--bare", bare], { env: t.staged.env, windowsHide: true }).status, 0);
  assert.equal(t.git(["config", `url.${bare}.pushInsteadOf`, "https://github.com/devtest/demo-app.git"]).status, 0);
  return (ref) => String(spawnSync("git", ["--git-dir", bare, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8", env: t.staged.env, windowsHide: true }).stdout ?? "").trim();
}

function ghLines(t) {
  const log = path.join(t.staged.parent, "gh.log");
  return existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean) : [];
}

test("adopt-install.test.mjs (t) yes to push opens the pull request with a summary of the brief and sets the repository up, and starts no cycle", () => {
  const t = setUp();
  try {
    const remote = bareOrigin(t);
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked("yes")}yes\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("On devtest/demo-app: GitHub Actions may create and approve pull requests. The cycle needs it, and it applies to every workflow of the repository, yours too. Your workflows' default permissions stay read.\nLabels: devos:request, devos:method. Variables: DEVOS_REPORTING.\nKeys already on devtest/demo-app, which the cycle will use: "), true, result.stdout);
    assert.equal(result.stdout.includes("devos: the pull request is https://github.com/devtest/demo-app/pull/7\n"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: devtest/demo-app is ready for DEV_OS. Review the pull request and merge it: https://github.com/devtest/demo-app/pull/7\n"), true, result.stdout);
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    assert.equal(remote("refs/heads/main"), "");
    unchanged(t, head);
    const gh = ghLines(t);
    assert.equal(gh.filter((line) => line.startsWith("pr create --repo devtest/demo-app --base main --head devos/adopt --title DEV_OS adopt: Demo App --body-file ")).length, 1);
    assert.equal(gh.includes("api -X PUT repos/devtest/demo-app/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true"), true, gh.join("\n"));
    for (const name of ["devos:request", "devos:method"]) assert.equal(gh.some((line) => line.startsWith(`label create ${name} `)), true, name);
    assert.equal(gh.includes("variable set DEVOS_REPORTING --body on --repo devtest/demo-app"), true);
    assert.equal(gh.includes("variable set DEVOS_STATE --body on --repo devtest/demo-app"), true);
    assert.equal(gh.includes("variable set DEVOS_PAUSED --body false --repo devtest/demo-app"), true);
    assert.equal(gh.some((line) => /^(repo edit|repo create|workflow run)/.test(line)), false, gh.join("\n"));
    const bodies = readFileSync(path.join(t.staged.parent, "gh.log.bodies"), "utf8").split(/\r?\n/).filter(Boolean);
    assert.equal(bodies.length, 1);
    const body = JSON.parse(bodies[0]);
    for (const part of ["## What it is\n\nStub line for What it is.\n", "## Stage\n\nStub line for Stage.\n", "## The open work\n\nStub line for What is open.\n", "## What DEV_OS adds\n\nStub line for What DEV_OS will add.\n", "`devos/baseline.json`: the guards' findings on the code as it is (i18n, literals)", "(`SETUP.md` has the steps)"]) {
      assert.equal(body.includes(part), true, part);
    }
    for (const left of ["Risks", "Personal data", "Questions for you", "How it is built"]) assert.equal(body.includes(`Stub line for ${left}`), false, left);
    assert.equal(JSON.parse(t.git(["show", "devos/adopt:devos/answers.json"]).out).registry_link, true);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (u) no to push keeps the branch for devos adopt --publish, which only does what is missing; a declined contract writes nothing", () => {
  const t = setUp();
  try {
    const remote = bareOrigin(t);
    const kept = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}no\n`);
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
    assert.equal(remote("refs/heads/devos/adopt"), "");
    const published = t.run(["--publish", t.folder], "yes\n");
    assert.equal(published.status, 0, published.stdout + published.stderr);
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    // A fork's pull request from its own devos/adopt is never taken for this repository's.
    const sha = t.git(["rev-parse", "devos/adopt"]).out.trim();
    const pulls = [
      { url: "https://github.com/devtest/demo-app/pull/9", headRefOid: sha, isCrossRepository: true },
      { url: "https://github.com/devtest/demo-app/pull/7", headRefOid: sha, isCrossRepository: false },
    ];
    const again = t.run(["--publish", t.folder], "yes\n", { STUB_PULLS: JSON.stringify({ "devos/adopt": JSON.stringify(pulls) }) });
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal(again.stdout.includes("devos: the pull request is https://github.com/devtest/demo-app/pull/7\n"), true, again.stdout);
    assert.equal(ghLines(t).filter((line) => line.startsWith("pr create ")).length, 1);
    const fork = t.run(["--publish", t.folder], "yes\n", { STUB_PULLS: JSON.stringify({ "devos/adopt": JSON.stringify(pulls.slice(0, 1)) }) });
    assert.equal(fork.status, 0, fork.stdout + fork.stderr);
    assert.equal(ghLines(t).filter((line) => line.startsWith("pr create ")).length, 2);
    // Without the names of the variables already there, nothing is set over them.
    const blind = t.run(["--publish", t.folder], "yes\n", { STUB_VARIABLES: "not json" });
    assert.equal(blind.status, 1, blind.stdout + blind.stderr);
    assert.equal(blind.stdout.includes(`devos: GitHub did not list the keys and variables already on devtest/demo-app; check that your gh account administers it (devos doctor), then run devos adopt --publish ${t.folder}\n`), true, blind.stdout);
    assert.equal(t.git(["worktree", "list"]).out.trim().split("\n").length, 1);
  } finally {
    cleanup(t.staged.parent);
  }
  const d = setUp();
  try {
    const head = d.git(["rev-parse", "HEAD"]).out;
    const declined = d.run([d.folder, ...AGENT], "yes\nyes\nno\n");
    assert.equal(declined.status, 1, declined.stdout + declined.stderr);
    assert.equal(declined.stdout.includes("devos: contract declined — nothing was written or sent\n"), true, declined.stdout);
    assert.equal(d.git(["branch", "--list", "devos/adopt"]).out, "");
    assert.equal(d.rounds().length, 1);
    unchanged(d, head);
  } finally {
    cleanup(d.staged.parent);
  }
});

test("adopt-install.test.mjs (v) the description keeps no path of this computer and notifies no one, and an empty answer never pushes", () => {
  const home = path.join(tmpdir(), "someone");
  assert.equal(publicText(`Built in ${home}/.devos/adopt/x and ${home.replaceAll("\\", "/")}/y; ask @alice or @org/team, mail a@b.c`, [home]), "Built in ~/.devos/adopt/x and ~/y; ask @\u200balice or @\u200borg/team, mail a@\u200bb.c");
  assert.equal(publicText("built in c:\\users\\me\\app", ["C:\\Users\\Me"]), "built in ~\\app");
  assert.equal(publicText("see /etc/x", ["/"]), "see /etc/x");
  const md = "## What it is\n\nA shop by @bob.\n\n## Risks\n\nThe admin route has no auth.\n\n## Personal data\n\nEmails.\n";
  const body = adoptPullBody({ name: "Demo `App`" }, md, { items: [{ title: "Reviewer key", names: ["CLAUDE_CODE_OAUTH_TOKEN"] }], guards: ["i18n"] });
  assert.equal(body.startsWith("This pull request adds DEV_OS to `Demo 'App'`, "), true, body);
  assert.equal(body.includes("A shop by @\u200bbob."), true);
  assert.equal(body.includes("- Reviewer key: `CLAUDE_CODE_OAUTH_TOKEN`"), true);
  for (const left of ["admin route", "Emails.", "## Risks", "## Personal data"]) assert.equal(body.includes(left), false, left);
  const t = setUp();
  try {
    const remote = bareOrigin(t);
    const kept = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}\n`);
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
    assert.equal(kept.stdout.includes("Type yes to push and open the pull request, or anything else to keep the branch on this computer: devos: nothing was pushed;"), true, kept.stdout);
    assert.equal(remote("refs/heads/devos/adopt"), "");
    assert.equal(ghLines(t).some((line) => /^(pr create|label create|variable set|secret set|api -X)/.test(line)), false, ghLines(t).join("\n"));
  } finally {
    cleanup(t.staged.parent);
  }
});

// E37: a project that deploys itself, and a project in production.
const DEPLOYS = {
  "vercel.json": "{}\n",
  ".github/workflows/deploy.yml": "name: deploy\non: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vercel deploy --prod\n",
  "prisma/schema.prisma": "model Order {\n  id Int @id\n}\n",
  "src/lib/pay.ts": "import Stripe from \"stripe\";\nexport const client = Stripe;\n",
};
const GATED = [".github/workflows/deploy.yml", "vercel.json", "prisma/**", "src/lib/pay.ts"];

test("adopt-install.test.mjs (w) a project in production keeps its own deploy, and a change to its deploy, schema, sign-in or payment files stops at the gate", () => {
  const t = setUp(DEPLOYS);
  try {
    const remote = bareOrigin(t);
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}\nyes\n`, { STUB_STAGE: "production", STUB_VARIABLES: "[]" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("Your project deploys itself (vercel; deploy.yml). Who deploys main once DEV_OS is added?\n"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: your own deploy stays as it is; DEV_OS never deploys\n"), true, result.stdout);
    assert.equal(result.stdout.includes(`devos: in production, a task that changes one of these 4 paths stops at your gate (PR-72): ${GATED.join(", ")}\n`), true, result.stdout);
    unchanged(t, head);
    const answers = JSON.parse(t.git(["show", "devos/adopt:devos/answers.json"]).out);
    assert.deepEqual([answers.deploy, answers.adopted.stage], ["own", "production"]);
    const project = JSON.parse(t.git(["show", "devos/adopt:devos/project.json"]).out);
    assert.deepEqual(project.reviewer.human_gate_paths_extra, GATED);
    assert.deepEqual(project.reviewer.deep_paths_extra, GATED);
    const config = JSON.parse(t.git(["show", "devos/adopt:devos.config.json"]).out);
    assert.deepEqual(config.reviewer.human_gate_paths, GATED);
    assert.equal(GATED.every((entry) => config.reviewer.deep_paths.includes(entry)), true, config.reviewer.deep_paths.join(", "));
    // DEV_OS's deploy stays off: its variable is never set, and the pull request says so.
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    assert.equal(ghLines(t).some((line) => line.startsWith("variable set DEVOS_VERCEL")), false, ghLines(t).join("\n"));
    const body = JSON.parse(readFileSync(path.join(t.staged.parent, "gh.log.bodies"), "utf8").split(/\r?\n/).filter(Boolean)[0]);
    assert.equal(body.includes("- Your deploy stays as it is: DEV_OS never deploys.\n"), true, body);
    assert.equal(body.includes("- In production, a task that changes your deploy, schema, sign-in or payment files stops for your review and merge (4 paths, `reviewer.human_gate_paths_extra` in `devos/project.json`).\n"), true, body);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (x) a project in development may choose DEV_OS's deploy; its critical paths are reviewed deep, with no gate", () => {
  const t = setUp(DEPLOYS);
  try {
    const remote = bareOrigin(t);
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}2\nyes\n`, { STUB_VARIABLES: "[]" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: DEV_OS will deploy main to Vercel. Turn off Vercel's own Git deploys of main, or both will deploy it\n"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: in production"), false, result.stdout);
    assert.equal(JSON.parse(t.git(["show", "devos/adopt:devos/answers.json"]).out).deploy, "vercel");
    const project = JSON.parse(t.git(["show", "devos/adopt:devos/project.json"]).out);
    assert.equal(Object.hasOwn(project.reviewer, "human_gate_paths_extra"), false);
    assert.deepEqual(project.reviewer.deep_paths_extra, GATED);
    assert.deepEqual(JSON.parse(t.git(["show", "devos/adopt:devos.config.json"]).out).reviewer.human_gate_paths, []);
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    assert.equal(ghLines(t).includes("variable set DEVOS_VERCEL --body true --repo devtest/demo-app"), true, ghLines(t).join("\n"));
    const body = JSON.parse(readFileSync(path.join(t.staged.parent, "gh.log.bodies"), "utf8").split(/\r?\n/).filter(Boolean)[0]);
    assert.equal(body.includes("- DEV_OS deploys `main` to Vercel at the gates you sign (`devos-deploy.yml`). Turn off Vercel's own Git deploys of `main` before you merge, or both deploy it.\n"), true, body);
    assert.equal(body.includes("In production"), false, body);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (y) who deploys: none without a deploy, the project's own for any host but Vercel, and only 1 or 2 for Vercel", async () => {
  const survey = (deploy, deployWorkflows = []) => ({ automation: { deploy, deploy_workflows: deployWorkflows } });
  const reader = (lines) => async () => (lines.length > 0 ? lines.shift() : null);
  const quiet = console.log;
  const said = [];
  console.log = (line) => said.push(String(line));
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.equal(await askDeploy(reader([]), survey([])), "none");
    assert.equal(await askDeploy(reader([]), survey(["netlify"], ["ship.yml"])), "own");
    assert.equal(said.includes("Your project deploys itself (netlify; ship.yml). DEV_OS keeps that as it is and never deploys."), true, said.join("\n"));
    assert.equal(await askDeploy(reader(["1"]), survey(["vercel"])), "own");
    assert.equal(await askDeploy(reader(["", "2"]), survey(["vercel"])), "own");
    assert.equal(await askDeploy(reader(["3", " 2 "]), survey(["vercel"])), "vercel");
    assert.equal(await askDeploy(reader(["3", "x", "yes"]), survey(["vercel"])), null);
    assert.equal(said.at(-1), "devos: no valid answer for the deploy; nothing was written or sent");
    assert.equal(await askDeploy(reader([]), survey(["vercel", "docker"])), null);
    assert.equal(said.at(-1), "devos: input ended before DEV_OS was added; nothing was written or sent");
    assert.equal(await askDeploy(reader([]), { ...survey(["vercel"]), repository: { devos_variables: ["DEVOS_VERCEL"] } }), "vercel");
    assert.equal(said.at(-1).startsWith("devos: DEVOS_VERCEL is set on the repository, so DEV_OS deploys main to Vercel."), true);
  } finally {
    console.log = quiet;
    process.stdout.write = write;
  }
  const md = "## What it is\n\nA shop.\n";
  const plain = adoptPullBody({ name: "Shop" }, md, {});
  for (const line of ["DEV_OS never deploys", "DEV_OS deploys `main`", "In production"]) assert.equal(plain.includes(line), false, line);
  assert.equal(adoptPullBody({ name: "Shop" }, md, { deploy: "own", gated: 1 }).includes("stops for your review and merge (1 path, `reviewer.human_gate_paths_extra`"), true);
});

// E38: an older copy of DEV_OS: the engine installed by hand long ago, with no engine lock, no devos/project.json and
// method files of its time, a devos.config.json of its own, and the project's documents.
function olderCopy(t) {
  const step = (args) => assert.equal(t.git(args).status, 0, args.join(" "));
  step(["rm", "-q", ".github/workflows/ci.yml", ".gitignore"]);
  const installed = spawnSync(process.execPath, [bin, "install", t.folder, "--key", "SHOP"], { encoding: "utf8", windowsHide: true, env: t.staged.env });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const at = (file) => path.join(t.folder, ...file.split("/"));
  const write = (file, text) => {
    mkdirSync(path.dirname(at(file)), { recursive: true });
    writeFileSync(at(file), text);
  };
  const config = JSON.parse(readFileSync(at("devos.config.json"), "utf8"));
  config.max_attempts = 4;
  config.reviewer.deep_paths = [...config.reviewer.deep_paths, "src/legacy/**"];
  delete config.check_timeout_minutes;
  for (const file of ["devos/engine.lock.json", "devos/project.json", "devos/engine.defaults.json", "devos/answers.json"]) rmSync(at(file), { force: true });
  write("devos.config.json", `${JSON.stringify(config, null, 2)}\n`);
  // Method files of the copy's time, and some the engine no longer ships.
  write("scripts/devos/verdict.mjs", `${readFileSync(at("scripts/devos/verdict.mjs"), "utf8")}// the copy's time\n`);
  write(".github/workflows/ci.yml", "name: ci\non: push\njobs: {}\n");
  write("scripts/devos/old-rules.mjs", "export const rules = [];\n");
  write(".github/workflows/devos-old.yml", "name: devos-old\non: push\njobs: {}\n");
  write("devos/prompts/old.md", "# Old prompt\n");
  // The project's own: its precedents, its security rule, its documents.
  const precedents = readFileSync(at("docs/method/PRECEDENTS.md"), "utf8");
  const row = precedents.split("\n").find((line) => line.startsWith("| PR-01 |"));
  write("docs/method/PRECEDENTS.md", `${precedents.replace(row, "| PR-01 | **Environment profile.** The shop builds on Linux with pnpm. | the shop |")}| PR-99 | **The shop's own ruling.** | the shop |\n`);
  write(".cursor/rules/10-security-data.mdc", "---\nalwaysApply: true\n---\n- The shop keeps no card numbers.\n");
  for (const file of ["PHASES.md", "GLOSSARY.md"]) write(`docs/${file}`, readFileSync(path.join(root, "test", "fixtures", "docs", file), "utf8"));
  write("docs/fences/T01.md", readFileSync(path.join(root, "test", "fixtures", "fences", "T01.md"), "utf8"));
  write("docs/reviews/T01-a1.md", "VERDICT: PASS\n");
  write("docs/method/CARRY_FORWARDS.md", "# Carry-forwards\n");
  step(["add", "-A"]);
  step(["commit", "-q", "-m", "the copy of DEV_OS"]);
}

test("adopt-install.test.mjs (z) an older copy of DEV_OS: its method files become the engine's, its documents and CLAUDE.md stay, and its settings become devos/project.json", () => {
  const t = setUp();
  try {
    olderCopy(t);
    const remote = bareOrigin(t);
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}yes\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("DEV_OS: older copy"), true, result.stdout);
    assert.match(result.stdout, /devos: an older copy of DEV_OS: 3 of its method files are now the engine's, and 3 it no longer ships are removed \(\.github\/workflows\/devos-old\.yml, devos\/prompts\/old\.md, scripts\/devos\/old-rules\.mjs\)\. Its documents stay, and its precedents file is kept at docs\/method\/before-adopt\/PRECEDENTS\.md\.\n/);
    assert.match(result.stdout, /devos: your devos\.config\.json became devos\/project\.json, with the 3 settings that differ from DEV_OS's defaults \((?=[^)]*max_attempts)(?=[^)]*scenario)(?=[^)]*reviewer\.deep_paths_extra)[^)]+\); devos\.config\.json is generated from it now\n/);
    unchanged(t, head);
    // Only the brief ran: the copy's documents are its own.
    assert.equal(t.rounds().length, 1);
    const show = (file) => t.git(["show", `devos/adopt:${file}`]).out;
    const shipped = (file) => readFileSync(path.join(root, "payload", "files", ...file.replace(/^\.github\//, "dot-github/").split("/")), "utf8").replaceAll("\r\n", "\n");
    for (const file of ["scripts/devos/verdict.mjs", ".github/workflows/ci.yml"]) assert.equal(show(file), shipped(file), file);
    const files = t.git(["ls-tree", "-r", "--name-only", "devos/adopt"]).out.split("\n");
    for (const file of ["scripts/devos/old-rules.mjs", ".github/workflows/devos-old.yml", "devos/prompts/old.md", ".github/workflows/devos-ci.yml", "docs/fences/T02.md"]) assert.equal(files.includes(file), false, file);
    for (const file of ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md", "docs/reviews/T01-a1.md", "docs/method/CARRY_FORWARDS.md", ".cursor/rules/10-security-data.mdc", "CLAUDE.md"]) {
      assert.equal(show(file), t.git(["show", `HEAD:${file}`]).out, file);
    }
    // The engine's precedents with the copy's PR-01; the copy's own beside them.
    const precedents = show("docs/method/PRECEDENTS.md");
    assert.equal(precedents.includes("| PR-01 | **Environment profile.** The shop builds on Linux with pnpm. | the shop |\n"), true);
    assert.equal(precedents.includes("PR-99"), false);
    assert.equal(precedents.includes("| PR-72 |"), true);
    assert.equal(show("docs/method/before-adopt/PRECEDENTS.md"), t.git(["show", "HEAD:docs/method/PRECEDENTS.md"]).out);
    const project = JSON.parse(show("devos/project.json"));
    assert.equal(project.project, "SHOP");
    assert.equal(project.max_attempts, 4);
    assert.deepEqual(project.reviewer.deep_paths_extra, ["src/legacy/**"]);
    assert.equal(typeof project.agents.reviewer.model, "string");
    const config = JSON.parse(show("devos.config.json"));
    assert.equal(config.max_attempts, 4);
    assert.equal(typeof config.check_timeout_minutes, "number");
    assert.equal(config.reviewer.deep_paths.includes(".github/**") && config.reviewer.deep_paths.includes("src/legacy/**"), true);
    assert.equal(JSON.parse(show("devos/engine.lock.json")).files.some((entry) => entry.path === ".github/workflows/ci.yml" && !entry.at), true);
    const answers = JSON.parse(show("devos/answers.json"));
    assert.equal(answers.key, "SHOP");
    // Its own settings: max_attempts, its deep path, and the scenario its old install wrote.
    assert.deepEqual(answers.adopted.copy, {
      replaced: [".github/workflows/ci.yml", "docs/method/PRECEDENTS.md", "scripts/devos/verdict.mjs"],
      removed: [".github/workflows/devos-old.yml", "devos/prompts/old.md", "scripts/devos/old-rules.mjs"],
      settings: answers.adopted.copy.settings,
      left: [],
    });
    assert.deepEqual([...answers.adopted.copy.settings].sort(), ["max_attempts", "reviewer.deep_paths_extra", "scenario"]);
    // The pull request says what changed, and that the cycle goes on with the next open task.
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    const body = JSON.parse(readFileSync(path.join(t.staged.parent, "gh.log.bodies"), "utf8").split(/\r?\n/).filter(Boolean)[0]);
    for (const line of [
      "- DEV_OS's engine files in place of the older copy's: 3 of its method files are now the engine's (the diff shows each), and these it no longer ships are removed: `.github/workflows/devos-old.yml`, `devos/prompts/old.md`, `scripts/devos/old-rules.mjs`. Your documents, fences, reviews and carry-forwards stay as they are.\n",
      `- \`devos/project.json\`: the 3 settings of your \`devos.config.json\` that differ from DEV_OS's defaults (${answers.adopted.copy.settings.map((name) => `\`${name}\``).join(", ")}). \`devos.config.json\` is generated from it now.\n`,
      "- Your precedents file is kept at `docs/method/before-adopt/PRECEDENTS.md` for reference. DEV_OS's rulings bind from now on, with your PR-01; carry over any ruling of your own you still need.\n",
      "Merge it between tasks: with no task branch open and no `devos-cycle` run going.",
      "- `CLAUDE.md` stays as it is.\n",
      "The cycle goes on with the next open task in `docs/PHASES.md`",
    ]) assert.equal(body.includes(line), true, line);
    assert.equal(body.includes("fence `T01`"), false, body);
    assert.equal(result.stdout.includes("devos: after the merge, the supervisor starts your next open task within half an hour"), true, result.stdout);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (aa) an older copy: a link where devos writes, or a setting that would take away a rule, stops it before the brief; DEV_OS's CI placed beside stays beside", () => {
  const linked = setUp();
  try {
    olderCopy(linked);
    // Links the repository tracks, made through the index: the generated config, and where the copy's precedents go.
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: linked.folder, input: "../../elsewhere", encoding: "utf8", env: linked.staged.env }).stdout.trim();
    // Its CLAUDE.md is a link too, which is fine: an older copy's CLAUDE.md is never written.
    for (const args of [["rm", "-q", "--cached", "devos.config.json", "CLAUDE.md"], ["update-index", "--add", "--cacheinfo", `120000,${blob},devos.config.json`], ["update-index", "--add", "--cacheinfo", `120000,${blob},docs/method/before-adopt/PRECEDENTS.md`], ["update-index", "--add", "--cacheinfo", `120000,${blob},CLAUDE.md`], ["commit", "-q", "-m", "links"], ["checkout", "--", "devos.config.json", "docs/method/before-adopt/PRECEDENTS.md", "CLAUDE.md"]]) {
      assert.equal(linked.git(args).status, 0, args.join(" "));
    }
    const result = linked.run([linked.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: these are links in your repository where DEV_OS writes: devos.config.json, docs/method/before-adopt/PRECEDENTS.md. Replace them with the folders or files, commit, then run devos adopt again.\n"), true, result.stdout);
    assert.equal(linked.rounds().length, 0);
  } finally {
    cleanup(linked.staged.parent);
  }
  const unsafe = setUp();
  try {
    olderCopy(unsafe);
    const file = path.join(unsafe.folder, "devos.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.required_checks = null;
    config.reviewer.human_gate_paths = "none";
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    for (const args of [["add", "-A"], ["commit", "-q", "-m", "settings"]]) assert.equal(unsafe.git(args).status, 0, args.join(" "));
    const result = unsafe.run([unsafe.folder, ...AGENT], "yes\nyes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: these settings of your devos.config.json would take away a rule of DEV_OS's: reviewer.human_gate_paths (a string, where DEV_OS has a list), required_checks (null, where DEV_OS has a list); remove them, commit, then run devos adopt again\n"), true, result.stdout);
    assert.equal(unsafe.rounds().length, 0);
  } finally {
    cleanup(unsafe.staged.parent);
  }
  const beside = setUp();
  try {
    olderCopy(beside);
    // The copy keeps a CI of its own, with DEV_OS's placed beside it; its surfaces are its own too.
    writeFileSync(path.join(beside.folder, ".github", "workflows", "devos-ci.yml"), readFileSync(path.join(beside.folder, ".github", "workflows", "ci.yml"), "utf8"));
    writeFileSync(path.join(beside.folder, ".github", "workflows", "ci.yml"), "name: ci (project)\non: push\njobs: {}\n");
    const file = path.join(beside.folder, "devos.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    // A wider reviewer surface of its own, which must not carry over.
    config.surfaces.reviewer.allow = [...config.surfaces.reviewer.allow, "**"];
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    for (const args of [["add", "-A"], ["commit", "-q", "-m", "its own CI"]]) assert.equal(beside.git(args).status, 0, args.join(" "));
    const result = beside.run([beside.folder, ...AGENT], `yes\nyes\n${asked()}no\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: your devos.config.json surfaces is left out: the role surfaces are DEV_OS's\n"), true, result.stdout);
    const show = (name) => beside.git(["show", `devos/adopt:${name}`]).out;
    assert.equal(show(".github/workflows/ci.yml"), "name: ci (project)\non: push\njobs: {}\n");
    assert.equal(show(".github/workflows/devos-ci.yml"), readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "ci.yml"), "utf8").replaceAll("\r\n", "\n"));
    const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
    assert.deepEqual(JSON.parse(show("devos.config.json")).surfaces, defaults.surfaces);
    assert.equal(Object.hasOwn(JSON.parse(show("devos/project.json")), "surfaces"), false);
    assert.deepEqual(JSON.parse(show("devos/answers.json")).adopted.copy.left, ["surfaces"]);
    assert.equal(JSON.parse(show("devos/engine.lock.json")).files.find((entry) => entry.path === ".github/workflows/ci.yml").at, ".github/workflows/devos-ci.yml");
  } finally {
    cleanup(beside.staged.parent);
  }
  const besideOnly = setUp();
  try {
    olderCopy(besideOnly);
    // DEV_OS's older CI beside, and no ci.yml at all: the engine's takes the older one's place, and no second runs.
    for (const args of [["mv", ".github/workflows/ci.yml", ".github/workflows/devos-ci.yml"], ["commit", "-q", "-m", "its CI beside"]]) assert.equal(besideOnly.git(args).status, 0, args.join(" "));
    const result = besideOnly.run([besideOnly.folder, ...AGENT], `yes\nyes\n${asked()}no\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const files = besideOnly.git(["ls-tree", "-r", "--name-only", "devos/adopt", ".github/workflows"]).out.split("\n");
    assert.equal(files.includes(".github/workflows/ci.yml"), false, files.join("\n"));
    assert.equal(besideOnly.git(["show", "devos/adopt:.github/workflows/devos-ci.yml"]).out, readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "ci.yml"), "utf8").replaceAll("\r\n", "\n"));
  } finally {
    cleanup(besideOnly.staged.parent);
  }
});

test("adopt-install.test.mjs (ab) the page's line marker follows the brief question, the run ends with its code, and the folder is unchanged", () => {
  const t = setUp();
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder], "\n", { DEVOS_UI: "1" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const prompt = result.stdout.indexOf("Type yes to keep this brief");
    const marker = "::devos-ask {\"kind\":\"line\"}";
    assert.equal(prompt >= 0 && result.stdout.indexOf(marker, prompt) > prompt, true, result.stdout);
    assert.equal(result.stdout.trimEnd().endsWith(`::devos-step {"step":"done","code":${result.status}}`), true, result.stdout);
    unchanged(t, head);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-install.test.mjs (ac) a production adoption reads the project's source folders and gates a sign-in or payment import (PR-73)", () => {
  const t = setUp();
  try {
    const result = t.run([t.folder, ...AGENT], `yes\nyes\n${asked()}no\n`, { STUB_STAGE: "production", STUB_VARIABLES: "[]" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: DEV_OS's code checks read these folders too: app (guards.source_roots_extra in devos/project.json)\n"), true, result.stdout);
    const project = JSON.parse(t.git(["show", "devos/adopt:devos/project.json"]).out);
    assert.deepEqual(project.guards.source_roots_extra, ["app"]);
    assert.deepEqual(project.reviewer.human_gate_imports_extra, GATE_IMPORTS);
    assert.deepEqual(JSON.parse(t.git(["show", "devos/adopt:devos.config.json"]).out).guards.source_roots, ["src", "app"]);
  } finally {
    cleanup(t.staged.parent);
  }
});
