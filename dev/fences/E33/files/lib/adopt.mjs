// E33 (D-E13): adopting an existing project starts with a survey. `devos adopt --check [folder]` reads the project's
// own clone and its GitHub repository and changes nothing: it writes no file, makes no branch, and sends nothing.
// It reads only tracked files, and never an environment file other than an example one (.env.example, .env.sample,
// .env.template, .env.dist), whose variable names alone are kept. Values are never read into the survey. From
// GitHub it reads the repository's permission, visibility, default branch and open pull requests, and of its
// variables it keeps only DEV_OS's four module switches. Author emails are counted, never kept.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { loadCatalogue } from "./catalogue.mjs";
import { engineRoot, engineVersion, hashFile, insideEngine, LOCK, readManifest } from "./engine.mjs";
import { hubExec } from "./hub.mjs";
import { slugFromRemote } from "./models.mjs";
import { toInstalled } from "./paths.mjs";

export const SURVEY_SCHEMA = "devos-survey/1";
const USAGE = "usage: devos adopt --check [folder] [--json]";
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

export function adoptCommand(args) {
  const json = args.includes("--json");
  const rest = args.filter((arg) => arg !== "--json");
  if (rest[0] !== "--check" || rest.length > 2 || rest.slice(1).some((arg) => arg.startsWith("-"))) {
    console.log(USAGE);
    console.log("devos: adopt --check surveys a project and changes nothing; adding DEV_OS to it comes in a later version");
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
