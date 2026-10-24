import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { costOf, makeRecord, parseUsage, summary, toolOf } from "../payload/files/scripts/devos/usage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipWindows = process.platform === "win32";
const LOCAL = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", HOME: process.env.HOME ?? "" };

const CLAUDE = JSON.stringify({
  type: "result", subtype: "success", is_error: false, duration_ms: 61000, result: "ok", total_cost_usd: 0.4321,
  usage: { input_tokens: 10, output_tokens: 2000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 3000 },
  modelUsage: {
    "claude-opus-5-5": { inputTokens: 10, outputTokens: 2000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 3000, costUSD: 0.42 },
    "claude-haiku-5-5": { inputTokens: 500, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0121 },
  },
});
const CURSOR = [
  { type: "system", subtype: "init", session_id: "s" },
  { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { readToolCall: { args: { path: "a" } } } },
  { type: "result", subtype: "success", duration_ms: 120000, is_error: false, result: "done", session_id: "s", usage: { inputTokens: 4000, outputTokens: 900, cacheReadTokens: 120000, cacheWriteTokens: 0 } },
].map((event) => JSON.stringify(event)).join("\n");
const CODEX = [
  { type: "thread.started" },
  { type: "turn.completed", usage: { input_tokens: 30000, cached_input_tokens: 20000, output_tokens: 1500 } },
  { type: "turn.completed", usage: { input_tokens: 10000, cached_input_tokens: 5000, output_tokens: 500 } },
].map((event) => JSON.stringify(event)).join("\n");
const GEMINI = JSON.stringify({ response: "ok", stats: { models: { "gemini-3-pro": { tokens: { prompt: 9000, candidates: 700, total: 9900, cached: 4000, thoughts: 200, tool: 0 } } } } });

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-usage-"));
  const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true });
  assert.equal(staged.status, 0, staged.stderr);
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  return dir;
}

