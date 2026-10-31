import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, stage } from "./harness.mjs";
import { surveyLines, surveyProject } from "../lib/adopt.mjs";
import { hubExec } from "../lib/hub.mjs";

// E33 (D-E13): devos adopt --check surveys an existing project and changes nothing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const IDENTITY = ["-c", "user.name=Devos Test", "-c", "user.email=devos@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"];

function git(args, cwd) {
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function write(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    const abs = path.join(dir, ...file.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}

/** A git repository with `files` committed, then `extra` empty commits, `tags`, and an origin. */
function project(files, { dir, extra = 0, tags = [], origin = "https://github.com/devtest/demo-app.git" } = {}) {
  const folder = dir ?? mkdtempSync(path.join(tmpdir(), "devos-adopt-"));
  mkdirSync(folder, { recursive: true });
  write(folder, files);
  git(["init", "-q", "-b", "main"], folder);
  git(["add", "-A"], folder);
  git(["commit", "-q", "-m", "first"], folder);
  for (let i = 0; i < extra; i += 1) git(["commit", "-q", "--allow-empty", "-m", `change ${i + 1}`], folder);
  for (const tag of tags) git(["tag", tag], folder);
  if (origin) git(["remote", "add", "origin", origin], folder);
  return folder;
}

/** git runs for real; gh answers like GitHub for a repository the account administers, and logs every call. */
function fakeGh({ permission = "ADMIN", view = true, variables = [], calls = [] } = {}) {
  return (cmd, args, cwd) => {
    if (cmd !== "gh") return hubExec(cmd, args, cwd);
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "repo" && args[1] === "view") {
      if (!view) return { status: 1, stdout: "" };
      return { status: 0, stdout: JSON.stringify({ nameWithOwner: args[2], viewerPermission: permission, visibility: "PRIVATE", defaultBranchRef: { name: "main" } }) };
    }
    if (args[0] === "pr" && args[1] === "list") return { status: 0, stdout: JSON.stringify([{ number: 3 }, { number: 4 }]) };
    if (args[0] === "variable" && args[1] === "list") return { status: 0, stdout: JSON.stringify(variables) };
    return { status: 1, stdout: "" };
  };
}

const NEXT_APP = {
  "package.json": JSON.stringify({
    name: "demo-app",
    private: true,
    scripts: { build: "next build", lint: "next lint", test: "vitest run" },
    dependencies: { next: "15.0.0", react: "19.0.0", "@supabase/supabase-js": "2.0.0", stripe: "17.0.0", "@sentry/nextjs": "8.0.0" },
    devDependencies: { typescript: "5.6.0", vitest: "2.0.0", "@playwright/test": "1.48.0" },
  }, null, 2),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "tsconfig.json": "{}\n",
  "app/page.tsx": "export default function Page() {\n  return null;\n}\n",
  "src/lib/pay.test.ts": "import { test } from \"vitest\";\ntest(\"pay\", () => {});\n",
  ".github/workflows/ci.yml": "name: ci\non: push\njobs: {}\n",
  ".github/workflows/deploy.yml": "name: deploy\non: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vercel deploy --prod\n",
  ".gitignore": "node_modules\n.env\n",
  "CLAUDE.md": "# Our own notes\n",
};

test("adopt.test.mjs (a) a Next.js project that deploys and has a release is surveyed as production", () => {
  const calls = [];
  const folder = project(NEXT_APP, { tags: ["v1.0.0"] });
  try {
    const survey = surveyProject(folder, { exec: fakeGh({ calls }) });
    assert.equal(survey.schema, "devos-survey/1");
    assert.deepEqual(survey.stage, { value: "production", reasons: ["deploys to vercel", "1 tag, latest v1.0.0", "1 commit", "tests and CI"] });
    assert.equal(survey.stack.catalogue_stack, "next");
    assert.equal(survey.stack.package_manager, "pnpm");
    assert.equal(survey.stack.typescript, true);
    assert.deepEqual(survey.stack.test_runners, ["playwright", "vitest"]);
    assert.deepEqual(survey.modules, { database: ["supabase"], payments: ["stripe"], observability: ["sentry"] });
    assert.deepEqual(survey.automation, { workflows: ["ci.yml", "deploy.yml"], deploy: ["vercel"], deploy_workflows: ["deploy.yml"] });
    assert.deepEqual(survey.collisions.engine.filter((entry) => [".github/workflows/ci.yml", ".gitignore"].includes(entry.path)), [
      { path: ".github/workflows/ci.yml", same: false },
      { path: ".gitignore", same: false },
    ]);
    assert.deepEqual(survey.collisions.documents, ["CLAUDE.md"]);
    assert.equal(survey.devos.kind, "none");
    assert.equal(survey.repository.slug, "devtest/demo-app");
    assert.equal(survey.repository.permission, "ADMIN");
    assert.equal(survey.repository.default_branch, "main");
    assert.equal(survey.repository.open_pull_requests, 2);
    assert.equal(survey.repository.contributors, 1);
    assert.deepEqual(survey.blockers, []);
    assert.equal(survey.ready, true);
    assert.deepEqual(calls, ["repo view", "variable list", "pr list"]);
    assert.equal(git(["status", "--porcelain"], folder), "");
  } finally {
    cleanup(folder);
  }
});

test("adopt.test.mjs (b) only an example environment file is read, and only its names", () => {
  const folder = project({
    "package.json": "{\"name\":\"demo\"}\n",
    ".gitignore": ".env\n",
    ".env.example": "API_KEY=example-value-xyz\nexport DB_URL=postgres://u:p@h/db\n# COMMENTED=1\n",
    ".env.local": "LOCAL_ONLY=secret-local-123\n",
  });
  try {
    writeFileSync(path.join(folder, ".env"), "SECRET=untracked-secret-456\n");
    const survey = surveyProject(folder, { exec: fakeGh() });
    assert.deepEqual(survey.env_names, ["API_KEY", "DB_URL"]);
    assert.deepEqual(survey.env_sources, [".env.example"]);
    const text = `${JSON.stringify(survey)}\n${surveyLines(survey).join("\n")}`;
    for (const value of ["example-value-xyz", "postgres://", "secret-local-123", "LOCAL_ONLY", "untracked-secret-456"]) {
      assert.equal(text.includes(value), false, value);
    }
    assert.equal(survey.ready, true);
  } finally {
    cleanup(folder);
  }
});

test("adopt.test.mjs (c) each thing that stops an adoption is named, and nothing is changed", () => {
  const folders = [];
  try {
    const dirty = project({ "package.json": "{}\n" });
    folders.push(dirty);
    writeFileSync(path.join(dirty, "package.json"), "{\"changed\":true}\n");
    const cases = [
      [dirty, {}, "it has uncommitted changes; commit or stash them first"],
      [project({ "a.txt": "a\n" }, { origin: "https://gitlab.com/devtest/demo-app.git" }), {}, "its origin is not a GitHub repository; adopt works on a project that is on GitHub"],
      [project({ "a.txt": "a\n" }), { permission: "WRITE" }, "your gh account must own or administer devtest/demo-app; it has write access"],
      [project({ "a.txt": "a\n" }), { view: false }, "gh could not read devtest/demo-app; sign in with gh auth login, or check the repository"],
      [project({ "devos/engine.lock.json": "{\"engine_version\":\"1.2.1\"}\n" }), {}, "it is already a DEV_OS project (engine 1.2.1); open it as a current project, or run devos upgrade in it"],
    ];
    for (const [folder, options, blocker] of cases) {
      if (!folders.includes(folder)) folders.push(folder);
      const head = git(["rev-parse", "HEAD"], folder);
      const status = git(["status", "--porcelain"], folder);
      const survey = surveyProject(folder, { exec: fakeGh(options) });
      assert.deepEqual(survey.blockers, [blocker]);
      assert.equal(survey.ready, false);
      assert.equal(surveyLines(survey).at(-1), `Ready: no — ${blocker}. Nothing was changed.`);
      assert.equal(git(["rev-parse", "HEAD"], folder), head);
      assert.equal(git(["status", "--porcelain"], folder), status);
    }
  } finally {
    for (const folder of folders) cleanup(folder);
  }
});

test("adopt.test.mjs (d) an older copy of DEV_OS is recognised, and its own workflows are not read as deploys", () => {
  const folder = project({
    "package.json": "{\"name\":\"tower\",\"dependencies\":{\"next\":\"15.0.0\"}}\n",
    "scripts/devos/runner.mjs": "export {};\n",
    ".github/workflows/devos-cycle.yml": "name: devos-cycle\non: push\njobs: {}\n# firebase deploy --only firestore:rules\n# npx vercel build\n",
    "docs/method/PRECEDENTS.md": "# Precedents\n\nIds are allocated from the live maximum. **Live maximum: PR-39.**\n",
    "docs/PHASES.md": "# Phases\n",
  });
  try {
    const survey = surveyProject(folder, { exec: fakeGh({ variables: [{ name: "DEVOS_VERCEL", value: "true" }, { name: "DEVOS_FIREBASE", value: "false" }] }) });
    assert.equal(survey.devos.kind, "copy");
    assert.equal(survey.devos.precedents_max, "PR-39");
    assert.deepEqual(survey.devos.markers, ["scripts/devos", ".github/workflows/devos-cycle.yml", "docs/method/PRECEDENTS.md"]);
    assert.deepEqual(survey.repository.devos_variables, ["DEVOS_VERCEL"]);
    assert.deepEqual(survey.automation.deploy, ["vercel"]);
    assert.deepEqual(survey.automation.deploy_workflows, []);
    assert.deepEqual(survey.collisions.documents, ["docs/PHASES.md"]);
    assert.deepEqual(survey.notes, ["it runs an older copy of DEV_OS (precedents up to PR-39, no engine lock): adopting it keeps its documents and settings"]);
    assert.equal(survey.ready, true);
  } finally {
    cleanup(folder);
  }
});

test("adopt.test.mjs (e) a small Python API with no tests or CI is a prototype", () => {
  const folder = project({
    "pyproject.toml": "[project]\nname = \"demo-api\"\ndependencies = [\"fastapi>=0.110\", \"uvicorn[standard]\"]\n",
    "app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n",
  }, { extra: 2 });
  try {
    const survey = surveyProject(folder, { exec: fakeGh() });
    assert.equal(survey.stack.toolchain, "python");
    assert.deepEqual(survey.stack.frameworks, ["fastapi"]);
    assert.equal(survey.stack.catalogue_stack, "fastapi");
    assert.deepEqual(survey.modules, {});
    assert.deepEqual(survey.stage, { value: "prototype", reasons: ["3 commits", "no tests or CI"] });
    assert.deepEqual(survey.languages, [{ ext: "py", files: 1 }]);
    assert.equal(survey.size.code_lines, 3);
  } finally {
    cleanup(folder);
  }
});

test("adopt.test.mjs (f) devos adopt --check prints the survey, --json gives the same survey, and nothing changes", () => {
  const staged = stage();
  try {
    const folder = project(NEXT_APP, { dir: staged.project });
    const env = { ...staged.env, STUB_REPO: "full" };
    const runDevos = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", windowsHide: true, timeout: 120000, env });
    const head = git(["rev-parse", "HEAD"], folder);
    const shown = runDevos(["adopt", "--check", folder]);
    assert.equal(shown.status, 0, shown.stdout + shown.stderr);
    const out = shown.stdout.trimEnd().split(/\r?\n/);
    assert.equal(out[0], "devos adopt --check · devtest/demo-app");
    assert.equal(out[1], "Stage: in-development — deploys to vercel; 1 commit; tests and CI");
    assert.equal(out[2], "Stack: Next.js (App Router, TypeScript) (next) · pnpm · TypeScript · tests: playwright, vitest");
    assert.equal(out[3], "Modules: database supabase · payments stripe · observability sentry");
    assert.equal(out[4], "Automation: 2 workflows (ci.yml, deploy.yml) · deploy: vercel");
    assert.equal(out[5], "DEV_OS: none");
    assert.match(out[6], /^Overlaps: \d+ engine files exist \(\d+ differs?\) · 1 project document exists \(CLAUDE\.md\)$/);
    assert.equal(out[7], "Environment names: 0");
    assert.match(out[8], /^Size: 9 files, \d+ lines of code · 1 commit from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d · 1 contributor · open pull requests unknown$/);
    assert.equal(out.at(-1), "Ready: yes. Nothing was changed.");
    const json = runDevos(["adopt", "--check", folder, "--json"]);
    assert.equal(json.status, 0, json.stderr);
    const survey = JSON.parse(json.stdout);
    assert.equal(survey.schema, "devos-survey/1");
    assert.equal(survey.stage.value, "in-development");
    assert.equal(survey.ready, true);
    assert.equal(git(["rev-parse", "HEAD"], folder), head);
    assert.equal(git(["status", "--porcelain", "--ignored"], folder), "");
    const usage = runDevos(["adopt"]);
    assert.equal(usage.status, 2);
    assert.equal(usage.stdout.startsWith("usage: devos adopt --check [folder] [--json]\n"), true, usage.stdout);
    const loose = runDevos(["adopt", "--check", staged.parent]);
    assert.equal(loose.status, 1);
    assert.equal(loose.stdout, `devos: ${staged.parent} is not a git repository; run devos adopt --check in the project's own clone\n`);
  } finally {
    cleanup(staged.parent);
  }
});
