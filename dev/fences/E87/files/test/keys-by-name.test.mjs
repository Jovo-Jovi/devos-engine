// E86b (PR-107): each AI job's keys are chosen by name, in its caller, and the planners run in their own workflow.
//   (a) every caller names the registry's secrets literally, by the names main's registry gave the role's tool;
//   (b) inside, the AI jobs hold them only generic (DEVOS_KEY_N, DEVOS_ALT_N), and name no tool;
//   (c) with the keys generic, every tool's builder, reviewer and planner calls exactly what the base called;
//   (d) accounts.sh makes the generic keys the tool's account slots and clears them; the watchdog strips them;
//   (e) the planner's tool and its secrets' names are main's, from the resolve steps as written;
//   (f) intake and revise call devos-intake-planner.yml with what it declares, and their publish jobs still tell the request.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { agentCalls, TOOLS } from "./agent-calls.mjs";
import { configWithAgents } from "./chosen-agents.mjs";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(root, "payload", "files");
const SCRIPTS = path.join(PAYLOAD, "scripts", "devos");
const WORKFLOWS = path.join(PAYLOAD, "dot-github", "workflows");
const windows = process.platform === "win32";
const read = (name) => readFileSync(path.join(WORKFLOWS, name), "utf8").replaceAll("\r\n", "\n");
const { secretNames, secretLines } = await import(pathToFileURL(path.join(SCRIPTS, "tools.mjs")).href);

function job(text, name) {
  const at = text.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  assert.notEqual(at, -1, `job ${name}`);
  const rest = text.slice(at + 1);
  const end = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  return end === -1 ? text.slice(at) : text.slice(at, at + 1 + end);
}
function stepRun(text, name) {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(at, -1, `no step named ${name}`);
  const n = lines.findIndex((line, i) => i > at && /^\s+run: \|$/.test(line));
  const indent = lines[n].indexOf("run:") + 2;
  const body = [];
  for (let i = n + 1; i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) >= indent); i += 1) body.push(lines[i].slice(indent));
  return body.join("\n");
}
/** A caller's `secrets:` lines, by name. */
function passed(jobText) {
  const block = jobText.slice(jobText.indexOf("\n    secrets:\n"));
  return Object.fromEntries([...block.matchAll(/^ {6}([A-Z0-9_]+): (\$\{\{.*\}\})$/gm)].map((m) => [m[1], m[2]]));
}
// Each call, and per set of keys it passes: the slot names' prefix and the resolve outputs that name the secrets.
const CALLS = [
  ["devos-cycle.yml", "work", [["", "needs.resolve.outputs.builder_key", "needs.resolve.outputs.builder_alt"]]],
  ["devos-cycle.yml", "review", [["", "needs.resolve.outputs.review_key", "needs.resolve.outputs.review_alt"], ["L", "needs.resolve.outputs.light_key", "needs.resolve.outputs.light_alt"]]],
  ["devos-intake.yml", "intake", [["", "needs.intake-resolve.outputs.key", "needs.intake-resolve.outputs.alt"]]],
  ["devos-intake.yml", "revise", [["", "needs.revise-resolve.outputs.key", "needs.revise-resolve.outputs.alt"]]],
];

