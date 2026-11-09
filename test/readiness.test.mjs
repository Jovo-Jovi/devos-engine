import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkFence, launchLine } from "../payload/files/scripts/devos/fence-check.mjs";
import { asvsLevel, checkRecord, headerFindings, speedFindings, waivers, withReadiness } from "../payload/files/scripts/devos/readiness.mjs";

// E23b4 (PR-88): the launch task proves production readiness. Its fence's `- Launch:` line names the main pages;
// readiness.mjs checks them (headers, the full audit, accessibility, speed) as the required check `readiness`; the
// reviewer goes through docs/method/READINESS.md with the ASVS at the project's level and Trail of Bits' sharp edges;
// only the owner's written waiver in docs/DECISIONS.md excepts a gate.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const PAYLOAD = "payload/files";
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const GOOD = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

// A pnpm on PATH that answers `pnpm audit` with STUB_AUDIT; no real pnpm and no network.
const PNPM_STUB = `process.stdout.write(process.env.STUB_AUDIT ?? JSON.stringify({ advisories: {} }));\n`;
// The product's "build": a server on PORT that sends FAKE_HEADERS (JSON) on every page, and 404 on /missing.
const SITE = `import http from "node:http";
const headers = JSON.parse(process.env.FAKE_HEADERS ?? "{}");
http.createServer((req, res) => {
  res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "text/html", ...headers });
  res.end("<!doctype html><html lang=\\"en\\"><title>Shop</title><h1>Shop</h1></html>");
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

function project(fenceLine) {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-readiness-"));
  const dir = path.join(parent, "project");
  const binDir = path.join(parent, "bin");
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(path.join(binDir, "pnpm-stub.mjs"), PNPM_STUB);
    writeFileSync(path.join(binDir, "pnpm.cmd"), "@node \"%~dp0pnpm-stub.mjs\" %*\r\n");
  } else {
    writeFileSync(path.join(binDir, "pnpm"), `#!/usr/bin/env node\n${PNPM_STUB}`);
    chmodSync(path.join(binDir, "pnpm"), 0o755);
  }
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const projectFile = path.join(dir, "devos", "project.json");
  const value = JSON.parse(readFileSync(projectFile, "utf8"));
  value.stack = { ...(value.stack ?? {}), preview: "node site.mjs" };
  writeFileSync(projectFile, `${JSON.stringify(value, null, 2)}\n`);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(written.status, 0, written.stdout + written.stderr);
  writeFileSync(path.join(dir, "site.mjs"), SITE);
  writeFileSync(path.join(dir, "package.json"), "{\"name\":\"shop\",\"private\":true}\n");
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "fences", "T09.md"), `## T09 — Launch\n\n- Builder: grok-4.7 · Effort: high · Fast: no\n- Layers: security · frontend\n${fenceLine}\n\n### Done when\n- D1\n\n### Do NOT\n- x\n`);
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  return { parent, dir, binDir };
}

