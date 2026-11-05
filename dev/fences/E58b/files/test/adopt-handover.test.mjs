import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, stage } from "./harness.mjs";
import { AGENT_START, adoptPullBody, handoverAnswers, ownRulings, readmeAdopted } from "../lib/adopt.mjs";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { handoverTasks, phasesAccepted } from "../lib/handover.mjs";
import { projectReadmeHow } from "../lib/setup.mjs";

// E58b (PR-84): devos adopt on a project DEV_OS handed over (PR-83) brings DEV_OS back by pull request, with no AI
// tool: the brief comes from the plan, the plan and the agents stay, the tasks ticked as built are accepted as
// attempt 0, and the cycle resumes from the first open task.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const ENGINE = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
// The answers of a default devos init --local (handover.test.mjs keeps the same list).
const LOCAL_FLOW = ["accept", "", "", "", "", "", "", "", "", "", "database none", "", "auth none", "", "email none", "", "", "", "", "Demo Shop", "A small shop.", "Customers", "", "", "", "", "approve", ""].join("\n") + "\n";
const HEAD = "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n";
const row = (task, name, done, phase = "P1") => `| ${task} | ${phase} | S1 | ${name} | 1 | — | ${done ? "[x]" : "[ ]"} | — |\n`;
const OWN_PR01 = "| PR-01 | **Environment profile.** The shop builds on Linux with pnpm. | the shop |";
// After the brief: keep it, add DEV_OS now, the contract, no link (no deploy and no agents are asked).
const KEEP = "yes\nyes\naccept\nno\n";

/**
 * A project set up with devos init --local and handed over, then built outside DEV_OS: `phases` as the developer
 * ticked them, a fence for each task in `fences`, its own PR-01, code, and an origin on GitHub.
 */
function handedOverProject(phases, { fences = ["T02"], extra = {}, rulings = "" } = {}) {
  const staged = stage({ tools: ["agent"] });
  const folder = staged.project;
  const init = spawnSync(process.execPath, [bin, "init", "--local", folder], { encoding: "utf8", windowsHide: true, timeout: 180000, input: LOCAL_FLOW, env: staged.env });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const at = (file) => path.join(folder, ...file.split("/"));
  const write = (file, text) => {
    mkdirSync(path.dirname(at(file)), { recursive: true });
    writeFileSync(at(file), text);
  };
  const fence = readFileSync(at("docs/fences/T01.md"), "utf8");
  write("docs/PHASES.md", phases);
  for (const task of fences) write(`docs/fences/${task}.md`, fence.replace(/^## T01 — .*$/m, `## ${task} — Task ${task}`));
  const precedents = readFileSync(at("docs/method/PRECEDENTS.md"), "utf8");
  write("docs/method/PRECEDENTS.md", `${precedents.replace(/^\| PR-01 \|.*$/m, OWN_PR01).replace(/\n*$/, "\n")}${rulings}`);
  write("src/index.ts", "export const ok = true;\n");
  for (const [file, text] of Object.entries(extra)) write(file, text);
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: folder, encoding: "utf8", windowsHide: true, env: staged.env });
    return { status: result.status, out: String(result.stdout ?? "") };
  };
  for (const args of [["config", "core.autocrlf", "false"], ["add", "-A"], ["commit", "-q", "-m", "built outside DEV_OS"], ["remote", "add", "origin", "https://github.com/devtest/demo-shop.git"]]) {
    assert.equal(git(args).status, 0, args.join(" "));
  }
  const run = (args, input, env = {}) => spawnSync(process.execPath, [bin, "adopt", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300000,
    input,
    env: { ...staged.env, STUB_REPO: "full", STUB_VARIABLES: "[]", ...env },
  });
  // Every AI tool run the stubs logged: devos init --local's blueprint, and none after it.
  const toolRuns = () => ["claude.log", "tool.log"].map((log) => path.join(staged.parent, log))
    .filter((log) => existsSync(log))
    .reduce((sum, log) => sum + readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).length, 0);
  const show = (file) => git(["show", `devos/adopt:${file}`]).out;
  const listed = () => git(["ls-tree", "-r", "--name-only", "devos/adopt"]).out.split("\n").filter(Boolean);
  const staging = path.join(staged.parent, "home", ".devos", "adopt", "devtest__demo-shop");
  return { staged, folder, git, run, toolRuns, show, listed, staging, at };
}

