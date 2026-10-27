import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fallbackBranch, fallbackMessage, listProblem, parseList, setFallbacks } from "../lib/fallbacks.mjs";
import { modelsState } from "../lib/models.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { firstDifference, jsonText, merge } from "../payload/files/scripts/devos/config.mjs";
import { validate } from "../payload/files/scripts/devos/agents.mjs";
import { cleanup, stage } from "./harness.mjs";

// E26c2 (PR-64): a role's next models (fallback_models) are shown by devos models and the guided page's Models panel,
// and changed by a pull request on the project's GitHub repository: devos/project.json and the generated
// devos.config.json, on devos/models-<role>, through the GitHub API. The folder on this computer is not touched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const SLUG = "devtest/demo-shop";
const defaultsText = readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8");
const defaults = JSON.parse(defaultsText);

function project(withLight = true) {
  const agents = {
    reviewer: { id: "claude-deep", tool: "claude", model: "opus-x", fallback_models: ["sonnet-x"] },
    pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
    policy: "reviewer-picks",
  };
  // A project without a light reviewer of its own says so with null, as devos init writes it.
  agents.reviewer_light = withLight ? { id: "claude-light", tool: "claude", model: "sonnet-x" } : null;
  return { project: "DEMO-SHOP", agents };
}

// A project folder with its generated config and a GitHub origin, and the same three files on GitHub.
function setUp(staged, withLight = true) {
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
  process.env.STUB_REMOTE_FILES = JSON.stringify({ "devos/project.json": jsonText(value), "devos/engine.defaults.json": defaultsText, "devos.config.json": jsonText(config) });
  return value;
}

const NAMES = ["PATH", "DEVOS_GH_LOG", "STUB_REMOTE_FILES", "STUB_REF", "STUB_VARIABLES", "STUB_DEFAULT_BRANCH"];
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

test("fallbacks.test.mjs (a) a list of next models: up to 4 model ids, none twice and not the role's own", () => {
  assert.deepEqual([parseList("a, b,c"), parseList(" none "), parseList(""), parseList("x")], [["a", "b", "c"], [], [], ["x"]]);
  assert.equal(listProblem("reviewer", ["a", "b"], "opus-x"), "");
  assert.equal(listProblem("boss", ["a"]), "\"boss\" is not a role: use reviewer, light or builder");
  assert.equal(listProblem("builder", ["a", "b", "c", "d", "e"]), "give up to 4 model ids, or none");
  assert.equal(listProblem("builder", ["a b"]), "\"a b\" is not a model id");
  assert.equal(listProblem("builder", ["a", "a"]), "a model is listed twice");
  assert.equal(listProblem("reviewer", ["opus-x"], "opus-x"), "opus-x is the reviewer's own model; list only the models to try after it");
  assert.equal(fallbackBranch("light"), "devos/models-light");
  assert.equal(fallbackMessage({ role: "builder", slug: SLUG, models: ["a", "b"], pull: "https://github.com/devtest/demo-shop/pull/7", unchanged: false }),
    "the pull request https://github.com/devtest/demo-shop/pull/7 gives the default builder the next models a, b; merge it on GitHub to use them from the next cycle run, then pull this folder");
  assert.equal(fallbackMessage({ role: "reviewer", slug: SLUG, models: [], unchanged: true }), "the reviewer already has no next models on devtest/demo-shop; nothing to change");
});

