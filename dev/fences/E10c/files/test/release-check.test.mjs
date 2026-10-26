import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../tools/release-check.mjs";

// E10c (D-E10): the owner's release check, on synthetic trees so that it never depends on today's changelog or D-E11.
const NOTICE = "Required Notice: Copyright 2026 Jovo-Jovi (https://github.com/Jovo-Jovi)";

function tree(overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-release-"));
  const files = {
    "package.json": JSON.stringify({ version: "1.0.0", license: "PolyForm-Shield-1.0.0", files: ["bin/", "lib/", "LICENSE", "CHANGELOG.md", "README.md"] }),
    "payload/manifest.json": JSON.stringify({ engine_version: "1.0.0" }),
    "CHANGELOG.md": "# Changelog\n\n## 1.0.0 — 2026-11-01\n\nThe first public release.\n",
    LICENSE: `The licence text.\n\n${NOTICE}\n`,
    "SECURITY.md": "# Security\n",
    "README.md": "# DEV_OS\n",
    "dev/DECISIONS.md": "| D-E11 | **Privacy facts:** the operator is published as Jovo-Jovi, confirmed by the owner. | 2026-10-27 |\n",
    "bin/devos.mjs": "export {};\n",
    "lib/engine.mjs": "export const engine = 1;\n",
    ...overrides,
  };
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function run(dir) {
  const lines = [];
  const code = main(["--root", dir], (line) => lines.push(line));
  return { code, lines };
}

test("release-check.test.mjs (a) a complete release tree passes and counts the shipped files", () => {
  const dir = tree();
  try {
    assert.deepEqual(run(dir), { code: 0, lines: ["release check: ok (6 files scanned)"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release-check.test.mjs (b) a version that disagrees and an undated or wrong changelog heading are reported", () => {
  const undated = tree({ "payload/manifest.json": JSON.stringify({ engine_version: "0.9.0" }), "CHANGELOG.md": "# Changelog\n\n## 1.0.0 — Unreleased\n" });
  const wrong = tree({ "CHANGELOG.md": "# Changelog\n\n## 0.9.0 — 2026-11-01\n" });
  try {
    assert.deepEqual(run(undated), {
      code: 1,
      lines: [
        "release check: 2 problems",
        "- payload/manifest.json: engine_version is not 1.0.0, the version in package.json",
        "- CHANGELOG.md: the 1.0.0 heading has no date; set it when you tag",
      ],
    });
    assert.deepEqual(run(wrong).lines, ["release check: 1 problem", "- CHANGELOG.md: its first heading is not version 1.0.0"]);
  } finally {
    rmSync(undated, { recursive: true, force: true });
    rmSync(wrong, { recursive: true, force: true });
  }
});

test("release-check.test.mjs (c) the licence notice, SECURITY.md, a private README and an unconfirmed D-E11 are reported", () => {
  const provisional = tree({
    LICENSE: "The licence text.\n",
    "SECURITY.md": null,
    "README.md": "The repository is private until the release.\n",
    "dev/DECISIONS.md": "| D-E11 | the operator is published as Jovo-Jovi, provisionally | 2026-10-26 |\n",
  });
  const missing = tree({ "dev/DECISIONS.md": "| D-E10 | release in place | 2026-10-26 |\n" });
  try {
    assert.deepEqual(run(provisional).lines, [
      "release check: 4 problems",
      "- LICENSE: it does not end with the required notice",
      "- SECURITY.md: missing",
      "- README.md: it still says the repository is private",
      "- dev/DECISIONS.md: D-E11 still names the operator provisionally; confirm the legal identity first",
    ]);
    assert.deepEqual(run(missing).lines, ["release check: 1 problem", "- dev/DECISIONS.md: no D-E11 row (the privacy facts)"]);
  } finally {
    rmSync(provisional, { recursive: true, force: true });
    rmSync(missing, { recursive: true, force: true });
  }
});

test("release-check.test.mjs (d) a secret in a shipped file is reported by file, line and kind, never by value", () => {
  const token = `ghp_${"a1".repeat(18)}`;
  const dir = tree({ "lib/engine.mjs": `export const engine = 1;\nconst key = "${token}";\n`, "notes/draft.md": `${token}\n` });
  try {
    const { code, lines } = run(dir);
    assert.equal(code, 1);
    assert.deepEqual(lines, ["release check: 1 problem", "- lib/engine.mjs:2: looks like a GitHub token"]);
    assert.equal(lines.some((line) => line.includes(token)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
