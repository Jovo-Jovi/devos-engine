import test from "node:test";
import assert from "node:assert/strict";
import { toInstalled, toStored } from "../lib/paths.mjs";

const trips = [
  [".github/workflows/ci.yml", "dot-github/workflows/ci.yml"],
  [".gitignore", "dot-gitignore"],
  ["scripts/devos/run.mjs", "scripts/devos/run.mjs"],
  [".claude/settings.json", "dot-claude/settings.json"],
  ["docs/method/AUTOMATION.md", "docs/method/AUTOMATION.md"],
];

for (const [installed, stored] of trips) {
  test(`round trip ${installed}`, () => {
    assert.equal(toStored(installed), stored);
    assert.equal(toInstalled(stored), installed);
    assert.equal(toInstalled(toStored(installed)), installed);
    assert.equal(toStored(toInstalled(stored)), stored);
  });
}

test("toStored throws when a segment starts with dot-", () => {
  assert.throws(() => toStored("dot-github/workflows/ci.yml"), /dot-/);
});
