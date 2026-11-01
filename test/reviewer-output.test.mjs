import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { looksLikeLimit, LIMIT_TAIL } from "../payload/files/scripts/devos/limits.mjs";
import { reviewPlan } from "../payload/files/scripts/devos/review-mode.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

// PR-54, the owner's run of 2026-10-24: Cursor reviewed T01, wrote VERDICT: PASS and exited 0, but the runner read its
// stream-json as one JSON object and found "usage limit" in the files the reviewer had read, so it parked a passed task.
const stream = (events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const readEvent = { type: "tool_call", subtype: "completed", tool_call: { readToolCall: { result: { success: { content: "devos_limited() { … usage or rate limit … }\n# quota, billing, capacity, 429" } } } } };
const resultEvent = { type: "result", subtype: "success", is_error: false, duration_ms: 1440000, result: "The review is written.", usage: { inputTokens: 2693, outputTokens: 1179, cacheReadTokens: 382720, cacheWriteTokens: 0 } };

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-verdict-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "reviews"), { recursive: true });
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  writeFileSync(path.join(dir, ".devos", "ci-results.json"), JSON.stringify({ has_package_json: true, failed_required: [], all_required_passed: true }));
  writeFileSync(path.join(dir, "docs", "reviews", "T01-a1.md"), "VERDICT: PASS\nLedger: D1 — PASS — `node --test` printed fail 0\nClassification of non-PASS items: NONE\nNext prompt: none\n");
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"]]) {
    const git = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(git.status, 0, git.stderr);
  }
  return dir;
}

function verdict(dir) {
  const run = spawnSync(process.execPath, ["scripts/devos/verdict.mjs", "--task", "T01", "--attempt", "1"], { cwd: dir, encoding: "utf8", windowsHide: true });
  const fields = Object.fromEntries(run.stdout.split("\n").map((line) => /^([a-z_]+)=(.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]));
  return { run, fields, summary: readFileSync(path.join(dir, ".devos", "verdict-summary.md"), "utf8") };
}

test("reviewer-output.test.mjs (a) a Cursor review that finished keeps its PASS, whatever words its transcript holds", () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, ".devos", "reviewer.json"), stream([{ type: "system", subtype: "init" }, readEvent, resultEvent]));
    writeFileSync(path.join(dir, ".devos", "reviewer.err"), "");
    writeFileSync(path.join(dir, ".devos", "reviewer-run.env"), 'code=0\nused=1\naccounts="1"\ntool=cursor\n');
    const { run, fields, summary } = verdict(dir);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fields.verdict, "PASS", summary);
    assert.equal(fields.action, "merge", summary);
    assert.match(summary, /the verdict was read from the complete review file \(PR-21\): cursor gives no structured answer/);
    assert.match(summary, /Review run: 24 min, \? turns, 385k tokens read \(383k from cache\), 1k written\./);
    assert.equal(/Claude/.test(summary), false, summary);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reviewer-output.test.mjs (b) a Cursor review stopped by its limit parks, naming Cursor", () => {
  const dir = project();
  try {
    rmSync(path.join(dir, "docs", "reviews", "T01-a1.md"));
    writeFileSync(path.join(dir, ".devos", "reviewer.json"), stream([{ type: "system", subtype: "init" }, readEvent]));
    writeFileSync(path.join(dir, ".devos", "reviewer.err"), "You've hit your usage limit. Try again in 2 hours.\n");
    writeFileSync(path.join(dir, ".devos", "reviewer-run.env"), 'code=1\nused=1\naccounts="1"\ntool=cursor\n');
    const { run, fields, summary } = verdict(dir);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fields.verdict, "WAIT", summary);
    assert.equal(fields.action, "quota_wait", summary);
    assert.match(summary, /the reviewer \(cursor\) stopped on a usage or rate limit/);
    assert.match(summary, /The reviewer agent \(cursor\) is out of usage on every account it has/);
    assert.equal(/Claude/.test(summary), false, summary);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reviewer-output.test.mjs (c) only the end of a run's output is read for a limit", () => {
  const early = `quota ${"x".repeat(LIMIT_TAIL)}`;
  assert.equal(looksLikeLimit(early), false);
  assert.equal(looksLikeLimit(`${early}\nYou've hit your usage limit`), true);
  assert.equal(looksLikeLimit("", "Claude AI usage limit reached|1760112000"), true);
});

