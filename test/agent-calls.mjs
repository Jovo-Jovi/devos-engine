// E86 (PR-106): how the cycle calls each tool, recorded by running its own scripts and steps with stand-in CLIs. For
// each of Claude Code, Cursor, Codex and Gemini, as builder (the work job's builder step), reviewer and planner
// (plan-agent.sh), and its install (install-agent.sh): the command it runs, its arguments, the first line it reads on
// standard input, the credential it is given, and the role files beside it. test/fixtures/agent-calls.json holds what
// `next` @ 3ecf68a did before E86; registry.test.mjs checks that the registry does exactly the same.
//   node test/agent-calls.mjs [<repository root>] [--generic]   prints the record of that checkout as JSON (--generic:
//   the jobs' keys as DEVOS_KEY_N and DEVOS_ALT_N, as the workflows pass them since E86b)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOOLS = ["claude", "cursor", "codex", "gemini"];
const MODELS = { claude: "claude-opus-5-5", cursor: "grok-4.7-high", codex: "gpt-5.5-codex", gemini: "gemini-3.1-pro" };
const EFFORT = { claude: "high", cursor: "", codex: "high", gemini: "" };
// The credentials the jobs map for each tool (devos-work.yml's builder step, the review and planner jobs).
// Short stand-in values, as two-jobs.test.mjs uses: never the shape of a real key.
const KEYS = {
  claude: { CLAUDE_OAUTH_1: "o1", CLAUDE_APIKEY_1: "a1", CLAUDE_OAUTH_2: "o2", CLAUDE_APIKEY_2: "a2" },
  cursor: { CURSOR_KEY_1: "c1", CURSOR_KEY_2: "c2" },
  codex: { CODEX_KEY_1: "x1", CODEX_KEY_2: "x2" },
  gemini: { GEMINI_KEY_1: "g1", GEMINI_KEY_2: "g2" },
};
// E86b (PR-107): the same keys as the jobs pass them now, generic, chosen by the caller by the secrets' names.
const GENERIC = {
  claude: { DEVOS_KEY_1: "o1", DEVOS_ALT_1: "a1", DEVOS_KEY_2: "o2", DEVOS_ALT_2: "a2" },
  cursor: { DEVOS_KEY_1: "c1", DEVOS_KEY_2: "c2" },
  codex: { DEVOS_KEY_1: "x1", DEVOS_KEY_2: "x2" },
  gemini: { DEVOS_KEY_1: "g1", DEVOS_KEY_2: "g2" },
};
// The credentials a CLI may see. The generic names never reach one, so a record that shows one is not the base's.
const SEEN_ENV = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CURSOR_API_KEY", "CODEX_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GEMINI_CLI_TRUST_WORKSPACE", "DEVOS_KEY_1", "DEVOS_KEY_2", "DEVOS_ALT_1", "DEVOS_ALT_2"];
const KIT_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".claude/settings.json", ".cursor/cli.json", ".cursor/mcp.json", ".cursor/rules", "<home>/.gemini/settings.json", "<home>/.gemini/policies/devos.toml"];
const FAST = { DEVOS_PROGRESS_EVERY: "60", DEVOS_WATCHDOG_TICK: "1", DEVOS_WATCHDOG_UNIT: "1", DEVOS_REPORT_EVERY: "60" };
// What each stand-in prints: one successful run in its CLI's own format.
const OUTPUT = {
  claude: '{"type":"result","subtype":"success","is_error":false,"result":"done","structured_output":{},"usage":{"input_tokens":1,"output_tokens":1}}\n',
  agent: '{"type":"result","subtype":"success","is_error":false,"result":"done","usage":{"inputTokens":1,"outputTokens":1}}\n',
  codex: '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n',
  gemini: '{"response":"done","stats":{"models":{}}}\n',
};

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function stepRun(workflow, name) {
  const lines = readFileSync(workflow, "utf8").split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (at < 0) throw new Error(`${workflow}: no step ${name}`);
  const n = lines.findIndex((line, i) => i > at && /^\s+run: \|$/.test(line));
  const indent = lines[n].indexOf("run:") + 2;
  const body = [];
  for (let i = n + 1; i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) >= indent); i += 1) body.push(lines[i].slice(indent));
  return body.join("\n");
}

