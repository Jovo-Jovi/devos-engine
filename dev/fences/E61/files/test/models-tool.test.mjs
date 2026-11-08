import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { agentMessage, setAgent, toolSecrets } from "../lib/fallbacks.mjs";
import { familyOf, groupModels } from "../lib/probes.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { firstDifference, jsonText, merge } from "../payload/files/scripts/devos/config.mjs";
import { validate } from "../payload/files/scripts/devos/agents.mjs";
import { heavyReasons } from "../payload/files/scripts/devos/heavy.mjs";
import { reviewPlan } from "../payload/files/scripts/devos/review-mode.mjs";
import { cleanup, stage } from "./harness.mjs";

// E60 (PR-86): a role moves to another tool and model by pull request, once the repository has the new tool's key;
// Cursor's cursor-grok-* ids are Grok; Claude Code's effort takes max; and the builder's effort is never lowered quietly.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const SLUG = "devtest/demo-shop";
const PULL = "https://github.com/devtest/demo-shop/pull/7";
const defaultsText = readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8");
const defaults = JSON.parse(defaultsText);

function project(withLight = true) {
  const agents = {
    reviewer: { id: "claude-deep", tool: "claude", model: "opus-x", fallback_models: ["sonnet-x"] },
    pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
    policy: "reviewer-picks",
  };
  agents.reviewer_light = withLight ? { id: "claude-light", tool: "claude", model: "sonnet-x" } : null;
  return { project: "DEMO-SHOP", agents };
}

// A project folder with its generated config and a GitHub origin, and the same three files on GitHub (`remote`).
function setUp(staged, { withLight = true, remote } = {}) {
  const value = project(withLight);
  const config = merge(defaults, value);
  mkdirSync(path.join(staged.project, "devos"), { recursive: true });
  writeFileSync(path.join(staged.project, "devos", "project.json"), jsonText(value));
  writeFileSync(path.join(staged.project, "devos.config.json"), jsonText(config));
  writeFileSync(path.join(staged.project, "devos", "answers.json"), "{}\n");
  writeFileSync(path.join(staged.project, "devos", "engine.lock.json"), `${JSON.stringify({ engine_version: "1.2.0" })}\n`);
  for (const args of [["init", "-q"], ["remote", "add", "origin", `https://github.com/${SLUG}.git`]]) {
    assert.equal(spawnSync("git", args, { cwd: staged.project, windowsHide: true }).status, 0);
  }
  onGitHub(remote ?? value);
  return value;
}

function onGitHub(value) {
  process.env.STUB_REMOTE_FILES = JSON.stringify({ "devos/project.json": jsonText(value), "devos/engine.defaults.json": defaultsText, "devos.config.json": jsonText(merge(defaults, value)) });
}

