import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { reviewerFor, validate } from "../payload/files/scripts/devos/agents.mjs";
import { projectReadme } from "../lib/setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const cursor = { id: "cursor-grok-4-7-xhigh-fast", tool: "cursor", model: "grok-4.7-xhigh-fast" };

// The project of the owner's first real run: a CLI with no module, and a fence that names Firebase only to forbid it.
function project(answers) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-chosen-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n\n- Do not add `supabase`, Firebase, R2 or Sentry.\n");
  writeFileSync(path.join(dir, "devos", "answers.json"), JSON.stringify(answers));
  return dir;
}

function node(dir, code) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8", windowsHide: true });
}

test("chosen.test.mjs (a) a config without a light reviewer is valid, and the reviewer reviews every task", () => {
  const agents = { reviewer: cursor, pool: [{ ...cursor, default: true, note: "default builder" }], policy: "always-default" };
  validate(agents);
  validate({ ...agents, reviewer_light: null });
  assert.deepEqual(reviewerFor("light", agents), cursor);
  assert.throws(() => validate({ ...agents, extra: true }), /must have reviewer, pool and policy, and may have reviewer_light/);
  assert.throws(() => validate({ reviewer: cursor, policy: "always-default" }), /must have reviewer, pool and policy/);
});

test("chosen.test.mjs (b) a module the project did not choose is never started, whatever a fence says", () => {
  const none = project({ type: "cli", stack: "node-cli", modules: {}, deploy: "none" });
  const firebase = project({ type: "saas", stack: "next", modules: { database: "firebase", hosting: "vercel" }, deploy: "vercel" });
  try {
    const code = 'const m = await import("./scripts/devos/modules.mjs"); console.log(JSON.stringify([m.neededModules("T01"), [...m.chosenModules()].sort()]));';
    assert.equal(node(none, code).stdout.trim(), JSON.stringify([[], []]));
    assert.equal(node(firebase, code).stdout.trim(), JSON.stringify([["firebase"], ["firebase", "vercel"]]));
  } finally {
    rmSync(none, { recursive: true, force: true });
    rmSync(firebase, { recursive: true, force: true });
  }
});

test("chosen.test.mjs (c) the setup check asks for Vercel and Firebase only when the project chose them", () => {
  const none = project({ type: "cli", stack: "node-cli", modules: {}, deploy: "none" });
  const firebase = project({ type: "saas", stack: "next", modules: { database: "firebase", hosting: "vercel" }, deploy: "vercel" });
  try {
    const ids = (dir) => {
      const run = spawnSync(process.execPath, ["scripts/devos/setup-check.mjs"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, SECRETS_JSON: "{}", VARS_JSON: "{}" } });
      assert.notEqual(run.status, null, run.stderr);
      return run.stdout.split("\n").map((line) => /^(?:OK|MISSING|CONFIRM|ADVISED)\s+([a-z0-9-]+)/.exec(line)?.[1]).filter(Boolean);
    };
    const plain = ids(none);
    for (const id of ["vercel-var", "firebase-secrets", "firebase-var"]) assert.equal(plain.includes(id), false, id);
    const chosen = ids(firebase);
    for (const id of ["vercel-var", "firebase-secrets", "firebase-var"]) assert.equal(chosen.includes(id), true, id);
  } finally {
    rmSync(none, { recursive: true, force: true });
    rmSync(firebase, { recursive: true, force: true });
  }
});

