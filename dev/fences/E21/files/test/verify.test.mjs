import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, stage } from "./harness.mjs";
import {
  audit,
  diagnoseRun,
  failedStepLines,
  formatRows,
  projectSteps,
  summary,
  watch,
  watchArgs,
} from "../lib/verify.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// No saved profile: the project's owner comes from the GitHub CLI, as on a new computer.
process.env.DEVOS_HOME = mkdtempSync(path.join(tmpdir(), "devos-verify-home-"));

const GH_OK = () => ({ installed: true, signedIn: true, tokenWorks: true, login: "devtest", scopes: ["repo", "workflow"] });
const MACHINE = { gitFound: () => true, nodeVersion: "22.12.0" };
const URL = "https://github.com/devtest/demo-shop/actions/runs/7";

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-verify-"));
  mkdirSync(path.join(dir, "devos"));
  mkdirSync(path.join(dir, ".claude"));
  writeFileSync(path.join(dir, "devos", "answers.json"), JSON.stringify({ name: "Demo Shop" }));
  writeFileSync(path.join(dir, "devos", "engine.lock.json"), "{}");
  writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
  writeFileSync(path.join(dir, "devos", "setup.json"), JSON.stringify({ items: [{ kind: "secret", blocks: "cycle", names: ["CURSOR_API_KEY"] }] }));
  return dir;
}

/** A fake command runner: the first answer whose key starts the command line wins; every call is recorded. */
function fake(calls, answers) {
  return (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return { status: answer.status ?? 0, stdout: answer.stdout ?? "" };
    }
    return { status: 1, stdout: "" };
  };
}

const out = (stdout) => ({ status: 0, stdout });
const rowOf = (result, label) => result.rows.find((row) => row.label === label);

function githubProject(extra = {}, secrets = '[{"name":"OTHER_KEY"}]') {
  return {
    "git rev-parse HEAD": out("abc\n"),
    "gh api user --jq .login": out("devtest\n"),
    "git remote get-url origin": out("https://github.com/devtest/demo-shop.git\n"),
    "gh repo view devtest/demo-shop --json name": out('{"name":"demo-shop"}'),
    "gh secret list --repo devtest/demo-shop --json name": out(secrets),
    ...extra,
  };
}

test("verify.test.mjs (a) the machine and the GitHub CLI: each problem names its fix", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "devos-verify-empty-"));
  try {
    const base = { folder: empty, exec: () => null, ...MACHINE };
    let result = audit({ ...base, preflight: GH_OK });
    assert.equal(result.ready, true);
    assert.match(formatRows(result), /DEV_OS project: none in .*: machine and GitHub only/);
    assert.equal(summary(result), "Ready: the machine, GitHub, the project and its newest cycle run are green.");

    result = audit({ ...base, nodeVersion: "20.11.0", preflight: GH_OK });
    assert.equal(rowOf(result, "Node.js").state, "block");
    assert.equal(rowOf(result, "Node.js").fix, "Install Node.js 22 or newer from nodejs.org");
    assert.equal(result.ready, false);

    result = audit({ ...base, gitFound: () => false, preflight: GH_OK });
    assert.equal(rowOf(result, "git").fix, "Install git from git-scm.com");

    result = audit({ ...base, preflight: () => ({ installed: false }) });
    assert.equal(rowOf(result, "gh").fix, "Install the GitHub CLI from cli.github.com, then run: gh auth login");
    result = audit({ ...base, preflight: () => ({ installed: true, signedIn: false }) });
    assert.equal(rowOf(result, "gh").fix, "Run: gh auth login");
    result = audit({ ...base, preflight: () => ({ ...GH_OK(), scopes: ["repo"] }) });
    assert.equal(rowOf(result, "gh").fix, "Run: gh auth refresh -h github.com -s workflow");
    assert.equal(summary(result), "Not ready: 1 for you, 0 for devos continue.");
  } finally {
    cleanup(empty);
  }
});

test("verify.test.mjs (b) the project's steps: the first open one has the fix, and keys are named, never set", () => {
  const dir = project();
  try {
    const calls = [];
    const exec = fake(calls, githubProject({ "gh run list": out("[]") }));
    let result = audit({ folder: dir, exec, preflight: GH_OK, ...MACHINE });
    assert.equal(rowOf(result, "repository").detail, "devtest/demo-shop");
    const keys = rowOf(result, "keys");
    assert.equal(keys.state, "block");
    assert.equal(keys.detail, "missing on GitHub: CURSOR_API_KEY");
    assert.equal(keys.who, "you");
    assert.match(keys.fix, /^devos continue .+ asks for each value once, hidden, and gh stores it$/);
    assert.equal(rowOf(result, "first cycle").detail, "after keys");
    assert.equal(rowOf(result, "first cycle").fix, null);
    assert.equal(summary(result), "Not ready: 1 for you, 0 for devos continue.");
    assert.equal(calls.some((line) => line.startsWith("gh secret set")), false);

    // The same steps devos continue prints.
    const lines = projectSteps(dir, exec).steps.map((step) => `${step.ok ? "✓" : "·"} ${step.name} (${step.who})`);
    assert.deepEqual(lines, [
      "✓ answers (devos)",
      "✓ engine files (devos)",
      "✓ blueprint approved (you)",
      "✓ local commit (devos)",
      "✓ repository (devos)",
      "· keys (you)",
      "· first cycle (devos)",
    ]);

    rmSync(path.join(dir, ".claude", "settings.json"));
    result = audit({ folder: dir, exec, preflight: GH_OK, ...MACHINE });
    const blueprint = rowOf(result, "blueprint approved");
    assert.match(blueprint.fix, /checks the documents, has your blueprint agent fix what fails, then asks you to approve$/);
    assert.equal(blueprint.who, "you");
    assert.equal(rowOf(result, "keys").detail, "after blueprint approved");
  } finally {
    cleanup(dir);
  }
});

