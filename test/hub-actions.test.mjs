import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { actionFacts, connectProject, decideActions, hubState, pullProject, upgradeProject } from "../lib/hub.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E26b: from a project's page, upgrade it by pull request, bring its folder up to date with GitHub, and connect it to
// the Control Tower by pull request after an explicit yes. Each action runs only when the page's facts allow it. Each
// test file runs in its own process, so the fake gh is put on this process's PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "lib", "ui");
const bin = path.join(root, "bin", "devos.mjs");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const SLUG = "devtest/demo-shop";
const GIT_ENV = { GIT_AUTHOR_NAME: "Devos Test", GIT_AUTHOR_EMAIL: "devos@example.com", GIT_COMMITTER_NAME: "Devos Test", GIT_COMMITTER_EMAIL: "devos@example.com" };

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, ...GIT_ENV } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result;
}

// A set-up DEV_OS project on branch main with one commit and a GitHub origin.
function setUpProject(folder, { engine = "1.0.0", answers = { registry_link: false, contract_version: CONTRACT_VERSION } } = {}) {
  mkdirSync(path.join(folder, "devos"), { recursive: true });
  mkdirSync(path.join(folder, ".claude"), { recursive: true });
  writeFileSync(path.join(folder, "devos", "answers.json"), `${JSON.stringify(answers, null, 2)}\n`);
  writeFileSync(path.join(folder, "devos", "engine.lock.json"), `${JSON.stringify({ engine_version: engine })}\n`);
  writeFileSync(path.join(folder, ".claude", "settings.json"), "{}\n");
  git(folder, ["init", "-q", "-b", "main"]);
  git(folder, ["add", "-A"]);
  git(folder, ["commit", "-q", "-m", "set up"]);
  git(folder, ["remote", "add", "origin", `https://github.com/${SLUG}.git`]);
}

const STUB_NAMES = ["PATH", "DEVOS_GH_LOG", "STUB_LATEST", "STUB_VARIABLES", "STUB_DEFAULT_BRANCH", "STUB_REMOTE_LOCK", "STUB_REMOTE_ANSWERS", "STUB_PULLS", "STUB_REF", "STUB_PR", "STUB_CONTENTS", ...Object.keys(GIT_ENV)];

