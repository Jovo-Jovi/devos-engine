import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { merge } from "../payload/files/scripts/devos/config.mjs";
import { smokeTarget } from "../payload/files/scripts/devos/probe.mjs";
import { previewBehindLogin } from "../payload/files/scripts/devos/doctor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = [/tower/i, /\bpilot\b/i, /\bADR-0\d\d\b/, /Jovo-Jovi/];

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function stage() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-settings-"));
  const result = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return dir;
}

function generate(dir, fixture) {
  writeJson(path.join(dir, "devos", "project.json"), readJson(fixture));
  const result = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function guard(dir, name) {
  const result = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", name, "--json"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail(result.stderr || result.stdout);
  }
  return parsed[name];
}

function seed(dir) {
  mkdirSync(path.join(dir, "src", "app"), { recursive: true });
  writeFileSync(path.join(dir, "src", "app", "page.tsx"), [
    'export const a = "https://github.com/a/b";',
    'export const b = "https://evil.example/x";',
    "",
  ].join("\n"));
  mkdirSync(path.join(dir, "src", "app", "notices"), { recursive: true });
  writeFileSync(path.join(dir, "src", "app", "notices", "page.tsx"), "export default function Page() { return null; }\n");
  writeJson(path.join(dir, "src", "i18n", "messages", "en.json"), { hello: "hello" });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "GLOSSARY.md"), "## 3. Forbidden nouns\n\n```\nnotices\n```\n");
}

test("project-settings.test.mjs tower and pilot merges carry the project settings", () => {
  const defaults = readJson("payload/files/devos/engine.defaults.json");
  const tower = merge(defaults, readJson("test/fixtures/tower-project.json"));
  assert.deepEqual(tower.guards.design.allowed_hosts, [
    "github.com",
    "avatars.githubusercontent.com",
    "token.actions.githubusercontent.com",
  ]);
  assert.equal(tower.deploy.probe, "production");
  assert.equal(tower.deploy.bypass, false);
  assert.deepEqual(tower.deploy.probe_paths, ["/"]);
  assert.equal(tower.deploy.production_url_fallback, "https://devos-control-tower.vercel.app");

  const pilot = merge(defaults, readJson("test/fixtures/pilot-project.json"));
  assert.deepEqual(pilot.guards.design.allowed_hosts, []);
  assert.deepEqual(pilot.guards.i18n.catalogues, {
    ar: "src/i18n/messages/ar.json",
    en: "src/i18n/messages/en.json",
  });
  assert.deepEqual(pilot.guards.naming.allow_routes, ["notices"]);
  assert.equal(pilot.deploy.probe, "deployment");
  assert.equal(pilot.deploy.bypass, true);
  assert.deepEqual(pilot.deploy.probe_paths, ["/", "/ar", "/en", "/fr"]);
});

test("project-settings.test.mjs staged guards follow the tower, the pilot, and the engine defaults", () => {
  const towerDir = stage();
  const pilotDir = stage();
  const fallbackDir = stage();
  try {
    generate(towerDir, "test/fixtures/tower-project.json");
    generate(pilotDir, "test/fixtures/pilot-project.json");
    for (const dir of [towerDir, pilotDir, fallbackDir]) seed(dir);

    const towerDesign = guard(towerDir, "design");
    assert.equal(towerDesign.findings.some((line) => line.includes("https://github.com/a/b")), false);
    assert.equal(towerDesign.findings.some((line) => line.includes("https://evil.example/x")), true);
    assert.equal(guard(towerDir, "i18n").status, "PASS");
    assert.equal(guard(towerDir, "naming").status, "FAIL");

    const pilotDesign = guard(pilotDir, "design");
    assert.equal(pilotDesign.findings.some((line) => line.includes("https://github.com/a/b")), true);
    assert.equal(guard(pilotDir, "i18n").status, "FAIL");
    assert.equal(guard(pilotDir, "i18n").findings.some((line) => line.includes("ar.json — missing catalogue")), true);
    assert.equal(guard(pilotDir, "naming").status, "PASS");

    const fallbackDesign = guard(fallbackDir, "design");
    assert.equal(fallbackDesign.findings.some((line) => line.includes("https://github.com/a/b")), true);
    assert.equal(guard(fallbackDir, "i18n").status, "PASS");
    assert.equal(guard(fallbackDir, "naming").status, "FAIL");
  } finally {
    rmSync(towerDir, { recursive: true, force: true });
    rmSync(pilotDir, { recursive: true, force: true });
    rmSync(fallbackDir, { recursive: true, force: true });
  }
});

