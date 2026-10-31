// E33 (D-E13): adopting an existing project starts with a survey. `devos adopt --check [folder]` reads the project's
// own clone and its GitHub repository and changes nothing: it writes no file, makes no branch, and sends nothing.
// It reads only tracked files, and never an environment file other than an example one (.env.example, .env.sample,
// .env.template, .env.dist), whose variable names alone are kept. Values are never read into the survey. From
// GitHub it reads the repository's permission, visibility, default branch and open pull requests, and of its
// variables it keeps only DEV_OS's four module switches. Author emails are counted, never kept.
//
// E34: `devos adopt [folder]` then has the developer's own AI tool write a brief of the project, for the developer
// to confirm or correct. The tool works in a staging folder under ~/.devos/adopt/, outside the project, on a copy of
// the tracked files: it never runs in the project, and the project's HEAD and status are checked unchanged after
// every round. The confirmed brief stays in the staging folder; nothing is added to the project yet.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { loadCatalogue } from "./catalogue.mjs";
import { engineRoot, engineVersion, hashFile, insideEngine, LOCK, normalizeLf, readManifest, sha256Hex, writeLock } from "./engine.mjs";
import { hubExec } from "./hub.mjs";
import { agentText, BLUEPRINT_TOOLS, blueprintArgs, blueprintEnv, engineDefaults, modelOptions, runToolRound, STREAMING, toolCommand } from "./init.mjs";
import { KEY_RE, keyFromName, templateWrites } from "./install.mjs";
import { lineReader } from "./menu.mjs";
import { slugFromRemote } from "./models.mjs";
import { toInstalled } from "./paths.mjs";
import { detectAgents } from "./probes.mjs";
import { devosHome } from "./profile.mjs";

export const SURVEY_SCHEMA = "devos-survey/1";
export const BRIEF_SCHEMA = "devos-brief/1";
const USAGE = "usage: devos adopt [folder] [--install] [--agent <tool>[:<model>]] · devos adopt --check [folder] [--json]";
const ADOPT_POINTER = "Read the file adopt-input.md in this folder and do exactly what it says.";
const NEXT_POINTER = "Read the file adopt-next.md in this folder and do exactly what it says.";
const MAX_ROUNDS = 5;
const MAX_COPY_BYTES = 300 * 1024 * 1024;
const MAX_COPY_FILE = 10 * 1024 * 1024;
export const BRIEF_HEADINGS = [
  "## What it is",
  "## Stage",
  "## How it is built",
  "## What is done",
  "## What is open",
  "## Risks",
  "## Personal data",
  "## What DEV_OS will add",
  "## Questions for you",
];
const STAGES = ["prototype", "in-development", "production"];
const MAX_READ_BYTES = 1024 * 1024;
const MAX_LINE_FILES = 20000;
const MAX_PACKAGE_FILES = 50;

// The project documents DEV_OS writes or the runner gives an agent: an existing one is listed, never overwritten.
export const PROJECT_DOCUMENTS = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "SETUP.md",
  "docs/BOUNDARY_MODEL.md",
  "docs/CONTENT_MODEL.md",
  "docs/DATA_MODEL.md",
  "docs/DECISIONS.md",
  "docs/DESIGN_SYSTEM.md",
  "docs/DEVELOPMENT_JOURNAL.md",
  "docs/DEVOS_FIT.md",
  "docs/GLOSSARY.md",
  "docs/I18N_MODEL.md",
  "docs/PHASES.md",
  "docs/PRODUCT_BRIEF.md",
  "docs/SCOPE.md",
  "docs/SECURITY_MODEL.md",
  "docs/SESSION_CONTEXT.md",
  "docs/STACK.md",
  "docs/fences",
  "docs/method/CARRY_FORWARDS.md",
  "docs/reviews",
];

// Frameworks from package names, in the order a catalogue stack is chosen (the first that matches).
const FRAMEWORKS = [
  ["starlight", (deps) => deps.has("@astrojs/starlight")],
  ["next", (deps) => deps.has("next")],
  ["nuxt", (deps) => deps.has("nuxt")],
  ["sveltekit", (deps) => deps.has("@sveltejs/kit")],
  ["remix", (deps) => deps.has("@remix-run/react") || deps.has("@remix-run/node")],
  ["astro", (deps) => deps.has("astro")],
  ["solid", (deps) => deps.has("@solidjs/start")],
  ["expo", (deps) => deps.has("expo")],
  ["nest", (deps) => deps.has("@nestjs/core")],
  ["hono", (deps) => deps.has("hono")],
  ["fastify", (deps) => deps.has("fastify")],
  ["vite-react", (deps) => deps.has("vite") && deps.has("react")],
  ["vite-vue", (deps) => deps.has("vite") && deps.has("vue")],
  ["express", (deps) => deps.has("express")],
  ["react", (deps) => deps.has("react")],
  ["vue", (deps) => deps.has("vue")],
  ["fastapi", (deps) => deps.has("fastapi")],
  ["django", (deps) => deps.has("django")],
  ["flask", (deps) => deps.has("flask")],
  ["go-chi", (deps) => deps.has("github.com/go-chi/chi") || deps.has("github.com/go-chi/chi/v5")],
  ["flutter", (deps) => deps.has("flutter")],
];

// The project's services, by module, from package names and files (a provider id of the catalogue where one fits).
const MODULES = [
  ["database", "supabase", (deps, files) => deps.has("@supabase/supabase-js") || deps.has("@supabase/ssr") || deps.has("supabase") || files.has("supabase/config.toml")],
  ["database", "firebase", (deps) => deps.has("firebase") || deps.has("firebase-admin")],
  ["database", "prisma", (deps) => deps.has("@prisma/client") || deps.has("prisma")],
  ["database", "drizzle", (deps) => deps.has("drizzle-orm")],
  ["database", "mongodb", (deps) => deps.has("mongodb") || deps.has("mongoose")],
  ["database", "postgres", (deps) => deps.has("pg") || deps.has("postgres") || deps.has("psycopg") || deps.has("psycopg2")],
  ["database", "sqlalchemy", (deps) => deps.has("sqlalchemy")],
  ["storage", "s3", (deps) => deps.has("@aws-sdk/client-s3") || deps.has("boto3")],
  ["storage", "vercel-blob", (deps) => deps.has("@vercel/blob")],
  ["auth", "auth.js", (deps) => deps.has("next-auth") || deps.has("@auth/core")],
  ["auth", "clerk", (deps) => startsWith(deps, "@clerk/")],
  ["auth", "better-auth", (deps) => deps.has("better-auth")],
  ["auth", "lucia", (deps) => deps.has("lucia")],
  ["payments", "stripe", (deps) => deps.has("stripe") || deps.has("@stripe/stripe-js")],
  ["payments", "paddle", (deps) => startsWith(deps, "@paddle/")],
  ["payments", "lemonsqueezy", (deps) => startsWith(deps, "@lemonsqueezy/")],
  ["payments", "paypal", (deps) => startsWith(deps, "@paypal/")],
  ["payments", "revenuecat", (deps) => deps.has("react-native-purchases")],
  ["email", "resend", (deps) => deps.has("resend")],
  ["email", "postmark", (deps) => deps.has("postmark")],
  ["email", "ses", (deps) => deps.has("@aws-sdk/client-ses") || deps.has("@aws-sdk/client-sesv2")],
  ["email", "nodemailer", (deps) => deps.has("nodemailer")],
  ["jobs", "bullmq", (deps) => deps.has("bullmq")],
  ["jobs", "upstash-redis", (deps) => deps.has("@upstash/redis") || deps.has("@upstash/qstash")],
  ["search", "meilisearch", (deps) => deps.has("meilisearch")],
  ["product-ai", "ai-sdk", (deps) => deps.has("ai") || startsWith(deps, "@ai-sdk/") || deps.has("openai") || deps.has("@anthropic-ai/sdk") || deps.has("anthropic")],
  ["observability", "sentry", (deps) => startsWith(deps, "@sentry/") || deps.has("sentry-sdk")],
  ["observability", "structured-logs", (deps) => deps.has("pino") || deps.has("winston")],
];

// Where the project is deployed, from the files that configure it (file names only).
const DEPLOY_FILES = [
  ["vercel.json", "vercel"],
  [".vercel/project.json", "vercel"],
  ["netlify.toml", "netlify"],
  ["fly.toml", "fly"],
  ["render.yaml", "render"],
  ["firebase.json", "firebase"],
  ["wrangler.toml", "cloudflare"],
  ["wrangler.jsonc", "cloudflare"],
  ["app.yaml", "app-engine"],
  ["Procfile", "heroku"],
  ["serverless.yml", "serverless"],
];

