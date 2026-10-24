import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const skillsDir = path.join(root, "payload", "files", "devos", "skills");

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-skills-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  return dir;
}

function guard(dir) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "skills", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
  return JSON.parse(run.stdout).skills;
}

function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

function localEntry(extra = {}) {
  return {
    id: "studio-notes",
    kind: "reference",
    title: "Studio notes",
    source: { repo: "https://example.com/studio-notes", commit: "a".repeat(40), path: "", version: "" },
    licence: { spdx: "MIT", class: "free", file: "LICENSE", notices: [], copyright: "Copyright (c) 2026 Studio" },
    delivery: "vendored",
    obligations: ["The licence ships beside the file"],
    changes: "none",
    roles: ["builder"],
    use: "House rules for this project.",
    files: [
      { path: "NOTES.md", origin: "source", from: "NOTES.md", sha256: sha("# Notes\n") },
      { path: "LICENSE", origin: "source", from: "LICENSE", sha256: sha("MIT\n") },
    ],
    ...extra,
  };
}

function writeLocal(dir, entry) {
  const folder = path.join(dir, "devos", "skills", "studio-notes");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "NOTES.md"), "# Notes\n");
  writeFileSync(path.join(folder, "LICENSE"), "MIT\n");
  writeFileSync(path.join(dir, "devos", "skills", "local.json"), JSON.stringify({ version: 1, entries: [entry] }, null, 2));
}

test("skills.test.mjs (a) the shipped skills pass", () => {
  const dir = project();
  try {
    assert.deepEqual(guard(dir), { status: "PASS", findings: [], note: "12 skills checked, 7 vendored" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (b) a changed or unlisted file fails", () => {
  const dir = project();
  try {
    appendFileSync(path.join(dir, "devos", "skills", "frontend-design", "SKILL.md"), "\nAlways use purple.\n");
    writeFileSync(path.join(dir, "devos", "skills", "taste", "extra.md"), "# Extra\n");
    assert.deepEqual(guard(dir).findings, [
      "devos/skills/frontend-design/SKILL.md differs from its pinned copy (sha256)",
      "devos/skills/taste/extra.md is not listed in a skills manifest",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (c) a project's own skill in local.json passes", () => {
  const dir = project();
  try {
    writeLocal(dir, localEntry());
    assert.deepEqual(guard(dir), { status: "PASS", findings: [], note: "13 skills checked, 8 vendored" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (d) a licence that does not allow it is never vendored", () => {
  const dir = project();
  try {
    writeLocal(dir, localEntry({ licence: { spdx: "LicenseRef-all-rights-reserved", class: "unsuitable", file: "LICENSE", notices: [], copyright: "" } }));
    assert.deepEqual(guard(dir).findings, ["devos/skills/local.json studio-notes: an unsuitable licence is never vendored"]);
    writeLocal(dir, localEntry({ licence: { spdx: "LicenseRef-custom", class: "approval", file: "LICENSE", notices: [], copyright: "" } }));
    assert.deepEqual(guard(dir).findings, ["devos/skills/local.json studio-notes: vendored under an approval-only licence without approval.by, approval.date and approval.reference"]);
    writeLocal(dir, localEntry({ licence: { spdx: "LicenseRef-custom", class: "approval", file: "LICENSE", notices: [], copyright: "" }, approval: { by: "the author", date: "2026-10-24", reference: "email of 2026-10-24" } }));
    assert.equal(guard(dir).status, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (e) a vendored entry needs a full commit, its licence file and obligations", () => {
  const dir = project();
  try {
    writeLocal(dir, localEntry({ source: { repo: "https://example.com/studio-notes", commit: "abc1234" }, licence: { spdx: "MIT", class: "free", file: "COPYING", notices: [] }, obligations: [] }));
    assert.deepEqual(guard(dir).findings, [
      "devos/skills/local.json studio-notes: source.commit must be a full 40-character commit",
      "devos/skills/local.json studio-notes: obligations must list how each licence condition is met",
      "devos/skills/local.json studio-notes: licence.file must be one of its files",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (f) every vendored skill ships its licence and every evaluated one says why it is not shipped", () => {
  const manifest = JSON.parse(readFileSync(path.join(skillsDir, "manifest.json"), "utf8"));
  for (const entry of manifest.entries) {
    if (entry.delivery === "vendored") {
      assert.ok(["free", "conditions"].includes(entry.licence.class), entry.id);
      assert.ok(entry.files.some((file) => file.path === entry.licence.file), entry.id);
    } else {
      assert.ok(entry.reason.length > 40, entry.id);
      assert.deepEqual(entry.files, [], entry.id);
    }
  }
  const readme = readFileSync(path.join(skillsDir, "README.md"), "utf8");
  for (const entry of manifest.entries.filter((item) => item.delivery === "vendored")) {
    assert.ok(readme.includes(`\`${entry.id}/`), entry.id);
  }
});
