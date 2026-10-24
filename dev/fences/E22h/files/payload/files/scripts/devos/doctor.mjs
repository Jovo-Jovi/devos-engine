#!/usr/bin/env node
// Gate doctor (PR-15): works out what stands between a PR and its merge, says it on the PR in plain
// words, fixes what is safe to fix on its own, and sets the commit status `devos/gate`.
//
//   collect  → reads the PR, its checks, the ci evidence and logs, the Vercel preview, and applies
//              the known-issue rules. Writes .devos/doctor/findings.json. Emits ask_claude=true when
//              a failure matches no rule (the workflow then asks Claude for a second opinion).
//   publish  → posts or updates one sticky PR comment, sets `devos/gate`, toggles the
//              `devos:needs-you` label, and re-runs a ci run that failed for an environment reason
//              (once per commit: only when that run is on its first attempt).
//
// Usage: node scripts/devos/doctor.mjs collect --pr 13
//        node scripts/devos/doctor.mjs publish [--claude .devos/doctor/claude.json] [--dry-run]
// Env:   GH_TOKEN, GITHUB_REPOSITORY (owner/repo); optional VERCEL_TOKEN, VERCEL_ORG_ID,
//        VERCEL_PROJECT_ID, VERCEL_AUTOMATION_BYPASS_SECRET, GITHUB_SERVER_URL, GITHUB_RUN_ID.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, emit, fail } from "./lib.mjs";

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const mode = process.argv[2];
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? "") : ""; };
const REPO = process.env.GITHUB_REPOSITORY || (direct ? fail("GITHUB_REPOSITORY is not set") : "");

export function previewBehindLogin(bypass) {
  if (bypass) return { level: "warn", state: "behind the Vercel login" };
  return { level: "info", state: "behind the Vercel login (expected)" };
}
const SERVER = process.env.GITHUB_SERVER_URL || "https://github.com";
const OUT = P(".devos/doctor");
const MARK = "<!-- devos-doctor -->";

// ---------- GitHub and Vercel access -------------------------------------------------------

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "devos-doctor" };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
  const url = path.startsWith("https://") ? path : `https://api.github.com/${path.replace(/^\//, "")}`;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (raw) return r;
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const ghSafe = (path, opts) => gh(path, opts).catch((e) => ({ error: e.message }));

