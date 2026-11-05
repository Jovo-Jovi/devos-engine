// E58 (PR-83): local mode is a handover. Once the developer approves the blueprint, DEV_OS's automation leaves the
// project and its plan stays: the developer builds the rest their own way, and `devos adopt` can bring DEV_OS back.
// Removed: every file of the engine lock but `docs/method/` (the fences cite it), `.gitignore` and `.gitattributes`;
// the lock; `devos.config.json`; the reviewer's `CLAUDE.md`; `devos/ci/` and DEV_OS's scratch folder `.devos/`.
// Kept: the documents, README.md, SETUP.md, devos/answers.json and the settings written for the project at setup.
// devos/answers.json records the handover (`handover: { engine, on }`), so a later run knows the project.
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LOCK, safeRelative } from "./engine.mjs";

const KEPT = new Set([".gitignore", ".gitattributes"]);
const METHOD = "docs/method/";
const EXTRA_FILES = [LOCK, "devos.config.json", "CLAUDE.md"];
const EXTRA_FOLDERS = ["devos/ci", ".devos"];

/** True when the project's answers record a handover. */
export function handedOver(answers) {
  return Boolean(answers && typeof answers.handover === "object" && answers.handover !== null && !Array.isArray(answers.handover));
}

export function readAnswers(folder) {
  try {
    return JSON.parse(readFileSync(path.join(folder, "devos", "answers.json"), "utf8"));
  } catch {
    return null;
  }
}

function pruneEmpty(folder, dir) {
  let at = dir;
  while (path.relative(folder, at) !== "" && !path.relative(folder, at).startsWith("..")) {
    if (!existsSync(at) || readdirSync(at).length > 0) return;
    rmdirSync(at);
    at = path.dirname(at);
  }
}

/**
 * Hands the project over: records it in devos/answers.json, then removes DEV_OS's automation. A second run removes
 * what is left and changes nothing else. Returns the files removed, in order, as project paths.
 */
export function handOver(folder, version, on = new Date().toISOString().slice(0, 10)) {
  const answersFile = path.join(folder, "devos", "answers.json");
  const answers = JSON.parse(readFileSync(answersFile, "utf8"));
  if (!handedOver(answers)) {
    answers.handover = { engine: version, on };
    writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
  }
  const removed = [];
  const remove = (rel) => {
    safeRelative(rel);
    const abs = path.join(folder, ...rel.split("/"));
    if (!existsSync(abs)) return;
    unlinkSync(abs);
    removed.push(rel);
    pruneEmpty(folder, path.dirname(abs));
  };
  const lockFile = path.join(folder, ...LOCK.split("/"));
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    for (const entry of Array.isArray(lock.files) ? lock.files : []) {
      if (KEPT.has(entry.path) || String(entry.path).startsWith(METHOD)) continue;
      remove(typeof entry.at === "string" ? entry.at : entry.path);
    }
  }
  for (const rel of EXTRA_FILES) remove(rel);
  for (const rel of EXTRA_FOLDERS) {
    const abs = path.join(folder, ...rel.split("/"));
    if (!existsSync(abs)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(`${rel}/`);
    pruneEmpty(folder, path.dirname(abs));
  }
  return removed;
}

// ---------- E58b (PR-84): the way back ----------
// `devos adopt` on a handed-over project reads its task ledger: the tasks the developer ticked as built are accepted
// at the adoption, unreviewed, as attempt 0, and the cycle resumes from the first open task.

const HEADER = ["Task", "Phase", "Station", "Name", "Risk", "Gate", "Done", "Verdict"];
const PASS_VERDICT = /^PASS a(\d+) — (docs\/reviews\/T\d{2}-a\d+\.md)$/;
const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

/** The task table of docs/PHASES.md as the method's scripts read it: { lines, rows } or { error }. */
export function phaseRows(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const cells = line.trim().startsWith("|") ? cellsOf(line) : [];
    return cells.length === HEADER.length && cells.every((cell, i) => cell === HEADER[i]);
  });
  if (start < 0) return { error: `docs/PHASES.md has no task table (| ${HEADER.join(" | ")} |)` };
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith("|"); i += 1) {
    const cells = cellsOf(lines[i]);
    if (cells.length !== HEADER.length) return { error: `docs/PHASES.md line ${i + 1} has ${cells.length} cells, not ${HEADER.length}` };
    rows.push({ line: i, task: cells[0], phase: cells[1], name: cells[3], done: cells[6] === "[x]", verdict: cells[7] });
  }
  return { lines, rows };
}

