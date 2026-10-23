import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { KEY_RE, keyFromName } from "../lib/install.mjs";
import { checkRoster } from "../lib/roster.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const fixtures = path.join(root, "test", "fixtures", "docs");

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const claudeStub = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const early = process.argv.slice(2);
if (early.includes("--version") || (early[0] === "auth" && early[1] === "status")) process.exit(0);
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const log = process.env.DEVOS_CLAUDE_LOG;
  appendFileSync(log, JSON.stringify({
    args,
    stdin,
    settings: existsSync(path.join(process.cwd(), ".claude", "settings.json")),
  }) + "\\n");
  const mode = process.env.STUB_MODE || "good";
  if (mode === "fail") process.exit(1);
  if (mode === "fail-json") {
    process.stdout.write('{"type":"result","is_error":true,"result":"Claude AI usage limit reached|1760900000"}');
    process.exit(1);
  }
  const docs = path.join(process.cwd(), "docs");
  mkdirSync(path.join(docs, "fences"), { recursive: true });
  if (mode === "bad-then-good" && !args.includes("--continue")) {
    writeFileSync(path.join(docs, "PHASES.md"), "No header here\\n");
    process.stdout.write('{"result":"stub summary"}');
    return;
  }
  const fixtureDir = process.env.DEVOS_FIXTURES;
  writeFileSync(path.join(docs, "PHASES.md"), readFileSync(path.join(fixtureDir, "PHASES.md")));
  writeFileSync(path.join(docs, "GLOSSARY.md"), readFileSync(path.join(fixtureDir, "GLOSSARY.md")));
  writeFileSync(path.join(docs, "fences", "T01.md"), "# T01\\n");
  if (mode === "omit-questions" && args.includes("--continue")) {
    writeFileSync(path.join(docs, "OPEN_QUESTIONS.md"), "# Open questions\\n");
  }
  process.stdout.write('{"result":"stub summary"}');
});
`;

const toolStub = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const prompt = args.includes("-p") || args[0] === "exec";
if (!prompt) process.exit(0);
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const log = process.env.DEVOS_TOOL_LOG;
  const cliPath = path.join(process.cwd(), ".cursor", "cli.json");
  const cli = existsSync(cliPath) ? readFileSync(cliPath, "utf8") : "";
  if (log) appendFileSync(log, JSON.stringify({ args, stdin, cli }) + "\\n");
  const docs = path.join(process.cwd(), "docs");
  mkdirSync(path.join(docs, "fences"), { recursive: true });
  const fixtureDir = process.env.DEVOS_FIXTURES;
  writeFileSync(path.join(docs, "PHASES.md"), readFileSync(path.join(fixtureDir, "PHASES.md")));
  writeFileSync(path.join(docs, "GLOSSARY.md"), readFileSync(path.join(fixtureDir, "GLOSSARY.md")));
  writeFileSync(path.join(docs, "fences", "T01.md"), "# T01\\n");
  process.stdout.write('{"result":"stub summary"}');
});
`;

const ghStub = `import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const log = process.env.DEVOS_GH_LOG;
if (log) appendFileSync(log, args.join(" ") + "\\n");

if (args[0] === "--version") process.exit(0);
if (args[0] === "auth" && args[1] === "status") {
  const scopes = process.env.DEVOS_GH_NO_WORKFLOW === "1" ? "'repo'" : "'repo', 'workflow'";
  process.stdout.write("Logged in to github.com account devtest\\n");
  process.stdout.write(\`Token scopes: \${scopes}\\n\`);
  process.exit(0);
}
if (args[0] === "api" && args[1] === "user") {
  if (!args.includes("--jq")) {
    process.stdout.write('{"login":"devtest"}\\n');
    process.exit(0);
  }
  process.stdout.write("devtest\\n");
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "create") {
  const remote = path.join(path.resolve(process.cwd(), ".."), "remote.git");
  const init = spawnSync("git", ["init", "--bare", remote], { windowsHide: true });
  if (init.status !== 0) process.exit(init.status ?? 1);
  const added = spawnSync("git", ["remote", "add", "origin", remote], { cwd: process.cwd(), windowsHide: true });
  process.exit(added.status ?? 1);
}
if (args[0] === "secret" && args[1] === "set") {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    if (log) appendFileSync(log, "secret-stdin " + Buffer.concat(chunks).length + "\\n");
    process.exit(0);
  });
  process.stdin.resume();
} else {
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(process.env.STUB_SECRETS || '[{"name":"CURSOR_API_KEY"},{"name":"CLAUDE_CODE_OAUTH_TOKEN"}]');
  process.exit(0);
}
if (args[0] === "variable" && args[1] === "list") {
  process.stdout.write('[{"name":"DEVOS_VERCEL","value":"true"}]');
  process.exit(0);
}
if (args[0] === "workflow" && args[1] === "run") {
  if (process.env.STUB_DISPATCH === "fail-once" && log) {
    const seen = readFileSync(log, "utf8").split("\\n").filter((line) => line.startsWith("workflow run")).length;
    if (seen === 1) process.exit(1);
  }
  process.exit(0);
}
process.exit(0);
}
`;

