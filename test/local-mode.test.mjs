import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { doctorCommand } from "../lib/doctor.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { projectRows, projectSteps } from "../lib/verify.mjs";
import { resumePoint } from "../lib/continue.mjs";
import { cleanup, stage } from "./harness.mjs";
import { which } from "../lib/which.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const signedIn = [{ toolId: "claude", status: "installed", signedIn: true }];
const gitBin = path.dirname(which("git").path);
const nodeBin = path.dirname(process.execPath);

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function ghText(staged) {
  const file = staged.env.DEVOS_GH_LOG;
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function doneLine(folder) {
  return `devos init: ${folder} is set up on this computer; build T01 in your IDE from docs/fences/T01.md on the branch task/T01`;
}

function quoted(folder) {
  return /\s/.test(folder) ? `"${folder}"` : folder;
}

function initLocal(staged, input) {
  return spawnSync(process.execPath, [bin, "init", "--local", staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: staged.env,
  });
}

// The same answers as a default init, without the link, the hosting module or the visibility.
function localFlow(backup = "") {
  return [
    "accept",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "database none",
    "",
    "auth none",
    "",
    "email none",
    "",
    "",
    "Demo Shop",
    "A small shop.",
    "Customers",
    "",
    "",
    "",
    "approve",
    backup,
  ].join("\n") + "\n";
}

function basePlan() {
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

function localPlan() {
  const plan = basePlan();
  plan.cycle = "local";
  delete plan.fields.visibility;
  delete plan.link;
  return plan;
}

test("local-mode.test.mjs (a) devos init --local ends with a local project and never calls gh", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const result = initLocal(staged, localFlow());
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.at(-1), doneLine(path.resolve(staged.project)));
    assert.equal(git(["log", "--format=%s", "main"], staged.project).stdout.trim(), "DEV_OS bootstrap: Demo Shop");
    assert.equal(git(["rev-list", "--count", "main"], staged.project).stdout.trim(), "1");
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.cycle, "local");
    assert.equal(answers.registry_link, false);
    const readme = readFileSync(path.join(staged.project, "README.md"), "utf8");
    assert.equal(readme.includes("DEV_OS builds this project on this computer, one task at a time, with the agents and models chosen at `devos init`:"), true, readme);
    const setup = readFileSync(path.join(staged.project, "SETUP.md"), "utf8");
    assert.equal(setup.includes("## 3. Add a GitHub backup later"), true, setup);
    assert.equal(ghText(staged).trim(), "");
  } finally {
    cleanup(staged.parent);
  }
});

test("local-mode.test.mjs (b) a local plan asks no link, visibility or hosting, and refuses them", () => {
  const accepted = validatePlan(localPlan(), signedIn);
  assert.equal(accepted.ok, true, (accepted.errors ?? []).join(" | "));
  assert.equal(accepted.answers.cycle, "local");
  const keys = Object.keys(accepted.answers);
  assert.equal(keys[keys.indexOf("scope") + 1], "cycle");

  const linked = localPlan();
  linked.link = true;
  const link = validatePlan(linked, signedIn);
  assert.equal(link.ok, false);
  assert.equal(link.errors.includes("A local project has no Control Tower link; it is asked when the project moves to GitHub."), true, link.errors.join(" | "));

  const hosted = localPlan();
  hosted.project.modules = { ...hosted.project.modules, hosting: "vercel" };
  const hosting = validatePlan(hosted, signedIn);
  assert.equal(hosting.ok, false);
  assert.equal(hosting.errors.includes("A local project has no hosting: deploys run on GitHub."), true, hosting.errors.join(" | "));

  const elsewhere = localPlan();
  elsewhere.cycle = "elsewhere";
  const cycle = validatePlan(elsewhere, signedIn);
  assert.equal(cycle.ok, false);
  assert.equal(cycle.errors.includes("The cycle runs on GitHub or on this computer: \"github\" or \"local\"."), true, cycle.errors.join(" | "));

  const github = validatePlan(basePlan(), signedIn);
  assert.equal(github.ok, true, (github.errors ?? []).join(" | "));
  assert.equal(Object.hasOwn(github.answers, "cycle"), false);
});

