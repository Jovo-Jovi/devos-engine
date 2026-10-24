import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const SCREENS = "- Screens: `home /` · `empty /list?empty=1`";
const CI = {
  generated: "2026-10-24T00:00:00.000Z",
  head: null,
  has_package_json: true,
  all_required_passed: true,
  modules: [],
  failed_required: [],
  checks_modified_tracked_files: [],
  results: [{ name: "build", required: true, status: "pass" }],
};

function project({ screens = SCREENS } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-ui-evidence-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "fences", "T02.md"), `## T02 — Lists\n\n- Phase: P1 · Risk: 2\n${screens}\n\n### Prompt\n`);
  mkdirSync(path.join(dir, ".devos", "screens"), { recursive: true });
  writeFileSync(path.join(dir, ".devos", "ci-results.json"), JSON.stringify(CI, null, 2));
  return dir;
}

function capture(state, width, extra = {}) {
  return {
    state,
    width,
    settled: `${state}-${width}.png`,
    reduced: `${state}-${width}-reduced.png`,
    layout_shift: 0,
    layout_shift_reduced: 0,
    console_errors: [],
    failed_requests: [],
    a11y: { ran: true, reason: "", violations: [] },
    error: null,
    ...extra,
  };
}

function writeCaptures(dir, captures, task = "T02") {
  const screens = path.join(dir, ".devos", "screens");
  writeFileSync(path.join(screens, "motion.json"), JSON.stringify({ task, captures }, null, 2));
  for (const c of captures) {
    for (const file of [c.settled, c.reduced]) if (file) writeFileSync(path.join(screens, file), "png");
  }
}

function good() {
  return [capture("home", 1280), capture("home", 390), capture("empty", 1280), capture("empty", 390)];
}

function run(dir, task = "T02") {
  return spawnSync(process.execPath, ["scripts/devos/ui-evidence.mjs", "--task", task], { cwd: dir, encoding: "utf8", windowsHide: true });
}

function results(dir) {
  return JSON.parse(readFileSync(path.join(dir, ".devos", "ci-results.json"), "utf8"));
}

function named(ci, name) {
  return ci.results.find((r) => r.name === name);
}

test("ui-evidence.test.mjs (a) a fence without a Screens line adds no check", () => {
  const dir = project({ screens: "- Surface: product" });
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "ui-evidence: N/A (T02 has no - Screens: line)");
    assert.deepEqual(results(dir), CI);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ui-evidence.test.mjs (b) complete evidence adds two passing required checks", () => {
  const dir = project();
  try {
    writeCaptures(dir, good());
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^ui-evidence: PASS — 4 captures$/m);
    assert.match(result.stdout, /^a11y: PASS — 4 captures$/m);
    const ci = results(dir);
    assert.equal(ci.all_required_passed, true);
    assert.deepEqual(ci.failed_required, []);
    for (const name of ["ui-evidence", "a11y"]) {
      assert.equal(named(ci, name).status, "pass");
      assert.equal(named(ci, name).required, true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ui-evidence.test.mjs (c) no captures fail both checks", () => {
  const dir = project();
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const ci = results(dir);
    assert.equal(ci.all_required_passed, false);
    assert.deepEqual(ci.failed_required, ["ui-evidence", "a11y"]);
    assert.match(named(ci, "ui-evidence").tail, /^no \.devos\/screens\/motion\.json: the runner took no captures/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ui-evidence.test.mjs (d) each kind of missing or broken evidence is a finding", () => {
  const dir = project();
  try {
    const captures = [
      capture("home", 1280, { layout_shift: 0.02, console_errors: ["boom"], failed_requests: ["404 GET http://127.0.0.1:3200/logo.svg"] }),
      capture("home", 390, { reduced: "home-390-reduced.png" }),
      capture("empty", 1280, { error: "timeout" }),
    ];
    writeCaptures(dir, captures);
    rmSync(path.join(dir, ".devos", "screens", "home-390-reduced.png"));
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const tail = named(results(dir), "ui-evidence").tail.split("\n");
    assert.deepEqual(tail, [
      "home at 1280: layout shift 0.02",
      "home at 1280: console error: boom",
      "home at 1280: failed request: 404 GET http://127.0.0.1:3200/logo.svg",
      "home at 390: no reduced-motion screenshot",
      "empty at 1280: the capture failed: timeout",
      "empty at 390: no capture",
    ]);
    assert.deepEqual(results(dir).failed_required, ["ui-evidence", "a11y"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ui-evidence.test.mjs (e) an axe violation or an axe that did not run fails a11y only", () => {
  const dir = project();
  try {
    const captures = good();
    captures[0].a11y = { ran: true, reason: "", violations: [{ id: "image-alt", impact: "critical", help: "Images must have alternative text", nodes: 2, targets: ["img"] }] };
    captures[3].a11y = { ran: false, reason: "@axe-core/playwright is not installed in this project", violations: [] };
    writeCaptures(dir, captures);
    run(dir);
    const ci = results(dir);
    assert.equal(named(ci, "ui-evidence").status, "pass");
    assert.deepEqual(named(ci, "a11y").tail.split("\n"), [
      "home at 1280: image-alt (critical) on 2 element(s): Images must have alternative text — img",
      "empty at 390: axe did not run: @axe-core/playwright is not installed in this project",
    ]);
    assert.deepEqual(ci.failed_required, ["a11y"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ui-evidence.test.mjs (f) a second run replaces its results and a stale manifest is a finding", () => {
  const dir = project();
  try {
    writeCaptures(dir, good(), "T01");
    run(dir);
    writeCaptures(dir, good());
    run(dir);
    const ci = results(dir);
    assert.equal(ci.results.filter((r) => r.name === "ui-evidence").length, 1);
    assert.equal(ci.results.filter((r) => r.name === "a11y").length, 1);
    assert.equal(ci.all_required_passed, true);
    writeCaptures(dir, good(), "T01");
    run(dir);
    assert.equal(named(results(dir), "ui-evidence").tail, "motion.json is for T01, not T02");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
