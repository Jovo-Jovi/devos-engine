import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseUsage } from "../payload/files/scripts/devos/usage.mjs";

// E62 (PR-89): the last review follow-ups before the next client project. The Claude Code builder streams its work
// (`stream-json --verbose`) and the watchdog reads it as it reads Cursor's; `devos upgrade`'s fixes are in
// upgrade.test.mjs; the shipped method names no client and cites no other project's SETUP.md sections.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = "payload/files";
const skipWindows = process.platform === "win32";
const read = (rel) => readFileSync(path.join(root, ...rel.split("/")), "utf8").replaceAll("\r\n", "\n");

const init = { type: "system", subtype: "init", session_id: "s", model: "claude-opus-5-5" };
const usage = (input, output, cacheRead, cacheWrite) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });
// One assistant message comes as one event per content block, each with the message's usage: it counts once.
const ran = [
  { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Running the tests." }], usage: usage(100, 10, 5000, 200) } },
  { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test\n--run" } }], usage: usage(100, 10, 5000, 200) } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
];
const reading = { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "src/a.ts" } }], usage: usage(20, 30, 6000, 0) } };
const result = { type: "result", subtype: "success", is_error: false, duration_ms: 9000, result: "done", total_cost_usd: 0.25, usage: usage(120, 40, 11000, 200), modelUsage: { "claude-opus-5-5": { inputTokens: 120, outputTokens: 40, cacheReadInputTokens: 11000, cacheCreationInputTokens: 200, costUSD: 0.25 } } };
const jsonl = (events) => `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-followups-"));
  const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true });
  assert.equal(staged.status, 0, staged.stderr);
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  mkdirSync(path.join(dir, "bin"));
  return dir;
}

function watch(dir, events, exit) {
  writeFileSync(path.join(dir, "stream.jsonl"), jsonl(events));
  writeFileSync(path.join(dir, "bin", "claude"), `#!/bin/sh\ncat "${path.join(dir, "stream.jsonl")}"\nexit ${exit}\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, TASK: "T07", ATTEMPT: "1", DEVOS_WATCHDOG_TICK: "1", DEVOS_USAGE_STAGE: "builder" };
  for (const name of ["GITHUB_RUN_ID", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_STEP_SUMMARY"]) delete env[name];
  return spawnSync("bash", ["scripts/devos/agent-watchdog.sh", "5", "5", ".devos/builder.json", ".devos/builder.err", "--",
    "claude", "-p", "--model", "claude-opus-5-5", "--output-format", "stream-json", "--verbose"], { cwd: dir, encoding: "utf8", windowsHide: true, env });
}

test("followups.test.mjs (a) the watchdog reads a Claude Code builder's stream and keeps its result (PR-89)", { skip: skipWindows }, () => {
  const dir = project();
  try {
    const finished = watch(dir, [init, ...ran, result], 0);
    assert.equal(finished.status, 0, finished.stdout + finished.stderr);
    assert.equal(readFileSync(path.join(dir, ".devos", "builder-last-action"), "utf8"), "finished Bash: pnpm test --run");
    assert.equal(readFileSync(path.join(dir, ".devos", "builder.json"), "utf8"), `${JSON.stringify(result)}\n`);
    assert.equal(readFileSync(path.join(dir, ".devos", "builder.json.stream.jsonl"), "utf8"), jsonl([init, ...ran, result]));
    assert.equal(finished.stdout.includes("usage: builder claude claude-opus-5-5 · in 120 · out 40 · cache 11,000/200"), true, finished.stdout);

    // Stopped before its result: the open tool call is the last action, and the usage is the messages' own.
    const stopped = watch(dir, [init, ...ran, reading], 1);
    assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
    assert.equal(readFileSync(path.join(dir, ".devos", "builder-last-action"), "utf8"), "running Read: src/a.ts");
    assert.equal(readFileSync(path.join(dir, ".devos", "builder.json"), "utf8"), jsonl([init, ...ran, reading]));
    assert.equal(stopped.stdout.includes("usage: builder claude claude-opus-5-5 · in 120 · out 40 · cache 11,000/200"), true, stopped.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("followups.test.mjs (b) a Claude Code stream with no result counts each message once (PR-89)", () => {
  const counted = parseUsage("claude", jsonl([init, ...ran, reading]));
  assert.deepEqual([counted.input, counted.output, counted.cache_read, counted.cache_write], [120, 40, 11000, 200]);
  assert.equal(counted.cost_usd, null);
  const whole = parseUsage("claude", jsonl([init, ...ran, reading, result]));
  assert.deepEqual([whole.input, whole.output, whole.cost_usd], [120, 40, 0.25]);
  assert.deepEqual([parseUsage("claude", jsonl([init])).input, parseUsage("claude", "").input], [null, null]);
});

test("followups.test.mjs (c) the Claude Code builder runs with stream-json --verbose; the other Claude runs keep json", () => {
  const cycle = read(`${PAYLOAD}/dot-github/workflows/devos-cycle.yml`);
  assert.equal(cycle.split("claude -p --model \"$MODEL\" --effort \"$EFFORT\" --output-format stream-json --verbose --permission-mode dontAsk").length - 1, 1);
  assert.equal(cycle.includes("--output-format stream-json --verbose --permission-mode dontAsk --allowedTools \"Read,Glob,Grep,Write,Edit,MultiEdit,Bash,Task,Agent,Skill,mcp__context7\""), true);
  const watchdog = read(`${PAYLOAD}/scripts/devos/agent-watchdog.sh`);
  assert.equal(watchdog.includes("Both streams are read:"), true);
  assert.equal(watchdog.includes("else if (e.type===\"user\"&&Array.isArray(e.message&&e.message.content))"), true);
  const manual = read(`${PAYLOAD}/docs/method/AUTOMATION.md`);
  assert.equal(manual.includes("| `agent-watchdog.sh` | runs the builder's CLI (Cursor's or Claude Code's) in 72-minute time slices"), true);
  assert.equal(manual.includes("Claude Code's with `--verbose` too, one line per message and tool call, so both show their last action, PR-89)"), true);
  assert.equal(manual.includes("Claude Code's stream has no timestamps, so it gets the totals so far in place of the timeline, and its plan from TodoWrite (PR-89)"), true);
});

test("followups.test.mjs (d) the shipped method names no client and cites no other project's SETUP.md (PR-89)", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk(path.join(root, ...PAYLOAD.split("/")))) {
    const text = readFileSync(file, "utf8");
    assert.equal(/\bNEL\b|Nile Egypt|\bBETK\b/i.test(text), false, file);
  }
  const handbook = read(`${PAYLOAD}/docs/method/DEV_OS_V2_REVIEWER.md`);
  assert.equal(handbook.includes("Distilled from a finished client project, called **the reference project** here (a bilingual\n"), true);
  assert.equal(handbook.includes("## 16. What the reference project taught\n"), true);
  assert.equal(handbook.includes("the client's legal obligations (for example, Egypt's Law 151 of 2020)"), true);
  assert.equal(read("tools/find-specifics.mjs").includes("/Jovo-Jovi/, /\\bNEL\\b/, /Nile Egypt/i, /\\bBETK\\b/i];"), true);
  assert.equal(handbook.includes("It supersedes Dev OS v1: v1's mechanics\nstand,"), true);
  // "The reference project" is the handbook's case study only.
  assert.equal(read(`${PAYLOAD}/docs/method/PRECEDENTS.md`).includes("added to the method's own test project to try more backend services (2026-10-13)"), true);
  assert.equal(read(`${PAYLOAD}/dot-github/workflows/devos-intake.yml`).includes("the method's first one took\n    # 26 minutes."), true);
  const pr26 = read(`${PAYLOAD}/docs/method/PRECEDENTS.md`).split("\n").find((line) => line.startsWith("| PR-26 |"));
  assert.equal(pr26.includes("reference project"), false);
  assert.equal(read(`${PAYLOAD}/dot-github/workflows/devos-intake.yml`).includes("reference project"), false);
  const fullstack = read(`${PAYLOAD}/docs/method/FULLSTACK_MODULE.md`);
  assert.equal(fullstack.includes("it is what a new project adopts when it stores data (the fit research of the\nblueprint, `devos/prompts/blueprint.md`)."), true);
  assert.equal(fullstack.includes("step 5"), false);
  const setup = JSON.parse(read(`${PAYLOAD}/devos/setup.json`));
  for (const item of setup.items) for (const step of item.steps) assert.equal(step.includes("§"), false, `${item.id}: ${step}`);
  assert.equal(setup.items.find((item) => item.id === "r2-secrets").steps[1].startsWith("R2 → Manage API tokens → Create API token: Object Read & Write, for this bucket only."), true);
  assert.equal(/SETUP §\d/.test(read(`${PAYLOAD}/docs/method/AUTOMATION.md`)), false);
});

test("followups.test.mjs (e) the retired source check is gone, and the plan follows devos init", () => {
  assert.equal(existsSync(path.join(root, "tools", "verify-source.mjs")), false);
  const plan = read("dev/PLAN.md");
  assert.equal(plan.includes("verify-source"), false);
  assert.equal(plan.indexOf("| 5 | Engine files | DEV_OS |") < plan.indexOf("| 6 | Blueprint | DEV_OS (Claude, reviewer role) |"), true);
  assert.equal(plan.includes("Steps 5 and 6 are in the order `devos init` runs them (amended 2026-11-09, owner, D-E15)."), true);
  const decisions = read("dev/DECISIONS.md");
  for (const id of ["| D-E14 | **The handbook names no client (2026-11-09):**", "| D-E15 | **PLAN §3 follows `devos init` (2026-11-09):**"]) assert.equal(decisions.includes(id), true, id);
});

test("followups.test.mjs (f) PR-89, the live maximum and the changelog", () => {
  const precedents = read(`${PAYLOAD}/docs/method/PRECEDENTS.md`);
  assert.equal(precedents.includes("**Live maximum: PR-89.**"), true);
  assert.equal(precedents.includes("| PR-89 | **A shipped method names no client, and every builder shows its progress.**"), true);
  const changelog = read("CHANGELOG.md");
  const section = changelog.slice(changelog.indexOf("## 1.12.0"), changelog.indexOf("## 1.11.0"));
  for (const line of ["- **A Claude Code builder shows its progress (PR-89).**", "- **`devos upgrade` is safer.**", "- **The handbook names no client.**"]) {
    assert.equal(section.includes(line), true, line);
  }
});

test("followups.test.mjs (g) the builder's report reads Claude Code's stream, and Cursor's as before (PR-89)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-report-"));
  const report = (events) => {
    writeFileSync(path.join(dir, "stream.jsonl"), jsonl(events));
    rmSync(path.join(dir, "state.json"), { force: true });
    const run = spawnSync(process.execPath, [path.join(root, ...PAYLOAD.split("/"), "scripts", "devos", "builder-report.mjs"), "stream.jsonl", "state.json"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  try {
    const plan = { type: "assistant", message: { id: "m0", content: [{ type: "tool_use", id: "t0", name: "TodoWrite", input: { todos: [{ content: "Copy the files", status: "completed" }, { content: "Run the tests", status: "in_progress" }, { content: "Write the report", status: "pending" }] } }] } };
    const edit = { type: "assistant", message: { id: "m3", content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: "/home/runner/work/app/app/src/a.ts" } }] } };
    assert.equal(report([init, plan, ...ran, edit, reading]), [
      "**Plan (the builder's own to-do list): 1 of 3 done**",
      "✅ Copy the files",
      "🔄 Run the tests",
      "⬜ Write the report",
      "",
      "**Latest note:** Running the tests.",
      "",
      "**So far:** 1 read · 0 searches · 1 commands · 1 edits — edited `src/a.ts` — ran `pnpm test --run`",
      "",
    ].join("\n"));
    assert.equal(report([init, ran[0]]), "**Latest note:** Running the tests.\n\n**So far:** 0 read · 0 searches · 0 commands · 0 edits\n");
    const cursor = [
      { type: "system", subtype: "init", timestamp_ms: 1000 },
      { type: "assistant", message: { content: [{ type: "text", text: "Reading the fence." }] }, timestamp_ms: 2000 },
      { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { readToolCall: { args: { path: "a" } } }, timestamp_ms: 3000 },
    ];
    assert.equal(report(cursor), "**Latest note:** Reading the fence.\n\n**Every 10 minutes:**\n- since 00:00 UTC (so far) · 1 read · 0 searches · 0 commands · 0 edits\n");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