async function vercel(path) {
  const t = process.env.VERCEL_TOKEN;
  if (!t) return null;
  const sep = path.includes("?") ? "&" : "?";
  const team = process.env.VERCEL_ORG_ID?.startsWith("team_") ? `${sep}teamId=${process.env.VERCEL_ORG_ID}` : "";
  try {
    const r = await fetch(`https://api.vercel.com${path}${team}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20000) });
    return r.ok ? r.json() : { error: `${r.status}` };
  } catch (e) { return { error: e.message }; }
}

const tail = (s, n = 40) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter(Boolean).slice(-n).join("\n");

// ---------- known-issue rules for failed checks -----------------------------------------------

const ENV_RULES = [
  { id: "google-fonts", re: /next\/font|fonts\.(googleapis|gstatic)\.com|Failed to fetch .*Google Fonts|queries have exactly one entry/i,
    what: "the build could not download the Google Fonts it needs (next/font fetches them at build time)" },
  { id: "network", re: /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|ERR_PNPM_(META_)?FETCH|ERR_SOCKET|429 Too Many Requests|503 Service Unavailable|502 Bad Gateway/i,
    what: "a network download failed on the GitHub runner" },
  { id: "browser", re: /Executable doesn't exist|browserType\.launch|Please run the following command to download new browsers/i,
    what: "the Playwright browser was not installed on the runner" },
  { id: "disk", re: /ENOSPC|No space left on device/i, what: "the GitHub runner ran out of disk" },
  { id: "docker", re: /Cannot connect to the Docker daemon|toomanyrequests|pull rate limit|failed to pull image|error (pulling|running) (image|container)|container .* is not ready|health check timed out/i,
    what: "the local Supabase stack (Docker) did not start on the runner" },
];
const classify = (text) => ENV_RULES.find((r) => r.re.test(text)) ?? null;

// ---------- collect --------------------------------------------------------------------------

async function collect() {
  const prNum = Number(arg("pr"));
  if (!prNum) fail("collect needs --pr <number>");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const pr = await gh(`repos/${REPO}/pulls/${prNum}`);
  const sha = pr.head.sha;
  const branch = pr.head.ref;
  const task = /^task\/(T\d+)$/.exec(branch)?.[1] ?? "";
  const labels = pr.labels.map((l) => l.name);
  const f = { pr: prNum, sha, short: sha.slice(0, 7), branch, task, state: pr.state, merged: pr.merged, labels,
    mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, items: [], ask_claude: false, rerun: null, evidence: [] };
  const add = (o) => f.items.push(o);

  if (pr.state !== "open") {
    add({ key: "pr", label: "Pull request", level: "info", state: `${pr.merged ? "merged" : "closed"}`, todo: [] });
    return save(f);
  }

  // 1. Review verdict (devos/verdict, PR-13) and the runner's labels.
  if (task) {
    const st = await ghSafe(`repos/${REPO}/commits/${sha}/status`);
    const v = (st.statuses ?? []).find((s) => s.context === "devos/verdict");
    if (labels.includes("devos:halted")) {
      add({ key: "verdict", label: "Review verdict", level: "block", state: "halted by the runner",
        todo: [{ who: "you", text: "Read the runner's last comment on this PR: it names the cause. Fix it, then re-run **devos-cycle** with the task and attempt it gives." }] });
    } else if (labels.includes("devos:quota-wait")) {
      add({ key: "verdict", label: "Review verdict", level: "wait", state: "parked on a usage limit",
        todo: [{ who: "auto", text: "The runner resumes by itself when the limit resets (see its comment for the time). Nothing to do." }] });
    } else if (!v) {
      add({ key: "verdict", label: "Review verdict", level: "block", state: `no verdict on \`${f.short}\``,
        todo: [{ who: "you", text: `The head commit has no review. If a cycle is running, wait. Otherwise run **Actions → devos-cycle → Run workflow** with task \`${task}\`, the last attempt number, and **review_only** ticked.` }] });
    } else if (v.state === "success") {
      add({ key: "verdict", label: "Review verdict", level: "ok", state: v.description, todo: [] });
    } else if (v.state === "pending") {
      add({ key: "verdict", label: "Review verdict", level: "wait", state: v.description || "review running", todo: [{ who: "auto", text: "The review is still running." }] });
    } else {
      add({ key: "verdict", label: "Review verdict", level: "block", state: v.description || "FAIL",
        todo: [{ who: "auto", text: "The runner retries a FAIL with a reissued fence until max_attempts; after the last attempt it halts and asks you." }] });
    }
  }

  // 2. Checks before merge (PR-25): the cycle posts devos/checks on the PR's head. A ci run, if one was
  // started by hand, is shown below it.
  const statuses = (await ghSafe(`repos/${REPO}/commits/${sha}/status`)).statuses ?? [];
  const chk = statuses.find((s) => s.context === "devos/checks");
  if (chk) {
    const lvl = chk.state === "success" ? "ok" : chk.state === "pending" ? "wait" : "block";
    add({ key: "checks", label: "Checks (devos/checks)", level: lvl, state: chk.description || chk.state, link: chk.target_url,
      todo: lvl === "block" ? [{ who: "auto", text: "A red required check fails the verdict (PR-08): the runner retries with a reissued fence, or halts after the last attempt." }] : [] });
  } else if (task) {
    add({ key: "checks", label: "Checks (devos/checks)", level: "info", state: "not posted on this commit (older runs did not post it)", todo: [] });
  }
  const runs = (await ghSafe(`repos/${REPO}/actions/runs?head_sha=${sha}&per_page=50`)).workflow_runs ?? [];
  const ci = runs.filter((r) => r.name === "ci").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!ci) {
    // ci no longer runs on pull requests (PR-25); devos/checks above is the pre-merge check.
  } else if (ci.status !== "completed") {
    add({ key: "ci", label: "ci checks", level: "wait", state: `${ci.status} (attempt ${ci.run_attempt})`, link: ci.html_url, todo: [{ who: "auto", text: "ci is still running; the doctor checks again when it finishes." }] });
  } else if (ci.conclusion === "action_required" && /^(task|intake)\//.test(f.branch)) {
    // PR-21: on the runner's own PRs the cycle already ran these checks (PR-08), so a held ci is not a blocker.
    add({ key: "ci", label: "ci checks", level: "info", state: "not run (GitHub holds it for approval)", link: ci.html_url,
      todo: [{ who: "auto", text: "Not needed: the cycle ran the same checks on this branch, and a red one would have failed the verdict (PR-08). You may ignore the yellow \"Approve and run\" banner." }] });
  } else if (ci.conclusion === "action_required") {
    add({ key: "ci", label: "ci checks", level: "block", state: "waiting for your approval", link: ci.html_url,
      todo: [{ who: "you", text: `GitHub holds \`ci\` on bot-opened PRs until someone approves it. Open the [run](${ci.html_url}) and press **Approve and run** (or the yellow banner on the PR's Checks tab). The doctor runs again when ci finishes.` }] });
  } else if (ci.conclusion === "success") {
    add({ key: "ci", label: "ci checks", level: "ok", state: `passed`, link: ci.html_url, todo: [] });
  } else if (ci.conclusion === "skipped") {
    add({ key: "ci", label: "ci checks", level: "info", state: "skipped on runner PRs (PR-23)", link: ci.html_url,
      todo: [{ who: "auto", text: "The cycle ran these checks on this branch; their result is in the verdict (PR-08)." }] });
  } else {
    await diagnoseCi(f, ci, add);
    // PR-23: on the runner's own PRs the cycle's checks are authoritative; a separate ci failure is shown,
    // with its diagnosis, but does not block the merge.
    const item = f.items.find((i) => i.key === "ci");
    if (item && /^(task|intake)\//.test(f.branch) && item.level === "block") {
      item.level = "warn";
      item.todo.unshift({ who: "auto", text: "Not a blocker: the cycle's own run of these checks passed on this code (devos/verdict, PR-08). This extra ci run was started by hand; its diagnosis follows for your information." });
    }
  }

  // 3. Vercel preview of this branch (task PRs only).
  if (task && process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) await diagnoseVercel(f, add);

  // 4. Branch against main.
  if (f.mergeable_state === "dirty") {
    add({ key: "main", label: "Branch vs main", level: "block", state: "conflicts with main",
      todo: [{ who: "you", text: "Press **Resolve conflicts** on the PR (or ask in a change request). Then comment `/devos doctor`." }] });
  } else {
    const cmp = await ghSafe(`repos/${REPO}/compare/${pr.base.ref}...${sha}`);
    const behind = cmp.behind_by ?? 0;
    // PR-25: a task PR waiting at the gate while main gained code is re-checked against that main,
    // automatically and without a new review (review_only + reuse_review), before you merge it.
    let codeMoved = [];
    if (behind && task) {
      const onMain = await ghSafe(`repos/${REPO}/compare/${sha}...${pr.base.ref}`);
      codeMoved = (onMain.files ?? []).map((x) => x.filename).filter((n) => !n.startsWith("docs/"));
    }
    const verdict = statuses.find((s) => s.context === "devos/verdict");
    const attempt = /attempt (\d+)/.exec(verdict?.description ?? "")?.[1];
    if (codeMoved.length && labels.includes("devos:human-gate") && verdict?.state === "success" && attempt) {
      const active = ((await ghSafe(`repos/${REPO}/actions/workflows/devos-cycle.yml/runs?per_page=10`)).workflow_runs ?? [])
        .some((r) => r.status !== "completed");
      if (!active) f.recheck = { task, attempt };
      add({ key: "main", label: "Branch vs main", level: "wait", state: `${behind} commit(s) behind; main changed ${codeMoved.length} code file(s)`,
        todo: [{ who: "auto", text: active ? "A cycle run is active; the re-check against the latest main starts when it is free (comment `/devos doctor` to retry)." : "Re-checking this branch merged with the latest main (no new review). The doctor reports again when it finishes." }] });
    } else {
      add({ key: "main", label: "Branch vs main", level: "ok", state: behind ? `${behind} commit(s) behind, no conflicts${codeMoved.length ? "" : " (docs only)"}` : "up to date", todo: [] });
    }
  }
  return save(f);
}

