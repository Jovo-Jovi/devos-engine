import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup } from "./harness.mjs";
import { applyBaseline, BASELINE_GUARDS, baselineFrom, fingerprint, shrinkBaseline } from "../payload/files/scripts/guards/lib.mjs";

// E35 (PR-68, D-E13): the code a project already had gets a baseline; new or changed code must pass the guards.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const MAIL = "src/lib/contact.ts:1 — email literal: export const mail = \"team@example.com\";";

test("baseline.test.mjs (a) a finding is matched without its line number, up to its count, and secrets are never baselined", () => {
  assert.equal(fingerprint(MAIL), "src/lib/contact.ts — email literal: export const mail = \"team@example.com\";");
  assert.equal(fingerprint("src/i18n/messages/en.json — missing catalogue"), "src/i18n/messages/en.json — missing catalogue");
  assert.deepEqual(BASELINE_GUARDS, ["naming", "design", "i18n", "literals", "imports"]);
  const results = {
    literals: { status: "FAIL", findings: [MAIL, MAIL.replace(":1 —", ":7 —")], note: "1 files scanned" },
    secrets: { status: "FAIL", findings: ["a.txt:3 — a token"], note: "" },
    naming: { status: "FAIL", findings: ["guard crashed: docs/GLOSSARY.md §3 has no fenced list"], note: "" },
    design: { status: "PASS", findings: [], note: "" },
  };
  const baseline = baselineFrom(results, "2026-10-31");
  assert.deepEqual(baseline.guards, { literals: { [fingerprint(MAIL)]: 2 } });
  assert.equal(baseline.schema, "devos-baseline/1");
  const moved = applyBaseline({ literals: { status: "FAIL", findings: [MAIL.replace(":1 —", ":40 —"), MAIL], note: "1 files scanned" } }, baseline);
  assert.deepEqual(moved.literals, { status: "PASS", findings: [], note: "2 known (baseline); 1 files scanned" });
  const more = applyBaseline({ literals: { status: "FAIL", findings: [MAIL, MAIL, MAIL.replace(":1 —", ":9 —")], note: "" } }, baseline);
  assert.deepEqual(more.literals, { status: "FAIL", findings: [MAIL.replace(":1 —", ":9 —")], note: "2 known (baseline)" });
  const changed = MAIL.replace("team@", "sales@");
  const edited = applyBaseline({ literals: { status: "FAIL", findings: [changed], note: "" }, secrets: results.secrets }, baseline);
  assert.deepEqual(edited.literals.findings, [changed]);
  assert.equal(edited.secrets, results.secrets);
  const { baseline: smaller, removed } = shrinkBaseline(baseline, { literals: { status: "FAIL", findings: [MAIL], note: "" } });
  assert.equal(removed, 1);
  assert.deepEqual(smaller.guards, { literals: { [fingerprint(MAIL)]: 1 } });
  const grown = shrinkBaseline(smaller, { literals: { status: "FAIL", findings: [MAIL, MAIL, changed], note: "" } });
  assert.equal(grown.removed, 0);
  assert.deepEqual(grown.baseline.guards, smaller.guards);
  assert.deepEqual(shrinkBaseline(smaller, { literals: { status: "PASS", findings: [], note: "" } }).baseline.guards, {});
});

