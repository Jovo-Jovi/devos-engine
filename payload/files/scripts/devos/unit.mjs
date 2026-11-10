#!/usr/bin/env node
// Units of acceptance (PR-91). Product tasks are built in units: inside a unit a PASS merges into the unit's branch
// (devos/unit-<its last task>), and at the unit's end the cycle opens one pull request into main, labelled
// devos:acceptance, with a completion report, and stops. Only your merge reaches main. Method fixes are in no unit.
// It runs from main's checkout (the rules) and reads the unit's progress through GitHub (gh, GH_TOKEN).
//
//   open   --repo <owner/name> [--out .devos/unit]
//          The open unit: a devos/unit-* branch whose rows are not all ticked on main. Writes <out>/PHASES.md (the
//          unit's) and <out>/open.json, and prints unit, unit_sha, waiting_pr, closed_pr and refresh (PR-92: the acceptance
//          PR's report gives a verdict the unit no longer has). Two open units stop the run.
//   place  --main-sha <sha> [--task Tnn] [--out .devos/unit]
//          Where the task is built: base (main for a method fix, else its unit's branch), base_sha, unit_new; or, when
//          the open unit's rows are all ticked, accept (publish opens the acceptance pull request) or waiting (it is open,
//          or you closed it). Needs next-task.mjs's view, so it runs after it.
//   report --repo <owner/name> --unit <branch> --main-sha <sha> --file <out.md>
//          The acceptance pull request's body: the unit's tasks with their verdicts, reviews and pull requests, the
//          paths it changes against main, and how to check it. No AI call.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { acceptanceUnit, config, emit, fail, isMethodRow, parsePhases, unitOf, UNIT_BRANCH, UNIT_PREFIX } from "./lib.mjs";

const MAX_PATHS = 200;

/**
 * The open units among `branches` ({ name, sha, rows }): those whose rows are not all ticked on main. A unit's tasks are
 * read from its own docs/PHASES.md (`rows`), as they were when it started, so a row added on main later never moves it.
 */
export function openUnits(mainRows, branches, mode) {
  const open = [];
  const unknown = [];
  for (const b of branches) {
    const last = b.name.slice(UNIT_PREFIX.length);
    const unit = unitOf(b.rows ?? mainRows, last, mode);
    if (!unit || unit.last !== last) { unknown.push(b.name); continue; }
    const accepted = unit.tasks.every((t) => mainRows.find((r) => r.task === t)?.done);
    if (!accepted) open.push({ ...b, ...unit });
  }
  return { open, unknown };
}

/**
 * PR-92: the unit's tasks whose row in an acceptance PR's report (`reportText`'s task table) does not carry the verdict
 * the unit's own docs/PHASES.md gives now.
 */
export function staleTasks(tasks, unitRows, body) {
  const lines = String(body ?? "").split(/\r?\n/);
  return tasks.filter((t) => {
    const verdict = clean((unitRows ?? []).find((r) => r.task === t)?.verdict) || "—";
    const line = lines.find((l) => l.startsWith(`| ${t} |`));
    return !line || !line.split("|").map((c) => c.trim()).includes(verdict);
  });
}
const unitRowsOf = (text) => { try { return parsePhases(text).rows; } catch { return []; } };

