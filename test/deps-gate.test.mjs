import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// PR-85: the dependency gate, Node first. A task names the packages it adds (`- Dependencies:`), the stack's audit
// blocks high and critical advisories when the dependencies change, and a copyleft licence is a warning.
// Git 2.47 and later run their automatic maintenance in the background; every git this file starts runs without it.
Object.assign(process.env, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "maintenance.auto", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0" });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

// A pnpm on PATH that answers `pnpm audit` with STUB_AUDIT (its JSON, or any text) and logs every call. No real pnpm
// and no network: the audit's answer is the test's.
const PNPM_STUB = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.STUB_PNPM_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(process.env.STUB_AUDIT ?? JSON.stringify({ advisories: {}, metadata: { vulnerabilities: {} } }));
process.exit(Number(process.env.STUB_AUDIT_EXIT ?? 0));
`;

function stubs(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "pnpm-stub.mjs"), PNPM_STUB);
  if (process.platform === "win32") {
    writeFileSync(path.join(dir, "pnpm.cmd"), "@node \"%~dp0pnpm-stub.mjs\" %*\r\n");
    return;
  }
  writeFileSync(path.join(dir, "pnpm"), `#!/usr/bin/env node\n${PNPM_STUB}`);
  chmodSync(path.join(dir, "pnpm"), 0o755);
}

const FENCE = (deps) => `## T07 — Invoices\n\n- Builder: grok-4.7 · Effort: high · Fast: no\n- Layers: backend\n- Paths: \`src/**\` · \`package.json\` · \`apps/web/**\`\n${deps === null ? "" : `- Dependencies: ${deps}\n`}\n### Done when\n\n- D1. Tests pass.\n\n### Do NOT\n\n- Run git.\n`;
const BASE = { name: "shop", dependencies: { next: "15.0.0", react: "19.0.0" }, devDependencies: { typescript: "5.6.0" } };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** An installed project on a task branch `task/T07` whose base (`origin/main`) has BASE as its package.json. */
function project(deps) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-deps-"));
  const dir = path.join(parent, "project");
  mkdirSync(dir);
  stubs(path.join(parent, "bin"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  put(dir, { "docs/fences/T07.md": FENCE(deps), "package.json": json(BASE), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "src/index.ts": "export {};\n" });
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "base"], ["update-ref", "refs/remotes/origin/main", "HEAD"], ["switch", "-q", "-c", "task/T07"]]) git(dir, args);
  return { parent, dir, log: path.join(parent, "pnpm.log") };
}

function put(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, ...rel.split("/"))), { recursive: true });
    writeFileSync(path.join(dir, ...rel.split("/")), text);
  }
}

function git(dir, args) {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return run.stdout;
}

