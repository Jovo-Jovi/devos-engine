import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compareVersions, isCandidate, isRelease, parseVersion } from "../lib/version.mjs";

// E85d (D-E19): one order for the engine's versions: a release candidate comes before its release.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// [left, right, expected]: every pair is checked both ways.
const ORDER = [
  ["1.13.18", "1.13.18", 0],
  ["1.13.18", "1.13.19", -1],
  ["1.10.0", "1.9.9", 1],
  ["1.14.0-rc.1", "1.14.0-rc.1", 0],
  ["1.14.0-rc.1", "1.14.0-rc.2", -1],
  ["1.14.0-rc.9", "1.14.0-rc.10", -1],
  ["1.14.0-rc.10", "1.14.0", -1],
  ["1.13.18", "1.14.0-rc.1", -1],
  ["1.14.0", "1.14.1-rc.1", -1],
  ["2.0.0-rc.1", "1.99.99", 1],
];
const NEITHER = ["", "1.14", "1.14.0-beta.1", "1.14.0-rc.0", "1.14.0-rc.01", "1.14.0-rc", "v1.14.0", "1.14.0-RC.1", "1.14.0+build"];

function pageFunction(js, name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const end = js.indexOf("\n}\n", start);
  return new Function(`${js.slice(start, end + 2)}\nreturn ${name};`)();
}

test("versions.test.mjs (a) a release and a release candidate are told apart, and anything else is neither", () => {
  assert.deepEqual(parseVersion("1.14.0-rc.12"), { major: 1, minor: 14, patch: 0, rc: 12 });
  assert.deepEqual(parseVersion("1.13.18"), { major: 1, minor: 13, patch: 18, rc: null });
  assert.deepEqual([isRelease("1.13.18"), isCandidate("1.13.18"), isRelease("1.14.0-rc.1"), isCandidate("1.14.0-rc.1")], [true, false, false, true]);
  for (const value of [...NEITHER, null, undefined]) {
    assert.deepEqual([parseVersion(value), isRelease(value), isCandidate(value), compareVersions(value, "1.0.0"), compareVersions("1.0.0", value)], [null, false, false, null, null], String(value));
  }
});

test("versions.test.mjs (b) the order: rc.1 < rc.2 < rc.10 < the release < the next candidate", () => {
  for (const [left, right, expected] of ORDER) {
    assert.equal(compareVersions(left, right), expected, `${left} vs ${right}`);
    assert.equal(compareVersions(right, left), expected === 0 ? 0 : -expected, `${right} vs ${left}`);
  }
});

test("versions.test.mjs (c) the project page's copy keeps the same order and names a candidate", () => {
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  const pageCompare = pageFunction(js, "compareVersions");
  const candidate = pageFunction(js, "candidate");
  for (const [left, right, expected] of ORDER) {
    assert.equal(pageCompare(left, right), compareVersions(left, right), `${left} vs ${right}`);
    assert.equal(pageCompare(right, left), compareVersions(right, left), `${right} vs ${left}`);
  }
  for (const value of NEITHER) assert.equal(pageCompare(value, "1.0.0"), null, value);
  for (const value of ["1.14.0-rc.1", "1.13.18", ...NEITHER]) assert.equal(candidate(value), isCandidate(value), value);
  // The version row says how a test project takes a candidate, never "upgrade it below".
  assert.equal(js.includes("if (project < 0 && candidate(v.engine)) return checkRow(\"warn\", \"Version\", `${detail} The page upgrades a project only to a release; a test project takes this one with devos upgrade --pre in its folder.`, \"Candidate\");"), true);
});

test("versions.test.mjs (d) the engine's own version is a release or a release candidate", () => {
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  assert.notEqual(parseVersion(version), null, version);
});