function writeStubs(dir, tools = []) {
  mkdirSync(dir);
  writeFileSync(path.join(dir, "claude-stub.mjs"), claudeStub);
  writeFileSync(path.join(dir, "gh-stub.mjs"), ghStub);
  for (const name of tools) writeFileSync(path.join(dir, `${name}-stub.mjs`), toolStub);
  if (windows) {
    writeFileSync(path.join(dir, "claude.cmd"), "@node \"%~dp0claude-stub.mjs\" %*\r\n");
    writeFileSync(path.join(dir, "gh.cmd"), "@node \"%~dp0gh-stub.mjs\" %*\r\n");
    for (const name of tools) writeFileSync(path.join(dir, `${name}.cmd`), `@node "%~dp0${name}-stub.mjs" %*\r\n`);
    return;
  }
  const claude = path.join(dir, "claude");
  writeFileSync(claude, `#!/usr/bin/env node\n${claudeStub}`);
  chmodSync(claude, 0o755);
  const gh = path.join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env node\n${ghStub}`);
  chmodSync(gh, 0o755);
  for (const name of tools) {
    const launcher = path.join(dir, name);
    writeFileSync(launcher, `#!/usr/bin/env node\n${toolStub}`);
    chmodSync(launcher, 0o755);
  }
}

function stage(options = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-init-"));
  const project = path.join(parent, "project");
  const stubs = path.join(parent, "bin");
  const home = path.join(parent, "home");
  writeStubs(stubs, options.tools ?? []);
  mkdirSync(path.join(home, ".devos"), { recursive: true });
  if (options.visibility) {
    writeFileSync(path.join(home, ".devos", "profile.json"), `${JSON.stringify({ visibility: options.visibility }, null, 2)}\n`);
  }
  if (options.seed) {
    mkdirSync(project);
    writeFileSync(path.join(project, "keep.txt"), "keep\n");
  }
  const env = {
    ...process.env,
    PATH: `${stubs}${path.delimiter}${process.env.PATH ?? ""}`,
    DEVOS_HOME: home,
    DEVOS_CLAUDE_LOG: path.join(parent, "claude.log"),
    DEVOS_GH_LOG: path.join(parent, "gh.log"),
    DEVOS_TOOL_LOG: path.join(parent, "tool.log"),
    DEVOS_FIXTURES: fixtures,
    DEVOS_RETRY_MS: "0",
    GIT_AUTHOR_NAME: "Devos Test",
    GIT_AUTHOR_EMAIL: "devos@example.com",
    GIT_COMMITTER_NAME: "Devos Test",
    GIT_COMMITTER_EMAIL: "devos@example.com",
    STUB_MODE: options.mode ?? "good",
  };
  return { parent, project, env };
}

function init(staged, input) {
  return spawnSync(process.execPath, [bin, "init", staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: staged.env,
  });
}

function runs(parent) {
  const log = path.join(parent, "claude.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function toolRuns(parent) {
  const log = path.join(parent, "tool.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function flow({ pool = "", blueprint = "", attachment = "", tail = "approve", confirmAnswer = "" } = {}) {
  const agent = ["", "", "", "", "", "", ""];
  agent[2] = pool;
  agent[5] = blueprint;
  return [
    "accept",
    ...agent,
    "Demo Shop",
    "A small shop.",
    "Customers",
    "",
    "",
    "",
    "",
    "",
    attachment,
    "",
    tail,
    confirmAnswer,
  ].join("\n") + "\n";
}

const menus = ["", "", "", "", "", "", ""];
const accepted = [
  "accept",
  ...menus,
  "Demo Shop",
  "A small shop.",
  "Customers",
  "",
  "",
  "",
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
    assert.equal(result.stdout.includes("devos init --continue"), true, result.stdout);
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
    assert.equal(called[0].stdin.startsWith("# Blueprint"), true);
    const kit = readFileSync(path.join(root, "payload", "files", "devos", "roles", "cursor-blueprint", "cli.json"), "utf8");
    assert.equal(called[0].cli, kit);
    const after = readFileSync(path.join(staged.project, ".cursor", "cli.json"));
    const payload = readFileSync(path.join(root, "payload", "files", "dot-cursor", "cli.json"));
    assert.deepEqual(after, payload);
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
    assert.deepEqual(called[0].args.slice(0, 4), ["exec", "--model", "gpt-5.1-codex", "-"]);
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
    assert.equal(result.stdout.includes("gh auth refresh -h github.com -s repo,workflow"), true, result.stdout);
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
