import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// PR-58: feature modules meet only at their public entries (guard:imports), and a task changes only the
// paths its fence names (guard:scope).
// Git 2.47 and later run their automatic maintenance in the background after a commit or a fetch, and it can still be
// writing into .git while a test removes its folder (ENOTEMPTY on the CI runner). Every git this file starts runs
// without it.
Object.assign(process.env, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "maintenance.auto", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0" });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");

function project(structure) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-structure-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  if (structure) {
    const projectPath = path.join(dir, "devos", "project.json");
    const data = JSON.parse(readFileSync(projectPath, "utf8"));
    data.structure = structure;
    writeFileSync(projectPath, `${JSON.stringify(data, null, 2)}\n`);
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(written.status, 0, written.stdout + written.stderr);
  }
  return dir;
}

function put(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
}

function guard(dir, name, env = {}) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", name, "--json"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, TASK: "", ...env } });
  return JSON.parse(run.stdout)[name];
}

function git(dir, args) {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return run.stdout;
}

const mod = (dir, entry) => ({ dir, public: [entry] });

test("guards-structure.test.mjs (a) guard:imports is N/A until a module is declared, and checks the declaration", () => {
  const none = project();
  const bad = project({ modules: { billing: { dir: "src/modules/billing", public: ["src/other/index.ts"] }, reports: { dir: "src/modules/reports" } } });
  try {
    assert.deepEqual(guard(none, "imports"), { status: "N/A", findings: [], note: "no module in devos.config.json structure.modules" });
    put(bad, { "src/modules/billing/total.ts": "export const total = 1;\n" });
    const result = guard(bad, "imports");
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.findings, [
      "structure.modules.billing: public entry src/other/index.ts is outside src/modules/billing",
      "structure.modules.reports: no public entry",
      "structure.modules.billing: public entry src/other/index.ts does not exist",
    ]);
  } finally {
    rmSync(none, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(bad, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("guards-structure.test.mjs (b) JavaScript and TypeScript: an alias, a relative path, export from, import() and require", () => {
  const dir = project({ modules: { billing: mod("src/modules/billing", "src/modules/billing/index.ts"), orders: mod("src/modules/orders", "src/modules/orders/index.ts"), reports: mod("src/modules/reports", "src/modules/reports/index.ts") } });
  try {
    put(dir, {
      "tsconfig.json": "{\n  // the alias Next.js writes\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./src/*\"] }, },\n}\n",
      "src/modules/billing/index.ts": "export { total } from \"./internal/total\";\n",
      "src/modules/billing/internal/total.ts": "export const total = 1;\n",
      "src/modules/billing/internal/rates.ts": "export const rate = 2;\n",
      "src/modules/orders/index.ts": "export * from \"./service\";\n",
      "src/modules/orders/service.ts": [
        "import { total } from \"@/modules/billing\";",
        "import { rate } from \"../billing/internal/rates\";",
        "export * from \"@/modules/billing/index\";",
        "// import { y } from \"@/modules/billing/internal/y\";",
        "const tax = await import(\"@/modules/billing/internal/tax.js\");",
        "export const order = total + rate + tax;",
      ].join("\n"),
      "src/modules/orders/service.test.ts": "import { rate } from \"@/modules/billing/internal/rates\";\n",
      "src/modules/reports/README.md": "Nothing yet.\n",
      "src/app/page.tsx": "import React from \"react\";\nimport type { Total } from \"@/modules/billing/internal/total\";\nimport { order } from \"@/modules/orders\";\n",
      "scripts/seed.cjs": "const { rate } = require(\"../src/modules/billing/internal/rates\");\n",
    });
    const result = guard(dir, "imports");
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.findings, [
      "structure.modules.reports: public entry src/modules/reports/index.ts does not exist",
      "scripts/seed.cjs:1 — imports ../src/modules/billing/internal/rates, inside module billing; import it through src/modules/billing/index.ts",
      "src/app/page.tsx:2 — imports @/modules/billing/internal/total, inside module billing; import it through src/modules/billing/index.ts",
      "src/modules/orders/service.ts:2 — imports ../billing/internal/rates, inside module billing; import it through src/modules/billing/index.ts",
      "src/modules/orders/service.ts:5 — imports @/modules/billing/internal/tax.js, inside module billing; import it through src/modules/billing/index.ts",
    ]);
    assert.equal(result.note, "3 of 3 module folder(s) present, 7 cross-module import(s) checked");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("guards-structure.test.mjs (c) Python: absolute, aliased and relative imports, a package import, and tests", () => {
  const dir = project({
    modules: { billing: mod("app/modules/billing", "app/modules/billing/__init__.py"), orders: mod("app/modules/orders", "app/modules/orders/__init__.py"), ledger: mod("src/shop/ledger", "src/shop/ledger/__init__.py") },
    aliases: { "shop.": "src/shop/" },
  });
  try {
    put(dir, {
      "app/modules/billing/__init__.py": "from .service import charge\n",
      "app/modules/billing/service.py": "def charge():\n    return 1\n",
      "app/modules/orders/__init__.py": "",
      "app/modules/orders/api.py": [
        "from app.modules.billing import charge",
        "from app.modules.billing.service import charge as direct  # the internals",
        "import os, app.modules.billing.service as svc",
        "from ..billing.service import charge as rel",
        "from . import helpers",
        "from shop.ledger.books import post",
        "from shop.ledger import post as ok",
      ].join("\n"),
      "app/modules/orders/helpers.py": "",
      "src/shop/ledger/__init__.py": "",
      "src/shop/ledger/books.py": "def post():\n    return 0\n",
      "tests/test_billing.py": "from app.modules.billing.service import charge\n",
    });
    const result = guard(dir, "imports");
    assert.deepEqual(result.findings, [
      "app/modules/orders/api.py:2 — imports app.modules.billing.service, inside module billing; import it through app/modules/billing/__init__.py",
      "app/modules/orders/api.py:3 — imports app.modules.billing.service, inside module billing; import it through app/modules/billing/__init__.py",
      "app/modules/orders/api.py:4 — imports ..billing.service, inside module billing; import it through app/modules/billing/__init__.py",
      "app/modules/orders/api.py:6 — imports shop.ledger.books, inside module ledger; import it through src/shop/ledger/__init__.py",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("guards-structure.test.mjs (d) Go and Dart: a module's package, its subpackages, package: and relative imports", () => {
  const go = project({ modules: { billing: mod("internal/billing", "internal/billing"), orders: mod("internal/orders", "internal/orders") } });
  const dart = project({ modules: { billing: mod("lib/features/billing", "lib/features/billing/billing.dart"), orders: mod("lib/features/orders", "lib/features/orders/orders.dart") } });
  try {
    put(go, {
      "go.mod": "module example.com/shop\n\ngo 1.23\n",
      "internal/billing/billing.go": "package billing\n",
      "internal/billing/store/store.go": "package store\n",
      "internal/orders/orders.go": "package orders\n\nimport (\n\t\"fmt\"\n\t\"example.com/shop/internal/billing\"\n\tst \"example.com/shop/internal/billing/store\"\n)\n",
      "internal/orders/orders_test.go": "package orders\n\nimport \"example.com/shop/internal/billing/store\"\n",
      "cmd/api/main.go": "package main\n\nimport \"example.com/shop/internal/orders\"\n",
    });
    assert.deepEqual(guard(go, "imports").findings, [
      "internal/orders/orders.go:6 — imports example.com/shop/internal/billing/store, inside module billing; import it through internal/billing",
    ]);
    put(dart, {
      "pubspec.yaml": "name: shop\n",
      "lib/features/billing/billing.dart": "export 'src/rates.dart';\n",
      "lib/features/billing/src/rates.dart": "const rate = 2;\n",
      "lib/features/orders/orders.dart": [
        "import 'package:flutter/material.dart';",
        "import 'package:shop/features/billing/billing.dart';",
        "import 'package:shop/features/billing/src/rates.dart';",
        "import '../billing/src/rates.dart';",
      ].join("\n"),
    });
    assert.deepEqual(guard(dart, "imports").findings, [
      "lib/features/orders/orders.dart:3 — imports package:shop/features/billing/src/rates.dart, inside module billing; import it through lib/features/billing/billing.dart",
      "lib/features/orders/orders.dart:4 — imports ../billing/src/rates.dart, inside module billing; import it through lib/features/billing/billing.dart",
    ]);
  } finally {
    rmSync(go, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(dart, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const FENCE = (paths, extra = "") => `## T07 — Invoices\n\n- Builder: grok-4.7 · Effort: high · Fast: no\n- Layers: backend\n${extra}${paths === null ? "" : `- Paths: ${paths}\n`}\n### Done when\n\n- D1. Tests pass.\n\n### Do NOT\n\n- Run git.\n`;

function branch(dir, fence) {
  put(dir, { "docs/fences/T07.md": fence, "src/modules/orders/old.ts": "export {};\n" });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  // The base the guard compares with, without a fetch.
  git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(dir, ["switch", "-q", "-c", "task/T07"]);
}

test("guards-structure.test.mjs (e) guard:scope: the branch and the working tree change only the fence's paths", () => {
  const dir = project();
  try {
    branch(dir, FENCE("`src/modules/billing/**` · `package.json`"));
    put(dir, {
      "src/modules/billing/a.ts": "export const a = 1;\n",
      "package.json": "{ \"name\": \"shop\" }\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "docs/reports/T07.md": "## Attempt 1\n",
      "docs/reviews/T07-a1.md": "VERDICT: FAIL\n",
      "src/modules/orders/b.ts": "export const b = 2;\n",
    });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), `${readFileSync(path.join(dir, "docs", "PHASES.md"), "utf8")}\n`);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "T07 a1: builder"]);
    put(dir, { "src/modules/billing/c.ts": "export const c = 3;\n", "README.md": "# Shop\n" });
    assert.deepEqual(guard(dir, "scope"), { status: "N/A", findings: [], note: "no task in this run" });
    const result = guard(dir, "scope", { TASK: "T07" });
    assert.deepEqual(result, {
      status: "FAIL",
      findings: ["README.md — outside the Paths of docs/fences/T07.md", "src/modules/orders/b.ts — outside the Paths of docs/fences/T07.md"],
      note: "7 changed path(s), 2 Paths entries in docs/fences/T07.md",
    });
    rmSync(path.join(dir, "README.md"));
    git(dir, ["rm", "-q", "src/modules/orders/b.ts"]);
    git(dir, ["commit", "-q", "-m", "T07 a2: builder"]);
    assert.deepEqual(guard(dir, "scope", { TASK: "T07" }), { status: "PASS", findings: [], note: "5 changed path(s), 2 Paths entries in docs/fences/T07.md" });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("guards-structure.test.mjs (f) guard:scope: a lockfile needs its manifest, a fence without Paths is N/A, a method fix keeps to method files", () => {
  const dir = project();
  try {
    branch(dir, FENCE("`src/modules/billing/**`"));
    put(dir, { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
    assert.deepEqual(guard(dir, "scope", { TASK: "T07" }).findings, ["pnpm-lock.yaml — outside the Paths of docs/fences/T07.md"]);
    put(dir, { "docs/fences/T07.md": FENCE(null) });
    assert.deepEqual(guard(dir, "scope", { TASK: "T07" }), { status: "N/A", findings: [], note: "docs/fences/T07.md has no - Paths: line" });
    rmSync(path.join(dir, "pnpm-lock.yaml"));
    put(dir, {
      "docs/fences/T07.md": FENCE("`scripts/devos/verdict.mjs` · `docs/method/AUTOMATION.md`", "- Surface: method — scripts/devos/verdict.mjs\n"),
      "scripts/devos/verdict.mjs": "// fixed\n",
      "src/modules/orders/old.ts": "export const changed = true;\n",
    });
    assert.deepEqual(guard(dir, "scope", { TASK: "T07" }), { status: "PASS", findings: [], note: "1 changed path(s), 2 Paths entries in docs/fences/T07.md" });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("guards-structure.test.mjs (g) every stack has a module convention inside its own folder", async () => {
  const { loadCatalogue } = await import("../lib/catalogue.mjs");
  for (const stack of loadCatalogue().stacks) {
    const modules = stack.scaffold.modules;
    assert.equal(modules.dir.includes("<name>"), true, stack.id);
    assert.equal(modules.public.length > 0 && modules.public.every((entry) => entry === modules.dir || entry.startsWith(`${modules.dir}/`)), true, stack.id);
  }
});
