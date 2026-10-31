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
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCatalogue } from "./catalogue.mjs";
import { engineRoot, engineVersion, hashFile, insideEngine, LOCK, readManifest } from "./engine.mjs";
import { hubExec } from "./hub.mjs";
import { agentText, BLUEPRINT_TOOLS, blueprintEnv, engineDefaults, modelOptions, runToolRound, STREAMING, toolCommand } from "./init.mjs";
import { KEY_RE } from "./install.mjs";
import { lineReader } from "./menu.mjs";
import { slugFromRemote } from "./models.mjs";
import { toInstalled } from "./paths.mjs";
import { detectAgents } from "./probes.mjs";
import { devosHome } from "./profile.mjs";

export const SURVEY_SCHEMA = "devos-survey/1";
export const BRIEF_SCHEMA = "devos-brief/1";
const USAGE = "usage: devos adopt [folder] [--agent <tool>[:<model>]] · devos adopt --check [folder] [--json]";
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
      console.log(`devos: nothing in ${folder} changed. Adding DEV_OS from this brief comes in a later version.`);
      return 0;
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
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--agent" && args[i + 1]) {
      agent = args[i + 1];
      i += 1;
    } else rest.push(args[i]);
  }
  if (rest.length > 1 || rest.some((arg) => arg.startsWith("-"))) {
    console.log(USAGE);
    return 2;
  }
  return adoptBrief(path.resolve(rest[0] ?? process.cwd()), { agent });
}
