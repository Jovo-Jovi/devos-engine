import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// PR-58: a fence's machine-read parts are checked the same way whatever agent wrote it (fence-check.mjs),
// and the fence of the task being built must pass (guard:fences).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-fence-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  return dir;
}

const HEAD = {
  title: "## T07 — Invoices list",
  phase: "- Phase: P2 · Station: S1 · Risk: 2 · Gate: —",
  builder: "- Builder: grok-4.7 · Effort: high · Fast: no",
  layers: "- Layers: backend · api",
  paths: "- Paths: `src/modules/billing/**` · `tests/billing/**` · `package.json`",
};

function fence({ head = {}, extra = [], done = ["- D1. `pnpm test` passes."], doNot = ["- Run git."], stages = [] } = {}) {
  const parts = { ...HEAD, ...head };
  const lines = [parts.title, "", ...[parts.phase, parts.builder, parts.layers, parts.paths, ...extra].filter((line) => line !== null), "- Fence version: v1", "", "### Prompt (canonical)", "", "1. Build the list.", ""];
  for (const stage of stages) lines.push(`### Stage ${stage} — part ${stage}`, "", `${stage}. Step.`, "");
  if (done !== null) lines.push("### Done when", "", ...done, "");
  if (doNot !== null) lines.push("### Do NOT", "", ...doNot, "");
  return lines.join("\n");
}

function check(dir, text, name = "T07", env = {}) {
  writeFileSync(path.join(dir, "docs", "fences", `${name}.md`), text);
  const run = spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", `docs/fences/${name}.md`], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } });
  return { status: run.status, lines: run.stdout.trim().split("\n").map((line) => line.replace(`docs/fences/${name}.md: `, "")) };
}

function guard(dir, env) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "fences", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, TASK: "", ...env } });
  return { status: run.status, result: JSON.parse(run.stdout).fences };
}

