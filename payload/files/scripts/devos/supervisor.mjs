#!/usr/bin/env node
// Dev OS supervisor: notices when the automation has stopped or stalled, works out why, and fixes what
// is safe to fix on its own. Everything it does or proposes is one comment on the "Dev OS: supervisor"
// issue; a fix that changes the automation, a fence or a plan always goes through a pull request or an
// issue the owner approves. It never merges, never pushes to main, never touches a secret.
//
// Usage:
//   node scripts/devos/supervisor.mjs scan   [--dry-run]   → .devos/supervisor/{facts,incidents}.json
//   node scripts/devos/supervisor.mjs act    [--dry-run] [--claude .devos/supervisor/claude.json]
//   node scripts/devos/supervisor.mjs approve --comment-id <id> --body "<comment>"
// Env: GH_TOKEN (the runner token), REPO, EVENT_NAME, WF_NAME, WF_RUN_ID, WF_CONCLUSION.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { P, config, parsePhases, nextOpenTask, emit } from "./lib.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] || "scan";
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = "") => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? d : d; };
const DRY = flag("dry-run");
const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY || "";
const DIR = P(".devos/supervisor");
mkdirSync(DIR, { recursive: true });

const cfg = config();
const S = {
  max_auto_per_key: 2, max_ai_per_day: 6, idle_minutes: 20, overdue_park_minutes: 45,
  issue_title: "Dev OS: supervisor", issue_label: "devos:supervisor", ...(cfg.supervisor ?? {}),
};
const CYCLE = "devos-cycle.yml";

// ---------- GitHub helpers ----------
// Reports go out with REPORT_TOKEN (the workflow's built-in token): its comments start no workflow, so
// the supervisor can never wake itself up through its own issue. Only a `/devos revise` it posts on
// purpose uses GH_TOKEN (the owner's token), because that comment must start the revision.
function gh(args, { input, allowFail = false, report = false } = {}) {
  const env = report && process.env.REPORT_TOKEN ? { ...process.env, GH_TOKEN: process.env.REPORT_TOKEN } : process.env;
  try {
    return execFileSync("gh", args, { encoding: "utf8", input, env, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return "";
    throw new Error(`gh ${args.join(" ")} failed: ${String(e.stderr || e.message).slice(0, 400)}`);
  }
}
const api = (path, extra = []) => {
  const out = gh(["api", path, ...extra], { allowFail: true });
  try { return out ? JSON.parse(out) : null; } catch { return out; }
};
const minutesSince = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- facts ----------
function collect() {
  const rows = parsePhases().rows;
  const next = nextOpenTask(rows);
  const runsJson = api(`repos/${REPO}/actions/workflows/${CYCLE}/runs?per_page=25`) || { workflow_runs: [] };
  const runs = (runsJson.workflow_runs || []).map((r) => ({
    id: r.id, title: r.display_title, status: r.status, conclusion: r.conclusion,
    created: r.created_at, updated: r.updated_at, url: r.html_url,
  }));
  const active = runs.filter((r) => ["queued", "in_progress", "waiting", "requested", "pending"].includes(r.status));
  const prsJson = api(`repos/${REPO}/pulls?state=open&per_page=50`) || [];
  const prs = (Array.isArray(prsJson) ? prsJson : []).map((p) => ({
    number: p.number, head: p.head.ref, title: p.title, labels: p.labels.map((l) => l.name), updated: p.updated_at,
  }));
  const taskPrs = prs.filter((p) => /^task\/T\d\d$/.test(p.head));
  const intakePrs = prs.filter((p) => p.head.startsWith("intake/"));
  const rescueRefs = api(`repos/${REPO}/git/matching-refs/heads/rescue/`) || [];
  const rescues = (Array.isArray(rescueRefs) ? rescueRefs : []).map((r) => ({ ref: r.ref.replace("refs/heads/", ""), sha: r.object.sha }));
  // Open change requests and method fixes (closed by rule 5 once every task their plan added is done).
  const reqJson = api(`repos/${REPO}/issues?state=open&per_page=100`) || [];
  const requests = (Array.isArray(reqJson) ? reqJson : [])
    .filter((i) => !i.pull_request && i.labels.some((l) => ["devos:request", "devos:method"].includes(l.name)))
    .map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name) }));
  const facts = {
    at: new Date().toISOString(), repo: REPO, requests,
    event: { name: process.env.EVENT_NAME || "", workflow: (process.env.WF_PATH || "").split("/").pop().replace(/\.ya?ml$/, "") || process.env.WF_NAME || "", run: process.env.WF_RUN_ID || "", conclusion: process.env.WF_CONCLUSION || "" },
    next_task: next ? { task: next.task, name: next.name, phase: next.phase } : null,
    runs, active: active.map((r) => r.id), task_prs: taskPrs, intake_prs: intakePrs.map((p) => p.number), rescues,
  };
  writeFileSync(`${DIR}/facts.json`, JSON.stringify(facts, null, 2));
  return facts;
}

