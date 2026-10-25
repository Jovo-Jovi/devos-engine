import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    layers: ["frontend"],
    stacks: ["any"],
    trust: { runs_code: false, fetches: false, reviewed: "2026-10-25", notes: "Markdown only." },
    reads: [{ file: "NOTES.md", roles: ["builder"], layers: ["frontend"], when: "every screen of this project" }],
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
    assert.deepEqual(guard(dir), { status: "PASS", findings: [], note: "29 skills checked, 18 vendored" });
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
    assert.deepEqual(guard(dir), { status: "PASS", findings: [], note: "30 skills checked, 19 vendored" });
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
  const index = readFileSync(path.join(skillsDir, "INDEX.md"), "utf8");
  for (const entry of manifest.entries.filter((item) => item.delivery === "vendored")) {
    assert.ok(index.includes(`\`${entry.id}/`), entry.id);
  }
});

test("skills.test.mjs (g) a vendored entry needs its layers, its trust review and its reads, and INDEX.md stays current", () => {
  const dir = project();
  try {
    writeLocal(dir, localEntry({ layers: ["frontend", "styling"], trust: { runs_code: true, fetches: false, reviewed: "soon" }, reads: [{ file: "OTHER.md", roles: ["reviewer"], layers: ["database"], when: "" }] }));
    assert.deepEqual(guard(dir).findings, [
      "devos/skills/local.json studio-notes: layers must be some of design, motion, frontend, accessibility, architecture, backend, api, database, security, reliability, testing, ops",
      "devos/skills/local.json studio-notes: trust.runs_code must be false (the cycle runs no code from a skill)",
      "devos/skills/local.json studio-notes: trust.reviewed must be the date its files were read (YYYY-MM-DD)",
      "devos/skills/local.json studio-notes: reads OTHER.md: not one of its files",
      "devos/skills/local.json studio-notes: reads OTHER.md: roles must be some of the entry's roles",
      "devos/skills/local.json studio-notes: reads OTHER.md: layers must be some of the entry's layers",
      "devos/skills/local.json studio-notes: reads OTHER.md: no when",
    ]);
    writeLocal(dir, localEntry());
    appendFileSync(path.join(dir, "devos", "skills", "INDEX.md"), "\nA note.\n");
    assert.deepEqual(guard(dir).findings, ["devos/skills/INDEX.md is out of date: run node scripts/devos/skills.mjs index"]);
    const rebuilt = spawnSync(process.execPath, ["scripts/devos/skills.mjs", "index"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(rebuilt.stdout, "devos/skills/INDEX.md written\n", rebuilt.stderr);
    assert.equal(guard(dir).status, "PASS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (h) a task gets the skills of its layers, for its role and stack, its project's own included", () => {
  const dir = project();
  try {
    writeLocal(dir, localEntry({ stacks: ["node-cli"] }));
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n\n- Layers: ops · testing\n");
    writeFileSync(path.join(dir, "docs", "fences", "T02.md"), "# T02\n\n- Screens: `home /`\n");
    writeFileSync(path.join(dir, "docs", "fences", "T03.md"), "# T03\n\n- Layers: `frontend`, motion\n");
    writeFileSync(path.join(dir, "docs", "fences", "T04.md"), "# T04\n\n- Surface: method — scripts/devos/x.mjs\n- Screens: `home /`\n");
    const skills = (...args) => spawnSync(process.execPath, ["scripts/devos/skills.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true }).stdout.trim();
    assert.equal(skills("layers", "--task", "T01"), "testing ops");
    // PR-57: a UI fence's frontend layer brings the test gate.
    assert.equal(skills("layers", "--task", "T02"), "design motion frontend accessibility testing");
    assert.equal(skills("layers", "--task", "T04"), "");
    assert.equal(skills("select", "--task", "T01", "--role", "builder"), [
      "devos/skills/superpowers/DEVOS-NOTES.md",
      "devos/skills/superpowers/test-driven-development/writing-good-tests.md",
      "devos/skills/superpowers/verification-before-completion/SKILL.md",
    ].join("\n"));
    assert.equal(skills("select", "--task", "T03", "--role", "reviewer"), [
      "devos/skills/web-interface-guidelines/SKILL.md",
      "devos/skills/emil-design-eng/SKILL.md",
      "devos/skills/review-animations/SKILL.md",
      "devos/skills/review-animations/STANDARDS.md",
      "devos/skills/impeccable/reference/craft-floor.md",
      "devos/skills/impeccable/reference/audit.md",
      "devos/skills/superpowers/DEVOS-NOTES.md",
      "devos/skills/superpowers/test-driven-development/writing-good-tests.md",
    ].join("\n"));
    // The project's own skill fits only its stack: the DEMO install has no stack id and the node toolchain, not node-cli.
    assert.equal(skills("select", "--task", "T03", "--role", "builder").includes("studio-notes"), false);
    writeLocal(dir, localEntry());
    assert.equal(skills("select", "--task", "T03", "--role", "builder").split("\n").at(-1), "devos/skills/studio-notes/NOTES.md");
    assert.match(skills("list"), /^studio-notes\tvendored\tfrontend\tlocal$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills.test.mjs (i) the builder's and the reviewer's prompts list the task's skills, and only when it has some", () => {
  const dir = project();
  try {
    cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    const render = (role) => {
      const run = spawnSync(process.execPath, ["scripts/devos/render-prompt.mjs", role, "T01", "1"], { cwd: dir, encoding: "utf8", windowsHide: true });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout;
    };
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n\n- Screens: `home /`\n");
    const builder = render("builder");
    assert.match(builder, /^- \*\*Skills for this task\*\* \(layers design · motion · frontend · accessibility · testing, from the fence and the test gate: the frontend layer changes code; `devos\/skills\/INDEX.md`\)/m);
    assert.match(builder, /^  - `devos\/skills\/frontend-design\/SKILL.md` — the visual direction in `docs\/DESIGN_SYSTEM.md`, and every new screen$/m);
    assert.equal(builder.includes("devos/skills/taste/references/critique.md"), false);
    assert.match(render("reviewer"), /^  - `devos\/skills\/taste\/references\/critique.md` — judging the captures of a public page$/m);
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n\nA note.\n");
    assert.equal(render("builder").includes("Skills for this task"), false);
    assert.equal(render("builder").includes("{{"), false);
    // PR-56: a server-side layer brings the security gate's files.
    writeFileSync(path.join(dir, "docs", "fences", "T01.md"), "# T01\n\n- Layers: backend · database\n");
    assert.match(render("builder"), /^- \*\*Skills for this task\*\* \(layers backend · database · security · testing, from the fence and the security gate: the backend and database layers are server-side; the test gate: the backend and database layers change code;/m);
    assert.match(render("builder"), /^  - `devos\/skills\/owasp-cheat-sheets\/SQL_Injection_Prevention_Cheat_Sheet.md` — every query: bind values, map identifiers$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