// Where a workflow deploys to, from the tools it runs.
const DEPLOY_STEPS = [
  [/\bvercel\b/i, "vercel"],
  [/\bnetlify\b/i, "netlify"],
  [/\bflyctl\b|superfly\//i, "fly"],
  [/\bwrangler\b|cloudflare\/(?:wrangler|pages)-action/i, "cloudflare"],
  [/firebase(?:-tools)?\s+deploy|action-hosting-deploy/i, "firebase"],
  [/actions-gh-pages|actions\/deploy-pages/i, "github-pages"],
  [/docker\/build-push-action|docker\s+push/i, "docker"],
  [/railway\s+up/i, "railway"],
  [/aws-actions\/|aws\s+s3\s+sync|serverless\s+deploy/i, "aws"],
  [/google-github-actions\/deploy|gcloud\s+(?:app|run)\s+deploy/i, "gcp"],
  [/\bheroku\b/i, "heroku"],
  [/\beas\s+(?:build|update|submit)\b|expo-github-action/i, "expo"],
];

const CODE_EXTENSIONS = new Set([
  "astro", "c", "cjs", "cpp", "cs", "css", "dart", "go", "h", "html", "java", "js", "jsx", "kt", "mjs", "php", "py",
  "rb", "rs", "scss", "sql", "svelte", "swift", "ts", "tsx", "vue",
]);

const ENV_EXAMPLE = /^\.env\.(example|sample|template|dist)$/;
// Never read and never copied: environment files other than an example one, and private keys. An AI tool sends what
// it reads to its provider, so a secret a project tracks by mistake must not reach it (E34).
const SECRET_FILES = [/^\.env(\..+)?$/, /\.(pem|key|p12|pfx|jks|keystore)$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/];

/** True for a tracked file DEV_OS never reads or copies: an environment file other than an example, or a key. */
export function secretFile(file) {
  const base = path.posix.basename(file);
  if (ENV_EXAMPLE.test(base)) return false;
  return SECRET_FILES.some((pattern) => pattern.test(base));
}

function startsWith(deps, prefix) {
  for (const name of deps) if (name.startsWith(prefix)) return true;
  return false;
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function lines(text) {
  return String(text ?? "").split(/\r?\n/).filter((line) => line !== "");
}

function ok(result) {
  return Boolean(result) && result.status === 0;
}

function readSmall(abs) {
  try {
    if (statSync(abs).size > MAX_READ_BYTES) return null;
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) return null;
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

function readJson(abs) {
  const text = readSmall(abs);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function samePath(a, b) {
  let left;
  let right;
  try {
    left = realpathSync.native(a);
    right = realpathSync.native(b);
  } catch {
    return false;
  }
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** The git top of `folder`: { top } when `folder` is the top of a work tree, else { error }. */
export function gitTop(folder, exec = hubExec) {
  const top = exec("git", ["rev-parse", "--show-toplevel"], folder);
  if (!ok(top)) return { error: `devos: ${folder} is not a git repository; run devos adopt --check in the project's own clone` };
  const value = top.stdout.trim();
  if (!samePath(value, folder)) return { error: `devos: ${folder} is inside a git repository whose top is ${path.resolve(value)}; run it there` };
  return { top: folder };
}

function repositoryFacts(folder, exec) {
  const slug = slugFromRemote(exec("git", ["remote", "get-url", "origin"], folder)?.stdout);
  const status = exec("git", ["status", "--porcelain"], folder);
  const branch = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], folder);
  const count = exec("git", ["rev-list", "--count", "HEAD"], folder);
  const commits = ok(count) ? Number(count.stdout.trim()) || 0 : 0;
  const dates = commits > 0 ? lines(exec("git", ["log", "--format=%cs"], folder)?.stdout) : [];
  const authors = commits > 0 ? new Set(lines(exec("git", ["log", "--format=%ae"], folder)?.stdout).map((value) => value.toLowerCase())) : new Set();
  const tags = lines(exec("git", ["tag", "--list"], folder)?.stdout);
  const latest = tags.length > 0 ? exec("git", ["describe", "--tags", "--abbrev=0"], folder) : null;
  const facts = {
    slug,
    branch: ok(branch) ? branch.stdout.trim() : "",
    default_branch: "",
    clean: ok(status) && status.stdout.trim() === "",
    commits,
    first_commit: dates.length > 0 ? dates[dates.length - 1] : "",
    last_commit: dates.length > 0 ? dates[0] : "",
    contributors: authors.size,
    tags: tags.length,
    latest_tag: ok(latest) ? latest.stdout.trim() : "",
    permission: "",
    visibility: "",
    open_pull_requests: null,
    devos_variables: [],
    github_error: "",
  };
  if (!slug) return facts;
  const viewed = exec("gh", ["repo", "view", slug, "--json", "nameWithOwner,viewerPermission,visibility,defaultBranchRef"], folder);
  let info = null;
  try {
    info = ok(viewed) ? JSON.parse(viewed.stdout) : null;
  } catch {
    info = null;
  }
  if (!info) {
    facts.github_error = `gh could not read ${slug}; sign in with gh auth login, or check the repository`;
    return facts;
  }
  const listed = exec("gh", ["variable", "list", "--repo", slug, "--json", "name,value"], folder);
  try {
    const values = ok(listed) ? JSON.parse(listed.stdout) : [];
    for (const name of ["DEVOS_VERCEL", "DEVOS_SUPABASE", "DEVOS_FIREBASE", "DEVOS_R2"]) {
      if (Array.isArray(values) && values.some((entry) => entry?.name === name && entry?.value === "true")) facts.devos_variables.push(name);
    }
  } catch {
    /* no variables: nothing to add */
  }
  facts.permission = String(info.viewerPermission ?? "");
  facts.visibility = String(info.visibility ?? "").toLowerCase();
  facts.default_branch = String(info.defaultBranchRef?.name ?? "");
  const pulls = exec("gh", ["pr", "list", "--repo", slug, "--state", "open", "--limit", "100", "--json", "number"], folder);
  try {
    const listed = ok(pulls) ? JSON.parse(pulls.stdout) : null;
    facts.open_pull_requests = Array.isArray(listed) ? listed.length : null;
  } catch {
    facts.open_pull_requests = null;
  }
  return facts;
}

function trackedFiles(folder, exec) {
  const listed = exec("git", ["ls-files", "-z"], folder);
  if (!ok(listed)) return [];
  return listed.stdout.split("\0").filter((file) => file !== "").sort(compareText);
}

// Package names from requirements files, a Pipfile or pyproject.toml: a name at the start of a line, or a quoted
// requirement. A few other keys (name, version) may come along; no framework or module is named like them.
function pythonNames(text) {
  const names = new Set();
  for (const line of lines(text)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const head = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;\[@ ]|$)/.exec(trimmed);
    if (head) names.add(head[1].toLowerCase());
    for (const quoted of trimmed.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;\[ ]|["'])/g)) names.add(quoted[1].toLowerCase());
  }
  return names;
}

function stackFacts(folder, files) {
  const fileSet = new Set(files);
  const deps = new Set();
  const runners = new Set();
  const root = fileSet.has("package.json") ? readJson(path.join(folder, "package.json")) : null;
  const packages = files.filter((file) => path.posix.basename(file) === "package.json").slice(0, MAX_PACKAGE_FILES);
  for (const file of packages) {
    const pkg = readJson(path.join(folder, ...file.split("/")));
    if (!pkg || typeof pkg !== "object") continue;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) deps.add(name);
    }
  }
  for (const file of files) {
    const base = path.posix.basename(file);
    if (base === "pyproject.toml" || /^requirements.*\.txt$/.test(base) || base === "Pipfile") {
      for (const name of pythonNames(readSmall(path.join(folder, ...file.split("/"))))) deps.add(name);
    }
    if (base === "go.mod") {
      for (const match of String(readSmall(path.join(folder, ...file.split("/"))) ?? "").matchAll(/(github\.com\/[A-Za-z0-9._/-]+)/g)) deps.add(match[1]);
    }
    if (base === "pubspec.yaml" && /^\s*flutter\s*:/m.test(String(readSmall(path.join(folder, ...file.split("/"))) ?? ""))) deps.add("flutter");
  }
  const scripts = root?.scripts && typeof root.scripts === "object" ? root.scripts : {};
  const testScript = typeof scripts.test === "string" && !/no test specified/.test(scripts.test);
  for (const [runner, names] of [["vitest", ["vitest"]], ["jest", ["jest"]], ["playwright", ["@playwright/test", "playwright"]], ["cypress", ["cypress"]], ["mocha", ["mocha"]], ["pytest", ["pytest"]]]) {
    if (names.some((name) => deps.has(name))) runners.add(runner);
  }
  const testFiles = files.some((file) => /(^|\/)(test|tests|__tests__|spec|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)test_[^/]+\.py$/.test(file));
  let toolchain = "other";
  if (fileSet.has("package.json")) toolchain = "node";
  else if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt") || fileSet.has("setup.py")) toolchain = "python";
  else if (fileSet.has("go.mod")) toolchain = "go";
  else if (fileSet.has("pubspec.yaml")) toolchain = "dart";
  else if (fileSet.has("Cargo.toml")) toolchain = "rust";
  else if (fileSet.has("Gemfile")) toolchain = "ruby";
  else if (fileSet.has("composer.json")) toolchain = "php";
  else if (fileSet.has("pom.xml") || fileSet.has("build.gradle") || fileSet.has("build.gradle.kts")) toolchain = "java";
  let manager = "";
  if (fileSet.has("pnpm-lock.yaml")) manager = "pnpm";
  else if (fileSet.has("yarn.lock")) manager = "yarn";
  else if (fileSet.has("bun.lockb") || fileSet.has("bun.lock")) manager = "bun";
  else if (fileSet.has("package-lock.json")) manager = "npm";
  else if (typeof root?.packageManager === "string") manager = root.packageManager.split("@")[0];
  const frameworks = FRAMEWORKS.filter(([, test]) => test(deps)).map(([id]) => id);
  const catalogue = new Map(loadCatalogue().stacks.map((stack) => [stack.id, stack]));
  let stack = frameworks.find((id) => catalogue.has(id)) ?? "";
  if (!stack && toolchain === "node" && root) {
    if (root.bin) stack = "node-cli";
    else if (root.main || root.exports) stack = "node-lib";
  }
  if (!stack && toolchain === "python" && fileSet.has("pyproject.toml")) stack = "python-lib";
  return {
    deps,
    stack: {
      toolchain,
      package_manager: manager,
      typescript: deps.has("typescript") || files.some((file) => path.posix.basename(file) === "tsconfig.json"),
      frameworks,
      catalogue_stack: stack,
      catalogue_label: stack ? catalogue.get(stack).label : "",
      workspaces: Boolean(root?.workspaces) || fileSet.has("pnpm-workspace.yaml"),
      scripts: Object.fromEntries(["build", "lint", "test", "typecheck"].map((name) => [name, name === "test" ? testScript : typeof scripts[name] === "string"])),
      tests: testScript || testFiles || runners.size > 0,
      test_runners: [...runners].sort(compareText),
    },
  };
}

function moduleFacts(deps, fileSet) {
  const modules = {};
  for (const [module, provider, test] of MODULES) {
    if (!test(deps, fileSet)) continue;
    modules[module] = modules[module] ?? [];
    if (!modules[module].includes(provider)) modules[module].push(provider);
  }
  return modules;
}

function automationFacts(folder, files) {
  const fileSet = new Set(files);
  const workflowFiles = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
  const workflows = workflowFiles.map((file) => path.posix.basename(file));
  const deploy = [];
  const add = (host) => {
    if (!deploy.includes(host)) deploy.push(host);
  };
  for (const [file, host] of DEPLOY_FILES) if (fileSet.has(file)) add(host);
  if (fileSet.has("Dockerfile")) add("docker");
  const deployWorkflows = [];
  for (const file of workflowFiles) {
    const name = path.posix.basename(file);
    // DEV_OS's own workflows hold a gated step for every module; the repository variables say which ones run.
    if (name.startsWith("devos-")) continue;
    const text = String(readSmall(path.join(folder, ...file.split("/"))) ?? "");
    const hosts = DEPLOY_STEPS.filter(([pattern]) => pattern.test(text)).map(([, host]) => host);
    for (const host of hosts) add(host);
    if (hosts.length > 0 || /deploy|release|publish|pages/i.test(name)) deployWorkflows.push(name);
  }
  return { workflows, deploy, deploy_workflows: deployWorkflows };
}

function envNames(folder, files) {
  const names = new Set();
  const sources = [];
  for (const file of files) {
    if (!ENV_EXAMPLE.test(path.posix.basename(file))) continue;
    sources.push(file);
    for (const line of lines(readSmall(path.join(folder, ...file.split("/"))))) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) names.add(match[1]);
    }
  }
  return { names: [...names].sort(compareText), sources };
}

