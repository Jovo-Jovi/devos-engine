import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, flow, init, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const acceptance = [
  "| Id | Criterion | Checked by |",
  "|---|---|---|",
  "| UA-01 | Text contrast meets WCAG 2.2 AA | automated |",
  "",
].join("\n");

function stageProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-design-spec-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  return dir;
}

function writeFence(dir, body) {
  const file = path.join(dir, "docs", "fences", "T01.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`);
}

function writeAcceptance(dir) {
  const file = path.join(dir, "docs", "design", "UI_ACCEPTANCE.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, acceptance);
}

function runGuard(dir) {
  return spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "design-spec", "--json"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
}

function guardResult(dir) {
  const run = runGuard(dir);
  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  assert.ok(parsed, run.stdout + run.stderr);
  return { run, spec: parsed["design-spec"] };
}

function baseFence({ states = "`home` · `home-empty`", criteria = "`UA-01`", spec = true } = {}) {
  const lines = ["# T01", "- Screens: `home /` · `home-empty /?empty=1`"];
  if (spec) {
    lines.push("### Design specification", `- States: ${states}`, `- Criteria: ${criteria}`);
  }
  return `${lines.join("\n")}\n`;
}

test("design-spec.test.mjs (a) a fence with no Screens line and no UI yes is N/A", () => {
  const dir = stageProject();
  try {
    writeFence(dir, "# T01\n");
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 0, run.stdout);
    assert.equal(spec.status, "N/A");
    assert.equal(spec.note, "no open UI fence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (b) the base case passes", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence());
    writeAcceptance(dir);
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 0, run.stdout);
    assert.equal(spec.status, "PASS");
    assert.equal(spec.note, "1 UI fences checked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (c) a missing acceptance file fails", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence());
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 1);
    assert.equal(spec.status, "FAIL");
    assert.deepEqual(spec.findings, ["docs/design/UI_ACCEPTANCE.md does not exist"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (d) a criterion that is not a row fails", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence({ criteria: "`UA-09`" }));
    writeAcceptance(dir);
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 1);
    assert.equal(spec.status, "FAIL");
    assert.deepEqual(spec.findings, ["docs/fences/T01.md: criterion UA-09 is not a row of docs/design/UI_ACCEPTANCE.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (e) a Screens name missing from States fails", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence({ states: "`home`" }));
    writeAcceptance(dir);
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 1);
    assert.equal(spec.status, "FAIL");
    assert.deepEqual(spec.findings, ["docs/fences/T01.md: home-empty is on the Screens line but not in States"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (f) a UI fence without a design specification fails", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence({ spec: false }));
    writeAcceptance(dir);
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 1);
    assert.equal(spec.status, "FAIL");
    assert.deepEqual(spec.findings, ["docs/fences/T01.md: UI fence without a ### Design specification"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (g) UI yes without a Screens line fails", () => {
  const dir = stageProject();
  try {
    writeFence(dir, "# T01\n- UI: yes\n");
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 1);
    assert.equal(spec.status, "FAIL");
    assert.equal(spec.findings.includes("docs/fences/T01.md: - UI: yes without a - Screens: line"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (h) a closed fence is not checked", () => {
  const dir = stageProject();
  try {
    writeFence(dir, baseFence({ spec: false }));
    const phases = path.join(dir, "docs", "PHASES.md");
    const lines = readFileSync(phases, "utf8").split("\n");
    const next = lines.map((line) => {
      if (!line.includes("| T01 |")) return line;
      const cells = line.split("|");
      cells[7] = " [x] ";
      cells[8] = " PASS a1 ";
      return cells.join("|");
    });
    writeFileSync(phases, next.join("\n"));
    const { run, spec } = guardResult(dir);
    assert.equal(run.status, 0, run.stdout);
    assert.equal(spec.status, "N/A");
    assert.equal(spec.note, "no open UI fence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design-spec.test.mjs (i) init records whether the type has a web interface", () => {
  const saas = stage();
  try {
    const result = init(saas, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const project = JSON.parse(readFileSync(path.join(saas.project, "devos", "project.json"), "utf8"));
    const answers = JSON.parse(readFileSync(path.join(saas.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.type, "saas");
    assert.equal(project.ui, true);
  } finally {
    cleanup(saas.parent);
  }
  const cli = stage();
  try {
    const result = init(cli, flow({ type: "cli", modules: [] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const project = JSON.parse(readFileSync(path.join(cli.project, "devos", "project.json"), "utf8"));
    const answers = JSON.parse(readFileSync(path.join(cli.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.type, "cli");
    assert.equal(project.ui, false);
  } finally {
    cleanup(cli.parent);
  }
});
