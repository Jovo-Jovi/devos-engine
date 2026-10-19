import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args, cwd, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

function fields(text) {
  const out = {};
  for (const line of text.split(/\n/)) {
    const index = line.indexOf("=");
    if (index > 0) out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

const PHASES = `| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |
|---|---|---|---|---|---|---|---|
| T01 | E | 1 | One | 1 | — | [ ] | — |
| T02 | E | 1 | Two | 2 | — | [ ] | — |
`;

test("agents.test.mjs pool choice, reviewer model, builder family and workflow lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-agents-"));
  try {
    const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(staged.status, 0, staged.stderr);
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), PHASES);
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    const writeProject = (extra) => {
      const project = { ...JSON.parse(template.replaceAll("__PROJECT_KEY__", "DEMO")), ...extra };
      writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
      const written = run(path.join(dir, "scripts", "devos", "config.mjs"), ["--write"], dir);
      assert.equal(written.status, 0, written.stderr);
    };
    const agents = path.join(dir, "scripts", "devos", "agents.mjs");

    writeProject({});
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "- Builder: grok-4.7 · Effort: high · Fast: no\n");
    const legacy = run(agents, ["pick", "--task", "T01"], dir);
    assert.equal(legacy.status, 0, legacy.stderr);
    const legacyFields = fields(legacy.stdout);
    assert.equal(legacyFields.builder_id, "cursor-grok");
    assert.equal(legacyFields.builder_note, "builder grok-4.7 is not in the pool; using cursor-grok");

    writeProject({
      agents: {
        pool: [
          { id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "" },
          { id: "cursor-sonnet", tool: "cursor", model: "claude-4.5-sonnet", default: false, note: "" },
        ],
      },
    });
    writeFileSync(path.join(dir, "docs", "fences", "T02.md"), "- Builder: cursor-sonnet · Effort: high · Fast: no\n");
    const named = run(agents, ["pick", "--task", "T02"], dir);
    assert.equal(named.status, 0, named.stderr);
    const namedFields = fields(named.stdout);
    assert.equal(namedFields.builder_id, "cursor-sonnet");
    assert.equal(namedFields.builder_model, "claude-4.5-sonnet");
    assert.equal(namedFields.builder_note, "");

    writeProject({ agents: { policy: "always-default" } });
    const forced = run(agents, ["pick", "--task", "T02"], dir);
    assert.equal(forced.status, 0, forced.stderr);
    const forcedFields = fields(forced.stdout);
    assert.equal(forcedFields.builder_id, "cursor-grok");
    assert.equal(forcedFields.builder_note, "");

    writeProject({});
    const configPath = path.join(dir, "devos.config.json");
    const generated = JSON.parse(readFileSync(configPath, "utf8"));
    generated.agents.reviewer_light = null;
    writeFileSync(configPath, `${JSON.stringify(generated, null, 2)}\n`);
    const light = run(agents, ["reviewer", "--mode", "light"], dir);
    assert.equal(light.status, 0, light.stderr);
    const lightFields = fields(light.stdout);
    assert.equal(lightFields.reviewer_model, "claude-opus-5-5");
    assert.equal(lightFields.reviewer_tool, "claude");

    writeProject({});
    writeFileSync(path.join(dir, "models.txt"), "claude-4.5-sonnet\n");
    const built = run(
      path.join(dir, "scripts", "devos", "builder-model.mjs"),
      ["--task", "T01", "--models-file", "models.txt"],
      dir,
      { DEVOS_BUILDER_FAMILY: "claude-4.5-sonnet" },
    );
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fields(built.stdout).model, "claude-4.5-sonnet");

    const reviewed = run(path.join(dir, "scripts", "devos", "review-mode.mjs"), ["--task", "T01", "--attempt", "1"], dir);
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.equal(fields(reviewed.stdout).model, "claude-sonnet-5-5");
    assert.equal(fields(reviewed.stdout).mode, "light");

    const rendered = run(path.join(dir, "scripts", "devos", "render-prompt.mjs"), ["reviewer", "T01", "1"], dir);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(rendered.stdout.includes("- cursor-grok — cursor · grok-4.7 · default — default builder"), true, rendered.stdout);

    const workflow = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8");
    assert.equal(workflow.includes('agent -p --force --trust --approve-mcps --model "$MODEL" --output-format stream-json'), true);
    assert.equal(workflow.includes("claude -p"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
