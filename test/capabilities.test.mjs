// E87 (PR-109): what each tool can do, each role's needs, and a project's own tool on GitHub.
//   (a) every engine tool can run headless, edit and shell; `can` is checked like every other field;
//   (b) a role given to a tool that cannot fill it is refused, naming what it lacks;
//   (c) a project's own tool (parser contract, install none, the secret DEVOS_AGENT_KEY) is loaded beside the engine's,
//       its secret is one every AI job's caller names, and the runner reads the contract it writes;
//   (d) a project's own tool reviews through plan-agent.sh: its key arrives under the name its CLI reads, and its answer,
//       usage and limit come from its contract;
//   (e) devos agents check says what is wrong with a tool's file before a run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { giveAgents } from "./chosen-agents.mjs";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(root, "payload", "files");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const tools = await import(pathToFileURL(path.join(PAYLOAD, "scripts", "devos", "tools.mjs")).href);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };

/** A project's own tool: node running its script under devos/agents/echo/, which writes the agent output contract. */
const ECHO = {
  id: "echo", name: "Echo", label: "Echo agent", provider: "example", command: "node", commands: ["node"],
  install: { kind: "none" }, effort: "none", efforts: [], fast: false, can: ["headless", "edit", "shell"],
  parser: "contract", answer: "schema", stdin: true,
  keys: { secret: "DEVOS_AGENT_KEY", env: "ECHO_KEY", cli: "ECHO_TOKEN", alt: null, unset: [], account: "DEVOS_ECHO_ACCOUNT" },
  setup: { env: {}, home: [] }, kits: {},
  run: {
    builder: ["devos/agents/echo/run.mjs", "--model", "{model}"],
    reviewer: ["devos/agents/echo/run.mjs", "--model", "{model}", "--schema", "{schema}"],
    planner: ["devos/agents/echo/run.mjs", "--model", "{model}", "--schema", "{schema}"],
  },
  login: "none",
};
const SCRIPT = `import { readFileSync, writeFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
const model = process.argv[process.argv.indexOf("--model") + 1];
const generic = Object.keys(process.env).filter((name) => /^DEVOS_(KEY|ALT)_/.test(name));
writeFileSync(".devos/echo-seen.json", JSON.stringify({ model, key: process.env.ECHO_TOKEN ?? null, generic, prompt: prompt.length > 0, schema: process.argv.includes("--schema") }));
const limited = process.env.ECHO_LIMITED === "1";
console.log(JSON.stringify({ contract: 1, type: "result", role: "reviewer", agent: "echo", tool: "echo", provider: "example", model,
  exit_code: 0, is_error: limited, subtype: limited ? "error" : "success", result: "reviewed", structured_output: limited ? null : { verdict: "PASS" },
  usage: { input_tokens: 120, output_tokens: 30, cache_read_tokens: 5, cache_write_tokens: 0 }, permission_denials: [], limited, not_before: null }));
`;

function project({ echo = ECHO, agents } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-own-tool-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  if (echo) {
    write(dir, "devos/agents/echo.json", `${JSON.stringify(echo, null, 2)}\n`);
    write(dir, "devos/agents/echo/run.mjs", SCRIPT);
  }
  giveAgents(dir, agents ?? {});
  return dir;
}
const node = (dir, args, env = {}) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });

test("capabilities.test.mjs (a) every engine tool can run headless, edit and shell, and can is checked like every other field", () => {
  for (const id of ["claude", "codex", "cursor", "gemini"]) assert.deepEqual(tools.tool(id).can, ["headless", "edit", "shell"], id);
  assert.deepEqual(tools.ROLE_NEEDS, { builder: ["headless", "edit", "shell"], reviewer: ["headless", "edit", "shell"], planner: ["headless", "edit"] });
  const codex = read(path.join(PAYLOAD, "devos", "agents", "codex.json"));
  assert.deepEqual(tools.problems({ ...codex, can: ["headless", "think"] }, "codex.json"), ["codex.json: can must list what the tool can do, each once: headless, edit, shell"]);
  assert.deepEqual(tools.problems({ ...codex, can: undefined }, "codex.json"), ["codex.json: can must list what the tool can do, each once: headless, edit, shell"]);
  assert.deepEqual(tools.lacking({ can: ["headless"] }, "reviewer"), ["edit", "shell"]);
  assert.deepEqual(tools.lacking({ can: ["headless", "edit"] }, "planner"), []);
  assert.deepEqual(tools.problems({ ...ECHO }, "echo.json"), []);
});

