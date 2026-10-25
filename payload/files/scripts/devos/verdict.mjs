#!/usr/bin/env node
// Validate the reviewer's verdict, apply PR-08, record it in docs/PHASES.md, and decide the
// runner's next action. Deterministic: the agents never decide whether to merge.
//
// Usage: node scripts/devos/verdict.mjs --task T01 --attempt 1 [--reviewer-json .devos/reviewer.json]
// Emits: verdict, action (merge | human_gate | retry | halt), next_attempt, summary_file
//
// Actions:
//   merge       PASS, checks green, not a human gate, next fence present
//   human_gate  PASS on a risk-3 task, a gate task, a schema change (PR-17), or with no next fence
//   retry       FAIL and attempt < max_attempts
//   halt        FAIL at max attempts, or the reviewer produced no usable verdict
//   quota_wait  the reviewer hit a usage/rate limit: nothing recorded, same attempt, review-only
//               resume by devos-resume (PR-12)
//   setup_wait  FAIL whose only cause is outside the repository (classification SETUP: a secret, a
//               variable, an account or dashboard setting). Grok cannot fix it, so no retry is spent:
//               the human gets the steps, and the same attempt is re-reviewed once it is in place (PR-27)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { P, config, parsePhases, isHumanGate, taskAfter, updatePhasesRow, changedPaths, emit, fail } from "./lib.mjs";
import { looksLikeLimit, readText, resumeMarker, earliestNotBefore, agentStats, parseJsonLoose, finishedRun } from "./limits.mjs";
import { rulesFiles } from "./firebase.mjs";

const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const task = arg("task");
const attempt = Number(arg("attempt", "1"));
const reviewerJson = arg("reviewer-json", ".devos/reviewer.json");
if (!/^T\d{2}$/.test(task)) fail("usage: verdict.mjs --task Tnn --attempt N");
// PR-54: the reviewer step records which tool reviewed and how its run exited (.devos/reviewer-run.env).
const run = Object.fromEntries(readText(".devos/reviewer-run.env").split(/\r?\n/).map((line) => /^([a-z_]+)="?([^"]*)"?$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]));
const reviewerTool = run.tool || "the reviewer agent";

const cfg = config();
const { rows } = parsePhases();
const row = rows.find((r) => r.task === task);
if (!row) fail(`${task} not in docs/PHASES.md`);
const next = taskAfter(rows, task);
const reviewFile = `docs/reviews/${task}-a${attempt}.md`;
const notes = [];
mkdirSync(P(".devos"), { recursive: true });

function finish(verdict, action, extra = {}) {
  if (action !== "quota_wait") {
    const phasesVerdict = `${verdict} a${attempt} — ${existsSync(P(reviewFile)) ? reviewFile : "no review file"}`;
    updatePhasesRow(task, { done: verdict === "PASS", verdict: phasesVerdict });
  }
  const summary = [
    `### Dev OS ${task} · attempt ${attempt} · **${verdict}** → \`${action}\``,
    "",
    extra.summary ? extra.summary : "",
    "",
    notes.length ? "**Runner notes**\n" + notes.map((n) => `- ${n}`).join("\n") : "",
    "",
    `Review: \`${reviewFile}\` · Fence written: \`${extra.fence ?? "none"}\``,
    agentStats(reviewerJson, run.tool || "claude") ? `\n<sub>Review run: ${agentStats(reviewerJson, run.tool || "claude")}.</sub>` : "",
    extra.human ? `\n**Human attention:** ${extra.human}` : "",
    action === "quota_wait" ? `\n${resumeMarker(task, attempt, true, extra.notBefore)}` : "",
  ].join("\n");
  writeFileSync(P(".devos/verdict-summary.md"), summary);
  emit({ verdict, action, next_attempt: attempt + 1, summary_file: ".devos/verdict-summary.md", not_before: extra.notBefore ?? "" });
  process.exit(0);
}

/** Migration files, and (PR-26) Firestore rules files, this branch adds or changes against the base. */
function schemaChanges() {
  try {
    const rules = cfg.modules?.firebase ? rulesFiles() : [];
    const out = execFileSync("git", ["diff", "--name-only", `origin/${cfg.base_branch ?? "main"}...HEAD`, "--", "supabase/migrations", ...rules], { cwd: P(), encoding: "utf8" });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return existsSync(P("supabase/migrations")) ? ["(could not diff against the base branch)"] : [];
  }
}

