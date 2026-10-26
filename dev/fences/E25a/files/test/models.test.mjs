import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { neededKeys } from "../lib/keys.mjs";
import { slugFromRemote } from "../lib/models.mjs";
import { withModelOverrides } from "../payload/files/scripts/devos/lib.mjs";
import { cleanup, stage } from "./harness.mjs";

// E25a (PR-63): a project's models change without a commit, and setup offers each agent tool's second account.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const setup = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));

const AGENTS = {
  reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
  reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5" },
  pool: [
    { id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" },
    { id: "claude-build", tool: "claude", model: "claude-sonnet-5-5", default: false, note: "second builder" },
  ],
  policy: "reviewer-picks",
};

function project(staged, agents = AGENTS, remote = "https://github.com/devtest/demo-shop.git") {
  mkdirSync(staged.project, { recursive: true });
  writeFileSync(path.join(staged.project, "devos.config.json"), `${JSON.stringify({ base_branch: "main", agents }, null, 2)}\n`);
  spawnSync("git", ["init", "-q"], { cwd: staged.project, env: staged.env, windowsHide: true });
  if (remote) spawnSync("git", ["remote", "add", "origin", remote], { cwd: staged.project, env: staged.env, windowsHide: true });
  return staged.project;
}

function devos(staged, args, variables) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    windowsHide: true,
    cwd: staged.project,
    env: { ...staged.env, ...(variables === undefined ? {} : { STUB_VARIABLES: JSON.stringify(variables) }) },
  });
}

function ghCalls(staged) {
  const file = staged.env.DEVOS_GH_LOG;
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
}

test("models.test.mjs (a) each model variable replaces one role's model, keeps its tool, and a bad id changes nothing", () => {
  const cfg = { base_branch: "main", agents: AGENTS };
  const env = { DEVOS_REVIEWER_MODEL: "claude-opus-5-6", DEVOS_REVIEWER_LIGHT_MODEL: "claude-haiku-5-5", DEVOS_BUILDER_MODEL: "grok-5" };
  const { config, notes } = withModelOverrides(cfg, env);
  assert.deepEqual(config.agents.reviewer, { id: "claude-deep", tool: "claude", model: "claude-opus-5-6" });
  assert.deepEqual(config.agents.reviewer_light, { id: "claude-light", tool: "claude", model: "claude-haiku-5-5" });
  assert.deepEqual(config.agents.pool.map((item) => [item.id, item.tool, item.model]), [
    ["cursor-grok", "cursor", "grok-5"],
    ["claude-build", "claude", "claude-sonnet-5-5"],
  ]);
  assert.deepEqual(notes, [
    "reviewer model claude-opus-5-6 from DEVOS_REVIEWER_MODEL",
    "light reviewer model claude-haiku-5-5 from DEVOS_REVIEWER_LIGHT_MODEL",
    "builder cursor-grok model grok-5 from DEVOS_BUILDER_MODEL",
  ]);
  assert.equal(cfg.agents.reviewer.model, "claude-opus-5-5", "the configured agents are not changed");
  assert.equal(config.base_branch, "main");

  assert.deepEqual(withModelOverrides(cfg, { DEVOS_BUILDER_MODEL: "", DEVOS_REVIEWER_MODEL: "  " }), { config: { ...cfg, agents: AGENTS }, notes: [] });
  const bad = withModelOverrides(cfg, { DEVOS_BUILDER_MODEL: "grok 5; rm -rf" });
  assert.equal(bad.config.agents.pool[0].model, "grok-4.7");
  assert.deepEqual(bad.notes, ["DEVOS_BUILDER_MODEL is not a model id; the configured model is used"]);

  const { reviewer_light: _light, ...noLight } = AGENTS;
  const made = withModelOverrides({ agents: noLight }, { DEVOS_REVIEWER_LIGHT_MODEL: "claude-haiku-5-5" });
  assert.deepEqual(made.config.agents.reviewer_light, { id: "claude-deep-light", tool: "claude", model: "claude-haiku-5-5" });
  assert.deepEqual(withModelOverrides({ base_branch: "main" }, env), { config: { base_branch: "main" }, notes: [] });
});

