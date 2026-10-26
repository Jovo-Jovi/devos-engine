// devos verify and devos watch (E21): one audit of everything between this computer and a green devos-cycle run.
// It checks the machine, the GitHub CLI, the project's setup steps (the checklist of devos continue) and the newest
// cycle run. A failed run is diagnosed from its own annotations and the last lines of its failed steps. Every open
// row names its fix and who applies it: you, devos continue, or the cycle itself.
// Nothing here reads, prints or sends a key value: GitHub lists secret names only, and its logs are already masked.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ghPreflight } from "./accounts.mjs";
import { DEFAULT_USAGE_LIMIT_PATTERNS, MODEL_REJECTION_PATTERNS } from "./adapters.mjs";
import { neededKeys } from "./keys.mjs";
import { devosHome } from "./profile.mjs";
import { repoSlug } from "./setup.mjs";
import { run, which } from "./which.mjs";

const TIMEOUT = 120000;
const WORKFLOW = "devos-cycle.yml";

/** Runs a command and returns { status, stdout }, or null when the command is not installed. */
export function hostExec(cmd, args, cwd) {
  const result = run(cmd, args, { cwd, timeout: TIMEOUT });
  if (!result) return null;
  return { status: result.status, stdout: String(result.stdout ?? "") };
}

function json(result) {
  if (!result || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function row(section, label, state, detail, fix = null, who = null, extra = {}) {
  return { section, label, state, detail, fix, who, ...extra };
}

function quoted(folder) {
  return /\s/.test(folder) ? `"${folder}"` : folder;
}

// ---------- The project's steps (devos continue prints the same checklist) ----------

function ownerOf(folder, exec) {
  try {
    const file = path.join(devosHome(), ".devos", "profile.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data.github_owner === "string" && data.github_owner.length > 0) return data.github_owner;
  } catch {
    /* an unreadable profile falls through to gh */
  }
  const login = exec("gh", ["api", "user", "--jq", ".login"], folder);
  if (!login || login.status !== 0) return "";
  return login.stdout.trim();
}

export function committed(folder, exec = hostExec) {
  const head = exec("git", ["rev-parse", "HEAD"], folder);
  return Boolean(head && head.status === 0);
}

function repoReady(folder, slug, exec) {
  const remote = exec("git", ["remote", "get-url", "origin"], folder);
  if (!remote || remote.status !== 0 || !remote.stdout.trim()) return false;
  const view = exec("gh", ["repo", "view", slug, "--json", "name"], folder);
  return Boolean(view && view.status === 0);
}

/** The keys the cycle needs that GitHub does not list for the repository (names only). */
export function keyCheck(folder, answers, slug, exec = hostExec) {
  let setup;
  try {
    setup = JSON.parse(readFileSync(path.join(folder, "devos", "setup.json"), "utf8"));
  } catch {
    return { ok: false, missing: [], error: "devos/setup.json is missing" };
  }
  let agents = {};
  try {
    agents = JSON.parse(readFileSync(path.join(folder, "devos.config.json"), "utf8")).agents ?? {};
  } catch {
    agents = {};
  }
  const names = neededKeys(setup, answers, agents).filter((key) => !key.optional).map((key) => key.name);
  const listed = json(exec("gh", ["secret", "list", "--repo", slug, "--json", "name"], folder));
  if (!Array.isArray(listed)) return { ok: false, missing: [], error: "gh could not list the repository's secrets" };
  const have = new Set(listed.map((item) => item?.name));
  const missing = names.filter((name) => !have.has(name));
  return { ok: missing.length === 0, missing, error: "" };
}

/** The newest devos-cycle run: { databaseId, status, conclusion, url }, or null. */
export function latestRun(folder, slug, exec = hostExec) {
  const rows = json(exec("gh", [
    "run", "list", "--repo", slug, "--workflow", WORKFLOW, "--limit", "1", "--json", "databaseId,status,conclusion,url",
  ], folder));
  if (!Array.isArray(rows)) return null;
  return rows.find((item) => item && item.databaseId != null) ?? null;
}

export function projectSteps(folder, exec = hostExec) {
  const answersFile = path.join(folder, "devos", "answers.json");
  const hasAnswers = existsSync(answersFile);
  const hasLock = existsSync(path.join(folder, "devos", "engine.lock.json"));
  const approved = existsSync(path.join(folder, ".claude", "settings.json"));
  const hasCommit = hasAnswers && committed(folder, exec);
  let answers = null;
  if (hasAnswers) {
    try {
      answers = JSON.parse(readFileSync(answersFile, "utf8"));
    } catch {
      answers = null;
    }
  }
  const slug = answers ? repoSlug(ownerOf(folder, exec), answers) : "";
  const hasRepo = Boolean(hasCommit && slug && repoReady(folder, slug, exec));
  const keys = hasCommit && slug && answers ? keyCheck(folder, answers, slug, exec) : { ok: false, missing: [], error: "" };
  const cycle = hasCommit && slug ? latestRun(folder, slug, exec) : null;
  const steps = [
    { ok: hasAnswers, name: "answers", who: "devos" },
    { ok: hasLock, name: "engine files", who: "devos" },
    { ok: approved, name: "blueprint approved", who: "you" },
    { ok: hasCommit, name: "local commit", who: "devos" },
    { ok: hasRepo, name: "repository", who: "devos" },
    { ok: Boolean(hasCommit && slug && keys.ok), name: "keys", who: "you" },
    { ok: Boolean(cycle), name: "first cycle", who: "devos" },
  ];
  return { answers, slug, steps, keys, cycle };
}

// ---------- A failed run, in its own words ----------

const ANSI = /\x1b\[[0-9;]*m/g;
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const GENERIC = /^Process completed with exit code \d+\.?$/;
// Error lines: a failed test, an error, the setup check's MISSING rows, a builder's HALT.
const STRONG = /^(?:not ok\b|error\b|[A-Za-z]*Error\b|npm ERR!|FAIL\b|MISSING\b|HALT\b|✖|fatal:)/;
const NOTABLE = /error|fail|not ok|denied|refused|missing|limit|cannot|can't|unable|invalid|not found|not recognized|unauthori[sz]ed|forbidden|timed out|exceeded/i;

/**
 * The failed step's own output. `gh run view --log-failed` prints "<job>\t<step>\t<time> <text>" for the whole job,
 * and its step column is often "UNKNOWN STEP", so the step is cut from the log itself: from the last step start
 * (`##[group]Run …`) before the last `##[error]` line, to that line. The job's clean-up steps after it are dropped,
 * and GitHub's error marker reads `error: …`.
 */
export function failedStepLines(output) {
  const raw = String(output ?? "").split(/\r?\n/).map((line) => line.split("\t").pop().replace(ANSI, "").replace(STAMP, ""));
  let end = raw.length - 1;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i].startsWith("##[error]")) {
      end = i;
      break;
    }
  }
  let start = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (raw[i].startsWith("##[group]Run ")) {
      start = i + 1;
      break;
    }
  }
  return raw
    .slice(start, end + 1)
    .map((line) => line.replace(/^##\[warning\]/, "").trim())
    .filter((line) => line !== "" && !GENERIC.test(line.replace(/^##\[error\]/, "")))
    .map((line) => line.replace(/^##\[error\]/, "error: "))
    .filter((line) => !line.startsWith("##[") && !line.startsWith("[command]"));
}

function failedJobs(view) {
  const jobs = Array.isArray(view?.jobs) ? view.jobs : [];
  return jobs.filter((job) => job && job.conclusion && !["success", "skipped", "neutral"].includes(job.conclusion));
}

/** What the failed run said: its failure annotations, then the failed step's error lines (or, without any, its last lines). */
export function runWords(folder, slug, id, exec = hostExec) {
  const view = json(exec("gh", ["run", "view", String(id), "--repo", slug, "--json", "jobs"], folder));
  const said = [];
  for (const job of failedJobs(view)) {
    if (job.databaseId == null) continue;
    const notes = json(exec("gh", ["api", `repos/${slug}/check-runs/${job.databaseId}/annotations`], folder));
    for (const note of Array.isArray(notes) ? notes : []) {
      const message = String(note?.message ?? "").trim();
      if (note?.annotation_level === "failure" && message && !GENERIC.test(message)) said.push(message);
    }
  }
  const log = exec("gh", ["run", "view", String(id), "--repo", slug, "--log-failed"], folder);
  const lines = log && log.status === 0 ? failedStepLines(log.stdout) : [];
  const strong = lines.filter((line) => STRONG.test(line));
  const loud = lines.filter((line) => NOTABLE.test(line));
  const tail = (strong.length ? strong : loud.length ? loud : lines).slice(-8);
  return { said, tail, jobs: failedJobs(view).map((job) => job.name).filter(Boolean) };
}

const KEY_NAME = /\b([A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET))\b/;

/**
 * The likely cause of a failed cycle run, its fix, and who applies it.
 * `text` is what the run said; `conclusion` is GitHub's; `missingKeys` are the keys GitHub does not list.
 */
export function diagnoseRun({ text = "", conclusion = "", folder = ".", slug = "<owner>/<repo>", missingKeys = [] } = {}) {
  const again = `gh workflow run ${WORKFLOW} --repo ${slug}`;
  const upgrade = "In the project folder, on main: devos upgrade. It opens a pull request with the engine's current files; merge it.";
  if (missingKeys.length) {
    return {
      cause: `the cycle needs keys that are not on GitHub: ${missingKeys.join(", ")}`,
      fix: `devos continue ${quoted(folder)} asks for each value once, hidden, and gh stores it`,
      who: "you",
    };
  }
  if (/needs settings that are missing|setup needed/i.test(text)) {
    return {
      cause: "the cycle needs settings outside the repository",
      fix: "Add what the 'Dev OS: setup needed' issue lists (the repository's Issues tab). The cycle checks again by itself.",
      who: "you",
    };
  }
  if (DEFAULT_USAGE_LIMIT_PATTERNS.some((re) => re.test(text))) {
    return {
      cause: "an agent reached its usage limit: a wait, not a failure",
      fix: "Nothing to do. The cycle parks the task and resumes it when the limit resets.",
      who: "cycle",
    };
  }
  if (/resource not accessible by integration|not permitted to create or approve pull requests/i.test(text)) {
    return {
      cause: "the workflow token may not change the repository or open pull requests",
      fix: `GitHub → the repository → Settings → Actions → General → Workflow permissions: choose "Read and write permissions" and allow GitHub Actions to create and approve pull requests. Then: ${again}`,
      who: "you",
    };
  }
  if (MODEL_REJECTION_PATTERNS.some((re) => re.test(text))) {
    return {
      cause: "the agent's account does not offer the chosen model",
      fix: "Pick a model the account lists (devos agents detect), set it under agents in devos/project.json, run node scripts/devos/config.mjs --write, then commit and push.",
      who: "you",
    };
  }
  if (/authentication required|invalid (?:x-)?api[ _-]?key|bad credentials|unauthorized|\b401\b|authentication_error|invalid_grant|exited with code null/i.test(text)) {
    const name = (text.match(KEY_NAME) ?? [])[1] ?? "<NAME>";
    return {
      cause: "a key was refused or empty: its value is wrong or expired",
      fix: `Set it again: gh secret set ${name} --repo ${slug} (gh asks for the value and never shows it). Then: ${again}`,
      who: "you",
    };
  }
  if (conclusion === "startup_failure" || /invalid workflow file|is not well-formed|unrecognized named-value|unexpected value/i.test(text)) {
    return { cause: "a workflow file is invalid", fix: upgrade, who: "you" };
  }
  if (/command not found|is not recognized as an internal or external command/i.test(text)) {
    return { cause: "a tool the cycle needs is missing on the runner", fix: upgrade, who: "you" };
  }
  if (conclusion === "timed_out" || /exceeded the maximum execution time|timed out/i.test(text)) {
    return { cause: "a step ran out of time", fix: `Start a new run; it continues the same task branch: ${again}`, who: "you" };
  }
  if (conclusion === "cancelled") {
    return { cause: "the run was cancelled", fix: `Start a new run: ${again}`, who: "you" };
  }
  return {
    cause: "no known cause: the run's own words are quoted above",
    fix: "Open the run on GitHub and read its failed step, then fix what it names.",
    who: "you",
  };
}

function activeStep(view) {
  let total = 0;
  let done = 0;
  let active = "";
  for (const job of Array.isArray(view?.jobs) ? view.jobs : []) {
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      total += 1;
      if (step.status === "completed") done += 1;
      else if (!active && step.status === "in_progress") active = step.name ?? "";
    }
    if (!active && job?.status === "in_progress") active = job.name ?? "";
  }
  return { total, done, active };
}

const RUN_LABEL = "newest devos-cycle run";

export function cycleRows(folder, state, exec = hostExec) {
  const cycle = state.cycle;
  if (!cycle) return [];
  const id = cycle.databaseId;
  const url = cycle.url || `https://github.com/${state.slug}/actions/runs/${id}`;
  const status = cycle.status || "";
  if (status !== "completed") {
    const view = status ? json(exec("gh", ["run", "view", String(id), "--repo", state.slug, "--json", "jobs"], folder)) : null;
    const step = activeStep(view);
    const where = step.active ? ` · step: ${step.active} (${step.done}/${step.total} steps done)` : "";
    return [row("cycle", RUN_LABEL, "wait", `${status || "dispatched"}${where} · ${url}`, null, "cycle")];
  }
  if (cycle.conclusion === "success") return [row("cycle", RUN_LABEL, "ok", `green · ${url}`)];
  const words = runWords(folder, state.slug, id, exec);
  // A log line that repeats an annotation is quoted once.
  const quote = [...words.said, ...words.tail.filter((line) => !words.said.includes(line.replace(/^error: /, "")))].slice(-6);
  const diagnosis = diagnoseRun({
    text: [...words.said, ...words.tail].join("\n"),
    conclusion: cycle.conclusion || "",
    folder,
    slug: state.slug,
    missingKeys: state.keys?.missing ?? [],
  });
  const jobs = words.jobs.length ? ` in ${words.jobs.join(", ")}` : "";
  return [row("cycle", RUN_LABEL, "block", `${cycle.conclusion || "failed"}${jobs} · ${url}`, diagnosis.fix, diagnosis.who, {
    said: quote,
    cause: diagnosis.cause,
  })];
}

// ---------- The audit ----------

const OPEN_DETAIL = {
  "engine files": "devos/engine.lock.json is missing",
  "blueprint approved": "the blueprint is not approved yet",
  "local commit": "nothing is committed yet",
  "first cycle": "no devos-cycle run yet",
};
const DONE_DETAIL = {
  answers: "devos/answers.json",
  "engine files": "devos/engine.lock.json",
  "blueprint approved": "approved",
  "local commit": "committed",
  keys: "every key the cycle needs is on GitHub",
  "first cycle": "dispatched",
};

export function projectRows(folder, state) {
  const rows = [];
  const resume = `devos continue ${quoted(folder)}`;
  let first = "";
  for (const step of state.steps) {
    if (step.ok) {
      rows.push(row("project", step.name, "ok", step.name === "repository" ? state.slug : DONE_DETAIL[step.name]));
      continue;
    }
    if (first) {
      rows.push(row("project", step.name, "block", `after ${first}`));
      continue;
    }
    first = step.name;
    if (step.name === "engine files") {
      rows.push(row("project", step.name, "block", OPEN_DETAIL[step.name], "Start again in a new, empty folder: devos init", "you"));
    } else if (step.name === "blueprint approved") {
      rows.push(row("project", step.name, "block", OPEN_DETAIL[step.name], `${resume} checks the documents, has your blueprint agent fix what fails, then asks you to approve`, "you"));
    } else if (step.name === "repository") {
      rows.push(row("project", step.name, "block", `${state.slug} is not on GitHub, or this folder has no origin`, resume, "devos"));
    } else if (step.name === "keys") {
      const detail = state.keys.missing.length ? `missing on GitHub: ${state.keys.missing.join(", ")}` : state.keys.error || "not checked yet";
      rows.push(row("project", step.name, "block", detail, `${resume} asks for each value once, hidden, and gh stores it`, "you"));
    } else {
      rows.push(row("project", step.name, "block", OPEN_DETAIL[step.name], resume, "devos"));
    }
  }
  return rows;
}

function machineRows(nodeVersion, gitFound) {
  const major = Number(String(nodeVersion).split(".")[0]);
  return [
    major >= 22
      ? row("machine", "Node.js", "ok", `v${nodeVersion}`)
      : row("machine", "Node.js", "block", `v${nodeVersion}; DEV_OS needs 22 or newer`, "Install Node.js 22 or newer from nodejs.org", "you"),
    gitFound
      ? row("machine", "git", "ok", "installed")
      : row("machine", "git", "block", "not installed", "Install git from git-scm.com", "you"),
  ];
}

function githubRow(preflight) {
  if (!preflight.installed) {
    return row("github", "gh", "block", "not installed", "Install the GitHub CLI from cli.github.com, then run: gh auth login", "you");
  }
  if (!preflight.signedIn) return row("github", "gh", "block", "not signed in", "Run: gh auth login", "you");
  if (!preflight.tokenWorks) return row("github", "gh", "block", "the GitHub API refused its token", "Run: gh auth login", "you");
  const missing = ["repo", "workflow"].filter((scope) => !(preflight.scopes ?? []).includes(scope));
  if (missing.length) {
    return row("github", "gh", "block", `the token lacks the ${missing.join(" and ")} scope`, `Run: gh auth refresh -h github.com -s ${missing.join(",")}`, "you");
  }
  return row("github", "gh", "ok", `signed in as ${preflight.login ?? "an account"} (repo, workflow)`);
}

export function isProject(folder) {
  return Boolean(folder) && existsSync(path.join(folder, "devos", "answers.json"));
}

export function audit({
  folder = process.cwd(),
  exec = hostExec,
  preflight = ghPreflight,
  nodeVersion = process.versions.node,
  gitFound = () => which("git") !== null,
} = {}) {
  const github = githubRow(preflight());
  const rows = [...machineRows(nodeVersion, gitFound()), github];
  if (!isProject(folder)) {
    rows.push(row("project", "DEV_OS project", "ok", `none in ${folder}: machine and GitHub only`));
  } else if (github.state !== "ok") {
    rows.push(row("project", "DEV_OS project", "block", "checked once the GitHub CLI above is ready"));
  } else {
    const state = projectSteps(folder, exec);
    rows.push(...projectRows(folder, state), ...cycleRows(folder, state, exec));
  }
  return { folder, rows, ready: rows.every((item) => item.state === "ok") };
}

// ---------- Printing ----------

const MARK = { ok: "ok  ", wait: "wait", block: "STOP" };
const WHO = { you: "you", devos: "devos continue", cycle: "the cycle (nothing to do)" };

export function formatRows(result, changed = new Set()) {
  const lines = [];
  let section = "";
  for (const item of result.rows) {
    if (item.section !== section) {
      section = item.section;
      if (lines.length) lines.push("");
      lines.push(section.toUpperCase());
    }
    const flag = changed.has(`${item.section}/${item.label}`) ? "*" : " ";
    lines.push(` ${flag}${MARK[item.state]}  ${item.label}: ${item.detail}`);
    for (const said of item.said ?? []) lines.push(`        said: ${said}`);
    if (item.cause) lines.push(`        cause: ${item.cause}`);
    if (item.fix) lines.push(`        fix: ${item.fix}`);
    if (item.who) lines.push(`        who: ${WHO[item.who] ?? item.who}`);
  }
  return lines.join("\n");
}

export function summary(result) {
  if (result.ready) return "Ready: the machine, GitHub, the project and its newest cycle run are green.";
  const open = result.rows.filter((item) => item.state === "block" && item.who);
  const you = open.filter((item) => item.who === "you").length;
  const devos = open.filter((item) => item.who === "devos").length;
  const running = result.rows.filter((item) => item.state === "wait").length;
  const parts = [`${you} for you`, `${devos} for devos continue`];
  if (running) parts.push(`${running} running`);
  return `Not ready: ${parts.join(", ")}.`;
}

export function verifyCommand(args) {
  if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
    console.log("usage: devos verify [folder]");
    return 2;
  }
  const result = audit({ folder: path.resolve(args[0] ?? process.cwd()) });
  console.log(`devos verify · ${result.folder}\n`);
  console.log(formatRows(result));
  console.log(`\n${summary(result)}`);
  return result.ready ? 0 : 1;
}

// ---------- Watch ----------

/** Repeats the audit until every row is green; a row whose state changed since the last pass is marked `*`. */
export async function watch({
  folder = process.cwd(),
  intervalMs = 30000,
  once = false,
  maxPasses = Infinity,
  auditFn = () => audit({ folder }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out = (text) => console.log(text),
  now = () => new Date(),
} = {}) {
  const seen = new Map();
  const limit = once ? 1 : maxPasses;
  let pass = 0;
  let result = null;
  while (pass < limit) {
    pass += 1;
    result = auditFn();
    const changed = new Set();
    for (const item of result.rows) {
      const key = `${item.section}/${item.label}`;
      if (seen.has(key) && seen.get(key) !== item.state) changed.add(key);
      seen.set(key, item.state);
    }
    const stamp = now().toISOString().replace("T", " ").slice(0, 19);
    out(`pass ${pass} · ${stamp}${changed.size ? ` · ${changed.size} changed` : ""}`);
    out(formatRows(result, changed));
    if (result.ready) {
      out("ALL GREEN: the machine, GitHub, the project and its newest cycle run. The watch stops here.");
      return { ready: true, passes: pass, result };
    }
    if (pass >= limit) {
      out(summary(result));
      return { ready: false, passes: pass, result };
    }
    out(`${summary(result)} Next pass in ${Math.round(intervalMs / 1000)} s (Ctrl-C stops).\n`);
    await sleep(intervalMs);
  }
  return { ready: false, passes: pass, result };
}

const WATCH_USAGE = "usage: devos watch [folder] [--interval <seconds, 5 or more>] [--once]";

export function watchArgs(args) {
  let folder = "";
  let intervalMs = 30000;
  let once = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--once") once = true;
    else if (arg === "--interval") {
      const seconds = Number(args[i + 1]);
      if (!Number.isInteger(seconds) || seconds < 5) return null;
      intervalMs = seconds * 1000;
      i += 1;
    } else if (arg.startsWith("-") || folder) return null;
    else folder = arg;
  }
  return { folder: path.resolve(folder || process.cwd()), intervalMs, once };
}

export async function watchCommand(args) {
  const parsed = watchArgs(args);
  if (!parsed) {
    console.log(WATCH_USAGE);
    return 2;
  }
  if (!isProject(parsed.folder)) {
    console.log(`devos: no DEV_OS project in ${parsed.folder}; start one with devos init`);
    return 1;
  }
  const outcome = await watch(parsed);
  return outcome.ready ? 0 : 1;
}
