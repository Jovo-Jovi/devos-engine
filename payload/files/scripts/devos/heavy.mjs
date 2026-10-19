#!/usr/bin/env node
// Heavy runs are announced, and can be held (PR-20).
//
// A run is heavy when its review uses the gate model (Opus) or extra-high effort, or when its fence
// asks the builder for extra-high effort. Those runs take the longest and use the most of the
// human's Claude and Cursor plans, so before one starts the runner comments in the "Dev OS: run
// notices" issue (subscribe to it to get the notification). The first task of a new phase also gets
// an outlook of what is coming.
//
// Repository variable DEVOS_HEAVY:
//   notify (default)  announce and start
//   hold              announce and wait: a heavy task's first attempt starts only after the human
//                     comments `/devos go` in the notices issue (or runs devos-cycle with go ticked).
//                     Retries, review-only resumes and revisions are never held: they continue a run
//                     the human already let start.
//
// Usage: node scripts/devos/heavy.mjs --task T11 --attempt 1 [--review-only true] [--revision true] [--go true] [--dry-run]
// Env:   GH_TOKEN, GITHUB_REPOSITORY, DEVOS_HEAVY, RUN_URL
// Emits: heavy, held, reasons
import { existsSync, readFileSync } from "node:fs";
import { P, config, parsePhases, reviewerModel, reviewerEffort, emit, fail } from "./lib.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? "") : ""; };
const NOTICES_LABEL = "devos:notices";
const NOTICES_TITLE = "Dev OS: run notices";

/** Why a task's run is heavy (empty when it is not). The fence is read when it exists. */
export function heavyReasons(row, cfg = config()) {
  const reasons = [];
  const model = reviewerModel(row, cfg);
  const effort = reviewerEffort(row, cfg);
  if (model === cfg.reviewer.gate_model) reasons.push(`review by ${model}`);
  if (effort === "xhigh") reasons.push("review at extra-high effort");
  const fence = P(`docs/fences/${row.task}.md`);
  if (existsSync(fence)) {
    const e = /Builder:[^\n]*Effort:\s*(low|medium|high|xhigh)/i.exec(readFileSync(fence, "utf8"))?.[1];
    if (e === "xhigh") reasons.push("build at extra-high effort");
  }
  if (row.gate && row.gate !== "—" && row.gate !== "-") reasons.push(`closes gate ${row.gate}`);
  else if (row.risk >= 3) reasons.push("risk 3");
  return reasons;
}

async function gh(path, { method = "GET", body } = {}) {
  const r = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GH_TOKEN}`, "user-agent": "devos-heavy" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function noticesIssue(repo) {
  const found = await gh(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(NOTICES_LABEL)}&per_page=5`);
  if (found.length) return found[0].number;
  await gh(`repos/${repo}/labels`, { method: "POST", body: { name: NOTICES_LABEL, color: "5319e7", description: "Dev OS heavy-run notices" } }).catch(() => {});
  const issue = await gh(`repos/${repo}/issues`, {
    method: "POST",
    body: {
      title: NOTICES_TITLE,
      labels: [NOTICES_LABEL],
      body: [
        "The runner comments here **before every heavy run** (Opus review, extra-high effort, a gate) and when a new phase starts, so you know what is coming and how much of your Claude and Cursor plans it is likely to use (PR-20).",
        "",
        "Press **Subscribe** on this issue to get those comments as GitHub notifications (email or mobile).",
        "",
        "- Repository variable `DEVOS_HEAVY=hold` makes a heavy task wait here until you comment `/devos go`. Unset, or `notify`, it only announces.",
        "- A usage limit never loses work: a cycle run parks and resumes by itself (PR-12), and so does a planning run (PR-20).",
        "",
        "Keep this issue open.",
      ].join("\n"),
    },
  });
  return issue.number;
}

const isNewPhase = (rows, row) => {
  const i = rows.indexOf(row);
  return i === 0 || rows[i - 1].phase !== row.phase;
};

async function main() {
  const cfg = config();
  const { rows } = parsePhases();
  const task = arg("task");
  const row = rows.find((r) => r.task === task);
  if (!row) fail(`heavy: ${task} not in docs/PHASES.md`);
  const attempt = Number(arg("attempt") || "1");
  const reviewOnly = arg("review-only") === "true";
  const revision = arg("revision") === "true";
  const go = arg("go") === "true";
  const mode = (process.env.DEVOS_HEAVY || "notify").toLowerCase();

  const reasons = heavyReasons(row, cfg);
  const heavy = reasons.length > 0;
  const firstStart = attempt === 1 && !reviewOnly && !revision;
  const held = heavy && mode === "hold" && firstStart && !go;
  const newPhase = firstStart && isNewPhase(rows, row);

  // The outlook: open tasks from this one on, and which of them are heavy.
  const open = rows.filter((r) => !r.done && rows.indexOf(r) >= rows.indexOf(row));
  const heavyOpen = open.filter((r) => heavyReasons(r, cfg).length);
  const outlook = `${open.length} open task(s) from here; heavy: ${heavyOpen.map((r) => r.task).join(", ") || "none"}.`;

  emit({ heavy: heavy ? "true" : "false", held: held ? "true" : "false", reasons: reasons.join("; ") || "none" });
  if (!heavy && !newPhase) return;

  const lines = [];
  if (newPhase) {
    const phaseRows = rows.filter((r) => r.phase === row.phase);
    const gates = phaseRows.filter((r) => r.gate && r.gate !== "—").map((r) => `${r.gate} (${r.task})`);
    lines.push(`### Phase ${row.phase} starts with ${task}`, "",
      `${phaseRows.length} task(s): ${phaseRows.map((r) => r.task).join(", ")}. Heavy: ${phaseRows.filter((r) => heavyReasons(r, cfg).length).map((r) => r.task).join(", ") || "none"}.` +
      (gates.length ? ` Ends at ${gates.join(", ")}, which waits for your merge.` : ""), "");
  }
  if (heavy) {
    lines.push(`### ${held ? "Held" : "Starting"}: ${task} attempt ${attempt} is a heavy run`, "",
      `**${row.name}** · ${reasons.join(" · ")}.`, "",
      held
        ? `It waits for you. Comment \`/devos go\` here when your Claude and Cursor plans have room (a heavy run can use a large part of a usage window). Or run **devos-cycle** with task \`${task}\` and **go** ticked.`
        : `It is starting now${process.env.RUN_URL ? ` ([run](${process.env.RUN_URL}))` : ""}. If a usage limit stops it, it parks and resumes by itself after the reset; nothing is lost.`,
      "", `Outlook: ${outlook}`);
  }
  if (held) lines.push("", `<!-- devos-held task=${task} attempt=${attempt} -->`);
  const body = lines.join("\n");

  if (process.argv.includes("--dry-run") || !process.env.GH_TOKEN) { console.log(body); return; }
  const repo = process.env.GITHUB_REPOSITORY;
  const issue = await noticesIssue(repo);
  await gh(`repos/${repo}/issues/${issue}/comments`, { method: "POST", body: { body } });
  console.log(`heavy: notice posted on issue #${issue}${held ? " (held)" : ""}`);
}

if (process.argv[1]?.endsWith("heavy.mjs")) {
  main().catch((e) => {
    // A notice that cannot be posted never blocks the cycle; a hold that cannot be posted does not hold.
    console.log(`::warning title=Dev OS::heavy-run notice failed: ${e.message}`);
    emit({ held: "false" });
  });
}
