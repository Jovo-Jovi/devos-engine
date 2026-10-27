#!/usr/bin/env node
// The DEV_OS registry link and the step events (PR-61), the registry's event contract v1.
//
//   note --step <step> --status <status> [--evidence <path@sha | @sha>]
//        In the cycle job: append one event to .devos/journal.jsonl. No network and no token: the job where the
//        agents run never holds the OIDC permission.
//   note --failed
//        The step that started and never ended (.devos/report-state.json) ends as `fail`.
//   link In the report job: ask the registry to link this repository. Its owner approves it once; the answer
//        (linked with the project's key, pending, declined, busy) is kept in .devos/link.json.
//   flush
//        In the report job, when the repository is linked: send every unsent event once, in order.
//   history
//        PR-66, in a link run's report job, when the repository is linked: one event for each task of docs/PHASES.md,
//        so the registry shows the project's plan and progress. A finished task is `verdict pass`, dated by the commit
//        that added its review; a task still to do is `intake pass`, dated by the commit of the plan. All of them form
//        one run, `import-<that commit>`, so a second link run on the same plan sends only duplicates.
//   --dry
//        Print what would be sent, never a token, and send nothing.
//
// Every command exits 0: reporting never blocks a run. The registry trusts GitHub's OIDC identity of the workflow,
// so no key or token is stored anywhere. Nothing here reads a secret, the code, a diff or a prompt.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, parsePhases } from "./lib.mjs";

const JOURNAL = ".devos/journal.jsonl";
const STATE = ".devos/report-state.json";
const LINK = ".devos/link.json";
const LIMIT_BYTES = 2048;
const TIMEOUT_MS = 5000;
// PR-66: the registry stores at most 60 reported events a project in any minute, so history stores at most 50 in any
// 61 seconds, for at most 5 minutes a link run; the next link run sends the rest (what was stored comes back as a
// duplicate). GitHub's OIDC token lives 5 minutes, so it is asked for again every 4 minutes and once after a 401.
// History goes only to a project that accepted contract 2 or later, which describes it.
const HISTORY_RATE = 50;
const HISTORY_WINDOW_MS = 61000;
const HISTORY_BUDGET_MS = 300000;
const HISTORY_TOKEN_MS = 240000;
const HISTORY_CONTRACT = 2;
// The evidence allows 160 characters before the @: "docs/reviews/" (13), the name (up to 144) and ".md" (3).
const REVIEW = /(docs\/reviews\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,143}\.md)/;

export const STEPS = {
  intake: ["pass", "fail", "waiting", "skipped"],
  fence: ["pass", "fail"],
  build: ["started", "pass", "fail", "waiting"],
  checks: ["pass", "fail", "skipped"],
  guards: ["pass", "fail"],
  evidence: ["pass", "fail"],
  review: ["started", "pass", "fail", "waiting"],
  verdict: ["pass", "fail", "revise", "waiting"],
  gate: ["pass", "waiting", "skipped"],
  merge: ["pass", "fail"],
  deploy: ["started", "pass", "fail", "waiting", "skipped"],
};

const PATTERN = {
  project: /^[A-Z][A-Z0-9_-]{1,31}$/,
  run: /^(gha-[0-9]{1,20}-[0-9]{1,3}|local-[0-9A-HJKMNP-TV-Z]{26}|import-[0-9a-f]{7,40})$/,
  phase: /^[A-Z][A-Z0-9-]{0,15}$/,
  task: /^[A-Z]{1,3}[0-9]{2,3}$/,
  at: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/,
  evidence: /^([A-Za-z0-9][A-Za-z0-9._/-]{0,159})?@[0-9a-f]{7,40}$/,
};
const FIELDS = ["v", "project", "run", "seq", "phase", "task", "step", "status", "at", "evidence"];