test("capabilities.test.mjs (b) a role given to a tool that cannot fill it is refused, naming what it lacks", () => {
  const dir = project();
  try {
    const narrow = { ...ECHO, can: ["headless", "edit"] };
    write(dir, "devos/agents/echo.json", `${JSON.stringify(narrow, null, 2)}\n`);
    const cases = [
      [{ reviewer: { id: "echo-review", tool: "echo", model: "m" }, reviewer_light: null }, "agents: reviewer is Echo agent, which cannot be the reviewer: it lacks shell (devos/agents/echo.json `can`)"],
      [{ pool: [{ id: "echo-build", tool: "echo", model: "m", default: true, note: "own" }] }, "agents: pool item echo-build is Echo agent, which cannot be the builder: it lacks shell (devos/agents/echo.json `can`)"],
    ];
    const cfg = read(path.join(dir, "devos.config.json"));
    for (const [agents, message] of cases) {
      writeFileSync(path.join(dir, "devos.config.json"), `${JSON.stringify({ ...cfg, agents: { ...cfg.agents, ...agents } }, null, 2)}\n`);
      const r = node(dir, ["scripts/devos/agents.mjs", "reviewer", "--mode", "deep"], { GITHUB_OUTPUT: "/dev/null" });
      assert.notEqual(r.status, 0, r.stdout);
      assert.ok(r.stderr.includes(message), r.stderr);
    }
  } finally {
    cleanup(dir);
  }
});

