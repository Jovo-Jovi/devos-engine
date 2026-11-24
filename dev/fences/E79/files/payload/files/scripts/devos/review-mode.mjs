#!/usr/bin/env node
// How deep the review goes, decided by the runner after the build (PR-22).
//
//   light  risk 1–2, no gate, no critical path touched: the light reviewer (or the reviewer), evidence-first, spot checks.
//   deep   risk 3, a gate, or the diff touches a critical path (devos.config.json
//          reviewer.deep_paths: migrations, auth, headers, workflows…, and every path of
//          reviewer.human_gate_paths, PR-72, and a changed file that imports a package of
//          reviewer.human_gate_imports, PR-73): the reviewer, every changed line of the critical files,
//          targeted probes only.
// The agents and models are the ones the developer chose (agents in devos.config.json, PR-53). The model here is the
// reviewer's first; the cycle tries its fallback_models after it (agents.mjs, accounts.sh devos_slots, PR-64).
//
// PR-99: the model and effort are the developer's: the light effort for a light review, the gate effort for a gate, the
// reviewer's effort for every other deep review. When the developer said yes to raise_on_retry, a retry (attempt 2+)
// raises the effort one step; it stops at xhigh: max is Claude Code's alone (PR-86), so only an effort set to max
// reviews at max.
// Usage: node scripts/devos/review-mode.mjs --task T12 --attempt 1
// Emits: mode, model, effort, max_turns, fallback, reasons, critical (comma-separated paths)
import { P, config, parsePhases, globToRegExp, diffPaths, emit, fail, isMethodRow, importsGated, raisesOnRetry, runChoice } from "./lib.mjs";
import { validate } from "./agents.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? "") : ""; };
const EFFORTS = ["low", "medium", "high", "xhigh"];
const hasGate = (row) => Boolean(row.gate && row.gate !== "—" && row.gate !== "-");

/** The review plan for a task. `changed` is the branch's diff against the base (empty before the build). */
export function reviewPlan(row, changed = [], attempt = 1, cfg = config()) {
  const r = cfg.reviewer;
  const deepRes = [...(r.deep_paths ?? []), ...(r.human_gate_paths ?? [])].map(globToRegExp);
  const imported = new Set(importsGated(changed, r.human_gate_imports ?? []));
  const seen = new Set();
  const critical = [];
  for (const p of changed) {
    if (seen.has(p)) continue;
    if (deepRes.some((re) => re.test(p)) || imported.has(p)) {
      seen.add(p);
      critical.push(p);
    }
  }
  const reasons = [];
  if (hasGate(row)) reasons.push(`closes gate ${row.gate}`);
  if (row.risk >= 3) reasons.push("risk 3");
  // PR-92: your revision of a unit (its last task built again, with changes that may touch the whole unit).
  if (/^REVISE a\d+\b/.test(String(row.verdict ?? ""))) reasons.push("your revision of its unit");
  if (critical.length) reasons.push(`touches critical paths (${critical.slice(0, 6).join(", ")}${critical.length > 6 ? ", …" : ""})`);
  const mode = reasons.length ? "deep" : "light";
  const m = r.modes?.[mode] ?? {};
  // PR-53, PR-99: only the agent, model and effort the developer chose; a choice they have not made stops the run.
  validate(cfg.agents);
  const kind = hasGate(row) ? "gate" : isMethodRow(row) ? "method" : mode;
  const run = runChoice(kind, cfg);
  let effort = run.effort;
  if (attempt > 1 && effort && effort !== "max" && raisesOnRetry(cfg)) {
    const i = Math.min(EFFORTS.indexOf(effort) + 1, EFFORTS.length - 1);
    if (EFFORTS[i] !== effort) reasons.push(`retry: effort raised to ${EFFORTS[i]} (raise_on_retry)`);
    effort = EFFORTS[i];
  }
  return {
    mode, model: run.model, effort, max_turns: m.max_turns ?? r.max_turns ?? 80,
    fallback: "",
    reasons: reasons.length ? reasons : ["risk 1–2, no gate, no critical path"],
    critical,
  };
}

export function branchChanges(base = config().base_branch ?? "main") {
  try {
    return diffPaths(`origin/${base}`);
  } catch { return []; }
}

if (process.argv[1]?.endsWith("review-mode.mjs")) {
  const { rows } = parsePhases();
  const row = rows.find((x) => x.task === arg("task"));
  if (!row) fail(`review-mode: ${arg("task")} not in docs/PHASES.md`);
  const plan = reviewPlan(row, branchChanges(), Number(arg("attempt") || "1"));
  emit({ ...plan, reasons: plan.reasons.join("; "), critical: plan.critical.join(",") });
}
