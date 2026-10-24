import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { reviewerFor, validate } from "../payload/files/scripts/devos/agents.mjs";

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