/** A verdict rebuilt from a complete review file: first line VERDICT, a Next prompt line, the ledger. */
function verdictFromFile() {
  if (!existsSync(P(reviewFile))) return null;
  const text = readFileSync(P(reviewFile), "utf8");
  const first = (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  const m = /^VERDICT: (PASS|FAIL)$/.exec(first);
  const next = /^Next prompt:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  if (!m || !/^Ledger:|^- D\d/m.test(text) || !next) return null; // not a finished review
  const fence = /^(docs\/fences\/T\d{2}\.md)\b/.exec(next)?.[1] ?? null;
  if (fence && !existsSync(P(fence))) return null;
  const cls = /^Classification of non-PASS items:\s*(.+)$/m.exec(text)?.[1] ?? "";
  return {
    verdict: m[1], task, attempt, review_file: reviewFile, fence_written: fence,
    classification: [], fence_defect: /FENCE DEFECT/.test(cls) && !/^NONE/.test(cls),
    summary: `Verdict taken from \`${reviewFile}\` (the reviewer's run ended before its summary).`,
    human_attention: null,
  };
}

// 1. The reviewer's structured output. Claude Code writes one JSON object, Cursor a stream of events whose last
// is the result, Codex and Gemini a normalised object: the last JSON object is the run's result (PR-54).
let structured = null;
let finalResult = null;
try {
  const raw = parseJsonLoose(readFileSync(P(reviewerJson), "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("no JSON result in the reviewer's output");
  finalResult = raw;
  if (raw.is_error) notes.push(`reviewer run reported an error: ${String(raw.result ?? raw.subtype ?? "").slice(0, 300)}`);
  const denials = raw.permission_denials ?? [];
  if (denials.length) notes.push(`reviewer had ${denials.length} tool call(s) refused by permissions, e.g. ${JSON.stringify(denials[0]).slice(0, 200)}`);
  structured = raw.structured_output ?? null;
  if (!structured && typeof raw.result === "string") {
    try { structured = JSON.parse(raw.result); } catch { /* not JSON */ }
  }
} catch (e) {
  notes.push(`could not read ${reviewerJson}: ${e.message}`);
}
// PR-21: the review file is the verdict of record; the structured answer is its summary. A reviewer
// that wrote a complete review file but stopped before its final answer (most often the turn limit)
// keeps its verdict: it is read from the file. A usage limit still parks the run (PR-12), because a
// review cut short by a limit may be unfinished. A run that exited 0 with a finished result, or gave its
// structured answer, never hit a limit (PR-54), whatever words its transcript holds.
const finished = Boolean(structured) || (run.code === "0" && finishedRun(finalResult));
const limitHit = !finished && looksLikeLimit(readText(reviewerJson), readText(".devos/reviewer.err"));
if ((!structured || !["PASS", "FAIL"].includes(structured.verdict)) && !limitHit) {
  const fromFile = verdictFromFile();
  if (fromFile) {
    structured = fromFile;
    notes.push(run.tool && run.tool !== "claude"
      ? `the verdict was read from the complete review file (PR-21): ${run.tool} gives no structured answer`
      : "the reviewer stopped before its structured answer (turn limit or a crash); the verdict was read from its complete review file (PR-21)");
  }
}
if (!structured || !["PASS", "FAIL"].includes(structured.verdict)) {
  if (limitHit) {
    notes.push(`the reviewer (${reviewerTool}) stopped on a usage or rate limit`);
    const nb = earliestNotBefore(run.tool || "claude", `${readText(reviewerJson).slice(-4000)}\n${readText(".devos/reviewer.err")}`, config().resume?.default_wait_minutes ?? 60);
    finish("WAIT", "quota_wait", {
      notBefore: nb,
      human: `The reviewer agent (${reviewerTool}) is out of usage on every account it has. Nothing was recorded and the attempt was not used up. The runner re-runs this review (review_only) after ${nb} (UTC); remove the devos:quota-wait label to cancel that.`,
    });
  }
  notes.push("the reviewer produced no structured verdict; a human must look at the run log");
  finish("FAIL", "halt", { human: `Reviewer run failed or returned no verdict. Fix the cause, then re-run devos-cycle with task=${task}, attempt=${attempt}, review_only=true (the builder's work is kept).` });
}
if (structured.task !== task || structured.attempt !== attempt) {
  notes.push(`structured verdict names ${structured.task} a${structured.attempt}, expected ${task} a${attempt}`);
}

if (existsSync(P(".devos/surface-warnings.txt"))) {
  for (const l of readFileSync(P(".devos/surface-warnings.txt"), "utf8").split(/\r?\n/).filter(Boolean)) notes.push(`surface guard: ${l}`);
}

// 2. The review file must exist and agree with the structured verdict.
let verdict = structured.verdict;
if (!existsSync(P(reviewFile))) {
  notes.push(`missing ${reviewFile}`);
  finish("FAIL", "halt", { summary: structured.summary, human: `The reviewer did not write its verdict file. Re-run devos-cycle with task=${task}, attempt=${attempt}, review_only=true.` });
}
const reviewText = readFileSync(P(reviewFile), "utf8");
const firstLine = reviewText.split(/\r?\n/).find((l) => l.trim()) ?? "";
if (firstLine.trim() !== `VERDICT: ${verdict}`) {
  notes.push(`${reviewFile} first line is "${firstLine.trim()}", structured verdict is ${verdict}; treated as FAIL`);
  verdict = "FAIL";
}

// 3. PR-08: red required checks override PASS.
let ci = null;
try { ci = JSON.parse(readFileSync(P(".devos/ci-results.json"), "utf8")); } catch { notes.push("no .devos/ci-results.json"); }
const red = !ci ? ["(no check results)"] : !ci.has_package_json ? ["(no package.json)"] : ci.failed_required;
if (verdict === "PASS" && red.length) {
  verdict = "FAIL";
  notes.push(`PR-08: required checks not green (${red.join(", ")}); reviewer's PASS overridden`);
  writeFileSync(P(reviewFile), reviewText.replace(/^\s*VERDICT: PASS/, "VERDICT: FAIL") +
    `\n\n---\nRUNNER OVERRIDE (PR-08): the reviewer wrote PASS, but required checks were not green: ${red.join(", ")}. See .devos/ci-results.json in the run.\n`);
}

// 4. Decide.
const fenceChanged = changedPaths().filter((p) => p.startsWith("docs/fences/"));
if (verdict === "PASS") {
  if (next && !existsSync(P(`docs/fences/${next.task}.md`))) {
    notes.push(`PASS but docs/fences/${next.task}.md was not written; the cycle cannot continue on its own`);
    finish("PASS", "human_gate", { summary: structured.summary, fence: null, human: `Write or request the fence for ${next.task}, then re-run the cycle.` });
  }
  // PR-17: a schema change always stops for the human, whatever the task's risk or gate. Merging it
  // is what lets the next production deploy apply the migration.
  const schema = schemaChanges();
  if (schema.length) notes.push(`schema change: ${schema.join(", ")}`);
  const gate = isHumanGate(row) || schema.length > 0;
  const why = isHumanGate(row) ? (row.risk >= 3 ? "Risk-3 task" : `Gate ${row.gate}`) : "Schema change (PR-17)";
  finish("PASS", gate ? "human_gate" : "merge", {
    summary: structured.summary,
    fence: structured.fence_written,
    human: gate ? `${why}: review the PR${schema.length ? " and every migration or rules change in it" : ""} and merge it to sign off. Merging restarts the cycle.` : structured.human_attention,
  });
}

// PR-27: a failure caused only by something outside the repository is not Grok's to fix. Checks that
// failed on their own (red) are code until the reviewer says otherwise, so SETUP must be the only class.
const cls = `${/^Classification of non-PASS items:\s*(.+)$/m.exec(reviewText)?.[1] ?? ""} ${(structured.classification ?? []).join(" ")}`;
if (/\bSETUP\b/.test(cls) && !/HARD FAILURE|FENCE DEFECT|DOC CORRECTION/.test(cls)) {
  notes.push("classification SETUP: the cause is outside the repository; no retry spent");
  finish("FAIL", "setup_wait", {
    summary: structured.summary,
    human: structured.human_attention ?? "A setting outside the repository is missing; the review names it.",
  });
}

if (attempt < cfg.max_attempts) {
  if (!fenceChanged.includes(`docs/fences/${task}.md`)) notes.push(`no reissued fence for ${task}; the builder retries the same fence with the verdict as guidance`);
  finish("FAIL", "retry", { summary: structured.summary, fence: fenceChanged.join(", ") || null, human: structured.human_attention });
}
finish("FAIL", "halt", {
  summary: structured.summary,
  human: structured.human_attention ?? `Attempt ${attempt} of ${cfg.max_attempts} failed. Decide: fix the fence or the code by hand, then run the workflow with task=${task} attempt=1 on a fresh branch, or close the PR.`,
});