function passFile(folder, verdict) {
  const match = PASS_VERDICT.exec(verdict);
  if (!match) return false;
  try {
    const first = readFileSync(path.join(folder, ...match[2].split("/")), "utf8").split(/\r?\n/).find((line) => line.trim()) ?? "";
    return first.trim() === "VERDICT: PASS";
  } catch {
    return false;
  }
}

/**
 * What a handed-over project's ledger means for `devos adopt`: `accept`, the rows ticked as built without a PASS
 * verdict file of their own; `resume`, the task the cycle builds next ("" when every task is built), as the runner
 * picks it (a method fix first). `error` when DEV_OS cannot take the ledger as it is: a tick after an open task, as
 * guard:phases refuses, a task id that is not Tnn, or an attempt-0 review that exists already.
 */
export function handoverTasks(folder) {
  let text;
  try {
    text = readFileSync(path.join(folder, "docs", "PHASES.md"), "utf8");
  } catch {
    return { error: "devos: docs/PHASES.md is missing; it is the plan DEV_OS resumes from, so restore it, commit, then run devos adopt again" };
  }
  const table = phaseRows(text);
  if (table.error) return { error: `devos: ${table.error}; fix it, commit, then run devos adopt again` };
  let open = null;
  const accept = [];
  for (const row of table.rows) {
    if (!/^T\d{2}$/.test(row.task)) return { error: `devos: docs/PHASES.md has the task id ${row.task}; ids are Tnn. Fix it, commit, then run devos adopt again` };
    const method = row.phase === "PM";
    if (row.done) {
      if (open && !method) {
        return { error: `devos: docs/PHASES.md ticks ${row.task} after the open task ${open.task}, and tasks are built in order. Tick ${open.task} if it is built, or untick ${row.task}, commit, then run devos adopt again` };
      }
      if (passFile(folder, row.verdict)) continue;
      if (existsSync(path.join(folder, "docs", "reviews", `${row.task}-a0.md`))) {
        return { error: `devos: docs/reviews/${row.task}-a0.md exists, and DEV_OS writes it for a task built after the handover; rename it, commit, then run devos adopt again` };
      }
      accept.push(row);
    } else if (!method && !open) open = row;
  }
  const next = table.rows.find((row) => !row.done && row.phase === "PM") ?? table.rows.find((row) => !row.done) ?? null;
  return { rows: table.rows, accept, resume: next ? next.task : "" };
}

/** The attempt-0 review of a task built outside DEV_OS after the handover and accepted at the adoption (PR-84). */
export function acceptedReview(row, handover, engine, on) {
  return [
    "VERDICT: PASS",
    `Accepted by the owner at adoption: built outside DEV_OS after a handover (engine ${handover?.engine ?? "unknown"}), not reviewed by DEV_OS.`,
    "",
    `- Task: ${row.task} — ${row.name}`,
    `- Handed over: ${handover?.on || "unknown"}; accepted with devos adopt (engine ${engine}) on ${on}.`,
    "- Attempt 0 is not a DEV_OS attempt (PR-84): DEV_OS's checks hold this code through devos/baseline.json, and a later task that changes it is reviewed as usual.",
    "",
  ].join("\n");
}

/** docs/PHASES.md with each accepted task's Verdict `PASS a0 — docs/reviews/Tnn-a0.md`; every other line as it was. */
export function phasesAccepted(text, tasks) {
  const eol = String(text).includes("\r\n") ? "\r\n" : "\n";
  const table = phaseRows(text);
  if (table.error) return text;
  const lines = [...table.lines];
  for (const row of table.rows) {
    if (!tasks.includes(row.task)) continue;
    const cells = cellsOf(lines[row.line]);
    cells[7] = `PASS a0 — docs/reviews/${row.task}-a0.md`;
    lines[row.line] = `| ${cells.join(" | ")} |`;
  }
  return lines.join(eol);
}
