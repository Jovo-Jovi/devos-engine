#!/usr/bin/env node
// How deep the review goes, decided by the runner after the build (PR-22).
//
//   light  risk 1–2, no gate, no critical path touched: the light reviewer (or the reviewer), evidence-first, spot checks.
//   deep   risk 3, a gate, or the diff touches a critical path (devos.config.json
//          reviewer.deep_paths: migrations, auth, headers, workflows…): the reviewer, every changed line
//          of the critical files, targeted probes only.
// The agents and models are the ones the developer chose (agents in devos.config.json, PR-53); no fallback model.
//
// A retry (attempt 2+) raises the effort one step: the cheap review missed something or the task is hard.
// Usage: node scripts/devos/review-mode.mjs --task T12 --attempt 1
// Emits: mode, model, effort, max_turns, fallback, reasons, critical (comma-separated paths)
import { execFileSync } from "node:child_process";
import { P, config, parsePhases, globToRegExp, emit, fail, isMethodRow } from "./lib.mjs";
import { reviewerFor } from "./agents.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? "") : ""; };
const EFFORTS = ["low", "medium", "high", "xhigh"];
const hasGate = (row) => Boolean(row.gate && row.gate !== "—" && row.gate !== "-");

/** The review plan for a task. `changed` is the branch's diff against the base (empty before the build). */
export function reviewPlan(row, changed = [], attempt = 1, cfg = config()) {
  const r = cfg.reviewer;
  const deepRes = (r.deep_paths ?? []).map(globToRegExp);
  const critical = changed.filter((p) => deepRes.some((re) => re.test(p)));
  const reasons = [];
  if (hasGate(row)) reasons.push(`closes gate ${row.gate}`);
  if (row.risk >= 3) reasons.push("risk 3");
  if (critical.length) reasons.push(`touches critical paths (${critical.slice(0, 6).join(", ")}${critical.length > 6 ? ", …" : ""})`);
  const mode = reasons.length ? "deep" : "light";
  const m = r.modes?.[mode] ?? {};
  let effort = hasGate(row) ? (r.gate_effort ?? m.effort) : m.effort;
  if (attempt > 1 && r.escalate_on_retry !== false) {
    const i = Math.min(EFFORTS.indexOf(effort) + 1, EFFORTS.length - 1);
    if (EFFORTS[i] !== effort) reasons.push(`retry: effort raised to ${EFFORTS[i]}`);
    effort = EFFORTS[i];
  }
  const gateOrMethod = hasGate(row) || isMethodRow(row);
  // PR-53: a project with agents is reviewed only by the agent and model the developer chose, with no fallback model.
  const model = cfg.agents ? reviewerFor(gateOrMethod ? "deep" : mode, cfg.agents).model : (gateOrMethod ? r.gate_model : m.model);
  return {
    mode, model, effort, max_turns: m.max_turns ?? r.max_turns ?? 80,
    fallback: !cfg.agents && r.fallback_model && r.fallback_model !== model ? r.fallback_model : "",
    reasons: reasons.length ? reasons : ["risk 1–2, no gate, no critical path"],
    critical,
  };
}

export function branchChanges(base = config().base_branch ?? "main") {
  try {
    return execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { cwd: P(), encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

if (process.argv[1]?.endsWith("review-mode.mjs")) {
  const { rows } = parsePhases();
  const row = rows.find((x) => x.task === arg("task"));
  if (!row) fail(`review-mode: ${arg("task")} not in docs/PHASES.md`);
  const plan = reviewPlan(row, branchChanges(), Number(arg("attempt") || "1"));
  emit({ ...plan, reasons: plan.reasons.join("; "), critical: plan.critical.join(",") });
}