function sizeFacts(folder, files) {
  const counts = new Map();
  let total = 0;
  let read = 0;
  for (const file of files) {
    const ext = path.posix.extname(file).slice(1).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
    if (read >= MAX_LINE_FILES) continue;
    read += 1;
    const text = readSmall(path.join(folder, ...file.split("/")));
    if (text !== null) total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  const languages = [...counts.entries()]
    .map(([ext, count]) => ({ ext, files: count }))
    .sort((a, b) => b.files - a.files || compareText(a.ext, b.ext))
    .slice(0, 8);
  return { size: { files: files.length, code_lines: total, lines_capped: read >= MAX_LINE_FILES }, languages };
}

function devosFacts(folder) {
  const lockPath = path.join(folder, ...LOCK.split("/"));
  if (existsSync(lockPath)) return { kind: "engine", engine_version: String(readJson(lockPath)?.engine_version ?? ""), precedents_max: "" };
  const markers = ["scripts/devos", ".github/workflows/devos-cycle.yml", "docs/method/PRECEDENTS.md", "devos.config.json"]
    .filter((marker) => existsSync(path.join(folder, ...marker.split("/"))));
  if (markers.length === 0) return { kind: "none", engine_version: "", precedents_max: "" };
  const precedents = String(readSmall(path.join(folder, "docs", "method", "PRECEDENTS.md")) ?? "");
  const live = /Live maximum: (PR-\d+)/.exec(precedents);
  return { kind: "copy", engine_version: "", precedents_max: live ? live[1] : "", markers };
}

function collisionFacts(folder, root) {
  const engine = [];
  for (const entry of readManifest(root).files) {
    let have = null;
    try {
      have = hashFile(path.join(folder, ...entry.path.split("/")));
    } catch {
      have = "";
    }
    if (have !== null) engine.push({ path: entry.path, same: have === entry.sha256 });
  }
  const templates = path.join(root, "payload", "templates");
  for (const stored of walk(templates)) {
    const installed = toInstalled(stored);
    if (existsSync(path.join(folder, ...installed.split("/")))) engine.push({ path: installed, same: false });
  }
  engine.sort((a, b) => compareText(a.path, b.path));
  const documents = PROJECT_DOCUMENTS.filter((file) => existsSync(path.join(folder, ...file.split("/"))));
  return { engine, documents };
}

function walk(base, prefix = "") {
  let entries;
  try {
    entries = readdirSync(prefix ? path.join(base, ...prefix.split("/")) : base, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walk(base, rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found.sort(compareText);
}

/** prototype · in-development · production, with the reasons, from the survey's facts (a proposal the brief confirms). */
export function stageOf(repository, stack, automation) {
  const deploys = automation.deploy.length > 0;
  const released = repository.tags > 0;
  const ci = automation.workflows.length > 0;
  const reasons = [];
  if (deploys) reasons.push(`deploys to ${automation.deploy.join(", ")}`);
  if (released) reasons.push(`${repository.tags} tag${repository.tags === 1 ? "" : "s"}${repository.latest_tag ? `, latest ${repository.latest_tag}` : ""}`);
  reasons.push(`${repository.commits} commit${repository.commits === 1 ? "" : "s"}`);
  if (stack.tests && ci) reasons.push("tests and CI");
  else if (stack.tests) reasons.push("tests, no CI");
  else if (ci) reasons.push("CI, no tests");
  else reasons.push("no tests or CI");
  if (deploys && (released || repository.commits >= 200)) return { value: "production", reasons };
  if (repository.commits >= 20 || (stack.tests && ci) || deploys) return { value: "in-development", reasons };
  return { value: "prototype", reasons };
}

/** The survey of an existing project: facts, the proposed stage, and what stops adopting it. Changes nothing. */
export function surveyProject(folder, { exec = hubExec, root = engineRoot() } = {}) {
  const repository = repositoryFacts(folder, exec);
  const files = trackedFiles(folder, exec);
  const fileSet = new Set(files);
  const { deps, stack } = stackFacts(folder, files);
  const automation = automationFacts(folder, files);
  const env = envNames(folder, files);
  const { size, languages } = sizeFacts(folder, files);
  if (repository.devos_variables.includes("DEVOS_VERCEL") && !automation.deploy.includes("vercel")) automation.deploy.push("vercel");
  const devos = devosFacts(folder);
  const docsFiles = files.filter((file) => file.startsWith("docs/") && file.endsWith(".md")).length;
  const agentFiles = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules", ".github/copilot-instructions.md", ".windsurfrules"]
    .filter((file) => fileSet.has(file));
  if (files.some((file) => file.startsWith(".cursor/rules/"))) agentFiles.push(".cursor/rules");
  const blockers = [];
  const notes = [];
  if (insideEngine(folder)) blockers.push("this folder is the DEV_OS engine itself");
  if (!repository.slug) blockers.push("its origin is not a GitHub repository; adopt works on a project that is on GitHub");
  else if (repository.github_error) blockers.push(repository.github_error);
  else if (repository.permission !== "ADMIN") {
    blockers.push(`your gh account must own or administer ${repository.slug}; it has ${repository.permission ? repository.permission.toLowerCase() : "no"} access`);
  }
  if (repository.commits === 0) blockers.push("it has no commit yet; for a new project use devos init");
  if (!repository.clean) blockers.push("it has uncommitted changes; commit or stash them first");
  if (devos.kind === "engine") blockers.push(`it is already a DEV_OS project (engine ${devos.engine_version || "unknown"}); open it as a current project, or run devos upgrade in it`);
  if (devos.kind === "copy") {
    notes.push(`it runs an older copy of DEV_OS (${devos.precedents_max ? `precedents up to ${devos.precedents_max}` : "no precedents file"}, no engine lock): adopting it keeps its documents and settings`);
  }
  const secretFiles = files.filter((file) => secretFile(file));
  if (secretFiles.length > 0) {
    const named = secretFiles.length <= 3 ? secretFiles.join(", ") : `${secretFiles.slice(0, 3).join(", ")} and ${secretFiles.length - 3} more`;
    notes.push(`it tracks ${named}, which may hold a secret: DEV_OS never reads or copies ${secretFiles.length === 1 ? "it" : "them"}`);
  }
  if (!stack.catalogue_stack) notes.push("its stack is not in DEV_OS's catalogue: the cycle works, and the backend modules stay off");
  if (repository.default_branch && repository.branch && repository.branch !== repository.default_branch) {
    notes.push(`you are on ${repository.branch}; adopting starts from the default branch ${repository.default_branch}`);
  }
  return {
    schema: SURVEY_SCHEMA,
    engine: engineVersion(root),
    folder,
    repository,
    devos,
    stack,
    modules: moduleFacts(deps, fileSet),
    automation,
    env_names: env.names,
    env_sources: env.sources,
    secret_files: secretFiles,
    docs: { readme: files.some((file) => /^readme(\.[a-z]+)?$/i.test(file)), docs_files: docsFiles, agent_files: agentFiles },
    languages,
    size,
    collisions: collisionFacts(folder, root),
    stage: stageOf(repository, stack, automation),
    blockers,
    notes,
    ready: blockers.length === 0,
  };
}

/** The survey as the lines `devos adopt --check` prints. */
export function surveyLines(survey) {
  const { repository, stack, automation, collisions } = survey;
  const modules = Object.entries(survey.modules).map(([module, providers]) => `${module} ${providers.join(", ")}`);
  const differ = collisions.engine.filter((entry) => !entry.same).length;
  const devos = survey.devos.kind === "engine"
    ? `engine ${survey.devos.engine_version || "unknown"}`
    : survey.devos.kind === "copy" ? `older copy${survey.devos.precedents_max ? ` (precedents up to ${survey.devos.precedents_max})` : ""}` : "none";
  const stackName = stack.catalogue_stack ? `${stack.catalogue_label} (${stack.catalogue_stack})` : `${stack.toolchain}, not in the catalogue`;
  const out = [
    `devos adopt --check · ${repository.slug || survey.folder}`,
    `Stage: ${survey.stage.value} — ${survey.stage.reasons.join("; ")}`,
    `Stack: ${stackName} · ${stack.package_manager || "no package manager"} · ${stack.typescript ? "TypeScript" : "no TypeScript"} · tests: ${stack.test_runners.length > 0 ? stack.test_runners.join(", ") : stack.tests ? "yes" : "none"}`,
    `Modules: ${modules.length > 0 ? modules.join(" · ") : "none found"}`,
    `Automation: ${automation.workflows.length} workflow${automation.workflows.length === 1 ? "" : "s"}${automation.workflows.length > 0 ? ` (${automation.workflows.join(", ")})` : ""} · deploy: ${automation.deploy.length > 0 ? automation.deploy.join(", ") : "none found"}`,
    `DEV_OS: ${devos}`,
    `Overlaps: ${collisions.engine.length} engine file${collisions.engine.length === 1 ? " exists" : "s exist"} (${differ} differ${differ === 1 ? "s" : ""}) · ${collisions.documents.length} project document${collisions.documents.length === 1 ? " exists" : "s exist"}${collisions.documents.length > 0 ? ` (${collisions.documents.join(", ")})` : ""}`,
    `Environment names: ${survey.env_names.length}${survey.env_sources.length > 0 ? ` (from ${survey.env_sources.join(", ")})` : ""}`,
    `Size: ${survey.size.files} files, ${survey.size.code_lines}${survey.size.lines_capped ? "+" : ""} lines of code · ${repository.commits} commit${repository.commits === 1 ? "" : "s"}${repository.first_commit ? ` from ${repository.first_commit} to ${repository.last_commit}` : ""} · ${repository.contributors} contributor${repository.contributors === 1 ? "" : "s"} · ${repository.open_pull_requests === null ? "open pull requests unknown" : `${repository.open_pull_requests} open pull request${repository.open_pull_requests === 1 ? "" : "s"}`}`,
  ];
  for (const note of survey.notes) out.push(`Note: ${note}.`);
  out.push(survey.ready ? "Ready: yes. Nothing was changed." : `Ready: no — ${survey.blockers.join("; ")}. Nothing was changed.`);
  return out;
}

// ---------- E34: the brief ----------

/** The staging folder of a repository's adoption, under ~/.devos/adopt/ (never inside the project). */
export function stagingFolder(slug) {
  return path.join(devosHome(), ".devos", "adopt", slug.toLowerCase().replace("/", "__"));
}

/**
 * Copies the project's tracked files (a clean tree, so its HEAD) into `target`, except the secret files it holds
 * back; { files, skipped, held } or { error }.
 */
export function copyTracked(folder, target, exec = hubExec) {
  const listed = exec("git", ["ls-files", "-z"], folder);
  if (!ok(listed)) return { error: "devos: git could not list the project's files" };
  let total = 0;
  let files = 0;
  let skipped = 0;
  let held = 0;
  for (const file of listed.stdout.split("\0").filter((entry) => entry !== "")) {
    if (secretFile(file)) {
      held += 1;
      continue;
    }
    const from = path.join(folder, ...file.split("/"));
    let info;
    try {
      info = lstatSync(from);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_COPY_FILE) {
      skipped += 1;
      continue;
    }
    total += info.size;
    if (total > MAX_COPY_BYTES) return { error: "devos: the project's tracked files are over 300 MB; the brief needs a smaller copy" };
    const to = path.join(target, ...file.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    files += 1;
  }
  return { files, skipped, held };
}

/** The agent that writes the brief: `--agent tool[:model]`, else the default reviewer, else the first signed-in tool. */
export function chooseAgent(option, detected) {
  const ready = (tool) => BLUEPRINT_TOOLS.has(tool) && detected.some((agent) => agent.toolId === tool && agent.status === "installed" && agent.signedIn);
  const firstModel = (tool) => modelOptions(detected, true).find((entry) => entry.value.tool === tool)?.value.model ?? "";
  const fallback = engineDefaults().reviewer;
  if (option) {
    const [tool, ...rest] = String(option).split(":");
    if (!BLUEPRINT_TOOLS.has(tool)) return { error: `devos: --agent takes claude, cursor, codex or gemini, then :model if you want one; not ${option}` };
    if (!ready(tool)) return { error: `devos: ${toolCommand(tool)} is not installed and signed in on this computer` };
    const model = rest.join(":") || (fallback.tool === tool ? fallback.model : firstModel(tool));
    if (!model) return { error: `devos: name a model for ${tool}: --agent ${tool}:<model>` };
    return { tool, model };
  }
  if (ready(fallback.tool)) return { tool: fallback.tool, model: fallback.model };
  for (const tool of BLUEPRINT_TOOLS) {
    const model = ready(tool) ? firstModel(tool) : "";
    if (model) return { tool, model };
  }
  return { error: "devos: no signed-in AI tool on this computer; install and sign in to Claude Code, Cursor, Codex or Gemini, then run devos adopt again" };
}

/** The tool's arguments for a brief round: it reads and writes in the staging folder only, and runs no command. */
export function adoptArgs(tool, model, follow, session = "") {
  if (tool === "claude") {
    const args = ["-p", "--model", model, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--max-turns", "120",
      "--allowedTools", "Read,Glob,Grep,Write,Edit", "--disallowedTools", "Bash,WebFetch,WebSearch"];
    if (follow) args.push("--continue");
    return args;
  }
  if (tool === "cursor") {
    const args = ["--trust", "--force", "-p", "--output-format", "stream-json"];
    if (model !== "auto") args.splice(3, 0, "--model", model);
    if (follow) args.push(...(session ? ["--resume", session] : ["--continue"]));
    args.push(follow ? NEXT_POINTER : ADOPT_POINTER);
    return args;
  }
  if (tool === "codex") return ["exec", "--model", model, "--sandbox", "workspace-write", "--json"];
  return ["--model", model, "--approval-mode", "auto_edit", "--output-format", "json", "-p", "Follow the instructions given on standard input exactly."];
}

/** What the agent reads first: the prompt, then the catalogue's type and stack ids it must choose from. */
export function adoptInput(root = engineRoot()) {
  const prompt = readFileSync(path.join(root, "lib", "data", "adopt-prompt.md"), "utf8");
  const catalogue = loadCatalogue();
  return `${prompt}\n## Catalogue\n\n- Types: ${catalogue.types.map((type) => `\`${type.id}\``).join(", ")}.\n- Stacks: ${catalogue.stacks.map((stack) => `\`${stack.id}\``).join(", ")}.\n`;
}

/** What is wrong with the brief in `staging`/brief/: an empty list when it is complete. */
export function checkBrief(staging) {
  const problems = [];
  const md = readSmall(path.join(staging, "brief", "brief.md"));
  if (md === null) problems.push("brief/brief.md is missing");
  else {
    let from = 0;
    const text = `\n${md.replaceAll("\r\n", "\n")}`;
    for (const heading of BRIEF_HEADINGS) {
      const at = text.indexOf(`\n${heading}\n`, from);
      if (at < 0) {
        problems.push(`brief/brief.md has no heading "${heading}" after the ones before it`);
        break;
      }
      from = at + heading.length + 1;
    }
  }
  const raw = readSmall(path.join(staging, "brief", "brief.json"));
  let brief = null;
  try {
    brief = raw === null ? null : JSON.parse(raw);
  } catch {
    brief = null;
  }
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    problems.push("brief/brief.json is missing or is not one JSON object");
    return problems;
  }
  const catalogue = loadCatalogue();
  if (brief.schema !== BRIEF_SCHEMA) problems.push(`brief/brief.json schema must be "${BRIEF_SCHEMA}"`);
  if (typeof brief.name !== "string" || brief.name.trim() === "" || brief.name.length > 80) problems.push("brief/brief.json name must be the product's name (1 to 80 characters)");
  if (typeof brief.key !== "string" || !KEY_RE.test(brief.key)) problems.push("brief/brief.json key must match ^[A-Z][A-Z0-9-]{1,31}$");
  if (!STAGES.includes(brief.stage)) problems.push("brief/brief.json stage must be prototype, in-development or production");
  if (!catalogue.types.some((type) => type.id === brief.type)) problems.push("brief/brief.json type must be one of the catalogue's types");
  if (brief.stack !== "" && !catalogue.stacks.some((stack) => stack.id === brief.stack)) problems.push("brief/brief.json stack must be one of the catalogue's stacks, or \"\"");
  if (typeof brief.personal_data !== "boolean") problems.push("brief/brief.json personal_data must be true or false");
  if (!Array.isArray(brief.questions) || brief.questions.length > 10 || brief.questions.some((question) => typeof question !== "string")) {
    problems.push("brief/brief.json questions must be an array of at most 10 strings");
  }
  return problems;
}

function snapshot(folder, exec) {
  const head = exec("git", ["rev-parse", "HEAD"], folder);
  const status = exec("git", ["status", "--porcelain", "--untracked-files=all"], folder);
  return `${ok(head) ? head.stdout.trim() : ""}\n${ok(status) ? status.stdout : ""}`;
}

function showBrief(staging) {
  const text = String(readSmall(path.join(staging, "brief", "brief.md")) ?? "").replaceAll("\r\n", "\n").trimEnd();
  const shown = text.split("\n");
  console.log("Brief:");
  console.log(shown.slice(0, 200).join("\n"));
  if (shown.length > 200) console.log(`… the whole brief is in ${path.join(staging, "brief", "brief.md")}`);
}

/**
 * `devos adopt [folder]`: the survey, then the brief by the developer's AI tool in the staging folder, then the
 * developer's yes (kept), a change (another round), or an empty line (stopped). Nothing in the project changes.
 */
export async function adoptBrief(folder, { agent: option = "", read = lineReader(process.stdin), exec = hubExec, detected = null } = {}) {
  const top = gitTop(folder, exec);
  if (top.error) {
    console.log(top.error);
    return 1;
  }
  const survey = surveyProject(folder, { exec });
  console.log(surveyLines(survey).join("\n"));
  if (!survey.ready) return 1;
  const stops = adoptStops(folder, survey, engineRoot(), exec);
  if (stops.length > 0) {
    console.log(stops.join("\n"));
    return 1;
  }
  const agent = chooseAgent(option, detected ?? detectAgents());
  if (agent.error) {
    console.log(agent.error);
    return 1;
  }
  const staging = stagingFolder(survey.repository.slug);
  rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(path.join(staging, "brief"), { recursive: true });
  const copied = copyTracked(folder, path.join(staging, "workspace"), exec);
  if (copied.error) {
    console.log(copied.error);
    return 1;
  }
  // The agent gets the facts, not where the project is on this computer.
  const facts = { ...survey };
  delete facts.folder;
  writeFileSync(path.join(staging, "survey.json"), `${JSON.stringify(facts, null, 2)}\n`);
  const input = adoptInput();
  writeFileSync(path.join(staging, "adopt-input.md"), input);
  if (agent.tool === "cursor") {
    mkdirSync(path.join(staging, ".cursor"), { recursive: true });
    writeFileSync(path.join(staging, ".cursor", "cli.json"), `${JSON.stringify({ permissions: {
      allow: ["Read(**)", "Write(brief/**)"],
      deny: ["Shell(git)", "Shell(gh)", "Shell(curl)", "Shell(wget)", "Shell(rm)", "Shell(sudo)", "Write(workspace/**)", "Write(survey.json)", "Write(adopt-input.md)", "Write(adopt-next.md)", "Write(.cursor/**)"],
    } }, null, 2)}\n`);
  }
  const heldBack = copied.held > 0 ? ` (${copied.held} held back: environment files and private keys)` : "";
  console.log(`devos: ${toolCommand(agent.tool)} · ${agent.model} writes the brief in ${staging}, from a copy of ${copied.files} tracked file${copied.files === 1 ? "" : "s"}${heldBack}; your project is not touched`);
  const before = snapshot(folder, exec);
  const command = toolCommand(agent.tool);
  let session = "";
  let next = { kind: "brief", text: input };
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const result = await runToolRound(command, adoptArgs(agent.tool, agent.model, round > 1, session), {
      cwd: staging,
      input: agent.tool === "cursor" ? null : next.text,
      folder: staging,
      label: `adoption brief on ${agent.tool} · ${agent.model}${round > 1 ? ` · round ${round}` : ""}`,
      env: blueprintEnv(agent.tool, process.env),
      stream: STREAMING.has(agent.tool),
    });
    if (snapshot(folder, exec) !== before) {
      console.log(`devos: ${folder} changed while the brief was written; the brief is not kept. Look at git status there.`);
      return 1;
    }
    if (result?.session) session = result.session;
    if (!result || result.error || (result.status !== 0 && !result.timedOut && !result.idle)) {
      console.log(`devos: ${command} stopped with an error${result?.stderr ? `: ${String(result.stderr).trim().split("\n").slice(-1)[0]}` : ""}; the brief is not kept`);
      return 1;
    }
    const said = agentText(result.stdout, result.final);
    if (said) console.log(said);
    const problems = checkBrief(staging);
    if (problems.length > 0) {
      console.log(`devos: the brief after round ${round} is not complete:`);
      for (const problem of problems) console.log(`- ${problem}`);
      next = { kind: "repair", text: `These checks of your brief failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n\nFix only those, in brief/, keeping every rule of adopt-input.md.` };
      if (agent.tool === "cursor") writeFileSync(path.join(staging, "adopt-next.md"), `${next.text}\n`);
      continue;
    }
    showBrief(staging);
    process.stdout.write("Type yes to keep this brief, or write what to change (an empty line stops): ");
    const answer = await read();
    if (answer === null) {
      console.log("devos: input ended; the brief is not kept");
      return 1;
    }
    const reply = answer.trim();
    if (reply === "") {
      console.log(`devos: stopped; nothing in ${folder} changed, and the brief is not kept`);
      return 0;
    }
    if (reply.toLowerCase() === "yes") {
      const head = exec("git", ["rev-parse", "HEAD"], folder);
      writeFileSync(path.join(staging, "brief", "confirmed.json"), `${JSON.stringify({
        schema: "devos-brief-confirmed/1",
        engine: engineVersion(engineRoot()),
        repository: survey.repository.slug,
        head: ok(head) ? head.stdout.trim() : "",
        confirmed_at: new Date().toISOString(),
      }, null, 2)}\n`);
      console.log(`devos: brief kept in ${path.join(staging, "brief")}`);
      process.stdout.write(`Add DEV_OS to ${survey.repository.slug} now, on a new branch ${ADOPT_BRANCH}? Your checkout stays as it is. (yes/no) [yes]: `);
      const now = await read();
      if (now === null || !["", "yes"].includes(now.trim().toLowerCase())) {
        console.log(`devos: nothing in ${folder} changed; add DEV_OS from this brief with devos adopt --install ${folder}`);
        return 0;
      }
      return adoptInstall(folder, { agent: option, read, exec, detected, survey });
    }
    next = { kind: "changes", text: `The developer asks for these changes to the brief:\n${reply}\n\nApply them to brief/brief.md and brief/brief.json, keeping every rule of adopt-input.md.` };
    if (agent.tool === "cursor") writeFileSync(path.join(staging, "adopt-next.md"), `${next.text}\n`);
  }
  console.log(`devos: no brief kept after ${MAX_ROUNDS} rounds; the last one is in ${path.join(staging, "brief")}`);
  return 1;
}

export async function adoptCommand(args) {
  if (args[0] === "--check") {
    const json = args.includes("--json");
    const rest = args.filter((arg) => arg !== "--json");
    if (rest.length > 2 || rest.slice(1).some((arg) => arg.startsWith("-"))) {
      console.log(USAGE);
      return 2;
    }
    const folder = path.resolve(rest[1] ?? process.cwd());
    const top = gitTop(folder);
    if (top.error) {
      console.log(top.error);
      return 1;
    }
    const survey = surveyProject(folder);
    if (json) process.stdout.write(`${JSON.stringify(survey, null, 2)}\n`);
    else console.log(surveyLines(survey).join("\n"));
    return survey.ready ? 0 : 1;
  }
  let agent = "";
  const install = args.includes("--install");
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--agent" && args[i + 1]) {
      agent = args[i + 1];
      i += 1;
    } else if (args[i] !== "--install") rest.push(args[i]);
  }
  if (rest.length > 1 || rest.some((arg) => arg.startsWith("-"))) {
    console.log(USAGE);
    return 2;
  }
  const folder = path.resolve(rest[0] ?? process.cwd());
  return install ? adoptInstall(folder, { agent }) : adoptBrief(folder, { agent });
}

// ---------- E36a: DEV_OS's files beside the project's own ----------

// Files whose lines are merged: the project's lines stay, and DEV_OS's missing lines are added at the end.
export const MERGED_FILES = [".gitignore", ".gitattributes"];
// An engine file placed beside the project's own (the owner's answer of 2026-10-31: keep the project's CI and add
// DEV_OS's). Its lock entry keeps `at`, so upgrades read and write it there (lib/upgrade.mjs).
export const PLACED_BESIDE = { ".github/workflows/ci.yml": ".github/workflows/devos-ci.yml" };
export const AGENT_START = "<!-- devos:start · DEV_OS's rules, kept by devos adopt; your own text stays above -->";
export const AGENT_END = "<!-- devos:end -->";

/** The project's file with DEV_OS's missing lines added under one comment; unchanged when none is missing. */
export function mergeLines(existing, engineText) {
  const have = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const add = [...new Set(engineText.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== "" && !line.trim().startsWith("#") && !have.has(line.trim())))];
  if (add.length === 0) return existing;
  const base = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}${base === "" ? "" : "\n"}# DEV_OS (added by devos adopt)\n${add.join("\n")}\n`;
}

/** The project's CLAUDE.md or AGENTS.md with DEV_OS's rules in a marked section after its own text. */
export function mergeAgentFile(existing, devosText) {
  const section = `${AGENT_START}\n${devosText.trimEnd()}\n${AGENT_END}\n`;
  const start = existing.indexOf("<!-- devos:start");
  const end = existing.indexOf(AGENT_END);
  if (start >= 0 && end > start) {
    const after = existing.slice(end + AGENT_END.length).replace(/^\r?\n/, "");
    return `${existing.slice(0, start)}${section}${after}`;
  }
  const own = existing.trimEnd();
  return own === "" ? section : `${own}\n\n${section}`;
}

/**
 * Writes DEV_OS's engine files and templates into an existing project, beside its own files:
 * - a file that does not exist is written, and an identical one is kept;
 * - `.gitignore` and `.gitattributes` are merged;
 * - a CI workflow of the project's own stays, DEV_OS's goes to devos-ci.yml, and a project workflow also named `ci`
 *   is renamed `ci (project)` (its `name:` line only);
 * - any other engine file that exists and differs is refused, and then nothing is written.
 * Then the lock and devos.config.json. { code, written, kept, merged, placed, renamed, held, paths } or
 * { code: 1, refused }; `paths` are the files it wrote.
 * `hold` names engine files written later by the caller (their bytes come back in `held`), as `devos init` holds
 * the agents' permission files while the blueprint runs (E36b). `check` only returns { code, refused } and writes
 * nothing (E36b).
 */
export function placeEngineFiles(folder, key, root = engineRoot(), { hold = [], check = false } = {}) {
  const holding = new Set(hold);
  const items = [];
  for (const entry of readManifest(root).files) {
    const bytes = normalizeLf(readFileSync(path.join(root, "payload", "files", ...entry.stored.split("/"))));
    items.push({ path: entry.path, bytes, sha256: entry.sha256, template: false });
  }
  for (const write of templateWrites(root, key)) items.push({ path: write.path, bytes: write.bytes, sha256: sha256Hex(write.bytes), template: true });
  const plan = [];
  const refused = [];
  for (const item of items) {
    const at = path.join(folder, ...item.path.split("/"));
    let have = null;
    try {
      have = hashFile(at);
    } catch {
      have = "";
    }
    if (have === null) plan.push({ ...item, action: "write" });
    else if (have === item.sha256) plan.push({ ...item, action: "keep" });
    else if (MERGED_FILES.includes(item.path)) plan.push({ ...item, action: "merge" });
    else if (PLACED_BESIDE[item.path]) {
      const beside = PLACED_BESIDE[item.path];
      const there = hashFile(path.join(folder, ...beside.split("/")));
      if (there !== null && there !== item.sha256) refused.push(beside);
      else plan.push({ ...item, action: "place", at: beside });
    } else refused.push(item.path);
  }
  if (check || refused.length > 0) return { code: refused.length > 0 ? 1 : 0, refused: refused.sort(compareText) };
  const done = { written: 0, kept: 0, merged: [], placed: [], renamed: false, held: {}, paths: [] };
  for (const item of plan) {
    if (item.action === "keep") {
      done.kept += 1;
      continue;
    }
    if (item.action === "write" && holding.has(item.path)) {
      done.held[item.path] = item.bytes;
      continue;
    }
    const target = path.join(folder, ...(item.at ?? item.path).split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    done.paths.push(item.at ?? item.path);
    if (item.action === "merge") {
      writeFileSync(target, mergeLines(readFileSync(target, "utf8"), item.bytes.toString("utf8")));
      done.merged.push(item.path);
    } else {
      writeFileSync(target, item.bytes);
      if (item.action === "place") done.placed.push(item.at);
      else done.written += 1;
    }
    if (item.action === "place") {
      const own = path.join(folder, ...item.path.split("/"));
      const text = readFileSync(own, "utf8");
      const renamed = text.replace(/^name:[ \t]*["']?ci["']?[ \t]*(\r?\n)/m, "name: ci (project)$1");
      if (renamed !== text) {
        writeFileSync(own, renamed);
        done.renamed = true;
      }
    }
  }
  const engineFiles = plan.filter((item) => !item.template).map((item) => (item.at ? { path: item.path, sha256: item.sha256, at: item.at } : { path: item.path, sha256: item.sha256 }));
  writeLock(folder, engineVersion(root), engineFiles);
  const config = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: folder, encoding: "utf8", windowsHide: true });
  if (config.status !== 0) return { code: 1, error: `${config.stdout ?? ""}${config.stderr ?? ""}`.trim() };
  return { code: 0, ...done };
}

// ---------- E36b: the install on a branch ----------

export const ADOPT_BRANCH = "devos/adopt";
const BASELINE = "devos/baseline.json";
// The agents' permission files are written after the documents, as `devos init` does: DEV_OS's reviewer
// permissions would stop the AI tool writing them.
const HELD = [".claude/settings.json", ".cursor/cli.json", ".cursor/hooks.json"];
// What the AI tool may write while it writes the documents: Markdown in docs/ and DEV_OS's settings files, never a
// file of the project's, an engine file other than BLUEPRINT_WRITES, or a link. Any other change stops the adoption.
// A root CLAUDE.md is allowed when the project has none.
const DOCUMENT_PATHS = /^(docs\/.+\.md$|devos\/project\.json$|devos\/ci\/mcp\.ci\.json$|devos\.config\.json$|CLAUDE\.md$|\.cursor\/rules\/(10-security-data|30-vocabulary)\.mdc$|\.cursor\/mcp\.example\.json$)/;
const MAX_DOC_ROUNDS = 5;
// The engine files the blueprint itself rewrites (PR-01 of the precedents, the MCP files); the others stay as installed.
const BLUEPRINT_WRITES = ["docs/method/PRECEDENTS.md", ".cursor/mcp.example.json", "devos/ci/mcp.ci.json"];
const SETTINGS_HINT = " (your .claude/settings.json can become .claude/settings.local.json, which Claude Code also reads)";

/**
 * What stops adding DEV_OS before anything is written, as the lines to print: an older copy of DEV_OS (a later
 * version adopts it), links the repository tracks where DEV_OS writes, engine files of the project's that differ,
 * and documents with the names of DEV_OS's.
 */
export function adoptStops(folder, survey, root = engineRoot(), exec = hubExec) {
  if (survey.devos.kind === "copy") {
    return [`devos: ${survey.repository.slug} runs an older copy of DEV_OS; adding the engine to an older copy, keeping its documents and settings, comes in a later version`];
  }
  const stops = [];
  // DEV_OS writes into these folders and files; a link there would take its writes out of the repository.
  const targets = new Set(["docs", "devos", "CLAUDE.md"]);
  for (const file of [...readManifest(root).files.map((entry) => entry.path), ...Object.values(PLACED_BESIDE), ...templateWrites(root, "KEY").map((write) => write.path)]) {
    const parts = file.split("/");
    for (let i = 1; i <= parts.length; i += 1) targets.add(parts.slice(0, i).join("/"));
  }
  const staged = exec("git", ["ls-files", "-s", "-z"], folder);
  const links = zList(ok(staged) ? staged.stdout : "")
    .map((entry) => /^(\d+) \S+ \d+\t(.*)$/s.exec(entry))
    .filter((match) => match && match[1] === "120000" && targets.has(match[2]))
    .map((match) => match[2])
    .sort(compareText);
  if (links.length > 0) stops.push(`devos: these are links in your repository where DEV_OS writes: ${links.join(", ")}. Replace them with the folders or files, commit, then run devos adopt again.`);
  const { refused } = placeEngineFiles(folder, keyFromName(survey.repository.slug.split("/").pop()), root, { check: true });
  if (refused.length > 0) {
    stops.push(`devos: these files of yours have DEV_OS's names and differ: ${refused.join(", ")}. Move them aside${refused.includes(".claude/settings.json") ? SETTINGS_HINT : ""}, commit, then run devos adopt again.`);
  }
  const documents = survey.collisions.documents.filter((file) => file.startsWith("docs/"));
  if (documents.length > 0) stops.push(`devos: these documents of yours have the names of DEV_OS's: ${documents.join(", ")}. Rename them, commit, then run devos adopt again.`);
  return stops;
}

function treeGit(tree, args, exec) {
  return exec("git", args, tree);
}

/**
 * The path of `rel` in `tree`, for devos to read or write: every part of it is a real folder and the file, when it
 * exists, a plain file. A link or a folder in its place (a tool may plant either) throws.
 */
export function plainFile(tree, rel) {
  const parts = rel.split("/");
  let at = tree;
  for (let i = 0; i < parts.length; i += 1) {
    at = path.join(at, parts[i]);
    let stat;
    try {
      stat = lstatSync(at);
    } catch {
      return path.join(tree, ...parts);
    }
    const last = i === parts.length - 1;
    if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`devos: ${rel} in the branch's folder is not a plain file; a tool changed it`);
    }
  }
  return at;
}

function writePlain(tree, rel, bytes) {
  const at = plainFile(tree, rel);
  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, bytes);
}

/** NUL-separated git output as a list. */
function zList(text) {
  return String(text ?? "").split("\0").filter(Boolean);
}

/** Every path that differs in `tree` from the tree object `base`: in the index, in the work tree, or new and not ignored. */
function changesSince(tree, base, exec) {
  const changed = treeGit(tree, ["diff", "--name-only", "-z", "--no-renames", base], exec);
  const added = treeGit(tree, ["ls-files", "--others", "--exclude-standard", "-z"], exec);
  if (!ok(changed) || !ok(added)) throw new Error("devos: git could not list the changes in the branch's folder");
  return [...new Set([...zList(changed.stdout), ...zList(added.stdout)])].sort(compareText);
}

/** The changes a tool must not make: outside DEV_OS's documents, over a file in `kept`, or a link; `allow` is exempt. */
export function strayPaths(changed, kept, { allow = [], isLink = () => false } = {}) {
  return changed.filter((file) => !allow.includes(file) && (!DOCUMENT_PATHS.test(file) || kept.has(file) || isLink(file)));
}

/**
 * The engine files in `tree` that no longer match the engine, whatever git is told: a file a tool changed, or one
 * hidden from git (`update-index --assume-unchanged`). The merged files, BLUEPRINT_WRITES and `skip` are left out,
 * and a held file may be missing until devos writes it.
 */
function changedEngineFiles(tree, root, placedAt, skip = []) {
  const changed = [];
  for (const entry of readManifest(root).files) {
    if (MERGED_FILES.includes(entry.path) || BLUEPRINT_WRITES.includes(entry.path) || skip.includes(entry.path)) continue;
    const rel = placedAt[entry.path] ?? entry.path;
    let have = null;
    try {
      have = hashFile(plainFile(tree, rel));
    } catch {
      have = "";
    }
    if (have === null && HELD.includes(entry.path)) continue;
    if (have !== entry.sha256) changed.push(rel);
  }
  return changed.sort(compareText);
}

/** DEV_OS's CLAUDE.md as the tool wrote it: .devos/adopt/CLAUDE.md, else a root CLAUDE.md it changed; or null. */
export function devosClaude(tree, original) {
  const inbox = plainFile(tree, ".devos/adopt/CLAUDE.md");
  if (existsSync(inbox)) return readFileSync(inbox, "utf8");
  const root = plainFile(tree, "CLAUDE.md");
  if (!existsSync(root)) return null;
  const text = readFileSync(root, "utf8");
  return original !== null && text.replaceAll("\r\n", "\n") === original.replaceAll("\r\n", "\n") ? null : text;
}

function sectionText(md, heading) {
  const text = `\n${String(md ?? "").replaceAll("\r\n", "\n")}`;
  const at = text.indexOf(`\n${heading}\n`);
  if (at < 0) return "";
  const rest = text.slice(at + heading.length + 2);
  const next = rest.search(/\n## /);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/** The modules of `devos/answers.json`: the survey's provider when the catalogue has it for that module, else none. */
export function adoptModules(found) {
  const out = {};
  for (const module of loadCatalogue().modules) {
    const ids = module.providers.map((provider) => provider.id);
    out[module.id] = (found?.[module.id] ?? []).find((id) => ids.includes(id)) ?? "none";
  }
  return out;
}

/** `devos/answers.json` for an adopted project, from the confirmed brief and the survey. */
export function adoptAnswers(brief, md, survey, agent) {
  const modules = adoptModules(survey.modules);
  return {
    name: brief.name,
    key: brief.key,
    brief: sectionText(md, "## What it is"),
    users: "",
    stores_data: brief.personal_data === true || modules.database !== "none",
    sign_in: modules.auth !== "none" || Boolean(survey.modules?.auth?.length),
    languages: ["en"],
    deploy: survey.automation.deploy.includes("vercel") ? "vercel" : "none",
    visibility: survey.repository.visibility === "public" ? "public" : "private",
    type: brief.type,
    stack: brief.stack,
    modules,
    scope: "full",
    blueprint_agent: { tool: agent.tool, model: agent.model },
    adopted: { stage: brief.stage, head: survey.head ?? "", engine: survey.engine },
  };
}

/** What is wrong with the documents the AI tool wrote in `tree`: { ok, detail }. `original`: the project's CLAUDE.md. */
export function checkAdoptDocs(tree, original = null) {
  const required = ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md"];
  let ui = false;
  try {
    ui = JSON.parse(readFileSync(plainFile(tree, "devos/project.json"), "utf8"))?.ui === true;
  } catch {
    ui = false;
  }
  if (ui) required.push("docs/DESIGN_SYSTEM.md", "docs/design/UI_ACCEPTANCE.md", "docs/design/REFERENCES.md");
  const missing = required.filter((file) => !existsSync(path.join(tree, ...file.split("/"))));
  if (devosClaude(tree, original) === null) missing.push(".devos/adopt/CLAUDE.md");
  const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "phases,design-spec,boundary,config"], { cwd: tree, encoding: "utf8", windowsHide: true });
  const fence = existsSync(path.join(tree, "docs", "fences", "T01.md"))
    ? spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", "docs/fences/T01.md"], { cwd: tree, encoding: "utf8", windowsHide: true })
    : { status: 0, stdout: "", stderr: "" };
  const detail = [
    ...missing.map((file) => `missing ${file}`),
    guards.status === 0 ? "" : `${guards.stdout ?? ""}${guards.stderr ?? ""}`.trim(),
    fence.status === 0 ? "" : `${fence.stdout ?? ""}${fence.stderr ?? ""}`.trim(),
  ].filter((part) => part !== "").join("\n");
  return { ok: missing.length === 0 && guards.status === 0 && fence.status === 0, detail };
}

/** The developer's checkout as git sees it: HEAD, status, its own git settings, and every branch, tag and stash but devos/adopt. */
function checkoutState(folder, exec) {
  const refs = exec("git", ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags", "refs/stash"], folder);
  const lines = (ok(refs) ? refs.stdout : "").split(/\r?\n/).filter((line) => line && !line.startsWith(`refs/heads/${ADOPT_BRANCH} `));
  const config = exec("git", ["config", "--local", "--list"], folder);
  return `${snapshot(folder, exec)}\n${lines.join("\n")}\n${ok(config) ? config.stdout : ""}`;
}

/**
 * `devos adopt --install [folder]`, or yes after the brief: DEV_OS on a new branch `devos/adopt`, made in a worktree
 * under the staging folder, so the developer's checkout is never touched. The engine files go beside the project's
 * own (E36a); the AI tool writes the documents from the confirmed brief; then the held files, CLAUDE.md, the
 * baseline (E35), every guard, and one commit. Anything that fails, or Ctrl-C, removes the worktree and the branch.
 * The checks catch a tool that strays from its instructions; they are not a sandbox for a tool the developer lets
 * run any command.
 */
export async function adoptInstall(folder, { agent: option = "", read = lineReader(process.stdin), exec = hubExec, detected = null, survey: known = null, root = engineRoot() } = {}) {
  const top = gitTop(folder, exec);
  if (top.error) {
    console.log(top.error);
    return 1;
  }
  const survey = known ?? surveyProject(folder, { exec });
  if (!known) console.log(surveyLines(survey).join("\n"));
  if (!survey.ready) return 1;
  const { slug, default_branch: base, branch } = survey.repository;
  if (base !== "main") {
    console.log(`devos: DEV_OS works on a default branch named main, and ${slug}'s is ${base || "unknown"}; rename it on GitHub (Settings → General → Default branch), pull, then run devos adopt --install again`);
    return 1;
  }
  if (branch !== "main") {
    console.log(`devos: switch ${folder} to main first (it is on ${branch}), then run devos adopt --install again`);
    return 1;
  }
  const staging = stagingFolder(slug);
  const head = exec("git", ["rev-parse", "HEAD"], folder)?.stdout?.trim() ?? "";
  let confirmed = null;
  let brief = null;
  let md = "";
  let surveyText = "";
  try {
    confirmed = JSON.parse(readFileSync(path.join(staging, "brief", "confirmed.json"), "utf8"));
    brief = JSON.parse(readFileSync(path.join(staging, "brief", "brief.json"), "utf8"));
    md = readFileSync(path.join(staging, "brief", "brief.md"), "utf8");
    surveyText = readFileSync(path.join(staging, "survey.json"), "utf8");
  } catch {
    confirmed = null;
  }
  if (!confirmed || confirmed.repository !== slug || confirmed.head !== head || checkBrief(staging).length > 0) {
    console.log(`devos: there is no confirmed brief for ${slug} at this commit; run devos adopt ${folder} first`);
    return 1;
  }
  if (ok(exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${ADOPT_BRANCH}`], folder))) {
    console.log(`devos: ${folder} already has a branch ${ADOPT_BRANCH}; delete it (git branch -D ${ADOPT_BRANCH}) or finish it, then run devos adopt --install again`);
    return 1;
  }
  const stops = adoptStops(folder, survey, root, exec);
  if (stops.length > 0) {
    console.log(stops.join("\n"));
    return 1;
  }
  const agent = chooseAgent(option, detected ?? detectAgents());
  if (agent.error) {
    console.log(agent.error);
    return 1;
  }
  const tree = path.join(staging, "tree");
  rmSync(tree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  exec("git", ["worktree", "prune"], folder);
  const checkout = checkoutState(folder, exec);
  const added = exec("git", ["worktree", "add", "-q", "-b", ADOPT_BRANCH, tree, "HEAD"], folder);
  if (!ok(added)) {
    console.log(`devos: git could not make the branch ${ADOPT_BRANCH} in ${tree}`);
    return 1;
  }
  let settled = false;
  const remove = () => {
    exec("git", ["worktree", "remove", "--force", "--force", tree], folder);
    exec("git", ["worktree", "prune"], folder);
    exec("git", ["branch", "-D", ADOPT_BRANCH], folder);
    return !ok(exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${ADOPT_BRANCH}`], folder));
  };
  const drop = (why) => {
    settled = true;
    const gone = remove();
    const intact = checkoutState(folder, exec) === checkout;
    console.log(why);
    if (!gone) console.log(`devos: the branch ${ADOPT_BRANCH} could not be removed; in ${folder}, run git worktree remove --force --force ${tree} and git branch -D ${ADOPT_BRANCH}`);
    else console.log(`devos: nothing was kept: the branch ${ADOPT_BRANCH} is removed${intact ? `, and ${folder} is as it was` : `; ${folder} changed while the tool ran, so look at git status and git log there`}`);
    return 1;
  };
  // Ctrl-C or a stop ends the process: the worktree and the branch go with it. During a tool round, the round's own
  // handler stops the tool first and exits; otherwise this one exits.
  const onSignal = (signal) => {
    if (process.listenerCount(signal) > 1) return;
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onExit = () => {
    if (settled) return;
    const gone = remove();
    try {
      writeSync(1, gone ? `devos: nothing was kept: the branch ${ADOPT_BRANCH} is removed\n` : `devos: the branch ${ADOPT_BRANCH} could not be removed; in ${folder}, run git worktree remove --force --force ${tree} and git branch -D ${ADOPT_BRANCH}\n`);
    } catch {
      // The output is gone; the branch is removed all the same.
    }
  };
  process.on("exit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await installOnBranch();
  } catch (error) {
    const message = String(error?.message ?? error);
    return drop(message.startsWith("devos:") ? message : `devos: the adoption stopped: ${message}`);
  } finally {
    settled = true;
    process.off("exit", onExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  async function installOnBranch() {
    const placed = placeEngineFiles(tree, brief.key, root, { hold: HELD });
    if (placed.refused) {
      return drop(`devos: these files of yours have DEV_OS's names and differ: ${placed.refused.join(", ")}. Move them aside${placed.refused.includes(".claude/settings.json") ? SETTINGS_HINT : ""}, commit, then run devos adopt again.`);
    }
    if (placed.code !== 0) return drop(`devos: the engine files could not be placed: ${placed.error ?? "unknown error"}`);
    writePlain(tree, "devos/answers.json", `${JSON.stringify(adoptAnswers(brief, md, { ...survey, head }, agent), null, 2)}\n`);
    for (const file of ["brief.md", "brief.json"]) writePlain(tree, `.devos/adopt/${file}`, readFileSync(path.join(staging, "brief", file)));
    writePlain(tree, ".devos/adopt/survey.json", surveyText);
    // DEV_OS's files are committed even where the project's .gitignore leaves them out.
    const ours = [...placed.paths, LOCK, "devos.config.json", "devos/answers.json"];
    if (!ok(treeGit(tree, ["add", "-A"], exec)) || !ok(treeGit(tree, ["add", "-f", "--", ...ours], exec))) {
      return drop("devos: git could not stage the engine files");
    }
    const written = treeGit(tree, ["write-tree"], exec);
    if (!ok(written)) return drop("devos: git could not record the engine files");
    const placedTree = written.stdout.trim();
    const placedAt = Object.fromEntries(Object.entries(PLACED_BESIDE).filter(([, at]) => placed.placed.includes(at)));

    console.log(`devos: ${placed.written} engine files written, ${placed.kept} kept${placed.merged.length ? `, ${placed.merged.join(" and ")} merged` : ""}${placed.placed.length ? `, ${placed.placed.join(", ")} placed beside your own` : ""}`);
    const command = toolCommand(agent.tool);
    const input = readFileSync(path.join(root, "lib", "data", "adopt-blueprint.md"), "utf8");
    const own = exec("git", ["show", "HEAD:CLAUDE.md"], folder);
    const original = ok(own) ? own.stdout : null;
    if (agent.tool === "cursor") {
      // The blueprint kit's permissions, with DEV_OS's CLAUDE.md written where the adoption reads it, never over the
      // project's own.
      const kit = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "roles", "cursor-blueprint", "cli.json"), "utf8"));
      kit.permissions.allow = [...kit.permissions.allow.filter((rule) => original === null || rule !== "Write(CLAUDE.md)"), "Write(.devos/adopt/CLAUDE.md)"];
      if (original !== null) kit.permissions.deny.push("Write(CLAUDE.md)");
      writePlain(tree, ".cursor/cli.json", `${JSON.stringify(kit, null, 2)}\n`);
    }
    // The project's own files and DEV_OS's engine files stay as they are: the tool writes only the documents.
    const tracked = zList(treeGit(tree, ["ls-tree", "-r", "-z", "--name-only", "HEAD"], exec)?.stdout);
    const kept = new Set([...tracked, ...readManifest(root).files.map((entry) => entry.path).filter((file) => !BLUEPRINT_WRITES.includes(file)), ...Object.values(PLACED_BESIDE)]);
    const isLink = (file) => {
      try {
        return lstatSync(path.join(tree, ...file.split("/"))).isSymbolicLink();
      } catch {
        return false;
      }
    };
    const named = (files) => `${files.slice(0, 10).join(", ")}${files.length > 10 ? ` and ${files.length - 10} more` : ""}`;
    // After each round: the branch has not moved, the checkout is unchanged, the engine files are DEV_OS's, and the
    // tool changed only documents.
    const strays = (allow) => {
      const now = treeGit(tree, ["rev-parse", "HEAD"], exec)?.stdout?.trim();
      const on = treeGit(tree, ["symbolic-ref", "-q", "HEAD"], exec)?.stdout?.trim();
      if (now !== head || on !== `refs/heads/${ADOPT_BRANCH}`) throw new Error(`devos: ${command} moved the branch ${ADOPT_BRANCH}`);
      if (checkoutState(folder, exec) !== checkout) throw new Error(`devos: ${folder} changed while ${command} wrote the documents`);
      const wrong = strayPaths(changesSince(tree, placedTree, exec), kept, { allow, isLink });
      if (wrong.length > 0) return wrong;
      // An engine file changed without git seeing it (`update-index --assume-unchanged`).
      const engineChanged = changedEngineFiles(tree, root, placedAt, allow);
      if (engineChanged.length > 0) throw new Error(`devos: ${command} changed DEV_OS's engine files: ${named(engineChanged)}`);
      return [];
    };
    let session = "";
    let next = input;
    let passed = false;
    for (let round = 1; round <= MAX_DOC_ROUNDS; round += 1) {
      if (agent.tool === "cursor") writePlain(tree, ".devos/blueprint-input.md", next);
      const result = await runToolRound(command, blueprintArgs(agent.tool, agent.model, round, session, round > 1), {
        cwd: tree,
        input: agent.tool === "cursor" ? null : next,
        folder: tree,
        label: `adoption documents on ${agent.tool} · ${agent.model}${round > 1 ? ` · round ${round}` : ""}`,
        env: blueprintEnv(agent.tool, process.env),
        stream: STREAMING.has(agent.tool),
      });
      if (result?.session) session = result.session;
      const wrong = strays(agent.tool === "cursor" ? [".cursor/cli.json"] : []);
      if (wrong.length > 0) return drop(`devos: ${command} changed files outside DEV_OS's documents: ${named(wrong)}`);
      if (!result || result.error || (result.status !== 0 && !result.timedOut && !result.idle)) {
        return drop(`devos: ${command} stopped with an error while writing the documents`);
      }
      const said = agentText(result.stdout, result.final);
      if (said) console.log(said);
      const check = checkAdoptDocs(tree, original);
      if (check.ok) {
        passed = true;
        break;
      }
      console.log(`devos: the documents after round ${round} fail their checks:\n${check.detail}`);
      next = `Your documents and fence T01 are written, and these checks failed:\n${check.detail}\n\nFix only what the checks name, keeping every rule of the adoption instructions and of devos/prompts/blueprint.md. Do not research again, and never change the project's own files.`;
    }
    if (!passed) return drop(`devos: the documents do not pass their checks after ${MAX_DOC_ROUNDS} rounds`);

    // DEV_OS's permission files go in last; for Cursor, its .cursor/cli.json also replaces the blueprint kit's.
    const held = { ...placed.held };
    if (agent.tool === "cursor" && !held[".cursor/cli.json"]) {
      const entry = readManifest(root).files.find((file) => file.path === ".cursor/cli.json");
      held[".cursor/cli.json"] = normalizeLf(readFileSync(path.join(root, "payload", "files", ...entry.stored.split("/"))));
    }
    for (const [file, bytes] of Object.entries(held)) writePlain(tree, file, bytes);
    const devosText = devosClaude(tree, original);
    writePlain(tree, "CLAUDE.md", original !== null ? mergeAgentFile(original, devosText) : devosText);
    // Everything the commit will hold is staged before the guards run, so they scan exactly that, ignored documents
    // included.
    const ignored = zList(treeGit(tree, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], exec)?.stdout)
      .filter((file) => DOCUMENT_PATHS.test(file) && !kept.has(file) && !isLink(file));
    const last = [...Object.keys(held), "CLAUDE.md", ...ignored];
    if (!ok(treeGit(tree, ["add", "-A"], exec)) || !ok(treeGit(tree, ["add", "-f", "--", ...last], exec))) {
      return drop("devos: git could not stage the documents");
    }
    const engineChanged = changedEngineFiles(tree, root, placedAt);
    if (engineChanged.length > 0) return drop(`devos: ${command} changed DEV_OS's engine files: ${named(engineChanged)}`);
    const baseline = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--write-baseline"], { cwd: tree, encoding: "utf8", windowsHide: true });
    const baselineLine = String(baseline.stdout ?? "").split(/\r?\n/)[0] ?? "";
    if (!baselineLine.startsWith(`${BASELINE}`)) return drop(`devos: the baseline could not be written:\n${`${baseline.stdout ?? ""}${baseline.stderr ?? ""}`.trim()}`);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], { cwd: tree, encoding: "utf8", windowsHide: true });
    if (guards.status !== 0) {
      const failing = String(guards.stdout ?? "").split(/\r?\n/).filter((line) => /^guard:\S+\s+FAIL/.test(line) || line.startsWith("    "));
      return drop(`devos: DEV_OS's checks fail on the project as it is, outside what a baseline may hold; fix these first:\n${failing.join("\n")}`);
    }

    // The commit holds exactly what was checked: DEV_OS's files, the documents, and what devos itself wrote last.
    last.push(BASELINE);
    if (!ok(treeGit(tree, ["add", "-A"], exec)) || !ok(treeGit(tree, ["add", "-f", "--", BASELINE], exec))) {
      return drop("devos: git could not stage the baseline");
    }
    const staged = treeGit(tree, ["diff", "--cached", "--name-only", "-z", "--no-renames", placedTree], exec);
    if (!ok(staged)) return drop("devos: git could not list the documents");
    const late = [...new Set([...strays(last), ...strayPaths(zList(staged.stdout), kept, { allow: last, isLink })])];
    if (late.length > 0) return drop(`devos: ${command} changed files outside DEV_OS's documents: ${named(late)}`);
    const engine = engineVersion(root);
    const title = String(brief.name).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 80);
    const hooks = path.join(staging, "no-hooks");
    mkdirSync(hooks, { recursive: true });
    // The project's own git hooks do not run on DEV_OS's commit, which holds only what was checked.
    const committed = treeGit(tree, ["-c", `core.hooksPath=${hooks}`, "commit", "--no-verify", "-q", "-m", `DEV_OS adopt: ${title} (engine ${engine})`], exec);
    if (!ok(committed)) return drop(`devos: git could not commit on ${ADOPT_BRANCH}; check your git name and email (git config user.name, user.email)`);
    // The engine's paths are plain ASCII, so git's line output needs no unquoting.
    const forced = String(treeGit(tree, ["check-ignore", "--no-index", "--", ...ours, ...last], exec)?.stdout ?? "").split(/\r?\n/).filter(Boolean);
    settled = true;
    exec("git", ["worktree", "remove", "--force", "--force", tree], folder);
    exec("git", ["worktree", "prune"], folder);
    console.log(`devos: DEV_OS is on the branch ${ADOPT_BRANCH} of ${folder}, in one commit. ${baselineLine.replace(`${BASELINE} written: `, "The baseline holds ")}.`);
    if (forced.length > 0) console.log(`devos: committed although your .gitignore leaves them out: ${named([...new Set(forced)].sort(compareText))}. Narrow your .gitignore, so later upgrades keep them too.`);
    console.log(`devos: your checkout is still on ${branch}, unchanged. Pushing ${ADOPT_BRANCH} and opening its pull request comes in a later version.`);
    return 0;
  }
}
