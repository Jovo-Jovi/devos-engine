import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { blueprintArgs } from "../lib/init.mjs";
import { blueprintEffort, validatePlan } from "../lib/plan.mjs";
import { checkRoster } from "../lib/roster.mjs";
import { poolText, validate } from "../payload/files/scripts/devos/agents.mjs";

// E52 (PR-78): the blueprint agent's effort, and a builder's effort either chosen per task or fixed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const signedIn = [
  { toolId: "claude", status: "installed", signedIn: true },
  { toolId: "cursor", status: "installed", signedIn: true },
];
const EFFORT_MESSAGE = "The blueprint effort is low, medium, high or xhigh, and only for Claude Code or Codex.";
const POOL_ITEM = { id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" };

function roster(pool) {
  return {
    reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
    reviewer_light: null,
    pool,
    policy: "reviewer-picks",
  };
}

function validPlan() {
  return {
    accepted: true,
    contract_version: CONTRACT_VERSION,
    link: false,
    agents: roster([POOL_ITEM]),
    blueprint: { tool: "claude", model: "claude-opus-5-5" },
    project: {
      type: "saas",
      stack: "next",
      modules: { database: "none", auth: "none", email: "none" },
      scope: "mvp",
    },
    fields: {
      name: "Demo Shop",
      brief: "A small shop.",
      users: "Customers",
      languages: ["en"],
      visibility: "private",
    },
    attachments: [],
  };
}

function refusal(value) {
  const lines = [];
  const write = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    return { result: checkRoster(value), lines };
  } finally {
    console.log = write;
  }
}

const PHASES = `| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |
|---|---|---|---|---|---|---|---|
| T01 | E | 1 | One | 1 | — | [ ] | — |
`;

