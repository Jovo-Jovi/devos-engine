import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { neededKeys } from "../lib/keys.mjs";
import { buildAnswers, validatePlan } from "../lib/plan.mjs";
import { cleanup, flow, init, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const signedIn = [{ toolId: "claude", status: "installed", signedIn: true }];

function validPlan() {
  return {
    accepted: true,
    contract_version: CONTRACT_VERSION,
    link: false,
    agents: {
      reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
      reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5" },
      pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
      policy: "reviewer-picks",
    },
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

function runPlan(staged, plan, input, extraEnv = {}) {
  const file = path.join(staged.parent, "plan.json");
  writeFileSync(file, `${JSON.stringify(plan)}\n`);
  return spawnSync(process.execPath, [bin, "init", "--plan", file, staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: { ...staged.env, ...extraEnv },
  });
}

test("plan.test.mjs (a) buildAnswers matches a terminal init", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    const built = buildAnswers(
      {
        name: written.name,
        brief: written.brief,
        users: written.users,
        languages: written.languages,
        visibility: written.visibility,
      },
      { type: written.type, stack: written.stack, modules: written.modules, scope: written.scope },
      written.blueprint_agent,
      [],
    );
    delete written.attachments;
    delete built.attachments;
    assert.deepEqual(Object.keys(built), Object.keys(written));
    assert.deepEqual(built, written);
  } finally {
    cleanup(staged.parent);
  }
});

test("plan.test.mjs (b) validatePlan rejects each broken plan with one error", () => {
  const unnamed = validPlan();
  unnamed.fields.name = "!!";
  const glm = validPlan();
  glm.agents.reviewer.tool = "glm";
  const python = validPlan();
  python.project = { type: "api", stack: "fastapi", modules: { database: "supabase" }, scope: "mvp" };
  const declined = validPlan();
  declined.accepted = false;
  const unsigned = validPlan();
  const cases = [
    validatePlan(unnamed, signedIn),
    validatePlan(glm, signedIn),
    validatePlan(python, signedIn),
    validatePlan(declined, signedIn),
    validatePlan(unsigned, [{ toolId: "claude", status: "installed", signedIn: false }]),
  ];
  for (const result of cases) {
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1, result.errors.join(" | "));
  }
});

test("plan.test.mjs (c) init --plan writes the same answers and stops before GitHub", () => {
  const terminal = stage();
  const planned = stage();
  try {
    const first = init(terminal, flow());
    assert.equal(first.status, 0, first.stderr);
    const answers = JSON.parse(readFileSync(path.join(terminal.project, "devos", "answers.json"), "utf8"));
    const agents = JSON.parse(readFileSync(path.join(terminal.project, "devos", "project.json"), "utf8")).agents;
    const setup = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));
    const keys = neededKeys(setup, answers, agents);
    const plan = validPlan();
    plan.agents = agents;
    plan.blueprint = answers.blueprint_agent;
    plan.project = { type: answers.type, stack: answers.stack, modules: answers.modules, scope: answers.scope };
    plan.fields = {
      name: answers.name,
      brief: answers.brief,
      users: answers.users,
      languages: answers.languages,
      visibility: answers.visibility,
    };
    const input = ["approve", ...keys.map(() => ""), "no"].join("\n") + "\n";
    const result = runPlan(planned, plan, input);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.includes("stopped before GitHub — nothing was created"), true, result.stdout);
    const written = JSON.parse(readFileSync(path.join(planned.project, "devos", "answers.json"), "utf8"));
    assert.deepEqual(written, answers);
  } finally {
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
});

test("plan.test.mjs (d) an invalid plan exits 2 and leaves the folder empty", () => {
  const staged = stage();
  try {
    const plan = validPlan();
    plan.accepted = false;
    const result = runPlan(staged, plan, "");
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.includes("devos: plan: "), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
  } finally {
    cleanup(staged.parent);
  }
});

function answersFromTerminal(staged) {
  const first = init(staged, flow());
  assert.equal(first.status, 0, first.stderr);
  const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
  const agents = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8")).agents;
  const setup = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));
  const plan = validPlan();
  plan.agents = agents;
  plan.blueprint = answers.blueprint_agent;
  plan.project = { type: answers.type, stack: answers.stack, modules: answers.modules, scope: answers.scope };
  plan.fields = {
    name: answers.name,
    brief: answers.brief,
    users: answers.users,
    languages: answers.languages,
    visibility: answers.visibility,
  };
  return { answers, plan, keys: neededKeys(setup, answers, agents) };
}