// PR-53: a planning run uses the reviewer agent the developer chose, here Cursor, and no other agent or model.
function cursorProject() {
  const dir = project({ type: "cli", stack: "node-cli", modules: {}, deploy: "none" });
  const configPath = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  cfg.agents = { reviewer: cursor, pool: [{ ...cursor, default: true, note: "default builder" }], policy: "always-default" };
  writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "agent"), [
    "#!/bin/sh",
    "for arg in \"$@\"; do last=$arg; done",
    "printf '%s' \"$last\" > \"$DEVOS_SEEN.$CURSOR_API_KEY\"",
    "cp .cursor/cli.json \"$DEVOS_SEEN.kit\"",
    "if [ \"$CURSOR_API_KEY\" = 'limit-key' ]; then echo \"You've hit your usage limit\" >&2; exit 1; fi",
    "printf '%s' '{\"decision\":\"accept\",\"summary\":\"planned\",\"tasks\":[\"T02\"]}' > .devos/intake-answer.json",
    "echo '{\"type\":\"result\",\"result\":\"done\"}'",
    "",
  ].join("\n"), { mode: 0o755 });
  writeFileSync(path.join(bin, "claude"), "#!/bin/sh\ntouch \"$DEVOS_SEEN.claude\"\nexit 1\n", { mode: 0o755 });
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  writeFileSync(path.join(dir, ".devos", "p.md"), "plan it\n");
  writeFileSync(path.join(dir, ".devos", "p2.md"), "continue the partial plan\n");
  return { dir, bin, seen: path.join(dir, "seen") };
}

function plan({ dir, bin, seen }, keys) {
  return spawnSync("bash", ["scripts/devos/plan-agent.sh", "intake", ".devos/p.md", "devos/schemas/intake.schema.json", ".devos/intake.json", "high", "10", ".devos/p2.md"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, DEVOS_SEEN: seen, CLAUDE_OAUTH_1: "unused", ...keys },
  });
}

test("chosen.test.mjs (d) a planning run uses the chosen reviewer agent, switching only to its other account", { skip: process.platform === "win32" }, () => {
  const run = cursorProject();
  try {
    const result = plan(run, { CURSOR_KEY_1: "limit-key", CURSOR_KEY_2: "ok-key" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const out = JSON.parse(readFileSync(path.join(run.dir, ".devos", "intake.json"), "utf8"));
    assert.deepEqual(out.structured_output, { decision: "accept", summary: "planned", tasks: ["T02"] });
    assert.equal(out.tool, "cursor");
    assert.equal(out.model, "grok-4.7-xhigh-fast");
    assert.equal(out.limited, false);
    assert.equal(existsSync(path.join(run.dir, ".devos", "limits", "cursor-1.txt")), true);
    assert.match(readFileSync(`${run.seen}.ok-key`, "utf8"), /^continue the partial plan\n[\s\S]*\.devos\/intake-answer\.json/);
    assert.deepEqual(readFileSync(`${run.seen}.kit`), readFileSync(path.join(run.dir, "devos", "roles", "cursor-planner", "cli.json")));
    assert.equal(existsSync(`${run.seen}.claude`), false);
    assert.match(readFileSync(path.join(run.dir, ".devos", "accounts.md"), "utf8"), /intake: cursor account 1 reached its usage limit/);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

test("chosen.test.mjs (e) with every account of the chosen tool at its limit, the run stops with no answer", { skip: process.platform === "win32" }, () => {
  const run = cursorProject();
  try {
    const result = plan(run, { CURSOR_KEY_1: "limit-key" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const out = JSON.parse(readFileSync(path.join(run.dir, ".devos", "intake.json"), "utf8"));
    assert.equal(out.structured_output, null);
    assert.equal(out.limited, true);
    assert.equal(existsSync(`${run.seen}.claude`), false);
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
});

test("chosen.test.mjs (f) a new project's README says what it is and how DEV_OS builds it", () => {
  const text = projectReadme({ name: "Hello CLI", brief: "Prints a greeting.", users: "Developers", type: "cli", stack: "node-cli", modules: {}, deploy: "none", languages: ["en"] }, "owner/hello-cli");
  assert.equal(text.startsWith("# Hello CLI\n\nPrints a greeting.\n\n- **For:** Developers\n- **Type:** CLI or developer tool\n"), true, text);
  assert.match(text, /^- \*\*Modules:\*\* none$/m);
  assert.match(text, /^## How this project is built$/m);
  const saas = projectReadme({ name: "Shop", type: "saas", stack: "next", modules: { database: "supabase", hosting: "vercel" }, deploy: "vercel" });
  assert.match(saas, /^- \*\*Modules:\*\* Database: Postgres on Supabase · Hosting: Vercel$/m);
  assert.match(saas, /^- \*\*Deploy:\*\* Vercel$/m);
});