/** A stand-in CLI: it writes one record of how it was called, then prints a successful run. */
function stand(fakes, name, calls) {
  const file = path.join(fakes, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs"), path = require("path"), crypto = require("crypto");
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
const env = {};
for (const k of ${JSON.stringify(SEEN_ENV)}) if (process.env[k] !== undefined) env[k] = process.env[k];
const kit = {};
for (const rel of ${JSON.stringify(KIT_FILES)}) {
  const p = rel.startsWith("<home>/") ? path.join(process.env.HOME, rel.slice(7)) : rel;
  if (!fs.existsSync(p)) continue;
  const st = fs.statSync(p);
  kit[rel] = st.isDirectory() ? fs.readdirSync(p).sort().map((f) => f + ":" + crypto.createHash("sha256").update(fs.readFileSync(path.join(p, f))).digest("hex").slice(0, 16)).join(",") : crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cmd: ${JSON.stringify(name)}, argv: process.argv.slice(2), stdin: stdin.split("\\n")[0], env, kit }) + "\\n");
const o = process.argv.indexOf("-o");
if (o > 0) fs.writeFileSync(process.argv[o + 1], "done");
for (const a of process.argv) { const m = /write your answer to \`([^\`]+)\`/.exec(stdin) || null; if (m) { fs.writeFileSync(m[1], "{}"); break; } }
process.stdout.write(${JSON.stringify(OUTPUT[name] ?? "")});
`);
  chmodSync(file, 0o755);
}

/** A stand-in for a command the install runs (npm, curl, sha256sum, tar): it records its arguments and stdin. */
function standTool(fakes, name, calls) {
  const file = path.join(fakes, name);
  writeFileSync(file, `#!/usr/bin/env node
const fs = require("fs");
let stdin = "";
if (${JSON.stringify(name)} === "sha256sum") { try { stdin = fs.readFileSync(0, "utf8"); } catch {} }
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cmd: ${JSON.stringify(name)}, argv, stdin: stdin.trim() }) + "\\n");
if (${JSON.stringify(name)} === "curl") { const o = argv.indexOf("-o"); if (o >= 0) fs.writeFileSync(argv[o + 1], "package"); }
if (${JSON.stringify(name)} === "tar") { const c = argv.indexOf("-C"); if (c >= 0) fs.writeFileSync(require("path").join(argv[c + 1], "cursor-agent"), "#!/bin/sh\\n"); }
`);
  chmodSync(file, 0o755);
}

function project(root, tool) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-calls-"));
  const bin = path.join(root, "bin", "devos.mjs");
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  if (installed.status !== 0) throw new Error(installed.stdout + installed.stderr);
  const configPath = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const effort = EFFORT[tool] ? { effort: EFFORT[tool], gate_effort: EFFORT[tool], light_effort: EFFORT[tool] } : {};
  cfg.agents = { reviewer: { id: "rev", tool, model: MODELS[tool], ...effort }, pool: [{ id: "b", tool, model: MODELS[tool], default: true, note: "builder", ...(EFFORT[tool] ? { effort: "fence" } : {}) }], policy: "always-default", raise_on_retry: false };
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "## T01 — First task\n\n- Fence version: 1\n- Builder: b · Effort: high · Fast: no\n\n### Prompt\n\nBuild it.\n");
  if (!existsSync(path.join(dir, "CLAUDE.md"))) writeFileSync(path.join(dir, "CLAUDE.md"), "# The project\n");
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  const home = path.join(dir, "home");
  mkdirSync(home, { recursive: true });
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  writeFileSync(path.join(dir, ".gitignore"), "home/\nfakes/\ncalls.jsonl\n.devos/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const fakes = path.join(dir, "fakes");
  mkdirSync(fakes, { recursive: true });
  return { dir, home, fakes, calls: path.join(dir, "calls.jsonl") };
}