test("plan.test.mjs (e) plan mode prints the step and ask markers", () => {
  const terminal = stage();
  const planned = stage();
  try {
    const { keys, plan } = answersFromTerminal(terminal);
    const input = ["approve", ...keys.map(() => ""), "no"].join("\n") + "\n";
    const result = runPlan(planned, plan, input, { DEVOS_UI: "1" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = result.stdout.split(/\r?\n/).filter((line) => line !== "");
    assert.equal(lines.at(-1).startsWith("::devos-step "), true, lines.at(-1));
    const markers = lines.filter((line) => line.startsWith("::devos-")).map((line) => {
      const ask = line.startsWith("::devos-ask ");
      const body = JSON.parse(line.slice(ask ? "::devos-ask ".length : "::devos-step ".length));
      return { ask, body };
    });
    // The agent's live steps (activity) come between; the sequence of the setup is the rest.
    assert.equal(markers.some((item) => !item.ask && item.body.step === "activity"), true);
    const shown = markers.filter((item) => item.ask || item.body.step !== "activity");
    const names = shown.map((item) => (item.ask ? `ask:${item.body.kind}` : `step:${item.body.step}`));
    const expected = [
      "step:install",
      "step:blueprint",
      "ask:approve",
      "step:approved",
      "step:owner",
      "step:setup",
      "step:keys",
      ...keys.map(() => "ask:key"),
      "ask:create",
      "step:done",
    ];
    assert.deepEqual(names, expected);
    assert.equal(shown[2].body.round, 1);
    assert.equal(shown.at(-1).body.code, 0);
    for (const item of markers) {
      assert.equal(Object.hasOwn(item.body, "value"), false);
      assert.equal(JSON.stringify(item.body).includes('"no"'), false);
    }
  } finally {
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
});

test("plan.test.mjs (f) a terminal init prints no marker", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stderr);
    assert.equal(`${result.stdout}${result.stderr}`.includes("::devos-"), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("plan.test.mjs (g) a model listing row is not a model id", () => {
  const plan = validPlan();
  plan.blueprint.model = "claude-opus-5-5 - Claude Opus 5.5";
  plan.agents.pool[0].model = "grok-4.7-xhigh-fast - Grok 4.7 Extra High Fast";
  const result = validatePlan(plan, signedIn);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'The blueprint agent model "claude-opus-5-5 - Claude Opus 5.5" is not a model id. Pick one from the list the tool reports.',
    'The builder model "grok-4.7-xhigh-fast - Grok 4.7 Extra High Fast" is not a model id. Pick one from the list the tool reports.',
  ]);
});

test("plan.test.mjs (h) images and PDFs up to 20 MB, documents up to 1 MB, at most 30 files (PR-59, PR-60)", () => {
  const staged = stage();
  try {
    const file = (name, size) => {
      const at = path.join(staged.parent, name);
      writeFileSync(at, Buffer.alloc(size, 1));
      return at;
    };
    const MB = 1024 * 1024;
    const hero = file("ref hero.png", 20 * MB);
    const motion = file("ref-hover.gif", 10);
    const guide = file("brand-guide.pdf", 20 * MB);
    const notes = file("notes.md", MB);
    const ok = validatePlan({ ...validPlan(), attachments: [hero, motion, guide, notes] }, signedIn);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.deepEqual(ok.attachments.map((item) => item.name), ["ref-hero.png", "ref-hover.gif", "brand-guide.pdf", "notes.md"]);
    const big = file("big.webp", 20 * MB + 1);
    const svg = file("logo.svg", 10);
    const long = file("long.md", MB + 1);
    const refused = validatePlan({ ...validPlan(), attachments: [big, svg, long] }, signedIn);
    assert.deepEqual(refused.errors, [
      `${big} is not an attachment this engine accepts.`,
      `${svg} is not an attachment this engine accepts.`,
      `${long} is not an attachment this engine accepts.`,
    ]);
    const many = Array.from({ length: 31 }, (_, i) => file(`ref-${i + 1}.png`, 10));
    assert.deepEqual(validatePlan({ ...validPlan(), attachments: many }, signedIn).errors, ["A plan holds at most 30 attachments."]);
  } finally {
    cleanup(staged.parent);
  }
});
