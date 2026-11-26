// E85 (PR-101): the review runs in its own job, on the project's reviewer agent, whatever its tool, through the runner
// the planner already used (plan-agent.sh); every agent run leaves the same output contract (agent-result.mjs).
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { agentResult, CONTRACT } from "../payload/files/scripts/devos/agent-result.mjs";
import { validate } from "../payload/files/scripts/devos/agents.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const SCHEMA = "devos/schemas/verdict.schema.json";
const VERDICT = { verdict: "PASS", task: "T01", attempt: 1, summary: "s", fence_written: null, classification: [], human_attention: null };

// One recorded run of each tool, as its CLI prints it: what the contract is made from.
const RECORDED = {
  claude: JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 61000, num_turns: 12, result: "Reviewed.", structured_output: VERDICT, usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400 }, permission_denials: [{ tool_name: "WebFetch" }] }),
  cursor: [JSON.stringify({ type: "system", subtype: "init" }), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "…" }] } }), JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 42000, result: "Reviewed.", usage: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 0 } })].join("\n"),
  codex: [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3000, cached_input_tokens: 1000, output_tokens: 250 } })].join("\n"),
  gemini: JSON.stringify({ response: "Reviewed.", stats: { models: { "gemini-3.8-flash": { tokens: { prompt: 2000, cached: 500, candidates: 150, thoughts: 50 } } } } }),
};

test("review-job.test.mjs (a) every tool's run becomes the one output contract, with tool, provider and model apart", () => {
  const made = (tool, extra = {}) => agentResult({ role: "reviewer", tool, model: `${tool}-model`, rawText: RECORDED[tool], lastText: tool === "codex" ? "Reviewed." : "", code: "0", ...extra });
  const keys = ["contract", "type", "role", "agent", "tool", "provider", "model", "exit_code", "is_error", "subtype", "result", "usage", "structured_output", "permission_denials", "limited", "not_before"];
  for (const tool of ["claude", "cursor", "codex", "gemini"]) {
    const r = made(tool, tool === "claude" ? {} : { answerText: JSON.stringify(VERDICT) });
    assert.deepEqual(Object.keys(r).filter((k) => keys.includes(k)), keys, tool);
    assert.deepEqual([r.contract, r.type, r.agent, r.tool, r.model, r.exit_code, r.is_error, r.limited, r.not_before], [CONTRACT, "result", tool, tool, `${tool}-model`, 0, false, false, null], tool);
    assert.equal(r.result, "Reviewed.", tool);
    assert.deepEqual(r.structured_output, VERDICT, tool);
  }
  // Each tool's tokens, read by the parsers that read them before (usage.mjs).
  assert.deepEqual(["claude", "cursor", "codex", "gemini"].map((tool) => made(tool).usage), [
    { input_tokens: 1200, output_tokens: 300, cache_read_tokens: 9000, cache_write_tokens: 400 },
    { input_tokens: 800, output_tokens: 200, cache_read_tokens: 5000, cache_write_tokens: 0 },
    { input_tokens: 2000, output_tokens: 250, cache_read_tokens: 1000, cache_write_tokens: 0 },
    { input_tokens: 1500, output_tokens: 200, cache_read_tokens: 500, cache_write_tokens: 0 },
  ]);
  assert.deepEqual(made("claude").permission_denials, [{ tool_name: "WebFetch" }]);
  assert.deepEqual([made("claude").duration_ms, made("claude").num_turns, made("cursor").duration_ms], [61000, 12, 42000]);
  // The provider, when the project names one; null otherwise.
  assert.equal(made("cursor", { provider: "anthropic" }).provider, "anthropic");
  assert.equal(made("cursor").provider, null);
  // An integration the engine has no parser for: its own contract object is read as it is, plain text as the result.
  const own = agentResult({ role: "reviewer", tool: "my-api-agent", model: "m", rawText: JSON.stringify({ type: "result", is_error: false, result: "done", structured_output: VERDICT }), code: "0" });
  assert.deepEqual([own.agent, own.result, own.structured_output, own.is_error], ["my-api-agent", "done", VERDICT, false]);
  const plain = agentResult({ role: "reviewer", tool: "my-cli", model: "m", rawText: "all good\n", code: "1" });
  assert.deepEqual([plain.result, plain.is_error, plain.exit_code, plain.structured_output], ["all good", true, 1, null]);
  // A run stopped at a usage limit says until when, from the tool's own words.
  const limited = agentResult({ role: "reviewer", tool: "claude", model: "m", errText: "Claude AI usage limit reached|1760112000", code: "1", limited: true, now: new Date("2025-10-10T00:00:00Z") });
  assert.deepEqual([limited.limited, limited.not_before], [true, "2025-10-10T16:03:00Z"]);
});