function unchanged(t, head) {
  assert.equal(t.git(["rev-parse", "HEAD"]).out, head);
  assert.equal(t.git(["status", "--porcelain"]).out, "");
  assert.equal(t.git(["branch", "--show-current"]).out.trim(), "main");
  assert.equal(t.git(["worktree", "list"]).out.trim().split("\n").length, 1);
}

function bareOrigin(t) {
  const bare = path.join(t.staged.parent, "origin.git").replaceAll("\\", "/");
  assert.equal(spawnSync("git", ["init", "-q", "--bare", bare], { env: t.staged.env, windowsHide: true }).status, 0);
  assert.equal(t.git(["config", `url.${bare}.pushInsteadOf`, "https://github.com/devtest/demo-shop.git"]).status, 0);
  return (ref) => String(spawnSync("git", ["--git-dir", bare, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8", env: t.staged.env, windowsHide: true }).stdout ?? "").trim();
}

test("adopt-handover.test.mjs (a) a handed-over project is surveyed as handover, and its brief comes from its plan with no AI tool", () => {
  const t = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}${row("T03", "Third task", false)}`);
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const before = JSON.parse(t.git(["show", "HEAD:devos/answers.json"]).out).handover;
    const check = t.run(["--check", t.folder], "");
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.equal(check.stdout.includes(`DEV_OS: handed over (engine ${before.engine}, on ${before.on})\n`), true, check.stdout);
    assert.equal(check.stdout.includes("Note: DEV_OS handed it over: adopting it keeps its plan, settings and agents, writes its brief from the plan with no AI tool, accepts the tasks ticked as built, and resumes from the first open task.\n"), true, check.stdout);
    assert.equal(check.stdout.includes("Ready: yes. Nothing was changed."), true, check.stdout);
    const runs = t.toolRuns();
    // Anything but yes stops, and nothing changes.
    const stopped = t.run([t.folder], "no\n");
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    assert.equal(stopped.stdout.includes(`devos: stopped; nothing in ${t.folder} changed. The brief comes from your plan: change it in docs/ or devos/answers.json, commit, then run devos adopt again\n`), true, stopped.stdout);
    const later = t.run([t.folder], "yes\nno\n");
    assert.equal(later.status, 0, later.stdout + later.stderr);
    assert.equal(later.stdout.includes("devos: DEV_OS handed this project over; its brief comes from its own plan, with no AI tool\n"), true, later.stdout);
    for (const part of [
      "## What it is\n\nA small shop.\n\nFor: Customers. The plan is in `docs/`, from `docs/PRODUCT_BRIEF.md`.\n",
      `## Stage\n\nin-development: DEV_OS wrote the plan and handed the project over (engine ${before.engine}, on ${before.on}); 1 of 3 tasks in \`docs/PHASES.md\` is ticked as built.`,
      "## What is done\n\n- T01 — First task\n",
      "## What is open\n\n- T02 — Second task\n- T03 — Third task\n\nThe cycle resumes from T02, with its fence `docs/fences/T02.md`.\n",
      "T01 was built outside DEV_OS and is accepted without its review (PR-84): you confirm it, and it gets `docs/reviews/<task>-a0.md`.",
      "## Personal data\n\nNone planned: no database and no sign-in in `devos/answers.json`.\n",
      "## Questions for you\n\nnone\n",
    ]) assert.equal(later.stdout.includes(part), true, part);
    assert.equal(later.stdout.includes(`devos: nothing in ${t.folder} changed; add DEV_OS from this brief with devos adopt --install ${t.folder}\n`), true, later.stdout);
    // No AI tool ran: the brief is the plan's.
    assert.equal(t.toolRuns(), runs);
    assert.deepEqual(JSON.parse(readFileSync(path.join(t.staging, "brief", "brief.json"), "utf8")), {
      schema: "devos-brief/1",
      name: "Demo Shop",
      key: "DEMO-SHOP",
      stage: "in-development",
      type: "saas",
      stack: "next",
      personal_data: false,
      questions: [],
    });
    assert.equal(existsSync(path.join(t.staging, "brief", "confirmed.json")), true);
    unchanged(t, head);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-handover.test.mjs (b) yes puts DEV_OS back on devos/adopt: the plan, the answers, the settings and the agents stay, docs/method/ is the engine's with the project's PR-01, and CLAUDE.md holds the reviewer's rules", () => {
  const t = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}`, { extra: { "CLAUDE.md": "# Our notes\nUse pnpm.\n" } });
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const runs = t.toolRuns();
    const result = t.run([t.folder], `${KEEP}yes\nno\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: DEV_OS is back in the project it handed over: your plan, settings and agents stay, and docs/method/ is the engine's, with your PR-01. T01 is accepted as built (PR-84); the cycle resumes from T02.\n"), true, result.stdout);
    assert.equal(result.stdout.includes(`devos: DEV_OS is on the branch devos/adopt of ${t.folder}, in one commit.`), true, result.stdout);
    assert.equal(result.stdout.includes("devos: nothing was pushed; devos/adopt stays on this computer."), true, result.stdout);
    assert.equal(t.toolRuns(), runs);
    unchanged(t, head);
    assert.equal(t.git(["log", "-1", "--format=%s", "devos/adopt"]).out.trim(), `DEV_OS adopt: Demo Shop (engine ${ENGINE})`);
    // The developer's answers stay; the local cycle goes, and the handover is history.
    const before = JSON.parse(t.git(["show", "HEAD:devos/answers.json"]).out);
    const answers = JSON.parse(t.show("devos/answers.json"));
    assert.equal(answers.cycle, undefined);
    assert.equal(answers.handover, undefined);
    for (const key of ["name", "key", "brief", "users", "languages", "type", "stack", "modules", "scope", "visual_ambition", "blueprint_agent", "attachments"]) {
      assert.deepEqual(answers[key], before[key], key);
    }
    assert.deepEqual([answers.deploy, answers.visibility, answers.registry_link, answers.contract_version], ["none", "private", false, CONTRACT_VERSION]);
    assert.deepEqual(answers.adopted, { stage: "in-development", head: head.trim(), engine: ENGINE, handover: { ...before.handover, accepted: ["T01"], resume: "T02" } });
    // The agents chosen at setup, and the plan, stay as they were.
    assert.deepEqual(JSON.parse(t.show("devos/project.json")).agents, JSON.parse(t.git(["show", "HEAD:devos/project.json"]).out).agents);
    for (const file of ["docs/fences/T01.md", "docs/fences/T02.md", "docs/GLOSSARY.md", "docs/DESIGN_SYSTEM.md", ".cursor/rules/10-security-data.mdc", "devos/prices.json", "src/index.ts"]) {
      assert.equal(t.show(file), t.git(["show", `HEAD:${file}`]).out, file);
    }
    // DEV_OS's automation is back.
    const files = t.listed();
    for (const file of ["devos/engine.lock.json", "devos.config.json", "devos/baseline.json", "scripts/devos/run-checks.mjs", "scripts/guards/run-all.mjs", ".github/workflows/devos-cycle.yml", ".claude/settings.json", ".cursor/cli.json"]) {
      assert.equal(files.includes(file), true, file);
    }
    assert.equal(JSON.parse(t.show("devos/engine.lock.json")).engine_version, ENGINE);
    // The engine's method, with the project's PR-01; no ruling of its own, so no copy beside it.
    const precedents = t.show("docs/method/PRECEDENTS.md");
    assert.equal(precedents.includes(`${OWN_PR01}\n`), true);
    assert.equal(precedents.includes("| PR-84 |"), true);
    assert.equal(files.some((file) => file.startsWith("docs/method/before-adopt/")), false);
    // CLAUDE.md: the project's own text, then the reviewer's rules written from the plan.
    const claude = t.show("CLAUDE.md");
    assert.equal(claude.startsWith(`# Our notes\nUse pnpm.\n\n${AGENT_START}\n# DEMO-SHOP — reviewer rules\n`), true, claude.slice(0, 200));
    assert.equal(claude.includes("`devtest/demo-shop` · branch `main` · private."), true, claude);
    assert.equal(claude.includes("{{"), false);
    // README.md says DEV_OS builds the project now; SETUP.md lists the cycle's settings.
    const readme = t.show("README.md");
    const own = t.git(["show", "HEAD:README.md"]).out;
    assert.equal(readme.startsWith(own.slice(0, own.indexOf("## How this project is built"))), true);
    assert.equal(readme.includes("DEV_OS builds this repository on GitHub, one task at a time"), true, readme);
    assert.equal(readme.includes("handed it over: you build it your own way"), false, readme);
    assert.equal(t.show("SETUP.md").startsWith("# SETUP — Demo Shop\n\nGenerated by devos adopt from devos/setup.json."), true);
  } finally {
    cleanup(t.staged.parent);
  }
});