function installed() {
  const folder = mkdtempSync(path.join(tmpdir(), "devos-baseline-"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: folder, windowsHide: true }).status, 0);
  const done = spawnSync(process.execPath, [bin, "install", folder, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  mkdirSync(path.join(folder, "docs"), { recursive: true });
  for (const name of ["PHASES.md", "GLOSSARY.md"]) {
    writeFileSync(path.join(folder, "docs", name), readFileSync(path.join(root, "test", "fixtures", "docs", name)));
  }
  mkdirSync(path.join(folder, "src", "lib"), { recursive: true });
  writeFileSync(path.join(folder, "src", "lib", "contact.ts"), "export const mail = \"team@example.com\";\n");
  return folder;
}

function guards(folder, ...args) {
  return spawnSync(process.execPath, ["scripts/guards/run-all.mjs", ...args], { cwd: folder, encoding: "utf8", windowsHide: true });
}

const line = (stdout, name) => stdout.split(/\r?\n/).find((entry) => entry.startsWith(`guard:${name}`)) ?? "";

test("baseline.test.mjs (b) in an installed project, the baseline is written once, passes what it holds and fails what is new", () => {
  const folder = installed();
  try {
    const before = guards(folder);
    assert.equal(before.status, 1);
    assert.equal(line(before.stdout, "literals"), "guard:literals  FAIL  (1 files scanned)");
    const written = guards(folder, "--write-baseline");
    assert.equal(written.status, 0, written.stdout);
    assert.equal(written.stdout.split(/\r?\n/)[0], "devos/baseline.json written: 2 known findings of i18n, literals");
    const baseline = JSON.parse(readFileSync(path.join(folder, "devos", "baseline.json"), "utf8"));
    assert.deepEqual(Object.keys(baseline.guards), ["i18n", "literals"]);
    const known = guards(folder);
    assert.equal(known.status, 0, known.stdout);
    assert.equal(line(known.stdout, "literals"), "guard:literals  PASS  (1 known (baseline); 1 files scanned)");
    const all = guards(folder, "--no-baseline");
    assert.equal(all.status, 1);
    assert.equal(line(all.stdout, "literals"), "guard:literals  FAIL  (1 files scanned)");
    writeFileSync(path.join(folder, "src", "lib", "contact.ts"), "// moved down\nexport const mail = \"team@example.com\";\nexport const sales = \"sales@example.com\";\n");
    const fresh = guards(folder);
    assert.equal(fresh.status, 1);
    assert.equal(line(fresh.stdout, "literals"), "guard:literals  FAIL  (1 known (baseline); 1 files scanned)");
    assert.equal(fresh.stdout.includes("    src/lib/contact.ts:3 — email literal: export const sales = \"sales@example.com\";\n"), true, fresh.stdout);
    assert.equal(fresh.stdout.includes("contact.ts:2 —"), false, fresh.stdout);
    const again = guards(folder, "--write-baseline");
    assert.equal(again.status, 2);
    assert.equal(again.stderr, "devos/baseline.json exists; it only shrinks (--shrink-baseline)\n");
  } finally {
    cleanup(folder);
  }
});

test("baseline.test.mjs (c) shrinking removes what is fixed and adds nothing, and a baseline that holds secrets fails", () => {
  const folder = installed();
  try {
    assert.equal(guards(folder, "--write-baseline").status, 0);
    writeFileSync(path.join(folder, "src", "lib", "contact.ts"), "export const sales = \"sales@example.com\";\n");
    const shrunk = guards(folder, "--shrink-baseline");
    assert.equal(shrunk.stdout.split(/\r?\n/)[0], "devos/baseline.json: 1 fixed finding removed, 1 left");
    assert.equal(shrunk.status, 1);
    assert.equal(line(shrunk.stdout, "literals"), "guard:literals  FAIL  (1 files scanned)");
    const kept = JSON.parse(readFileSync(path.join(folder, "devos", "baseline.json"), "utf8"));
    assert.deepEqual(Object.keys(kept.guards), ["i18n"]);
    assert.equal(guards(folder, "--shrink-baseline", "--only", "literals").status, 2);
    kept.guards.secrets = { "a.txt — a token": 1 };
    writeFileSync(path.join(folder, "devos", "baseline.json"), `${JSON.stringify(kept, null, 2)}\n`);
    const refused = guards(folder);
    assert.equal(refused.status, 1);
    assert.equal(line(refused.stdout, "baseline"), "guard:baseline  FAIL");
    assert.equal(refused.stdout.includes("    devos/baseline.json holds findings of secrets, which are never baselined\n"), true, refused.stdout);
    assert.equal(line(refused.stdout, "literals"), "guard:literals  FAIL  (1 files scanned)");
  } finally {
    cleanup(folder);
  }
});

test("baseline.test.mjs (d) the manual, PR-68 and the reviewer prompt describe the baseline", () => {
  const read = (file) => readFileSync(path.join(root, "payload", "files", ...file.split("/")), "utf8").replaceAll("\r\n", "\n");
  assert.equal(read("docs/method/AUTOMATION.md").includes("**The baseline (PR-68).** In a project DEV_OS was added to, `devos/baseline.json`"), true);
  const precedents = read("docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("| PR-68 | **The code a project already had gets a baseline.**"), true);
  assert.equal(precedents.includes("**Live maximum: PR-68.**"), true);
  assert.equal(read("devos/prompts/reviewer.md").includes("**Baseline (PR-68):** a guard line noting `N known (baseline)`"), true);
});
