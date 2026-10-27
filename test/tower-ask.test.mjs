import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { ASK_SINCE, askFacts, askTower, decideAsk } from "../lib/hub.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E28 (PR-65): a project asks the Control Tower for its link even with no task to run. A devos-cycle link run
// (task=link) builds nothing: resolve says done, and only the report job runs and asks. devos-advance starts one after
// the link answer's pull request (devos/connect) is merged, and the project's page starts one with DEVOS_REPORTING on;
// both only when no devos-cycle run is queued or going. A run with every task PASS asks too. The report job stays the
// only one with id-token: write. Each test file runs in its own process, so the fake gh is put on this process's PATH.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const workflows = path.join(root, "payload", "files", "dot-github", "workflows");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const SLUG = "devtest/demo-shop";
const skipWindows = process.platform === "win32";
const GIT_ENV = { GIT_AUTHOR_NAME: "Devos Test", GIT_AUTHOR_EMAIL: "devos@example.com", GIT_COMMITTER_NAME: "Devos Test", GIT_COMMITTER_EMAIL: "devos@example.com" };
const LINK_RUN = `workflow run devos-cycle.yml --repo ${SLUG} --ref main -f task=link`;

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, ...GIT_ENV } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result;
}

const STUB_NAMES = ["PATH", "DEVOS_GH_LOG", "STUB_LATEST", "STUB_VARIABLES", "STUB_DEFAULT_BRANCH", "STUB_REMOTE_LOCK", "STUB_PULLS", "STUB_RUNS", "STUB_DISPATCH", ...Object.keys(GIT_ENV)];

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

const STATE = { ok: true, folder: "/p", committed: true, repository: SLUG, reporting: "on", reportingError: "", paused: false };
const FACTS = { defaultBranch: "main", github: ASK_SINCE, pulls: { upgrade: "", connect: "" }, cycleRuns: 0 };
const no = (why) => ({ can: false, why });
const yes = { can: true, why: "" };

test("tower-ask.test.mjs (a) the page may ask the Control Tower only with the link on and no devos-cycle run going", () => {
  assert.equal(ASK_SINCE, "1.2.1");
  const decide = (state = {}, facts = {}) => decideAsk({ ...STATE, ...state }, { ...FACTS, ...facts, pulls: { ...FACTS.pulls, ...facts.pulls } });
  for (const [state, facts, why] of [
    [{ repository: "" }, {}, "Finish the setup first: the project is not on GitHub yet."],
    [{ committed: false }, {}, "Finish the setup first: the project is not on GitHub yet."],
    [{ reportingError: "gh could not list the repository's variables" }, {}, "gh could not list the repository's variables"],
    [{ reporting: "off" }, {}, "Connect first: DEVOS_REPORTING is off."],
    [{ paused: true }, {}, "DEVOS_PAUSED is true, so no devos-cycle run starts. Remove it or set it to false first."],
    [{}, { pulls: { connect: "https://github.com/devtest/demo-shop/pull/7" } }, "Merge the link pull request on GitHub first: its merge asks the Control Tower."],
    [{}, { github: "1.2.0" }, "Asking needs DEV_OS 1.2.1 or later in the project on GitHub, which has 1.2.0. Upgrade it first."],
    [{}, { github: "" }, "Asking needs DEV_OS 1.2.1 or later in the project on GitHub, which has an unknown version. Upgrade it first."],
    [{}, { cycleRuns: null }, "gh could not list the project's devos-cycle runs."],
    [{}, { cycleRuns: 2 }, "A devos-cycle run is queued or going: it asks the Control Tower when it ends."],
  ]) {
    assert.deepEqual(decide(state, facts), no(why), why);
  }
  assert.deepEqual(decide(), yes);
  assert.deepEqual(decide({}, { github: "1.3.0" }), yes);
});