function readiness(p, env = {}) {
  const run = spawnSync(process.execPath, ["scripts/devos/readiness.mjs", "--task", "T09", "--port", String(3400 + Math.floor(Math.random() * 500))], {
    cwd: p.dir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    env: { ...process.env, PATH: `${p.binDir}${path.delimiter}${process.env.PATH ?? ""}`, GITHUB_OUTPUT: "", ...env },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const file = path.join(p.dir, ".devos", "readiness.json");
  return { out: run.stdout, report: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

const status = (report) => Object.fromEntries(report.checks.map((c) => [c.name, c.status]));

test("readiness.test.mjs (a) the - Launch: line names the main pages or none, and fence-check checks it", () => {
  assert.deepEqual(launchLine("## T09\n\n- Launch: / · /pricing, /sign-in\n"), { found: true, none: false, paths: ["/", "/pricing", "/sign-in"], errors: [] });
  assert.deepEqual(launchLine("- Launch: none"), { found: true, none: true, paths: [], errors: [] });
  assert.deepEqual(launchLine("- Layers: security"), { found: false, none: false, paths: [], errors: [] });
  assert.deepEqual(launchLine("- Launch: pricing · / · /").errors, ["\"pricing\" is not a page path (it starts with / and has no query)", "names a page twice"]);
  assert.deepEqual(launchLine(`- Launch: ${Array.from({ length: 11 }, (_, i) => `/p${i}`).join(" · ")}`).errors, ["names 11 pages; 10 at most"]);
  assert.deepEqual(checkFence("- Launch: /a?b\n\n### Done when\n- D1\n\n### Do NOT\n- x\n", "t").filter((f) => f.includes("Launch")), ["the `- Launch:` line \"/a?b\" is not a page path (it starts with / and has no query) (PR-88)"]);
  assert.deepEqual(checkFence("- Launch: / · /pricing\n\n### Done when\n- D1\n\n### Do NOT\n- x\n", "t").filter((f) => f.includes("Launch")), []);
});

test("readiness.test.mjs (b) the headers, speed, level and waivers are judged as the method says", () => {
  assert.deepEqual(headerFindings(GOOD, "/"), []);
  assert.deepEqual(headerFindings({ ...GOOD, "content-security-policy": "default-src 'self'", "x-frame-options": "DENY" }, "/"), []);
  assert.deepEqual(headerFindings({ "strict-transport-security": "max-age=300", "referrer-policy": "unsafe-url", "x-powered-by": "Next.js" }, "/a"), [
    "/a: Strict-Transport-Security max-age 300 is under a year (31536000)",
    "/a: no Content-Security-Policy",
    "/a: X-Content-Type-Options is not nosniff",
    "/a: Referrer-Policy is unsafe-url",
    "/a: no frame protection (CSP frame-ancestors or X-Frame-Options)",
    "/a: X-Powered-By tells the framework (Next.js)",
  ]);
  assert.deepEqual(speedFindings({ lcp: 2500, cls: 0.1 }, "/"), []);
  assert.deepEqual(speedFindings({ lcp: 3120.4, cls: 0.25 }, "/"), ["/: largest contentful paint 3120 ms, over 2500 ms", "/: layout shift 0.250, over 0.1"]);
  assert.deepEqual(asvsLevel(), { level: 1, why: "no personal data and no payments" });
  assert.equal(asvsLevel({ protection: true }).level, 2);
  assert.equal(asvsLevel({ payments: true }).level, 2);
  const waived = waivers("# Decisions\n\n- Readiness waiver: speed — the hero video is the product (OD-12)\n- readiness waiver: Headers - behind the client's proxy\nReadiness waiver: asvs V8.2.1 — later\n");
  assert.deepEqual([...waived.entries()], [["speed", "the hero video is the product (OD-12)"], ["headers", "behind the client's proxy"]]);
  assert.deepEqual(checkRecord("speed", { findings: ["/: slow"] }, waived), { name: "speed", status: "waived", findings: ["/: slow"], note: "", waiver: "the hero video is the product (OD-12)" });
  assert.equal(checkRecord("audit", { findings: ["x"] }, waived).status, "fail");
  assert.equal(checkRecord("audit", { na: true, note: "go" }, waived).status, "n/a");
  const ci = { results: [{ name: "test", status: "pass" }], failed_required: [], all_required_passed: true };
  const failing = withReadiness(ci, { task: "T09", checks: [{ name: "headers", status: "fail", findings: ["/: no CSP"] }, { name: "speed", status: "waived", findings: ["/: slow"] }] });
  assert.deepEqual([failing.failed_required, failing.all_required_passed, failing.results.at(-1).name, failing.results.at(-1).required], [["readiness"], false, "readiness", true]);
  assert.equal(withReadiness(failing, { task: "T09", checks: [{ name: "speed", status: "waived", findings: ["/: slow"] }] }).all_required_passed, true);
});

test("readiness.test.mjs (c) the launch task's pages are checked on the build, and a failed check is red until the owner waives it", () => {
  const p = project("- Launch: / · /pricing");
  try {
    writeFileSync(path.join(p.dir, ".devos", "ci-results.json"), JSON.stringify({ results: [], failed_required: [], all_required_passed: true }));
    const bad = readiness(p, { FAKE_HEADERS: JSON.stringify({ "x-powered-by": "Express" }), STUB_AUDIT: JSON.stringify({ advisories: { 1: { module_name: "lodash", severity: "high", title: "Prototype pollution", github_advisory_id: "GHSA-aaaa" } } }) });
    assert.deepEqual(status(bad.report), { headers: "fail", audit: "fail", accessibility: "fail", speed: "fail" });
    assert.equal(bad.report.checks[0].findings.length, 12);
    assert.deepEqual(bad.report.checks[1].findings, ["lodash — high: Prototype pollution (GHSA-aaaa)"]);
    assert.deepEqual(bad.report.checks[2].findings, ["no @playwright/test in the project: add it (docs/method/DESIGN_METHOD.md §4) or waive the check"]);
    assert.deepEqual([bad.report.level, bad.report.pages, bad.report.source], [1, ["/", "/pricing"], "local build (node site.mjs)"]);
    const ci = JSON.parse(readFileSync(path.join(p.dir, ".devos", "ci-results.json"), "utf8"));
    assert.deepEqual([ci.failed_required, ci.all_required_passed], [["readiness"], false]);
    assert.match(bad.out, /^readiness: FAIL · ASVS level 1$/m);

    writeFileSync(path.join(p.dir, "docs", "PROTECTION_MODEL.md"), "# Protection model\n");
    writeFileSync(path.join(p.dir, "docs", "DECISIONS.md"), "# Decisions\n\n- OD-20: Readiness waiver: accessibility — checked by hand at G-Launch\n- OD-21: Readiness waiver: speed — measured on the deployment instead\n");
    const good = readiness(p, { FAKE_HEADERS: JSON.stringify(GOOD) });
    assert.deepEqual(status(good.report), { headers: "pass", audit: "pass", accessibility: "waived", speed: "waived" });
    assert.equal(good.report.level, 2);
    const after = JSON.parse(readFileSync(path.join(p.dir, ".devos", "ci-results.json"), "utf8"));
    assert.deepEqual([after.failed_required, after.all_required_passed, after.results.filter((r) => r.name === "readiness").length], [[], true, 1]);
    const text = readFileSync(path.join(p.dir, ".devos", "readiness.md"), "utf8");
    assert.match(text, /^ASVS level 2: the project stores personal data \(docs\/PROTECTION_MODEL\.md\)\. Verify every requirement/m);
    assert.match(text, /^\| speed \| waived \(owner's waiver: measured on the deployment instead\) \|/m);
    assert.match(text, /^The readiness check passes\.$/m);
    const evidence = spawnSync(process.execPath, ["scripts/devos/evidence.mjs", "--task", "T09", "--attempt", "1"], { cwd: p.dir, encoding: "utf8", windowsHide: true });
    assert.equal(evidence.status, 0, evidence.stderr);
    assert.match(readFileSync(path.join(p.dir, ".devos", "evidence.md"), "utf8"), /## Production readiness \(PR-88\)\n\nASVS level 2/);
  } finally {
    rmSync(p.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("readiness.test.mjs (d) a product without pages gets the audit alone, and another task gets nothing", () => {
  const p = project("- Launch: none");
  try {
    const none = readiness(p);
    assert.deepEqual(status(none.report), { headers: "n/a", audit: "pass", accessibility: "n/a", speed: "n/a" });
    assert.equal(none.report.passed, true);
    writeFileSync(path.join(p.dir, "docs", "fences", "T09.md"), "## T09 — Invoices\n\n- Layers: backend\n");
    const other = readiness(p);
    assert.equal(other.report, null);
    assert.equal(existsSync(path.join(p.dir, ".devos", "readiness.md")), false);
    assert.match(other.out, /^readiness: N\/A \(T09 has no - Launch: line, so it is not the launch task\)$/m);
  } finally {
    rmSync(p.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("readiness.test.mjs (e) the ASVS and sharp edges ship read whole and pinned, and the launch review reads them", () => {
  const manifest = JSON.parse(read(`${PAYLOAD}/devos/skills/manifest.json`));
  const asvs = manifest.entries.find((e) => e.id === "owasp-asvs");
  const tob = manifest.entries.find((e) => e.id === "trailofbits-sharp-edges");
  assert.deepEqual([asvs.delivery, asvs.source.commit, asvs.source.tag, asvs.files.length, asvs.reads.length], ["vendored", "5cf9b032440be53ce345ab3c130fda46ba1ce7a2", "v5.0.0_release", 20, 16]);
  assert.deepEqual([tob.delivery, tob.source.commit, tob.files.length, tob.reads.length], ["vendored", "e4dd0bb5b15535f7c5a0834187dffba6ac37e4ff", 9, 6]);
  assert.deepEqual([asvs.trust.runs_code, asvs.trust.fetches, tob.trust.runs_code, tob.trust.fetches], [false, false, false, false]);
  assert.deepEqual(manifest.topics.launch, { match: "(^|\\n)- Launch:", covers: "the launch task, whose fence has a `- Launch:` line: the production-readiness gate (PR-88)" });
  // Every requirement row of the copied chapters ends in its level.
  for (const file of asvs.files.filter((f) => /^0x(1|2)\d-V/.test(f.path))) {
    const rows = read(`${PAYLOAD}/devos/skills/owasp-asvs/${file.path}`).split("\n").filter((line) => /^\| \*\*\d+\.\d+\.\d+\*\* \|/.test(line));
    assert.ok(rows.length > 0 && rows.every((line) => /\| [123] \|\s*$/.test(line)), file.path);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "devos-launch-skills-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "skills", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.deepEqual(JSON.parse(guards.stdout).skills, { status: "PASS", findings: [], note: "29 skills checked, 20 vendored" });
    mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
    const fence = "## T09 — Launch\n\n- Risk: 3\n- Layers: security · frontend · backend\n- Launch: / · /pricing\n\nSign-in with passwords stays as it is.\n";
    writeFileSync(path.join(dir, "docs", "fences", "T09.md"), fence);
    // The launch task is risk 3 with the owner's gate, so it is deep: a subject its fence names adds its chapter.
    writeFileSync(path.join(dir, "docs", "PHASES.md"), "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n|---|---|---|---|---|---|---|---|\n| T09 | P3 | J9 | Launch | 3 | G-Launch | [ ] | — |\n");
    const pick = (role) => JSON.parse(spawnSync(process.execPath, ["scripts/devos/skills.mjs", "select", "--task", "T09", "--role", role, "--json"], { cwd: dir, encoding: "utf8", windowsHide: true }).stdout).files.map((f) => f.path);
    const reviewer = pick("reviewer");
    for (const file of ["owasp-asvs/DEVOS-NOTES.md", "owasp-asvs/0x12-V3-Web-Frontend-Security.md", "owasp-asvs/0x15-V6-Authentication.md", "owasp-asvs/0x22-V13-Configuration.md", "trailofbits-sharp-edges/SKILL.md", "trailofbits-sharp-edges/references/lang-javascript.md"]) {
      assert.equal(reviewer.includes(`devos/skills/${file}`), true, `${file} in ${reviewer.join(", ")}`);
    }
    assert.equal(reviewer.includes("devos/skills/owasp-asvs/0x20-V11-Cryptography.md"), false);
    assert.equal(pick("builder").some((file) => /owasp-asvs|trailofbits-sharp-edges/.test(file)), false);
    // A task that is not the launch task and not deep reads neither.
    writeFileSync(path.join(dir, "docs", "fences", "T09.md"), "## T09 — Profile\n\n- Layers: security · frontend\n\nSign-in with passwords.\n");
    writeFileSync(path.join(dir, "docs", "PHASES.md"), "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n|---|---|---|---|---|---|---|---|\n| T09 | P3 | J5 | Profile | 2 | — | [ ] | — |\n");
    assert.equal(pick("reviewer").some((file) => /owasp-asvs|trailofbits-sharp-edges/.test(file)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("readiness.test.mjs (f) the cycle runs it, and the checklist, the prompts, the method and the changelog say so (PR-88)", () => {
  // PR-90: the checks, readiness among them, run in the work job (devos-work.yml), on the local build.
  const cycle = read(`${PAYLOAD}/dot-github/workflows/devos-work.yml`);
  assert.equal(cycle.includes("      - name: Production readiness (PR-88)\n"), true);
  assert.equal(cycle.includes("            node scripts/devos/readiness.mjs --task \"$TASK\"\n"), true);
  assert.ok(cycle.indexOf("node scripts/devos/ui-evidence.mjs --task") < cycle.indexOf("node scripts/devos/readiness.mjs --task") && cycle.indexOf("node scripts/devos/readiness.mjs --task") < cycle.indexOf("node scripts/devos/evidence.mjs --task"));
  const checklist = read(`${PAYLOAD}/docs/method/READINESS.md`);
  for (const text of ["# Production readiness — the launch task's gates (PR-88)", "`Readiness waiver: <headers|audit|accessibility|speed> — <reason>`", "Verify **level 1**, and **level 2** when the project stores personal data"]) assert.equal(checklist.includes(text), true, text);
  for (const layer of ["### Security", "### Frontend, design, motion and accessibility", "### Speed", "### Backend and API", "### Database", "### Architecture and ops", "### Testing"]) assert.equal(checklist.includes(`\n${layer}\n`), true, layer);
  assert.equal(read(`${PAYLOAD}/devos/prompts/reviewer.md`).includes("**The launch task (PR-88)** has a `- Launch:` line. Go through `docs/method/READINESS.md`"), true);
  assert.equal(read(`${PAYLOAD}/devos/prompts/blueprint.md`).includes("With `scope` `full`, the last task before launch is **the launch task**"), true);
  assert.equal(read(`${PAYLOAD}/dot-claude/skills/devos-fence-writing/SKILL.md`).includes("The launch task's fence (`scope` `full`, the last task before launch) also carries `- Launch: / · /<page> · …`."), true);
  assert.equal(read(`${PAYLOAD}/docs/method/DEV_OS_V2_REVIEWER.md`).includes("### 10.4 Production readiness (PR-88)"), true);
  assert.equal(read(`${PAYLOAD}/docs/method/AUTOMATION.md`).includes("| `readiness.mjs` | for the launch task"), true);
  const precedents = read(`${PAYLOAD}/docs/method/PRECEDENTS.md`);
  assert.equal(precedents.includes("| PR-88 | **The launch task proves production readiness, by tool and by checklist, and only the owner waives a gate.**"), true);
  const changes = read("CHANGELOG.md");
  for (const line of ["- **The launch task (PR-88).**", "- **A production-readiness checklist.**", "- **OWASP ASVS 5.0.0 and Trail of Bits' sharp edges.**", "- **Test runs leave the repository's files as they were.**"]) assert.equal(changes.includes(line), true, line);
  assert.equal(read(`${PAYLOAD}/devos/engine.defaults.json`).includes("\"docs/DECISIONS.md\""), true);
});
