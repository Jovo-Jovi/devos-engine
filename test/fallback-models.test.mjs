import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fallbacks, MAX_FALLBACKS, validate } from "../payload/files/scripts/devos/agents.mjs";
import { looksLikeLimit, looksUnavailable, modelUnavailable } from "../payload/files/scripts/devos/limits.mjs";

// E26c1 (PR-64, D-E12): several models per role. An agent's fallback_models are tried after its model, each on every
// account of its tool: a usage limit moves to the other account, then to the next model; a model the account cannot use
// is skipped at once; the run waits for the earliest reset only when no slot can run. The tool never changes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const skipWindows = process.platform === "win32";
const workflow = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8");

function withAgents(dir, agents) {
  const file = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  cfg.agents = agents;
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

// An installed project (devos install): the runner scripts and a generated devos.config.json.
function staged(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  return dir;
}

const reviewer = { id: "r", tool: "codex", model: "M1", fallback_models: ["M2", "M3"] };
const builder = { id: "b", tool: "codex", model: "B1", default: true, note: "", fallback_models: ["B2"] };

test("fallback-models.test.mjs (a) an agent may list fallback_models of its own tool, and pick and reviewer give them in order", () => {
  const agents = { reviewer, reviewer_light: { id: "l", tool: "codex", model: "L1" }, pool: [builder], policy: "always-default" };
  assert.equal(validate(agents), agents);
  assert.deepEqual([fallbacks(reviewer), fallbacks(agents.reviewer_light), fallbacks({ model: "M2", fallback_models: ["M2", "M3"] })], [["M2", "M3"], [], ["M3"]]);
  assert.equal(MAX_FALLBACKS, 4);
  const wrong = (label) => `agents: ${label}.fallback_models must be a list of up to 4 model ids, none twice`;
  for (const [list, message] of [
    ["M2", wrong("reviewer")],
    [["M2", "M2"], wrong("reviewer")],
    [["M2", "has space"], wrong("reviewer")],
    [["A", "B", "C", "D", "E"], wrong("reviewer")],
    [[7], wrong("reviewer")],
  ]) {
    assert.throws(() => validate({ ...agents, reviewer: { ...reviewer, fallback_models: list } }), { message });
  }
  assert.throws(() => validate({ ...agents, pool: [{ ...builder, fallback_models: ["B2", "B2"] }] }), { message: wrong("pool item b") });
  assert.throws(() => validate({ ...agents, reviewer: { ...reviewer, extra: 1 } }), { message: "agents: reviewer must have id, tool and model, and may have fallback_models" });
  assert.throws(() => validate({ ...agents, pool: [{ ...builder, extra: 1 }] }), { message: "agents: pool item must have id, tool, model, default and note, and may have fallback_models" });

  const dir = staged("devos-fallback-");
  try {
    withAgents(dir, agents);
    const run = (args, env = {}) => spawnSync(process.execPath, ["scripts/devos/agents.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: "", ...env } });
    assert.match(run(["pick", "--task", "T01"]).stdout, /^builder_model=B1\nbuilder_fallbacks=B2\n/m);
    assert.match(run(["reviewer", "--mode", "deep"]).stdout, /^reviewer_model=M1\nreviewer_fallbacks=M2 M3\n/m);
    assert.match(run(["reviewer", "--mode", "light"]).stdout, /^reviewer_model=L1\nreviewer_fallbacks=\n/m);
    // PR-63: a model variable replaces the first model only, and a fallback it names is not tried twice.
    assert.match(run(["reviewer", "--mode", "deep"], { DEVOS_REVIEWER_MODEL: "M2" }).stdout, /^reviewer_model=M2\nreviewer_fallbacks=M3\n/m);
    assert.match(run(["pool"]).stdout, /^- b — codex · B1 \(then B2\) · default$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (b) the slots: each model on every account, then the next model", { skip: skipWindows }, () => {
  const dir = staged("devos-slots-");
  try {
    const script = [
      "set -eu",
      ". scripts/devos/accounts.sh",
      "unset DEVOS_CURSOR_ACCOUNT DEVOS_CLAUDE_ACCOUNT DEVOS_CODEX_ACCOUNT DEVOS_GEMINI_ACCOUNT DEVOS_ACCOUNT_SWITCH CLAUDE_OAUTH_1 CLAUDE_OAUTH_2 CLAUDE_APIKEY_1 CLAUDE_APIKEY_2 || true",
      "export CURSOR_KEY_1=a CURSOR_KEY_2=b",
      "echo \"two=$(devos_slots cursor m1 m2 m1 '' m3)\"",
      "export DEVOS_CURSOR_ACCOUNT=2",
      "echo \"second=$(devos_slots cursor m1 m2)\"",
      "export DEVOS_ACCOUNT_SWITCH=off",
      "echo \"off=$(devos_slots cursor m1 m2)\"",
      "echo \"none=$(devos_slots claude m1 m2)\"",
      "echo \"file1=$(devos_limit_file claude 2 1) file3=$(devos_limit_file claude 2 3)\"",
      "echo \"index=$(devos_model_index m2 m1 m2 m3) $(devos_model_index zz m1 m2)\"",
      "mkdir -p .devos/limits; echo 'usage limit, resets in 2h' > .devos/limits/claude-1.txt; echo 'model_not_found' > .devos/e.err",
      "devos_settle ran .devos/limits/claude-1.txt .devos/e.err; echo \"ran=$(wc -l < .devos/e.err | tr -d ' ')\"",
      "devos_settle unavailable '' .devos/e.err; echo \"nolimit=$(wc -l < .devos/e.err | tr -d ' ')\"",
      "devos_settle unavailable .devos/limits/claude-1.txt .devos/e.err; echo \"settled=$(tail -n 2 .devos/e.err | head -n 1) | $(tail -n 1 .devos/e.err)\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      "two=m1@1 m1@2 m2@1 m2@2 m3@1 m3@2",
      "second=m1@2 m1@1 m2@2 m2@1",
      "off=m1@2 m2@2",
      "none=",
      "file1=.devos/limits/claude-2.txt file3=.devos/limits/claude-2-m3.txt",
      "index=2 1",
      "ran=1",
      "nolimit=1",
      "settled=usage limit, resets in 2h | devos: no model of this agent could run; an earlier one reached its usage limit (.devos/limits/claude-1.txt)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (c) a model the account cannot use is told apart from a limit, from the end of the output only", () => {
  for (const text of [
    "Cannot use this model: grok-9. Available models: auto, gpt-5",
    "API Error: 404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: claude-opus-9\"}}",
    "The model `gpt-9` does not exist or you do not have access to it.",
    "models/gemini-9-pro is not found for API version v1beta",
    "error: model_not_found",
    "Invalid model: foo",
    "Model grok-4.7 is not available on your plan",
    "There's an issue with the selected model (claude-x). It may not exist or you may not have access to it.",
  ]) {
    assert.equal(looksUnavailable(text), true, text);
    assert.equal(looksLikeLimit(text), false, text);
  }
  for (const text of ["You've hit your usage limit", "rate limit exceeded, try again in 5 minutes", "Datamodel not found in the schema", "all tests pass"]) {
    assert.equal(looksUnavailable(text), false, text);
  }
  assert.equal(looksUnavailable(`model_not_found\n${"x".repeat(5000)}`), false);
  // Only the CLI's own error counts: its error output and a final result or error object, never a tool's output in the
  // transcript, and never a watchdog stop (124, 125, 126).
  const claude = JSON.stringify({ type: "result", is_error: true, result: "There's an issue with the selected model (claude-x). It may not exist or you may not have access to it." });
  assert.equal(modelUnavailable(claude, "", "1"), true);
  assert.equal(modelUnavailable(`${JSON.stringify({ type: "turn.failed", error: { message: "The model `gpt-9` does not exist or you do not have access to it." } })}\n`, "", "1"), true);
  assert.equal(modelUnavailable("", "Cannot use this model: grok-9", "1"), true);
  assert.equal(modelUnavailable("", "Cannot use this model: grok-9", "125"), false);
  const transcript = [
    JSON.stringify({ type: "tool_call", output: "error TS2339: Property 'model' does not exist on type 'Config'." }),
    JSON.stringify({ type: "assistant", text: "The model `Post` does not exist in schema.prisma; adding it." }),
  ].join("\n");
  assert.equal(modelUnavailable(transcript, "", "1"), false);
  assert.equal(modelUnavailable(claude, "", "0"), true);
  assert.equal(modelUnavailable(JSON.stringify({ type: "result", is_error: false, result: "model not found was fixed" }), "", "0"), false);

  const dir = staged("devos-unavailable-");
  try {
    // The runner's scripts read paths from the project's root, as accounts.sh gives them.
    const check = (json, err, exit) => {
      writeFileSync(path.join(dir, ".devos", "out.json"), json);
      writeFileSync(path.join(dir, ".devos", "out.err"), err);
      const args = ["scripts/devos/limit-check.mjs", "--unavailable", "--json", ".devos/out.json", "--err", ".devos/out.err", "--exit", exit];
      return spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", windowsHide: true }).status;
    };
    assert.equal(check("", "Cannot use this model: grok-9", "1"), 0);
    assert.equal(check("", "You've hit your usage limit", "1"), 1);
    assert.equal(check("{\"type\":\"result\",\"result\":\"done; the old model was not found in the docs\"}", "", "0"), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// The builder's watchdog reads the working tree with git, as on the runner.
function repo(dir) {
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
  for (const args of [["init", "-q"], ["config", "user.email", "devos@example.com"], ["config", "user.name", "devos"], ["config", "core.autocrlf", "false"], ["config", "gc.auto", "0"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
    const result = git(args);
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  }
}

// A stand-in Codex: what it answers depends on the model it is given and the account's key.
function fakeCodex(dir, behaviour) {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const cases = Object.entries(behaviour).map(([key, what]) => {
    const say = what === "limit" ? "echo \"You've hit your usage limit · resets in 45m\" >&2; exit 1"
      : what === "unavailable" ? "echo 'error: model_not_found' >&2; exit 1"
        : "printf '%s\\n' DONE > \"$last\"; exit 0";
    return `  '${key}') ${say} ;;`;
  });
  writeFileSync(path.join(bin, "codex"), [
    "#!/bin/sh",
    "prev=''; last=''; model=''",
    "for arg in \"$@\"; do",
    "  if [ \"$prev\" = '-o' ]; then last=$arg; fi",
    "  if [ \"$prev\" = '-m' ] || [ \"$prev\" = '--model' ]; then model=$arg; fi",
    "  prev=$arg",
    "done",
    "echo \"$model@$CODEX_API_KEY\" >> \"$DEVOS_SEEN\"",
    "case \"$model@$CODEX_API_KEY\" in",
    ...cases,
    "  *) echo 'unexpected' >&2; exit 2 ;;",
    "esac",
    "",
  ].join("\n"), { mode: 0o755 });
  return bin;
}

function runAgent(dir, bin, role, models, extra = {}) {
  writeFileSync(path.join(dir, ".devos", `${role}-prompt.md`), "go\n");
  return spawnSync("bash", ["scripts/devos/run-agent.sh", role, "codex", models[0], "high", `.devos/${role}-prompt.md`, ...models.slice(1)], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, CODEX_KEY_1: "k1", CODEX_KEY_2: "k2", DEVOS_WATCHDOG_TICK: "1", DEVOS_SEEN: path.join(dir, "seen.txt"), ...extra },
  });
}

test("fallback-models.test.mjs (d) a builder run goes through both accounts of a limited model, skips a model an account cannot use, and finishes on the next", { skip: skipWindows }, () => {
  const dir = staged("devos-fallback-run-");
  try {
    repo(dir);
    const bin = fakeCodex(dir, { "M1@k1": "limit", "M1@k2": "limit", "M2@k1": "unavailable", "M2@k2": "done" });
    const result = runAgent(dir, bin, "builder", ["M1", "M2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readFileSync(path.join(dir, "seen.txt"), "utf8").trim().split("\n"), ["M1@k1", "M1@k2", "M2@k1", "M2@k2"]);
    const env = readFileSync(path.join(dir, ".devos", "builder-run.env"), "utf8");
    assert.match(env, /^code=0$/m);
    assert.match(env, /^used=2$/m);
    assert.match(env, /^model=M2$/m);
    assert.equal(existsSync(path.join(dir, ".devos", "limits", "codex-1.txt")), true);
    assert.equal(existsSync(path.join(dir, ".devos", "limits", "codex-2.txt")), true);
    const notes = readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8");
    assert.match(notes, /Builder: Codex account 1 reached its usage limit on M1\./);
    assert.match(notes, /Builder: Codex account 2 reached its usage limit on M1\./);
    assert.match(notes, /Builder: Codex account 1 cannot use M2; trying the next model\./);
    assert.match(readFileSync(path.join(dir, ".devos", "builder-prompt.md"), "utf8"), /started on another Codex account or model, which reached its usage limit/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (e) a review that no slot can run ends limited when one model was limited, and failed when none was", { skip: skipWindows }, () => {
  const dir = staged("devos-fallback-review-");
  try {
    // The reviewer's kit for Codex is the project's CLAUDE.md (role-env.mjs), which devos init writes.
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Reviewer\n");
    repo(dir);
    const bin = fakeCodex(dir, { "M1@k1": "limit", "M1@k2": "limit", "M2@k1": "unavailable", "M2@k2": "unavailable" });
    const result = runAgent(dir, bin, "reviewer", ["M1", "M2"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const env = readFileSync(path.join(dir, ".devos", "reviewer-run.env"), "utf8");
    assert.match(env, /^used=2$/m);
    assert.match(env, /^model=M2$/m);
    assert.doesNotMatch(env, /^code=0$/m);
    const limited = (json, err) => spawnSync(process.execPath, ["scripts/devos/limit-check.mjs", "--json", json, "--err", err, "--exit", "1"], { cwd: dir, windowsHide: true }).status;
    assert.equal(limited(".devos/reviewer.json", ".devos/reviewer.err"), 0);
    assert.match(readFileSync(path.join(dir, ".devos", "reviewer.err"), "utf8"), /resets in 45m\ndevos: no model of this agent could run; an earlier one reached its usage limit \(\.devos\/limits\/codex-2\.txt\)\n$/);

    rmSync(path.join(dir, ".devos", "limits"), { recursive: true, force: true });
    writeFileSync(path.join(dir, "seen.txt"), "");
    const none = fakeCodex(dir, { "M1@k1": "unavailable", "M1@k2": "unavailable" });
    const failed = runAgent(dir, none, "reviewer", ["M1"]);
    assert.equal(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.equal(limited(".devos/reviewer.json", ".devos/reviewer.err"), 1);
    assert.equal(existsSync(path.join(dir, ".devos", "limits")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (f) a planning run moves to the reviewer's next model and says which model answered", { skip: skipWindows }, () => {
  const dir = staged("devos-fallback-plan-");
  try {
    withAgents(dir, { reviewer: { id: "r", tool: "claude", model: "opus-x", fallback_models: ["sonnet-x"] }, pool: [{ id: "b", tool: "claude", model: "sonnet-x", default: true, note: "" }], policy: "always-default" });
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "claude"), [
      "#!/bin/sh",
      "prev=''; model=''",
      "for arg in \"$@\"; do if [ \"$prev\" = '--model' ]; then model=$arg; fi; prev=$arg; done",
      "echo \"$model@$CLAUDE_CODE_OAUTH_TOKEN\" >> \"$DEVOS_SEEN\"",
      "if [ \"$model\" = 'opus-x' ]; then echo 'Claude usage limit reached|1760112000'; exit 1; fi",
      "echo '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"decision\":\"accept\",\"summary\":\"planned\",\"tasks\":[\"T02\"]}}'",
      "",
    ].join("\n"), { mode: 0o755 });
    writeFileSync(path.join(dir, ".devos", "p.md"), "plan it\n");
    const result = spawnSync("bash", ["scripts/devos/plan-agent.sh", "intake", ".devos/p.md", "devos/schemas/intake.schema.json", ".devos/intake.json", "high", "10"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, CLAUDE_OAUTH_1: "o1", DEVOS_SEEN: path.join(dir, "seen.txt") },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readFileSync(path.join(dir, "seen.txt"), "utf8").trim().split("\n"), ["opus-x@o1", "sonnet-x@o1"]);
    const out = JSON.parse(readFileSync(path.join(dir, ".devos", "intake.json"), "utf8"));
    assert.deepEqual([out.tool, out.model, out.limited, out.structured_output?.decision], ["claude", "sonnet-x", false, "accept"]);
    assert.equal(existsSync(path.join(dir, ".devos", "limits", "claude-1.txt")), true);
    assert.match(readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8"), /intake: claude account 1 reached its usage limit on opus-x\./);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (g) a parked builder waits for the earliest reset of its own tool's slots", () => {
  const dir = staged("devos-fallback-wait-");
  try {
    mkdirSync(path.join(dir, ".devos", "limits"), { recursive: true });
    writeFileSync(path.join(dir, ".devos", "builder.json"), "");
    writeFileSync(path.join(dir, ".devos", "builder.err"), "You've hit your usage limit · resets in 3h\n");
    writeFileSync(path.join(dir, ".devos", "limits", "claude-1.txt"), "usage limit · resets in 2h\n");
    writeFileSync(path.join(dir, ".devos", "limits", "claude-2-m2.txt"), "limit reached · try again in 40 minutes\n");
    writeFileSync(path.join(dir, ".devos", "limits", "cursor-1.txt"), "usage limit · resets in 10m\n");
    const park = (tool) => {
      const before = Date.now();
      const result = spawnSync(process.execPath, ["scripts/devos/builder-status.mjs", "--task", "T01", "--attempt", "1", "--tool", tool, "--exit", "1"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: "" } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^state=quota$/m);
      return (Date.parse(/^not_before=(.+)$/m.exec(result.stdout)[1]) - before) / 60000;
    };
    const claude = park("claude");
    assert.equal(claude > 42 && claude < 44, true, String(claude));
    const cursor = park("cursor");
    assert.equal(cursor > 12 && cursor < 14, true, String(cursor));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("fallback-models.test.mjs (h) every builder and reviewer run of the cycle tries the slots, and the builder reports the model it used", () => {
  const count = (needle) => workflow.split(needle).length - 1;
  assert.equal(count("FALLBACKS: ${{ steps.ag.outputs.builder_fallbacks }}"), 1);
  assert.equal(count("models=\"$MODEL $FALLBACKS\""), 1);
  assert.equal(count("models=\"$MODEL $rev_fallbacks\""), 1);
  assert.equal(count("for slot in $(devos_slots claude $models); do"), 2);
  assert.equal(count("for slot in $(devos_slots cursor $models); do"), 2);
  assert.equal(count("MODEL=\"${slot%@*}\"; acc=\"${slot##*@}\""), 4);
  assert.equal(count("$(devos_limit_file "), 4);
  assert.equal(count("devos_unavailable .devos/"), 4);
  assert.equal(count("devos_settle \"$outcome\" \"$lim\" .devos/builder.err"), 1);
  assert.equal(count("devos_settle \"$outcome\" \"$lim\" .devos/reviewer.err"), 1);
  assert.equal(count(".devos/builder-prompt.md $FALLBACKS || exit 1"), 1);
  assert.equal(count(".devos/reviewer-prompt.md $rev_fallbacks || exit 1"), 1);
  assert.equal(count("echo \"model=$MODEL\" >> \"$GITHUB_OUTPUT\""), 1);
  assert.equal(count("${{ steps.builder.outputs.model || steps.bm.outputs.model }}"), 3);
  assert.equal(count("builder-status.mjs --task \"$TASK\" --attempt \"$ATTEMPT\" --tool \"${{ steps.ag.outputs.builder_tool || 'cursor' }}\""), 1);
  assert.equal(count("for acc in $accounts"), 0);
  for (const file of ["run-agent.sh", "plan-agent.sh"]) {
    const text = readFileSync(path.join(root, "payload", "files", "scripts", "devos", file), "utf8");
    assert.equal(text.includes("for acc in $accounts"), false, file);
    assert.equal(text.includes("devos_slots \"$tool\" $models"), true, file);
  }
});