function useStubs(staged, extra = {}) {
  const saved = Object.fromEntries(STUB_NAMES.map((name) => [name, process.env[name]]));
  for (const name of STUB_NAMES.slice(2)) delete process.env[name];
  process.env.PATH = staged.env.PATH;
  process.env.DEVOS_GH_LOG = staged.env.DEVOS_GH_LOG;
  Object.assign(process.env, GIT_ENV, extra);
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function ghCalls(staged) {
  return existsSync(staged.env.DEVOS_GH_LOG) ? readFileSync(staged.env.DEVOS_GH_LOG, "utf8").split("\n").filter(Boolean) : [];
}

const STATE = {
  ok: true,
  folder: "/p",
  committed: true,
  repository: SLUG,
  reporting: "off",
  reportingError: "",
  versions: { project: "1.0.0", engine: "1.2.0", latest: "1.2.0", latestError: "" },
};
const FACTS = { branch: "main", defaultBranch: "main", github: "1.0.0", pulls: { upgrade: "", connect: "" } };
const no = (why) => ({ can: false, why });
const yes = { can: true, why: "" };

test("hub-actions.test.mjs (a) each action is allowed only by the page's facts, and says why not", () => {
  const decide = (state = {}, facts = {}) => decideActions({ ...STATE, ...state, versions: { ...STATE.versions, ...state.versions } }, { ...FACTS, ...facts, pulls: { ...FACTS.pulls, ...facts.pulls } });
  for (const [state, facts, why] of [
    [{ repository: "" }, {}, "Finish the setup first: the project is not on GitHub yet."],
    [{ committed: false }, {}, "Finish the setup first: the project is not on GitHub yet."],
    [{ versions: { latest: "" } }, {}, "The latest release could not be read from GitHub, so nothing can be compared."],
    [{ versions: { engine: "1.1.0" } }, {}, "Update DEV_OS first: this engine is 1.1.0 and the latest release is 1.2.0."],
    [{}, { github: "" }, "The project's version on GitHub could not be read."],
    [{}, { defaultBranch: "" }, "The project's version on GitHub could not be read."],
  ]) {
    assert.deepEqual(decide(state, facts), { upgrade: no(why), pull: no(why), connect: no(why) }, why);
  }
  const needs = "Connecting needs the latest release, 1.2.0, in this engine and in the project on GitHub. This engine is 1.2.0 and the project is 1.0.0.";
  assert.deepEqual(decide(), { upgrade: yes, pull: no("This folder has the same version as GitHub."), connect: no(needs) });
  assert.equal(decide({}, { pulls: { upgrade: "https://github.com/devtest/demo-shop/pull/3" } }).upgrade.why, "An upgrade pull request is open: merge it on GitHub, then bring this folder up to date.");
  assert.deepEqual(decide({}, { github: "1.2.0" }), {
    upgrade: no("The project already has 1.2.0."),
    pull: yes,
    connect: yes,
  });
  const elsewhere = "Switch this folder to main first; it is on feature.";
  assert.deepEqual(decide({}, { branch: "feature" }), { upgrade: no(elsewhere), pull: no("This folder has the same version as GitHub."), connect: no(needs) });
  assert.equal(decide({}, { github: "1.2.0", branch: "feature" }).pull.why, elsewhere);
  assert.deepEqual(decide({ versions: { project: "1.2.0" } }, {}), {
    upgrade: no("This folder has 1.2.0 and GitHub has 1.0.0: bring this folder up to date first."),
    pull: no("This folder has 1.2.0 and GitHub has 1.0.0: commit and push this folder's changes, or open it in a terminal."),
    connect: no(needs),
  });
  const ready = { versions: { project: "1.2.0" } };
  assert.equal(decide({ ...ready, reporting: "on" }, { github: "1.2.0" }).connect.why, "The link is on: DEVOS_REPORTING is on.");
  assert.equal(decide({ ...ready, reportingError: "gh could not list the repository's variables" }, { github: "1.2.0" }).connect.why, "gh could not list the repository's variables");
  assert.equal(decide(ready, { github: "1.2.0", pulls: { connect: "https://github.com/devtest/demo-shop/pull/8" } }).connect.why,
    "A link pull request is open: merge it on GitHub. If DEVOS_REPORTING is still off, set it: gh variable set DEVOS_REPORTING --body on --repo devtest/demo-shop");
  assert.equal(decide({ versions: { project: "1.3.0", engine: "1.3.0" } }, { github: "1.3.0" }).connect.why,
    "Connecting needs the latest release, 1.2.0, in this engine and in the project on GitHub. This engine is 1.3.0 and the project is 1.3.0.");
  assert.deepEqual(decide({ ...ready }, { github: "1.2.0" }).connect, yes);
});

test("hub-actions.test.mjs (b) the page's facts come from git and gh, and reading changes nothing", () => {
  const staged = stage();
  const restore = useStubs(staged, {
    STUB_REMOTE_LOCK: `${JSON.stringify({ engine_version: "1.0.0" })}\n`,
    STUB_PULLS: JSON.stringify({ [`devos/upgrade-${version}`]: "https://github.com/devtest/demo-shop/pull/3" }),
  });
  try {
    setUpProject(staged.project);
    const head = git(staged.project, ["rev-parse", "HEAD"]).stdout;
    const state = { ...STATE, folder: staged.project, versions: { ...STATE.versions, engine: version } };
    assert.deepEqual(actionFacts(state), { branch: "main", defaultBranch: "main", github: "1.0.0", pulls: { upgrade: "https://github.com/devtest/demo-shop/pull/3", connect: "" } });
    assert.deepEqual(ghCalls(staged), [
      `api repos/${SLUG} --jq .default_branch`,
      `api repos/${SLUG}/contents/devos/engine.lock.json?ref=main`,
      `pr list --repo ${SLUG} --head devos/upgrade-${version} --state open --json url --jq .[].url`,
      `pr list --repo ${SLUG} --head devos/connect --state open --json url --jq .[].url`,
    ]);
    process.env.STUB_DEFAULT_BRANCH = "missing";
    assert.deepEqual(actionFacts(state), { branch: "main", defaultBranch: "", github: "", pulls: { upgrade: "https://github.com/devtest/demo-shop/pull/3", connect: "" } });
    assert.deepEqual(actionFacts({ ...state, repository: "" }), { branch: "", defaultBranch: "", github: "", pulls: { upgrade: "", connect: "" } });
    assert.equal(git(staged.project, ["rev-parse", "HEAD"]).stdout, head);
    assert.equal(git(staged.project, ["status", "--porcelain"]).stdout, "");
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("hub-actions.test.mjs (c) connecting opens a pull request that records the answer on GitHub, then turns reporting on", () => {
  const staged = stage();
  const answers = { name: "demo-shop", registry_link: false, contract_version: CONTRACT_VERSION };
  const restore = useStubs(staged, { STUB_REMOTE_ANSWERS: `${JSON.stringify(answers, null, 2)}\n` });
  const state = { ...STATE, folder: staged.parent };
  const actions = { defaultBranch: "main", connect: yes };
  try {
    assert.deepEqual(connectProject(state, { defaultBranch: "main", connect: no("The link is on: DEVOS_REPORTING is on.") }), { ok: false, error: "The link is on: DEVOS_REPORTING is on." });
    assert.deepEqual(ghCalls(staged), []);

    const done = connectProject(state, actions);
    assert.deepEqual(done, {
      ok: true,
      pull: "https://github.com/devtest/demo-shop/pull/7",
      message: "DEVOS_REPORTING is on, and the pull request that records your answer is open: merge it on GitHub. The merge starts a devos-cycle link run that asks the Control Tower to link this repository, and its operator approves it once.",
    });
    const calls = ghCalls(staged);
    assert.deepEqual(calls.map((line) => line.replace(/ --(input|body-file) .*$/, " --$1 <file>")).filter((line) => !line.startsWith("input ")), [
      `api repos/${SLUG}/contents/devos/answers.json?ref=main`,
      `api repos/${SLUG}/git/ref/heads/main --jq .object.sha`,
      `api repos/${SLUG}/git/refs -X POST -f ref=refs/heads/devos/connect -f sha=${"a".repeat(40)}`,
      `api repos/${SLUG}/contents/devos/answers.json -X PUT --input <file>`,
      `pr create --repo ${SLUG} --base main --head devos/connect --title DEV_OS: link this project to the Control Tower --body-file <file>`,
      `variable set DEVOS_REPORTING --body on --repo ${SLUG}`,
    ]);
    const put = JSON.parse(calls.find((line) => line.startsWith("input ")).slice("input ".length));
    assert.deepEqual([put.message, put.sha, put.branch], ["DEV_OS: link this project to the Control Tower", "b".repeat(40), "devos/connect"]);
    assert.equal(Buffer.from(put.content, "base64").toString("utf8"), `${JSON.stringify({ ...answers, registry_link: true }, null, 2)}\n`);

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    process.env.STUB_REMOTE_ANSWERS = JSON.stringify({ ...answers, registry_link: true });
    assert.deepEqual(connectProject(state, actions), {
      ok: true,
      pull: "",
      message: "DEVOS_REPORTING is on. The project already records your answer, so no pull request was needed. Ask the Control Tower now on this page, or the next cycle run asks.",
    });
    assert.deepEqual(ghCalls(staged), [`api repos/${SLUG}/contents/devos/answers.json?ref=main`, `variable set DEVOS_REPORTING --body on --repo ${SLUG}`]);

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    process.env.STUB_REMOTE_ANSWERS = JSON.stringify(answers);
    process.env.STUB_REF = "fail";
    assert.deepEqual(connectProject(state, actions), { ok: false, error: "GitHub did not create the branch devos/connect in devtest/demo-shop. If it exists already, close its pull request and delete the branch, then try again." });
    assert.equal(ghCalls(staged).some((line) => line.includes("-X PUT") || line.startsWith("pr create") || line.startsWith("variable set")), false);

    delete process.env.STUB_REF;
    process.env.STUB_REMOTE_ANSWERS = "[]";
    assert.deepEqual(connectProject(state, actions), { ok: false, error: "gh could not read devos/answers.json on main in devtest/demo-shop." });
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("hub-actions.test.mjs (d) the upgrade runs devos upgrade in the project's folder, and a folder is brought up to date fast-forward only", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const seen = [];
    const node = (args, cwd) => {
      seen.push([args, cwd]);
      return { status: 0, stdout: "devos upgrade 1.0.0 to 1.2.0: 1 updated, 0 added, 0 removed, 0 conflicts\ndevos: pull request opened\n", stderr: "" };
    };
    const state = { ...STATE, folder: staged.project };
    assert.deepEqual(upgradeProject(state, { upgrade: no("The project already has 1.2.0.") }, root, node), { ok: false, error: "The project already has 1.2.0." });
    assert.deepEqual(seen, []);
    assert.deepEqual(upgradeProject(state, { upgrade: yes }, root, node), {
      ok: true,
      message: "The pull request that upgrades the project to 1.2.0 is open on GitHub. Merge it there, then bring this folder up to date.",
      output: ["devos upgrade 1.0.0 to 1.2.0: 1 updated, 0 added, 0 removed, 0 conflicts", "devos: pull request opened"],
    });
    assert.deepEqual(seen, [[[bin, "upgrade"], staged.project]]);
    const refused = upgradeProject(state, { upgrade: yes }, root, () => ({ status: 1, stdout: "", stderr: "devos: the working tree is not clean; commit or stash first\n" }));
    assert.deepEqual(refused, { ok: false, error: "devos: the working tree is not clean; commit or stash first", output: ["devos: the working tree is not clean; commit or stash first"] });

    const origin = path.join(staged.parent, "origin.git");
    const other = path.join(staged.parent, "other");
    git(staged.parent, ["init", "-q", "--bare", "-b", "main", origin]);
    setUpProject(staged.project);
    git(staged.project, ["remote", "set-url", "origin", origin]);
    git(staged.project, ["push", "-q", "-u", "origin", "main"]);
    git(staged.parent, ["clone", "-q", origin, other]);
    writeFileSync(path.join(other, "devos", "engine.lock.json"), `${JSON.stringify({ engine_version: "1.2.0" })}\n`);
    git(other, ["commit", "-q", "-am", "upgrade merged on GitHub"]);
    git(other, ["push", "-q", "origin", "main"]);
    const pulledState = { ...STATE, folder: staged.project };
    assert.deepEqual(pullProject(pulledState, { pull: no("This folder has the same version as GitHub.") }), { ok: false, error: "This folder has the same version as GitHub." });
    assert.deepEqual(pullProject(pulledState, { pull: yes }), { ok: true, message: "This folder is up to date with GitHub." });
    assert.equal(git(staged.project, ["rev-parse", "HEAD"]).stdout, git(other, ["rev-parse", "HEAD"]).stdout);

    writeFileSync(path.join(other, "README.md"), "theirs\n");
    git(other, ["add", "README.md"]);
    git(other, ["commit", "-q", "-m", "theirs"]);
    git(other, ["push", "-q", "origin", "main"]);
    writeFileSync(path.join(staged.project, "NOTES.md"), "mine\n");
    git(staged.project, ["add", "NOTES.md"]);
    git(staged.project, ["commit", "-q", "-m", "mine"]);
    const mine = git(staged.project, ["rev-parse", "HEAD"]).stdout;
    assert.deepEqual(pullProject(pulledState, { pull: yes }), { ok: false, error: "git pull --ff-only did not finish. The folder may have changes of its own: open it in a terminal and run git status." });
    assert.equal(git(staged.project, ["rev-parse", "HEAD"]).stdout, mine);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("hub-actions.test.mjs (e) the server upgrades by pull request and connects only after an explicit yes", async () => {
  const staged = stage();
  const origin = path.join(staged.parent, "origin.git");
  const restore = useStubs(staged, { STUB_LATEST: `v${version}`, STUB_REMOTE_LOCK: `${JSON.stringify({ engine_version: "1.0.0" })}\n` });
  // An installed project at 1.0.0 whose pushes reach a local bare repository; its origin still names GitHub.
  mkdirSync(staged.project);
  git(staged.project, ["init", "-q", "-b", "main"]);
  const installed = spawnSync(process.execPath, [bin, "install", staged.project, "--key", "DEMO"], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: process.env });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const lockFile = path.join(staged.project, "devos", "engine.lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  writeFileSync(lockFile, `${JSON.stringify({ ...lock, engine_version: "1.0.0" }, null, 2)}\n`);
  writeFileSync(path.join(staged.project, "devos", "answers.json"), `${JSON.stringify({ registry_link: false, contract_version: CONTRACT_VERSION }, null, 2)}\n`);
  mkdirSync(path.join(staged.project, ".claude"), { recursive: true });
  if (!existsSync(path.join(staged.project, ".claude", "settings.json"))) writeFileSync(path.join(staged.project, ".claude", "settings.json"), "{}\n");
  git(staged.project, ["add", "-A"]);
  git(staged.project, ["commit", "-q", "-m", "install"]);
  git(staged.parent, ["init", "-q", "--bare", "-b", "main", origin]);
  git(staged.project, ["remote", "add", "origin", `https://github.com/${SLUG}.git`]);
  git(staged.project, ["remote", "set-url", "--push", "origin", origin]);
  git(staged.project, ["push", "-q", "origin", "main"]);
  const call = async (server, route, body) => {
    const address = `http://127.0.0.1:${server.port}`;
    const headers = { "X-DEVOS-Token": server.token };
    if (body !== undefined) Object.assign(headers, { Origin: address, "Content-Type": "application/json" });
    const response = await fetch(`${address}${route}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    assert.equal(hubState(staged.project).versions.project, "1.0.0");
    const read = await call(server, "/api/hub");
    assert.deepEqual([read.status, read.body.actions.github, read.body.actions.upgrade, read.body.actions.pull], [200, "1.0.0", yes, no("This folder has the same version as GitHub.")]);
    assert.equal(read.body.actions.connect.can, false);

    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    for (const body of [{}, { accept: "yes", contract: CONTRACT_VERSION }, { accept: true, contract: "0" }]) {
      assert.deepEqual(await call(server, "/api/connect", body), { status: 400, body: { ok: false, errors: ["Read the contract and tick the box to say yes first."] } });
    }
    assert.deepEqual(ghCalls(staged), []);
    const early = await call(server, "/api/connect", { accept: true, contract: CONTRACT_VERSION });
    assert.deepEqual([early.status, early.body.errors], [400, [read.body.actions.connect.why]]);
    assert.equal(ghCalls(staged).some((line) => line.startsWith("variable set") || line.startsWith("pr create")), false);
    assert.deepEqual(await call(server, "/api/pull", []), { status: 400, body: { ok: false, errors: ["The request is not a JSON object."] } });

    const upgraded = await call(server, "/api/upgrade", {});
    assert.equal(upgraded.status, 200, JSON.stringify(upgraded.body));
    assert.equal(upgraded.body.message, `The pull request that upgrades the project to ${version} is open on GitHub. Merge it there, then bring this folder up to date.`);
    assert.equal(upgraded.body.output.includes("devos: pull request opened"), true, upgraded.body.output.join("\n"));
    assert.equal(git(origin, ["rev-parse", "--verify", "-q", `refs/heads/devos/upgrade-${version}`]).status, 0);
    assert.equal(ghCalls(staged).some((line) => line.startsWith(`pr create --base main --head devos/upgrade-${version} --title DEV_OS upgrade 1.0.0 to ${version}`)), true);
    assert.equal(git(staged.project, ["branch", "--show-current"]).stdout.trim(), "main");
    assert.equal(git(staged.project, ["status", "--porcelain"]).stdout, "");

    process.env.STUB_REMOTE_LOCK = `${JSON.stringify({ engine_version: version })}\n`;
    process.env.STUB_REMOTE_ANSWERS = `${JSON.stringify({ registry_link: false, contract_version: CONTRACT_VERSION }, null, 2)}\n`;
    const after = await call(server, "/api/hub");
    assert.deepEqual([after.body.actions.upgrade, after.body.actions.connect], [no(`The project already has ${version}.`), yes]);
    const connected = await call(server, "/api/connect", { accept: true, contract: CONTRACT_VERSION });
    assert.deepEqual([connected.status, connected.body.ok, connected.body.pull], [200, true, "https://github.com/devtest/demo-shop/pull/7"]);
    const noOrigin = await fetch(`http://127.0.0.1:${server.port}/api/upgrade`, { method: "POST", headers: { "X-DEVOS-Token": server.token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noOrigin.status, 403);
    const noToken = await fetch(`http://127.0.0.1:${server.port}/api/connect`, { method: "POST", headers: { Origin: `http://127.0.0.1:${server.port}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noToken.status, 401);
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
});

test("hub-actions.test.mjs (f) the project's page offers the upgrade, the pull and the link with the contract and a yes", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of [
    "function versionSection(hub, v, a) {",
    "function towerSection(hub, data) {",
    "`Upgrade to ${v.engine} by pull request`, \"/api/upgrade\"",
    "\"Bring this folder up to date\", \"/api/pull\"",
    "\"Connect by pull request\", \"/api/connect\", { accept: true, contract: app.state.contractVersion }",
    "markdownDoc(app.state.contract),\n    el(\"label\", { class: \"check\" }, box",
    "connect.disabled = hub.busy || !box.checked;",
    "rel: \"noopener noreferrer\"",
    "versionRow(data.versions, data.actions)",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});
