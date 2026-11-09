#!/usr/bin/env node
// `/devos accept` (PR-87): the owner accepts a task that stopped without a PASS, for example one stopped at its last
// attempt whose branch the owner judges good enough. The decision is recorded as the next attempt's review file
// (docs/reviews/Tnn-aN.md, which starts "VERDICT: PASS" and says that no attempt N was built or reviewed), and the
// task's row in docs/PHASES.md is ticked (`PASS aN — docs/reviews/Tnn-aN.md`), so guard:phases passes and the cycle
// goes on to the next task. devos-intake commits it: on the task's open pull request, or, after a merge by hand, on
// a branch devos/accept-Tnn with a pull request of its own. No agent runs here, and nothing is merged.
// Usage: node scripts/devos/accept.mjs --task Tnn --by <login> [--pr <n>] [--note-file <file>] [--date YYYY-MM-DD]
// Emits: attempt, review
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { P, emit, fail, git, isMethodRow, parsePhases, updatePhasesRow } from "./lib.mjs";

const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };

/** The highest attempt of a task: its review files and its runner commits (`Tnn aN: …`); 0 when it never ran. */
export function lastAttempt(task, reviews = [], subjects = []) {
  let last = 0;
  const file = new RegExp(`^${task}-a(\\d+)\\.md$`);
  const commit = new RegExp(`^${task} a(\\d+):`);
  for (const name of reviews) last = Math.max(last, Number(file.exec(name)?.[1] ?? 0));
  for (const line of subjects) last = Math.max(last, Number(commit.exec(line)?.[1] ?? 0));
  return last;
}

/** The text of the acceptance record. `previous` is the last attempt's review: { file, verdict } or null. */
export function acceptanceText({ task, attempt, by, pr = "", date, previous, note = "" }) {
  const where = pr ? ` on #${pr}` : "";
  const before = attempt > 1
    ? previous
      ? `The task stopped at attempt ${attempt - 1} without a PASS (\`${previous.file}\`: ${previous.verdict || "no verdict line"}), and the owner accepted what its branch holds.`
      : `The task stopped at attempt ${attempt - 1} without a PASS, with no review file on this branch, and the owner accepted what its branch holds.`
    : "No attempt of this task was built by DEV_OS; the owner accepted the work as it is.";
  const lines = String(note).replace(/\r/g, "").split("\n").map((line) => line.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return [
    "VERDICT: PASS",
    "",
    `${task} · accepted by @${by} with \`/devos accept\`${where} · ${date} · attempt ${attempt} was not built or reviewed`,
    "",
    `This file records the owner's decision, not a review (PR-87). ${before}`,
    "",
    ...(lines.length ? ["The owner's note:", "", ...lines.map((line) => (line ? `> ${line}` : ">")), ""] : ["The owner gave no note.", ""]),
    "Whatever the last review left open stays open: a change request or a later task takes it up.",
    "",
  ].join("\n");
}

if (process.argv[1]?.endsWith("accept.mjs")) {
  const task = arg("task");
  const by = arg("by");
  const pr = arg("pr");
  const date = arg("date") || new Date().toISOString().slice(0, 10);
  if (!/^T\d{2}$/.test(task)) fail("usage: accept.mjs --task Tnn --by <login> [--pr <n>] [--note-file <file>]");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(by)) fail(`"${by}" is not a GitHub login`);
  if (pr && !/^\d+$/.test(pr)) fail(`"${pr}" is not a pull request number`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`"${date}" is not a date (YYYY-MM-DD)`);
  let rows;
  try {
    ({ rows } = parsePhases());
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const row = rows.find((item) => item.task === task);
  if (!row) fail(`${task} is not in docs/PHASES.md`);
  if (row.done) fail(`${task} is already ticked (${row.verdict}); there is nothing to accept`);
  if (!isMethodRow(row)) {
    const open = rows.slice(0, rows.indexOf(row)).find((item) => !item.done && !isMethodRow(item));
    if (open) fail(`${open.task} is still open before ${task}: tasks are accepted in order (guard:phases), so accept or finish ${open.task} first`);
  }
  const reviews = existsSync(P("docs/reviews")) ? readdirSync(P("docs/reviews")) : [];
  let subjects = [];
  try {
    subjects = git(["log", "--format=%s"]).split(/\r?\n/);
  } catch { /* no history: the review files alone count */ }
  const attempt = lastAttempt(task, reviews, subjects) + 1;
  const review = `docs/reviews/${task}-a${attempt}.md`;
  if (existsSync(P(review))) fail(`${review} already exists`);
  const prevFile = `docs/reviews/${task}-a${attempt - 1}.md`;
  const previous = attempt > 1 && existsSync(P(prevFile))
    ? { file: prevFile, verdict: (readFileSync(P(prevFile), "utf8").split(/\r?\n/).find((line) => line.trim()) ?? "").trim() }
    : null;
  // An absolute path is the runner's (PR-92: the publish job keeps the note outside the branch it writes on).
  const noteFile = arg("note-file") ? (isAbsolute(arg("note-file")) ? arg("note-file") : P(arg("note-file"))) : "";
  const note = noteFile && existsSync(noteFile) ? readFileSync(noteFile, "utf8") : "";
  mkdirSync(P("docs/reviews"), { recursive: true });
  writeFileSync(P(review), acceptanceText({ task, attempt, by, pr, date, previous, note }));
  updatePhasesRow(task, { done: true, verdict: `PASS a${attempt} — ${review}` });
  emit({ attempt, review });
}
