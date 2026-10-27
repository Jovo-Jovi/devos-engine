import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cloneProject, compareVersions, engineRepository, hubState, parseRepositoryInput } from "../lib/hub.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E26a: a current project's page. It opens a DEV_OS project from this computer or clones one from GitHub (the gh
// account must own or administer it), and reads its setup, version, models and Control Tower link without changing
// it. Each test file runs in its own process, so the fake gh is put on this process's PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "lib", "ui");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const AGENTS = {
  reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
  pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
  policy: "reviewer-picks",
};

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "Devos Test", GIT_AUTHOR_EMAIL: "devos@example.com", GIT_COMMITTER_NAME: "Devos Test", GIT_COMMITTER_EMAIL: "devos@example.com" } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result;
}

// A set-up DEV_OS project: answers, lock, approved blueprint, generated config, one commit and a GitHub origin.
function setUpProject(folder, { engine = "1.0.0", link = false, origin = "https://github.com/devtest/demo-shop.git" } = {}) {
  mkdirSync(path.join(folder, "devos"), { recursive: true });
  mkdirSync(path.join(folder, ".claude"), { recursive: true });
  writeFileSync(path.join(folder, "devos", "answers.json"), `${JSON.stringify({ registry_link: link })}\n`);
  writeFileSync(path.join(folder, "devos", "engine.lock.json"), `${JSON.stringify({ engine_version: engine })}\n`);
  writeFileSync(path.join(folder, ".claude", "settings.json"), "{}\n");
  writeFileSync(path.join(folder, "devos.config.json"), `${JSON.stringify({ agents: AGENTS }, null, 2)}\n`);
  git(folder, ["init", "-q"]);
  git(folder, ["add", "-A"]);
  git(folder, ["commit", "-q", "-m", "set up"]);
  if (origin) git(folder, ["remote", "add", "origin", origin]);
}

