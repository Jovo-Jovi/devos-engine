import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { normalizeLf } from "../tools/sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("engine-ci.test.mjs workflow shape", () => {
  const file = path.join(root, ".github", "workflows", "engine-ci.yml");
  assert.equal(existsSync(file), true);
  const text = normalizeLf(readFileSync(file)).toString("utf8");
  const needles = [
    'branches: [main, "task/**"]',
    "workflow_dispatch:",
    // Every push and pull request runs the Linux tests only; a manual run adds Windows (E21: Windows minutes count double).
    `os: \${{ fromJSON(github.event_name == 'workflow_dispatch' && '["ubuntu-latest", "windows-latest"]' || '["ubuntu-latest"]') }}`,
    "timeout-minutes: 25",
    'node --test --test-concurrency=4 "test/*.test.mjs"',
    "node tools/build-manifest.mjs --check",
    "node tools/find-specifics.mjs --check",
    "ACTIONLINT_VERSION: 1.7.7",
    "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
    "sha256sum -c -",
    "-shellcheck= -pyflakes=",
    "contents: read",
  ];
  for (const needle of needles) assert.equal(text.includes(needle), true, needle);
  // Commits that change only dev/ (fences, reviews, the ledger) start no run, on a push or a pull request.
  assert.equal(text.split('paths-ignore: ["dev/**"]').length - 1, 2);
  for (const banned of ["secrets.", "write", "schedule"]) {
    assert.equal(text.includes(banned), false, banned);
  }
  for (const line of text.split("\n")) {
    if (line === "" || line[0] === " " || line[0] === "#") continue;
    assert.match(line, /^(name|on|permissions|concurrency|jobs):/);
  }
  assert.equal(text.includes("\t"), false);
  const manifest = JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    assert.equal(String(entry.path).startsWith(".github/workflows/engine-ci"), false, entry.path);
  }
});