async function diagnoseCi(f, ci, add) {
  // Prefer the evidence artifact run-checks.mjs writes; fall back to the failed jobs' logs.
  let text = "", failed = [], optionalOnly = false;
  const arts = (await ghSafe(`repos/${REPO}/actions/runs/${ci.id}/artifacts`)).artifacts ?? [];
  const ev = arts.find((a) => a.name === "ci-evidence" && !a.expired);
  if (ev) {
    try {
      const r = await gh(`repos/${REPO}/actions/artifacts/${ev.id}/zip`, { raw: true });
      writeFileSync(`${OUT}/ci-evidence.zip`, Buffer.from(await r.arrayBuffer()));
      mkdirSync(`${OUT}/ci`, { recursive: true });
      execFileSync("unzip", ["-oq", `${OUT}/ci-evidence.zip`, "-d", `${OUT}/ci`]);
      const res = JSON.parse(readFileSync(`${OUT}/ci/ci-results.json`, "utf8"));
      failed = res.results.filter((x) => x.status !== "pass" && !String(x.status).startsWith("skipped"));
      optionalOnly = failed.length > 0 && failed.every((x) => !x.required);
      // The first failed check is the cause; later ones (e2e after a failed build) are consequences.
      for (const x of failed) {
        const log = existsSync(`${OUT}/ci/logs/${x.name}.log`) ? readFileSync(`${OUT}/ci/logs/${x.name}.log`, "utf8") : x.tail;
        text += `\n### ${x.name}\n${log}`;
      }
    } catch (e) { f.evidence.push(`ci evidence artifact unreadable: ${e.message}`); }
  }
  if (!text) {
    const jobs = (await ghSafe(`repos/${REPO}/actions/runs/${ci.id}/jobs`)).jobs ?? [];
    for (const j of jobs.filter((j) => j.conclusion === "failure")) {
      const r = await gh(`repos/${REPO}/actions/jobs/${j.id}/logs`, { raw: true }).catch(() => null);
      if (r?.ok) text += `\n### job ${j.name}\n${await r.text()}`;
    }
  }
  writeFileSync(`${OUT}/ci-failure.log`, text || "(no log available)");
  const names = failed.map((x) => x.name + (x.required ? "" : " (optional)")).join(", ") || "a step";
  const rule = classify(text);
  const firstError = tail(text.split(/\n/).filter((l) => /error|fail|✗|×/i.test(l)).slice(0, 3).join("\n"), 3);
  f.evidence.push(`ci failed checks: ${names}`, firstError ? `first error lines:\n${firstError}` : "");

  if (optionalOnly) {
    add({ key: "ci", label: "ci checks", level: "warn", state: `optional check failed: ${names}`, link: ci.html_url,
      todo: [{ who: "you", text: "Optional checks do not block the verdict. Look at it if the pages misbehave on the preview." }] });
    return;
  }
  if (rule) {
    // Re-run once per commit. An attempt that GitHub only held for approval does not count.
    let ran = ci.run_attempt;
    if (ran === 2) {
      const first = await ghSafe(`repos/${REPO}/actions/runs/${ci.id}/attempts/1`);
      if (first.conclusion === "action_required") ran = 1;
    }
    const canRerun = ran === 1;
    if (canRerun) f.rerun = ci.id;
    const todo = [{ who: canRerun ? "auto" : "you", text: canRerun
      ? `This is the environment, not the task's code: ${rule.what}. The doctor re-runs ci once by itself; it reports again when that finishes.`
      : `It failed again after a re-run: ${rule.what}. The task's code is not the cause (the cycle's own checks passed). You can merge on the verdict, or press **Re-run failed jobs** on the [run](${ci.html_url}) later.` }];
    if (rule.id === "google-fonts") {
      const q = new URLSearchParams({ template: "devos-request.yml", title: "Request: self-host the fonts so builds never download them",
        what: "Serve Reem Kufi and Readex Pro from the repository with next/font/local (the woff2 files under src/fonts/, same weights, subsets and CSS variables as now) instead of next/font/google.",
        why: "Every build downloads the fonts from Google. When that download misbehaves the build fails (ci on PR with Google Fonts errors), although the code is fine." });
      todo.push({ who: "you", text: `To stop this for good, file this [prefilled change request](${SERVER}/${REPO}/issues/new?${q}) (the reviewer plans it as a task).` });
    }
    add({ key: "ci", label: "ci checks", level: canRerun ? "wait" : "warn", state: `${names} failed: environment (${rule.id})`, link: ci.html_url, todo });
    return;
  }
  // No rule matched: the task's code or something new. Ask Claude for a second opinion.
  f.ask_claude = true;
  const note = `Fix the failing ci check ${failed[0]?.name ?? ""}: ${firstError.split("\n")[0]?.slice(0, 160) ?? "see the ci log"}`;
  add({ key: "ci", label: "ci checks", level: "block", state: `${names} failed`, link: ci.html_url,
    todo: [{ who: "you", text: `If it is the task's code, comment:\n\n\`\`\`\n/devos revise ${note}\n\`\`\`\nThe reviewer reissues the fence and the builder fixes it. If it looks like a flake, press **Re-run failed jobs** on the [run](${ci.html_url}).` }] });
}