function usage(dir, args, env = {}) {
  return spawnSync(process.execPath, ["scripts/devos/usage.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...LOCAL, ...env } });
}

function lines(file) {
  return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function git(args, cwd) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(" ")}\n${run.stdout}${run.stderr}`);
  return run.stdout;
}

const brief = (item) => [item.stage, item.task, item.attempt, item.tool, item.model, item.input, item.output, item.cache_read, item.cache_write, item.cost_usd, item.reported];

test("usage.test.mjs (a) each tool's output gives its tokens, and only Claude Code a cost", () => {
  assert.deepEqual(parseUsage("claude", CLAUDE), { input: 510, output: 2020, cache_read: 50000, cache_write: 3000, cost_usd: 0.4321, seconds: 61 });
  const plain = JSON.stringify({ type: "result", total_cost_usd: 0.01, usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 9, cache_creation_input_tokens: 10 } });
  assert.deepEqual(parseUsage("claude", plain), { input: 7, output: 8, cache_read: 9, cache_write: 10, cost_usd: 0.01, seconds: null });
  assert.deepEqual(parseUsage("cursor", CURSOR), { input: 4000, output: 900, cache_read: 120000, cache_write: 0, cost_usd: null, seconds: 120 });
  const older = JSON.stringify({ type: "result", result: "done", inputTokens: 11, outputTokens: 12 });
  assert.deepEqual(parseUsage("cursor", older), { input: 11, output: 12, cache_read: null, cache_write: null, cost_usd: null, seconds: null });
  assert.deepEqual(parseUsage("codex", CODEX), { input: 15000, output: 2000, cache_read: 25000, cache_write: 0, cost_usd: null, seconds: null });
  assert.deepEqual(parseUsage("gemini", GEMINI), { input: 5000, output: 900, cache_read: 4000, cache_write: 0, cost_usd: null, seconds: null });
  const none = { input: null, output: null, cache_read: null, cache_write: null, cost_usd: null, seconds: null };
  for (const tool of ["claude", "cursor", "codex", "gemini", "muse"]) assert.deepEqual(parseUsage(tool, "Error: command failed unexpectedly.\n"), none, tool);
  assert.deepEqual(parseUsage("cursor", JSON.stringify({ type: "result", result: "done" })), none);
  assert.deepEqual(["agent", "cursor-agent", "/usr/bin/claude", "codex.cmd", "gemini", "glm"].map(toolOf), ["cursor", "cursor", "claude", "codex", "gemini", "glm"]);
});

test("usage.test.mjs (b) record adds a line, flush moves the lines to the task's file, and nothing fails the run", () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, ".devos", "builder.json"), CURSOR);
    writeFileSync(path.join(dir, ".devos", "reviewer.json"), CLAUDE);
    const env = { TASK: "T03", ATTEMPT: "2", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "77", GITHUB_RUN_ATTEMPT: "1" };
    const built = usage(dir, ["record", "--stage", "builder", "--command", "agent", "--model", "grok-4.7", "--out", ".devos/builder.json", "--code", "0", "--seconds", "130"], env);
    assert.equal(built.status, 0, built.stderr);
    assert.equal(built.stdout, "usage: builder cursor grok-4.7 · in 4,000 · out 900 · cache 120,000/0\n");
    const reviewed = usage(dir, ["record", "--stage", "reviewer", "--command", "claude", "--model", "claude-opus-5-5", "--out", ".devos/reviewer.json", "--code", "0"], env);
    assert.equal(reviewed.stdout, "usage: reviewer claude claude-opus-5-5 · in 510 · out 2,020 · cache 50,000/3,000 · $0.4321\n");
    const missing = usage(dir, ["record", "--stage", "builder", "--command", "agent", "--model", "grok-4.7", "--out", ".devos/none.json", "--code", "1"], env);
    assert.equal(missing.status, 0);
    assert.equal(missing.stdout, "usage: builder cursor grok-4.7 · not reported\n");
    const wrong = usage(dir, ["record", "--stage", "lunch", "--command", "agent", "--out", ".devos/builder.json"], env);
    assert.equal(wrong.status, 0);
    assert.equal(wrong.stdout, "usage: --stage must be one of blueprint, intake, revise, builder, reviewer, doctor, supervisor; nothing recorded\n");
    const pending = lines(path.join(dir, ".devos", "usage", "pending.jsonl"));
    assert.deepEqual(pending.map(brief), [
      ["builder", "T03", 2, "cursor", "grok-4.7", 4000, 900, 120000, 0, null, true],
      ["reviewer", "T03", 2, "claude", "claude-opus-5-5", 510, 2020, 50000, 3000, 0.4321, true],
      ["builder", "T03", 2, "cursor", "grok-4.7", null, null, null, null, null, false],
    ]);
    assert.deepEqual(pending.map((item) => [item.seconds, item.exit, item.run]), [
      [120, 0, "https://github.com/o/r/actions/runs/77"],
      [61, 0, "https://github.com/o/r/actions/runs/77"],
      [null, 1, "https://github.com/o/r/actions/runs/77"],
    ]);
    assert.equal(pending.every((item) => item.v === 1 && item.id.startsWith("77.1.")), true);
    const flushed = usage(dir, ["flush", "--task", "T03"], env);
    assert.equal(flushed.stdout, "usage: 3 run(s) recorded in docs/usage/T03.jsonl\n");
    assert.equal(existsSync(path.join(dir, ".devos", "usage", "pending.jsonl")), false);
    assert.deepEqual(lines(path.join(dir, "docs", "usage", "T03.jsonl")).map(brief), pending.map(brief));
    assert.equal(usage(dir, ["flush", "--task", "T03"], env).stdout, "usage: no new run to record\n");
    assert.equal(usage(dir, ["flush", "--task", "../x"], env).stdout, "usage: --task must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/; nothing moved\n");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("usage.test.mjs (c) the totals price each run from the tool's cost or devos/prices.json", () => {
  const usageOf = (input, output, cache_read, cache_write, cost_usd = null) => ({ input, output, cache_read, cache_write, cost_usd, seconds: 60 });
  const env = { GITHUB_RUN_ID: "5" };
  const runs = [
    makeRecord({ stage: "blueprint", tool: "claude", model: "claude-opus-5-5", task: "blueprint", attempt: 1, code: 0, usage: usageOf(1000, 2000, 0, 0, 1.5), env: {}, at: "2026-10-24T10:00:00.000Z" }),
    makeRecord({ stage: "builder", tool: "cursor", model: "grok-4.7", task: "T01", attempt: 1, code: 0, usage: usageOf(4000, 900, 120000, 0), env, at: "2026-10-24T11:00:00.000Z" }),
    makeRecord({ stage: "builder", tool: "codex", model: "gpt-5.5", task: "T01", attempt: 1, code: 0, usage: usageOf(15000, 2000, 25000, 0), env, at: "2026-10-24T11:30:00.000Z" }),
    makeRecord({ stage: "reviewer", tool: "cursor", model: "grok-4.7", task: "T01", attempt: 1, code: 1, usage: usageOf(null, null, null, null), env, at: "2026-10-24T12:00:00.000Z" }),
  ];
  const prices = { "grok-4.7": { input: 3, output: 15, cache_read: 0.75, cache_write: 3.75 } };
  assert.equal(costOf(runs[0], prices), 1.5);
  assert.equal(Math.round(costOf(runs[1], prices) * 1e6), 115500);
  assert.equal(costOf(runs[2], prices), null);
  assert.equal(costOf(runs[3], prices), null);
  const text = summary(runs, prices);
  for (const line of [
    "Runs: 4 · Not reported: 1 · Last run: 2026-10-24T12:00:00.000Z",
    "| 4 | 20,000 | 4,900 | 145,000 | 0 | $1.62 (1 without a price) |",
    "| claude | claude-opus-5-5 | 1 | 1,000 | 2,000 | 0 | 0 | $1.50 |",
    "| cursor | grok-4.7 | 2 | 4,000 | 900 | 120,000 | 0 | $0.12 |",
    "| codex | gpt-5.5 | 1 | 15,000 | 2,000 | 25,000 | 0 | — |",
    "| blueprint | 1 | 1,000 | 2,000 | 0 | 0 | $1.50 |",
    "| builder | 2 | 19,000 | 2,900 | 145,000 | 0 | $0.12 (1 without a price) |",
    "| reviewer | 1 | 0 | 0 | 0 | 0 | — |",
    "| T01 | 3 | 19,000 | 2,900 | 145,000 | 0 | $0.12 (1 without a price) |",
  ]) {
    assert.equal(text.includes(line), true, `${line}\n${text}`);
  }
  assert.equal(summary(runs, null).includes(" · No `devos/prices.json` yet"), true);
});

test("usage.test.mjs (d) report counts every file once and writes docs/USAGE.md", () => {
  const dir = project();
  try {
    const record = makeRecord({ stage: "builder", tool: "cursor", model: "grok-4.7", task: "T01", attempt: 1, code: 0, usage: { input: 10, output: 20, cache_read: 0, cache_write: 0, cost_usd: null, seconds: 5 }, env: { GITHUB_RUN_ID: "9" }, at: "2026-10-24T09:00:00.000Z" });
    mkdirSync(path.join(dir, "docs", "usage"), { recursive: true });
    // The same run in two files (a union merge can repeat a line): it counts once.
    writeFileSync(path.join(dir, "docs", "usage", "T01.jsonl"), `${JSON.stringify(record)}\nnot json\n`);
    writeFileSync(path.join(dir, "docs", "usage", "T02.jsonl"), `${JSON.stringify(record)}\n`);
    writeFileSync(path.join(dir, "devos", "prices.json"), JSON.stringify({ models: { "grok-4.7": { input: 1000, output: 1000 } } }));
    const shown = usage(dir, ["report"]);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(shown.stdout.includes("| cursor | grok-4.7 | 1 | 10 | 20 | 0 | 0 | $0.03 |"), true, shown.stdout);
    assert.equal(existsSync(path.join(dir, "docs", "USAGE.md")), false);
    assert.equal(usage(dir, ["report", "--write"]).stdout, "usage: docs/USAGE.md written\n");
    assert.equal(readFileSync(path.join(dir, "docs", "USAGE.md"), "utf8"), shown.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("usage.test.mjs (e) the watchdog records every builder run, and run-agent every reviewer run", { skip: skipWindows }, () => {
  const dir = project();
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "agent"), `#!/bin/sh\ncat <<'EOF'\n${CURSOR}\nEOF\n`, { mode: 0o755 });
    writeFileSync(path.join(bin, "codex"), `#!/bin/sh\ncat <<'EOF'\n${CODEX}\nEOF\n`, { mode: 0o755 });
    // A stream kept from an earlier run of another tool never stands for this one.
    writeFileSync(path.join(dir, ".devos", "builder.json.stream.jsonl"), `${CODEX}\n`);
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, TASK: "T04", ATTEMPT: "1", DEVOS_WATCHDOG_TICK: "1", DEVOS_USAGE_STAGE: "builder" };
    for (const name of ["GITHUB_RUN_ID", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_STEP_SUMMARY"]) delete env[name];
    const watched = spawnSync("bash", ["scripts/devos/agent-watchdog.sh", "5", "5", ".devos/builder.json", ".devos/builder.err", "--", "agent", "-p", "--force", "--model", "grok-4.7", "--output-format", "stream-json", "build"], { cwd: dir, encoding: "utf8", windowsHide: true, env });
    assert.equal(watched.status, 0, watched.stdout + watched.stderr);
    assert.equal(watched.stdout.includes("usage: builder cursor grok-4.7 · in 4,000 · out 900 · cache 120,000/0"), true, watched.stdout);
    delete env.DEVOS_USAGE_STAGE;
    const quiet = spawnSync("bash", ["scripts/devos/agent-watchdog.sh", "5", "5", ".devos/builder.json", ".devos/builder.err", "--", "agent", "-p", "--model", "grok-4.7", "build"], { cwd: dir, encoding: "utf8", windowsHide: true, env });
    assert.equal(quiet.status, 0, quiet.stderr);
    writeFileSync(path.join(dir, ".devos", "reviewer-prompt.md"), "review\n");
    // The reviewer's kit for Codex is the project's own CLAUDE.md (PR-45), restored from git afterwards.
    writeFileSync(path.join(dir, "CLAUDE.md"), "project reviewer rules\n");
    git(["init", "-q", "-b", "main"], dir);
    git(["config", "user.email", "devos@example.com"], dir);
    git(["config", "user.name", "devos"], dir);
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "init"], dir);
    const reviewed = spawnSync("bash", ["scripts/devos/run-agent.sh", "reviewer", "codex", "gpt-5.5", "high", ".devos/reviewer-prompt.md"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...env, CODEX_KEY_1: "present" } });
    assert.equal(reviewed.status, 0, reviewed.stdout + reviewed.stderr);
    assert.deepEqual(lines(path.join(dir, ".devos", "usage", "pending.jsonl")).map(brief), [
      ["builder", "T04", 1, "cursor", "grok-4.7", 4000, 900, 120000, 0, null, true],
      ["reviewer", "T04", 1, "codex", "gpt-5.5", 15000, 2000, 25000, 0, null, true],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("usage.test.mjs (f) sync-main keeps both sides' usage lines and counts the totals again", { skip: skipWindows }, () => {
  const dir = project();
  const remote = mkdtempSync(path.join(tmpdir(), "devos-usage-remote-"));
  try {
    const at = (hour) => `2026-10-24T${String(hour).padStart(2, "0")}:00:00.000Z`;
    const line = (task, hour) => JSON.stringify(makeRecord({ stage: "builder", tool: "cursor", model: "grok-4.7", task, attempt: 1, code: 0, usage: { input: 100, output: 10, cache_read: 0, cache_write: 0, cost_usd: null, seconds: 1 }, env: { GITHUB_RUN_ID: String(hour) }, at: at(hour) }));
    mkdirSync(path.join(dir, "docs", "usage"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "usage", "T01.jsonl"), `${line("T01", 1)}\n`);
    usage(dir, ["report", "--write"]);
    git(["init", "-q", "-b", "main"], dir);
    git(["config", "user.email", "devos@example.com"], dir);
    git(["config", "user.name", "devos"], dir);
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "T01"], dir);
    git(["init", "-q", "--bare", "-b", "main"], remote);
    git(["push", "-q", remote, "main"], dir);
    git(["switch", "-q", "-c", "task/T02"], dir);
    appendFileSync(path.join(dir, "docs", "usage", "T01.jsonl"), `${line("T01", 3)}\n`);
    usage(dir, ["report", "--write"]);
    git(["commit", "-q", "-am", "T02 a1: review"], dir);
    git(["switch", "-q", "main"], dir);
    appendFileSync(path.join(dir, "docs", "usage", "T01.jsonl"), `${line("T01", 2)}\n`);
    usage(dir, ["report", "--write"]);
    git(["commit", "-q", "-am", "M01 merged"], dir);
    git(["push", "-q", remote, "main"], dir);
    git(["switch", "-q", "task/T02"], dir);
    const synced = spawnSync("bash", ["scripts/devos/sync-main.sh", remote], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(synced.status, 0, synced.stdout + synced.stderr);
    assert.equal(synced.stdout.includes("docs/USAGE.md counted again from the merged usage records"), true, synced.stdout);
    assert.equal(git(["status", "--porcelain"], dir), "");
    assert.equal(readFileSync(path.join(dir, "docs", "usage", "T01.jsonl"), "utf8").trim().split("\n").length, 3);
    assert.equal(readFileSync(path.join(dir, "docs", "USAGE.md"), "utf8").includes("Runs: 3 · Not reported: 0"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(remote, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("usage.test.mjs (g) every agent call in the workflows is recorded", () => {
  const read = (rel) => readFileSync(path.join(root, "payload", "files", ...rel.split("/")), "utf8");
  const count = (text, needle) => text.split(needle).length - 1;
  const cycle = read("dot-github/workflows/devos-cycle.yml");
  assert.equal(count(cycle, "DEVOS_USAGE_STAGE: builder"), 1);
  assert.equal(count(cycle, "usage.mjs record --stage reviewer --command agent"), 1);
  assert.equal(count(cycle, "usage.mjs record --stage reviewer --command claude"), 1);
  assert.equal(count(cycle, "node scripts/devos/usage.mjs flush --task \"$TASK\""), 2);
  assert.equal(count(cycle, "node scripts/devos/usage.mjs report --write"), 2);
  assert.equal(count(read("scripts/devos/run-agent.sh"), "usage.mjs record --stage reviewer"), 1);
  for (const [file, stages] of [["devos-intake.yml", ["intake", "revise"]], ["devos-doctor.yml", ["doctor"]], ["devos-supervisor.yml", ["supervisor"]]]) {
    const text = read(`dot-github/workflows/${file}`);
    assert.equal(count(text, "claude -p"), stages.length, file);
    for (const stage of stages) assert.equal(count(text, `usage.mjs record --stage ${stage} `), 1, `${file} ${stage}`);
  }
  assert.equal(count(read("dot-github/workflows/devos-doctor.yml"), "--summary"), 1);
  assert.equal(count(read("dot-github/workflows/devos-supervisor.yml"), "--summary"), 1);
  assert.equal(read("dot-gitattributes").includes("docs/usage/*.jsonl merge=union"), true);
  const deny = JSON.parse(read("devos/engine.defaults.json")).surfaces;
  for (const role of ["builder", "builder_method"]) {
    assert.equal(deny[role].deny.includes("docs/usage/**") && deny[role].deny.includes("docs/USAGE.md"), true, role);
  }
});
