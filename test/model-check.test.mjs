import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLine, checkRoles, judgeModel, loadTools, modelLine, newerModels, offeredIds, offeredModels } from "../lib/model-check.mjs";
import { modelsCheckCommand } from "../lib/models.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E75: `devos models check`, the page's check and the engine's list refresh. Each tool's list comes from the tool
// itself, its provider's models API (a key from the environment, sent only there) or the engine's list; a newer model
// of the same line is suggested, and switched only on --apply or the page's Use.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

const AGENTS = {
  reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
  reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5" },
  pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true }],
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

const ghCalls = (staged) => (existsSync(staged.env.DEVOS_GH_LOG) ? readFileSync(staged.env.DEVOS_GH_LOG, "utf8").trim().split("\n").filter(Boolean) : []);

/** A stand-in for the providers' models APIs: it records each call (address and headers) and answers from `lists`. */
function fakeFetch(lists, calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    const host = new URL(url).host;
    const ids = lists[host];
    if (!ids) return { ok: false, status: 401, json: async () => ({}) };
    const body = host === "generativelanguage.googleapis.com"
      ? { models: ids.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] })) }
      : { data: ids.map((id) => ({ id })) };
    return { ok: true, status: 200, json: async () => body };
  };
}

test("model-check.test.mjs (a) a model id as its line and version, and how a model stands against a list", () => {
  assert.deepEqual(modelLine("claude-fable-5-1"), { family: "claude-fable", line: "claude-fable|", version: [5, 1], dated: false });
  assert.deepEqual(modelLine("claude-fable-5-1-thinking-high"), { family: "claude-fable", line: "claude-fable|thinking-high", version: [5, 1], dated: false });
  assert.deepEqual(modelLine("claude-sonnet-4-5-20250929"), { family: "claude-sonnet", line: "claude-sonnet|", version: [4, 5], dated: true });
  assert.deepEqual(modelLine("gpt-5.6-sol"), { family: "gpt", line: "gpt|sol", version: [5, 6], dated: false });
  assert.deepEqual(modelLine("grok-4.7-high"), { family: "grok", line: "grok|high", version: [4, 7], dated: false });
  assert.deepEqual(modelLine("gemini-3.1-pro"), { family: "gemini", line: "gemini|pro", version: [3, 1], dated: false });
  for (const id of ["auto", "o3", "5-turbo", ""]) assert.equal(modelLine(id), null, id);

  const offered = ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-4-5-20250929", "claude-sonnet-4-5", "claude-sonnet-4-6-20260101"];
  assert.deepEqual(judgeModel("claude-fable-5-2", offered), { status: "current", suggestion: "" });
  assert.deepEqual(judgeModel("claude-fable-5-1", offered), { status: "newer", suggestion: "claude-fable-5-2" });
  // Never across lines: Opus stays Opus, whatever Fable does.
  assert.deepEqual(judgeModel("claude-opus-5-5", offered), { status: "current", suggestion: "" });
  assert.deepEqual(judgeModel("claude-opus-5-4", offered), { status: "newer", suggestion: "claude-opus-5-5" });
  // A live list that leaves a model out: gone, with its line's newest; the engine's list only says it cannot tell.
  assert.deepEqual(judgeModel("claude-haiku-5-5", offered), { status: "gone", suggestion: "" });
  assert.deepEqual(judgeModel("claude-haiku-5-5", offered, false), { status: "unknown", suggestion: "" });
  assert.deepEqual(judgeModel("claude-sonnet-4-5", ["claude-sonnet-4-6-20260101", "claude-sonnet-4-5"]), { status: "newer", suggestion: "claude-sonnet-4-6-20260101" });
  assert.deepEqual(judgeModel("auto", ["auto", "grok-4.7"]), { status: "current", suggestion: "" });
  assert.deepEqual(judgeModel("grok-4.7", null), { status: "unknown", suggestion: "" });
  // Cursor names a model with its effort and speed (grok-4.7-high); the cycle adds the fence's effort to the role's model,
  // so a model listed only that way is offered, and a newer one is suggested without an ending.
  const cursorList = ["auto", "grok-4.7-high", "grok-4.7-xhigh-fast", "grok-4.7-fast-low", "claude-opus-5-5-high"];
  assert.deepEqual(offeredIds(cursorList), ["auto", "grok-4.7-high", "grok-4.7", "grok-4.7-xhigh-fast", "grok-4.7-fast-low", "claude-opus-5-5-high", "claude-opus-5-5"]);
  assert.deepEqual(judgeModel("grok-4.7", cursorList), { status: "current", suggestion: "" });
  assert.deepEqual(judgeModel("claude-opus-5-5", cursorList), { status: "current", suggestion: "" });
  assert.deepEqual(judgeModel("grok-4.7", ["grok-4.8-high", ...cursorList]), { status: "newer", suggestion: "grok-4.8" });
  assert.deepEqual(judgeModel("grok-4.7-xhigh-fast", ["grok-4.8-xhigh-fast", ...cursorList]), { status: "newer", suggestion: "grok-4.8-xhigh-fast" });
  assert.deepEqual(judgeModel("grok-3", ["grok-4.7-high"]), { status: "newer", suggestion: "grok-4.7" });
  assert.deepEqual(judgeModel("composer-2.5", cursorList), { status: "gone", suggestion: "" });
  // The engine's refresh: only newer lines and new lines of a family it lists, never older or dated ones.
  assert.deepEqual(newerModels(["claude-fable-5-1", "claude-opus-5-5", "gpt-5.5"], ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-4-5", "claude-opus-5-5-20261001", "gpt-5.6-sol", "gpt-4o", "o3"]),
    ["gpt-5.6-sol", "claude-fable-5-2"]);
  assert.deepEqual(newerModels(["grok-4.7", "grok-4.7-high"], ["grok-4.8-high", "grok-4.7-high"]), ["grok-4.8", "grok-4.8-high"]);
});

test("model-check.test.mjs (b) each tool's list: the tool's own, its provider's with a key from the environment, else the engine's", async () => {
  const tools = loadTools();
  const calls = [];
  const fetcher = fakeFetch({ "api.anthropic.com": ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"], "api.openai.com": ["gpt-5.6-sol", "dall-e-4", "text-embedding-4", "whisper-2"], "generativelanguage.googleapis.com": ["gemini-4-argon", "gemini-embedding-2"] }, calls);
  const env = { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-openai-test", GOOGLE_API_KEY: "g-test" };
  const none = () => null;
  const claude = await offeredModels("claude", { env, fetcher, find: none, tools });
  assert.deepEqual([claude.source, claude.live, claude.ids], ["api", true, ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"]]);
  const codex = await offeredModels("codex", { env, fetcher, find: none, tools });
  assert.deepEqual(codex.ids, ["gpt-5.6-sol"]);
  const gemini = await offeredModels("gemini", { env, fetcher, find: none, tools });
  assert.deepEqual(gemini.ids, ["gemini-4-argon"]);
  // Each key went only to its own provider, in its own header.
  assert.deepEqual(calls.map((call) => [new URL(call.url).host, JSON.stringify(call.headers)]), [
    ["api.anthropic.com", JSON.stringify({ "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" })],
    ["api.openai.com", JSON.stringify({ authorization: "Bearer sk-openai-test" })],
    ["generativelanguage.googleapis.com", JSON.stringify({ "x-goog-api-key": "g-test" })],
  ]);
  // No key, or a refusal: the engine's list, and what to do; the key is never named by value.
  const bare = await offeredModels("claude", { env: {}, fetcher, find: none, tools });
  assert.deepEqual([bare.source, bare.live, bare.note], ["engine", false, "set ANTHROPIC_API_KEY to check against Anthropic's models API"]);
  assert.equal(bare.ids.includes("claude-fable-5-2"), true);
  const refused = await offeredModels("claude", { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetcher: fakeFetch({}, []), find: none, tools });
  assert.deepEqual([refused.source, refused.note], ["engine", "Anthropic's models API answered 401"]);
  assert.equal(JSON.stringify(refused).includes("sk-ant-test"), false);
  // A tool that lists its own models (Cursor `agent models`) is asked, and only it.
  const asked = [];
  const cursor = await offeredModels("cursor", { env, fetcher, tools, find: (name) => (name === "agent" ? { path: "/bin/agent" } : null), list: (command, args) => { asked.push([command, ...args]); return ["auto", "grok-4.8", "grok-4.7"]; } });
  assert.deepEqual([cursor.source, cursor.ids, asked], ["tool", ["auto", "grok-4.8", "grok-4.7"], [["/bin/agent", "models"]]]);
  const absent = await offeredModels("cursor", { env, fetcher, tools, find: none });
  assert.deepEqual([absent.source, absent.note], ["engine", "Cursor CLI is not installed here"]);
});

test("model-check.test.mjs (c) devos models check reports each role, and --apply switches only the newer ones through their variables", async () => {
  const staged = stage();
  const restore = useStubs(staged);
  startedProject(staged.project);
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    const deps = {
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      fetcher: fakeFetch({ "api.anthropic.com": ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-6", "claude-sonnet-5-5"] }, []),
      find: (name) => (name === "agent" ? { path: "/bin/agent" } : null),
      // Cursor's own list names its models with their effort, as `agent models` does.
      list: () => ["auto", "grok-4.8-high", "grok-4.8-xhigh-fast", "grok-4.7-high", "grok-4.7-xhigh-fast"],
    };
    assert.equal(await modelsCheckCommand([staged.project], staged.project, undefined, deps), 0);
    assert.deepEqual(logs, [
      "Models of devtest/demo-shop, against what each tool offers now:",
      "reviewer  claude · claude-opus-5-5 — the newest of its line (Anthropic's models API)",
      "light     claude · claude-sonnet-5-5 — newer: claude-sonnet-5-6 (Anthropic's models API)",
      "builder   cursor · grok-4.7 — newer: grok-4.8 (Cursor CLI's own list)",
      `Switch light to claude-sonnet-5-6, builder to grok-4.8: devos models check --apply ${staged.project} · one role: devos models set <role> <model>`,
    ]);
    assert.deepEqual(ghCalls(staged).filter((line) => !line.startsWith("variable list")), []);
    logs.length = 0;
    assert.equal(await modelsCheckCommand([staged.project, "--apply"], staged.project, undefined, deps), 0);
    assert.deepEqual(ghCalls(staged).filter((line) => !line.startsWith("variable list")), [
      "variable set DEVOS_REVIEWER_LIGHT_MODEL --body claude-sonnet-5-6 --repo devtest/demo-shop",
      "variable set DEVOS_BUILDER_MODEL --body grok-4.8 --repo devtest/demo-shop",
    ]);
    assert.equal(logs.includes("devos: DEVOS_BUILDER_MODEL is grok-4.8 on devtest/demo-shop; the next cycle run uses cursor · grok-4.8"), true, logs.join("\n"));
    assert.equal(logs.join("\n").includes("sk-ant-test"), false);
    // A light reviewer that is the reviewer follows it; a flag the command does not know is refused.
    assert.deepEqual(await checkRoles([{ role: "light", tool: "claude", effective: "claude-opus-5-5", inherited: true, override: "" }], deps), [
      { role: "light", tool: "claude", model: "claude-opus-5-5", status: "follows", suggestion: "", source: "", label: "", note: "" },
    ]);
    assert.equal(checkLine({ role: "builder", tool: "cursor", model: "grok-3", status: "gone", suggestion: "grok-4.8", label: "Cursor CLI's own list", note: "" }),
      "builder   cursor · grok-3 — not offered any more; the newest of its line is grok-4.8 (Cursor CLI's own list)");
    assert.equal(await modelsCheckCommand([staged.project, "--yes"], staged.project, undefined, deps), 2);
  } finally {
    console.log = original;
    restore();
    cleanup(staged.parent);
  }
});

test("model-check.test.mjs (d) the page's check: GET /api/models?check=1 adds each role's result, and the panel offers Use", async () => {
  // A stand-in `agent` first on PATH lists nothing, so the builder is judged against the engine's list on every computer,
  // with or without the Cursor CLI installed.
  const staged = stage({ tools: ["agent"] });
  const restore = useStubs(staged);
  startedProject(staged.project);
  const realFetch = globalThis.fetch;
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  // Anthropic's models API is the stand-in; every other request (the test's own, to the page) goes through.
  globalThis.fetch = (url, init) => (String(url).startsWith("https://api.anthropic.com/")
    ? fakeFetch({ "api.anthropic.com": ["claude-opus-5-5", "claude-sonnet-5-6"] }, [])(url, init)
    : realFetch(url, init));
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const response = await realFetch(`http://127.0.0.1:${server.port}/api/models?check=1`, { headers: { "X-DEVOS-Token": server.token } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.check.map((item) => [item.role, item.status, item.suggestion, item.source]), [
      ["reviewer", "current", "", "api"],
      ["light", "newer", "claude-sonnet-5-6", "api"],
      ["builder", "current", "", "engine"],
    ]);
    assert.equal(body.check[2].note, "Cursor CLI did not list its models (signed in?)");
    assert.equal(JSON.stringify(body).includes("sk-ant-test"), false);
    const plain = await realFetch(`http://127.0.0.1:${server.port}/api/models`, { headers: { "X-DEVOS-Token": server.token } });
    assert.equal(Object.hasOwn(await plain.json(), "check"), false);
    const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
    for (const text of ["\"Check for newer models\"", "if (check) params.set(\"check\", \"1\");", "function checkNote(slot, folder, role, item) {", "text: `Use ${item.suggestion}`"]) {
      assert.equal(js.includes(text), true, text);
    }
  } finally {
    await server.close();
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
    restore();
    cleanup(staged.parent);
  }
});

test("model-check.test.mjs (e) tools/models-refresh.mjs adds the newer models a live list has, first in their group, and removes none", { skip: windows && "not rehearsed on Windows: it loads a stand-in fetch into a child process" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-refresh-"));
  try {
    const file = path.join(dir, "tools.json");
    writeFileSync(file, readFileSync(path.join(root, "lib", "data", "tools.json")));
    const stub = path.join(dir, "fetch-stub.mjs");
    writeFileSync(stub, `globalThis.fetch = async (url) => {
  if (!String(url).startsWith("https://api.anthropic.com/")) return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ data: ["claude-fable-5-3", "claude-fable-5-2", "claude-opus-5-5", "claude-opus-4-1", "claude-sonnet-5-5-20261101"].map((id) => ({ id })) }) };
};
`);
    // Only node on PATH: no tool lists its own models, so only Claude Code is checked, through its provider.
    const env = { PATH: path.dirname(process.execPath), ANTHROPIC_API_KEY: "sk-ant-test" };
    const run = (...extra) => spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, path.join(root, "tools", "models-refresh.mjs"), "--file", file, ...extra], { encoding: "utf8", env, windowsHide: true });
    const looked = run();
    assert.equal(looked.status, 0, looked.stderr);
    const claudeLine = looked.stdout.split("\n").find((line) => line.startsWith("claude:"));
    assert.ok(claudeLine.startsWith("claude: Anthropic's models API, 5 models; newer: claude-fable-5-3; not listed now: "), claudeLine);
    assert.equal(looked.stdout.includes("cursor: not checked (Cursor CLI is not installed here)"), true, looked.stdout);
    assert.equal(looked.stdout.includes("sk-ant-test"), false);
    assert.equal(readFileSync(file, "utf8"), readFileSync(path.join(root, "lib", "data", "tools.json"), "utf8"));
    const wrote = run("--write");
    assert.equal(wrote.status, 0, wrote.stderr);
    assert.equal(wrote.stdout.includes("models-refresh: 1 model added to "), true, wrote.stdout);
    const after = JSON.parse(readFileSync(file, "utf8")).tools;
    const before = JSON.parse(readFileSync(path.join(root, "lib", "data", "tools.json"), "utf8")).tools;
    const claude = after.find((tool) => tool.id === "claude").seedGroups.find((group) => group.id === "claude").models;
    assert.deepEqual(claude, ["claude-fable-5-3", ...before.find((tool) => tool.id === "claude").seedGroups.find((group) => group.id === "claude").models]);
    // Every other tool's list is as it was.
    assert.deepEqual(after.filter((tool) => tool.id !== "claude"), before.filter((tool) => tool.id !== "claude"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
