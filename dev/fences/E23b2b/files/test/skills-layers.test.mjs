import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// PR-57: the architecture, reliability, observability, testing and CI/CD skills, and the test gate. Scenarios F–J
// run the catalogue on more stacks; (f) the gates; (g) every new bundle is pinned and licensed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const skillsDir = path.join(root, "payload", "files", "devos", "skills");
const S = "devos/skills/";

function project({ stack, modules = {}, fences = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-layers-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const phases = path.join(dir, "docs", "PHASES.md");
  const rows = Object.keys(fences).map((task) => `| ${task} | P1 | S1 | ${task} | 2 | — | [ ] | — |`);
  writeFileSync(phases, readFileSync(phases, "utf8").replace("| T01 | P1 | S1 | First task | 1 | — | [ ] | — |", rows.join("\n")));
  const cfgPath = path.join(dir, "devos.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.stack = { ...cfg.stack, ...stack };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(path.join(dir, "devos", "answers.json"), JSON.stringify({ modules }));
  mkdirSync(path.join(dir, "docs", "fences"), { recursive: true });
  for (const [task, text] of Object.entries(fences)) writeFileSync(path.join(dir, "docs", "fences", `${task}.md`), text);
  return dir;
}

function skills(dir, args) {
  const run = spawnSync(process.execPath, ["scripts/devos/skills.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, DEVOS_REVIEW_MODE: "" } });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

const record = (dir, task, role = "builder") => JSON.parse(skills(dir, ["select", "--task", task, "--role", role, "--json"]));
const paths = (rec) => rec.files.map((file) => file.path.slice(S.length));
const SECURITY = [
  "owasp-cheat-sheets/DEVOS-NOTES.md",
  "owasp-cheat-sheets/Input_Validation_Cheat_Sheet.md",
  "owasp-cheat-sheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md",
];
const TOP10 = ["owasp-api-top10-2023/DEVOS-NOTES.md", "owasp-api-top10-2023/0x11-t10.md"];
const TESTING = ["superpowers/DEVOS-NOTES.md", "superpowers/test-driven-development/writing-good-tests.md", "superpowers/verification-before-completion/SKILL.md"];

test("skills-layers.test.mjs (a) scenario F: a FastAPI worker calling a payment provider gets the reliability patterns", () => {
  const dir = project({
    stack: { id: "fastapi", toolchain: "python" },
    fences: { T01: "# T01 — Payment sync worker\n\n- Layers: backend · reliability\n\nA worker that sends each order to the payment provider, with timeouts and retries, and survives a restart.\n" },
  });
  try {
    const rec = record(dir, "T01");
    assert.deepEqual(rec.layers.added, [
      { layer: "security", reason: "the security gate: the backend and reliability layers are server-side" },
      { layer: "testing", reason: "the test gate: the backend and reliability layers change code" },
    ]);
    assert.deepEqual(rec.topics.map((item) => item.topic), ["payment", "idempotency", "concurrency", "resilience"]);
    assert.deepEqual(paths(rec), [
      ...SECURITY,
      "owasp-cheat-sheets/Injection_Prevention_Cheat_Sheet.md",
      ...TOP10,
      ...TESTING,
      "azure-cloud-patterns/DEVOS-NOTES.md",
      "azure-cloud-patterns/retry-content.md",
      "azure-cloud-patterns/circuit-breaker.md",
      "azure-cloud-patterns/bulkhead.md",
      "azure-cloud-patterns/queue-based-load-leveling.md",
      "azure-cloud-patterns/idempotent-consumer.md",
      "twelve-factor/DEVOS-NOTES.md",
      "twelve-factor/processes.md",
      "twelve-factor/disposability.md",
    ]);
    assert.equal(rec.files.find((file) => file.path.endsWith("circuit-breaker.md")).reason, "the fence says \"timeouts\"");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (b) scenario G: a CI workflow task gets the CI/CD rules and no gate", () => {
  const dir = project({
    stack: { id: "next", toolchain: "node" },
    fences: { T01: "# T01 — Pull request checks\n\n- Layers: ops\n\nAdd a GitHub Actions workflow that runs the tests on every pull request, with every action pinned.\n" },
  });
  try {
    const rec = record(dir, "T01");
    assert.deepEqual(rec.layers, { fence: ["ops"], added: [], all: ["ops"] });
    assert.deepEqual(paths(rec), [
      "owasp-cheat-sheets/DEVOS-NOTES.md",
      "owasp-cheat-sheets/CI_CD_Security_Cheat_Sheet.md",
      "twelve-factor/DEVOS-NOTES.md",
      "twelve-factor/build-release-run.md",
      "github-actions-security/DEVOS-NOTES.md",
      "github-actions-security/secure-use.md",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (c) scenario H: a flaky end-to-end test gets debugging and Playwright on a Node stack only", () => {
  const fence = "# T01 — Sign-up test\n\n- Layers: frontend · testing\n\nThe end-to-end test of the sign-up form is flaky: it sometimes fails in CI.\n";
  const node = project({ stack: { id: "sveltekit", toolchain: "node" }, fences: { T01: fence } });
  const python = project({ stack: { id: "django", toolchain: "python" }, fences: { T01: fence } });
  try {
    const debugging = ["superpowers/systematic-debugging/SKILL.md", "superpowers/systematic-debugging/condition-based-waiting.md"];
    const onNode = record(node, "T01");
    assert.deepEqual(onNode.topics.map((item) => item.topic), ["auth", "flaky", "e2e", "ci"]);
    assert.deepEqual(paths(onNode).slice(-7), [...TESTING, ...debugging, "playwright-best-practices/DEVOS-NOTES.md", "playwright-best-practices/best-practices-js.md"]);
    assert.equal(onNode.files.at(-1).reason, "the fence says \"end-to-end\"");
    assert.equal(paths(onNode).some((file) => file.startsWith("owasp")), false);
    assert.deepEqual(onNode.not_selected, []);
    const onPython = record(python, "T01");
    assert.deepEqual(paths(onPython).slice(-5), [...TESTING, ...debugging]);
    assert.deepEqual(onPython.not_selected, [{ id: "playwright-best-practices", reason: "fits the stacks node, not this project's" }]);
    assert.deepEqual(onPython.layers.added, []);
  } finally {
    rmSync(node, { recursive: true, force: true });
    rmSync(python, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (d) scenario I: moving a part of a legacy monolith gets the migration patterns", () => {
  const dir = project({
    stack: { id: "nest", toolchain: "node" },
    fences: { T01: "# T01 — Billing service\n\n- Layers: architecture · backend\n\nMove billing out of the legacy monolith into its own service, behind an anti-corruption layer.\n" },
  });
  try {
    const rec = record(dir, "T01");
    assert.deepEqual(rec.layers.all, ["architecture", "backend", "security", "testing"]);
    assert.deepEqual(rec.layers.added.map((item) => item.reason), [
      "the security gate: the backend layer is server-side",
      "the test gate: the architecture and backend layers change code",
    ]);
    assert.deepEqual(rec.topics.map((item) => item.topic), ["payment", "legacy"]);
    assert.deepEqual(paths(rec).slice(-6), [
      "azure-cloud-patterns/DEVOS-NOTES.md",
      "azure-cloud-patterns/strangler-fig.md",
      "azure-cloud-patterns/anti-corruption-layer.md",
      "twelve-factor/DEVOS-NOTES.md",
      "twelve-factor/backing-services.md",
      "twelve-factor/processes.md",
    ]);
    assert.deepEqual(paths(record(dir, "T01", "blueprint")), [
      "azure-cloud-patterns/DEVOS-NOTES.md",
      "azure-cloud-patterns/strangler-fig.md",
      "azure-cloud-patterns/anti-corruption-layer.md",
      "twelve-factor/DEVOS-NOTES.md",
      "twelve-factor/intro.md",
      "twelve-factor/codebase.md",
      "twelve-factor/backing-services.md",
      "twelve-factor/processes.md",
      "twelve-factor/port-binding.md",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (e) scenario J: request logs and traces get the observability concepts and the logging rules", () => {
  const dir = project({
    stack: { id: "go-chi", toolchain: "go" },
    fences: { T01: "# T01 — Request logs\n\n- Layers: ops · backend\n\nAdd structured logs with a correlation id to every request, and export traces with OpenTelemetry.\n" },
  });
  try {
    const rec = record(dir, "T01");
    assert.deepEqual(rec.topics.map((item) => item.topic), ["logging", "observability"]);
    assert.deepEqual(rec.layers.all, ["backend", "security", "testing", "ops"]);
    assert.deepEqual(paths(rec), [
      ...SECURITY,
      "owasp-cheat-sheets/Injection_Prevention_Cheat_Sheet.md",
      "owasp-cheat-sheets/Logging_Cheat_Sheet.md",
      ...TOP10,
      ...TESTING,
      "twelve-factor/DEVOS-NOTES.md",
      "twelve-factor/logs.md",
      "opentelemetry-concepts/DEVOS-NOTES.md",
      "opentelemetry-concepts/observability-primer.md",
      "opentelemetry-concepts/signals/traces.md",
      "opentelemetry-concepts/signals/logs.md",
      "opentelemetry-concepts/signals/metrics.md",
    ]);
    assert.deepEqual(rec.not_selected.map((item) => item.id), ["supabase-postgres-best-practices", "supabase", "playwright-best-practices"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (f) the gates: server-side tasks get security, code tasks get testing, and nothing else does", () => {
  const dir = project({
    stack: { id: "hono", toolchain: "node" },
    fences: {
      T01: "# T01\n\n- Layers: reliability\n\nRetry a call.\n",
      T02: "# T02\n\n- Layers: architecture\n\nSplit a module.\n",
      T03: "# T03\n\n- Layers: ops\n\nTidy the build.\n",
      T04: "# T04\n\n- Layers: design\n\nPick a palette.\n",
      T05: "# T05\n\n- Surface: method — scripts/devos/x.mjs\n- Layers: backend · reliability\n",
      T06: "# T06\n\n- Layers: database · testing · security\n\nAdd a column.\n",
    },
  });
  try {
    const layers = (task) => skills(dir, ["layers", "--task", task]).trim();
    assert.equal(layers("T01"), "security reliability testing");
    assert.equal(layers("T02"), "architecture testing");
    assert.equal(layers("T03"), "ops");
    assert.equal(layers("T04"), "design");
    assert.equal(layers("T05"), "");
    assert.equal(layers("T06"), "database security testing");
    assert.deepEqual(record(dir, "T06").layers.added, []);
    assert.equal(skills(dir, ["select", "--task", "T05", "--role", "builder"]), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skills-layers.test.mjs (g) every new bundle is pinned, licensed, attributed and ships nothing it excludes", () => {
  const manifest = JSON.parse(readFileSync(path.join(skillsDir, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.layers), ["design", "motion", "frontend", "accessibility", "architecture", "backend", "api", "database", "security", "reliability", "testing", "ops"]);
  const byId = Object.fromEntries(manifest.entries.map((entry) => [entry.id, entry]));
  const pins = {
    superpowers: ["2ce8aa15d05bd57213e6f746f953aafb7ded7a8b", "v7.0.1", "MIT"],
    "playwright-best-practices": ["cfe490d941f992655948eee8fd4fd94e1c4234bf", "v1.64.1", "Apache-2.0"],
    "azure-cloud-patterns": ["b60c2b4526bab9b5e77cba2d779e695ed9d6ab9a", "", "CC-BY-4.0 AND MIT"],
    "twelve-factor": ["1385d2c80bac38c25647651f6f5ec769561828dc", "", "MIT"],
    "github-actions-security": ["02c25d16369fe27f9bdb28d1201f6b452f0d21dd", "", "CC-BY-4.0 AND MIT"],
    "opentelemetry-concepts": ["bb4e55d88ba78a18aa732e40a76cc0066cbab286", "", "CC-BY-4.0 AND Apache-2.0"],
  };
  for (const [id, [commit, tag, spdx]] of Object.entries(pins)) {
    const entry = byId[id];
    assert.equal(entry.delivery, "vendored", id);
    assert.equal(entry.source.commit, commit, id);
    assert.equal(entry.source.tag, tag, id);
    assert.equal(entry.licence.spdx, spdx, id);
    assert.equal(entry.trust.runs_code, false, id);
    assert.equal(entry.trust.fetches, false, id);
    assert.equal(entry.files.find((file) => file.path === entry.notes)?.origin, "devos", id);
    for (const notice of entry.licence.notices) assert.ok(existsSync(path.join(skillsDir, id, notice)), `${id}/${notice}`);
    for (const skipped of entry.excluded ?? []) assert.equal(existsSync(path.join(skillsDir, id, skipped.path)), false, `${id}/${skipped.path}`);
    if (spdx.startsWith("CC-BY")) {
      assert.equal(entry.licence.class, "conditions", id);
      const attribution = readFileSync(path.join(skillsDir, id, "ATTRIBUTION.md"), "utf8");
      assert.ok(attribution.includes(commit), id);
      assert.match(attribution, /\*\*Changes:\*\* none\./, id);
    } else {
      assert.equal(entry.licence.class, "free", id);
    }
  }
  assert.deepEqual(byId["playwright-best-practices"].stacks, ["node"]);
  assert.deepEqual(byId["playwright-best-practices"].licence.notices, ["NOTICE"]);
  assert.match(readFileSync(path.join(skillsDir, "superpowers", "LICENSE"), "utf8"), /^MIT License\n\nCopyright \(c\) 2025 Jesse Vincent\n/);
  assert.match(readFileSync(path.join(skillsDir, "twelve-factor", "LICENSE"), "utf8"), /^Copyright \(c\) 2012 Adam Wiggins\n/);
  assert.equal(readFileSync(path.join(skillsDir, "playwright-best-practices", "LICENSE"), "utf8").includes("\r"), false);
  assert.equal(byId["owasp-cheat-sheets"].files.filter((file) => file.path.endsWith("_Cheat_Sheet.md")).length, 26);
  for (const id of ["wshobson-slo-implementation", "wshobson-github-actions-templates"]) assert.equal(byId[id].delivery, "external", id);
});