function failingStep(runId) {
  const jobs = api(`repos/${REPO}/actions/runs/${runId}/jobs`)?.jobs || [];
  for (const j of jobs) {
    const step = (j.steps || []).find((s) => s.conclusion === "failure" || s.conclusion === "timed_out" || s.conclusion === "cancelled");
    if (j.conclusion === "failure" || step) {
      const log = gh(["api", `repos/${REPO}/actions/jobs/${j.id}/logs`], { allowFail: true });
      const lines = log.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
      // The last lines, plus any earlier line that names an outside failure (a retry loop can push it up).
      const hits = lines.slice(0, -160).filter((l) => ENV_RE.test(l) || FONTS_RE.test(l)).slice(-10);
      const tail = [...hits, ...lines.slice(-160)].join("\n");
      return { job: j.name, step: step?.name || "", tail };
    }
  }
  return { job: "", step: "", tail: "" };
}

function lastBotComment(pr) {
  const cs = api(`repos/${REPO}/issues/${pr}/comments?per_page=100`) || [];
  return (Array.isArray(cs) ? cs : []).filter((c) => /^### Dev OS |Dev OS runner stopped/.test(c.body || "")).pop() || null;
}
// The owner (or an approved proposal) already answered this stop: a revision was asked for after it.
function answeredAfter(pr, since) {
  const cs = api(`repos/${REPO}/issues/${pr}/comments?per_page=100`) || [];
  return (Array.isArray(cs) ? cs : []).some((c) => c.created_at > since && /^(\/devos revise|Dev OS: revising)/.test(c.body || ""));
}

const taskOf = (s) => (String(s).match(/\bT\d\d\b/) || [""])[0];
const attemptOf = (s) => Number((String(s).match(/attempt (\d+)/) || [0, 0])[1]) || 0;

// ---------- incident rules (cheap first; Claude only for what no rule explains) ----------
const ENV_RE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|Could not resolve host|50[234] (Bad Gateway|Service Unavailable|Gateway Timeout)|rate limit exceeded|toomanyrequests|failed to pull|registry\.npmjs\.org.*(timeout|ECONN)|The operation was canceled|runner has received a shutdown signal|lost communication with the server/i;

const FONTS_RE = /Google Fonts download failed|could not download the Google Fonts|next\/font\/google queries|fonts\.(googleapis|gstatic)\.com|Failed to fetch .*Google Fonts/i;

function detect(facts) {
  const inc = [];
  const add = (o) => inc.push({ id: `${o.kind}-${o.task || "x"}-${Date.now().toString(36)}-${inc.length}`, ...o });
  const busy = facts.active.length > 0;

  // 1. A cycle run that just failed (the event) or the latest finished run for an open task that failed.
  const failedRuns = [];
  if (facts.event.workflow === "devos-cycle" && facts.event.conclusion === "failure" && facts.event.run) {
    const r = facts.runs.find((x) => String(x.id) === String(facts.event.run));
    if (r) failedRuns.push(r);
  }
  // Every scan: the latest finished cycle run failed and nothing came after it. A run dispatched with
  // the built-in token (the wait and resume jobs) fires no workflow_run event, so its failure is only
  // ever seen here.
  const latest = facts.runs.find((x) => x.status === "completed");
  if (latest && latest.conclusion === "failure" && minutesSince(latest.updated) < 24 * 60 && !failedRuns.some((x) => x.id === latest.id)) failedRuns.push(latest);
  // 1b. The checks (ci) or the production deploy failed on main. An outside failure of ci (network,
  // Google Fonts) is re-run. A deploy is re-run only when an outside service failed it **and** the
  // site was not deployed (the build failed before the upload; migrations are idempotent); every other
  // deploy failure is only reported.
  if (["ci", "devos-deploy"].includes(facts.event.workflow) && facts.event.conclusion === "failure" && facts.event.run) {
    const run = Number(facts.event.run), f = failingStep(run);
    const outside = ENV_RE.test(f.tail) || FONTS_RE.test(f.tail);
    const base = { kind: "main-failure", task: "", attempt: 0, run, url: `https://github.com/${REPO}/actions/runs/${run}`, step: f.step, evidence: f.tail.slice(-6000) };
    if (facts.event.workflow === "ci") {
      add({ ...base, key: `main:ci:${run}`, cause: outside ? `the checks on main failed on an outside service (${FONTS_RE.test(f.tail) ? "the Google Fonts download" : "the network"}), not on the code` : "", action: outside ? "rerun-failed" : "ask-claude" });
    } else {
      const untouched = /site was not deployed|the app did not move|before the app moves/i.test(f.tail);
      add({ ...base, key: `main:deploy:${run}`, safe_deploy: outside && untouched, action: outside && untouched ? "rerun-failed" : "report",
        cause: `the production deploy failed at "${f.step || f.job || "?"}"${outside ? ` on an outside service (${FONTS_RE.test(f.tail) ? "the Google Fonts download" : "the network"})` : ""}${untouched ? "; the site was not deployed" : ""}` });
    }
  }

  for (const r of failedRuns) {
    const task = taskOf(r.title), attempt = attemptOf(r.title);
    const later = facts.runs.find((x) => taskOf(x.title) === task && new Date(x.created) > new Date(r.created));
    if (later) continue;
    const f = failingStep(r.id);
    const base = { kind: "runner-failure", task, attempt, run: r.id, url: r.url, step: f.step, evidence: f.tail.slice(-6000), review_only: /review only/i.test(r.title) };
    if (/exceeds max_attempts/.test(f.tail)) {
      // A resume that lost its revision flag (fixed in next-task.mjs; kept as a rule for old runs).
      add({ ...base, key: `${task}:a${attempt}:attempt-limit:${r.id}`, cause: "the resumed run lost its revision flag and was refused as an attempt over max_attempts", action: "redispatch" });
      continue;
    }
    const rescue = (f.tail.match(/saved on branch (rescue\/\S+?)[ .(]/) || [])[1];
    if (/conflicts with this task's work/.test(f.tail)) {
      add({ ...base, key: `${task}:a${attempt}:push-conflict`, cause: "main changed during the run and the push conflicted", action: rescue ? "recover-rescue" : "redispatch", rescue });
    } else if (/has timed out/.test(f.tail)) {
      add({ ...base, key: `${task}:a${attempt}:step-timeout`, cause: `step "${f.step}" timed out`, action: "redispatch" });
    } else if (ENV_RE.test(f.tail) || /^(Install|Set up|Run actions\/|Supabase CLI|Firebase CLI|Local module services|Check out)/.test(f.step)) {
      add({ ...base, key: `${task}:a${attempt}:env:${f.step}`, cause: `an environment failure in "${f.step}"`, action: "rerun-failed" });
    } else if (/no Cursor key|no Claude|set secret|Setup needed|permission/i.test(f.tail)) {
      add({ ...base, key: `${task}:setup`, cause: "a missing secret, variable or permission", action: "setup" });
    } else {
      add({ ...base, key: `${task}:a${attempt}:unknown:${f.step}`, cause: "", action: "ask-claude" });
    }
  }

  // 2. Task PRs the cycle left halted or parked.
  for (const pr of facts.task_prs) {
    const task = pr.head.slice(5);
    if (pr.labels.includes("devos:halted")) {
      const c = lastBotComment(pr.number);
      if (c && answeredAfter(pr.number, c.created_at)) continue;
      const body = c?.body || "";
      const attempt = attemptOf(body);
      const base = { kind: "halted", task, attempt, pr: pr.number, evidence: body.slice(0, 4000) };
      if (/time slice|time budget used up|builder budget|used all \d+ time slices/i.test(body)) {
        add({ ...base, key: `${task}:a${attempt}:budget`, cause: "the builder ran out of time with work saved on the branch", action: "revise-continue" });
      } else if (/builder stuck/i.test(body)) {
        add({ ...base, key: `${task}:a${attempt}:stuck`, cause: "the builder stopped changing anything twice", action: "redispatch" });
      } else if (/Dev OS runner stopped on a failure/.test(body)) {
        // Covered by rule 1 when the event arrives; on a scheduled scan, look at the run it names.
        const runId = (body.match(/actions\/runs\/(\d+)/) || [])[1];
        if (runId && !failedRuns.some((r) => String(r.id) === runId)) {
          const f = failingStep(runId);
          const rescue = (f.tail.match(/saved on branch (rescue\/\S+?)[ .(]/) || [])[1];
          const conflict = /conflicts with this task's work/.test(f.tail);
          add({ ...base, run: Number(runId), step: f.step, evidence: f.tail.slice(-6000),
            key: `${task}:a${attempt}:runner:${f.step}`, cause: conflict ? "main changed during the run and the push conflicted" : "",
            action: conflict ? (rescue ? "recover-rescue" : "redispatch") : ENV_RE.test(f.tail) ? "redispatch" : "ask-claude", rescue });
        }
      } else {
        add({ ...base, key: `${task}:a${attempt}:halt`, cause: "", action: "ask-claude" });
      }
    }
    if (pr.labels.includes("devos:quota-wait") && !busy) {
      const c = lastBotComment(pr.number);
      const nb = (c?.body?.match(/not_before=(\S+?) /) || [])[1];
      if (nb && minutesSince(nb) > S.overdue_park_minutes) {
        add({ kind: "parked-overdue", task, attempt: attemptOf(c.body), pr: pr.number, key: `${task}:park-overdue:${nb}`,
          cause: `parked until ${nb}, still not resumed`, action: "redispatch" });
      }
    }
  }

  // 3. Rescue branches nobody recovered.
  for (const r of facts.rescues) {
    const task = taskOf(r.ref);
    if (!inc.some((i) => i.rescue === r.ref)) {
      add({ kind: "rescue", task, attempt: 0, key: `${task}:rescue:${r.ref}`, cause: `the work of a failed push is waiting on ${r.ref}`, action: "recover-rescue", rescue: r.ref });
    }
  }

  // 4. Nothing moving although work is waiting.
  const lastRun = facts.runs[0];
  const waitingForOwner = facts.task_prs.some((p) => p.labels.some((l) => ["devos:human-gate", "devos:quota-wait", "devos:halted", "devos:needs-you"].includes(l)));
  if (!busy && !waitingForOwner && !inc.length && facts.next_task && facts.intake_prs.length === 0 &&
      (!lastRun || minutesSince(lastRun.updated) > S.idle_minutes) &&
      !facts.task_prs.some((p) => p.head === `task/${facts.next_task.task}`)) {
    add({ kind: "idle", task: facts.next_task.task, attempt: 1, key: `${facts.next_task.task}:idle`,
      cause: `nothing has run for ${lastRun ? Math.round(minutesSince(lastRun.updated)) : "?"} min and ${facts.next_task.task} is waiting`, action: "dispatch-next" });
  }
  // 5. Requests that are finished: the plan PR (intake/issue-N) is merged and every task row it added to
  //    docs/PHASES.md is ticked PASS on main (a task's PASS reaches main only through its merge).
  const doneNow = new Set(parsePhases().rows.filter((r) => r.done).map((r) => r.task));
  for (const req of facts.requests || []) {
    if (req.labels.includes("devos:quota-wait")) continue;
    const plan = plannedTasks(req.number);
    if (!plan) continue;
    const open = plan.tasks.filter((t) => !doneNow.has(t));
    if (open.length) continue;
    add({ kind: "request-done", task: "", attempt: 0, issue: req.number, plan_pr: plan.pr, tasks: plan.tasks, key: `issue-${req.number}:done`,
      cause: `request #${req.number} is finished: its plan (PR #${plan.pr}) ${plan.tasks.length ? `added ${plan.tasks.join(", ")}, and every one is PASS and merged` : "added no task, and it is merged"}`,
      action: "close-request" });
  }
  return inc;
}

// The task rows a request's merged plan PR added: PHASES.md at the merge commit minus at its first parent.
function plannedTasks(issue) {
  const owner = REPO.split("/")[0];
  const prs = api(`repos/${REPO}/pulls?state=closed&head=${owner}:intake/issue-${issue}&per_page=10`) || [];
  const merged = (Array.isArray(prs) ? prs : []).filter((p) => p.merged_at).pop();
  if (!merged?.merge_commit_sha) return null;
  const parent = api(`repos/${REPO}/commits/${merged.merge_commit_sha}`)?.parents?.[0]?.sha;
  if (!parent) return null;
  const ids = (sha) => {
    const f = api(`repos/${REPO}/contents/docs/PHASES.md?ref=${sha}`);
    const text = f?.content ? Buffer.from(f.content, "base64").toString("utf8") : "";
    return new Set([...text.matchAll(/^\| (T\d{2}) \|/gm)].map((m) => m[1]));
  };
  const before = ids(parent), after = ids(merged.merge_commit_sha);
  if (!after.size) return null;
  return { pr: merged.number, tasks: [...after].filter((t) => !before.has(t)) };
}

// ---------- the supervisor issue: one comment per incident, with a machine-readable marker ----------
function supervisorIssue() {
  const found = api(`repos/${REPO}/issues?labels=${encodeURIComponent(S.issue_label)}&state=open&per_page=1`);
  if (Array.isArray(found) && found[0]) return found[0].number;
  if (DRY) return 0;
  gh(["api", `repos/${REPO}/labels`, "-f", `name=${S.issue_label}`, "-f", "color=5319e7", "-f", "description=Dev OS supervisor reports"], { allowFail: true });
  const body = "The Dev OS supervisor reports here: one comment per incident, with what happened, what it did, and what needs you.\n\nApprove a proposal by replying `/devos approve <id>`, or decline it with `/devos reject <id>`. Turn the supervisor off with the repository variable `DEVOS_SUPERVISOR=off`.";
  const created = JSON.parse(gh(["api", `repos/${REPO}/issues`, "-f", `title=${S.issue_title}`, "-f", `body=${body}`, "-f", `labels[]=${S.issue_label}`], { report: true }));
  return created.number;
}
function history(issue) {
  if (!issue) return [];
  const cs = api(`repos/${REPO}/issues/${issue}/comments?per_page=100`) || [];
  return (Array.isArray(cs) ? cs : []).flatMap((c) => {
    const m = (c.body || "").match(/<!-- devos-supervisor (\{.*?\}) -->/);
    if (!m) return [];
    try { return [{ ...JSON.parse(m[1]), comment: c.id }]; } catch { return []; }
  });
}

// ---------- actions (the only things the supervisor ever does) ----------
function dispatch(fields) {
  const args = ["workflow", "run", CYCLE, "--repo", REPO, "--ref", "main"];
  for (const [k, v] of Object.entries(fields)) args.push("-f", `${k}=${v}`);
  if (DRY) return `dry-run: gh ${args.join(" ")}`;
  gh(args);
  return `dispatched ${CYCLE} ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ")}`;
}
const AUTO = {
  "close-request": (i) => {
    const body = `Dev OS: done. ${i.cause}. Closing this request; reopen it if something is missing.`;
    if (DRY) return { done: true, note: `dry-run: comment on #${i.issue} and close it as completed` };
    gh(["api", `repos/${REPO}/issues/${i.issue}/comments`, "-f", `body=${body}`], { report: true });
    gh(["api", "-X", "PATCH", `repos/${REPO}/issues/${i.issue}`, "-f", "state=closed", "-f", "state_reason=completed"], { report: true });
    return { done: true, note: `closed #${i.issue} as completed` };
  },
  "redispatch": (i, facts) => {
    if (facts.active.length) return { done: false, note: "a cycle run is active; it will be re-checked on the next scan" };
    return { done: true, note: dispatch({ task: i.task, attempt: String(i.attempt || 1), revision: "true", ...(i.review_only ? { review_only: "true" } : {}) }) };
  },
  "dispatch-next": (i) => ({ done: true, note: dispatch({ task: i.task, attempt: "1" }) }),
  "rerun-failed": (i) => {
    if (DRY) return { done: true, note: `dry-run: gh run rerun ${i.run} --failed` };
    gh(["run", "rerun", String(i.run), "--failed", "--repo", REPO]);
    return { done: true, note: `re-ran the failed job of run ${i.run}` };
  },
  "revise-continue": (i) => {
    const body = `/devos revise continue from the work on this branch: finish only what is still missing or failing against the Done-when list, never redo it. (Started by the Dev OS supervisor: ${i.cause}.)`;
    if (DRY) return { done: true, note: `dry-run: comment on PR #${i.pr}: ${body}` };
    gh(["api", `repos/${REPO}/issues/${i.pr}/comments`, "-f", `body=${body}`]);
    return { done: true, note: `asked for a continuation on PR #${i.pr} (\`/devos revise\`)` };
  },
  "recover-rescue": (i, facts) => {
    if (facts.active.length) return { done: false, note: "a cycle run is active; recovery waits for the next scan" };
    if (DRY) return { done: true, note: `dry-run: merge main into ${i.rescue}, push it to task/${i.task}, delete ${i.rescue}, dispatch review_only` };
    // The workflow runs the git part (it has the checkout and the credentials): see scripts/devos/rescue.sh.
    execFileSync("bash", [P("scripts/devos/rescue.sh"), i.rescue, `task/${i.task}`], { stdio: "inherit" });
    const attempt = i.attempt || attemptFromBranch(i.task);
    return { done: true, note: `recovered ${i.rescue} onto task/${i.task}; ${dispatch({ task: i.task, attempt: String(attempt), review_only: "true", revision: "true" })}` };
  },
};
function attemptFromBranch(task) {
  const commits = api(`repos/${REPO}/commits?sha=task/${task}&per_page=30`) || [];
  for (const c of Array.isArray(commits) ? commits : []) {
    const m = (c.commit?.message || "").match(new RegExp(`^${task} a(\\d+): builder`));
    if (m) return Number(m[1]);
  }
  return 1;
}

// ---------- report ----------
function report(issue, i, outcome) {
  const marker = { key: i.key, kind: i.kind, task: i.task, action: i.action, done: outcome.done, ai: !!i.ai, day: today(), id: i.id, pending: outcome.pending || null };
  const icon = outcome.pending ? "🟠" : outcome.done ? "🟢" : outcome.escalate ? "🔴" : "🟡";
  const lines = [
    `### ${icon} Dev OS supervisor · ${i.task || "—"}${i.attempt ? ` · attempt ${i.attempt}` : ""} · ${i.kind}`,
    "",
    `**What happened:** ${i.cause || "unknown"}${i.url ? ` ([run](${i.url}))` : ""}${i.pr ? ` · PR #${i.pr}` : ""}`,
    i.explanation ? `\n**Diagnosis (Claude):** ${i.explanation}` : "",
    `\n**What I did:** ${outcome.note}`,
    outcome.pending ? `\n**Needs your approval:** reply \`/devos approve ${i.id}\` to do it, or \`/devos reject ${i.id}\`.` : "",
    i.owner_steps ? `\n**Steps for you:**\n${i.owner_steps}` : "",
    "",
    `<!-- devos-supervisor ${JSON.stringify(marker)} -->`,
  ].filter((l) => l !== "");
  const body = lines.join("\n");
  if (DRY || !issue) { console.log(`\n--- report (dry-run) ---\n${body}`); return; }
  gh(["api", `repos/${REPO}/issues/${issue}/comments`, "-f", `body=${body}`], { report: true });
}
// Keys already reported and not acted on (a proposal, an escalation, a diagnosis, setup steps): never
// reported again. Keys whose fix ran (done) stay open, so a fix that did not work is retried up to
// max_auto_per_key times and then escalated once.
const reportedKeys = (hist) => new Set(hist.filter((h) => h.key && !h.done).map((h) => h.key));

// ---------- commands ----------
if (cmd === "scan") {
  const facts = collect();
  const issue = supervisorIssue();
  const hist = history(issue);
  const old = reportedKeys(hist);
  const incidents = detect(facts).filter((i) => !old.has(i.key));
  writeFileSync(`${DIR}/incidents.json`, JSON.stringify(incidents, null, 2));
  const aiToday = hist.filter((h) => h.ai && h.day === today()).length;
  const needAi = incidents.some((i) => i.action === "ask-claude") && aiToday < S.max_ai_per_day;
  console.log(`supervisor: ${incidents.length} incident(s); active cycle runs: ${facts.active.length}; AI today: ${aiToday}/${S.max_ai_per_day}`);
  for (const i of incidents) console.log(`  - ${i.kind} ${i.task} → ${i.action}${i.cause ? ` (${i.cause})` : ""}`);
  emit({ incidents: String(incidents.length), ask_claude: needAi ? "true" : "false", issue: String(issue || "") });
} else if (cmd === "act") {
  const facts = existsSync(`${DIR}/facts.json`) ? JSON.parse(readFileSync(`${DIR}/facts.json`, "utf8")) : collect();
  const incidents = existsSync(`${DIR}/incidents.json`) ? JSON.parse(readFileSync(`${DIR}/incidents.json`, "utf8")) : detect(facts);
  const cl = opt("claude") && existsSync(opt("claude")) ? JSON.parse(readFileSync(opt("claude"), "utf8")) : null;
  const ai = cl?.structured_output?.incidents || cl?.incidents || [];
  const issue = supervisorIssue();
  const hist = history(issue);
  const old = reportedKeys(hist);
  for (const i of incidents) {
    if (old.has(i.key)) { console.log(`already reported: ${i.key}`); continue; }
    old.add(i.key);
    if (!i.pr && i.task) i.pr = (facts.task_prs || []).find((p) => p.head === `task/${i.task}`)?.number;
    if (i.action === "ask-claude") {
      const d = ai.find((a) => a.id === i.id);
      if (!d) { report(issue, i, { done: false, escalate: true, note: "no rule explains this and no diagnosis was available; a person needs to look at the run" }); continue; }
      Object.assign(i, { ai: true, cause: d.cause, explanation: d.explanation, owner_steps: d.owner_steps || "", action: d.action, note: d.note || "", issue_title: d.issue_title, issue_body: d.issue_body });
    }
    const seen = hist.filter((h) => h.key === i.key && h.done).length;
    if (i.action === "report") {
      report(issue, i, { done: false, escalate: true, note: "I never re-run a production deploy; the deploy doctor's comment and the run log say what failed. Re-run devos-deploy (production) once it is fixed" });
      continue;
    }
    if (i.action === "rerun-failed" && i.kind === "main-failure" && /:deploy:/.test(i.key) && !i.safe_deploy) {
      report(issue, i, { done: false, escalate: true, note: "a deploy is never re-run by the supervisor" });
      continue;
    }
    if (i.action === "setup" || i.action === "none") {
      report(issue, i, { done: false, note: i.action === "setup" ? "nothing I can change: a secret, variable or permission is missing (see the \"Dev OS: setup needed\" issue)" : "no action needed" });
      continue;
    }
    if (["method-issue", "request-issue"].includes(i.action)) {
      if (hist.some((h) => h.key === i.key && h.action === i.action && h.day === today())) continue;
      const label = i.action === "method-issue" ? "devos:method" : "devos:request";
      const title = i.issue_title || `${i.action === "method-issue" ? "Method fix" : "Request"}: ${i.cause}`.slice(0, 120);
      const body = `${i.issue_body || i.explanation || i.cause}\n\n_Opened by the Dev OS supervisor (${i.kind}, ${i.task || "no task"}). The plan it starts still needs your merge._`;
      if (DRY) { report(issue, i, { done: true, note: `dry-run: open issue "${title}" with label ${label}` }); continue; }
      const made = JSON.parse(gh(["api", `repos/${REPO}/issues`, "-f", `title=${title}`, "-f", `body=${body}`, "-f", `labels[]=${label}`]));
      report(issue, i, { done: true, note: `opened #${made.number} (${label}); its plan PR waits for your merge` });
      continue;
    }
    if (["revise-with-note", "revise-continue"].includes(i.action) && !i.pr) {
      report(issue, i, { done: false, escalate: true, note: `wanted "${i.action}" but task/${i.task} has no open pull request` });
      continue;
    }
    if (i.action === "revise-with-note") {
      report(issue, i, { done: false, pending: { pr: i.pr, note: i.note }, note: `proposed a revision of PR #${i.pr}: "${i.note}"` });
      continue;
    }
    if (seen >= S.max_auto_per_key) {
      report(issue, i, { done: false, escalate: true, note: `the same fix ("${i.action}") already ran ${seen} time(s) for this; I stopped, a person needs to look` });
      if (i.pr && !DRY) gh(["api", `repos/${REPO}/issues/${i.pr}/labels`, "-f", "labels[]=devos:needs-you"], { allowFail: true });
      continue;
    }
    const fn = AUTO[i.action];
    if (!fn) { report(issue, i, { done: false, escalate: true, note: `no automatic action "${i.action}"; a person needs to look` }); continue; }
    let out;
    try { out = fn(i, facts); } catch (e) { out = { done: false, escalate: true, note: `the fix failed: ${String(e.message).slice(0, 300)}` }; }
    if (out.done || out.escalate) report(issue, i, out);
    else console.log(`deferred: ${i.key}: ${out.note}`);
  }
} else if (cmd === "classify") {
  // Diagnostics: how the rules read one past cycle run (no action, nothing posted).
  const runId = opt("run");
  const r = api(`repos/${REPO}/actions/runs/${runId}`);
  const facts = { event: { workflow: "devos-cycle", conclusion: r.conclusion, run: String(runId) }, active: [], task_prs: [], intake_prs: [], rescues: [], next_task: null,
    runs: [{ id: r.id, title: r.display_title, status: r.status, conclusion: r.conclusion, created: r.created_at, updated: r.updated_at, url: r.html_url }] };
  for (const i of detect(facts)) console.log(JSON.stringify({ kind: i.kind, task: i.task, attempt: i.attempt, step: i.step, key: i.key, cause: i.cause, action: i.action, rescue: i.rescue || null }));
} else if (cmd === "approve") {
  const body = opt("body"); const m = body.match(/^\/devos (approve|reject) (\S+)/);
  if (!m) process.exit(0);
  const issue = supervisorIssue();
  const hist = history(issue);
  const target = hist.find((h) => h.id === m[2] && h.pending && !hist.some((x) => x.decided === m[2]));
  if (!target) { gh(["api", `repos/${REPO}/issues/${issue}/comments`, "-f", `body=Dev OS supervisor: no pending proposal with id \`${m[2]}\`.`], { report: true }); process.exit(0); }
  const decided = `\n\n<!-- devos-supervisor ${JSON.stringify({ decided: m[2], key: target.key, day: today() })} -->`;
  if (m[1] === "reject") { gh(["api", `repos/${REPO}/issues/${issue}/comments`, "-f", `body=Dev OS supervisor: \`${m[2]}\` rejected; nothing done.${decided}`], { report: true }); process.exit(0); }
  const p = target.pending;
  gh(["api", `repos/${REPO}/issues/${p.pr}/comments`, "-f", `body=/devos revise ${p.note} (Approved by the owner from the Dev OS supervisor, ${m[2]}.)`]);
  gh(["api", `repos/${REPO}/issues/${issue}/comments`, "-f", `body=Dev OS supervisor: \`${m[2]}\` approved; the revision is posted on PR #${p.pr}.${decided}`], { report: true });
}