test("review-job.test.mjs (b) agents may name a provider apart from the tool; a project without one is valid as before", () => {
  const reviewer = { id: "r", tool: "cursor", model: "claude-opus-5-5", provider: "anthropic" };
  const pool = [{ id: "b", tool: "codex", model: "gpt-5.5", default: true, note: "", effort: "low", provider: "openai" }];
  validate({ reviewer, pool, policy: "always-default", raise_on_retry: false });
  validate({ reviewer: { id: "r", tool: "cursor", model: "grok-4.7-high" }, pool: [{ ...pool[0], provider: undefined }].map(({ provider, ...rest }) => rest), policy: "always-default", raise_on_retry: false });
  assert.throws(() => validate({ reviewer: { ...reviewer, provider: "Bad Provider!" }, pool, policy: "always-default", raise_on_retry: false }), /reviewer\.provider must be a provider id/);
  assert.throws(() => validate({ reviewer, pool: [{ ...pool[0], provider: "" }], policy: "always-default", raise_on_retry: false }), /pool item provider must be a provider id/);
});

// A project as devos install writes it, its reviewer on `tool`, and a fake of each CLI that records its arguments.
function reviewProject(tool, model, { effort = "", provider = "" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-review-job-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const configPath = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const reviewer = { id: "rev", tool, model, ...(effort ? { effort, gate_effort: effort, light_effort: effort } : {}), ...(provider ? { provider } : {}) };
  cfg.agents = { reviewer, pool: [{ id: "b", tool: "cursor", model: "grok-4.7", default: true, note: "default builder", effort: "fence" }], policy: "always-default", raise_on_retry: false };
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const fakes = path.join(dir, "fakes");
  mkdirSync(fakes);
  const seen = path.join(dir, "seen.json");
  const answer = JSON.stringify(VERDICT);
  // Each fake records its argv and the key it was given, writes the review file, and prints what that CLI prints.
  const body = {
    claude: `fs.writeFileSync("docs/reviews/T01-a1.md", "VERDICT: PASS\\n"); process.stdout.write(${JSON.stringify(RECORDED.claude)});`,
    agent: `fs.writeFileSync("docs/reviews/T01-a1.md", "VERDICT: PASS\\n"); fs.writeFileSync(".devos/reviewer-answer.json", ${JSON.stringify(answer)}); fs.copyFileSync(".cursor/cli.json", ${JSON.stringify(`${seen}.kit`)}); process.stdout.write(${JSON.stringify(RECORDED.cursor)});`,
    codex: `fs.writeFileSync("docs/reviews/T01-a1.md", "VERDICT: PASS\\n"); fs.writeFileSync(".devos/reviewer-answer.json", ${JSON.stringify(answer)}); const o = process.argv.indexOf("-o"); fs.writeFileSync(process.argv[o + 1], "Reviewed."); process.stdout.write(${JSON.stringify(RECORDED.codex)});`,
    gemini: `fs.writeFileSync("docs/reviews/T01-a1.md", "VERDICT: PASS\\n"); fs.writeFileSync(".devos/reviewer-answer.json", ${JSON.stringify(answer)}); process.stdout.write(${JSON.stringify(RECORDED.gemini)});`,
  };
  for (const [name, code] of Object.entries(body)) {
    const file = path.join(fakes, name);
    writeFileSync(file, `#!/usr/bin/env node\nconst fs = require("fs");\nfs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2), key: process.env.CURSOR_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "" }));\nfs.mkdirSync("docs/reviews", { recursive: true });\n${code}\n`);
    chmodSync(file, 0o755);
  }
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  writeFileSync(path.join(dir, ".devos", "reviewer-prompt.md"), "Review T01, attempt 1.\n");
  // A project's own instructions, which the Codex and Gemini kits hand their tool (role-env.mjs).
  if (!existsSync(path.join(dir, "CLAUDE.md"))) writeFileSync(path.join(dir, "CLAUDE.md"), "# The project\n");
  return { dir, fakes, seen };
}

function runReview({ dir, fakes }, keys, mode = "deep", effort = "", turns = "80") {
  return spawnSync("bash", ["scripts/devos/plan-agent.sh", "reviewer", ".devos/reviewer-prompt.md", SCHEMA, ".devos/reviewer.json", effort, turns], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { PATH: `${fakes}${path.delimiter}${process.env.PATH ?? ""}`, HOME: dir, DEVOS_AGENT_MODE: mode, ...keys },
  });
}