test("keys-by-name.test.mjs (a) every AI job's caller names the registry's secrets literally, by the names resolve gave its tool", () => {
  const names = secretNames();
  // E87 (PR-109): and DEVOS_AGENT_KEY, a project's own tool's.
  assert.deepEqual(names, { keys: ["CLAUDE_CODE_OAUTH_TOKEN", "CURSOR_API_KEY", "DEVOS_AGENT_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"], alts: ["ANTHROPIC_API_KEY"] });
  for (const [file, name, sets] of CALLS) {
    const lines = passed(job(read(file), name));
    for (const [pre, keyVar, altVar] of sets) {
      for (const [slot, variable, list, suffix] of [["KEY_1", keyVar, names.keys, ""], ["KEY_2", keyVar, names.keys, "_2"], ["ALT_1", altVar, names.alts, ""], ["ALT_2", altVar, names.alts, "_2"]]) {
        const where = `${file} ${name} ${pre}${slot}`;
        const line = lines[`${pre}${slot}`];
        assert.ok(line, where);
        const pairs = [...line.matchAll(/\((\S+) == '([A-Z0-9_]+)' && secrets\.([A-Z0-9_]+)\)/g)].map((m) => m.slice(1));
        assert.deepEqual(pairs.map(([v]) => v), list.map(() => variable), `${where}: the role's names`);
        assert.deepEqual(pairs.map(([, n]) => n), list, `${where}: every name, once`);
        for (const [, n, secret] of pairs) assert.equal(secret, `${n}${suffix}`, `${where}: ${n}`);
        assert.match(line, /\|\| '' \}\}$/, `${where}: nothing when no name matches`);
      }
    }
  }
  for (const file of ["devos-cycle.yml", "devos-intake.yml", "devos-intake-planner.yml", "devos-work.yml", "devos-review.yml"]) {
    const code = read(file).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.equal(/secrets\[|toJSON\(secrets\)|secrets: inherit/.test(code), false, file);
  }
});