/** Where the next task is built, or what the cycle does instead (see place above). */
export function decide({ mainRows, unitRows, open, task, mode, mainSha }) {
  const row = task ? mainRows.find((r) => r.task === task) : null;
  const base = { build: "false", base: "main", base_sha: mainSha, unit: "", unit_first: "", unit_last: "", unit_new: "false", accept: "false", waiting: "false", acceptance_pr: "", note: "" };
  if (row && isMethodRow(row)) return { ...base, build: "true", note: `${task} is a method fix: it targets main, outside any unit (PR-28)` };
  if (open) {
    const unit = { unit: open.branch, unit_first: open.first, unit_last: open.last };
    // Ticked on the unit, or on main (an accept recorded there).
    const ticked = (t) => (unitRows ?? []).find((r) => r.task === t)?.done === true || mainRows.find((r) => r.task === t)?.done === true;
    if (open.tasks.every(ticked)) {
      // PR-92: its PR is open and its report is stale after your revision: publish renews the report and the status.
      if (open.waiting_pr && open.refresh) return { ...base, ...unit, accept: "true", acceptance_pr: String(open.waiting_pr), note: `${open.branch} is complete again after your revision: publish renews pull request #${open.waiting_pr}'s report and status` };
      if (open.waiting_pr) return { ...base, ...unit, waiting: "true", acceptance_pr: String(open.waiting_pr), note: `${open.branch} is complete and waits for your acceptance: pull request #${open.waiting_pr}. No product task is built until you merge it.` };
      if (open.closed_pr) return { ...base, ...unit, waiting: "true", acceptance_pr: String(open.closed_pr), note: `${open.branch} is complete and you closed its acceptance pull request #${open.closed_pr}. Reopen it to accept the unit; no product task is built meanwhile.` };
      return { ...base, ...unit, accept: "true", note: `${open.branch} is complete: publish opens its acceptance pull request` };
    }
    if (!row) return { ...base, ...unit, note: "no task to build" };
    if (!open.tasks.includes(task)) fail(`${task} is not in the open unit ${open.branch} (${open.first}–${open.last}), whose rows are not all ticked`);
    return { ...base, ...unit, build: "true", base: open.branch, base_sha: open.sha, note: `${task} is built on ${open.branch}` };
  }
  if (!row) return { ...base, note: "no task to build" };
  const unit = unitOf(mainRows, task, mode);
  return { ...base, build: "true", base: unit.branch, base_sha: mainSha, unit: unit.branch, unit_first: unit.first, unit_last: unit.last, unit_new: "true", note: `${task} starts the unit ${unit.first}–${unit.last} on ${unit.branch}, from main` };
}

const clean = (text) => String(text ?? "").replace(/[\u0000-\u001f\u007f`|<>]/g, " ").trim();

/** The acceptance pull request's body. */
export function reportText({ unit, rows, unitRows, prs, paths, total, capped = false, stack, fences = [] }) {
  const byTask = new Map((unitRows ?? []).map((r) => [r.task, r]));
  const out = [
    `## Unit ${unit.first}–${unit.last}: your acceptance`,
    "",
    `Every task of this unit passed its review and is on \`${unit.branch}\`. Nothing of it is on main yet: **your merge of this pull request is the acceptance**, and it starts the production deploy and the next unit. Tests, a PASS and a finished task are not that authorization (PR-91).`,
    "",
    "### Tasks",
    "",
    "| Task | Name | Risk | Gate | Verdict | Review | Pull request |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const task of unit.tasks) {
    const row = rows.find((r) => r.task === task) ?? {};
    const done = byTask.get(task) ?? {};
    const pr = prs.find((p) => p.headRefName === `task/${task}`);
    const attempt = /a(\d+)/.exec(String(done.verdict ?? ""))?.[1];
    const review = attempt ? `\`docs/reviews/${task}-a${attempt}.md\`` : "—";
    out.push(`| ${task} | ${clean(row.name)} | ${row.risk ?? "—"} | ${clean(row.gate) || "—"} | ${clean(done.verdict) || "—"} | ${review} | ${pr ? `#${pr.number}` : "—"} |`);
  }
  out.push("", `### What changes against main (${capped ? `${total} or more paths: GitHub lists at most ${total} here` : `${total} path${total === 1 ? "" : "s"}`})`, "", "```text");
  for (const p of paths.slice(0, MAX_PATHS)) out.push(clean(p));
  if (total > MAX_PATHS || capped) out.push(`… and ${capped ? "more" : total - MAX_PATHS} (the Files changed tab lists them all)`);
  out.push("```");
  // PR-94: what was asked can change on the way. Every fence this unit adds or changes, so a rewrite is never silent.
  if (fences.length) {
    out.push("", `### Fences this unit adds or changes (${fences.length})`, "",
      "The reviews wrote these. A fence that was already issued changes only with a higher Fence version, and each task's pull request comment lists the versions: read a changed one before you merge.", "", "```text");
    for (const f of fences.slice(0, MAX_PATHS)) out.push(`${clean(f.path)} — ${clean(f.status)}`);
    out.push("```");
  }
  out.push("", "### How to check it", "",
    `- **On your machine:** \`git fetch origin ${unit.branch}\`, \`git switch ${unit.branch}\`, then \`${clean(stack.install)}\`, \`${clean(stack.build)}\` and \`${clean(stack.preview) || "pnpm exec next start"}\`.`,
    "- **A preview:** the cycle makes none (it holds no Vercel credential, D12). If your Vercel project builds branches from Git, the doctor's comment on this pull request links this branch's preview.",
    "- **Each task:** its review file and its pull request above (checks, verdict, the reviewer's notes).",
    "", "### What you can do", "",
    "- **Merge** this pull request: the only way this unit reaches main. Production deploys from your merge, and the next unit starts.",
    "- **Close** it: the unit stays on its branch and nothing else is built until you reopen it.",
    `- **Ask for changes:** comment \`/devos revise <what to change>\` here. The reviewer reissues the fence of the unit's last task, ${unit.last}, with your change, the cycle builds it again inside the unit, and this report is renewed when it passes. New scope belongs in a change request.`,
    "");
  return out.join("\n");
}

// ---------- the command line ----------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? String(argv[i + 1] ?? "") : ""; };

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) fail(`gh ${args.slice(0, 2).join(" ")}: ${(r.stderr || "").trim().slice(0, 300)}`);
  return r.stdout;
}
const raw = (repo, file, ref) => gh(["api", `repos/${repo}/contents/${file}?ref=${encodeURIComponent(ref)}`, "-H", "Accept: application/vnd.github.raw"]);