function fields(text) {
  const out = {};
  for (const line of text.split(/\n/)) {
    const index = line.indexOf("=");
    if (index > 0) out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

test("effort.test.mjs (a) the blueprint agent runs at its effort: high by default, a flag for Claude Code and Codex, none for Cursor (PR-78)", () => {
  const claude = blueprintArgs("claude", "claude-opus-5-5", 1, "", false, "xhigh");
  assert.deepEqual(claude.slice(0, 5), ["-p", "--model", "claude-opus-5-5", "--effort", "xhigh"]);
  assert.deepEqual(
    blueprintArgs("codex", "gpt-5.1-codex", 1, "", false, "medium"),
    ["exec", "--model", "gpt-5.1-codex", "--sandbox", "workspace-write", "-c", 'model_reasoning_effort="medium"', "--json"],
  );
  assert.equal(blueprintArgs("cursor", "grok-4.7", 1, "", false, "xhigh").includes("--effort"), false);
  assert.equal(blueprintArgs("claude", "claude-opus-5-5", 1, "", false, "max").includes("--effort"), false);
  assert.equal(blueprintEffort({ tool: "claude", model: "claude-opus-5-5" }), "high");
  assert.equal(blueprintEffort({ tool: "codex", model: "gpt-5.1-codex", effort: "low" }), "low");
  assert.equal(blueprintEffort({ tool: "cursor", model: "grok-4.7", effort: "xhigh" }), "");
});

test("effort.test.mjs (b) a plan carries the blueprint's effort, and refuses one that is not a level or not for Claude Code or Codex", () => {
  const chosen = validPlan();
  chosen.blueprint.effort = "xhigh";
  const kept = validatePlan(chosen, signedIn);
  assert.equal(kept.ok, true, kept.errors?.join(" | "));
  assert.deepEqual(kept.answers.blueprint_agent, { tool: "claude", model: "claude-opus-5-5", effort: "xhigh" });
  const plain = validatePlan(validPlan(), signedIn);
  assert.equal(plain.ok, true, plain.errors?.join(" | "));
  assert.deepEqual(plain.answers.blueprint_agent, { tool: "claude", model: "claude-opus-5-5" });
  const max = validPlan();
  max.blueprint.effort = "max";
  assert.equal(validatePlan(max, signedIn).errors.includes(EFFORT_MESSAGE), true);
  const cursor = validPlan();
  cursor.blueprint = { tool: "cursor", model: "grok-4.7", effort: "high" };
  assert.equal(validatePlan(cursor, signedIn).errors.includes(EFFORT_MESSAGE), true);
});

test("effort.test.mjs (c) a builder may have a fixed effort, and fast only with one, only for Cursor (PR-78)", () => {
  const plan = validPlan();
  plan.agents.pool[0] = { ...POOL_ITEM, effort: "xhigh", fast: true };
  const kept = validatePlan(plan, signedIn);
  assert.equal(kept.ok, true, kept.errors?.join(" | "));
  assert.deepEqual(kept.agents.pool[0], { ...POOL_ITEM, effort: "xhigh", fast: true });
  const max = refusal(roster([{ ...POOL_ITEM, effort: "max" }]));
  assert.equal(max.result, null);
  assert.equal(max.lines.includes("devos: roster pool item effort must be low, medium, high or xhigh"), true);
  const bare = refusal(roster([{ ...POOL_ITEM, fast: true }]));
  assert.equal(bare.result, null);
  assert.equal(bare.lines.includes("devos: roster pool item fast is true, only with an effort, and only for cursor"), true);
  const claude = refusal(roster([{ id: "claude-builder", tool: "claude", model: "claude-sonnet-5-5", default: true, note: "", effort: "high", fast: true }]));
  assert.equal(claude.result, null);
  assert.equal(claude.lines.includes("devos: roster pool item fast is true, only with an effort, and only for cursor"), true);
  assert.deepEqual(checkRoster(roster([POOL_ITEM])).pool[0], POOL_ITEM);
});

test("effort.test.mjs (d) the runner accepts a fixed effort and shows it to the reviewer", () => {
  const agents = {
    reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
    pool: [{ ...POOL_ITEM, effort: "xhigh", fast: true }],
    policy: "reviewer-picks",
  };
  assert.equal(validate(agents), agents);
  assert.throws(() => validate({ ...agents, pool: [{ ...POOL_ITEM, effort: "max" }] }), { message: "agents: pool item effort must be low, medium, high or xhigh" });
  assert.throws(() => validate({ ...agents, pool: [{ ...POOL_ITEM, fast: true }] }), { message: "agents: pool item fast is true, only with an effort, and only for cursor" });
  assert.throws(
    () => validate({ ...agents, pool: [{ id: "claude-builder", tool: "claude", model: "claude-sonnet-5-5", default: true, note: "", effort: "high", fast: true }] }),
    { message: "agents: pool item fast is true, only with an effort, and only for cursor" },
  );
  assert.equal(poolText(agents), "- cursor-grok — cursor · grok-4.7 · fixed effort xhigh, fast · default — default builder");
  assert.equal(poolText({ ...agents, pool: [POOL_ITEM] }), "- cursor-grok — cursor · grok-4.7 · default — default builder");
});

function fence(effort, fast) {
  return [
    "## T01 — First task",
    "",
    "- Phase: P1 · Station: S1 · Risk: 1 · Gate: —",
    `- Builder: cursor-grok · Effort: ${effort} · Fast: ${fast}`,
    "- Layers: backend",
    "- Paths: `src/app.ts`",
    "- Fence version: v1",
    "",
    "### Prompt (canonical)",
    "",
    "1. Build it.",
    "",
    "### Done when",
    "",
    "- D1. Tests pass.",
    "",
    "### Do NOT",
    "",
    "- Run git.",
    "",
  ].join("\n");
}

test("effort.test.mjs (e) fence-check refuses a fence that does not keep its builder's fixed effort (PR-78)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-effort-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    const projectPath = path.join(dir, "devos", "project.json");
    const project = JSON.parse(readFileSync(projectPath, "utf8"));
    project.agents = { pool: [{ ...POOL_ITEM, effort: "xhigh", fast: true }] };
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(written.status, 0, written.stdout + written.stderr);
    const finding = "builder `cursor-grok` has a fixed effort in devos.config.json: the line must say `Effort: xhigh · Fast: yes` (PR-78)";
    const check = (text) => {
      writeFileSync(path.join(dir, "docs", "fences", "T01.md"), text);
      return spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", "docs/fences/T01.md"], { cwd: dir, encoding: "utf8", windowsHide: true });
    };
    const wrong = check(fence("high", "no"));
    assert.equal(wrong.stdout.includes(finding), true, wrong.stdout);
    const right = check(fence("xhigh", "yes"));
    assert.equal(right.status, 0, right.stdout);
    assert.equal(right.stdout.includes(finding), false, right.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("effort.test.mjs (f) a Cursor model id that names its effort runs as it is, and the runner reports that effort", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-effort-model-"));
  try {
    const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true });
    assert.equal(staged.status, 0, staged.stderr);
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), PHASES);
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "- Builder: cursor-grok · Effort: high · Fast: no\n");
    writeFileSync(path.join(dir, "models.txt"), "grok-4.7-high\ngrok-4.7-xhigh-fast\n");
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify({ ...JSON.parse(template.replaceAll("__PROJECT_KEY__", "DEMO")) }, null, 2)}\n`);
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(written.status, 0, written.stderr);
    const run = (family) => spawnSync(process.execPath, ["scripts/devos/builder-model.mjs", "--task", "T01", "--models-file", "models.txt"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, GITHUB_OUTPUT: "", DEVOS_BUILDER_FAMILY: family },
    });
    const pinned = fields(run("grok-4.7-xhigh-fast").stdout);
    assert.equal(pinned.model, "grok-4.7-xhigh-fast");
    assert.equal(pinned.effort, "xhigh");
    assert.equal(pinned.fast, "yes");
    assert.equal(pinned.source, "builder model");
    const fenceChoice = fields(run("grok-4.7").stdout);
    assert.equal(fenceChoice.model, "grok-4.7-high");
    assert.equal(fenceChoice.effort, "high");
    assert.equal(fenceChoice.fast, "no");
    assert.equal(fenceChoice.source, "fence");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("effort.test.mjs (g) the page asks each effort, and the method keeps a fixed one (PR-78)", () => {
  const page = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    "Reviewer chooses for each task",
    "Low, every task",
    "This model id sets the effort for every task.",
    "Every task of this builder runs at this effort, and the reviewer writes it in each fence.",
    "The reviewer picks the effort in each task's fence: low for copy, high for features, extra high for risk 3.",
    "How hard the agent thinks while it drafts. High is the default; extra high takes longer and uses more of your plan.",
    "effort: d.blueprint?.effort ?? \"high\"",
    "...(item.effort && item.fast === true ? { fast: true } : {})",
  ]) {
    assert.equal(page.includes(text), true, text);
  }
  const has = (file, sentence) => assert.equal(readFileSync(path.join(root, file), "utf8").includes(sentence), true, file);
  has("payload/files/devos/prompts/reviewer.md", "A builder the list shows with a fixed effort gets exactly");
  has("payload/files/devos/prompts/reviewer.md", "that `Effort:` and `Fast:` in every fence (PR-78); `fence-check.mjs` refuses another.");
  has("payload/files/devos/prompts/blueprint.md", "or the builder's fixed `effort` and `fast` when `devos.config.json` gives it one, PR-78");
  has("payload/files/docs/method/DEV_OS_V2_REVIEWER.md", "**A fixed effort is kept (PR-78).**");
  has("payload/files/docs/method/AUTOMATION.md", "Effort (PR-78): a builder's effort is the reviewer's choice for each task, written in the fence's builder line,");
  has("payload/files/docs/method/PRECEDENTS.md", "**Live maximum: PR-78.**");
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-78 | **A builder's effort is the reviewer's for each task, or fixed by the developer.**");
});