test("fallbacks.test.mjs (b) a change is a pull request with devos/project.json and the config made from it, and the folder is not touched", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const before = setUp(staged);
    const localProject = readFileSync(path.join(staged.project, "devos", "project.json"), "utf8");
    const result = setFallbacks(staged.project, "builder", ["gpt-5.5", "sonnet-y"]);
    assert.deepEqual(result, { ok: true, slug: SLUG, role: "builder", models: ["gpt-5.5", "sonnet-y"], pull: "https://github.com/devtest/demo-shop/pull/7", unchanged: false });
    assert.deepEqual(calls(staged).filter((line) => !line.startsWith("input ")).map((line) => line.replace(/ --(input|body-file) .*$/, " --$1 <file>")), [
      `api repos/${SLUG} --jq .default_branch`,
      `api repos/${SLUG}/contents/devos/project.json?ref=main`,
      `api repos/${SLUG}/contents/devos.config.json?ref=main`,
      `api repos/${SLUG}/contents/devos/engine.defaults.json?ref=main`,
      `api repos/${SLUG}/git/ref/heads/main --jq .object.sha`,
      `api repos/${SLUG}/git/refs -X POST -f ref=refs/heads/devos/models-builder -f sha=${"a".repeat(40)}`,
      `api repos/${SLUG}/contents/devos/project.json -X PUT --input <file>`,
      `api repos/${SLUG}/contents/devos.config.json -X PUT --input <file>`,
      `pr create --repo ${SLUG} --base main --head devos/models-builder --title DEV_OS models: the default builder tries gpt-5.5, sonnet-y after grok-4.7 --body-file <file>`,
    ]);
    const [projectPut, configPut] = puts(staged);
    assert.deepEqual([projectPut.branch, projectPut.sha, configPut.branch, configPut.sha], ["devos/models-builder", "b".repeat(40), "devos/models-builder", "b".repeat(40)]);
    const after = JSON.parse(projectPut.text);
    const expected = JSON.parse(JSON.stringify(before));
    expected.agents.pool[0].fallback_models = ["gpt-5.5", "sonnet-y"];
    assert.deepEqual(after, expected);
    assert.equal(projectPut.text, jsonText(expected));
    // The config is the one config.mjs --write makes, so guard:config passes and the runner accepts its agents.
    const config = JSON.parse(configPut.text);
    assert.equal(configPut.text, jsonText(merge(defaults, expected)));
    assert.equal(firstDifference(merge(defaults, after), config), null);
    assert.equal(validate(config.agents), config.agents);
    assert.equal(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"), localProject);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("fallbacks.test.mjs (c) an empty list removes them, the same list changes nothing, and a shared light reviewer or an open branch is refused", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const before = setUp(staged);
    assert.deepEqual(setFallbacks(staged.project, "reviewer", ["sonnet-x"]), { ok: true, slug: SLUG, role: "reviewer", models: ["sonnet-x"], pull: "", unchanged: true });
    assert.equal(calls(staged).some((line) => line.includes("-X POST") || line.includes("-X PUT") || line.startsWith("pr create")), false);

    assert.equal(setFallbacks(staged.project, "reviewer", []).ok, true);
    const cleared = JSON.parse(puts(staged)[0].text);
    const expected = JSON.parse(JSON.stringify(before));
    delete expected.agents.reviewer.fallback_models;
    assert.deepEqual(cleared, expected);
    assert.equal(calls(staged).some((line) => line.includes("--title DEV_OS models: the reviewer has no next models")), true);

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    process.env.STUB_REF = "fail";
    assert.deepEqual(setFallbacks(staged.project, "light", ["haiku-x"]), {
      ok: false,
      error: "GitHub did not create the branch devos/models-light in devtest/demo-shop. A pull request for the light reviewer's models may be open: merge or close it and delete the branch, then try again.",
    });
    assert.equal(calls(staged).some((line) => line.includes("-X PUT")), false);
    delete process.env.STUB_REF;

    assert.deepEqual(setFallbacks(staged.project, "reviewer", ["opus-x"]), { ok: false, usage: true, error: "opus-x is the reviewer's own model; list only the models to try after it" });
  } finally {
    restore();
    cleanup(staged.parent);
  }
  const shared = stage();
  const back = useStubs(shared);
  try {
    setUp(shared, false);
    writeFileSync(shared.env.DEVOS_GH_LOG, "");
    assert.deepEqual(setFallbacks(shared.project, "light", ["haiku-x"]), { ok: false, error: "this project has no light reviewer of its own: light reviews use the reviewer's models, so change the reviewer's" });
    assert.deepEqual(calls(shared), []);
  } finally {
    back();
    cleanup(shared.parent);
  }
});

