import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { engineRoot } from "../lib/engine.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E25b (PR-63): the guided page's Models panel. GET and POST /api/models read and change a started project's models
// through lib/models.mjs: gh variable list, set and delete; nothing is committed. Each test file runs in its own
// process, so the fake gh is put on this process's PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "lib", "ui");

const AGENTS = {
  reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
  reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5" },
  pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
  policy: "reviewer-picks",
};

function startedProject(folder) {
  mkdirSync(path.join(folder, "devos"), { recursive: true });
  writeFileSync(path.join(folder, "devos", "answers.json"), "{}\n");
  writeFileSync(path.join(folder, "devos", "engine.lock.json"), "{}\n");
  writeFileSync(path.join(folder, "devos.config.json"), `${JSON.stringify({ agents: AGENTS }, null, 2)}\n`);
  spawnSync("git", ["init", "-q"], { cwd: folder, windowsHide: true });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/devtest/demo-shop.git"], { cwd: folder, windowsHide: true });
}

function useStubs(staged) {
  const saved = { PATH: process.env.PATH, DEVOS_GH_LOG: process.env.DEVOS_GH_LOG, STUB_VARIABLES: process.env.STUB_VARIABLES };
  process.env.PATH = staged.env.PATH;
  process.env.DEVOS_GH_LOG = staged.env.DEVOS_GH_LOG;
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function ghCalls(staged) {
  const file = staged.env.DEVOS_GH_LOG;
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
}

async function call(server, method, query = "", body = undefined) {
  const origin = `http://127.0.0.1:${server.port}`;
  const headers = { "X-DEVOS-Token": server.token };
  if (method !== "GET") Object.assign(headers, { Origin: origin, "Content-Type": "application/json" });
  const response = await fetch(`${origin}/api/models${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("ui-models.test.mjs (a) the page reads a started project's models and changes one variable at a time, with gh only", async () => {
  const staged = stage();
  const restore = useStubs(staged);
  startedProject(staged.project);
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    process.env.STUB_VARIABLES = JSON.stringify([{ name: "DEVOS_BUILDER_MODEL", value: "grok-5" }]);
    const read = await call(server, "GET");
    assert.equal(read.status, 200);
    assert.equal(read.body.ok, true);
    assert.equal(read.body.slug, "devtest/demo-shop");
    assert.deepEqual(read.body.roles.map((role) => [role.role, role.name, role.tool, role.configured, role.override, role.effective]), [
      ["reviewer", "DEVOS_REVIEWER_MODEL", "claude", "claude-opus-5-5", "", "claude-opus-5-5"],
      ["light", "DEVOS_REVIEWER_LIGHT_MODEL", "claude", "claude-sonnet-5-5", "", "claude-sonnet-5-5"],
      ["builder", "DEVOS_BUILDER_MODEL", "cursor", "grok-4.7", "grok-5", "grok-5"],
    ]);

    const set = await call(server, "POST", "", { role: "reviewer", model: "claude-opus-5-6" });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { ok: true, message: "DEVOS_REVIEWER_MODEL is claude-opus-5-6 on devtest/demo-shop; the next cycle run uses claude · claude-opus-5-6." });
    const reset = await call(server, "POST", "", { role: "builder", model: null });
    assert.deepEqual(reset.body, { ok: true, message: "DEVOS_BUILDER_MODEL removed on devtest/demo-shop; the next cycle run uses the configured cursor · grok-4.7." });
    assert.deepEqual(ghCalls(staged).filter((line) => !line.startsWith("variable list")), [
      "variable set DEVOS_REVIEWER_MODEL --body claude-opus-5-6 --repo devtest/demo-shop",
      "variable delete DEVOS_BUILDER_MODEL --repo devtest/demo-shop",
    ]);

    const before = ghCalls(staged).length;
    for (const [body, error] of [
      [{ role: "boss", model: "grok-5" }, "\"boss\" is not a role: use reviewer, light or builder."],
      [{ role: "builder", model: "grok 5" }, "\"grok 5\" is not a model id."],
      [{ role: "builder", model: 5 }, "Send a model id, or null to go back to the configured model."],
      [["builder"], "The request is not a JSON object."],
    ]) {
      const refused = await call(server, "POST", "", body);
      assert.equal(refused.status, 400, JSON.stringify(body));
      assert.deepEqual(refused.body, { ok: false, errors: [error] });
    }
    assert.equal(ghCalls(staged).length, before, "a refused change calls gh not at all");
    const noToken = await fetch(`http://127.0.0.1:${server.port}/api/models`);
    assert.equal(noToken.status, 401);
    const noOrigin = await fetch(`http://127.0.0.1:${server.port}/api/models`, {
      method: "POST",
      headers: { "X-DEVOS-Token": server.token, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "builder", model: "grok-5" }),
    });
    assert.equal(noOrigin.status, 403);
    assert.equal(spawnSync("git", ["log", "-1"], { cwd: staged.project, windowsHide: true }).status === 0, false, "nothing was committed");
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
});

test("ui-models.test.mjs (b) without a folder, the page names one by its full path, outside the engine, and started", async () => {
  const staged = stage();
  const restore = useStubs(staged);
  startedProject(staged.project);
  const loose = path.join(staged.parent, "loose");
  mkdirSync(loose);
  const server = await startUiServer({ folder: null, port: 0 });
  try {
    for (const [folder, error] of [
      ["relative/app", "The project folder must be a full path."],
      [path.join(engineRoot(), "inside-app"), "The project folder cannot be inside the engine's folder."],
      [loose, "That folder holds no started DEV_OS project."],
    ]) {
      const read = await call(server, "GET", `?folder=${encodeURIComponent(folder)}`);
      assert.deepEqual([read.status, read.body], [200, { ok: false, errors: [error] }], folder);
      const change = await call(server, "POST", "", { folder, role: "builder", model: "grok-5" });
      assert.deepEqual([change.status, change.body], [400, { ok: false, errors: [error] }], folder);
    }
    const read = await call(server, "GET", `?folder=${encodeURIComponent(staged.project)}`);
    assert.equal(read.body.ok, true);
    assert.equal(read.body.roles[2].effective, "grok-4.7");
    spawnSync("git", ["remote", "remove", "origin"], { cwd: staged.project, windowsHide: true });
    const lost = await call(server, "GET", `?folder=${encodeURIComponent(staged.project)}`);
    assert.deepEqual(lost.body, { ok: false, errors: ["This project has no GitHub repository yet (git remote origin); finish devos continue first."] });
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
});

test("ui-models.test.mjs (c) the page offers Models on every started project, and changes a model from the tool's list", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  for (const text of [
    "function projectRow(folder) {",
    "function modelsSection(folder) {",
    "`/api/models${query}`",
    "\"/api/models\", { method: \"POST\", body }",
    "Models of this project",
    "Use this model",
    "Back to the configured model",
    "modelGroups(role.tool)",
    "nothing is committed",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
  assert.equal((js.match(/projectRow\((project|got)\.folder\)/g) ?? []).length, 2);
  assert.equal(js.includes("modelsSection(hub.folder)"), true, "E26a: the Models button sits on the project's page");
  for (const rule of [".project-actions {", ".models-slot:not(:empty) {", ".model-change {"]) assert.equal(css.includes(rule), true, rule);
});
