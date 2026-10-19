#!/usr/bin/env node
// Decide whether the builder run is worth reviewing (PR-12). Runs after the builder's work is
// committed, so partial work is never lost.
//   ok     → continue to checks and review
//   quota  → Cursor is out of plan usage / rate limited: park the task (devos:quota-wait), same
//            attempt, no review spent; devos-resume retries it hourly
//   error  → the builder crashed or produced no output: halt without spending a review
// Usage: node scripts/devos/builder-status.mjs --task T01 --attempt 1 --exit <code> [--review-only true]
import { writeFileSync, mkdirSync } from "node:fs";
import { P, emit, config } from "./lib.mjs";
import { looksLikeLimit, readText, resumeMarker, parseJsonLoose, earliestNotBefore } from "./limits.mjs";

const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? d : d; };
const task = arg("task");
const attempt = Number(arg("attempt", "1"));
const exitRaw = arg("exit", "");
mkdirSync(P(".devos"), { recursive: true });

if (arg("review-only") === "true") {
  emit({ state: "ok", reason: "review-only re-run: builder skipped" });
  process.exit(0);
}

const out = readText(".devos/builder.json");
const err = readText(".devos/builder.err");
const json = parseJsonLoose(out);
const exit = exitRaw === "" ? NaN : Number(exitRaw);
const failed = exit !== 0 || !out.trim() || json?.is_error === true || json?.subtype === "error";
const detail = String(json?.result ?? json?.error ?? "").slice(0, 400) || err.trim().split(/\r?\n/).slice(-5).join(" ").slice(0, 400);

let state = "ok";
// PR-29: with a second Cursor account, both were tried; resume when the first one resets.
const waitUntil = earliestNotBefore("cursor", `${out}\n${err}`, config().resume?.default_wait_minutes ?? 60);
let reason = "builder finished";
// agent-watchdog.sh outcomes:
// - devos-stall (lost connection, no progress, after one restart): transient → park for a short wait;
// - devos-watchdog (time slice used up): if the slice changed files and slices remain → "continue"
//   (the same attempt runs again from the branch); otherwise halt with the reason;
// - devos-stuck (nothing changed for idle_stop_minutes, after one restart): halt, a person looks.
const stalled = /devos-stall:/.test(err);
const budgetSpent = /devos-watchdog: stopped after/.test(err);
const stuck = /devos-stuck:/.test(err);
const slice = Number(arg("slice", "1")) || 1;
const maxSlices = Number(arg("max-slices", String(config().builder?.max_time_slices ?? 4))) || 4;
const changed = Number(arg("changed", "0")) || 0;
const sliceMin = 72;
const stallWait = new Date(Date.now() + (config().resume?.stall_wait_minutes ?? 10) * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
// PR-38: a staged fence. A stage the builder finished moves on to the next stage in a fresh run, unless
// the builder reported STATUS: HALT for it (then the attempt goes to review, which judges the halt).
const stage = Number(arg("stage", "1")) || 1;
const stages = Number(arg("stages", "1")) || 1;
const report = readText(`docs/reports/${task}.md`);
const lastStatus = (report.match(/^STATUS: (DONE|HALT)/gm) || []).pop() || "";
if (!failed && stages > 1 && stage < stages && lastStatus !== "STATUS: HALT") {
  state = "continue";
  reason = `stage ${stage} of ${stages} done`;
}
if (failed) {
  state = stalled || looksLikeLimit(out, err) ? "quota" : budgetSpent && changed > 0 && slice < maxSlices ? "continue" : "error";
  reason = `builder exit ${Number.isNaN(exit) ? "unknown" : exit}${detail ? `: ${detail}` : ""}`;
}
const resumeAt = stalled ? stallWait : waitUntil;

if (state !== "ok") {
  const stageDone = state === "continue" && !failed;
  const head = stageDone
    ? `### Dev OS ${task} · attempt ${attempt} · **stage ${stage} of ${stages} done** → \`continue\``
    : state === "continue"
    ? `### Dev OS ${task} · attempt ${attempt} · **time slice ${slice} of ${maxSlices} used, still working${stages > 1 ? ` (stage ${stage} of ${stages})` : ""}** → \`continue\``
    : state === "quota"
    ? `### Dev OS ${task} · attempt ${attempt} · **${stalled ? "Cursor connection lost" : "waiting for Cursor usage"}** → \`quota_wait\``
    : `### Dev OS ${task} · attempt ${attempt} · **${stuck ? "builder stuck" : budgetSpent ? "time budget used up" : "builder error"}** → \`halt\``;
  const body = stageDone
    ? `The reviewer split this fence into ${stages} stages (PR-38). Stage ${stage} is built and committed on this branch, no review was spent, and stage ${stage + 1} is queued: it continues from the branch on its own. The review comes after the last stage. Live progress is on the "Dev OS: run notices" issue.`
    : state === "continue"
    ? `The builder was still changing files when its ${sliceMin}-minute slice ended (${changed} file(s) changed in this slice). Everything is committed on this branch, no review was spent, and slice ${slice + 1} of ${maxSlices} is queued: it continues from the branch on its own. Live progress is on the "Dev OS: run notices" issue.`
    : state === "quota" && stalled
    ? `The Cursor CLI lost its connection and stopped making progress. Whatever it finished is committed on this branch. No review was spent and the attempt was not used up. The runner resumes it after **${resumeAt}** (UTC); remove the \`devos:quota-wait\` label to cancel that.`
    : state === "quota"
    ? `Cursor stopped on a plan/usage or rate limit. Whatever it finished is committed on this branch. No review was spent and the attempt was not used up. The runner resumes it after **${waitUntil}** (UTC); remove the \`devos:quota-wait\` label to cancel that.`
    : stuck
    ? `The builder stopped changing anything for ${config().builder?.idle_stop_minutes ?? 30} minutes, was restarted once, and stopped again. Whatever it finished is committed on this branch. No review was spent. Look at the run log; to go on, comment \`/devos revise continue from the work on this branch; <anything to change>\` on this PR.`
    : budgetSpent && slice >= maxSlices
    ? `The builder used all ${maxSlices} time slices (${maxSlices * sliceMin} minutes) on this attempt. Everything is committed on this branch. No review was spent. The task is probably too big for one attempt: comment \`/devos revise continue from the work on this branch; <what is left>\` on this PR, or split the task.`
    : budgetSpent
    ? `The time slice ended without a single file changed in it, so it was not continued automatically. Everything earlier is committed on this branch. No review was spent. Look at the run log; to go on, comment \`/devos revise continue from the work on this branch; <anything to change>\` on this PR.`
    : `The Cursor CLI failed before finishing, for a reason that does not look like a usage limit. Whatever it finished is committed on this branch. No review was spent. Fix the cause (key, model id, install), then re-run devos-cycle with task=${task} attempt=${attempt}.`;
  writeFileSync(P(".devos/builder-summary.md"), [head, "", body, "", "```", reason, "```", "",
    state === "quota" ? resumeMarker(task, attempt, false, resumeAt) : ""].join("\n"));
}
emit({ state, reason, not_before: state === "quota" ? resumeAt : "" });