/** The problems of an event against the contract's schema (§1.1); empty when it is valid. */
export function problems(event) {
  const found = [];
  const keys = Object.keys(event ?? {});
  for (const key of keys) if (!FIELDS.includes(key)) found.push(`unknown field ${key}`);
  for (const key of FIELDS) if (!keys.includes(key)) found.push(`missing ${key}`);
  if (event.v !== 1) found.push("v is not 1");
  if (typeof event.project !== "string" || !PATTERN.project.test(event.project)) found.push("project");
  if (typeof event.run !== "string" || !PATTERN.run.test(event.run)) found.push("run");
  if (!Number.isInteger(event.seq) || event.seq < 1 || event.seq > 100000) found.push("seq");
  for (const key of ["phase", "task"]) {
    if (event[key] !== null && (typeof event[key] !== "string" || !PATTERN[key].test(event[key]))) found.push(key);
  }
  if (!STEPS[event.step]) found.push("step");
  else if (!STEPS[event.step].includes(event.status)) found.push(`status ${event.status} for ${event.step}`);
  if (typeof event.at !== "string" || !PATTERN.at.test(event.at)) found.push("at");
  if (event.evidence !== null && (typeof event.evidence !== "string" || event.evidence.length > 200 || !PATTERN.evidence.test(event.evidence))) {
    found.push("evidence");
  }
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > LIMIT_BYTES) found.push("larger than 2048 bytes");
  return found;
}