function deployBypass() {
  const file = existsSync(P("devos.config.json")) ? "devos.config.json" : "devos/engine.defaults.json";
  if (!existsSync(P(file))) return false;
  const value = JSON.parse(readFileSync(P(file), "utf8"));
  return value.deploy?.bypass === true;
}

async function diagnoseVercel(f, add) {
  const list = await vercel(`/v6/deployments?projectId=${process.env.VERCEL_PROJECT_ID}&limit=40`);
  if (!list || list.error) { f.evidence.push(`Vercel API: ${list?.error ?? "no token"}`); return; }
  const mine = (list.deployments ?? []).filter((d) => (d.meta?.devosBranch ?? d.meta?.githubCommitRef) === f.branch);
  const d = mine.sort((a, b) => b.created - a.created)[0];
  if (!d) { add({ key: "vercel", label: "Vercel preview", level: "info", state: "none for this branch", todo: [] }); return; }
  const url = `https://${d.url}`;
  const inspector = d.inspectorUrl;
  if (d.state === "BLOCKED") {
    add({ key: "vercel", label: "Vercel preview", level: "warn", state: "Blocked by Vercel", link: inspector,
      todo: [{ who: "auto", text: "Vercel blocked it because the commit author (`devos-runner`) is not the owner of your Hobby team. Since PR-15 the runner deploys previews without git metadata, so new attempts are not blocked. The preview is evidence only; it does not block the merge." }] });
    return;
  }
  if (d.state === "ERROR" || d.state === "CANCELED") {
    add({ key: "vercel", label: "Vercel preview", level: "warn", state: d.state.toLowerCase(), link: inspector,
      todo: [{ who: "you", text: `Open the [deployment](${inspector}) for the build log. It does not block the merge; the next attempt deploys again.` }] });
    return;
  }
  if (d.state !== "READY") { add({ key: "vercel", label: "Vercel preview", level: "info", state: d.state.toLowerCase(), link: url, todo: [] }); return; }
  // Ready: can the runner (and you, signed out) open it?
  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  let status = 0, loc = "";
  try { const r = await fetch(`${url}/`, { redirect: "manual", headers, signal: AbortSignal.timeout(20000) }); status = r.status; loc = r.headers.get("location") ?? ""; } catch (e) { loc = e.message; }
  const behindLogin = status === 401 || (status >= 300 && status < 400 && /vercel\.com\/(sso|login)/.test(loc));
  if (behindLogin) {
    const bypass = deployBypass();
    const item = previewBehindLogin(bypass);
    const text = bypass
      ? "The preview is behind the Vercel login. Set the secret VERCEL_AUTOMATION_BYPASS_SECRET."
      : "Open the preview yourself while signed in to Vercel. No bypass secret is added; screenshots come from the local build.";
    add({ key: "vercel", label: "Vercel preview", level: item.level, state: item.state, link: url, todo: [{ who: "you", text }] });
    return;
  }
  add({ key: "vercel", label: "Vercel preview", level: status === 200 ? "ok" : "warn", state: status === 200 ? "ready" : `answers ${status}`, link: url, todo: [] });
}