test("keys-by-name.test.mjs (b) inside, the AI jobs hold the keys only generic and name no tool", () => {
  const SLOT = /^\s+(CLAUDE_OAUTH|CLAUDE_APIKEY|CURSOR_KEY|CODEX_KEY|GEMINI_KEY)_\d:/m;
  for (const [file, steps] of [
    ["devos-work.yml", ["Resolve the builder model (fence effort/fast, checked against `agent models`)", "Builder (the project's builder agent)"]],
    ["devos-review.yml", ["Reviewer (the project's reviewer agent, its own job, no write token)"]],
    ["devos-intake-planner.yml", ["Reviewer — plan the request", "Reviewer — reissue the fence with the revision"]],
  ]) {
    const text = read(file);
    assert.equal(SLOT.test(text), false, `${file}: no tool's account slot`);
    assert.equal(/(inputs\.builder_tool|steps\.prep\.outputs\.tool|steps\.pt\.outputs\.tool) == '/.test(text), false, `${file}: no key chosen by a tool's name`);
    for (const name of steps) {
      const lines = text.split("\n");
      const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
      assert.notEqual(at, -1, `${file}: ${name}`);
      const end = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
      const env = lines.slice(at, end).filter((l) => /DEVOS_(KEY|ALT)_\d:/.test(l)).map((l) => l.trim().split(":")[0]);
      assert.deepEqual(env, ["DEVOS_KEY_1", "DEVOS_KEY_2", "DEVOS_ALT_1", "DEVOS_ALT_2"], `${file}: ${name}`);
    }
  }
  // The reviewer's keys are the light reviewer's when it reviews, and never the other reviewer's in their place.
  assert.match(read("devos-review.yml"), /DEVOS_KEY_1: \$\{\{ \(steps\.prep\.outputs\.light == 'true' && secrets\.LKEY_1\) \|\| \(steps\.prep\.outputs\.light != 'true' && secrets\.KEY_1\) \|\| '' \}\}/);
  // The planners' workflow takes four keys and names no other secret.
  const plan = read("devos-intake-planner.yml");
  assert.deepEqual([...new Set(plan.match(/secrets\.[A-Z0-9_]+/g))].sort(), ["secrets.ALT_1", "secrets.ALT_2", "secrets.KEY_1", "secrets.KEY_2"]);
  assert.match(plan, /^ {4}secrets:\n {6}KEY_1:\n {8}required: false\n {6}KEY_2:\n {8}required: false\n {6}ALT_1:\n {8}required: false\n {6}ALT_2:\n {8}required: false\n/m);
});

test("keys-by-name.test.mjs (c) with the keys generic, every tool's builder, reviewer and planner calls exactly what the base called", { timeout: 600_000, skip: windows && "the stand-in CLIs and the work job's step are bash" }, () => {
  const now = agentCalls(root, { generic: true });
  const base = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "agent-calls.json"), "utf8"));
  for (const role of ["builder", "reviewer", "planner"]) for (const id of TOOLS) assert.deepEqual(now[role][id], base[role][id], `${role} ${id}`);
});

test("keys-by-name.test.mjs (d) accounts.sh makes the generic keys the tool's account slots and clears them; the watchdog strips them", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-generic-keys-"));
  try {
    const sh = (script, env) => spawnSync("bash", ["-c", `. "${SCRIPTS}/accounts.sh"; ${script}`], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, DEVOS_SCRIPTS: SCRIPTS, DEVOS_WATCHDOG_TICK: "1", DEVOS_WATCHDOG_UNIT: "1", ...env } });
    const claude = sh('devos_tool claude; echo "${CLAUDE_OAUTH_1:-}|${CLAUDE_APIKEY_2:-}|${DEVOS_KEY_1-gone}|${DEVOS_ALT_2-gone}"; devos_accounts claude', { DEVOS_KEY_1: "k1", DEVOS_ALT_2: "a2" });
    assert.equal(claude.stdout, "k1|a2|gone|gone\n1 2\n", claude.stderr);
    // A tool with no alternative takes the key alone; another tool's slots stay empty.
    const cursor = sh('devos_tool cursor; echo "${CURSOR_KEY_2:-}|${CLAUDE_APIKEY_1:-}|${DEVOS_ALT_1-gone}"; devos_use cursor 2; echo "$CURSOR_API_KEY"', { DEVOS_KEY_2: "c2", DEVOS_ALT_1: "stray" });
    assert.equal(cursor.stdout, "c2||gone\nc2\n", cursor.stderr);
    // Asked in a subshell, as the jobs ask it, the answer is the same; the agent's process never sees a generic name.
    const run = sh(`a=$(devos_accounts codex); devos_use codex "$a"; DEVOS_KEY_2=again bash "${SCRIPTS}/agent-watchdog.sh" 5 5 out.txt err.txt -- env`, { DEVOS_KEY_1: "x1" });
    assert.equal(run.status, 0, run.stderr);
    const seen = readFileSync(path.join(dir, "out.txt"), "utf8").split("\n").filter((l) => /(KEY(_\d)?|TOKEN|ALT_\d)$/.test(l.split("=")[0]));
    assert.deepEqual(seen, ["CODEX_API_KEY=x1"]);
  } finally {
    cleanup(dir);
  }
});

test("keys-by-name.test.mjs (e) the planner's tool and its secrets' names are main's, from the resolve steps as written", { skip: windows && "bash" }, () => {
  assert.deepEqual(secretLines("claude", "builder"), ["builder_key=CLAUDE_CODE_OAUTH_TOKEN", "builder_alt=ANTHROPIC_API_KEY"]);
  assert.deepEqual(secretLines("cursor", "review"), ["review_key=CURSOR_API_KEY", "review_alt="]);
  assert.deepEqual(secretLines("", "light"), ["light_key=", "light_alt="]);
  assert.throws(() => secretLines("muse", "planner"), /no tool "muse"; one of claude, codex, cursor, gemini/);
  const intake = read("devos-intake.yml");
  const step = stepRun(job(intake, "intake-resolve"), "The planner's tool, and the names of its secrets");
  assert.equal(stepRun(job(intake, "revise-resolve"), "The planner's tool, and the names of its secrets"), step);
  // The cycle's resolve names the builder's, the deep reviewer's and the light reviewer's.
  assert.match(read("devos-cycle.yml"), /\{ node scripts\/devos\/tools\.mjs secrets --tool "\$builder" --as builder\n\s+node scripts\/devos\/tools\.mjs secrets --tool "\$deep" --as review\n\s+node scripts\/devos\/tools\.mjs secrets --tool "\$light" --as light; \} \| tee -a "\$GITHUB_OUTPUT"/);
  for (const [tool, key, alt] of [["codex", "OPENAI_API_KEY", ""], ["claude", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]]) {
    const dir = mkdtempSync(path.join(tmpdir(), "devos-planner-resolve-"));
    try {
      const installed = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
      assert.equal(installed.status, 0, installed.stdout + installed.stderr);
      const cfg = path.join(dir, "devos.config.json");
      writeFileSync(cfg, configWithAgents(readFileSync(cfg, "utf8"), { reviewer: { id: "rev", tool, model: "m" }, reviewer_light: null }));
      const out = path.join(dir, "gh-output");
      const r = spawnSync("bash", ["-e", "-c", step], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(out, "utf8"), `tool=${tool}\nplanner_key=${key}\nplanner_alt=${alt}\n`, tool);
    } finally {
      cleanup(dir);
    }
  }
});

test("keys-by-name.test.mjs (f) intake and revise call devos-intake-planner.yml with what it declares, and their publish jobs still tell the request", () => {
  const intake = read("devos-intake.yml");
  const plan = read("devos-intake-planner.yml");
  const inputs = [...plan.slice(plan.indexOf("    inputs:\n"), plan.indexOf("    secrets:\n")).matchAll(/^ {6}([a-z_]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(inputs, ["stage", "tool", "issue", "resume", "task", "branch", "unit"]);
  for (const [name, stage, needs, given] of [
    ["intake", "intake", "intake-resolve", ["stage", "tool", "issue", "resume"]],
    ["revise", "revise", "[revise-prep, revise-resolve]", ["stage", "tool", "task", "branch", "unit"]],
  ]) {
    const j = job(intake, name);
    assert.match(j, new RegExp(`^ {4}needs: ${needs.replace(/[[\]]/g, "\\$&")}\n`, "m"), name);
    assert.match(j, /^ {4}uses: \.\/\.github\/workflows\/devos-intake-planner\.yml$/m, name);
    const w = j.slice(j.indexOf("\n    with:\n"), j.indexOf("\n    secrets:\n"));
    assert.deepEqual([...w.matchAll(/^ {6}([a-z_]+): /gm)].map((m) => m[1]), given, name);
    assert.match(w, new RegExp(`^ {6}stage: ${stage}$`, "m"));
    assert.deepEqual(Object.keys(passed(j)), ["KEY_1", "KEY_2", "ALT_1", "ALT_2"], name);
    // The planner's job runs only its stage, and checks that main's config still names the tool whose keys it holds.
    const planned = job(plan, name);
    assert.match(planned, new RegExp(`^ {4}if: inputs\\.stage == '${stage}'$`, "m"));
    assert.ok(planned.includes('[ "$tool" = "$TOOL" ] || { echo "::error title=Dev OS::the planner is $tool now, but this job holds the keys of $TOOL; run it again"; exit 1; }'), name);
  }
  // What intake-publish reads of the planner is what devos-intake-planner.yml hands back.
  const read_ = [...new Set([...job(intake, "intake-publish").matchAll(/needs\.intake\.outputs\.([a-z_]+)/g)].map((m) => m[1]))].sort();
  const outputs = [...plan.slice(plan.indexOf("    outputs:\n"), plan.indexOf("\npermissions:")).matchAll(/^ {6}([a-z_]+):$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(read_, outputs);
  // A planner that could not be named still gets its publish job, which says so on the request or the PR.
  assert.match(job(intake, "intake-publish"), /^ {4}needs: \[intake-resolve, intake\]\n(?: {4}#[^\n]*\n)? {4}if: always\(\) && needs\.intake-resolve\.result != 'skipped' && needs\.intake-resolve\.result != 'cancelled' && needs\.intake\.result != 'cancelled'$/m);
  assert.match(job(intake, "revise-publish"), /^ {4}if: always\(\) && needs\.revise-prep\.result == 'success' && needs\.revise\.result != 'cancelled'$/m);
});
