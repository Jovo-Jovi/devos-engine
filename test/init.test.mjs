import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { doctorCommand } from "../lib/doctor.mjs";
import { BLUEPRINT_POINTER, blueprintArgs } from "../lib/init.mjs";
import { KEY_RE, keyFromName } from "../lib/install.mjs";
import { checkRoster } from "../lib/roster.mjs";
import { cleanup, flow, init, processGone, runs, stage, toolRuns } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");


const menus = ["", "", "", "", "", "", ""];
const accepted = [
  "accept",
  ...menus,
  "",
  "",
  "database none",
  "",
  "auth none",
  "",
  "email none",
  "",
  "",
  "",
  "Demo Shop",
  "A small shop.",
  "Customers",
  "",
  "",
  "",
  "",
].join("\n");

test("init.test.mjs declines the contract before creating anything", () => {
  const staged = stage();
  try {
    const result = init(staged, "no\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("contract declined"), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
    assert.equal(runs(staged.parent).length, 0);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs stops when input ends during the questions", () => {
  const staged = stage();
  try {
    const result = init(staged, "accept\nDemo\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("input ended"), true, result.stdout);
    assert.equal(existsSync(staged.project), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs approves a blueprint with the defaults", () => {
  const staged = stage();
  try {
    const result = init(staged, `${accepted}\napprove\n\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("blueprint approved"), true, result.stdout);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    assert.equal(project.project, "DEMO-SHOP");
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.stores_data, false);
    assert.equal(answers.sign_in, "none");
    assert.deepEqual(answers.languages, ["en"]);
    assert.equal(answers.deploy, "vercel");
    assert.equal(answers.visibility, "private");
    assert.equal(answers.scope, "mvp");
    assert.equal(answers.contract_version, "0-draft-2");
    const called = runs(staged.parent);
    assert.equal(called.length, 1);
    assert.equal(called[0].stdin.startsWith("# Blueprint"), true);
    assert.equal(called[0].args.includes("-p"), true);
    assert.equal(called[0].args.includes("acceptEdits"), true);
    assert.equal(called[0].args.includes("--continue"), false);
    assert.equal(called[0].settings, false);
    const settings = readFileSync(path.join(staged.project, ".claude", "settings.json"));
    const payload = readFileSync(path.join(root, "payload", "files", "dot-claude", "settings.json"));
    assert.deepEqual(settings, payload);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], {
      cwd: staged.project,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(guards.status, 0, guards.stdout + guards.stderr);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs sends a change request as the next round", () => {
  const staged = stage();
  try {
    const result = init(staged, `${accepted}\nrename T01\napprove\n\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].args.includes("--continue"), true);
    assert.equal(called[1].stdin.includes("rename T01"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs repairs a failed phases check before approval", () => {
  const staged = stage({ mode: "bad-then-good" });
  try {
    const result = init(staged, `${accepted}\napprove\n\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].stdin.includes("guard:phases"), true, called[1].stdin);
    assert.equal(called[1].stdin.startsWith("The checks after your last round failed:"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs stops when the blueprint fails", () => {
  const staged = stage({ mode: "fail" });
  try {
    const result = init(staged, `${accepted}\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("the blueprint failed"), true, result.stdout);
    assert.equal(existsSync(path.join(staged.project, ".claude", "settings.json")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs refuses a folder that is not empty", () => {
  const staged = stage({ seed: true });
  try {
    const result = init(staged, "accept\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(runs(staged.parent).length, 0);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs takes visibility from the profile", () => {
  const staged = stage({ visibility: "public" });
  try {
    const result = init(staged, `${accepted}\napprove\n\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.visibility, "public");
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs keyFromName matches the key rule", () => {
  assert.equal(keyFromName("Demo Shop"), "DEMO-SHOP");
  assert.equal(keyFromName("42 things!"), "P-42-THINGS");
  for (const name of ["Demo Shop", "42 things!"]) assert.equal(KEY_RE.test(keyFromName(name)), true);
});

test("init.test.mjs contract version is 0-draft-2", () => {
  const first = readFileSync(path.join(root, "payload", "contract", "CONTRACT.md"), "utf8").split("\n")[0];
  assert.equal(first.endsWith("version 0-draft-2"), true, first);
  assert.equal(CONTRACT_VERSION, "0-draft-2");
});

test("init.test.mjs prints a JSON blueprint error and how to resume", () => {
  const staged = stage({ mode: "fail-json" });
  try {
    const result = init(staged, `${accepted}\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("Claude AI usage limit reached"), true, result.stdout);
    assert.equal(result.stdout.includes("claude exited with 1"), true, result.stdout);
    assert.equal(result.stdout.includes("reports a usage limit"), true, result.stdout);
    assert.equal(result.stdout.includes("devos continue"), true, result.stdout);
    assert.equal(existsSync(path.join(staged.project, ".claude", "settings.json")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs resumes a failed blueprint with --continue", () => {
  const staged = stage({ mode: "fail-json" });
  try {
    const failed = init(staged, `${accepted}\n`);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    staged.env.STUB_MODE = "good";
    const result = spawnSync(process.execPath, [bin, "init", "--continue", staged.project], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      input: "approve\n\n",
      env: staged.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].args.includes("--continue"), false);
    const settings = readFileSync(path.join(staged.project, ".claude", "settings.json"));
    const payload = readFileSync(path.join(root, "payload", "files", "dot-claude", "settings.json"));
    assert.deepEqual(settings, payload);
    const gh = readFileSync(path.join(staged.parent, "gh.log"), "utf8").trim().split("\n");
    assert.equal(gh.at(-1).startsWith("workflow run devos-cycle.yml"), true, gh.at(-1));
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (m) defaults use the engine reviewer model", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = runs(staged.parent);
    assert.equal(called[0].args.includes("--model"), true, called[0].args.join(" "));
    assert.equal(called[0].args.includes("claude-opus-5-5"), true, called[0].args.join(" "));
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    assert.equal(project.agents.reviewer.model, "claude-opus-5-5");
    const roster = JSON.parse(readFileSync(path.join(staged.parent, "home", ".devos", "roster.json"), "utf8"));
    assert.notEqual(checkRoster(roster), null);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (n) blueprint on Cursor grok-4.7", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const result = init(staged, flow({ blueprint: "Cursor CLI · grok-4.7" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = toolRuns(staged.parent);
    assert.equal(called.length, 1);
    assert.equal(called[0].args.includes("-p"), true, called[0].args.join(" "));
    assert.equal(called[0].args.includes("--force"), true, called[0].args.join(" "));
    assert.equal(called[0].args.includes("--model"), true);
    assert.equal(called[0].args.includes("grok-4.7"), true, called[0].args.join(" "));
    assert.equal(called[0].args.at(-1), BLUEPRINT_POINTER);
    assert.equal(called[0].stdin, "");
    assert.equal(called[0].input.startsWith("# Blueprint"), true);
    const kit = readFileSync(path.join(root, "payload", "files", "devos", "roles", "cursor-blueprint", "cli.json"), "utf8");
    assert.equal(called[0].cli, kit);
    const after = readFileSync(path.join(staged.project, ".cursor", "cli.json"));
    const payload = readFileSync(path.join(root, "payload", "files", "dot-cursor", "cli.json"));
    assert.deepEqual(after, payload);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (u) an agent that fails without a word gets the call to try by hand", () => {
  const staged = stage({ tools: ["agent"] });
  try {
    const result = init(staged, flow({ blueprint: "Cursor CLI · grok-4.7" }), { STUB_TOOL_MODE: "silent" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const output = result.stdout + result.stderr;
    assert.equal(output.includes("devos: agent exited with 1"), true, output);
    assert.equal(output.includes("devos: agent printed nothing. To see why, run the same call by hand in"), true, output);
    assert.equal(output.includes('  agent --trust --force -p --model grok-4.7 --output-format json "Read the file .devos/blueprint-input.md in this folder and do exactly what it says."'), true, output);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (o) blueprint on Codex", () => {
  const staged = stage({ tools: ["codex"] });
  try {
    const result = init(staged, flow({ blueprint: "Codex CLI · gpt-5.1-codex" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const called = toolRuns(staged.parent);
    assert.equal(called.length, 1);
    assert.deepEqual(called[0].args, ["exec", "--model", "gpt-5.1-codex", "--sandbox", "workspace-write"]);
    assert.equal(called[0].stdin.startsWith("# Blueprint"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (p) an attached brief asks for open questions", () => {
  const staged = stage({ mode: "omit-questions" });
  try {
    const brief = path.join(staged.parent, "brief.md");
    writeFileSync(brief, "# Brief\nA shop.\n");
    const result = init(staged, flow({ attachment: brief }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const copied = readFileSync(path.join(staged.project, "devos", "intake-docs", "brief.md"), "utf8");
    assert.equal(copied, "# Brief\nA shop.\n");
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.deepEqual(answers.attachments, ["brief.md"]);
    const called = runs(staged.parent);
    assert.equal(called.length, 2);
    assert.equal(called[1].args.includes("--continue"), true);
    assert.equal(existsSync(path.join(staged.project, "docs", "OPEN_QUESTIONS.md")), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (q) missing workflow scope stops before the contract", () => {
  const staged = stage();
  staged.env.DEVOS_GH_NO_WORKFLOW = "1";
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("gh auth refresh -h github.com -s workflow"), true, result.stdout);
    assert.equal(result.stdout.includes("Type accept"), false, result.stdout);
    assert.equal(existsSync(staged.project), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (r) a Claude-only pool lists the Claude key", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ pool: "Claude Code · claude-sonnet-5-5" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("CLAUDE_CODE_OAUTH_TOKEN"), true, result.stdout);
    assert.equal(result.stdout.includes("CURSOR_API_KEY"), false, result.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (a) GitHub role menus omit tools the cycle cannot run", () => {
  const staged = stage();
  try {
    const result = init(staged, "accept\n");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const note = "Muse and GLM join the GitHub roles in a later version.";
    assert.equal(result.stdout.includes(note), true, result.stdout);
    const reviewer = result.stdout.split("Light reviewer")[0];
    assert.equal(/^\s+\d+\) .*Codex/m.test(reviewer), true, reviewer);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (b) a Codex reviewer in the roster falls back to the engine default", () => {
  const staged = stage();
  try {
    writeFileSync(path.join(staged.parent, "home", ".devos", "roster.json"), `${JSON.stringify({
      reviewer: { id: "codex-gpt", tool: "glm", model: "glm-4.6" },
      reviewer_light: { id: "codex-light", tool: "glm", model: "glm-4.6" },
      pool: [{ id: "codex-pool", tool: "glm", model: "glm-4.6", default: true, note: "default builder" }],
      policy: "reviewer-picks",
    }, null, 2)}\n`);
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    assert.equal(project.agents.reviewer.tool, "claude");
    assert.equal(project.agents.reviewer.model, "claude-opus-5-5");
    assert.equal(project.agents.pool.some((item) => item.tool === "codex"), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (c) a rejected token prints gh auth login", () => {
  const savedPath = process.env.PATH;
  const savedToken = process.env.DEVOS_GH_BAD_TOKEN;
  process.env.PATH = `${path.join(root, "test", "fixtures", "agents")}${path.delimiter}${savedPath ?? ""}`;
  process.env.DEVOS_GH_BAD_TOKEN = "1";
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  let code = 0;
  try {
    code = doctorCommand();
  } finally {
    process.stdout.write = write;
    process.env.PATH = savedPath;
    if (savedToken === undefined) delete process.env.DEVOS_GH_BAD_TOKEN;
    else process.env.DEVOS_GH_BAD_TOKEN = savedToken;
  }
  const text = lines.join("");
  assert.equal(code, 1);
  assert.equal(text.includes("Run: gh auth login"), true, text);
  assert.equal(text.includes("gh auth refresh"), false, text);
});

test("init.test.mjs (d) Codex and Gemini blueprint args", () => {
  assert.deepEqual(blueprintArgs("codex", "gpt-5.1-codex", 1), ["exec", "--model", "gpt-5.1-codex", "--sandbox", "workspace-write"]);
  assert.deepEqual(
    blueprintArgs("gemini", "gemini-2.5-pro", 1),
    ["--model", "gemini-2.5-pro", "--approval-mode", "yolo", "-p", "Follow the instructions given on standard input exactly."],
  );
});

test("init.test.mjs (e) a heartbeat prints while the blueprint runs", () => {
  const staged = stage();
  try {
    const result = init(staged, flow(), { STUB_MODE: "slow", DEVOS_HEARTBEAT_MS: "50" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("blueprint running on"), true, result.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("init.test.mjs (f) Ctrl-C during a round exits 130", { skip: process.platform === "win32" }, async () => {
  const staged = stage();
  const child = spawn(process.execPath, [bin, "init", staged.project], {
    windowsHide: true,
    env: { ...staged.env, STUB_MODE: "hang" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write(flow());
  const pidFile = path.join(staged.parent, "model.pid");
  const started = Date.now();
  try {
    while (!existsSync(pidFile)) {
      if (Date.now() - started > 20000) throw new Error(`model pid was not written\n${stdout}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const modelPid = Number(readFileSync(pidFile, "utf8"));
    child.kill("SIGINT");
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 5000);
      child.on("exit", (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    assert.equal(code, 130, stdout);
    assert.equal(stdout.includes("devos: stopped — the folder keeps what was written"), true, stdout);
    assert.equal(await processGone(modelPid, 5000), true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    cleanup(staged.parent);
  }
});

test("init.test.mjs (g) a round past the limit is stopped", () => {
  const staged = stage();
  try {
    const result = init(staged, flow(), { STUB_MODE: "hang", DEVOS_ROUND_LIMIT_MS: "400" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("ran over an hour and was stopped"), true, result.stdout);
  } finally {
    cleanup(staged.parent);
  }
});