function cmdOpen() {
  const repo = arg("repo");
  const out = arg("out") || ".devos/unit";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail("--repo <owner/name> is required", 2);
  const refs = JSON.parse(gh(["api", `repos/${repo}/git/matching-refs/heads/${UNIT_PREFIX}`]) || "[]");
  const branches = refs.map((r) => ({ name: String(r.ref).replace(/^refs\/heads\//, ""), sha: r.object?.sha })).filter((b) => UNIT_BRANCH.test(b.name) && /^[0-9a-f]{40}$/.test(b.sha ?? ""));
  mkdirSync(out, { recursive: true });
  if (!branches.length) {
    writeFileSync(path.join(out, "open.json"), "null\n");
    emit({ unit: "", unit_sha: "", unit_phases: "" });
    return;
  }
  const mode = acceptanceUnit(config());
  const { rows } = parsePhases();
  // A unit whose last task is ticked on main was accepted: its branch is not read again.
  const live = branches.filter((b) => !rows.find((r) => r.task === b.name.slice(UNIT_PREFIX.length))?.done);
  const texts = new Map();
  for (const b of live) {
    texts.set(b.name, raw(repo, "docs/PHASES.md", b.name));
    try { b.rows = parsePhases(texts.get(b.name)).rows; } catch { b.rows = null; }
  }
  const { open, unknown } = openUnits(rows, live, mode);
  if (unknown.length) fail(`${unknown.join(", ")} holds work not on main, and is not a unit under acceptance.unit=${mode} (was the setting changed?): set it back, or merge or delete the branch (PR-91)`);
  if (open.length > 1) fail(`two units are open (${open.map((u) => u.branch).join(", ")}): merge or delete one; the cycle builds one unit at a time (PR-91)`);
  const unit = open[0];
  if (!unit) {
    writeFileSync(path.join(out, "open.json"), "null\n");
    emit({ unit: "", unit_sha: "", unit_phases: "" });
    return;
  }
  writeFileSync(path.join(out, "PHASES.md"), texts.get(unit.name));
  delete unit.rows;
  // This repository's pull requests only (a fork can use the same branch name), and a closed one only for this head.
  const prs = (JSON.parse(gh(["pr", "list", "--repo", repo, "--head", unit.branch, "--base", "main", "--state", "all", "--json", "number,state,isCrossRepository,headRefOid,body", "--limit", "20"]) || "[]")).filter((p) => p.isCrossRepository === false);
  const waiting = prs.find((p) => p.state === "OPEN");
  unit.waiting_pr = waiting?.number ?? "";
  unit.closed_pr = unit.waiting_pr ? "" : (prs.find((p) => p.state === "CLOSED" && p.headRefOid === unit.sha)?.number ?? "");
  // PR-92: its open acceptance PR's report gives a verdict that is no longer the unit's (you revised it with /devos revise
  // and the task was built again): publish renews the report and the status. A push that changes no verdict is not.
  unit.refresh = waiting ? staleTasks(unit.tasks, unitRowsOf(texts.get(unit.name)), waiting.body).length > 0 : false;
  writeFileSync(path.join(out, "open.json"), `${JSON.stringify(unit, null, 2)}\n`);
  emit({ unit: unit.branch, unit_sha: unit.sha, unit_phases: path.join(out, "PHASES.md"), waiting_pr: unit.waiting_pr, closed_pr: unit.closed_pr, refresh: unit.refresh ? "true" : "false" });
}

function cmdPlace() {
  const out = arg("out") || ".devos/unit";
  const mainSha = arg("main-sha");
  if (!/^[0-9a-f]{40}$/.test(mainSha)) fail("--main-sha must be a full commit id", 2);
  const file = path.join(out, "open.json");
  const open = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const { rows } = parsePhases();
  const unitRows = open ? parsePhases(readFileSync(path.join(out, "PHASES.md"), "utf8")).rows : null;
  const result = decide({ mainRows: rows, unitRows, open, task: arg("task"), mode: acceptanceUnit(config()), mainSha });
  console.log(`unit: ${result.note}`);
  emit(result);
}

function cmdReport() {
  const repo = arg("repo");
  const branch = arg("unit");
  const mainSha = arg("main-sha");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !UNIT_BRANCH.test(branch) || !/^[0-9a-f]{40}$/.test(mainSha)) fail("--repo, --unit devos/unit-Tnn and --main-sha are required", 2);
  const cfg = config();
  const unitRows = parsePhases(raw(repo, "docs/PHASES.md", branch)).rows;
  const unit = unitOf(unitRows, branch.slice(UNIT_PREFIX.length), acceptanceUnit(cfg));
  if (!unit) fail(`${branch} is not a unit of its own docs/PHASES.md`);
  const rows = unitRows;
  const prs = JSON.parse(gh(["pr", "list", "--repo", repo, "--base", branch, "--state", "merged", "--json", "number,headRefName", "--limit", "100"]) || "[]");
  const cmp = JSON.parse(gh(["api", `repos/${repo}/compare/${mainSha}...${branch}`]) || "{}");
  const paths = (cmp.files ?? []).map((f) => f.filename);
  const fences = (cmp.files ?? []).filter((f) => /^docs\/fences\/[^/]+\.md$/.test(String(f.filename))).map((f) => ({ path: f.filename, status: f.status }));
  const stack = { ...(cfg.stack?.commands ?? {}), preview: cfg.stack?.preview ?? "" };
  writeFileSync(arg("file"), reportText({ unit, rows, unitRows, prs, paths, total: paths.length, capped: paths.length >= 300, stack, fences }));
  emit({ first: unit.first, last: unit.last });
}

if (process.argv[1] && path.basename(process.argv[1]) === "unit.mjs") {
  const cmd = argv[0];
  if (cmd === "open") cmdOpen();
  else if (cmd === "place") cmdPlace();
  else if (cmd === "report") cmdReport();
  else fail("usage: unit.mjs open | place | report (see the header)", 2);
}