test("local-mode.test.mjs (c) the local doctor needs Node and git, not gh", () => {
  const saved = process.env.PATH;
  const dir = mkdtempSync(path.join(tmpdir(), "devos-git-"));
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    if (process.platform === "win32") {
      writeFileSync(path.join(dir, "git.cmd"), "@echo off\r\necho git version 2.0.0\r\n");
    } else {
      const stub = path.join(dir, "git");
      writeFileSync(stub, "#!/bin/sh\necho 'git version 2.0.0'\n");
      chmodSync(stub, 0o755);
    }
    process.env.PATH = dir;
    const code = doctorCommand({ local: true });
    assert.equal(code, 0);
    assert.equal(lines.includes(`devos: doctor ok (this computer: Node.js ${process.versions.node}, git)`), true, lines.join("\n"));
    assert.equal(doctorCommand(), 1);
  } finally {
    console.log = original;
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local-mode.test.mjs (d) verify and continue know a local project", () => {
  const staged = stage();
  const saved = process.env.PATH;
  try {
    mkdirSync(path.join(staged.project, "devos"), { recursive: true });
    mkdirSync(path.join(staged.project, ".claude"), { recursive: true });
    writeFileSync(path.join(staged.project, "devos", "answers.json"), `${JSON.stringify({ name: "Demo Shop", cycle: "local", modules: {} }, null, 2)}\n`);
    writeFileSync(path.join(staged.project, "devos", "engine.lock.json"), "{}\n");
    writeFileSync(path.join(staged.project, ".claude", "settings.json"), "{}\n");
    writeFileSync(path.join(staged.project, "devos.config.json"), `${JSON.stringify({
      agents: {
        reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
        pool: [{ id: "claude-builder", tool: "claude", model: "claude-sonnet-5-5", default: true }],
      },
    }, null, 2)}\n`);

    const calls = [];
    process.env.PATH = path.join(staged.parent, "bin");
    const state = projectSteps(staged.project, (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      return { status: 1, stdout: "" };
    });
    process.env.PATH = saved;
    assert.deepEqual(state.steps.map((step) => step.name), ["answers", "engine files", "blueprint approved", "local commit", "local tools"]);
    assert.equal(state.slug, "");
    assert.equal(calls.some((line) => line.startsWith("gh")), false, calls.join("\n"));
    assert.equal(resumePoint(staged.project).step, "the local commit");

    const open = projectRows(staged.project, {
      slug: "",
      steps: [
        { ok: true, name: "answers", who: "devos" },
        { ok: true, name: "engine files", who: "devos" },
        { ok: true, name: "blueprint approved", who: "you" },
        { ok: true, name: "local commit", who: "devos" },
        { ok: false, name: "local tools", who: "you" },
      ],
    });
    const missing = open.find((row) => row.label === "local tools");
    assert.equal(missing.state, "block");
    assert.equal(missing.detail, "an agent tool is missing or not signed in");
    assert.equal(missing.fix, `Sign in to each agent tool (devos agents detect lists them), then run devos continue ${quoted(staged.project)}`);
    assert.equal(missing.who, "you");
    const done = projectRows(staged.project, {
      slug: "",
      steps: [{ ok: true, name: "local tools", who: "you" }],
    });
    assert.equal(done[0].detail, "every agent tool is signed in");

    const env = { ...staged.env, PATH: `${path.join(staged.parent, "bin")}${path.delimiter}${nodeBin}${path.delimiter}${gitBin}` };
    const first = spawnSync(process.execPath, [bin, "continue", staged.project], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      input: "\n",
      env,
    });
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.equal(git(["log", "-1", "--format=%s"], staged.project).stdout.trim(), "DEV_OS bootstrap: Demo Shop");
    assert.equal(ghText(staged).trim(), "");
    assert.equal(resumePoint(staged.project).step, "build the next task in your IDE from its fence");

    const second = spawnSync(process.execPath, [bin, "continue", staged.project], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      input: "",
      env,
    });
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(second.stdout.split(/\r?\n/).includes("devos: everything is done — build each task in your IDE from its fence in docs/fences/"), true, second.stdout);
    assert.equal(ghText(staged).trim(), "");
  } finally {
    process.env.PATH = saved;
    cleanup(staged.parent);
  }
});

test("local-mode.test.mjs (e) yes to the GitHub backup creates a private repository, pauses DEV_OS there before the push, and pushes", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const result = initLocal(staged, localFlow("yes"));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const out = result.stdout.trim().split(/\r?\n/);
    const backup = "devos init: backup on GitHub: devtest/demo-shop (only ci.yml runs there; DEVOS_PAUSED is true)";
    const done = doneLine(path.resolve(staged.project));
    assert.equal(out.at(-1), done, result.stdout);
    assert.equal(out.indexOf(backup) >= 0 && out.indexOf(backup) < out.indexOf(done), true, result.stdout);
    const lines = ghText(staged).split(/\r?\n/).filter(Boolean);
    const createAt = lines.indexOf("repo create devtest/demo-shop --private --source . --remote origin");
    const pausedAt = lines.indexOf("variable set DEVOS_PAUSED --body true --repo devtest/demo-shop");
    assert.equal(createAt >= 0 && pausedAt > createAt, true, lines.join("\n"));
    assert.equal(lines.filter((line) => line.startsWith("variable set")).length, 1, lines.join("\n"));
    assert.equal(lines.some((line) => line.startsWith("secret set")), false, lines.join("\n"));
    assert.equal(lines.some((line) => line.startsWith("workflow run")), false, lines.join("\n"));
    const remote = path.join(staged.parent, "remote.git");
    assert.equal(git(["log", "-1", "--format=%s", "main"], remote).stdout.trim(), "DEV_OS bootstrap: Demo Shop");
    assert.equal(git(["rev-parse", "main"], remote).stdout.trim(), git(["rev-parse", "HEAD"], staged.project).stdout.trim());
  } finally {
    cleanup(staged.parent);
  }
});