test("fence-check.test.mjs (a) a complete fence and the fixture T01 pass", () => {
  const dir = project();
  try {
    assert.deepEqual(check(dir, fence()), { status: 0, lines: ["fence-check: docs/fences/T07.md OK"] });
    const t01 = readFileSync(path.join(root, "test", "fixtures", "fences", "T01.md"), "utf8");
    assert.deepEqual(check(dir, t01, "T01"), { status: 0, lines: ["fence-check: docs/fences/T01.md OK"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (b) every missing part is named", () => {
  const dir = project();
  try {
    const text = fence({ head: { title: "## Invoices list", builder: null, layers: null, paths: null }, done: null, doNot: null });
    assert.deepEqual(check(dir, text), {
      status: 1,
      lines: [
        "the first heading does not name T07 (`## T07 — <name>`)",
        "no builder line `- Builder: <pool id> · Effort: <low|medium|high|xhigh> · Fast: <yes|no>`",
        "no `- Layers:` line (the layers of devos/skills/INDEX.md the task touches, PR-55)",
        "no `- Paths:` line: every file or folder the task may change, each in backticks (guard:scope, PR-58)",
        "no Done when section",
        "no Do NOT section",
        "fence-check: docs/fences/T07.md 6 finding(s)",
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (c) wrong values are refused: effort, fast, layers and paths", () => {
  const dir = project();
  try {
    const text = fence({
      head: {
        builder: "- Builder: grok-4.7 · Effort: huge · Fast: maybe",
        layers: "- Layers: backend · wizardry",
        paths: "- Paths: `/etc/x` · `src\\a.ts` · `../up` · `**` · `docs/fences/T08.md` · `.github/workflows/devos-cycle.yml` · `src/ok.ts`",
      },
    });
    assert.deepEqual(check(dir, text).lines, [
      "Effort `huge` is not one of low, medium, high, xhigh",
      "Fast `maybe` is not yes or no",
      "layer `wizardry` is not in devos/skills/INDEX.md (design, motion, frontend, accessibility, architecture, backend, api, database, security, reliability, testing, ops)",
      "path `/etc/x` must be relative to the repository root, with / and no ..",
      "path `src\\a.ts` must be relative to the repository root, with / and no ..",
      "path `../up` must be relative to the repository root, with / and no ..",
      "path `**` allows every file",
      "path `docs/fences/T08.md` is one the builder may never change (devos.config.json surfaces)",
      "path `.github/workflows/devos-cycle.yml` is one the builder may never change (devos.config.json surfaces)",
      "fence-check: docs/fences/T07.md 9 finding(s)",
    ]);
    assert.deepEqual(check(dir, fence({ head: { paths: "- Paths:" } })).lines, ["the `- Paths:` line names no path", "fence-check: docs/fences/T07.md 1 finding(s)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (d) a method fix needs no layers and may name method files, never product paths", () => {
  const dir = project();
  try {
    const method = { layers: "- Surface: method — scripts/devos/verdict.mjs", paths: "- Paths: `scripts/devos/verdict.mjs` · `docs/method/AUTOMATION.md` · `docs/method/PRECEDENTS.md`" };
    assert.deepEqual(check(dir, fence({ head: method })), { status: 0, lines: ["fence-check: docs/fences/T07.md OK"] });
    const product = { ...method, paths: "- Paths: `scripts/devos/verdict.mjs` · `src/**`" };
    assert.deepEqual(check(dir, fence({ head: product })).lines, [
      "path `src/**` is one the builder may never change (devos.config.json surfaces)",
      "fence-check: docs/fences/T07.md 1 finding(s)",
    ]);
    assert.deepEqual(check(dir, fence({ head: { paths: "- Paths: `scripts/devos/verdict.mjs`" } })).lines, [
      "path `scripts/devos/verdict.mjs` is one the builder may never change (devos.config.json surfaces)",
      "fence-check: docs/fences/T07.md 1 finding(s)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (e) a fence bigger than one run must be staged, and its stages must match", () => {
  const dir = project();
  try {
    const thirteen = Array.from({ length: 13 }, (_, i) => `- D${i + 1}. Check ${i + 1}.`);
    assert.deepEqual(check(dir, fence({ done: thirteen })).lines, [
      "13 Done-when items: more than 12 is more than one builder run; split it with `- Stages: N` (PR-38)",
      "fence-check: docs/fences/T07.md 1 finding(s)",
    ]);
    assert.equal(check(dir, fence({ done: thirteen, extra: ["- Stages: 2"], stages: [1, 2] })).status, 0);
    assert.deepEqual(check(dir, fence({ extra: ["- Stages: 5"], stages: [1, 2, 3, 4, 5] })).lines, ["`- Stages: 5` must be 2, 3 or 4 (PR-38)", "fence-check: docs/fences/T07.md 1 finding(s)"]);
    assert.deepEqual(check(dir, fence({ extra: ["- Stages: 3"], stages: [1, 3] })).lines, ["`- Stages: 3` needs the blocks `### Stage 1` to `### Stage 3` in order; found 1, 3", "fence-check: docs/fences/T07.md 1 finding(s)"]);
    assert.deepEqual(check(dir, fence({ stages: [1, 2] })).lines, ["`### Stage` blocks without a `- Stages: N` line", "fence-check: docs/fences/T07.md 1 finding(s)"]);
    const many = Array.from({ length: 13 }, (_, i) => `\`src/file-${i + 1}.ts\``).join(" · ");
    assert.deepEqual(check(dir, fence({ head: { paths: `- Paths: ${many}` } })).lines, [
      "13 Paths entries: more than 12 is more than one builder run; split it with `- Stages: N` (PR-38)",
      "fence-check: docs/fences/T07.md 1 finding(s)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (f) guard:fences checks the fence of the task being built, and nothing outside a task run", () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, "docs", "fences", "T07.md"), fence());
    assert.deepEqual(guard(dir, {}), { status: 0, result: { status: "N/A", findings: [], note: "no task in this run" } });
    assert.deepEqual(guard(dir, { TASK: "T09" }), { status: 0, result: { status: "N/A", findings: [], note: "no docs/fences/T09.md" } });
    assert.deepEqual(guard(dir, { TASK: "T07" }), { status: 0, result: { status: "PASS", findings: [], note: "docs/fences/T07.md checked" } });
    writeFileSync(path.join(dir, "docs", "fences", "T07.md"), fence({ head: { paths: null } }));
    assert.deepEqual(guard(dir, { TASK: "T07" }), {
      status: 1,
      result: { status: "FAIL", findings: ["docs/fences/T07.md: no `- Paths:` line: every file or folder the task may change, each in backticks (guard:scope, PR-58)"], note: "docs/fences/T07.md checked" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fence-check.test.mjs (g) several fences at once, as JSON, and a fence that does not exist", () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, "docs", "fences", "T07.md"), fence());
    const run = spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", "docs/fences/T07.md", "docs/fences/T08.md", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(run.status, 1);
    assert.deepEqual(JSON.parse(run.stdout), [
      { file: "docs/fences/T07.md", findings: [] },
      { file: "docs/fences/T08.md", findings: ["docs/fences/T08.md does not exist"] },
    ]);
    const usage = spawnSync(process.execPath, ["scripts/devos/fence-check.mjs"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(usage.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
