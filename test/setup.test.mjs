import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { installInto } from "../lib/install.mjs";
import { finishSetup, setupItems, setupMarkdown } from "../lib/setup.mjs";

// Git 2.47 and later run their automatic maintenance in the background after a commit or a fetch, and it can still be
// writing into .git while a test removes its folder (ENOTEMPTY on the CI runner, E32). Every git a test starts, itself
// or through devos and its stubs, runs without it.
Object.assign(process.env, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "maintenance.auto", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0" });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const fixtures = path.join(root, "test", "fixtures", "docs");
const setupJson = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const claudeStub = `import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  writeFileSync(path.join(docs, "fences", "T01.md"), readFileSync(path.join(fixtureDir, "..", "fences", "T01.md")));
  mkdirSync(path.join(docs, "design"), { recursive: true });
  writeFileSync(path.join(docs, "DESIGN_SYSTEM.md"), "# Design system\\n");
  writeFileSync(path.join(docs, "design", "UI_ACCEPTANCE.md"), "| Id | Criterion | Checked by |\\n|---|---|---|\\n| UA-01 | Text contrast meets WCAG 2.2 AA | automated |\\n");
  // PR-59: every screenshot the developer gave is a row of REFERENCES.md.
  const refsDir = path.join(docs, "design", "references");
  const refNames = existsSync(refsDir) ? readdirSync(refsDir).sort() : [];
  if (!(false)) writeFileSync(path.join(docs, "design", "REFERENCES.md"), ["| Ref | Source | What we take | What we leave |", "|---|---|---|---|", ...refNames.map((name, i) => "| R" + (i + 1) + " | " + name + " | the spacing | the colours |")].join("\\n") + "\\n");
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

function writeStubs(dir) {
  mkdirSync(dir);
  writeFileSync(path.join(dir, "claude-stub.mjs"), claudeStub);
  writeFileSync(path.join(dir, "gh-stub.mjs"), ghStub);
  if (windows) {
    writeFileSync(path.join(dir, "claude.cmd"), "@node \"%~dp0claude-stub.mjs\" %*\r\n");
    writeFileSync(path.join(dir, "gh.cmd"), "@node \"%~dp0gh-stub.mjs\" %*\r\n");
    return;
  }
  const claude = path.join(dir, "claude");
  writeFileSync(claude, `#!/usr/bin/env node\n${claudeStub}`);
  chmodSync(claude, 0o755);
  const gh = path.join(dir, "gh");
  writeFileSync(gh, `#!/usr/bin/env node\n${ghStub}`);
  chmodSync(gh, 0o755);
}

function stage(options = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-setup-"));
  const project = path.join(parent, "project");
  const home = path.join(parent, "home");
  writeStubs(path.join(parent, "bin"));
  mkdirSync(path.join(home, ".devos"), { recursive: true });
  if (options.visibility || options.owner) {
    const data = {};
    if (options.visibility) data.visibility = options.visibility;
    if (options.owner) data.github_owner = options.owner;
    writeFileSync(path.join(home, ".devos", "profile.json"), `${JSON.stringify(data, null, 2)}\n`);
  }
  if (options.empty) mkdirSync(project);
  const env = {
    ...process.env,
    PATH: `${path.join(parent, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    DEVOS_HOME: home,
    DEVOS_CLAUDE_LOG: path.join(parent, "claude.log"),
    DEVOS_GH_LOG: path.join(parent, "gh.log"),
    DEVOS_FIXTURES: fixtures,
    DEVOS_RETRY_MS: "0",
    GIT_AUTHOR_NAME: "Devos Test",
    GIT_AUTHOR_EMAIL: "devos@example.com",
    GIT_COMMITTER_NAME: "Devos Test",
    GIT_COMMITTER_EMAIL: "devos@example.com",
    STUB_MODE: "good",
  };
  if (options.secrets !== undefined) env.STUB_SECRETS = options.secrets;
  if (options.dispatch) env.STUB_DISPATCH = options.dispatch;
  return { parent, project, env };
}

function init(staged, input, { cont = false } = {}) {
  const args = [bin, "init"];
  if (cont) args.push("--continue");
  args.push(staged.project);
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: staged.env,
  });
}

function ghLines(parent) {
  const file = path.join(parent, "gh.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "" && line !== "--version");
}

function git(remote, args) {
  return spawnSync("git", args, { cwd: remote, encoding: "utf8", windowsHide: true });
}

function answers(overrides = {}) {
  return [
    "accept",
    overrides.link ?? "no",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    overrides.type ?? "",
    "",
    "database none",
    "",
    "auth none",
    "",
    "email none",
    overrides.deploy === "none" ? "none" : "",
    "",
    "",
    overrides.name ?? "Demo Shop",
    "A small shop.",
    "Customers",
    "",
    overrides.visibility ?? "",
    "",
    "",
    "approve",
    "",
  ].join("\n") + "\n";
}

const SIX = ["cursor", "claude", "vercel", "vercel-bypass", "vercel-var", "production-url"];

function headingsFor(ids) {
  return ids.map((id, index) => {
    const item = setupJson.items.find((entry) => entry.id === id);
    return `## ${index + 1}. ${item.title}`;
  });
}