test("capabilities.test.mjs (c) a project's own tool is loaded beside the engine's, its secret is one every caller names, and the runner reads its contract", () => {
  assert.deepEqual(tools.secretNames().keys, ["CLAUDE_CODE_OAUTH_TOKEN", "CURSOR_API_KEY", "DEVOS_AGENT_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]);
  const dir = project({ agents: { reviewer: { id: "echo-review", tool: "echo", model: "echo-1" }, reviewer_light: null } });
  try {
    const check = node(dir, ["scripts/devos/tools.mjs", "check"]);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stdout.trim(), "tools: 5 tools checked (claude, codex, cursor, echo, gemini)");
    assert.equal(node(dir, ["scripts/devos/tools.mjs", "secrets", "--tool", "echo", "--as", "review"]).stdout, "review_key=DEVOS_AGENT_KEY\nreview_alt=\n");
    assert.equal(node(dir, ["scripts/devos/tools.mjs", "install", "--tool", "echo"]).stdout, "none node\n");
    assert.equal(node(dir, ["scripts/devos/tools.mjs", "missing-key", "--tool", "echo"]).stdout, "no Echo key: set secret DEVOS_AGENT_KEY (and optionally DEVOS_AGENT_KEY_2)\n");
    // The installed cycle names the secret literally, for the builder and both reviewers.
    const cycle = readFileSync(path.join(dir, ".github", "workflows", "devos-cycle.yml"), "utf8");
    for (const [slot, ref] of [["KEY_1", "secrets.DEVOS_AGENT_KEY)"], ["KEY_2", "secrets.DEVOS_AGENT_KEY_2)"], ["LKEY_1", "secrets.DEVOS_AGENT_KEY)"]]) {
      assert.ok(cycle.split("\n").some((line) => line.trim().startsWith(`${slot}: `) && line.includes(`== 'DEVOS_AGENT_KEY' && ${ref}`)), slot);
    }
    // A tool whose output is the contract already is kept as it is, its usage and its limit read from it.
    const out = path.join(dir, ".devos", "out.json");
    const contract = { contract: 1, type: "result", is_error: true, result: "", structured_output: null, limited: true, usage: { input_tokens: 7, output_tokens: 3, cache_read_tokens: 1, cache_write_tokens: 0 } };
    write(dir, ".devos/out.json", `${JSON.stringify(contract)}\n`);
    write(dir, ".devos/out.err", "");
    assert.equal(node(dir, ["scripts/devos/agent-cli.mjs", "normalize", "--tool", "echo", "--raw", out, "--last", "", "--out", out]).status, 0);
    assert.deepEqual(read(out), contract);
    assert.equal(node(dir, ["scripts/devos/limit-check.mjs", "--json", ".devos/out.json", "--err", ".devos/out.err", "--exit", "1"]).status, 0);
    const usage = node(dir, ["--input-type=module", "-e", `import { parseUsage } from "./scripts/devos/usage.mjs"; console.log(JSON.stringify(parseUsage("echo", ${JSON.stringify(JSON.stringify(contract))})));`]);
    assert.deepEqual(JSON.parse(usage.stdout), { input: 7, output: 3, cache_read: 1, cache_write: 0, cost_usd: null, seconds: null });
  } finally {
    cleanup(dir);
  }
});

test("capabilities.test.mjs (d) a project's own tool reviews through plan-agent.sh, with its key under its CLI's name and its answer from its contract", { skip: windows && "bash" }, () => {
  const dir = project({ agents: { reviewer: { id: "echo-review", tool: "echo", model: "echo-1" }, reviewer_light: null } });
  try {
    assert.equal(spawnSync("bash", ["scripts/devos/install-agent.sh", "echo"], { cwd: dir, encoding: "utf8" }).stdout.startsWith("install-agent: echo runs node ("), true);
    write(dir, ".devos/reviewer-prompt.md", "Review T01.\n");
    const env = { PATH: process.env.PATH, HOME: dir, DEVOS_AGENT_MODE: "deep", DEVOS_PROGRESS_EVERY: "3600", DEVOS_KEY_1: "own-k1" };
    const r = spawnSync("bash", ["scripts/devos/plan-agent.sh", "reviewer", ".devos/reviewer-prompt.md", "devos/schemas/verdict.schema.json", ".devos/reviewer.json", "", "80"], { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const seen = read(path.join(dir, ".devos", "echo-seen.json"));
    assert.deepEqual(seen, { model: "echo-1", key: "own-k1", generic: [], prompt: true, schema: true });
    const result = read(path.join(dir, ".devos", "reviewer.json"));
    assert.equal(result.agent, "echo");
    assert.equal(result.model, "echo-1");
    assert.deepEqual(result.structured_output, { verdict: "PASS" });
    assert.equal(result.limited, false);
    assert.deepEqual(result.usage, { input_tokens: 120, output_tokens: 30, cache_read_tokens: 5, cache_write_tokens: 0 });
    // A contract that says it hit its limit moves the run on, as any tool's limit does.
    const limited = spawnSync("bash", ["scripts/devos/plan-agent.sh", "reviewer", ".devos/reviewer-prompt.md", "devos/schemas/verdict.schema.json", ".devos/reviewer.json", "", "80"], { cwd: dir, encoding: "utf8", env: { ...env, ECHO_LIMITED: "1" } });
    assert.match(limited.stdout + readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8"), /echo account 1 reached its usage limit on echo-1/);
    assert.equal(read(path.join(dir, ".devos", "reviewer.json")).limited, true);
  } finally {
    cleanup(dir);
  }
});

test("capabilities.test.mjs (e) devos agents check says what is wrong with a tool's file before a run", () => {
  const dir = project({ agents: { reviewer: { id: "echo-review", tool: "echo", model: "echo-1" }, reviewer_light: null } });
  try {
    const check = (id) => spawnSync(process.execPath, [bin, "agents", "check", id], { cwd: dir, encoding: "utf8", windowsHide: true });
    const ok = check("echo");
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /^devos agents check echo: Echo agent \(devos\/agents\/echo\.json\)$/m);
    assert.match(ok.stdout, /^- can: headless, edit, shell, so it can be builder, reviewer, planner$/m);
    assert.match(ok.stdout, /^- secret DEVOS_AGENT_KEY: the cycle passes it \(and DEVOS_AGENT_KEY_2\) to the tool's job; set it in GitHub$/m);
    assert.match(ok.stdout, /^- devos\.config\.json: reviewer \(reviewer\) fits$/m);
    assert.match(ok.stdout, /^result: ready$/m);
    // Its own secret, which no workflow passes, and a role it cannot fill: two problems.
    write(dir, "devos/agents/echo.json", `${JSON.stringify({ ...ECHO, can: ["headless", "edit"], keys: { ...ECHO.keys, secret: "OPENROUTER_API_KEY" } }, null, 2)}\n`);
    const bad = check("echo");
    assert.equal(bad.status, 1, bad.stdout);
    assert.match(bad.stdout, /^- secret OPENROUTER_API_KEY: no workflow passes it, so the tool's job would get no key; a project's own tool uses DEVOS_AGENT_KEY \(and DEVOS_AGENT_KEY_2\)$/m);
    assert.match(bad.stdout, /^- devos\.config\.json: reviewer is the reviewer, which needs headless, edit, shell; it lacks shell$/m);
    assert.match(bad.stdout, /^result: 2 problem\(s\)$/m);
    // A file the registry refuses, and a tool that does not exist.
    write(dir, "devos/agents/echo.json", `${JSON.stringify({ ...ECHO, parser: "yaml" }, null, 2)}\n`);
    assert.match(check("echo").stdout, /^  - echo\.json: parser must be one of claude, cursor, codex, gemini, contract$/m);
    assert.equal(check("cursor").status, 0);
    const none = check("nope");
    assert.equal(none.status, 1);
    assert.equal(none.stdout.trim(), "devos agents check: no devos/agents/nope.json in this project or the engine");
  } finally {
    cleanup(dir);
  }
});
