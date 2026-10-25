import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { looksLikeLimit, LIMIT_TAIL } from "../payload/files/scripts/devos/limits.mjs";

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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reviewer-output.test.mjs (c) only the end of a run's output is read for a limit", () => {
  const early = `quota ${"x".repeat(LIMIT_TAIL)}`;
  assert.equal(looksLikeLimit(early), false);
  assert.equal(looksLikeLimit(`${early}\nYou've hit your usage limit`), true);
  assert.equal(looksLikeLimit("", "Claude AI usage limit reached|1760112000"), true);
});
