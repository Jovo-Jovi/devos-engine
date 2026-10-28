import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "devos-install-"));
}

function devos(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function relativeFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs).split(path.sep).join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  out.sort();
  return out;
}

function failNames(stdout) {
  return stdout.split(/\r?\n/).filter((line) => /^guard:\S+\s+FAIL/.test(line)).map((line) => line.slice("guard:".length).trim().split(/\s+/)[0]);
}

function writeFixtures(folder) {
  const docs = path.join(folder, "docs");
  mkdirSync(docs, { recursive: true });
  for (const name of ["PHASES.md", "GLOSSARY.md"]) {
    writeFileSync(path.join(docs, name), readFileSync(path.join(root, "test", "fixtures", "docs", name)));
  }
}

test("install.test.mjs installs into an empty folder", () => {
  const folder = tempDir();
  try {
    const result = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8"));
    assert.equal(result.stdout.includes(`devos install 1.3.1: ${manifest.files.length} engine files, 4 templates, devos.config.json written`), true, result.stdout);
    const lock = JSON.parse(readFileSync(path.join(folder, "devos", "engine.lock.json"), "utf8"));
    assert.equal(lock.files.length, manifest.files.length);
    assert.deepEqual(
      lock.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      manifest.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    );
    const project = JSON.parse(readFileSync(path.join(folder, "devos", "project.json"), "utf8"));
    assert.equal(project.project, "DEMO");
    assert.equal(existsSync(path.join(folder, "devos.config.json")), true);
  } finally {
    cleanup(folder);
  }
});

test("install.test.mjs bare install fails phases and naming", () => {
  const folder = tempDir();
  try {
    const installed = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], {
      cwd: folder,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(guards.status, 1);
    assert.deepEqual(failNames(guards.stdout), ["phases", "naming"]);
  } finally {
    cleanup(folder);
  }
});

test("install.test.mjs fixture docs make every guard pass", () => {
  const folder = tempDir();
  try {
    const installed = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    writeFixtures(folder);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], {
      cwd: folder,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(guards.status, 0, guards.stdout);
    assert.equal(guards.stdout.includes("1 tasks, 0 PASS"), true, guards.stdout);
    assert.equal(failNames(guards.stdout).length, 0);
  } finally {
    cleanup(folder);
  }
});

test("install.test.mjs a second install is refused", () => {
  const folder = tempDir();
  try {
    const first = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const second = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(second.status, 1);
    assert.equal(second.stdout.includes("devos: already installed (engine 1.3.1); run devos upgrade"), true, second.stdout);
  } finally {
    cleanup(folder);
  }
});

test("install.test.mjs refuses a different gitignore and writes nothing", () => {
  const folder = tempDir();
  try {
    writeFileSync(path.join(folder, ".gitignore"), "different\n");
    const before = relativeFiles(folder);
    const beforeBytes = readFileSync(path.join(folder, ".gitignore"));
    const result = devos(["install", folder, "--key", "DEMO"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes("devos: exists: .gitignore"), true, result.stdout);
    assert.equal(result.stdout.includes("devos: install refused (1 existing files differ)"), true, result.stdout);
    assert.deepEqual(relativeFiles(folder), before);
    assert.equal(readFileSync(path.join(folder, ".gitignore")).equals(beforeBytes), true);
  } finally {
    cleanup(folder);
  }
});

test("install.test.mjs rejects a lowercase key", () => {
  const folder = tempDir();
  try {
    const result = devos(["install", folder, "--key", "demo"]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.includes("devos: --key must match ^[A-Z][A-Z0-9-]{1,31}$"), true, result.stdout);
    assert.deepEqual(relativeFiles(folder), []);
  } finally {
    cleanup(folder);
  }
});