test("setup.test.mjs creates the repository and dispatches the cycle", () => {
  const staged = stage();
  try {
    const result = init(staged, answers());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const last = result.stdout.trim().split(/\r?\n/).at(-1);
    assert.equal(last, "devos init: devtest/demo-shop is set up; devos-cycle dispatched");
    const remote = path.join(staged.parent, "remote.git");
    assert.equal(git(remote, ["rev-list", "--count", "main"]).stdout.trim(), "1");
    assert.equal(git(remote, ["log", "-1", "--format=%s", "main"]).stdout.trim(), "DEV_OS bootstrap: Demo Shop");
    const tree = git(remote, ["ls-tree", "-r", "--name-only", "main"]).stdout.split("\n");
    assert.equal(tree.includes("SETUP.md"), true);
    assert.equal(tree.includes("docs/fences/T01.md"), true);
    assert.equal(tree.includes(".claude/settings.json"), true);
    assert.deepEqual(ghLines(staged.parent), [
      "auth status",
      "api user",
      "api user --jq .login",
      "repo create devtest/demo-shop --private --source . --remote origin",
      "api -X PUT repos/devtest/demo-shop/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true",
      "label create devos:request --color 1d76db --description A change request for DEV_OS to plan (the Dev OS change request form) --force --repo devtest/demo-shop",
      "label create devos:method --color 5319e7 --description A DEV_OS method fix (the Dev OS method fix form) --force --repo devtest/demo-shop",
      "repo edit devtest/demo-shop --enable-wiki=false --enable-projects=false",
      "variable set DEVOS_VERCEL --body true --repo devtest/demo-shop",
      "secret list --repo devtest/demo-shop --json name",
      "variable list --repo devtest/demo-shop --json name,value",
      "workflow run devos-cycle.yml --repo devtest/demo-shop",
    ]);
    assert.equal(ghLines(staged.parent).some((line) => line.includes("secret set")), false);
    assert.equal(result.stdout.includes("gh secret set CURSOR_API_KEY --repo devtest/demo-shop"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs writes SETUP headings for vercel and for none", () => {
  const vercel = stage();
  const none = stage();
  try {
    const deployed = init(vercel, answers());
    assert.equal(deployed.status, 0, deployed.stdout + deployed.stderr);
    const headings = readFileSync(path.join(vercel.project, "SETUP.md"), "utf8").split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, headingsFor(SIX));
    const plain = init(none, answers({ deploy: "none" }));
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    const fewer = readFileSync(path.join(none.project, "SETUP.md"), "utf8").split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(fewer, headingsFor(["cursor", "claude"]));
    assert.equal(ghLines(none.parent).some((line) => line.startsWith("variable set")), false);
  } finally {
    cleanup(vercel.parent);
    cleanup(none.parent);
  }
});

test("setup.test.mjs continues after the cycle settings are added", () => {
  const staged = stage({ secrets: "[]" });
  try {
    const first = init(staged, answers());
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.equal(first.stdout.includes("the cycle still needs settings"), true, first.stdout);
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("workflow run")), false);
    delete staged.env.STUB_SECRETS;
    const second = init(staged, "\n", { cont: true });
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(ghLines(staged.parent).filter((line) => line.startsWith("repo create")).length, 1);
    assert.equal(git(path.join(staged.parent, "remote.git"), ["rev-list", "--count", "main"]).stdout.trim(), "1");
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs uses github_owner from the profile", () => {
  const staged = stage({ owner: "acme" });
  try {
    const result = init(staged, answers());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), "devos init: acme/demo-shop is set up; devos-cycle dispatched");
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("api user --jq")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs creates a public repository when visibility is public", () => {
  const staged = stage();
  try {
    const result = init(staged, answers({ visibility: "public" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("repo create devtest/demo-shop --public ")), true, ghLines(staged.parent).join("\n"));
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs refuses continue without an approved blueprint", () => {
  const staged = stage({ empty: true });
  try {
    const result = init(staged, "", { cont: true });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("devos: start with devos init in an empty folder"), true, result.stdout);
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs retries a failed cycle dispatch once", () => {
  const staged = stage({ dispatch: "fail-once" });
  try {
    const result = init(staged, answers());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(ghLines(staged.parent).filter((line) => line.startsWith("workflow run")).length, 2);
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs rejects a project name whose key is invalid", () => {
  const staged = stage();
  const again = stage();
  try {
    const result = init(staged, ["accept", "no", "", "", "", "", "", "", "", "", "", "database none", "", "auth none", "", "email none", "", "", "", "X", "Demo Shop", "A small shop.", "Customers", "", "", "", "", "approve", ""].join("\n") + "\n");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    assert.equal(project.project, "DEMO-SHOP");
    const rejected = init(again, "accept\nno\n\n\n\n\n\n\n\n\n\ndatabase none\n\nauth none\n\nemail none\n\n\n\nX\nX\nX\n");
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.equal(rejected.stdout.includes("no valid answer for Project name"), true, rejected.stdout);
  } finally {
    cleanup(staged.parent);
    cleanup(again.parent);
  }
});

test("setup.test.mjs lists applicable items and a secret command block", () => {
  assert.deepEqual(setupItems(setupJson, { deploy: "vercel" }).map((item) => item.id), ["cursor", "claude", "codex", "gemini", ...SIX.slice(2)]);
  assert.deepEqual(setupItems(setupJson, { deploy: "none" }).map((item) => item.id), ["cursor", "claude", "codex", "gemini"]);
  const cursor = setupJson.items.find((item) => item.id === "cursor");
  const markdown = setupMarkdown([cursor], { name: "Demo Shop", slug: "devtest/demo-shop" });
  assert.equal(markdown.includes("```\ngh secret set CURSOR_API_KEY --repo devtest/demo-shop\ngh secret set CURSOR_API_KEY_2 --repo devtest/demo-shop\n```\n"), true, markdown);
});

function treeHas(dir, value) {
  if (!existsSync(dir)) return false;
  const needle = Buffer.from(value);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (treeHas(full, value)) return true;
    } else if (readFileSync(full).includes(needle)) return true;
  }
  return false;
}

test("setup.test.mjs (s) a typed key reaches gh on stdin only", async () => {
  const staged = stage();
  const saved = {
    PATH: process.env.PATH,
    DEVOS_HOME: process.env.DEVOS_HOME,
    DEVOS_GH_LOG: process.env.DEVOS_GH_LOG,
    DEVOS_RETRY_MS: process.env.DEVOS_RETRY_MS,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  const value = `k${process.hrtime.bigint().toString(16)}aa`;
  const other = `m${process.hrtime.bigint().toString(16)}`;
  const hide = (text) => text.split(value).join("[redacted]").split(other).join("[redacted]");
  try {
    process.env.PATH = staged.env.PATH;
    process.env.DEVOS_HOME = staged.env.DEVOS_HOME;
    process.env.DEVOS_GH_LOG = staged.env.DEVOS_GH_LOG;
    process.env.DEVOS_RETRY_MS = "0";
    process.env.GIT_AUTHOR_NAME = "Devos Test";
    process.env.GIT_AUTHOR_EMAIL = "devos@example.com";
    process.env.GIT_COMMITTER_NAME = "Devos Test";
    process.env.GIT_COMMITTER_EMAIL = "devos@example.com";
    const installed = installInto(staged.project, "DEMO-SHOP");
    assert.equal(installed.code, 0, "install");
    const docs = path.join(staged.project, "docs");
    mkdirSync(path.join(docs, "fences"), { recursive: true });
    writeFileSync(path.join(docs, "PHASES.md"), readFileSync(path.join(fixtures, "PHASES.md")));
    writeFileSync(path.join(docs, "GLOSSARY.md"), readFileSync(path.join(fixtures, "GLOSSARY.md")));
    writeFileSync(path.join(docs, "fences", "T01.md"), "# T01\n");
    // E25a: each tool's optional second-account key comes right after its first; Enter skips it.
    const secrets = [`${value}\n`, "\n", `${other}\n`, "\n"];
    const stream = new EventEmitter();
    stream.setRawMode = () => {};
    stream.pause = () => {};
    stream.resume = () => {
      const next = secrets.shift();
      if (next !== undefined) process.nextTick(() => stream.emit("data", Buffer.from(next)));
    };
    const lines = [""];
    const read = async () => (lines.length > 0 ? lines.shift() : null);
    read.pause = () => {};
    read.resume = () => {};
    read.isTTY = true;
    read.stream = stream;
    const captured = [];
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    process.stdout.write = (chunk) => {
      captured.push(String(chunk));
      return true;
    };
    process.stderr.write = (chunk) => {
      captured.push(String(chunk));
      return true;
    };
    let status = 1;
    try {
      status = await finishSetup(staged.project, { name: "Demo Shop", deploy: "none", visibility: "private" }, read);
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    }
    const text = captured.join("");
    const devosLines = hide(text).split(/\r?\n/).filter((line) => line.startsWith("devos"));
    assert.equal(status, 0, devosLines.join("\n"));
    assert.equal(text.includes(value), false);
    assert.equal(text.includes(other), false);
    const log = readFileSync(staged.env.DEVOS_GH_LOG, "utf8");
    assert.equal(log.includes(value), false);
    assert.equal(log.includes(other), false);
    assert.equal(log.includes(`secret-stdin ${Buffer.byteLength(value)}`), true, hide(log));
    assert.equal(log.includes(`secret-stdin ${Buffer.byteLength(other)}`), true, hide(log));
    for (const line of log.split("\n")) {
      if (!line.startsWith("secret set") && !line.startsWith("secret-stdin")) continue;
      assert.equal(line.includes(value), false);
      assert.equal(line.includes(other), false);
    }
    assert.equal(treeHas(staged.parent, value), false);
    assert.equal(treeHas(staged.parent, other), false);
    assert.equal(treeHas(path.join(staged.env.DEVOS_HOME, ".devos"), value), false);
    assert.equal(treeHas(path.join(staged.env.DEVOS_HOME, ".devos"), other), false);
  } finally {
    for (const [key, previous] of Object.entries(saved)) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    cleanup(staged.parent);
  }
});

test("setup.test.mjs (t) no at create stops before GitHub", () => {
  const staged = stage();
  try {
    const result = init(staged, answers().replace(/approve\n\n$/, "approve\nno\n"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("stopped before GitHub"), true, result.stdout);
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("repo create")), false, ghLines(staged.parent).join("\n"));
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("secret set")), false);
  } finally {
    cleanup(staged.parent);
  }
});

test("setup.test.mjs (u) a skipped key is printed and not uploaded", () => {
  const staged = stage();
  try {
    const result = init(staged, answers());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("gh secret set CURSOR_API_KEY --repo devtest/demo-shop"), true, result.stdout);
    assert.equal(result.stdout.includes("to set later: CURSOR_API_KEY, CURSOR_API_KEY_2, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN_2"), true, result.stdout);
    assert.equal(ghLines(staged.parent).some((line) => line.startsWith("secret set")), false);
  } finally {
    cleanup(staged.parent);
  }
});