function guard(p, env = {}) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "deps", "--json"], {
    cwd: p.dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: `${path.join(p.parent, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, STUB_PNPM_LOG: p.log, TASK: "T07", ...env },
  });
  assert.equal(run.stderr, "", run.stderr);
  return JSON.parse(run.stdout).deps;
}

const audits = (p) => (existsSync(p.log) ? readFileSync(p.log, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : []);
const done = (p) => rmSync(p.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test("deps-gate.test.mjs (a) guard:deps is N/A outside a task run, without its fence and for another toolchain; a task that changes no dependency passes without an audit", () => {
  const p = project("none");
  try {
    assert.deepEqual(guard(p, { TASK: "" }), { status: "N/A", findings: [], note: "no task in this run" });
    assert.deepEqual(guard(p, { TASK: "T09" }), { status: "N/A", findings: [], note: "no docs/fences/T09.md" });
    put(p.dir, { "src/index.ts": "export const total = 1;\n" });
    assert.deepEqual(guard(p), { status: "PASS", findings: [], note: "no manifest or lockfile changed" });
    assert.deepEqual(audits(p), []);
    const config = JSON.parse(readFileSync(path.join(p.dir, "devos.config.json"), "utf8"));
    config.stack.toolchain = "python";
    writeFileSync(path.join(p.dir, "devos.config.json"), json(config));
    assert.deepEqual(guard(p), { status: "N/A", findings: [], note: "the dependency gate covers Node projects first, and this one is python (PR-85)" });
  } finally {
    done(p);
  }
});

test("deps-gate.test.mjs (b) a package a manifest gains must be named on the Dependencies line; no line names none, and a manifest the task creates is the scaffold's", () => {
  const p = project("`zod`");
  try {
    // zod is named; left-pad and vitest are not. A version change or a move between sections gains nothing.
    put(p.dir, { "package.json": json({ ...BASE, dependencies: { next: "15.1.0", zod: "3.23.0", "left-pad": "1.3.0", typescript: "5.6.0" }, devDependencies: { react: "19.0.0", vitest: "2.0.0" } }) });
    git(p.dir, ["add", "-A"]);
    git(p.dir, ["commit", "-q", "-m", "T07 a1: builder"]);
    assert.deepEqual(guard(p), {
      status: "FAIL",
      findings: [
        "left-pad — added to package.json, and the `- Dependencies:` line of docs/fences/T07.md does not name it (PR-85)",
        "vitest — added to package.json, and the `- Dependencies:` line of docs/fences/T07.md does not name it (PR-85)",
      ],
      note: "3 package(s) added; audit: 0 high or critical; 3 licence(s) not read (not installed)",
    });
    assert.deepEqual(audits(p), [["audit", "--audit-level", "high", "--json"]]);
    put(p.dir, { "docs/fences/T07.md": FENCE("`zod` · `left-pad` · `vitest`") });
    assert.equal(guard(p).status, "PASS");
    // A fence without the line names none.
    put(p.dir, { "docs/fences/T07.md": FENCE(null) });
    assert.equal(guard(p).findings.length, 3);
    // A manifest the task creates holds the stack's packages: none is named, all are audited.
    put(p.dir, { "docs/fences/T07.md": FENCE("none"), "package.json": json(BASE), "apps/web/package.json": json({ name: "web", dependencies: { astro: "5.0.0", "@astrojs/node": "9.0.0" } }) });
    assert.deepEqual(guard(p), { status: "PASS", findings: [], note: "2 package(s) added, 1 manifest(s) created; audit: 0 high or critical; 2 licence(s) not read (not installed)" });
  } finally {
    done(p);
  }
});

test("deps-gate.test.mjs (c) the audit fails a high or critical advisory and one that does not answer, whenever a manifest or the lockfile changed", () => {
  const p = project("none");
  try {
    put(p.dir, { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n# updated\n" });
    const report = {
      advisories: {
        1: { module_name: "lodash", severity: "high", title: "Prototype pollution", github_advisory_id: "GHSA-aaaa-bbbb-cccc" },
        2: { module_name: "debug", severity: "moderate", title: "ReDoS", github_advisory_id: "GHSA-dddd-eeee-ffff" },
        3: { module_name: "minimist", severity: "critical", title: "Prototype pollution", url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz" },
      },
      metadata: { vulnerabilities: { moderate: 1, high: 1, critical: 1 } },
    };
    assert.deepEqual(guard(p, { STUB_AUDIT: JSON.stringify(report), STUB_AUDIT_EXIT: "1" }), {
      status: "FAIL",
      findings: [
        "minimist — critical: Prototype pollution (https://github.com/advisories/GHSA-xxxx-yyyy-zzzz); upgrade it, or waive it in package.json pnpm.auditConfig with the owner's recorded decision (PR-85)",
        "lodash — high: Prototype pollution (GHSA-aaaa-bbbb-cccc); upgrade it, or waive it in package.json pnpm.auditConfig with the owner's recorded decision (PR-85)",
      ],
      note: "0 package(s) added; audit: 2 high or critical",
    });
    // An audit that does not answer is asked twice, then fails the gate.
    rmSync(p.log);
    assert.deepEqual(guard(p, { STUB_AUDIT: "ERR_PNPM_AUDIT_BAD_RESPONSE", STUB_AUDIT_EXIT: "1" }).findings, ["pnpm audit — did not run (its output is not JSON); the gate needs its answer (PR-85)"]);
    assert.equal(audits(p).length, 2);
    assert.deepEqual(guard(p, { STUB_AUDIT: JSON.stringify({ error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE", message: "The audit endpoint responded with 503" } }) }).findings, ["pnpm audit — did not run (The audit endpoint responded with 503); the gate needs its answer (PR-85)"]);
    // Without the lockfile there is nothing to audit.
    rmSync(path.join(p.dir, "pnpm-lock.yaml"));
    assert.deepEqual(guard(p).findings, ["pnpm-lock.yaml — missing, and the audit reads it: run pnpm install (PR-85)"]);
  } finally {
    done(p);
  }
});

test("deps-gate.test.mjs (d) a copyleft licence is a warning in the note, never a failure, and fence-check checks the Dependencies line", () => {
  const p = project("`gpl-lib` · `mpl-lib` · `mit-lib` · `@scope/agpl`");
  try {
    put(p.dir, {
      "package.json": json({ ...BASE, dependencies: { ...BASE.dependencies, "gpl-lib": "1.0.0", "mpl-lib": "1.0.0", "mit-lib": "1.0.0", "@scope/agpl": "1.0.0" } }),
      "node_modules/gpl-lib/package.json": json({ name: "gpl-lib", license: "GPL-3.0-only" }),
      "node_modules/mpl-lib/package.json": json({ name: "mpl-lib", licenses: [{ type: "MPL-2.0" }] }),
      "node_modules/mit-lib/package.json": json({ name: "mit-lib", license: "MIT" }),
      "node_modules/@scope/agpl/package.json": json({ name: "@scope/agpl", license: { type: "AGPL-3.0-or-later" } }),
    });
    assert.deepEqual(guard(p), {
      status: "PASS",
      findings: [],
      note: "4 package(s) added; audit: 0 high or critical; copyleft licence warning: @scope/agpl (AGPL-3.0-or-later), gpl-lib (GPL-3.0-only), mpl-lib (MPL-2.0)",
    });
    const check = (deps) => {
      put(p.dir, { "docs/fences/T07.md": FENCE(deps) });
      const run = spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", "docs/fences/T07.md"], { cwd: p.dir, encoding: "utf8", windowsHide: true });
      return run.stdout.split(/\r?\n/).filter((line) => line.startsWith("docs/fences/T07.md: ")).map((line) => line.slice("docs/fences/T07.md: ".length));
    };
    assert.deepEqual(check("none"), []);
    assert.deepEqual(check("`zod` · `@tanstack/react-query`"), []);
    assert.deepEqual(check(null), []);
    assert.deepEqual(check(""), ["the `- Dependencies:` line names no package: name each in backticks, or write `none` (PR-85)"]);
    assert.deepEqual(check("`Zod` · `zod` · `zod` · `../x`"), [
      "dependency `Zod` is not a package name (such as `zod` or `@scope/name`)",
      "dependency `../x` is not a package name (such as `zod` or `@scope/name`)",
      "dependency `zod` is named twice",
    ]);
  } finally {
    done(p);
  }
});

test("deps-gate.test.mjs (e) the method, the manual, the handbook, the prompts and the changelog say so (PR-85)", () => {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const precedents = read("payload/files/docs/method/PRECEDENTS.md");
  assert.equal(precedents.includes("| PR-85 | **New dependencies are named, audited and their licences read.**"), true);
  assert.equal(read("payload/files/docs/method/AUTOMATION.md").includes("· `deps` (the dependency gate, Node first, PR-85:"), true);
  assert.equal(read("payload/files/docs/method/DEV_OS_V2_REVIEWER.md").includes("- Dependencies: `<package>` · `<package>`, or none   (every package the task may add)\n"), true);
  for (const prompt of ["blueprint", "reviewer", "intake", "revise", "builder"]) {
    assert.equal(read(`payload/files/devos/prompts/${prompt}.md`).includes("- Dependencies:"), true, prompt);
  }
  assert.equal(read("payload/files/dot-claude/skills/devos-fence-writing/SKILL.md").includes("It also carries `- Dependencies: \\`<package>\\` · …`"), true);
  assert.equal(read("payload/files/dot-claude/agents/fence-auditor.md").includes("Every package its steps add to a manifest is named on the `- Dependencies:` line (PR-85)"), true);
  assert.equal(read("README.md").includes("18 guards on every task"), true);
  assert.equal(read("CHANGELOG.md").includes("- **The dependency gate (PR-85), Node first.**"), true);
});