test("adopt-handover.test.mjs (c) the tasks ticked as built are accepted as attempt 0 after a yes and guard:phases passes; no stops it, and a tick after an open task stops it before the brief", () => {
  const t = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", true)}${row("T03", "Third task", false)}`, { fences: ["T03"] });
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const declined = t.run([t.folder], `${KEEP}no\n`);
    assert.equal(declined.status, 1, declined.stdout + declined.stderr);
    assert.equal(declined.stdout.includes("docs/PHASES.md ticks these 2 tasks as built, outside DEV_OS: T01 (First task), T02 (Second task).\nDEV_OS accepts them as built, without its review (PR-84): each gets docs/reviews/<task>-a0.md, and its Verdict becomes PASS a0.\n"), true, declined.stdout);
    assert.equal(declined.stdout.includes("devos: nothing was written or sent; untick in docs/PHASES.md each task that is not built, commit, then run devos adopt again\n"), true, declined.stdout);
    unchanged(t, head);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
    // The brief was kept: --install takes it, and yes accepts them.
    const accepted = t.run(["--install", t.folder], "accept\nno\nyes\nno\n");
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    unchanged(t, head);
    const engine = JSON.parse(t.git(["show", "HEAD:devos/answers.json"]).out).handover.engine;
    const phases = t.show("docs/PHASES.md").split("\n");
    const original = t.git(["show", "HEAD:docs/PHASES.md"]).out.split("\n");
    assert.equal(phases.length, original.length);
    for (let i = 0; i < phases.length; i += 1) {
      const task = /^\| (T0[12]) \|/.exec(original[i])?.[1];
      assert.equal(phases[i], task ? original[i].replace(/\| — \|$/, `| PASS a0 — docs/reviews/${task}-a0.md |`) : original[i], original[i]);
    }
    for (const task of ["T01", "T02"]) {
      assert.equal(t.show(`docs/reviews/${task}-a0.md`).startsWith(`VERDICT: PASS\nAccepted by the owner at adoption: built outside DEV_OS after a handover (engine ${engine}), not reviewed by DEV_OS.\n`), true, task);
    }
    // guard:phases passes on the branch.
    const clone = mkdtempSync(path.join(tmpdir(), "devos-adopted-"));
    try {
      assert.equal(spawnSync("git", ["clone", "-q", "--branch", "devos/adopt", t.folder, clone], { env: t.staged.env, windowsHide: true }).status, 0);
      const guard = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "phases"], { cwd: clone, encoding: "utf8", windowsHide: true });
      assert.equal(guard.status, 0, guard.stdout + guard.stderr);
      assert.match(guard.stdout, /^guard:phases\s+PASS\s+\(3 tasks, 2 PASS\)$/m);
    } finally {
      cleanup(clone);
    }
  } finally {
    cleanup(t.staged.parent);
  }
  const order = handedOverProject(`${HEAD}${row("T01", "First task", false)}${row("T02", "Second task", true)}`, { fences: [] });
  try {
    const head = order.git(["rev-parse", "HEAD"]).out;
    const runs = order.toolRuns();
    const result = order.run([order.folder], "yes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: docs/PHASES.md ticks T02 after the open task T01, and tasks are built in order. Tick T01 if it is built, or untick T02, commit, then run devos adopt again\n"), true, result.stdout);
    assert.equal(result.stdout.includes("Brief:"), false, result.stdout);
    assert.equal(order.toolRuns(), runs);
    unchanged(order, head);
  } finally {
    cleanup(order.staged.parent);
  }
});

