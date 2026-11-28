// E86 (PR-106): the registry of agent tools (payload devos/agents/<id>.json, read by scripts/devos/tools.mjs).
//   (a) every tool, as builder, reviewer and planner, and its install, runs exactly as `next` @ 3ecf68a ran it before
//       the registry: the same command, arguments, standard input, credential and role files (test/agent-calls.mjs
//       records them with stand-in CLIs; test/fixtures/agent-calls.json is the record of the base).
//   (b) every tool file passes `tools.mjs check` and has exactly the fields of devos/schemas/agent.schema.json.
//   (c) the engine's own list of tools (lib/data/tools.json) agrees with the registry: ids, commands, secrets, sign-in.
//   (d) the account slots the watchdog strips are the ten the jobs map; a run without a key names the tool's secrets.
//   (e) a tool that takes an effort refuses a run with none (PR-99), naming its levels.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentCalls, TOOLS } from "./agent-calls.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = path.join(root, "payload", "files");
const agentsDir = path.join(files, "devos", "agents");
const toolsCli = path.join(files, "scripts", "devos", "tools.mjs");
const registry = await import(pathToFileURL(toolsCli).href);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const cli = (...args) => spawnSync(process.execPath, [toolsCli, ...args], { encoding: "utf8", windowsHide: true });

test("registry.test.mjs (a) each tool's builder, reviewer, planner and install run exactly as before the registry", { timeout: 600_000, skip: process.platform === "win32" && "the stand-in CLIs and the work job's step are bash" }, () => {
  const now = agentCalls(root);
  const base = read(path.join(root, "test", "fixtures", "agent-calls.json"));
  assert.deepEqual(Object.keys(now), Object.keys(base));
  for (const role of Object.keys(base)) {
    assert.deepEqual(Object.keys(now[role]), TOOLS, `${role}: the four tools`);
    for (const id of TOOLS) assert.deepEqual(now[role][id], base[role][id], `${role} ${id}`);
  }
});

test("registry.test.mjs (b) every tool file passes the check and has exactly the schema's fields", () => {
  const result = cli("check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "tools: 4 tools checked (claude, codex, cursor, gemini)");
  const schema = read(path.join(files, "devos", "schemas", "agent.schema.json"));
  const names = readdirSync(agentsDir).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(names, ["claude.json", "codex.json", "cursor.json", "gemini.json"]);
  for (const name of names) {
    const t = read(path.join(agentsDir, name));
    assert.deepEqual(registry.problems(t, name), [], name);
    for (const key of schema.required) assert.ok(key in t, `${name}: ${key}`);
    for (const key of Object.keys(t)) assert.ok(key in schema.properties, `${name}: ${key} is not in the schema`);
  }
  assert.deepEqual(registry.problems({ ...read(path.join(agentsDir, "codex.json")), parser: "other" }, "codex.json"), ["codex.json: parser must be one of claude, cursor, codex, gemini"]);
  assert.deepEqual(registry.problems({ ...read(path.join(agentsDir, "codex.json")), run: { builder: ["{secret}"], reviewer: [], planner: [] } }, "codex.json"), ["codex.json: run.builder: {secret} is not one of {model}, {effort}, {turns}, {schema}, {last}, {prompt}"]);
});

test("registry.test.mjs (c) the engine's list of tools agrees with the registry", () => {
  const engine = read(path.join(root, "lib", "data", "tools.json")).tools.filter((t) => t.cycle);
  assert.deepEqual(engine.map((t) => t.id).sort(), [...registry.toolIds()].sort());
  for (const e of engine) {
    const t = registry.tool(e.id);
    for (const command of [e.command, ...e.altCommands]) assert.ok(t.commands.includes(command), `${e.id}: ${command}`);
    assert.equal(t.command, e.command, `${e.id}: command`);
    assert.equal(t.login, e.authProbe, `${e.id}: sign-in check`);
    assert.deepEqual([t.keys.secret, ...(t.keys.alt ? [t.keys.alt.secret] : [])], e.githubSecrets, `${e.id}: secrets`);
    assert.equal(registry.toolOf(e.command), e.id);
  }
  assert.equal(registry.toolOf("/usr/local/bin/cursor-agent"), "cursor");
  assert.equal(registry.toolOf("node"), "node");
});

test("registry.test.mjs (d) the account slots are the ten the jobs map, and a run without a key names the tool's secrets", () => {
  const slots = cli("slots");
  assert.equal(slots.status, 0, slots.stderr);
  // One string, as the watchdog reads it: the ten names the jobs map.
  assert.equal(slots.stdout.trim().split(/\s+/).sort().join(" "), "CLAUDE_APIKEY_1 CLAUDE_APIKEY_2 CLAUDE_OAUTH_1 CLAUDE_OAUTH_2 CODEX_KEY_1 CODEX_KEY_2 CURSOR_KEY_1 CURSOR_KEY_2 GEMINI_KEY_1 GEMINI_KEY_2");
  assert.equal(registry.missingKey("cursor"), "no Cursor key: set secret CURSOR_API_KEY (and optionally CURSOR_API_KEY_2)");
  assert.equal(registry.missingKey("claude"), "no Claude key: set secret CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY (and optionally CLAUDE_CODE_OAUTH_TOKEN_2 or ANTHROPIC_API_KEY_2)");
  // Names only: a value set in the environment never reaches the output.
  const shell = spawnSync(process.execPath, [toolsCli, "shell", "--tool", "claude"], { encoding: "utf8", windowsHide: true, env: { ...process.env, CLAUDE_OAUTH_1: "o1-planted" } });
  assert.equal(shell.status, 0, shell.stderr);
  assert.match(shell.stdout, /^devos_t_env='CLAUDE_OAUTH'$/m);
  assert.doesNotMatch(shell.stdout, /o1-planted/);
});

test("registry.test.mjs (e) a tool that takes an effort refuses a run with none, naming its levels (PR-99)", () => {
  assert.throws(() => registry.render("codex", "builder", { model: "gpt-5.5-codex", prompt: "p.md", last: "l.md" }), {
    message: 'devos: Codex gpt-5.5-codex runs at low, medium, high or xhigh, not no effort; choose its effort in devos/project.json (PR-99)',
  });
  assert.throws(() => registry.render("claude", "reviewer", { model: "claude-opus-5-5", effort: "huge" }), /runs at low, medium, high, xhigh or max, not "huge"/);
  assert.deepEqual(registry.render("gemini", "builder", { model: "gemini-3.1-pro" }).slice(0, 1), ["gemini"]);
  assert.deepEqual(registry.effortsFor("cursor"), []);
});
