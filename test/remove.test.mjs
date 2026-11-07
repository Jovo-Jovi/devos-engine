import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planRemove, settingGroups } from "../lib/remove.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const SLUG = "acme/demo";

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

function ok(args, cwd) {
  const result = git(args, cwd);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function initRepo(dir) {
  ok(["init", "-q", "-b", "main"], dir);
  for (const [key, value] of [["user.email", "devos@example.com"], ["user.name", "devos"], ["core.autocrlf", "false"], ["maintenance.auto", "false"], ["gc.auto", "0"]]) {
    ok(["config", key, value], dir);
  }
}

function commitAll(dir, message) {
  ok(["add", "-A"], dir);
  ok(["commit", "-q", "-m", message], dir);
}

// A gh on PATH that answers from a state file and logs every call: list commands print the state as JSON, a delete
// takes the name out of it, and anything else succeeds.
function writeGh(dir) {
  writeFileSync(path.join(dir, "gh.mjs"), `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.DEVOS_GH_LOG, args.join(" ") + "\\n");
const file = process.env.DEVOS_GH_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const kinds = { secret: "secrets", variable: "variables", label: "labels" };
const kind = kinds[args[0]];
if (kind && args[1] === "list") process.stdout.write(JSON.stringify(state[kind].map((name) => ({ name }))));
else if (kind && args[1] === "delete") {
  state[kind] = state[kind].filter((name) => name !== args[2]);
  writeFileSync(file, JSON.stringify(state));
} else if (args[0] === "pr" && args[1] === "create") process.stdout.write("https://github.com/acme/demo/pull/7\\n");
`);
  if (windows) writeFileSync(path.join(dir, "gh.cmd"), "@echo off\r\nnode \"%~dp0gh.mjs\" %*\r\n");
  else {
    writeFileSync(path.join(dir, "gh"), "#!/bin/sh\nexec node \"$(dirname \"$0\")/gh.mjs\" \"$@\"\n");
    chmodSync(path.join(dir, "gh"), 0o755);
  }
}

/** An installed, committed project; with `origin`, a GitHub-named origin that git reaches in a local bare repository. */
function stage({ origin = false, settings = null } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-remove-"));
  const project = path.join(parent, "project");
  const stubs = path.join(parent, "bin");
  mkdirSync(project);
  mkdirSync(stubs);
  initRepo(project);
  const installed = spawnSync(process.execPath, [bin, "install", project, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  mkdirSync(path.join(project, "docs", "fences"), { recursive: true });
  writeFileSync(path.join(project, "docs", "fences", "T01.md"), "## T01 — The first task\n");
  writeFileSync(path.join(project, "docs", "PHASES.md"), "# Phases\n");
  writeFileSync(path.join(project, "devos", "answers.json"), "{\"name\": \"Demo\"}\n");
  commitAll(project, "install");
  if (origin) {
    const bare = path.join(parent, "origin.git");
    ok(["init", "-q", "--bare", "-b", "main", bare], parent);
    ok(["remote", "add", "origin", `https://github.com/${SLUG}.git`], project);
    ok(["config", `url.${pathToFileURL(bare).href}.insteadOf`, `https://github.com/${SLUG}.git`], project);
    ok(["push", "-q", "-u", "origin", "main"], project);
  }
  writeGh(stubs);
  const log = path.join(parent, "gh-log.txt");
  const state = path.join(parent, "gh-state.json");
  writeFileSync(log, "");
  writeFileSync(state, JSON.stringify(settings ?? { secrets: [], variables: [], labels: [] }));
  const env = { ...process.env, PATH: `${stubs}${path.delimiter}${process.env.PATH}`, DEVOS_GH_LOG: log, DEVOS_GH_STATE: state, GIT_TERMINAL_PROMPT: "0" };
  return { parent, project, log, state, env };
}

function devos(staged, args, input) {
  return spawnSync(process.execPath, [bin, "remove", ...args], { cwd: staged.project, encoding: "utf8", windowsHide: true, timeout: 180000, env: staged.env, input });
}

function names(dir, range) {
  return ok(["diff", "--name-only", range], dir).split(/\r?\n/).filter(Boolean).sort();
}

test("remove.test.mjs (a) the plan removes only what DEV_OS still owns, and DEV_OS's settings are told from the project's", () => {
  const files = [
    { path: ".gitignore", sha256: "g" },
    { path: "devos/a.md", sha256: "a" },
    { path: "devos/b.md", sha256: "b" },
    { path: "devos/c.md", sha256: "c" },
    { path: "docs/method/AUTOMATION.md", sha256: "m" },
    { path: ".github/workflows/ci.yml", sha256: "w", at: ".github/workflows/devos-ci.yml" },
  ];
  const current = new Map([[".gitignore", "g"], ["devos/a.md", "a"], ["devos/b.md", "edited"], ["devos/c.md", null], ["docs/method/AUTOMATION.md", "m"], [".github/workflows/ci.yml", "w"]]);
  assert.deepEqual(planRemove(files, current), [
    { path: ".github/workflows/ci.yml", at: ".github/workflows/devos-ci.yml", outcome: "remove" },
    { path: ".gitignore", at: ".gitignore", outcome: "keep", reason: "the project still uses it" },
    { path: "devos/a.md", at: "devos/a.md", outcome: "remove" },
    { path: "devos/b.md", at: "devos/b.md", outcome: "edited" },
    { path: "devos/c.md", at: "devos/c.md", outcome: "gone" },
    { path: "docs/method/AUTOMATION.md", at: "docs/method/AUTOMATION.md", outcome: "keep", reason: "your fences and reviews cite it" },
  ]);
  const items = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8")).items;
  const groups = settingGroups(items, {
    secrets: ["CURSOR_API_KEY", "ANTHROPIC_API_KEY_2", "DEVOS_PAT", "DEVOS_MEDIA_XAI_KEY", "DEVOS_OTHER", "VERCEL_TOKEN", "SUPABASE_DB_PASSWORD", "STRIPE_SECRET_KEY"],
    variables: ["DEVOS_PAUSED", "DEVOS_REPORTING", "MY_FLAG"],
    labels: ["devos:intake", "devos:needs-you", "bug"],
  });
  assert.deepEqual(groups, {
    secrets: ["ANTHROPIC_API_KEY_2", "CURSOR_API_KEY", "DEVOS_MEDIA_XAI_KEY", "DEVOS_OTHER", "DEVOS_PAT"],
    services: ["SUPABASE_DB_PASSWORD", "VERCEL_TOKEN"],
    variables: ["DEVOS_PAUSED", "DEVOS_REPORTING"],
    labels: ["devos:intake", "devos:needs-you"],
  });
});

test("remove.test.mjs (b) devos remove --local removes DEV_OS's files on a branch devos/remove and keeps the project's, an edited file and the method", () => {
  const staged = stage();
  try {
    const edited = path.join(staged.project, "devos", "prompts", "doctor.md");
    writeFileSync(edited, `${readFileSync(edited, "utf8")}A line of this project.\n`);
    commitAll(staged.project, "edit");
    const refused = devos(staged, ["--local"], "no\n");
    assert.equal(refused.status, 0, refused.stdout + refused.stderr);
    assert.equal(refused.stdout.includes("devos remove: nothing was changed"), true, refused.stdout);
    assert.equal(git(["rev-parse", "--verify", "--quiet", "refs/heads/devos/remove"], staged.project).status, 1);
    const result = devos(staged, ["--local"], "yes\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const line of [
      "- keeps 1 DEV_OS file you edited: devos/prompts/doctor.md",
      "- keeps .gitattributes and .gitignore: the project still uses them",
      "- keeps docs/method/ (5 files): your fences and reviews cite it",
      "- keeps your documents, fences, reviews, devos/answers.json and the settings DEV_OS wrote at setup",
      "It commits this on a new branch devos/remove (--local: nothing is pushed).",
      "devos: branch devos/remove committed locally (--local). Merge it, then run devos remove again to clear what is left.",
    ]) assert.equal(result.stdout.includes(line), true, `${line}\n${result.stdout}`);
    const lock = JSON.parse(readFileSync(path.join(staged.project, "devos", "engine.lock.json"), "utf8"));
    const owned = lock.files.length - 1 - 2 - 5;
    assert.equal(result.stdout.includes(`devos remove: ${owned + 2} removed, 1 kept (edited), 7 kept (the project needs them)`), true, result.stdout);
    assert.equal(ok(["branch", "--show-current"], staged.project).trim(), "main");
    assert.equal(ok(["status", "--porcelain"], staged.project), "");
    assert.equal(ok(["log", "-1", "--format=%s", "devos/remove"], staged.project).trim(), "DEV_OS remove (engine 1.10.0)");
    const left = ok(["ls-tree", "-r", "--name-only", "devos/remove"], staged.project).split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(left, [
      ".cursor/rules/10-security-data.mdc",
      ".cursor/rules/30-vocabulary.mdc",
      ".gitattributes",
      ".gitignore",
      "devos/answers.json",
      "devos/prices.json",
      "devos/project.json",
      "devos/prompts/doctor.md",
      "docs/PHASES.md",
      "docs/fences/T01.md",
      ...lock.files.filter((file) => file.path.startsWith("docs/method/")).map((file) => file.path),
    ].sort());
    assert.equal(names(staged.project, "main..devos/remove").includes("devos.config.json"), true);
    assert.equal(readFileSync(staged.log, "utf8"), "");
    writeFileSync(path.join(staged.project, "note.txt"), "x\n");
    const dirty = devos(staged, ["--local"], "yes\n");
    assert.equal(dirty.status, 1);
    assert.equal(dirty.stdout.includes("devos: the working tree is not clean; commit or stash first"), true, dirty.stdout);
    rmSync(path.join(staged.project, "note.txt"));
    const again = devos(staged, ["--local"], "yes\n");
    assert.equal(again.status, 1);
    assert.equal(again.stdout.includes("devos: branch devos/remove already exists. If its pull request is merged, pull, delete the branch (git branch -D devos/remove) and run devos remove again; if not, merge or delete it first"), true, again.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("remove.test.mjs (c) devos remove pushes devos/remove, opens its pull request and pauses the cycle", () => {
  const staged = stage({ origin: true });
  try {
    const result = devos(staged, [], "yes\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes(`It commits this on a new branch devos/remove, opens a pull request on ${SLUG}, and pauses the cycle (DEVOS_PAUSED true) so it starts no new task.`), true, result.stdout);
    assert.equal(result.stdout.includes("devos: pull request opened; the cycle is paused. After you merge it, run devos remove again: it deletes DEV_OS's settings on GitHub after you type yes."), true, result.stdout);
    assert.equal(ok(["ls-remote", "--heads", "origin", "devos/remove"], staged.project).includes("refs/heads/devos/remove"), true);
    const calls = readFileSync(staged.log, "utf8").split(/\r?\n/).filter(Boolean);
    assert.equal(calls.length, 2, calls.join("\n"));
    assert.equal(calls[0].startsWith("pr create --base main --head devos/remove --title Remove DEV_OS --body-file "), true, calls[0]);
    assert.equal(calls[1], `variable set DEVOS_PAUSED --body true --repo ${SLUG}`);
    const body = readFileSync(path.join(staged.project, ".git", "devos-remove-body.md"), "utf8");
    for (const needle of ["Remove DEV_OS (engine 1.10.0)", "- scripts/devos/run-checks.mjs", "- devos/engine.lock.json", "- devos.config.json", "- docs/method/PRECEDENTS.md — your fences and reviews cite it", "run `devos remove` again"]) {
      assert.equal(body.includes(needle), true, needle);
    }
  } finally {
    cleanup(staged.parent);
  }
});

test("remove.test.mjs (d) after the merge, devos remove deletes DEV_OS's settings on GitHub only after a typed yes, and asks apart for the services' keys", () => {
  const settings = {
    secrets: ["CURSOR_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "DEVOS_PAT", "VERCEL_TOKEN", "STRIPE_SECRET_KEY"],
    variables: ["DEVOS_PAUSED", "DEVOS_REPORTING", "DEVOS_STATE", "APP_REGION"],
    labels: ["devos:intake", "devos:needs-you", "bug"],
  };
  const staged = stage({ origin: true, settings });
  try {
    const removed = devos(staged, ["--local"], "yes\n");
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    ok(["merge", "-q", "--ff-only", "devos/remove"], staged.project);
    ok(["branch", "-q", "-D", "devos/remove"], staged.project);
    const kept = devos(staged, [], "no\n");
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
    for (const line of [
      "devos remove: DEV_OS is not installed in",
      `On GitHub (${SLUG}), DEV_OS left:`,
      "- secrets: CLAUDE_CODE_OAUTH_TOKEN, CURSOR_API_KEY, DEVOS_PAT",
      "- variables: DEVOS_PAUSED, DEVOS_REPORTING, DEVOS_STATE (DEVOS_REPORTING and DEVOS_STATE: the Control Tower link; deleting them ends it)",
      "- labels: devos:intake, devos:needs-you (removed from issues and pull requests too)",
      `kept DEV_OS's settings on ${SLUG}`,
      `Keys of your services that DEV_OS set up on ${SLUG}: VERCEL_TOKEN. Your product may still use them.`,
      "kept your services' keys",
    ]) assert.equal(kept.stdout.includes(line), true, `${line}\n${kept.stdout}`);
    assert.equal(readFileSync(staged.log, "utf8").includes("delete"), false);
    const deleted = devos(staged, [], "yes\nno\n");
    assert.equal(deleted.status, 0, deleted.stdout + deleted.stderr);
    const state = JSON.parse(readFileSync(staged.state, "utf8"));
    assert.deepEqual(state, { secrets: ["VERCEL_TOKEN", "STRIPE_SECRET_KEY"], variables: ["APP_REGION"], labels: ["bug"] });
    const deletes = readFileSync(staged.log, "utf8").split(/\r?\n/).filter((line) => line.includes(" delete "));
    assert.deepEqual(deletes, [
      `secret delete CLAUDE_CODE_OAUTH_TOKEN --repo ${SLUG}`,
      `secret delete CURSOR_API_KEY --repo ${SLUG}`,
      `secret delete DEVOS_PAT --repo ${SLUG}`,
      `variable delete DEVOS_PAUSED --repo ${SLUG}`,
      `variable delete DEVOS_REPORTING --repo ${SLUG}`,
      `variable delete DEVOS_STATE --repo ${SLUG}`,
      `label delete devos:intake --repo ${SLUG} --yes`,
      `label delete devos:needs-you --repo ${SLUG} --yes`,
    ]);
    const services = devos(staged, [], "yes\n");
    assert.equal(services.status, 0, services.stdout + services.stderr);
    assert.equal(services.stdout.includes("deleted secret VERCEL_TOKEN"), true, services.stdout);
    assert.deepEqual(JSON.parse(readFileSync(staged.state, "utf8")).secrets, ["STRIPE_SECRET_KEY"]);
    const clean = devos(staged, [], "");
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.equal(clean.stdout.includes(`devos remove: nothing of DEV_OS is left here or on ${SLUG}`), true, clean.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("remove.test.mjs (e) an adoption that was never merged: its branch devos/adopt goes on this computer after yes, and on GitHub after a typed yes", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-remove-adopt-"));
  const project = path.join(parent, "project");
  const tree = path.join(parent, "tree");
  const stubs = path.join(parent, "bin");
  try {
    mkdirSync(project);
    mkdirSync(stubs);
    initRepo(project);
    writeFileSync(path.join(project, "README.md"), "# Demo\n");
    commitAll(project, "start");
    const bare = path.join(parent, "origin.git");
    ok(["init", "-q", "--bare", "-b", "main", bare], parent);
    ok(["remote", "add", "origin", `https://github.com/${SLUG}.git`], project);
    ok(["config", `url.${pathToFileURL(bare).href}.insteadOf`, `https://github.com/${SLUG}.git`], project);
    ok(["push", "-q", "-u", "origin", "main"], project);
    ok(["worktree", "add", "-q", "-b", "devos/adopt", tree, "HEAD"], project);
    writeFileSync(path.join(tree, "devos.txt"), "DEV_OS\n");
    ok(["add", "-A"], tree);
    ok(["commit", "-q", "-m", "DEV_OS adopt: Demo (engine 1.7.0)"], tree);
    ok(["push", "-q", "origin", "devos/adopt"], tree);
    writeGh(stubs);
    const log = path.join(parent, "gh-log.txt");
    const state = path.join(parent, "gh-state.json");
    writeFileSync(log, "");
    writeFileSync(state, JSON.stringify({ secrets: [], variables: [], labels: [] }));
    const env = { ...process.env, PATH: `${stubs}${path.delimiter}${process.env.PATH}`, DEVOS_GH_LOG: log, DEVOS_GH_STATE: state, GIT_TERMINAL_PROMPT: "0" };
    const run = (input) => spawnSync(process.execPath, [bin, "remove", project], { cwd: parent, encoding: "utf8", windowsHide: true, timeout: 180000, env, input });
    const kept = run("no\nno\n");
    assert.equal(kept.status, 0, kept.stdout + kept.stderr);
    assert.match(kept.stdout, /On this computer: the branch devos\/adopt \([0-9a-f]+ DEV_OS adopt: Demo \(engine 1\.7\.0\)\), from an adoption that was never merged/);
    assert.equal(kept.stdout.includes("- the branch devos/adopt (its pull request closes with it)"), true, kept.stdout);
    assert.equal(git(["rev-parse", "--verify", "--quiet", "refs/heads/devos/adopt"], project).status, 0);
    const result = run("yes\nyes\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("deleted the branch devos/adopt on this computer"), true, result.stdout);
    assert.equal(result.stdout.includes("deleted the branch devos/adopt on GitHub"), true, result.stdout);
    assert.equal(git(["rev-parse", "--verify", "--quiet", "refs/heads/devos/adopt"], project).status, 1);
    assert.equal(existsSync(tree), false);
    assert.equal(ok(["ls-remote", "--heads", "origin", "devos/adopt"], project), "");
    assert.equal(ok(["ls-remote", "--heads", "origin", "main"], project).includes("refs/heads/main"), true);
  } finally {
    cleanup(parent);
  }
});

test("remove.test.mjs (f) devos help, the README and the changelog name devos remove", () => {
  const help = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8", windowsHide: true });
  assert.equal(help.status, 0);
  assert.equal(help.stdout.includes("devos upgrade [--local]\ndevos remove [folder] [--local]\n"), true, help.stdout);
  const usage = spawnSync(process.execPath, [bin, "remove", "--nope"], { encoding: "utf8", windowsHide: true });
  assert.deepEqual([usage.status, usage.stdout], [2, "devos remove [folder] [--local]\n"]);
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(readme.includes("| `devos remove [folder] [--local]` |"), true);
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  assert.equal(changelog.includes("**`devos remove`**"), true);
});