test("models.test.mjs (b) the runner's agents.mjs reports the model a variable chose, and the configured one without it", () => {
  const staged = stage();
  try {
    const installed = spawnSync(process.execPath, [bin, "install", staged.project, "--key", "DEMO"], { encoding: "utf8", env: staged.env, windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const agents = (args, extra = {}) => spawnSync(process.execPath, [path.join(staged.project, "scripts", "devos", "agents.mjs"), ...args], {
      encoding: "utf8",
      cwd: staged.project,
      windowsHide: true,
      env: { ...staged.env, GITHUB_OUTPUT: "", DEVOS_REVIEWER_MODEL: "", DEVOS_REVIEWER_LIGHT_MODEL: "", DEVOS_BUILDER_MODEL: "", ...extra },
    });
    const plain = agents(["pick", "--task", "T01"]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^builder_model=grok-4\.7$/m);
    const picked = agents(["pick", "--task", "T01"], { DEVOS_BUILDER_MODEL: "grok-5" });
    assert.match(picked.stdout, /^builder_tool=cursor$/m);
    assert.match(picked.stdout, /^builder_model=grok-5$/m);
    assert.match(picked.stdout, /^builder_note=no Builder line; using cursor-grok; builder cursor-grok model grok-5 from DEVOS_BUILDER_MODEL$/m);
    const deep = agents(["reviewer", "--mode", "deep"], { DEVOS_REVIEWER_MODEL: "claude-opus-5-6" });
    assert.match(deep.stdout, /^reviewer_model=claude-opus-5-6$/m);
    assert.match(deep.stdout, /^reviewer_note=reviewer model claude-opus-5-6 from DEVOS_REVIEWER_MODEL$/m);
    const light = agents(["reviewer", "--mode", "light"], { DEVOS_REVIEWER_MODEL: "claude-opus-5-6" });
    assert.match(light.stdout, /^reviewer_model=claude-sonnet-5-5$/m);
    assert.match(light.stdout, /^reviewer_note=$/m);
  } finally {
    cleanup(staged.parent);
  }
});

test("models.test.mjs (c) devos models shows each role, the variable that changes it, and the model the next run uses", () => {
  const staged = stage();
  try {
    project(staged);
    const shown = devos(staged, ["models"], [{ name: "DEVOS_BUILDER_MODEL", value: "grok-5" }, { name: "DEVOS_VERCEL", value: "true" }]);
    assert.equal(shown.status, 0, shown.stdout);
    assert.equal(shown.stdout, [
      "Models of devtest/demo-shop (each cycle run reads them when it starts):",
      "reviewer  claude · claude-opus-5-5",
      "light     claude · claude-sonnet-5-5",
      "builder   cursor · grok-5 — DEVOS_BUILDER_MODEL (configured: grok-4.7)",
      "Change one: devos models set <reviewer|light|builder> <model> · back to the configured model: devos models reset <role>",
      "",
    ].join("\n"));
    assert.deepEqual(ghCalls(staged), ["variable list --repo devtest/demo-shop --json name,value"]);

    const { reviewer_light: _light, ...noLight } = AGENTS;
    writeFileSync(path.join(staged.project, "devos.config.json"), `${JSON.stringify({ agents: noLight }, null, 2)}\n`);
    const inherited = devos(staged, ["models"], [{ name: "DEVOS_REVIEWER_MODEL", value: "claude-opus-5-6" }]);
    assert.match(inherited.stdout, /^reviewer {2}claude · claude-opus-5-6 — DEVOS_REVIEWER_MODEL \(configured: claude-opus-5-5\)$/m);
    assert.match(inherited.stdout, /^light {5}claude · claude-opus-5-6 \(the reviewer reviews light tasks too\)$/m);

    assert.deepEqual(["https://github.com/a-b/c.d.git", "git@github.com:a-b/c_d.git", "ssh://git@github.com/a/b", "https://gitlab.com/a/b.git"].map(slugFromRemote),
      ["a-b/c.d", "a-b/c_d", "a/b", ""]);
  } finally {
    cleanup(staged.parent);
  }
});

test("models.test.mjs (d) devos models set and reset change only the variable, and refuse a bad role, a bad id or a folder without a repository", () => {
  const staged = stage();
  try {
    project(staged);
    const set = devos(staged, ["models", "set", "builder", "grok-5"], []);
    assert.equal(set.status, 0, set.stdout);
    assert.equal(set.stdout, "devos: DEVOS_BUILDER_MODEL is grok-5 on devtest/demo-shop; the next cycle run uses cursor · grok-5\n");
    const reset = devos(staged, ["models", "reset", "builder"], [{ name: "DEVOS_BUILDER_MODEL", value: "grok-5" }]);
    assert.equal(reset.status, 0, reset.stdout);
    assert.equal(reset.stdout, "devos: DEVOS_BUILDER_MODEL removed on devtest/demo-shop; the next cycle run uses the configured cursor · grok-4.7\n");
    const unset = devos(staged, ["models", "reset", "reviewer"], []);
    assert.equal(unset.stdout, "devos: DEVOS_REVIEWER_MODEL is not set on devtest/demo-shop; the configured claude · claude-opus-5-5 is in use\n");
    assert.deepEqual(ghCalls(staged).filter((line) => !line.startsWith("variable list")), [
      "variable set DEVOS_BUILDER_MODEL --body grok-5 --repo devtest/demo-shop",
      "variable delete DEVOS_BUILDER_MODEL --repo devtest/demo-shop",
    ]);
    const before = ghCalls(staged).length;
    const role = devos(staged, ["models", "set", "boss", "grok-5"]);
    assert.equal(role.status, 2);
    assert.equal(role.stdout, "devos: models: \"boss\" is not a role: use reviewer, light or builder\n");
    const id = devos(staged, ["models", "set", "builder", "grok 5"]);
    assert.equal(id.status, 2);
    assert.equal(id.stdout, "devos: models: \"grok 5\" is not a model id\n");
    const usage = devos(staged, ["models", "set", "builder"]);
    assert.equal(usage.status, 2);
    assert.match(usage.stdout, /^devos: usage: devos models \[folder\]/);
    assert.equal(ghCalls(staged).length, before, "a refused command calls gh not at all");
    spawnSync("git", ["remote", "remove", "origin"], { cwd: staged.project, env: staged.env, windowsHide: true });
    const lost = devos(staged, ["models"]);
    assert.equal(lost.status, 1);
    assert.equal(lost.stdout, "devos: models: this project has no GitHub repository yet (git remote origin); finish devos continue first\n");
  } finally {
    cleanup(staged.parent);
  }
});

test("models.test.mjs (e) setup offers each agent tool's second account key, optional, right after its first", () => {
  const both = { reviewer: { tool: "claude" }, pool: [{ tool: "cursor" }] };
  assert.deepEqual(neededKeys(setup, { deploy: "none" }, both).map((key) => [key.name, key.optional]), [
    ["CURSOR_API_KEY", false],
    ["CURSOR_API_KEY_2", true],
    ["CLAUDE_CODE_OAUTH_TOKEN", false],
    ["CLAUDE_CODE_OAUTH_TOKEN_2", true],
  ]);
  const others = { reviewer: { tool: "codex" }, pool: [{ tool: "gemini" }] };
  const keys = neededKeys(setup, { deploy: "none" }, others);
  assert.deepEqual(keys.map((key) => [key.name, key.optional]), [
    ["OPENAI_API_KEY", false],
    ["OPENAI_API_KEY_2", true],
    ["GEMINI_API_KEY", false],
    ["GEMINI_API_KEY_2", true],
  ]);
  for (const key of keys.filter((item) => item.optional)) assert.match(key.where, /^Optional: a second .* account.*usage limit/);
});