test("fallbacks.test.mjs (d) devos models shows each role's next models, and devos models fallback opens the pull request", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    setUp(staged);
    const state = modelsState(staged.project);
    assert.deepEqual(state.roles.map((role) => [role.role, role.fallbacks]), [["reviewer", ["sonnet-x"]], ["light", []], ["builder", []]]);
    const devos = (args) => spawnSync(process.execPath, [bin, "models", ...args], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: process.env });
    const shown = devos([]);
    assert.equal(shown.status, 0, shown.stdout + shown.stderr);
    assert.match(shown.stdout, /^reviewer  claude · opus-x; then sonnet-x$/m);
    assert.match(shown.stdout, /^Next models at a usage limit \(by pull request\): devos models fallback <role> <model,model…\|none>$/m);
    const opened = devos(["fallback", "builder", "gpt-5.5,sonnet-y"]);
    assert.equal(opened.status, 0, opened.stdout + opened.stderr);
    assert.equal(opened.stdout, "devos: the pull request https://github.com/devtest/demo-shop/pull/7 gives the default builder the next models gpt-5.5, sonnet-y; merge it on GitHub to use them from the next cycle run, then pull this folder\n");
    const wrong = devos(["fallback", "builder", "a,a"]);
    assert.deepEqual([wrong.status, wrong.stdout], [2, "devos: models: a model is listed twice\n"]);
    const usage = devos(["fallback", "builder"]);
    assert.equal(usage.status, 2);
    assert.match(usage.stdout, /devos models fallback <reviewer\|light\|builder> <model,model…\|none> \[folder\]/);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("fallbacks.test.mjs (e) the page server lists next models and changes them only by pull request", async () => {
  const staged = stage();
  const restore = useStubs(staged);
  setUp(staged);
  const server = await startUiServer({ folder: staged.project, port: 0 });
  const address = `http://127.0.0.1:${server.port}`;
  const call = async (method, route, body) => {
    const headers = { "X-DEVOS-Token": server.token };
    if (method !== "GET") Object.assign(headers, { Origin: address, "Content-Type": "application/json" });
    const response = await fetch(`${address}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const read = await call("GET", "/api/models");
    assert.deepEqual(read.body.roles.map((role) => role.fallbacks), [["sonnet-x"], [], []]);
    for (const body of [{ role: "builder" }, { role: "builder", models: "a" }, { role: "builder", models: [1] }, ["builder"]]) {
      assert.deepEqual(await call("POST", "/api/fallbacks", body), { status: 400, body: { ok: false, errors: ["Send a role and a list of model ids."] } });
    }
    assert.deepEqual(await call("POST", "/api/fallbacks", { role: "builder", models: ["a", "a"] }), { status: 400, body: { ok: false, errors: ["A model is listed twice."] } });
    assert.equal(calls(staged).some((line) => line.includes("-X PUT")), false);
    const saved = await call("POST", "/api/fallbacks", { role: "light", models: ["haiku-x"] });
    assert.deepEqual(saved, { status: 200, body: { ok: true, message: "A pull request gives the light reviewer the next models haiku-x; merge it on GitHub to use them from the next cycle run, then pull this folder.", pull: "https://github.com/devtest/demo-shop/pull/7" } });
    const noOrigin = await fetch(`${address}/api/fallbacks`, { method: "POST", headers: { "X-DEVOS-Token": server.token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noOrigin.status, 403);
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
});

test("fallbacks.test.mjs (f) the Models panel shows each role's next models and edits them by pull request", () => {
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    "function fallbacksEditor(slot, folder, role, label) {",
    "`Next models at a usage limit: ${fallbacks.length ? fallbacks.join(\", then \") : \"none\"}.`",
    "text: \"Next models\", \"aria-expanded\": \"false\"",
    "api(\"/api/fallbacks\", { method: \"POST\", body })",
    "text: \"Save by pull request\"",
    "list.length >= 4",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});
