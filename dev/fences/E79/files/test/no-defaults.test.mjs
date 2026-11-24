import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { confirm, select } from "../lib/menu.mjs";
import { askMissingChoices } from "../lib/upgrade.mjs";
import { missingChoices } from "../payload/files/scripts/devos/agents.mjs";
import { raisesOnRetry, runChoice } from "../payload/files/scripts/devos/lib.mjs";
import { CHOSEN_AGENTS, chosenAgents, giveAgents } from "./chosen-agents.mjs";

// E79 (PR-99): the engine never picks a model or an effort. Its defaults name none, no question has an answer chosen,
// and a run whose choice is missing stops and names the key to set.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

function reader(lines) {
  const queue = [...lines];
  const read = async () => (queue.length > 0 ? queue.shift() : null);
  read.asked = [];
  Object.defineProperty(read, "next", { set: (form) => read.asked.push(form) });
  return read;
}

const sink = { text: "", write(chunk) { this.text += chunk; return true; } };

test("no-defaults.test.mjs (a) devos/engine.defaults.json names no agent, model or effort", () => {
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  const tools = JSON.parse(readFileSync(path.join(root, "lib", "data", "tools.json"), "utf8")).tools;
  const models = new Set(tools.flatMap((tool) => (tool.seedGroups ?? []).flatMap((group) => group.models)));
  const found = [];
  const visit = (value, at) => {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${at}[${index}]`));
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (/^(agents|model|models|model_by_risk|model_family|gate_model|fallback_model|effort|default_effort|effort_by_risk|gate_effort|intake_effort|intake_effort_small|method_effort|escalate_on_retry)$/.test(key)) found.push(`${at}.${key}`);
        visit(inner, `${at}.${key}`);
      }
    } else if (typeof value === "string" && models.has(value)) found.push(`${at} = ${value}`);
  };
  visit(defaults, "defaults");
  assert.deepEqual(found, []);
});

test("no-defaults.test.mjs (b) no script, workflow or setup file falls back on an effort or a model of its own", () => {
  const files = [
    ...walk(path.join(root, "payload", "files", "scripts", "devos")),
    ...walk(path.join(root, "payload", "files", "dot-github", "workflows")),
    ...walk(path.join(root, "lib")),
  ].filter((file) => /\.(mjs|js|sh|yml)$/.test(file) && !file.includes(`${path.sep}media-providers${path.sep}`));
  const fallback = /(\|\||\?\?)\s*["'](low|medium|high|xhigh|max)["']|:-(low|medium|high|xhigh|max)\}|effort\s*=\s*["'](low|medium|high|xhigh|max)["']|EFFORT=(low|medium|high|xhigh|max)\b|["'](claude-(opus|sonnet|haiku|fable)-[0-9][^"']*|grok-[0-9][^"']*|gpt-[0-9][^"']*)["']/;
  const hits = [];
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (fallback.test(line) && !/^\s*(\/\/|#|\*)/.test(line)) hits.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("no-defaults.test.mjs (c) a question with no default asks again on an empty answer, and the page sees none chosen", async () => {
  const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const read = reader(["", "2"]);
  sink.text = "";
  assert.equal(await select(read, sink, { title: "Pick", options, defaultIndex: null }), "b");
  assert.equal(sink.text, "Pick\n  1) A\n  2) B\n[default: none]\n(type a number; nothing is chosen for you)\n");
  assert.deepEqual(read.asked.map((form) => Object.hasOwn(form, "default")), [false, false]);
  assert.equal(await select(reader(["", "", ""]), sink, { title: "Pick", options, defaultIndex: null }), undefined);
  // A question that keeps its default (a yes/no about the work, never a model or an effort) still takes Enter.
  assert.equal(await select(reader([""]), sink, { title: "Pick", options, defaultIndex: 1 }), "b");
  const yesNo = reader(["", "no"]);
  sink.text = "";
  assert.equal(await confirm(yesNo, sink, "Raise it?", null), false);
  assert.equal(sink.text, "Raise it? (yes/no): ");
  assert.deepEqual(yesNo.asked.map((form) => [form.choose, Object.hasOwn(form, "default")]), [[true, false], [true, false]]);
  assert.equal(await confirm(reader([""]), sink, "Go on?", true), true);
});

test("no-defaults.test.mjs (d) each run of the reviewer agent takes the effort the developer chose for its kind", () => {
  const cfg = { agents: chosenAgents() };
  const effort = (kind, agents = cfg.agents) => runChoice(kind, { agents }).effort;
  assert.deepEqual(["light", "deep", "gate", "method", "intake", "revise", "supervisor", "doctor"].map((kind) => [kind, effort(kind)]),
    [["light", "medium"], ["deep", "high"], ["gate", "high"], ["method", "high"], ["intake", "high"], ["revise", "high"], ["supervisor", "high"], ["doctor", "high"]]);
  assert.equal(runChoice("light", cfg).model, "claude-sonnet-5-5");
  const shared = chosenAgents({ reviewer_light: null, reviewer: { id: "r", tool: "claude", model: "o", effort: "xhigh", gate_effort: "max", light_effort: "low" } });
  assert.deepEqual([effort("light", shared), effort("gate", shared), effort("doctor", shared), runChoice("light", { agents: shared }).model], ["low", "max", "xhigh", "o"]);
  const cursor = chosenAgents({ reviewer: { id: "c", tool: "cursor", model: "grok-4.7-high" }, reviewer_light: null });
  assert.deepEqual(runChoice("gate", { agents: cursor }), { agent: cursor.reviewer, tool: "cursor", model: "grok-4.7-high", effort: "" });
  const { gate_effort: _gate, ...noGate } = CHOSEN_AGENTS.reviewer;
  assert.throws(() => runChoice("gate", { agents: { ...CHOSEN_AGENTS, reviewer: noGate } }), {
    message: "devos: devos/project.json has no agents.reviewer.gate_effort (the reviewer's effort on a gate: low, medium, high, xhigh, max); devos upgrade asks for it on your computer, or set it there and commit (PR-99)",
  });
  assert.throws(() => runChoice("deep", { agents: {} }), /has no agents\.reviewer \(the reviewer agent: tool and model\)/);
  assert.throws(() => raisesOnRetry({ agents: { ...CHOSEN_AGENTS, raise_on_retry: undefined } }), /has no agents\.raise_on_retry/);
  assert.equal(raisesOnRetry({ agents: { ...CHOSEN_AGENTS, raise_on_retry: false } }), false);
  assert.deepEqual(missingChoices(chosenAgents()), []);
});

test("no-defaults.test.mjs (e) agents.mjs effort gives each run's effort, and a missing choice stops it with the key to set", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-no-defaults-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const run = (kind) => spawnSync(process.execPath, ["scripts/devos/agents.mjs", "effort", "--kind", kind], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: "" } });
    // devos install alone chooses no agents: every run stops and says so.
    const none = run("supervisor");
    assert.equal(none.status, 1);
    assert.equal(none.stderr.trim(), "devos: devos/project.json has no agents (the reviewer, the builders and their efforts); devos upgrade asks for it on your computer, or set it there and commit (PR-99)");
    giveAgents(dir);
    assert.equal(run("doctor").stdout, "effort=high\ntool=claude\nmodel=claude-opus-5-5\n");
    assert.equal(run("light").stdout, "effort=medium\ntool=claude\nmodel=claude-sonnet-5-5\n");
    const project = path.join(dir, "devos", "project.json");
    const value = JSON.parse(readFileSync(project, "utf8"));
    delete value.agents.reviewer.effort;
    writeFileSync(project, `${JSON.stringify(value, null, 2)}\n`);
    assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true }).status, 0);
    const missing = run("intake");
    assert.equal(missing.status, 1);
    assert.equal(missing.stderr.trim(), "devos: devos/project.json has no agents.reviewer.effort (the reviewer's effort: low, medium, high, xhigh, max); devos upgrade asks for it on your computer, or set it there and commit (PR-99)");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("no-defaults.test.mjs (f) devos upgrade's questions choose nothing, and an answer that never comes changes nothing", async () => {
  const older = {
    reviewer: { id: "r", tool: "codex", model: "gpt-5.1-codex" },
    reviewer_light: { id: "l", tool: "claude", model: "claude-sonnet-5-5" },
    pool: [{ id: "b", tool: "claude", model: "claude-sonnet-5-5", default: true, note: "" }],
    policy: "reviewer-picks",
  };
  sink.text = "";
  const read = reader(["xhigh", "", "high", "low", "2", "no"]);
  const answered = await askMissingChoices(read, older, sink);
  assert.deepEqual(answered, {
    ...older,
    reviewer: { ...older.reviewer, effort: "xhigh", gate_effort: "high" },
    reviewer_light: { ...older.reviewer_light, effort: "low" },
    pool: [{ ...older.pool[0], effort: "medium" }],
    raise_on_retry: false,
  });
  assert.deepEqual(older.reviewer, { id: "r", tool: "codex", model: "gpt-5.1-codex" });
  assert.equal(read.asked.every((form) => !Object.hasOwn(form, "default")), true);
  // Codex offers no max; Claude Code does.
  assert.deepEqual(read.asked[0].options, ["low", "medium", "high", "xhigh"]);
  assert.deepEqual(read.asked[3].options, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(await askMissingChoices(reader(["high"]), older, sink), null);
  assert.equal(await askMissingChoices(reader([]), chosenAgents(), sink) !== null, true);
});