test("verify.test.mjs (c) a failed run's likely cause, its fix and who applies it", () => {
  const where = { folder: "demo-shop", slug: "devtest/demo-shop" };
  const cases = [
    [{ missingKeys: ["CURSOR_API_KEY"] }, /not on GitHub: CURSOR_API_KEY/, "you", /^devos continue demo-shop asks/],
    [{ text: "the cycle needs settings that are missing (secret.cursor)" }, /settings outside the repository/, "you", /setup needed/],
    [{ text: "Claude AI usage limit reached" }, /usage limit/, "cycle", /^Nothing to do/],
    [{ text: "HttpError: Resource not accessible by integration" }, /may not change the repository/, "you", /Read and write permissions/],
    [{ text: "Cannot use this model: grok-9" }, /does not offer the chosen model/, "you", /devos\/project\.json/],
    [{ text: "Authentication required. Set CURSOR_API_KEY" }, /refused or empty/, "you", /gh secret set CURSOR_API_KEY --repo devtest\/demo-shop/],
    [{ conclusion: "startup_failure" }, /workflow file is invalid/, "you", /devos upgrade/],
    [{ text: "agent: command not found" }, /missing on the runner/, "you", /devos upgrade/],
    [{ text: "The job has exceeded the maximum execution time of 360m0s" }, /ran out of time/, "you", /gh workflow run devos-cycle\.yml --repo devtest\/demo-shop$/],
    [{ conclusion: "cancelled", text: "The run was canceled by @devtest." }, /was cancelled/, "you", /gh workflow run devos-cycle\.yml/],
    [{ text: "something odd" }, /no known cause/, "you", /read its failed step/],
  ];
  for (const [input, cause, who, fix] of cases) {
    const result = diagnoseRun({ ...where, ...input });
    assert.match(result.cause, cause, JSON.stringify(input));
    assert.equal(result.who, who, JSON.stringify(input));
    assert.match(result.fix, fix, JSON.stringify(input));
  }
});

const LOG = [
  "build\tUNKNOWN STEP\t2026-10-26T08:00:00.0000000Z ##[group]Run node scripts/devos/setup-check.mjs --for cycle",
  "build\tUNKNOWN STEP\t2026-10-26T08:00:01.0000000Z MISSING secret.cursor: CURSOR_API_KEY",
  "build\tUNKNOWN STEP\t2026-10-26T08:00:01.1000000Z ##[error]the cycle needs settings that are missing (secret.cursor); nothing was touched.",
  "build\tUNKNOWN STEP\t2026-10-26T08:00:01.2000000Z ##[error]Process completed with exit code 1.",
  "build\tUNKNOWN STEP\t2026-10-26T08:00:02.0000000Z Post job cleanup.",
  "build\tUNKNOWN STEP\t2026-10-26T08:00:02.1000000Z [command]/usr/bin/git config --local --unset-all http.extraheader",
].join("\n");