function readCalls(p, dir, home) {
  if (!existsSync(p.calls)) return [];
  const norm = (s) => String(s).split(dir).join("<project>").split(home).join("<home>").split(tmpdir()).join("<tmp>");
  return readFileSync(p.calls, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(norm(line)));
}

function run(p, script, env) {
  return spawnSync("bash", ["-c", script], {
    cwd: p.dir, encoding: "utf8", windowsHide: true,
    env: { PATH: `${p.fakes}${path.delimiter}${process.env.PATH ?? ""}`, HOME: p.home, ...FAST, ...env },
  });
}

/**
 * The record of one checkout: { builder, reviewer, planner, install } by tool. `generic`: the jobs' keys come as
 * DEVOS_KEY_N and DEVOS_ALT_N (E86b), not as the tool's account slots.
 */
export function agentCalls(root, { generic = false } = {}) {
  const out = { builder: {}, reviewer: {}, planner: {}, install: {} };
  for (const tool of TOOLS) {
    const keys = generic ? GENERIC[tool] : KEYS[tool];
    // The work job's builder step, run as written.
    let p = project(root, tool);
    try {
      for (const name of ["claude", "agent", "codex", "gemini"]) stand(p.fakes, name, p.calls);
      const step = stepRun(path.join(p.dir, ".github", "workflows", "devos-work.yml"), "Builder (the project's builder agent)");
      const r = run(p, step, {
        ...keys, TASK: "T01", ATTEMPT: "1", DEVOS_BUILDER_TOOL: tool, MODEL: MODELS[tool], FALLBACKS: "",
        DEVOS_BUILDER_MODEL: MODELS[tool], DEVOS_BUILDER_EFFORT: "high", DEVOS_BUILDER_FAST: "no", MODEL_SOURCE: "pool", MODEL_NOTE: "",
        DEVOS_USAGE_STAGE: "builder", GITHUB_OUTPUT: path.join(p.dir, ".devos", "gh-output"),
      });
      out.builder[tool] = { exit: r.status, calls: readCalls(p, p.dir, p.home) };
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
    // The reviewer and the planner: plan-agent.sh, as the review and planner jobs call it.
    for (const [role, stage, schema, turns] of [["reviewer", "reviewer", "verdict", "80"], ["planner", "intake", "intake", "120"]]) {
      p = project(root, tool);
      try {
        for (const name of ["claude", "agent", "codex", "gemini"]) stand(p.fakes, name, p.calls);
        writeFileSync(path.join(p.dir, ".devos", `${stage}-prompt.md`), `# The ${stage} prompt\n\nDo it.\n`);
        const r = run(p, `bash scripts/devos/plan-agent.sh ${stage} .devos/${stage}-prompt.md devos/schemas/${schema}.schema.json .devos/${stage}.json "${EFFORT[tool]}" ${turns}`, {
          ...keys, DEVOS_AGENT_MODE: "deep", TASK: "T01",
        });
        out[role][tool] = { exit: r.status, calls: readCalls(p, p.dir, p.home) };
      } finally {
        rmSync(p.dir, { recursive: true, force: true });
      }
    }
    // The install, at main's pins.
    p = project(root, tool);
    try {
      for (const name of ["npm", "curl", "sha256sum", "tar"]) standTool(p.fakes, name, p.calls);
      const gh = path.join(p.dir, ".devos", "gh-path");
      const r = run(p, `bash scripts/devos/install-agent.sh ${tool}`, { RUNNER_TEMP: path.join(p.dir, ".devos"), GITHUB_PATH: gh });
      const links = [];
      const bin = path.join(p.home, ".local", "bin");
      if (existsSync(bin)) for (const f of readdirSync(bin).sort()) links.push(f);
      out.install[tool] = { exit: r.status, calls: readCalls(p, p.dir, p.home), links, github_path: existsSync(gh) ? readFileSync(gh, "utf8").split(p.home).join("<home>") : "" };
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(HERE, ".."));
  process.stdout.write(`${JSON.stringify(agentCalls(root, { generic: args.includes("--generic") }), null, 2)}\n`);
}