const NAMES = ["PATH", "DEVOS_GH_LOG", "STUB_REMOTE_FILES", "STUB_REF", "STUB_VARIABLES", "STUB_SECRETS", "STUB_DEFAULT_BRANCH"];
function useStubs(staged) {
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  for (const name of NAMES.slice(2)) delete process.env[name];
  process.env.PATH = staged.env.PATH;
  process.env.DEVOS_GH_LOG = staged.env.DEVOS_GH_LOG;
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function calls(staged) {
  return readFileSync(staged.env.DEVOS_GH_LOG, "utf8").split("\n").filter(Boolean);
}

function puts(staged) {
  return calls(staged).filter((line) => line.startsWith("input ")).map((line) => {
    const body = JSON.parse(line.slice("input ".length));
    return { ...body, text: Buffer.from(body.content, "base64").toString("utf8") };
  });
}

const writes = (staged) => calls(staged).filter((line) => line.includes("-X POST") || line.includes("-X PUT") || line.startsWith("pr create"));

function fields(text) {
  const out = {};
  for (const line of text.split(/\n/)) {
    const index = line.indexOf("=");
    if (index > 0 && !line.startsWith("::")) out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

test("models-tool.test.mjs (a) Cursor's cursor-grok-* models are listed under Grok, not Other families", () => {
  assert.equal(familyOf("cursor-grok-4.7-high"), "grok");
  assert.equal(familyOf("Cursor-Grok-4.7-xhigh-fast"), "grok");
  assert.equal(familyOf("cursor-claude-opus-5-5"), "claude");
  assert.equal(familyOf("cursor-small"), "other");
  const seeds = [{ id: "grok", label: "Grok — Cursor first-party", models: ["grok-4.7"] }];
  const groups = groupModels(seeds, ["grok-4.7", "cursor-grok-4.7-high", "cursor-grok-4.7-xhigh-fast", "cursor-small"]);
  assert.deepEqual(groups.map((group) => [group.id, group.models.map((model) => model.id)]), [
    ["grok", ["grok-4.7", "cursor-grok-4.7-high", "cursor-grok-4.7-xhigh-fast"]],
    ["other", ["cursor-small"]],
  ]);
});

test("models-tool.test.mjs (b) the builder runs the Fast id at the same effort before another, and says when its effort changes (PR-86)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-model-fast-"));
  try {
    const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true });
    assert.equal(staged.status, 0, staged.stderr);
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n|---|---|---|---|---|---|---|---|\n| T01 | E | 1 | One | 3 | — | [ ] | — |\n");
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    writeFileSync(path.join(dir, "devos", "project.json"), template.replaceAll("__PROJECT_KEY__", "DEMO"));
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(written.status, 0, written.stderr);
    const run = (effort, models) => {
      writeFileSync(path.join(dir, "docs", "fences", "T01.md"), `- Builder: cursor-grok · Effort: ${effort} · Fast: no\n`);
      writeFileSync(path.join(dir, "models.txt"), models);
      const result = spawnSync(process.execPath, ["scripts/devos/builder-model.mjs", "--task", "T01", "--models-file", "models.txt"], {
        cwd: dir,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, GITHUB_OUTPUT: "", DEVOS_BUILDER_FAMILY: "grok-4.7" },
      });
      assert.equal(result.status, 0, result.stderr);
      return { ...fields(result.stdout), stdout: result.stdout };
    };
    const normal = run("xhigh", "grok-4.7-high\ngrok-4.7-xhigh\ngrok-4.7-xhigh-fast\n");
    assert.deepEqual([normal.model, normal.effort, normal.fast, normal.note], ["grok-4.7-xhigh", "xhigh", "no", ""]);
    const fast = run("xhigh", "grok-4.7-high\ngrok-4.7-xhigh-fast\n");
    assert.deepEqual([fast.model, fast.effort, fast.fast, fast.source], ["grok-4.7-xhigh-fast", "xhigh", "yes", "fence"]);
    assert.equal(fast.note, "no xhigh id at normal speed is listed; running grok-4.7-xhigh-fast, the same effort at Fast speed");
    assert.equal(fast.stdout.includes("::warning"), false);
    const lowered = run("xhigh", "grok-4.7-high\ngrok-4.7-high-fast\n");
    assert.deepEqual([lowered.model, lowered.effort, lowered.fast], ["grok-4.7-high", "high", "no"]);
    const said = "the builder's effort was lowered from xhigh to high: `agent models` lists none of grok-4.7-xhigh, grok-4.7-xhigh-fast, grok-4.7-fast-xhigh, so grok-4.7-high runs";
    assert.equal(lowered.note, said);
    assert.equal(lowered.stdout.split("\n")[0], `::warning title=Dev OS::${said} (PR-86)`);
    const raised = run("low", "grok-4.7-high\n");
    assert.deepEqual([raised.model, raised.effort], ["grok-4.7-high", "high"]);
    assert.equal(raised.note.startsWith("the builder's effort was raised from low to high: "), true, raised.note);
    const same = run("high", "grok-4.7-xhigh\n");
    assert.deepEqual([same.model, same.effort, same.note], ["grok-4.7-high", "high", "none of grok-4.7-high, grok-4.7, grok-4.7-high-fast, grok-4.7-fast-high is listed by `agent models`; using grok-4.7-high"]);
    assert.equal(same.stdout.includes("::warning"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("models-tool.test.mjs (c) a role moves to another tool by pull request: devos/project.json and the config made from it, without its old next models", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const before = setUp(staged);
    const localProject = readFileSync(path.join(staged.project, "devos", "project.json"), "utf8");
    const result = setAgent(staged.project, "reviewer", "cursor", "grok-4.7-high");
    assert.deepEqual(result, { ok: true, slug: SLUG, role: "reviewer", tool: "cursor", model: "grok-4.7-high", previous: { tool: "claude", model: "opus-x" }, dropped: ["sonnet-x"], pull: PULL, unchanged: false });
    assert.deepEqual(calls(staged).filter((line) => !line.startsWith("input ")).map((line) => line.replace(/ --(input|body-file) .*$/, " --$1 <file>")), [
      `api repos/${SLUG} --jq .default_branch`,
      `api repos/${SLUG}/contents/devos/project.json?ref=main`,
      `api repos/${SLUG}/contents/devos.config.json?ref=main`,
      `api repos/${SLUG}/contents/devos/engine.defaults.json?ref=main`,
      `variable list --repo ${SLUG} --json name,value`,
      `secret list --repo ${SLUG} --json name`,
      `api repos/${SLUG}/git/ref/heads/main --jq .object.sha`,
      `api repos/${SLUG}/git/refs -X POST -f ref=refs/heads/devos/models-reviewer -f sha=${"a".repeat(40)}`,
      `api repos/${SLUG}/contents/devos/project.json -X PUT --input <file>`,
      `api repos/${SLUG}/contents/devos.config.json -X PUT --input <file>`,
      `pr create --repo ${SLUG} --base main --head devos/models-reviewer --title DEV_OS models: the reviewer runs cursor · grok-4.7-high --body-file <file>`,
    ]);
    const [projectPut, configPut] = puts(staged);
    assert.deepEqual([projectPut.branch, configPut.branch], ["devos/models-reviewer", "devos/models-reviewer"]);
    const expected = JSON.parse(JSON.stringify(before));
    expected.agents.reviewer = { id: "claude-deep", tool: "cursor", model: "grok-4.7-high" };
    assert.equal(projectPut.text, jsonText(expected));
    assert.equal(configPut.text, jsonText(merge(defaults, expected)));
    assert.equal(firstDifference(merge(defaults, expected), JSON.parse(configPut.text)), null);
    assert.equal(validate(JSON.parse(configPut.text).agents).reviewer.tool, "cursor");
    assert.equal(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"), localProject);
    assert.equal(agentMessage(result), `the pull request ${PULL} moves the reviewer from claude · opus-x to cursor · grok-4.7-high, without its next models (sonnet-x: claude's); merge it on GitHub to use it from the next cycle run, then pull this folder`);

    // Another model of the same tool needs no key check, and a next model it becomes leaves the list.
    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    const sameTool = setAgent(staged.project, "reviewer", "claude", "sonnet-x");
    assert.deepEqual([sameTool.ok, sameTool.dropped], [true, []]);
    assert.equal(calls(staged).some((line) => line.startsWith("secret list")), false);
    const kept = JSON.parse(JSON.stringify(before));
    kept.agents.reviewer = { id: "claude-deep", tool: "claude", model: "sonnet-x" };
    assert.equal(puts(staged)[0].text, jsonText(kept));

    // The builder keeps its id and fixed effort; Fast is Cursor's alone.
    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    const fixed = JSON.parse(JSON.stringify(before));
    fixed.agents.pool[0] = { ...fixed.agents.pool[0], effort: "xhigh", fast: true };
    onGitHub(fixed);
    const builder = setAgent(staged.project, "builder", "claude", "claude-sonnet-5-5");
    assert.equal(builder.ok, true, builder.error);
    assert.deepEqual(JSON.parse(puts(staged)[0].text).agents.pool[0], { id: "cursor-grok", tool: "claude", model: "claude-sonnet-5-5", default: true, note: "default builder", effort: "xhigh" });
    assert.equal(calls(staged).some((line) => line.includes("--head devos/models-builder --title DEV_OS models: the default builder runs claude · claude-sonnet-5-5")), true);

    // The same tool and model change nothing.
    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    onGitHub(before);
    const same = setAgent(staged.project, "light", "claude", "sonnet-x");
    assert.deepEqual(same, { ok: true, slug: SLUG, role: "light", tool: "claude", model: "sonnet-x", previous: { tool: "claude", model: "sonnet-x" }, dropped: [], pull: "", unchanged: true });
    assert.equal(agentMessage(same), "the light reviewer already runs claude · sonnet-x on devtest/demo-shop; nothing to change");
    assert.deepEqual(writes(staged), []);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("models-tool.test.mjs (d) a move is refused without the new tool's key, with the role's model variable set, for a shared light reviewer, at effort max, or with agents the runner refuses", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const before = setUp(staged);
    assert.deepEqual(toolSecrets("codex"), ["OPENAI_API_KEY", "OPENAI_API_KEY_2"]);
    process.env.STUB_SECRETS = '[{"name":"CURSOR_API_KEY"},{"name":"CLAUDE_CODE_OAUTH_TOKEN"}]';
    assert.deepEqual(setAgent(staged.project, "reviewer", "codex", "gpt-5.5"), {
      ok: false,
      error: "devtest/demo-shop has no key for Codex: add the repository secret OPENAI_API_KEY (or OPENAI_API_KEY_2) on GitHub (Settings → Secrets and variables → Actions), then try again",
    });
    process.env.STUB_SECRETS = '[{"name":"OPENAI_API_KEY_2"}]';
    assert.equal(setAgent(staged.project, "reviewer", "codex", "gpt-5.5").ok, true);
    delete process.env.STUB_SECRETS;

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    process.env.STUB_VARIABLES = '[{"name":"DEVOS_REVIEWER_MODEL","value":"opus-y"}]';
    assert.deepEqual(setAgent(staged.project, "reviewer", "cursor", "grok-4.7-high"), {
      ok: false,
      error: "DEVOS_REVIEWER_MODEL is opus-y on devtest/demo-shop, and it would replace grok-4.7-high: remove it first (devos models reset reviewer), then try again",
    });
    delete process.env.STUB_VARIABLES;

    const max = JSON.parse(JSON.stringify(before));
    max.reviewer = { modes: { deep: { effort: "max" } }, gate_effort: "max" };
    onGitHub(max);
    assert.deepEqual(setAgent(staged.project, "reviewer", "cursor", "grok-4.7-high"), {
      ok: false,
      error: "the reviewer reviews at effort max, which only Claude Code takes: set reviewer.modes.deep.effort and reviewer.gate_effort to xhigh or lower in devos/project.json first",
    });
    assert.equal(setAgent(staged.project, "reviewer", "claude", "fable-x").ok, true);

    const twoTools = JSON.parse(JSON.stringify(before));
    twoTools.agents.pool.push({ id: "claude-b", tool: "claude", model: "sonnet-b", default: false, note: "other" });
    twoTools.agents.fallback_builder = "claude-b";
    onGitHub(twoTools);
    assert.deepEqual(setAgent(staged.project, "builder", "claude", "claude-sonnet-5-5"), {
      ok: false,
      error: "the change would leave agents the runner refuses: agents: fallback_builder must name a pool builder whose tool is not the default builder's",
    });
    assert.deepEqual(writes(staged).filter((line) => line.includes("models-builder")), []);

    assert.deepEqual(setAgent(staged.project, "boss", "cursor", "grok-4.7"), { ok: false, usage: true, error: "\"boss\" is not a role: use reviewer, light or builder" });
    assert.deepEqual(setAgent(staged.project, "builder", "muse", "m-1"), { ok: false, usage: true, error: "\"muse\" is not a cycle tool: use cursor, claude, codex or gemini" });
    assert.deepEqual(setAgent(staged.project, "builder", "claude", "a b"), { ok: false, usage: true, error: "\"a b\" is not a model id" });
  } finally {
    restore();
    cleanup(staged.parent);
  }
  const shared = stage();
  const back = useStubs(shared);
  try {
    setUp(shared, { withLight: false });
    writeFileSync(shared.env.DEVOS_GH_LOG, "");
    assert.deepEqual(setAgent(shared.project, "light", "cursor", "grok-4.7-high"), { ok: false, error: "this project has no light reviewer of its own: light reviews use the reviewer's agent, so change the reviewer's" });
    assert.deepEqual(calls(shared), []);
  } finally {
    back();
    cleanup(shared.parent);
  }
});

test("models-tool.test.mjs (e) devos models tool, the page server and the Models panel open the same pull request", async () => {
  const staged = stage();
  const restore = useStubs(staged);
  setUp(staged);
  const devos = (args) => spawnSync(process.execPath, [bin, "models", ...args], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: process.env });
  const server = await startUiServer({ folder: staged.project, port: 0 });
  const address = `http://127.0.0.1:${server.port}`;
  const call = async (body) => {
    const response = await fetch(`${address}/api/agent`, { method: "POST", headers: { "X-DEVOS-Token": server.token, Origin: address, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const shown = devos([]);
    assert.match(shown.stdout, /^Another tool \(by pull request, once the repository has its key\): devos models tool <role> <tool> <model>$/m);
    const opened = devos(["tool", "builder", "codex", "gpt-5.5"]);
    assert.deepEqual([opened.status, opened.stdout], [1, "devos: models: devtest/demo-shop has no key for Codex: add the repository secret OPENAI_API_KEY (or OPENAI_API_KEY_2) on GitHub (Settings → Secrets and variables → Actions), then try again\n"]);
    const moved = devos(["tool", "reviewer", "cursor", "grok-4.7-high"]);
    assert.equal(moved.status, 0, moved.stdout + moved.stderr);
    assert.equal(moved.stdout, `devos: the pull request ${PULL} moves the reviewer from claude · opus-x to cursor · grok-4.7-high, without its next models (sonnet-x: claude's); merge it on GitHub to use it from the next cycle run, then pull this folder\n`);
    const wrong = devos(["tool", "reviewer", "muse", "m-1"]);
    assert.deepEqual([wrong.status, wrong.stdout], [2, "devos: models: \"muse\" is not a cycle tool: use cursor, claude, codex or gemini\n"]);
    const usage = devos(["tool", "reviewer"]);
    assert.equal(usage.status, 2);
    assert.match(usage.stdout, /devos models tool <reviewer\|light\|builder> <cursor\|claude\|codex\|gemini> <model> \[folder\]/);

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    for (const body of [{ role: "light" }, { role: "light", tool: "cursor" }, { role: "light", tool: "cursor", model: 7 }, ["light"]]) {
      assert.deepEqual(await call(body), { status: 400, body: { ok: false, errors: ["Send a role, a tool and a model id."] } });
    }
    assert.deepEqual(await call({ role: "light", tool: "muse", model: "m-1" }), { status: 400, body: { ok: false, errors: ["\"muse\" is not a cycle tool: use cursor, claude, codex or gemini."] } });
    assert.deepEqual(writes(staged), []);
    assert.deepEqual(await call({ role: "light", tool: "cursor", model: "grok-4.7-high" }), {
      status: 200,
      body: { ok: true, message: "A pull request moves the light reviewer from claude · sonnet-x to cursor · grok-4.7-high; merge it on GitHub to use it from the next cycle run, then pull this folder.", pull: PULL },
    });
    const noOrigin = await fetch(`${address}/api/agent`, { method: "POST", headers: { "X-DEVOS-Token": server.token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noOrigin.status, 403);
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    "function toolEditor(slot, folder, role, label) {",
    "text: \"Another tool\", \"aria-expanded\": \"false\"",
    "api(\"/api/agent\", { method: \"POST\", body })",
    "for (const tool of cycleTools()) tools.append(el(\"option\", { value: tool.id, text: tool.label }));",
    "Another tool needs its key as a repository secret first, and its next models are cleared: they were the old tool's.",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});

test("models-tool.test.mjs (f) Max is Claude Code's: the page offers it, a max review stays max on a retry, and the method says so (PR-86)", () => {
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    "const MAX_EFFORT = [\"max\", \"Max\"];",
    "const levels = agent.tool === \"claude\" ? [...EFFORT_LEVELS, MAX_EFFORT] : EFFORT_LEVELS;",
    "Max is Claude Code's alone: the longest thinking, and the most of your plan.",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
  const cfg = (deep, light = "medium", gate = undefined) => ({ reviewer: { gate_effort: gate, modes: { light: { model: "s", effort: light }, deep: { model: "o", effort: deep } } } });
  const risky = { task: "T05", risk: 3, gate: "—" };
  const plain = { task: "T06", risk: 1, gate: "—" };
  const gated = { task: "T07", risk: 2, gate: "G1" };
  const maxRetry = reviewPlan(risky, [], 2, cfg("max"));
  assert.deepEqual([maxRetry.effort, maxRetry.reasons], ["max", ["risk 3"]]);
  assert.equal(reviewPlan(plain, [], 2, cfg("high", "xhigh")).effort, "xhigh");
  assert.deepEqual(reviewPlan(plain, [], 2, cfg("high", "medium")).reasons, ["retry: effort raised to high"]);
  assert.equal(reviewPlan(gated, [], 3, cfg("high", "medium", "max")).effort, "max");
  assert.deepEqual(heavyReasons(gated, { reviewer: { gate_model: "o", gate_effort: "max", model_by_risk: {} } }), ["review by o", "review at max effort", "closes gate G1"]);

  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const precedents = read("payload/files/docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("| PR-86 | **A role moves to another tool only by the developer's pull request; effort is never changed quietly.**"), true);
  const manual = read("payload/files/docs/method/AUTOMATION.md");
  assert.equal(manual.includes("Another tool (PR-86): `devos models tool <role> <tool> <model>`, or the guided page's"), true);
  assert.equal(manual.includes("`reviewer.modes.*.effort` and `gate_effort` may be `max`; a retry raises the effort one step up to `xhigh`, and"), true);
  assert.equal(read("README.md").includes("| `devos models tool <role> <tool> <model>` |"), true);
  const changes = read("CHANGELOG.md");
  for (const line of ["- **A role can move to another tool (PR-86).**", "- **Max effort for Claude Code.**", "- **The builder's effort is never lowered quietly.**", "- **Cursor's `cursor-grok-*` models are listed under Grok,**"]) {
    assert.equal(changes.includes(line), true, line);
  }
});