test("tower-ask.test.mjs (b) the runs come from gh, only when the link is on, and reading changes nothing", () => {
  const staged = stage();
  const restore = useStubs(staged, { STUB_RUNS: JSON.stringify([{ status: "completed" }, { status: "queued" }, { status: "in_progress" }]) });
  try {
    assert.deepEqual(askFacts({ ...STATE, reporting: "off" }), { cycleRuns: null });
    assert.deepEqual(askFacts({ ...STATE, repository: "" }), { cycleRuns: null });
    assert.deepEqual(ghCalls(staged), []);
    assert.deepEqual(askFacts(STATE), { cycleRuns: 2 });
    assert.deepEqual(ghCalls(staged), [`run list --repo ${SLUG} --workflow devos-cycle.yml --limit 30 --json status`]);
    process.env.STUB_RUNS = "[]";
    assert.deepEqual(askFacts(STATE), { cycleRuns: 0 });
    process.env.STUB_RUNS = "not json";
    assert.deepEqual(askFacts(STATE), { cycleRuns: null });
    process.env.STUB_RUNS = "fail";
    assert.deepEqual(askFacts(STATE), { cycleRuns: null });
    assert.equal(ghCalls(staged).some((line) => line.startsWith("workflow run")), false);
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

test("tower-ask.test.mjs (c) asking starts one devos-cycle link run on the default branch, and nothing else", () => {
  const staged = stage();
  const restore = useStubs(staged);
  try {
    const refused = askTower(STATE, { defaultBranch: "main", ask: no("A devos-cycle run is queued or going: it asks the Control Tower when it ends.") });
    assert.deepEqual(refused, { ok: false, error: "A devos-cycle run is queued or going: it asks the Control Tower when it ends." });
    assert.deepEqual(ghCalls(staged), []);
    assert.deepEqual(askTower(STATE, { defaultBranch: "trunk", ask: yes }), {
      ok: true,
      message: "A devos-cycle link run is starting on GitHub. It builds nothing: its report job asks the Control Tower to link this repository, and the Control Tower's operator approves it once.",
    });
    assert.deepEqual(ghCalls(staged), [`workflow run devos-cycle.yml --repo ${SLUG} --ref trunk -f task=link`]);
    process.env.STUB_DISPATCH = "fail";
    assert.deepEqual(askTower(STATE, { defaultBranch: "main", ask: yes }), {
      ok: false,
      error: `gh could not start the link run. Start it yourself: gh workflow run devos-cycle.yml --repo ${SLUG} -f task=link`,
    });
  } finally {
    restore();
    cleanup(staged.parent);
  }
});

// The run block of a workflow step, as bash runs it.
function stepScript(text, name) {
  const lines = text.split("\n");
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, name);
  const run = lines.indexOf("        run: |", start);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

test("tower-ask.test.mjs (d) a link run builds nothing and its report job asks; devos-advance starts one after the link answer is merged", { skip: skipWindows }, () => {
  const cycle = readFileSync(path.join(workflows, "devos-cycle.yml"), "utf8").replaceAll("\r\n", "\n");
  const advance = readFileSync(path.join(workflows, "devos-advance.yml"), "utf8").replaceAll("\r\n", "\n");
  for (const line of [
    "    if: always() && (needs.cycle.result != 'skipped' || needs.resolve.outputs.done == 'true') && vars.DEVOS_REPORTING == 'on'\n",
    "      - name: The journal of the cycle job\n        if: needs.resolve.outputs.done != 'true'\n",
    "link = no task, only ask the DEV_OS registry for the link, PR-65)\"\n",
    "      - if: steps.t.outputs.done == 'true' && inputs.task != 'link'\n",
    "      - if: steps.t.outputs.done == 'true' && inputs.task == 'link'\n",
  ]) {
    assert.equal(cycle.includes(line), true, line);
  }
  assert.equal(cycle.split("id-token: write").length - 1, 1);
  const job = advance.slice(advance.indexOf("\n  link:\n"));
  for (const line of [
    "      github.event.pull_request.head.ref == 'devos/connect' &&\n",
    "      github.event.pull_request.head.repo.full_name == github.repository &&\n",
    "      vars.DEVOS_REPORTING == 'on' &&\n",
    "      vars.DEVOS_PAUSED != 'true'\n",
    "    permissions:\n      actions: write\n    steps:\n",
  ]) {
    assert.equal(job.includes(line), true, line);
  }
  assert.equal(advance.includes("id-token"), false);
  assert.equal(job.includes("actions/checkout"), false);
  const precedents = readFileSync(path.join(root, "payload", "files", "docs", "method", "PRECEDENTS.md"), "utf8");
  assert.equal(precedents.includes("**Live maximum: PR-65.**"), true);
  assert.equal(precedents.includes("| PR-65 | **A project asks for its link without a task to run.**"), true);
  const manual = readFileSync(path.join(root, "payload", "files", "docs", "method", "AUTOMATION.md"), "utf8");
  assert.equal(manual.includes("| `advance`, `link` |"), true);

  const staged = stage();
  try {
    mkdirSync(staged.project);
    const installed = spawnSync(process.execPath, [bin, "install", staged.project, "--key", "DEMO"], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: staged.env });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    // A link run says done before it reads docs/PHASES.md, so it never picks a task, open or not.
    for (const task of ["link", "LINK"]) {
      const resolved = spawnSync(process.execPath, ["scripts/devos/next-task.mjs", "--task", task, "--attempt", ""], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: { ...staged.env, GITHUB_OUTPUT: "" } });
      assert.deepEqual([resolved.status, resolved.stdout], [0, "done=true\ntask=\nreason=a link run: no task; the report job asks the DEV_OS registry for the link\n"], resolved.stderr);
    }
    const script = stepScript(advance, "Ask the registry with a devos-cycle link run");
    const runStep = (runs) => {
      writeFileSync(staged.env.DEVOS_GH_LOG, "");
      const result = spawnSync("bash", ["-c", script], { cwd: staged.project, encoding: "utf8", env: { ...staged.env, REPO: SLUG, GH_TOKEN: "unused", STUB_RUNS: runs } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return { out: result.stdout.trim(), dispatched: ghCalls(staged).filter((line) => line.startsWith("workflow run")) };
    };
    assert.deepEqual(runStep("0"), { out: "::notice title=Dev OS::A devos-cycle link run (no task) asks the DEV_OS registry to link this repository.", dispatched: [LINK_RUN] });
    assert.deepEqual(runStep("2"), { out: "::notice title=Dev OS::A devos-cycle run is queued or going; it asks the DEV_OS registry to link this repository.", dispatched: [] });
    const unknown = { out: "::notice title=Dev OS::gh could not list the devos-cycle runs; the next devos-cycle run asks the DEV_OS registry to link this repository.", dispatched: [] };
    assert.deepEqual(runStep("fail"), unknown);
    assert.deepEqual(runStep("[]"), unknown);
  } finally {
    cleanup(staged.parent);
  }
});

test("tower-ask.test.mjs (e) the server asks the Control Tower only when the page's facts allow it", async () => {
  const staged = stage();
  const restore = useStubs(staged, {
    STUB_LATEST: `v${version}`,
    STUB_REMOTE_LOCK: `${JSON.stringify({ engine_version: version })}\n`,
    STUB_VARIABLES: JSON.stringify([{ name: "DEVOS_REPORTING", value: "on" }, { name: "DEVOS_PAUSED", value: "true" }]),
  });
  mkdirSync(staged.project);
  git(staged.project, ["init", "-q", "-b", "main"]);
  const installed = spawnSync(process.execPath, [bin, "install", staged.project, "--key", "DEMO"], { cwd: staged.project, encoding: "utf8", windowsHide: true, env: process.env });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  writeFileSync(path.join(staged.project, "devos", "answers.json"), `${JSON.stringify({ registry_link: true, contract_version: CONTRACT_VERSION }, null, 2)}\n`);
  mkdirSync(path.join(staged.project, ".claude"), { recursive: true });
  if (!existsSync(path.join(staged.project, ".claude", "settings.json"))) writeFileSync(path.join(staged.project, ".claude", "settings.json"), "{}\n");
  git(staged.project, ["add", "-A"]);
  git(staged.project, ["commit", "-q", "-m", "install"]);
  git(staged.project, ["remote", "add", "origin", `https://github.com/${SLUG}.git`]);
  const call = async (server, route, body) => {
    const address = `http://127.0.0.1:${server.port}`;
    const headers = { "X-DEVOS-Token": server.token };
    if (body !== undefined) Object.assign(headers, { Origin: address, "Content-Type": "application/json" });
    const response = await fetch(`${address}${route}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const paused = await call(server, "/api/hub");
    const stop = "DEVOS_PAUSED is true, so no devos-cycle run starts. Remove it or set it to false first.";
    assert.deepEqual([paused.status, paused.body.reporting, paused.body.paused, paused.body.actions.ask], [200, "on", true, no(stop)]);
    writeFileSync(staged.env.DEVOS_GH_LOG, "");
    assert.deepEqual(await call(server, "/api/ask-tower", {}), { status: 400, body: { ok: false, errors: [stop], pull: "", output: [] } });
    assert.equal(ghCalls(staged).some((line) => line.startsWith("workflow run")), false);

    process.env.STUB_VARIABLES = JSON.stringify([{ name: "DEVOS_REPORTING", value: "on" }]);
    const ready = await call(server, "/api/hub");
    assert.deepEqual(ready.body.actions.ask, yes);
    const asked = await call(server, "/api/ask-tower", {});
    assert.deepEqual([asked.status, asked.body.ok, asked.body.message], [200, true, "A devos-cycle link run is starting on GitHub. It builds nothing: its report job asks the Control Tower to link this repository, and the Control Tower's operator approves it once."]);
    assert.deepEqual(ghCalls(staged).filter((line) => line.startsWith("workflow run")), [LINK_RUN]);
    // The run just started is listed now, so a second ask is refused.
    const again = await call(server, "/api/ask-tower", {});
    assert.deepEqual([again.status, again.body.errors], [400, ["A devos-cycle run is queued or going: it asks the Control Tower when it ends."]]);
    assert.equal(ghCalls(staged).filter((line) => line.startsWith("workflow run")).length, 1);

    const noOrigin = await fetch(`http://127.0.0.1:${server.port}/api/ask-tower`, { method: "POST", headers: { "X-DEVOS-Token": server.token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noOrigin.status, 403);
    const noToken = await fetch(`http://127.0.0.1:${server.port}/api/ask-tower`, { method: "POST", headers: { Origin: `http://127.0.0.1:${server.port}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noToken.status, 401);
  } finally {
    await server.close();
    restore();
    cleanup(staged.parent);
  }
});

test("tower-ask.test.mjs (f) the project's page says what the link waits for, and asks now only when it may", () => {
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    "function askSection(hub, data) {",
    "if (data.reporting === \"on\") return askSection(hub, data);",
    "hubButton(hub, \"Ask the Control Tower now\", \"/api/ask-tower\", {}, true)",
    ": el(\"p\", { class: \"hint\", text: a.ask.why }));",
    "if (done && route === \"/api/ask-tower\") hub.asked = true;",
    "\"Asked. The link run's report job shows the Control Tower's answer in the repository's Actions tab.\"",
    "\"On by your choice: DEVOS_REPORTING is on. A devos-cycle run asks the Control Tower to link this repository, and its operator approves it once.\"",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
  assert.equal(js.includes("Linked by your choice"), false);
});