function useStubs(staged, extra = {}) {
  const names = ["PATH", "DEVOS_GH_LOG", "HOME", "USERPROFILE", "STUB_LATEST", "STUB_VARIABLES", "STUB_REPO", "STUB_PERMISSION", "STUB_CONTENTS", "STUB_CLONE_FROM"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names.slice(4)) delete process.env[name];
  process.env.PATH = staged.env.PATH;
  process.env.DEVOS_GH_LOG = staged.env.DEVOS_GH_LOG;
  Object.assign(process.env, extra);
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("hub.test.mjs (a) a pasted GitHub address, versions and the engine's own repository", () => {
  assert.deepEqual(["https://github.com/you/your-app", "https://github.com/you/your-app.git/", "git@github.com:you/your-app.git", "you/your-app"].map((text) => parseRepositoryInput(text).slug),
    ["you/your-app", "you/your-app", "you/your-app", "you/your-app"]);
  for (const bad of ["", "your-app", "https://gitlab.com/you/your-app", "you/..", "https://github.com/you"]) {
    assert.equal(parseRepositoryInput(bad).error, "Paste the repository's GitHub address, such as https://github.com/you/your-app, or you/your-app.", bad);
  }
  assert.deepEqual([compareVersions("1.0.0", "1.1.0"), compareVersions("1.10.0", "1.9.9"), compareVersions("1.1.0", "1.1.0"), compareVersions("", "1.1.0")], [-1, 1, 0, null]);
  assert.equal(engineRepository(), "Jovo-Jovi/devos-engine");
});

test("hub.test.mjs (b) the page reads a project's setup, versions and Control Tower link, and changes nothing", () => {
  const staged = stage();
  const restore = useStubs(staged, { STUB_LATEST: "v9.9.9", STUB_VARIABLES: JSON.stringify([{ name: "DEVOS_REPORTING", value: "on" }]) });
  try {
    setUpProject(staged.project, { link: true });
    const head = git(staged.project, ["rev-parse", "HEAD"]).stdout;
    const state = hubState(staged.project);
    assert.deepEqual(state, {
      ok: true,
      folder: staged.project,
      name: "project",
      approved: true,
      committed: true,
      step: "check the repository, the keys and the first cycle on GitHub",
      versions: { project: "1.0.0", engine: version, latest: "9.9.9", latestError: "" },
      repository: "devtest/demo-shop",
      reporting: "on",
      reportingError: "",
      registryLink: true,
      contractVersion: "",
      paused: false,
    });
    // E28: the workflows skip every run while DEVOS_PAUSED is exactly "true".
    process.env.STUB_VARIABLES = JSON.stringify([{ name: "DEVOS_REPORTING", value: "on" }, { name: "DEVOS_PAUSED", value: "true" }]);
    assert.equal(hubState(staged.project).paused, true);
    process.env.STUB_VARIABLES = JSON.stringify([{ name: "DEVOS_PAUSED", value: "True" }]);
    assert.equal(hubState(staged.project).paused, false);
    process.env.STUB_VARIABLES = "[]";
    delete process.env.STUB_LATEST;
    const off = hubState(staged.project);
    assert.equal(off.reporting, "off");
    assert.deepEqual([off.versions.latest, off.versions.latestError], ["", "gh could not read the latest release of Jovo-Jovi/devos-engine"]);
    const calls = readFileSync(staged.env.DEVOS_GH_LOG, "utf8").trim().split("\n");
    assert.equal(calls.every((line) => line.startsWith("api repos/Jovo-Jovi/devos-engine/releases/latest") || line.startsWith("variable list --repo devtest/demo-shop")), true, calls.join("\n"));
    assert.equal(git(staged.project, ["rev-parse", "HEAD"]).stdout, head);
    assert.equal(git(staged.project, ["status", "--porcelain"]).stdout, "");
    assert.deepEqual(hubState(path.join(staged.parent, "nothing-here")), { ok: false, error: "That folder holds no started DEV_OS project." });
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("hub.test.mjs (c) a GitHub project is cloned only for its owner or an admin, and only when it is a DEV_OS project", () => {
  const staged = stage();
  const source = path.join(staged.parent, "source");
  const base = path.join(staged.parent, "devos-projects");
  const restore = useStubs(staged, { STUB_REPO: "full", STUB_CLONE_FROM: source });
  try {
    setUpProject(source, { origin: null });
    assert.deepEqual(cloneProject("not a url", base), { ok: false, error: "Paste the repository's GitHub address, such as https://github.com/you/your-app, or you/your-app." });
    process.env.STUB_REPO = "missing";
    assert.deepEqual(cloneProject("devtest/demo-shop", base), { ok: false, error: "GitHub has no repository devtest/demo-shop that your gh account can see." });
    process.env.STUB_REPO = "full";
    process.env.STUB_PERMISSION = "WRITE";
    assert.deepEqual(cloneProject("devtest/demo-shop", base), { ok: false, error: "Your gh account must own or administer devtest/demo-shop; it has write access." });
    delete process.env.STUB_PERMISSION;
    process.env.STUB_CONTENTS = "missing";
    assert.deepEqual(cloneProject("devtest/demo-shop", base), { ok: false, error: "devtest/demo-shop is not a DEV_OS project: its default branch has no devos/engine.lock.json." });
    delete process.env.STUB_CONTENTS;

    const target = path.join(base, "demo-shop");
    assert.deepEqual(cloneProject("https://github.com/devtest/demo-shop", base), { ok: true, slug: "devtest/demo-shop", folder: target, reused: false });
    assert.equal(git(target, ["remote", "get-url", "origin"]).stdout.trim(), "https://github.com/devtest/demo-shop.git");
    // Compared as JSON: a clone may check text out with CRLF (core.autocrlf on Windows), and the content is the same.
    assert.deepEqual(JSON.parse(readFileSync(path.join(target, "devos", "engine.lock.json"), "utf8")), { engine_version: "1.0.0" });
    assert.deepEqual(cloneProject("git@github.com:devtest/demo-shop.git", base), { ok: true, slug: "devtest/demo-shop", folder: target, reused: true });
    git(target, ["remote", "set-url", "origin", "https://github.com/someone/else.git"]);
    assert.deepEqual(cloneProject("devtest/demo-shop", base), { ok: false, error: `${target} already exists and is not a clone of devtest/demo-shop. Move it, or open it as a folder.` });
    const clones = readFileSync(staged.env.DEVOS_GH_LOG, "utf8").split("\n").filter((line) => line.startsWith("repo clone"));
    assert.deepEqual(clones, [`repo clone devtest/demo-shop ${target}`]);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("hub.test.mjs (d) the server reads a project's page and clones from GitHub only when the page chooses the folder", async () => {
  const staged = stage();
  const home = path.join(staged.parent, "home-dir");
  const source = path.join(staged.parent, "source");
  mkdirSync(home);
  const restore = useStubs(staged, { HOME: home, USERPROFILE: home, STUB_REPO: "full", STUB_CLONE_FROM: source, STUB_LATEST: `v${version}` });
  setUpProject(staged.project, { engine: version });
  setUpProject(source, { origin: null });
  const call = async (server, method, route, body) => {
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "X-DEVOS-Token": server.token };
    if (method !== "GET") Object.assign(headers, { Origin: origin, "Content-Type": "application/json" });
    const response = await fetch(`${origin}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const one = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const read = await call(one, "GET", "/api/hub");
    assert.equal(read.status, 200);
    assert.deepEqual([read.body.ok, read.body.repository, read.body.versions], [true, "devtest/demo-shop", { project: version, engine: version, latest: version, latestError: "" }]);
    const refused = await call(one, "POST", "/api/clone", { url: "devtest/demo-shop" });
    assert.deepEqual(refused, { status: 400, body: { ok: false, errors: ["This page was opened for one folder. Run devos ui without a folder to bring a project from GitHub."] } });
  } finally {
    await one.close();
  }
  const chooser = await startUiServer({ folder: null, port: 0 });
  try {
    for (const [body, error] of [[{ url: 5 }, "Send the repository's GitHub address."], [["devtest/demo-shop"], "Send the repository's GitHub address."]]) {
      assert.deepEqual(await call(chooser, "POST", "/api/clone", body), { status: 400, body: { ok: false, errors: [error] } });
    }
    const target = path.join(home, "devos-projects", "demo-shop");
    const cloned = await call(chooser, "POST", "/api/clone", { url: "https://github.com/devtest/demo-shop" });
    assert.deepEqual(cloned, { status: 200, body: { ok: true, slug: "devtest/demo-shop", folder: target, reused: false } });
    const opened = await call(chooser, "GET", `/api/hub?folder=${encodeURIComponent(target)}`);
    assert.deepEqual([opened.body.ok, opened.body.name, opened.body.versions.project], [true, "demo-shop", "1.0.0"]);
    const relative = await call(chooser, "GET", "/api/hub?folder=demo-shop");
    assert.deepEqual(relative.body, { ok: false, errors: ["The project folder must be a full path."] });
    const noToken = await fetch(`http://127.0.0.1:${chooser.port}/api/hub`);
    assert.equal(noToken.status, 401);
  } finally {
    await chooser.close();
    restore();
    cleanup(staged.parent);
  }
});

test("hub.test.mjs (e) after the computer check the page offers a new or a current project, and a current project has its page", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of [
    "SCREENS.current = () => {",
    "SCREENS.hub = () => {",
    "title: \"New project\"",
    "title: \"Current project\"",
    "Open a current project",
    "Clone and open",
    "`/api/hub${query}`",
    "\"/api/clone\", { method: \"POST\", body: { url } }",
    "Continue this project",
    "modelsSection(hub.folder)",
    "Math.max(0, stepIndex(now))",
    "Open this project",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});