function save(f) {
  writeFileSync(`${OUT}/findings.json`, JSON.stringify(f, null, 2));
  emit({ ask_claude: f.ask_claude ? "true" : "false", sha: f.sha, task: f.task, branch: f.branch, open: f.state === "open" ? "true" : "false" });
  console.log(f.items.map((i) => `${i.level.padEnd(5)} ${i.label}: ${i.state}`).join("\n"));
}

// ---------- publish --------------------------------------------------------------------------

const ICON = { ok: "✅", info: "ℹ️", warn: "⚠️", wait: "⏳", block: "❌" };

async function publish() {
  const f = JSON.parse(readFileSync(`${OUT}/findings.json`, "utf8"));
  const dry = process.argv.includes("--dry-run");
  let claude = null;
  const cp = arg("claude");
  if (cp && existsSync(cp)) { try { claude = JSON.parse(readFileSync(cp, "utf8")).structured_output ?? null; } catch { /* no second opinion */ } }

  const blocks = f.items.filter((i) => i.level === "block");
  const waits = f.items.filter((i) => i.level === "wait");
  const gate = f.labels.includes("devos:human-gate");
  let state, headline, desc;
  if (f.state !== "open") { state = null; headline = "This PR is closed."; }
  else if (blocks.length) { state = "failure"; headline = `**Not ready: ${blocks.length} item(s) need you.**`; desc = `${blocks.length} item(s) need you: ${blocks.map((b) => b.label).join(", ")}`; }
  else if (waits.length) { state = "pending"; headline = "**Wait: the runner is handling it.** The doctor reports again when it finishes."; desc = `Waiting: ${waits.map((w) => w.label).join(", ")}`; }
  else { state = "success"; headline = gate ? "**Ready for your merge.** Merging signs the gate and starts the next task." : "**No blockers.**"; desc = gate ? "Ready for your merge" : "No blockers"; }

  const lines = [MARK, `### Dev OS gate doctor${f.task ? ` · ${f.task}` : ""} · \`${f.short}\``, "", headline, "",
    "| | Check | State |", "|---|---|---|",
    ...f.items.map((i) => `| ${ICON[i.level]} | ${i.label} | ${i.link ? `[${i.state}](${i.link})` : i.state} |`), ""];
  const todos = f.items.flatMap((i) => i.todo.map((t) => ({ ...t, label: i.label })));
  if (todos.length) {
    lines.push("#### What happens next", "");
    for (const t of todos) lines.push(`- **${t.who === "auto" ? "Automatic" : "You"}** (${t.label}): ${t.text.replace(/\n/g, "\n  ")}`);
    lines.push("");
  }
  if (claude) {
    lines.push("#### Second opinion (Claude, read-only)", "", `**${claude.category}**: ${claude.cause}`, "");
    if (claude.evidence) lines.push(`Evidence: ${claude.evidence}`, "");
    if (claude.revise_note && claude.category === "code") lines.push("Comment this to have it fixed:", "```", `/devos revise ${claude.revise_note}`, "```", "");
    if (claude.human_action) lines.push(`Otherwise: ${claude.human_action}`, "");
  } else if (f.ask_claude) lines.push("_No second opinion for this run: it runs only when the project's reviewer agent is Claude Code, with its key (PR-53)._", "");
  const ev = f.evidence.filter(Boolean);
  if (ev.length) lines.push("<details><summary>Evidence</summary>", "", "```", ...ev.map((e) => e.slice(0, 1500)), "```", "</details>", "");
  const run = process.env.GITHUB_RUN_ID ? ` · [doctor run](${SERVER}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID})` : "";
  lines.push(`<sub>Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC${run} · comment \`/devos doctor\` to check again · \`devos/gate\` is the merge signal (PR-15)</sub>`);
  const body = lines.join("\n");
  writeFileSync(`${OUT}/comment.md`, body);
  if (dry) { console.log(body); console.log(`\ndevos/gate → ${state}: ${desc}`); return; }

  // One sticky comment per PR.
  const comments = await gh(`repos/${REPO}/issues/${f.pr}/comments?per_page=100`);
  const mine = comments.filter((c) => c.body?.startsWith(MARK)).pop();
  if (mine) await gh(`repos/${REPO}/issues/comments/${mine.id}`, { method: "PATCH", body: { body } });
  else await gh(`repos/${REPO}/issues/${f.pr}/comments`, { method: "POST", body: { body } });

  if (state) {
    await ghSafe(`repos/${REPO}/statuses/${f.sha}`, { method: "POST", body: { state, context: "devos/gate", description: desc.slice(0, 139),
      target_url: process.env.GITHUB_RUN_ID ? `${SERVER}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined } });
    const needsYou = todos.some((t) => t.who === "you") && (blocks.length > 0 || f.items.some((i) => i.level === "warn"));
    await ghSafe(`repos/${REPO}/labels`, { method: "POST", body: { name: "devos:needs-you", color: "d93f0b", description: "The gate doctor found something only a human can do" } });
    if (needsYou) await ghSafe(`repos/${REPO}/issues/${f.pr}/labels`, { method: "POST", body: { labels: ["devos:needs-you"] } });
    else await ghSafe(`repos/${REPO}/issues/${f.pr}/labels/devos%3Aneeds-you`, { method: "DELETE" });
  }
  if (f.recheck) {
    const r = await ghSafe(`repos/${REPO}/actions/workflows/devos-cycle.yml/dispatches`, { method: "POST",
      body: { ref: "main", inputs: { task: f.recheck.task, attempt: String(f.recheck.attempt), review_only: "true", reuse_review: "true", go: "true" } } });
    console.log(r?.error ? `re-check dispatch refused: ${r.error}` : `dispatched a re-check of ${f.recheck.task} against the latest main`);
  }
  if (f.rerun) {
    const r = await ghSafe(`repos/${REPO}/actions/runs/${f.rerun}/rerun-failed-jobs`, { method: "POST" });
    if (r?.error) console.log(`re-run of ci ${f.rerun} refused: ${r.error}`);
    else { console.log(`re-ran the failed jobs of ci run ${f.rerun}`); emit({ reran: f.rerun }); }
  }
  console.log(`devos/gate → ${state}: ${desc}`);
}

if (direct) {
  if (mode === "collect") await collect();
  else if (mode === "publish") await publish();
  else fail("usage: doctor.mjs collect --pr <n> | publish [--claude file] [--dry-run]", 2);
}