// PR-72 (E37): a project in production names the paths whose change stops at the human gate.
function gated(dir, { origin = true, base = {}, change = {}, move = [], remove = [] } = {}) {
  const git = (args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  const file = path.join(dir, "devos", "project.json");
  const project = JSON.parse(readFileSync(file, "utf8"));
  project.reviewer = { ...(project.reviewer ?? {}), human_gate_paths_extra: ["src/billing/**", "vercel.json"] };
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(written.status, 0, written.stderr);
  const put = (files) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), text);
    }
  };
  put(base);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "production paths"]);
  if (origin) {
    // Inside .git, so it goes with the project and never shows in its status.
    const bare = path.join(dir, ".git", "devos-origin.git");
    git(["init", "-q", "--bare", bare]);
    git(["remote", "add", "origin", bare]);
    git(["push", "-q", "origin", "main"]);
  }
  git(["switch", "-q", "-c", "task/T01"]);
  put(change);
  for (const [from, to] of move) {
    mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    git(["mv", from, to]);
  }
  for (const name of remove) git(["rm", "-q", name]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "T01 a1: builder"]);
  writeFileSync(path.join(dir, ".devos", "reviewer.json"), stream([{ type: "system", subtype: "init" }, resultEvent]));
  writeFileSync(path.join(dir, ".devos", "reviewer.err"), "");
  writeFileSync(path.join(dir, ".devos", "reviewer-run.env"), 'code=0\nused=1\naccounts="1"\ntool=cursor\n');
  return verdict(dir);
}

test("reviewer-output.test.mjs (d) a PASS that changes a production path stops at the human gate, and one that does not still merges (PR-72)", () => {
  for (const [what, options, action, said] of [
    ["a billing file and vercel.json", { change: { "src/billing/plan.ts": "export const plan = 1;\n", "vercel.json": "{}\n" } }, "human_gate",
      "**Human attention:** Production paths (PR-72): review the PR and every change to `src/billing/plan.ts`, `vercel.json` and merge it to sign off. Merging restarts the cycle."],
    // git would list a rename by its new path only, and quote a name it finds unusual: both are read as they are.
    ["a billing file moved out", { base: { "src/billing/plan.ts": "export const plan = 1;\n" }, move: [["src/billing/plan.ts", "src/misc/plan.ts"]] }, "human_gate",
      "every change to `src/billing/plan.ts` and merge it"],
    ["a billing file deleted", { base: { "src/billing/plan.ts": "export const plan = 1;\n" }, remove: ["src/billing/plan.ts"] }, "human_gate",
      "every change to `src/billing/plan.ts` and merge it"],
    ["a billing file with an accent", { change: { "src/billing/r\u00e9sum\u00e9.ts": "export const r = 1;\n" } }, "human_gate",
      "every change to `src/billing/r\u00e9sum\u00e9.ts` and merge it"],
    ["another file", { change: { "src/lib/other.ts": "export const other = 1;\n" } }, "merge", null],
    ["no base to diff against", { origin: false, change: { "src/lib/other.ts": "export const other = 1;\n" } }, "human_gate",
      "production paths changed (PR-72): (could not diff against the base branch)"],
  ]) {
    const dir = project();
    try {
      const { run, fields, summary } = gated(dir, options);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(fields.verdict, "PASS", `${what}: ${summary}`);
      assert.equal(fields.action, action, `${what}: ${summary}`);
      if (said) assert.equal(summary.includes(said), true, `${what}: ${summary}`);
      else assert.equal(/PR-72/.test(summary), false, `${what}: ${summary}`);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

test("reviewer-output.test.mjs (e) a production path makes the review deep (PR-72)", () => {
  const cfg = { reviewer: { deep_paths: ["supabase/migrations/**"], human_gate_paths: ["src/billing/**"], modes: { light: { model: "s", effort: "medium" }, deep: { model: "o", effort: "high" } } } };
  const row = { task: "T05", risk: 2, gate: "—" };
  assert.equal(reviewPlan(row, ["src/app/page.tsx"], 1, cfg).mode, "light");
  const plan = reviewPlan(row, ["src/billing/plan.ts", "src/app/page.tsx"], 1, cfg);
  assert.equal(plan.mode, "deep");
  assert.deepEqual(plan.critical, ["src/billing/plan.ts"]);
});