test("verify.test.mjs (d) the newest cycle run: running, green, or failed in its own words", () => {
  assert.deepEqual(failedStepLines(LOG), [
    "MISSING secret.cursor: CURSOR_API_KEY",
    "error: the cycle needs settings that are missing (secret.cursor); nothing was touched.",
  ]);
  const dir = project();
  const all = '[{"name":"CURSOR_API_KEY"}]';
  try {
    const running = fake([], githubProject({
      "gh run list": out(JSON.stringify([{ databaseId: 7, status: "in_progress", conclusion: "", url: URL }])),
      "gh run view 7 --repo devtest/demo-shop --json jobs": out(JSON.stringify({ jobs: [{ name: "build", status: "in_progress", steps: [
        { name: "Set up job", status: "completed" },
        { name: "Builder (the project's builder agent)", status: "in_progress" },
        { name: "Checks (evidence for the reviewer)", status: "queued" },
      ] }] })),
    }, all));
    let result = audit({ folder: dir, exec: running, preflight: GH_OK, ...MACHINE });
    const live = rowOf(result, "newest devos-cycle run");
    assert.equal(live.state, "wait");
    assert.equal(live.detail, `in_progress · step: Builder (the project's builder agent) (1/3 steps done) · ${URL}`);
    assert.equal(summary(result), "Not ready: 0 for you, 0 for devos continue, 1 running.");

    const green = fake([], githubProject({
      "gh run list": out(JSON.stringify([{ databaseId: 7, status: "completed", conclusion: "success", url: URL }])),
    }, all));
    result = audit({ folder: dir, exec: green, preflight: GH_OK, ...MACHINE });
    assert.equal(rowOf(result, "newest devos-cycle run").detail, `green · ${URL}`);
    assert.equal(result.ready, true);

    const failed = fake([], githubProject({
      "gh run list": out(JSON.stringify([{ databaseId: 7, status: "completed", conclusion: "failure", url: URL }])),
      "gh run view 7 --repo devtest/demo-shop --json jobs": out(JSON.stringify({ jobs: [{ databaseId: 70, name: "build", conclusion: "failure" }] })),
      "gh api repos/devtest/demo-shop/check-runs/70/annotations": out(JSON.stringify([
        { annotation_level: "failure", message: "Process completed with exit code 1." },
        { annotation_level: "warning", message: "Node.js 20 is deprecated." },
        { annotation_level: "failure", message: "the cycle needs settings that are missing (secret.cursor); nothing was touched." },
      ])),
      "gh run view 7 --repo devtest/demo-shop --log-failed": out(LOG),
    }, all));
    result = audit({ folder: dir, exec: failed, preflight: GH_OK, ...MACHINE });
    const stop = rowOf(result, "newest devos-cycle run");
    assert.equal(stop.state, "block");
    assert.equal(stop.detail, `failure in build · ${URL}`);
    assert.deepEqual(stop.said, [
      "the cycle needs settings that are missing (secret.cursor); nothing was touched.",
      "MISSING secret.cursor: CURSOR_API_KEY",
    ]);
    assert.equal(stop.cause, "the cycle needs settings outside the repository");
    assert.equal(stop.who, "you");
    const text = formatRows(result);
    assert.match(text, /said: MISSING secret\.cursor: CURSOR_API_KEY/);
    assert.match(text, /who: you/);
    assert.equal(text.includes("Node.js 20 is deprecated"), false);
  } finally {
    cleanup(dir);
  }
});

test("verify.test.mjs (e) watch repeats the audit, marks what changed, and stops at ALL GREEN", async () => {
  const row = (label, state) => ({ section: "project", label, state, detail: state === "ok" ? "fine" : "open", fix: state === "ok" ? null : "devos continue x", who: state === "ok" ? null : "you" });
  const open = { rows: [row("answers", "ok"), row("keys", "block")], ready: false };
  const done = { rows: [row("answers", "ok"), row("keys", "ok")], ready: true };
  const lines = [];
  let slept = 0;
  const passes = [open, done];
  const outcome = await watch({
    auditFn: () => passes.shift(),
    intervalMs: 5000,
    sleep: async (ms) => {
      assert.equal(ms, 5000);
      slept += 1;
    },
    out: (text) => lines.push(text),
    now: () => new Date("2026-10-26T10:00:00Z"),
  });
  assert.equal(outcome.ready, true);
  assert.equal(outcome.passes, 2);
  assert.equal(slept, 1);
  const text = lines.join("\n");
  assert.match(text, /Not ready: 1 for you, 0 for devos continue\. Next pass in 5 s \(Ctrl-C stops\)\./);
  assert.match(text, /pass 2 · 2026-10-26 10:00:00 · 1 changed/);
  assert.match(text, / \*ok {4}keys: fine/);
  assert.match(text, /ALL GREEN/);

  const once = [];
  const single = await watch({ once: true, auditFn: () => open, sleep: () => assert.fail("no second pass"), out: (text) => once.push(text) });
  assert.equal(single.passes, 1);
  assert.equal(single.ready, false);
  assert.equal(once.at(-1), "Not ready: 1 for you, 0 for devos continue.");

  assert.equal(watchArgs(["--interval", "4"]), null);
  assert.equal(watchArgs(["one", "two"]), null);
  assert.deepEqual(watchArgs(["--interval", "10", "--once", "shop"]), { folder: path.resolve("shop"), intervalMs: 10000, once: true });
});

test("verify.test.mjs (f) devos verify and devos watch from the command line", () => {
  const staged = stage();
  const empty = path.join(staged.parent, "empty");
  mkdirSync(empty);
  try {
    const verify = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "verify", empty], { encoding: "utf8", env: staged.env, windowsHide: true, timeout: 60000 });
    assert.equal(verify.status, 0, verify.stdout + verify.stderr);
    assert.match(verify.stdout, /^MACHINE$/m);
    assert.match(verify.stdout, /ok {4}gh: signed in as devtest \(repo, workflow\)/);
    assert.match(verify.stdout, /DEV_OS project: none in /);
    assert.match(verify.stdout, /^Ready: /m);
    const watched = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "watch", empty], { encoding: "utf8", env: staged.env, windowsHide: true, timeout: 60000 });
    assert.equal(watched.status, 1);
    assert.match(watched.stdout, /devos: no DEV_OS project in .*; start one with devos init/);
  } finally {
    cleanup(staged.parent);
  }
});
