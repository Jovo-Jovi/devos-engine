#!/usr/bin/env node
// Resolve which task the runner works on, and everything the workflow needs to know about it.
// Usage: node scripts/devos/next-task.mjs [--task T01|link] [--attempt 1] [--revision true]
// PR-65: --task link is a run with no task: it says done, so only the report job runs and asks for the link.
import { execFileSync } from "node:child_process";
import { parsePhases, nextOpenTask, isHumanGate, isMethodRow, reviewerModel, reviewerEffort, taskAfter, config, emit, fail } from "./lib.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "").trim() : "";
};

if (arg("task").toLowerCase() === "link") {
  emit({ done: "true", task: "", reason: "a link run: no task; the report job asks the DEV_OS registry for the link" });
  process.exit(0);
}

const cfg = config();
const { rows } = parsePhases();
// Accept "T01", "t1" or "1" from the workflow form.
const rawTask = arg("task");
const wanted = /^t?\d{1,2}$/i.test(rawTask) ? `T${rawTask.replace(/^t/i, "").padStart(2, "0")}` : rawTask.toUpperCase();
const attempt = Number(arg("attempt") || "1");

if (!Number.isInteger(attempt) || attempt < 1) fail(`invalid attempt "${arg("attempt")}"`);
const row = wanted ? rows.find((r) => r.task === wanted) : nextOpenTask(rows);

// A human revision (/devos revise) may go past max_attempts; automatic retries may not.
// The revision is a fact of the task branch (devos-intake commits "Tnn: fence reissued for human
// revision (attempt N)"), so a run resumed after a usage limit, a stall or by the supervisor keeps it
// even when its dispatch did not pass --revision.
function revisedOnBranch(task, n) {
  if (!task) return false;
  try {
    execFileSync("git", ["fetch", "-q", "--depth=300", "origin", `+refs/heads/task/${task}:refs/remotes/origin/task/${task}`], { stdio: "ignore" });
    const log = execFileSync("git", ["log", `origin/task/${task}`, "-300", "--format=%s"], { encoding: "utf8" });
    return log.split("\n").some((s) => s === `${task}: fence reissued for human revision (attempt ${n})`);
  } catch { return false; }
}
if (attempt > cfg.max_attempts && arg("revision") !== "true" && !revisedOnBranch(row?.task, attempt)) fail(`attempt ${attempt} exceeds max_attempts ${cfg.max_attempts}`);
if (wanted && !row) fail(`task ${wanted} is not in docs/PHASES.md`);
if (!row) {
  emit({ done: "true", task: "", reason: "every task in docs/PHASES.md is ticked" });
  process.exit(0);
}
if (row.done) fail(`task ${row.task} is already ticked PASS in docs/PHASES.md`);

// Previous rows must be done: one task at a time, in order (Dev OS §7). Method fixes (Phase PM,
// PR-28) are their own track: they run whatever product task is open, and never block one.
const earlierOpen = isMethodRow(row) ? null : rows.slice(0, rows.indexOf(row)).find((r) => !r.done && !isMethodRow(r));
if (earlierOpen) fail(`task ${row.task} cannot start: ${earlierOpen.task} is not PASS yet`);

const next = taskAfter(rows, row.task);
emit({
  done: "false",
  task: row.task,
  name: row.name,
  phase: row.phase,
  method: isMethodRow(row) ? "true" : "false",
  risk: row.risk,
  gate: row.gate,
  human_gate: isHumanGate(row) ? "true" : "false",
  attempt,
  max_attempts: cfg.max_attempts,
  branch: `${cfg.branch_prefix}${row.task}`,
  builder_model: cfg.builder.model,
  reviewer_model: reviewerModel(row, cfg),
  reviewer_max_turns: cfg.reviewer.max_turns,
  reviewer_effort: reviewerEffort(row, cfg),
  reviewer_fallback: !cfg.agents && cfg.reviewer.fallback_model && cfg.reviewer.fallback_model !== reviewerModel(row, cfg) ? cfg.reviewer.fallback_model : "",
  next_task: next ? next.task : "",
});