test("review-job.test.mjs (c) each of the four tools reviews with the command line it plans with, its own key, and its kit", { skip: windows && "the runner is bash" }, () => {
  const cases = [
    ["claude", "claude-opus-5-5", "high", { CLAUDE_OAUTH_1: "claude-key" }, "claude-key", (argv) => {
      assert.deepEqual(argv.slice(0, 7), ["-p", "--model", "claude-opus-5-5", "--effort", "high", "--output-format", "json"]);
      // The planner's flags, and the review's documentation lookups as it had them in publish.
      for (const [flag, value] of [["--permission-mode", "dontAsk"], ["--max-turns", "80"], ["--mcp-config", "devos/ci/mcp.claude.json"], ["--allowedTools", "Read,Glob,Grep,Write,Edit,Bash,Task,Agent,Skill,mcp__context7,WebFetch(domain:nextjs.org),WebFetch(domain:cursor.com),WebFetch(domain:code.claude.com)"]]) assert.equal(argv[argv.indexOf(flag) + 1], value, flag);
      assert.match(argv[argv.indexOf("--disallowedTools") + 1], /^Bash\(git push \*\),Bash\(git commit \*\),.*Bash\(gh \*\),Bash\(curl \*\)/);
      assert.deepEqual(JSON.parse(argv[argv.indexOf("--json-schema") + 1]).required.sort(), JSON.parse(readFileSync(path.join(root, "payload", "files", SCHEMA), "utf8")).required.sort());
    }],
    ["cursor", "grok-4.7-high", "", { CURSOR_KEY_1: "cursor-key" }, "cursor-key", (argv) => {
      assert.deepEqual(argv, ["-p", "--force", "--trust", "--model", "grok-4.7-high", "--output-format", "stream-json", "Your instructions for this run are in the file .devos/reviewer-answer-prompt.md. Read all of it first, then follow it exactly: it is your whole task."]);
    }],
    ["codex", "gpt-5.5", "medium", { CODEX_KEY_1: "codex-key" }, "codex-key", (argv) => {
      assert.deepEqual(argv.slice(0, 5), ["exec", "--model", "gpt-5.5", "--sandbox", "workspace-write"]);
      assert.ok(argv.includes('model_reasoning_effort="medium"') && argv.includes("--json"), argv.join(" "));
      assert.equal(argv.includes("sandbox_workspace_write.network_access=true"), false);
      assert.equal(argv.at(-1), "-");
    }],
    ["gemini", "gemini-3.8-flash", "", { GEMINI_KEY_1: "gemini-key" }, "gemini-key", (argv) => {
      assert.deepEqual(argv, ["--model", "gemini-3.8-flash", "--approval-mode", "yolo", "--output-format", "json", "-p", "Follow the instructions given on standard input exactly."]);
    }],
  ];
  for (const [tool, model, effort, keys, key, check] of cases) {
    const run = reviewProject(tool, model, { effort, provider: tool === "cursor" ? "xai" : "" });
    try {
      const result = runReview(run, keys, "deep", effort);
      assert.equal(result.status, 0, `${tool}: ${result.stdout}\n${result.stderr}`);
      const seen = JSON.parse(readFileSync(run.seen, "utf8"));
      check(seen.argv);
      assert.equal(seen.key, key, `${tool}: the run gets its own key only`);
      if (tool === "cursor") assert.deepEqual(readFileSync(`${run.seen}.kit`), readFileSync(path.join(run.dir, "devos", "roles", "cursor-reviewer", "cli.json")));
      const out = JSON.parse(readFileSync(path.join(run.dir, ".devos", "reviewer.json"), "utf8"));
      assert.deepEqual([out.contract, out.role, out.agent, out.model, out.exit_code, out.limited], [CONTRACT, "reviewer", tool, model, 0, false], tool);
      assert.equal(out.provider, tool === "cursor" ? "xai" : null, tool);
      assert.deepEqual(out.structured_output, VERDICT, tool);
      assert.equal(readFileSync(path.join(run.dir, ".devos", "reviewer-run.env"), "utf8"), `code=0\nused=1\naccounts="1"\ntool=${tool}\nmodel=${model}\n`, tool);
      assert.equal(readFileSync(path.join(run.dir, "docs", "reviews", "T01-a1.md"), "utf8"), "VERDICT: PASS\n");
    } finally {
      rmSync(run.dir, { recursive: true, force: true });
    }
  }
});

