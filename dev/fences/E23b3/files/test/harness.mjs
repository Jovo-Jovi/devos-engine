import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const fixtures = path.join(root, "test", "fixtures", "docs");

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export async function processGone(pid, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (process.platform === "linux") {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const at = stat.lastIndexOf(") ");
        if (at !== -1 && stat.charAt(at + 2) === "Z") return true;
      } catch {
        /* kill saw the pid; a missing stat line is not a zombie */
      }
    }
    if (Date.now() >= deadline) return false;
    const wait = Math.min(50, deadline - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

const claudeStub = `import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const early = process.argv.slice(2);
if (early.includes("--version") || (early[0] === "auth" && early[1] === "status")) process.exit(0);
const mode = process.env.STUB_MODE || "good";
if (mode === "hang") {
  writeFileSync(path.join(process.cwd(), "..", "model.pid"), String(process.pid));
  setInterval(() => {}, 1000000);
} else {
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
  writeFileSync(path.join(docs, "fences", "T01.md"), readFileSync(path.join(fixtureDir, "..", "fences", "T01.md")));
  mkdirSync(path.join(docs, "design"), { recursive: true });
  writeFileSync(path.join(docs, "DESIGN_SYSTEM.md"), "# Design system\\n");
  writeFileSync(path.join(docs, "design", "UI_ACCEPTANCE.md"), "| Id | Criterion | Checked by |\\n|---|---|---|\\n| UA-01 | Text contrast meets WCAG 2.2 AA | automated |\\n");
  // PR-59: every screenshot the developer gave is a row of REFERENCES.md.
  const refsDir = path.join(docs, "design", "references");
  const refNames = existsSync(refsDir) ? readdirSync(refsDir).sort() : [];
  const firstRound = mode === "refs-unnamed-then-good" && !args.includes("--continue");
  writeFileSync(path.join(docs, "design", "REFERENCES.md"), ["| Ref | Source | What we take | What we leave |", "|---|---|---|---|", ...(firstRound ? [] : refNames).map((name, i) => "| R" + (i + 1) + " | " + name + " | the spacing | the colours |")].join("\\n") + "\\n");
  if (mode === "bad-fence-then-good" && !args.includes("--continue")) writeFileSync(path.join(docs, "fences", "T01.md"), "# T01\\n");
  if (mode === "omit-questions" && args.includes("--continue")) {
    writeFileSync(path.join(docs, "OPEN_QUESTIONS.md"), "# Open questions\\n");
  }
  const finishDocs = () => {
    if (args.includes("stream-json")) {
      // Claude Code's stream-json (--verbose): one event per line, ending with the result.
      const say = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
      say({ type: "system", subtype: "init", session_id: "claude-session-1", model: "stub" });
      say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: path.join(docs, "PHASES.md") } }] }, session_id: "claude-session-1" });
      say({ type: "result", subtype: "success", is_error: false, result: "stub summary", session_id: "claude-session-1", duration_ms: 42000, total_cost_usd: 0.0425,
        usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 } });
    } else {
      process.stdout.write('{"result":"stub summary"}');
    }
    if (mode === "slow") process.exit(0);
  };
  if (mode === "slow") {
    setTimeout(finishDocs, 300);
    return;
  }
  finishDocs();
});
}
`;

const toolStub = `import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const prompt = args.includes("-p") || args[0] === "exec";
if (!prompt) process.exit(0);
if (process.env.STUB_TOOL_MODE === "silent") process.exit(1);
const base = path.basename(process.argv[1] || "");
if (base.startsWith("agent")) {
  const last = args.length > 0 ? args[args.length - 1] : "";
  const before = args.length > 1 ? args[args.length - 2] : "";
  if (last.startsWith("-") || before === "--model" || before === "--output-format") {
    process.stderr.write("Error: No prompt provided for print mode\\nError: command failed unexpectedly.\\n");
    process.exit(1);
  }
}
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const log = process.env.DEVOS_TOOL_LOG;
  const cliPath = path.join(process.cwd(), ".cursor", "cli.json");
  const cli = existsSync(cliPath) ? readFileSync(cliPath, "utf8") : "";
  let input = "";
  const inputPath = path.join(process.cwd(), ".devos", "blueprint-input.md");
  if (existsSync(inputPath)) input = readFileSync(inputPath, "utf8");
  if (log) appendFileSync(log, JSON.stringify({ args, stdin, cli, input }) + "\\n");
  if (process.env.STUB_TOOL_MODE === "no-model") {
    const at = args.indexOf("--model");
    process.stderr.write("Cannot use this model: " + (at >= 0 ? args[at + 1] : "auto") + " - Stub Model\\n");
    process.exit(1);
  }
  const docs = path.join(process.cwd(), "docs");
  mkdirSync(path.join(docs, "fences"), { recursive: true });
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
  if (!(process.env.STUB_TOOL_MODE === "refs-unnamed-then-good" && !args.includes("--resume"))) writeFileSync(path.join(docs, "design", "REFERENCES.md"), ["| Ref | Source | What we take | What we leave |", "|---|---|---|---|", ...refNames.map((name, i) => "| R" + (i + 1) + " | " + name + " | the spacing | the colours |")].join("\\n") + "\\n");
  if (process.env.STUB_TOOL_MODE === "bad-then-good" && !args.includes("--resume")) {
    writeFileSync(path.join(docs, "PHASES.md"), "No header here\\n");
  }
  if (!args.includes("stream-json")) {
    process.stdout.write('{"result":"stub summary"}');
    return;
  }
  // Cursor's stream-json: one event per line, ending with the agent's result.
  const say = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  say({ type: "system", subtype: "init", session_id: "cursor-session-1", model: "stub" });
  say({ type: "tool_call", subtype: "started", call_id: "c1", tool_call: { writeToolCall: { args: { path: path.join(docs, "PHASES.md") } } } });
  for (let i = 2; i <= Number(process.env.STUB_TOOL_STEPS || 1); i += 1) {
    say({ type: "tool_call", subtype: "started", call_id: "c" + i, tool_call: { readToolCall: { args: { path: path.join(docs, "step-" + i + ".md") } } } });
  }
  // quiet: the agent starts a helper and is never heard from again (no result, no output, no file written).
  if (process.env.STUB_TOOL_MODE === "quiet") {
    say({ type: "tool_call", subtype: "started", call_id: "h1", tool_call: { taskToolCall: { args: { description: "Audit fence T01" } } } });
    if (process.env.DEVOS_TOOL_PID) writeFileSync(process.env.DEVOS_TOOL_PID, String(process.pid));
    setInterval(() => {}, 1000000);
    return;
  }
  say({ type: "result", subtype: "success", is_error: false, result: "stub summary", session_id: "cursor-session-1", duration_ms: 61000,
    usage: { inputTokens: 4000, outputTokens: 900, cacheReadTokens: 120000, cacheWriteTokens: 0 } });
  // linger: the process does not exit after its result, as a CLI that restarts itself would not.
  if (process.env.STUB_TOOL_MODE === "linger") {
    if (process.env.DEVOS_TOOL_PID) writeFileSync(process.env.DEVOS_TOOL_PID, String(process.pid));
    setInterval(() => {}, 1000000);
  }
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
  const mode = process.env.STUB_REPO || "missing";
  const remote = path.join(path.resolve(process.cwd(), ".."), "remote.git");
  if (mode === "empty" || mode === "full") {
    if (mode === "empty") {
      const init = spawnSync("git", ["init", "--bare", remote], { windowsHide: true });
      if (init.status !== 0) process.exit(init.status ?? 1);
    }
    process.stderr.write("GraphQL: Name already exists on this account\\n");
    process.exit(1);
  }
  const init = spawnSync("git", ["init", "--bare", remote], { windowsHide: true });
  if (init.status !== 0) process.exit(init.status ?? 1);
  const added = spawnSync("git", ["remote", "add", "origin", remote], { cwd: process.cwd(), windowsHide: true });
  process.exit(added.status ?? 1);
}
if (args[0] === "repo" && args[1] === "view") {
  const mode = process.env.STUB_REPO || "missing";
  if (mode === "missing") process.exit(1);
  const remote = path.resolve(process.cwd(), "..", "remote");
  process.stdout.write(JSON.stringify({ name: "demo-shop", isEmpty: mode === "empty", url: remote }) + "\\n");
  process.exit(0);
}
if (args[0] === "run" && args[1] === "list") {
  const seen = log ? readFileSync(log, "utf8").split("\\n").some((line) => line.startsWith("workflow run")) : false;
  process.stdout.write(seen ? '[{"databaseId":1}]\\n' : '[]\\n');
  process.exit(0);
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

export function stage(options = {}) {
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
    DEVOS_REAL_PATH: process.env.PATH ?? "",
    DEVOS_GIT_LOG: path.join(parent, "git.log"),
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
  return { parent, project, env, stubs };
}

export function init(staged, input, extraEnv = {}) {
  return spawnSync(process.execPath, [bin, "init", staged.project], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    input,
    env: { ...staged.env, ...extraEnv },
  });
}

export function runs(parent) {
  const log = path.join(parent, "claude.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function toolRuns(parent) {
  const log = path.join(parent, "tool.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function flow({ pool = "", blueprint = "", attachment = "", tail = "approve", confirmAnswer = "", type = "", stack = "", modules, scope = "" } = {}) {
  const agent = ["", "", "", "", "", "", ""];
  agent[2] = pool;
  agent[5] = blueprint;
  const moduleLines = modules ?? ["database none", "", "auth none", "", "email none", "", ""];
  return [
    "accept",
    ...agent,
    type,
    stack,
    ...moduleLines,
    scope,
    "Demo Shop",
    "A small shop.",
    "Customers",
    "",
    "",
    attachment,
    "",
    tail,
    confirmAnswer,
  ].join("\n") + "\n";
}