function readJson(rel, fallback) {
  try {
    return JSON.parse(readFileSync(P(rel), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(rel, value) {
  mkdirSync(P(".devos"), { recursive: true });
  writeFileSync(P(rel), `${JSON.stringify(value)}\n`);
}

function readJournal() {
  if (!existsSync(P(JOURNAL))) return [];
  return readFileSync(P(JOURNAL), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJournal(lines) {
  mkdirSync(P(".devos"), { recursive: true });
  writeFileSync(P(JOURNAL), lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length ? "\n" : ""));
}

function head() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: P(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: P(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function commitOf(line) {
  const [sha, at] = String(line ?? "").split("\t");
  const time = Date.parse(at ?? "");
  return /^[0-9a-f]{40}$/.test(sha ?? "") && Number.isFinite(time) ? { sha, at: new Date(time).toISOString() } : null;
}

/**
 * PR-66: the events of the project's plan, from docs/PHASES.md and the git history: paths and dates only, never a
 * file's contents, so a checkout without blobs (filter blob:none) is enough.
 * `read` runs git; a test passes its own. Returns { run, passed, planned, skipped } or { error }.
 */
export function historyEvents(key, read = git) {
  const plan = commitOf(read(["log", "--no-renames", "-1", "--format=%H%x09%cI", "--", "docs/PHASES.md"]));
  if (!plan) return { error: "docs/PHASES.md has no commit in this checkout" };
  let rows;
  try {
    rows = parsePhases(readFileSync(P("docs/PHASES.md"), "utf8")).rows;
  } catch {
    return { error: "docs/PHASES.md has no task table" };
  }
  const run = `import-${plan.sha}`;
  const passed = [];
  const planned = [];
  const skipped = [];
  rows.forEach((row, index) => {
    if (!PATTERN.task.test(row.task) || !PATTERN.phase.test(row.phase)) {
      skipped.push(row.task);
      return;
    }
    const base = { v: 1, project: key, run, seq: index + 1, phase: row.phase, task: row.task };
    if (!row.done) {
      planned.push({ ...base, step: "intake", status: "pass", at: plan.at, evidence: `docs/PHASES.md@${plan.sha}` });
      return;
    }
    const review = REVIEW.exec(row.verdict ?? "")?.[1];
    const added = review ? commitOf(read(["log", "--no-renames", "--diff-filter=A", "-1", "--format=%H%x09%cI", "--", review])) : null;
    passed.push({
      ...base,
      step: "verdict",
      status: "pass",
      at: added ? added.at : plan.at,
      evidence: added ? `${review}@${added.sha}` : `docs/PHASES.md@${plan.sha}`,
    });
  });
  return { run, passed, planned, skipped };
}

/**
 * Sends history events in this order: the passed tasks, then the planned ones from the last to the first, so the
 * registry's latest event is the first task still to do. At most `rate` stored events in any `windowMs` (a duplicate
 * is not stored, so it does not count), within `budgetMs`; a 429 waits a window and a 401 asks for a new token, each
 * once for the same event. Returns { stored, duplicate, conflict, left, error }.
 */
export async function sendHistory(events, { url, getToken, send = post, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), rate = HISTORY_RATE, windowMs = HISTORY_WINDOW_MS, budgetMs = HISTORY_BUDGET_MS, tokenMs = HISTORY_TOKEN_MS }) {
  const tally = { stored: 0, duplicate: 0, conflict: 0, left: 0, error: "" };
  const started = now();
  const storedAt = [];
  const stop = (index, error) => {
    tally.left = events.length - index;
    tally.error = error;
    return tally;
  };
  let token = await getToken();
  let tokenAt = now();
  if (!token) return stop(0, "no OIDC token");
  let retried = false;
  for (let index = 0; index < events.length; index += 1) {
    if (storedAt.length >= rate) {
      const wait = storedAt[storedAt.length - rate] + windowMs - now();
      if (wait > 0) await sleep(wait);
    }
    if (now() - started > budgetMs) return stop(index, "");
    if (now() - tokenAt > tokenMs) {
      token = await getToken();
      tokenAt = now();
      if (!token) return stop(index, "no OIDC token");
    }
    const reply = await send(url, token, events[index]);
    if (reply.status === 200) {
      retried = false;
      if (reply.answer?.duplicate) tally.duplicate += 1;
      else {
        tally.stored += 1;
        storedAt.push(now());
      }
    } else if (reply.status === 409) {
      retried = false;
      tally.conflict += 1;
    } else if (reply.status === 401 && !retried) {
      retried = true;
      token = await getToken();
      tokenAt = now();
      if (!token) return stop(index, "no OIDC token");
      index -= 1;
    } else if (reply.status === 429 && !retried) {
      retried = true;
      await sleep(windowMs);
      index -= 1;
    } else {
      return stop(index, reply.error ?? String(reply.answer?.error ?? reply.status));
    }
  }
  return tally;
}

function phaseOf(task) {
  if (!task) return null;
  try {
    const row = parsePhases().rows.find((item) => item.task === task);
    return row && PATTERN.phase.test(row.phase) ? row.phase : null;
  } catch {
    return null;
  }
}

/** One event for the journal. The project key is added when it is sent: only the registry's link answer knows it. */
export function noteEvent({ step, status, evidence, env = process.env, now = new Date() }) {
  const state = readJson(STATE, null) ?? { run: `gha-${env.GITHUB_RUN_ID ?? "0"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`, seq: 0, open: null };
  state.seq += 1;
  if (status === "started") state.open = step;
  else if (state.open === step) state.open = null;
  const task = PATTERN.task.test(env.TASK ?? "") ? env.TASK : null;
  const sha = head();
  const event = {
    v: 1,
    project: "PENDING",
    run: state.run,
    seq: state.seq,
    phase: phaseOf(task),
    task,
    step,
    status,
    at: now.toISOString(),
    evidence: evidence ?? (sha ? `@${sha}` : null),
  };
  return { event, state };
}

function note(args, out) {
  if (args.includes("--failed")) {
    const state = readJson(STATE, null);
    if (!state?.open) {
      out("devos report: no step was left open");
      return;
    }
    args = ["--step", state.open, "--status", "fail"];
  }
  const step = value(args, "--step");
  const status = value(args, "--status");
  const evidence = value(args, "--evidence");
  const { event, state } = noteEvent({ step, status, evidence: evidence || undefined });
  const found = problems(event);
  if (found.length) {
    out(`devos report: ${step} ${status} is not a valid event (${found.join(", ")}); nothing noted`);
    return;
  }
  if (args.includes("--dry")) {
    out(JSON.stringify(event));
    return;
  }
  writeJson(STATE, state);
  mkdirSync(P(".devos"), { recursive: true });
  appendFileSync(P(JOURNAL), `${JSON.stringify({ event, sent: false, attempts: 0, last_error: null, queued_at: event.at })}\n`);
  out(`devos report: noted ${step} ${status}`);
}

function registryUrl() {
  const cfg = readJson("devos.config.json", {});
  return String(cfg?.registry?.url ?? "").trim().replace(/\/+$/, "");
}

/** GitHub's OIDC token for this workflow, with the registry as its audience; null without the permission. */
async function oidc(audience, env = process.env) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) return null;
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}audience=${encodeURIComponent(audience)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.value === "string" && body.value ? body.value : null;
  } catch {
    return null;
  }
}

async function post(url, token, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let answer = {};
    try {
      answer = await response.json();
    } catch {
      answer = {};
    }
    return { status: response.status, answer };
  } catch (error) {
    return { status: 0, answer: {}, error: error?.name === "TimeoutError" ? "timeout" : "network" };
  }
}

function off(env) {
  return String(env.DEVOS_REPORTING ?? "").toLowerCase() === "off";
}

async function link(args, out, env = process.env) {
  const registry = registryUrl();
  if (off(env)) return out("devos report: reporting is off (DEVOS_REPORTING); nothing sent");
  if (!registry) {
    writeJson(LINK, { status: "none" });
    return out("devos report: no registry address in devos.config.json (registry.url); nothing sent");
  }
  const cfg = readJson("devos.config.json", {});
  const request = {
    v: 1,
    key: String(cfg.project ?? ""),
    engine: String(readJson("devos/engine.lock.json", {}).engine_version ?? ""),
    contract: String(readJson("devos/answers.json", {}).contract_version ?? ""),
  };
  if (args.includes("--dry")) return out(JSON.stringify({ url: `${registry}/api/link`, body: request }));
  const token = await oidc(registry, env);
  if (!token) {
    writeJson(LINK, { status: "none" });
    return out("devos report: no OIDC token (the job needs id-token: write; a fork has none); nothing sent");
  }
  const reply = await post(`${registry}/api/link`, token, request);
  if (reply.status === 200 && reply.answer?.status === "linked" && PATTERN.project.test(String(reply.answer.key ?? ""))) {
    writeJson(LINK, { status: "linked", key: reply.answer.key });
    return out(`devos report: linked to the DEV_OS registry as ${reply.answer.key}`);
  }
  if (reply.status === 202) {
    writeJson(LINK, { status: "pending" });
    return out("devos report: link requested; it waits for the registry owner's approval, and the next run asks again");
  }
  if (reply.status === 403) {
    writeJson(LINK, { status: "declined" });
    return out("devos report: the registry declined this repository's link; nothing is sent. To stop asking, set the repository variable DEVOS_REPORTING to off");
  }
  if (reply.status === 429) {
    writeJson(LINK, { status: "busy" });
    return out("devos report: the registry takes no new link requests right now; the next run asks again");
  }
  writeJson(LINK, { status: "unreachable" });
  return out(`devos report: the registry did not answer (${reply.error ?? reply.status}); the next run asks again`);
}

async function flush(args, out, env = process.env) {
  const lines = readJournal();
  const waiting = lines.filter((line) => line.sent === false);
  if (!waiting.length) return out("devos report: nothing to send");
  if (off(env)) return out(`devos report: reporting is off (DEVOS_REPORTING); ${waiting.length} events kept`);
  const linked = readJson(LINK, {});
  if (linked.status !== "linked") {
    return out(`devos report: not linked (${linked.status ?? "not asked"}); ${waiting.length} events kept, not sent`);
  }
  const registry = registryUrl();
  const dry = args.includes("--dry");
  const token = dry ? "" : await oidc(registry, env);
  if (!dry && !token) return out(`devos report: no OIDC token; ${waiting.length} events kept`);
  const tally = { sent: 0, duplicate: 0, conflict: 0, kept: 0 };
  for (const line of waiting) {
    const event = { ...line.event, project: linked.key };
    const found = problems(event);
    if (found.length) {
      line.attempts += 1;
      line.last_error = `invalid: ${found.join(", ")}`;
      tally.kept += 1;
      continue;
    }
    if (dry) {
      out(JSON.stringify(event));
      continue;
    }
    const reply = await post(`${registry}/api/ingest`, token, event);
    if (reply.status === 200) {
      line.event = event;
      line.sent = true;
      line.last_error = null;
      if (reply.answer?.duplicate) tally.duplicate += 1;
      else tally.sent += 1;
    } else if (reply.status === 409) {
      line.event = event;
      line.sent = "conflict";
      line.last_error = "duplicate_conflict";
      tally.conflict += 1;
      out(`devos report: conflict: ${event.run} seq ${event.seq}`);
    } else {
      line.attempts += 1;
      line.last_error = reply.error ?? String(reply.answer?.error ?? reply.status);
      tally.kept += 1;
    }
  }
  if (!dry) writeJournal(lines);
  return out(`devos report: sent ${tally.sent}, duplicate ${tally.duplicate}, conflict ${tally.conflict}, kept ${tally.kept}`);
}

async function history(args, out, env = process.env) {
  if (off(env)) return out("devos report: reporting is off (DEVOS_REPORTING); no history sent");
  const linked = readJson(LINK, {});
  if (linked.status !== "linked" || !PATTERN.project.test(String(linked.key ?? ""))) {
    return out(`devos report: the project's tasks wait for the link (${linked.status ?? "not asked"}); a link run after the approval sends them`);
  }
  const contract = String(readJson("devos/answers.json", {}).contract_version ?? "");
  if (!(/^[0-9]+$/.test(contract) && Number(contract) >= HISTORY_CONTRACT)) {
    return out(`devos report: the project's tasks are sent only to a project that accepted contract ${HISTORY_CONTRACT} or later, and this one accepted ${contract || "none"}; accept it again from the project's page (Connect)`);
  }
  const built = historyEvents(linked.key);
  if (built.error) return out(`devos report: ${built.error}; no history sent`);
  const events = [...built.passed, ...[...built.planned].reverse()].filter((event) => problems(event).length === 0);
  const what = `${built.passed.length + built.planned.length} tasks (${built.passed.length} passed, ${built.planned.length} planned)`;
  if (args.includes("--dry")) {
    for (const event of events) out(JSON.stringify(event));
    return out(`devos report: history of ${what}; nothing sent (--dry)`);
  }
  const registry = registryUrl();
  const tally = await sendHistory(events, { url: `${registry}/api/ingest`, getToken: () => oidc(registry, env) });
  if (tally.error === "no OIDC token" && tally.left === events.length) return out(`devos report: no OIDC token; the history of ${what} is not sent`);
  const rest = tally.left ? `, left ${tally.left} for the next link run${tally.error ? ` (${tally.error})` : ""}` : "";
  return out(`devos report: history of ${what}: stored ${tally.stored}, duplicate ${tally.duplicate}, conflict ${tally.conflict}${rest}`);
}

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? "") : "";
}

export async function main(argv = process.argv.slice(2), out = (line) => console.log(line)) {
  try {
    const [command, ...args] = argv;
    if (command === "note") note(args, out);
    else if (command === "link") await link(args, out);
    else if (command === "flush") await flush(args, out);
    else if (command === "history") await history(args, out);
    else out("usage: node scripts/devos/report.mjs note --step <step> --status <status> [--evidence <path@sha>] | note --failed | link | flush [--dry] | history [--dry]");
  } catch (error) {
    out(`devos report: ${error?.message ?? error}; nothing more is sent this run`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(0);
}