test("adopt-handover.test.mjs (d) a first open task without a committed fence stops before the brief, and one that fails fence-check stops before the commit", () => {
  const t = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}`, { fences: [] });
  try {
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder], "yes\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: the cycle resumes from T02, the first open task in docs/PHASES.md, and docs/fences/T02.md is not committed yet. Write it in the format of docs/fences/T01.md (the handbook's §6.3), or have your reviewer chat write it; commit it, then run devos adopt again. devos adopt checks it with fence-check.\n"), true, result.stdout);
    assert.equal(result.stdout.includes("Brief:"), false, result.stdout);
    assert.equal(existsSync(path.join(t.staging, "brief")), false);
    unchanged(t, head);
    assert.equal(t.git(["branch", "--list", "devos/adopt"]).out, "");
  } finally {
    cleanup(t.staged.parent);
  }
  const bad = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}`, { fences: [] });
  try {
    // A fence the developer wrote without its Do NOT section.
    const fence = readFileSync(bad.at("docs/fences/T01.md"), "utf8").replace(/^## T01 — .*$/m, "## T02 — Second task").replace(/### Do NOT[\s\S]*$/, "");
    writeFileSync(bad.at("docs/fences/T02.md"), fence);
    assert.equal(bad.git(["add", "-A"]).status, 0);
    assert.equal(bad.git(["commit", "-q", "-m", "fence T02"]).status, 0);
    const head = bad.git(["rev-parse", "HEAD"]).out;
    const result = bad.run([bad.folder], `${KEEP}yes\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: docs/fences/T02.md, the fence the cycle resumes from, fails fence-check:\n"), true, result.stdout);
    assert.equal(result.stdout.includes("no Do NOT section"), true, result.stdout);
    assert.equal(result.stdout.includes(`Fix it, commit, then run devos adopt again.\ndevos: nothing was kept: the branch devos/adopt is removed, and ${bad.folder} is as it was\n`), true, result.stdout);
    unchanged(bad, head);
    assert.equal(bad.git(["branch", "--list", "devos/adopt"]).out, "");
  } finally {
    cleanup(bad.staged.parent);
  }
});

test("adopt-handover.test.mjs (e) the pull request says the cycle resumes from the first open task and lists the tasks accepted as built; a ruling of the project's own is kept beside the engine's", () => {
  const ruling = "| PR-99 | **The shop's own ruling.** | the shop |\n";
  const t = handedOverProject(`${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}`, { rulings: ruling });
  try {
    const remote = bareOrigin(t);
    const head = t.git(["rev-parse", "HEAD"]).out;
    const result = t.run([t.folder], `${KEEP}yes\nyes\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("(your precedents file, with rulings of your own, is kept at docs/method/before-adopt/PRECEDENTS.md)"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: the pull request is https://github.com/devtest/demo-shop/pull/7\n"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: after the merge, the supervisor starts T02 within half an hour"), true, result.stdout);
    assert.equal(remote("refs/heads/devos/adopt"), t.git(["rev-parse", "devos/adopt"]).out.trim());
    unchanged(t, head);
    const body = JSON.parse(readFileSync(path.join(t.staged.parent, "gh.log.bodies"), "utf8").split(/\r?\n/).filter(Boolean)[0]);
    for (const part of [
      "## What it is\n\nA small shop.\n",
      "- DEV_OS's engine files, back in the project it handed over (engine ",
      "- Your plan stays as it is: the documents in `docs/`, `devos/project.json` with the agents chosen at setup, and `devos/answers.json`, which keeps the handover as history.",
      "- The tasks ticked as built after the handover: `T01`. DEV_OS accepts them unreviewed (PR-84): each has `docs/reviews/<task>-a0.md`, and its row in `docs/PHASES.md` says `PASS a0`.\n",
      "- `CLAUDE.md`: the reviewer's rules for this project, written from its plan, after your own text when you have one.\n",
      "(`SETUP.md` has the steps)",
      "The cycle resumes from `T02`, the first open task in `docs/PHASES.md`: the supervisor starts it within half an hour",
    ]) assert.equal(body.includes(part), true, part);
    for (const left of ["fence `T01`", "Risks", "Personal data", "Questions for you"]) assert.equal(body.includes(left), false, left);
    // The project's own ruling stays beside the engine's precedents, which bind from now on.
    assert.equal(t.show("docs/method/before-adopt/PRECEDENTS.md"), t.git(["show", "HEAD:docs/method/PRECEDENTS.md"]).out);
    const precedents = t.show("docs/method/PRECEDENTS.md");
    assert.equal(precedents.includes("PR-99"), false);
    assert.equal(precedents.includes(`${OWN_PR01}\n`), true);
    assert.equal(t.show("CLAUDE.md").startsWith("# DEMO-SHOP — reviewer rules\n"), true);
  } finally {
    cleanup(t.staged.parent);
  }
  // Every task built: nothing to resume; an id that is not a task is never posted.
  const body = adoptPullBody({ name: "Shop" }, "", { handover: { engine: "1.9.0", accepted: ["T01", "../x"], resume: "" } });
  assert.equal(body.includes("- The tasks ticked as built after the handover: `T01`. "), true, body);
  assert.equal(body.includes("Every task in `docs/PHASES.md` is built: a change request (the \"Dev OS change request\" form) plans the next."), true, body);
  assert.equal(body.includes("../x"), false, body);
});

test("adopt-handover.test.mjs (f) the method, the manual, the README and the changelog say so (PR-84), and the ledger and README edits keep every other line", () => {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const precedents = read("payload/files/docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("**Live maximum: PR-84.**"), true);
  assert.equal(precedents.includes("| PR-84 | **A handed-over project comes back by pull request, from its first open task.**"), true);
  assert.equal(read("payload/files/docs/method/AUTOMATION.md").includes("- **A project DEV_OS handed over (PR-83)** keeps its plan"), true);
  assert.equal(read("README.md").includes("A project DEV_OS handed over (`devos init --local`) comes back without an AI tool"), true);
  assert.equal(read("CHANGELOG.md").includes("- **`devos adopt` brings a handed-over project back (PR-84).**"), true);
  assert.equal(read("lib/data/handover-claude.md").includes("`PASS a0 — docs/reviews/<task>-a0.md`"), true);
  // The ledger: only the accepted rows change, and its line endings stay.
  const crlf = `# Phases\r\n\r\n${HEAD}${row("T01", "First task", true)}${row("T02", "Second task", false)}`.replaceAll(/(?<!\r)\n/g, "\r\n");
  assert.equal(phasesAccepted(crlf, ["T01"]), crlf.replace("| [x] | — |", "| [x] | PASS a0 — docs/reviews/T01-a0.md |"));
  const dir = mkdtempSync(path.join(tmpdir(), "devos-ledger-"));
  try {
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    };
    // A method fix (Phase PM) runs on its own track and is resumed first; a reviewed task keeps its verdict.
    write("docs/PHASES.md", `${HEAD}| T01 | P1 | S1 | First task | 1 | — | [x] | PASS a1 — docs/reviews/T01-a1.md |\n${row("T02", "Second task", true)}${row("T03", "Third task", false)}${row("T04", "Method fix", false, "PM")}`);
    write("docs/reviews/T01-a1.md", "VERDICT: PASS\n");
    const tasks = handoverTasks(dir);
    assert.deepEqual([tasks.accept.map((item) => item.task), tasks.resume], [["T02"], "T04"]);
    write("docs/reviews/T02-a0.md", "# mine\n");
    assert.match(handoverTasks(dir).error, /^devos: docs\/reviews\/T02-a0\.md exists, and DEV_OS writes it for a task built after the handover/);
    write("docs/PHASES.md", `${HEAD}${row("T1", "First task", true)}`);
    assert.match(handoverTasks(dir).error, /^devos: docs\/PHASES\.md has the task id T1; ids are Tnn/);
  } finally {
    cleanup(dir);
  }
  // README: only the handover's section is replaced; one the developer rewrote stays.
  const local = ["# Shop", "", "A shop.", ...projectReadmeHow({ cycle: "local" }), "## Licence", "", "MIT", ""].join("\n");
  const adopted = readmeAdopted(local, "o/shop");
  assert.equal(adopted, ["# Shop", "", "A shop.", ...projectReadmeHow({}, "o/shop"), "## Licence", "", "MIT", ""].join("\n"));
  const rewritten = "# Shop\n\n## How this project is built\n\nWe build it with care.\n";
  assert.equal(readmeAdopted(rewritten, "o/shop"), rewritten);
  // The answers lose the local cycle; the project's own rulings are found by id.
  const answers = handoverAnswers({ name: "Shop", cycle: "local", deploy: "none", handover: { engine: "1.9.0", on: "2026-11-05" } }, { stage: "in-development" }, { repository: { visibility: "public" }, engine: ENGINE, head: "abc" }, { link: true, accepted: [], resume: "T01" });
  assert.deepEqual(answers, { name: "Shop", deploy: "none", visibility: "public", contract_version: CONTRACT_VERSION, registry_link: true, adopted: { stage: "in-development", head: "abc", engine: ENGINE, handover: { engine: "1.9.0", on: "2026-11-05", accepted: [], resume: "T01" } } });
  assert.deepEqual(ownRulings("| PR-01 | a |\n| PR-02 | b |\n", "| PR-01 | x |\n| PR-99 | y |\n| PR-02 | b |\n"), ["PR-99"]);
});