test("project-settings.test.mjs smoke target, login preview, deploy workflow and setup ids", () => {
  assert.equal(smokeTarget({
    probe: "production",
    target: "production",
    productionUrl: "https://example.com",
    fallback: "https://fallback.example",
    deploymentUrl: "https://deploy.example",
  }), "https://example.com");
  assert.equal(smokeTarget({
    probe: "production",
    target: "production",
    productionUrl: "",
    fallback: "https://fallback.example",
    deploymentUrl: "https://deploy.example",
  }), "https://fallback.example");
  assert.equal(smokeTarget({
    probe: "deployment",
    target: "production",
    productionUrl: "https://example.com",
    fallback: "https://fallback.example",
    deploymentUrl: "https://deploy.example",
  }), "https://deploy.example");

  assert.deepEqual(previewBehindLogin(false), { level: "info", state: "behind the Vercel login (expected)" });
  assert.deepEqual(previewBehindLogin(true), { level: "warn", state: "behind the Vercel login" });

  const workflow = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-deploy.yml"), "utf8");
  assert.equal(workflow.includes("DEVOS_PRODUCTION_URL"), true);
  assert.equal(workflow.includes("deploy.probe_paths"), true);
  assert.equal(patterns.some((pattern) => pattern.test(workflow)), false);

  const setup = readJson("payload/files/devos/setup.json");
  const ids = setup.items.map((item) => item.id);
  for (const id of ["production-url", "vercel-bypass", "r2-secrets", "r2-var", "r2-vercel", "firebase-secrets", "firebase-var", "firebase-vercel"]) {
    assert.equal(ids.includes(id), true, id);
  }
  for (const id of ["tower-url", "github-webhook", "github-app-var"]) {
    assert.equal(ids.includes(id), false, id);
  }

  const pilot = readJson("dev/sources/pilot/devos/setup.json");
  for (const id of ["vercel-bypass", "r2-secrets", "r2-var", "r2-vercel", "firebase-secrets", "firebase-var", "firebase-vercel"]) {
    assert.deepEqual(setup.items.find((item) => item.id === id), pilot.items.find((item) => item.id === id));
  }
});

test("project-settings.test.mjs shipped text stays actionable", () => {
  const banned = [
    "reference project.",
    "control-reference",
    "devos-plan",
    "M0 capacity",
    "T01's review",
    "the reference project and the reference project",
  ];
  function walk(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...walk(abs));
      else found.push(abs);
    }
    return found;
  }
  const filesDir = path.join(root, "payload", "files");
  for (const file of walk(filesDir)) {
    const text = readFileSync(file, "utf8");
    for (const phrase of banned) assert.equal(text.includes(phrase), false, `${file} contains ${phrase}`);
  }
  const setup = readJson("payload/files/devos/setup.json");
  const pilot = readJson("dev/sources/pilot/devos/setup.json");
  for (const id of ["cursor", "claude", "pat-method", "vercel", "supabase-secrets", "supabase-var", "supabase-vercel"]) {
    assert.deepEqual(setup.items.find((item) => item.id === id), pilot.items.find((item) => item.id === id));
  }
});

test("project-settings.test.mjs specifics check prints 0 0", () => {
  const result = spawnSync(process.execPath, [path.join(root, "tools", "find-specifics.mjs"), "--check"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0 0");
});