test("review-job.test.mjs (d) a light review runs the light reviewer's tool; every account at its limit says so in the contract", { skip: windows && "the runner is bash" }, () => {
  const run = reviewProject("claude", "claude-opus-5-5", { effort: "high" });
  try {
    const configPath = path.join(run.dir, "devos.config.json");
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.agents.reviewer_light = { id: "light", tool: "gemini", model: "gemini-3.8-flash" };
    delete cfg.agents.reviewer.light_effort;
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    const light = runReview(run, { GEMINI_KEY_1: "gemini-key", CLAUDE_OAUTH_1: "claude-key" }, "light");
    assert.equal(light.status, 0, light.stdout + light.stderr);
    assert.equal(JSON.parse(readFileSync(run.seen, "utf8")).argv[1], "gemini-3.8-flash");
    assert.equal(JSON.parse(readFileSync(path.join(run.dir, ".devos", "reviewer.json"), "utf8")).agent, "gemini");

    // Gemini's only account at its limit: no review, and the contract says when it resets.
    writeFileSync(path.join(run.fakes, "gemini"), "#!/bin/sh\necho 'Quota exceeded: resets in 2h 15m' >&2\nexit 1\n", { mode: 0o755 });
    const out = runReview(run, { GEMINI_KEY_1: "gemini-key" }, "light");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const contract = JSON.parse(readFileSync(path.join(run.dir, ".devos", "reviewer.json"), "utf8"));
    assert.deepEqual([contract.limited, contract.structured_output, typeof contract.not_before], [true, null, "string"]);
    assert.ok(existsSync(path.join(run.dir, ".devos", "limits", "gemini-1.txt")));
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

test("review-job.test.mjs (e) install-agent.sh installs each tool exactly as the work job did before it, at its pin", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-install-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", path.join(dir, "p"), "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const p = path.join(dir, "p");
    const fakes = path.join(dir, "fakes");
    mkdirSync(fakes);
    const log = path.join(dir, "calls.txt");
    for (const name of ["npm", "curl", "sha256sum", "tar", "ln"]) {
      writeFileSync(path.join(fakes, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n[ "${name}" = "sha256sum" ] && cat >> "${log}"\nexit 0\n`, { mode: 0o755 });
    }
    const pins = JSON.parse(readFileSync(path.join(p, "devos.config.json"), "utf8")).tool_versions;
    const run = (tool) => {
      rmSync(log, { force: true });
      const r = spawnSync("bash", ["scripts/devos/install-agent.sh", tool], { cwd: p, encoding: "utf8", env: { PATH: `${fakes}:${process.env.PATH}`, HOME: path.join(dir, "home"), RUNNER_TEMP: dir, GITHUB_PATH: path.join(dir, "github-path") } });
      return { status: r.status, calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [], err: r.stderr };
    };
    assert.deepEqual(run("claude").calls, [`npm install -g @anthropic-ai/claude-code@${pins.claude}`]);
    assert.deepEqual(run("codex").calls, [`npm install -g @openai/codex@${pins.codex}`]);
    assert.deepEqual(run("gemini").calls, [`npm install -g @google/gemini-cli@${pins.gemini}`]);
    const cursor = run("cursor");
    const home = path.join(dir, "home");
    const versionDir = `${home}/.local/share/cursor-agent/versions/${pins.cursor.version}`;
    assert.deepEqual(cursor.calls, [
      `curl -fsSL --retry 3 --retry-delay 2 -o ${dir}/cursor-agent.tar.gz https://downloads.cursor.com/lab/${pins.cursor.version}/linux/x64/agent-cli-package.tar.gz`,
      "sha256sum -c -",
      `${pins.cursor.sha256_linux_x64}  ${dir}/cursor-agent.tar.gz`,
      `tar --strip-components=1 -xzf ${dir}/cursor-agent.tar.gz -C ${versionDir}`,
      `ln -sf ${versionDir}/cursor-agent ${home}/.local/bin/agent`,
      `ln -sf ${versionDir}/cursor-agent ${home}/.local/bin/cursor-agent`,
    ], cursor.err);
    assert.equal(readFileSync(path.join(dir, "github-path"), "utf8"), `${home}/.local/bin\n`);
    const unknown = run("muse");
    assert.deepEqual([unknown.status, unknown.err.trim()], [2, "install-agent: no tool 'muse'; one of cursor, claude, codex, gemini"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review-job.test.mjs (f) a planning run keeps its own command line: the review's lookups are the review's", { skip: windows && "the runner is bash" }, () => {
  const run = reviewProject("claude", "claude-opus-5-5", { effort: "high" });
  try {
    writeFileSync(path.join(run.dir, ".devos", "p.md"), "plan it\n");
    const result = spawnSync("bash", ["scripts/devos/plan-agent.sh", "intake", ".devos/p.md", "devos/schemas/intake.schema.json", ".devos/intake.json", "high", "10"], {
      cwd: run.dir, encoding: "utf8", windowsHide: true, env: { PATH: `${run.fakes}${path.delimiter}${process.env.PATH ?? ""}`, HOME: run.dir, CLAUDE_OAUTH_1: "claude-key" },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const { argv } = JSON.parse(readFileSync(run.seen, "utf8"));
    assert.equal(argv[argv.indexOf("--allowedTools") + 1], "Read,Glob,Grep,Write,Edit,Bash,Task,Agent,Skill");
    assert.equal(argv.includes("--mcp-config"), false);
    assert.equal(argv[argv.indexOf("--max-turns") + 1], "10");
    const out = JSON.parse(readFileSync(path.join(run.dir, ".devos", "intake.json"), "utf8"));
    assert.deepEqual([out.role, out.agent, out.model], ["intake", "claude", "claude-opus-5-5"]);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

// The reviewer step's own script, as devos-review.yml runs it (its comment lines are part of the bash it runs).
function reviewerStep() {
  const lines = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-review.yml"), "utf8").split("\n");
  const at = lines.findIndex((line) => line.includes("- name: Reviewer (the project's reviewer agent"));
  const env = [];
  let i = lines.findIndex((line, n) => n > at && /^\s+env:$/.test(line));
  for (i += 1; /^\s{10}[A-Z_0-9]+: /.test(lines[i]) || /^\s{10}#/.test(lines[i]); i += 1) if (!lines[i].trim().startsWith("#")) env.push(lines[i].trim());
  const run = lines.findIndex((line, n) => n > at && /^\s+run: \|$/.test(line));
  const indent = lines[run].indexOf("run:") + 2;
  const body = [];
  for (let n = run + 1; n < lines.length && (lines[n].trim() === "" || lines[n].search(/\S/) >= indent); n += 1) body.push(lines[n].slice(indent));
  return { env, script: body.join("\n") };
}

test("review-job.test.mjs (g) a review-only run reviews: the attempt's model never becomes the developer's builder model, and the step ends with its reviewer (E85c)", { skip: windows && "the runner is bash" }, () => {
  // PR-103, from learn-coptic's T01 runs 45784517935 and 45784995188: a review-only run has no builder tags, so the
  // review job set DEVOS_BUILDER_MODEL=unknown; config() made "unknown" the default builder's model, and a pool of
  // Cursor models whose names pin their effort then lacked an effort, so the reviewer stopped before it ran.
  const step = reviewerStep();
  assert.ok(step.env.includes("DEVOS_BUILDER_MODEL: ${{ vars.DEVOS_BUILDER_MODEL }}"), step.env.join("\n"));
  assert.ok(step.env.includes("DEVOS_BUILT_MODEL: ${{ steps.prep.outputs.builder_model }}"), step.env.join("\n"));
  assert.equal(step.env.filter((line) => line.startsWith("DEVOS_BUILDER_MODEL:")).length, 1);
  const run = reviewProject("cursor", "grok-4.7-xhigh");
  try {
    const configPath = path.join(run.dir, "devos.config.json");
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.agents.pool = [
      { id: "cursor-grok-4-7-high", tool: "cursor", model: "grok-4.7-high", default: false, note: "i18n" },
      { id: "cursor-grok-4-7-xhigh", tool: "cursor", model: "grok-4.7-xhigh", default: true, note: "deep reasoning" },
    ];
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    mkdirSync(path.join(run.dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(run.dir, "docs", "PHASES.md"), readFileSync(path.join(root, "test", "fixtures", "docs", "PHASES.md")));
    writeFileSync(path.join(run.dir, "docs", "fences", "T01.md"), "## T01 — First task\n\n- Fence version: 1\n");
    const env = {
      PATH: `${run.fakes}${path.delimiter}${process.env.PATH ?? ""}`, HOME: run.dir, TASK: "T01", ATTEMPT: "1", DEVOS_ROOT: run.dir,
      DEVOS_AGENT_MODE: "deep", DEVOS_REVIEW_MODE: "deep", METHOD_CHANGE: "false", EFFORT: "", TURNS: "120",
      DEVOS_BUILDER_MODEL: "", DEVOS_BUILT_MODEL: "unknown", DEVOS_BUILDER_TOOL: "cursor", DEVOS_BUILDER_EFFORT: "unknown", DEVOS_BUILDER_FAST: "unknown",
      CURSOR_KEY_1: "cursor-key",
    };
    const started = Date.now();
    const result = spawnSync("bash", ["-e", "-c", step.script], { cwd: run.dir, encoding: "utf8", windowsHide: true, env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(Date.now() - started < 60000, "the step ends with its reviewer, not with the progress loop's sleep");
    assert.match(result.stdout, /^reviewer: cursor grok-4\.7-xhigh, exit 0, limited false, permission denials 0$/m);
    const prompt = readFileSync(path.join(run.dir, ".devos", "reviewer-prompt.md"), "utf8");
    assert.match(prompt, /cursor-grok-4-7-xhigh — cursor · grok-4\.7-xhigh/);
    assert.equal(prompt.includes("cursor · unknown"), false);
    assert.equal(prompt.includes("## Your answer"), false);
    const told = JSON.parse(readFileSync(run.seen, "utf8")).argv.at(-1).match(/in the file (\S+)\. Read/)[1];
    assert.equal(told, ".devos/reviewer-answer-prompt.md");
    const given = readFileSync(path.join(run.dir, told), "utf8");
    assert.ok(given.startsWith(prompt), "the reviewer gets the whole rendered prompt");
    assert.match(given, /\n## Your answer\n[\s\S]*\.devos\/reviewer-answer\.json/);
    // The cause, as the run hit it: the attempt's tag in the developer's variable stops the reviewer before it runs.
    const before = spawnSync("bash", ["-e", "-c", step.script], { cwd: run.dir, encoding: "utf8", windowsHide: true, env: { ...env, DEVOS_BUILDER_MODEL: "unknown" } });
    assert.notEqual(before.status, 0);
    assert.match(before.stderr, /has no agents\.pool\[cursor-grok-4-7-xhigh\]\.effort/);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

test("review-job.test.mjs (h) the review step prints its reviewer's line every minute, with the review file's size and the effort its model's name carries (E85e)", { skip: windows && "the runner is bash" }, () => {
  // PR-104: the review job's own 5-minute loop is gone; plan-agent.sh prints the line, as every runner does.
  const step = reviewerStep();
  assert.equal(step.script.includes("sleep 300"), false);
  const run = reviewProject("cursor", "grok-4.7-xhigh");
  try {
    mkdirSync(path.join(run.dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(run.dir, "docs", "PHASES.md"), readFileSync(path.join(root, "test", "fixtures", "docs", "PHASES.md")));
    writeFileSync(path.join(run.dir, "docs", "fences", "T01.md"), "## T01 — First task\n\n- Fence version: 1\n");
    // A reviewer that writes its review file at once, then works on for a while.
    writeFileSync(path.join(run.fakes, "agent"), `#!/usr/bin/env node
const fs = require("fs");
fs.mkdirSync("docs/reviews", { recursive: true });
fs.writeFileSync("docs/reviews/T01-a1.md", "VERDICT: PASS\\n" + "x".repeat(3000));
fs.writeFileSync(".devos/reviewer-answer.json", ${JSON.stringify(JSON.stringify(VERDICT))});
setTimeout(() => process.stdout.write(${JSON.stringify(RECORDED.cursor)}), 2600);
`);
    const env = {
      PATH: `${run.fakes}${path.delimiter}${process.env.PATH ?? ""}`, HOME: run.dir, TASK: "T01", ATTEMPT: "1", DEVOS_ROOT: run.dir,
      DEVOS_AGENT_MODE: "deep", DEVOS_REVIEW_MODE: "deep", METHOD_CHANGE: "false", EFFORT: "", TURNS: "120",
      DEVOS_BUILDER_MODEL: "", DEVOS_BUILT_MODEL: "grok-4.7-low", DEVOS_BUILDER_TOOL: "cursor", DEVOS_BUILDER_EFFORT: "low", DEVOS_BUILDER_FAST: "no",
      CURSOR_KEY_1: "cursor-key", DEVOS_PROGRESS_EVERY: "1", DEVOS_PROGRESS_UNIT: "1",
    };
    const result = spawnSync("bash", ["-e", "-c", step.script], { cwd: run.dir, encoding: "utf8", windowsHide: true, env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^reviewer: the reviewer agent, cursor grok-4\.7-xhigh, effort xhigh, from the model name$/m);
    const lines = result.stdout.split("\n").filter((line) => line.startsWith("reviewer · "));
    assert.ok(lines.length >= 2, result.stdout);
    assert.equal(lines[0], "reviewer · cursor grok-4.7-xhigh · effort xhigh, from the model name · 1 min · review file 3 KB");
    assert.match(result.stdout, /^reviewer: cursor grok-4\.7-xhigh, exit 0, limited false, permission denials 0$/m);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});
