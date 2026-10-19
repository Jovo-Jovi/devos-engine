#!/usr/bin/env node
// The "Dev OS: setup needed" issue (PR-27): one issue, kept up to date by the runner, listing what only
// the human can add outside the repository, and the work waiting for it. Uses the gh CLI (GH_TOKEN).
//
//   node scripts/devos/setup-issue.mjs wait --task T07 --attempt 2 --review-only true --reason "…" [--manual]
//       A run stopped for lack of setup: record it on the issue (created if needed) so it resumes later.
//       --manual: the cause cannot be checked by name (a token's permission, a dashboard setting); the
//       issue then stays open until the human comments `/devos setup`.
//   node scripts/devos/setup-issue.mjs sync [--confirmed]
//       After setup-check.mjs: update or close the issue. When everything is in place (and any manual
//       item was confirmed with /devos setup), resume each waiting run and a production deploy that failed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { P } from "./lib.mjs";

const REPO = process.env.REPO || process.env.GITHUB_REPOSITORY;
const TITLE = "Dev OS: setup needed";
const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const gh = (args, input) => {
  const r = spawnSync("gh", [...args, "--repo", REPO], { encoding: "utf8", input });
  if (r.status !== 0) console.log(`gh ${args.slice(0, 3).join(" ")}: ${(r.stderr || "").trim().slice(0, 300)}`);
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
};
const labels = () => {
  gh(["label", "create", "devos:setup", "--color", "d93f0b", "--force", "--description", "Settings only the human can add"]);
  gh(["label", "create", "devos:setup-wait", "--color", "fbca04", "--force", "--description", "Waiting for a setting outside the repository"]);
};
const openIssue = () => gh(["issue", "list", "--label", "devos:setup", "--state", "open", "--json", "number", "--jq", ".[0].number // empty"]).out;
const comments = (n) => {
  const r = gh(["issue", "view", n, "--json", "comments", "--jq", "[.comments[].body]"]);
  try { return JSON.parse(r.out || "[]"); } catch { return []; }
};

/** Pending waits on the issue: every marker after the last "resumed" marker, one per task (latest wins). */
function pendingWaits(n) {
  const bodies = comments(n);
  const lastResumed = bodies.map((b) => b.includes("<!-- devos-setup-resumed -->")).lastIndexOf(true);
  const waits = new Map();
  for (const b of bodies.slice(lastResumed + 1)) {
    const m = /<!-- devos-setup-wait task=(T\d{2}) attempt=(\d+) review_only=(true|false) manual=(true|false) -->/.exec(b);
    if (m) waits.set(m[1], { task: m[1], attempt: m[2], review_only: m[3], manual: m[4] === "true", reason: b.split("\n")[0] });
  }
  return [...waits.values()];
}

const cmd = process.argv[2];
labels();

if (cmd === "wait") {
  const task = arg("task"), attempt = arg("attempt", "1"), ro = arg("review-only", "false"), manual = process.argv.includes("--manual");
  const reason = arg("reason", "a setting outside the repository is missing");
  let n = openIssue();
  if (!n) {
    const created = gh(["issue", "create", "--title", TITLE, "--label", "devos:setup", "--body", "The runner is checking what is missing; this description is replaced in a minute.\n\n<!-- devos-setup -->"]);
    n = /\/issues\/(\d+)/.exec(created.out)?.[1] ?? openIssue();
  }
  const pr = gh(["pr", "list", "--head", `task/${task}`, "--state", "open", "--json", "number", "--jq", ".[0].number // empty"]).out;
  if (pr) gh(["pr", "edit", pr, "--add-label", "devos:setup-wait"]);
  gh(["issue", "comment", n, "--body", `**${task} attempt ${attempt} is waiting:** ${reason}${pr ? ` (PR #${pr})` : ""}.${manual ? " The runner cannot check this by name: when it is done, comment `/devos setup` here." : " It resumes by itself once the setting is in place."}\n<!-- devos-setup-wait task=${task} attempt=${attempt} review_only=${ro} manual=${manual} -->`]);
  gh(["workflow", "run", "devos-setup.yml", "--ref", "main"]);
  console.log(`setup: ${task} a${attempt} recorded as waiting on issue #${n}`);
  process.exit(0);
}

if (cmd === "sync") {
  const confirmed = process.argv.includes("--confirmed");
  const result = JSON.parse(readFileSync(P(".devos/setup-result.json"), "utf8"));
  let body = existsSync(P(".devos/setup.md")) ? readFileSync(P(".devos/setup.md"), "utf8") : "";
  const n = openIssue();
  const waits = n ? pendingWaits(n) : [];
  const manualPending = waits.some((w) => w.manual) && !confirmed;
  if (!result.complete || manualPending) {
    if (waits.length) body = body.replace("## How it continues", `## Waiting on this\n\n${waits.map((w) => `- ${w.task} attempt ${w.attempt}${w.manual ? " (needs your \`/devos setup\` when done)" : ""}`).join("\n")}\n\n## How it continues`);
    const marker = `<!-- devos-setup-missing ${result.missing_required.join(",")} -->`;
    if (!n) {
      gh(["issue", "create", "--title", TITLE, "--label", "devos:setup", "--body-file", "-"], `${body}\n${marker}\n`);
      console.log("setup: issue opened");
    } else {
      const old = gh(["issue", "view", n, "--json", "body", "--jq", ".body"]).out;
      const before = (/devos-setup-missing ([^ ]*) -->/.exec(old)?.[1] ?? "").split(",").filter(Boolean);
      gh(["issue", "edit", n, "--body-file", "-"], `${body}\n${marker}\n`);
      const added = result.missing_required.filter((id) => !before.includes(id));
      // Editing a description sends no notification; a comment does, so new needs are announced.
      if (added.length) gh(["issue", "comment", n, "--body", `Dev OS: new setting${added.length > 1 ? "s" : ""} needed: ${added.map((a) => `\`${a}\``).join(", ")}. Details in the description.`]);
      console.log(`setup: issue #${n} updated (${result.missing_required.length} missing${manualPending ? ", manual confirmation pending" : ""})`);
    }
    process.exit(0);
  }
  // Complete. Resume only on a change (the issue was open) or the human's confirmation, never in a loop.
  if (!n && !confirmed) { console.log("setup: complete; nothing waiting"); process.exit(0); }
  const done = [];
  for (const w of waits) {
    const pr = gh(["pr", "list", "--head", `task/${w.task}`, "--state", "open", "--json", "number", "--jq", ".[0].number // empty"]).out;
    if (pr) gh(["pr", "edit", pr, "--remove-label", "devos:setup-wait"]);
    gh(["workflow", "run", "devos-cycle.yml", "--ref", "main", "-f", `task=${w.task}`, "-f", `attempt=${w.attempt}`, "-f", `review_only=${w.review_only}`, "-f", "revision=true"]);
    done.push(`${w.task} attempt ${w.attempt}${w.review_only === "true" ? " (review)" : ""}`);
  }
  const last = gh(["run", "list", "--workflow", "devos-deploy.yml", "--branch", "main", "--limit", "1", "--json", "conclusion", "--jq", ".[0].conclusion // empty"]).out;
  if (last === "failure") { gh(["workflow", "run", "devos-deploy.yml", "--ref", "main"]); done.push("the production deploy that failed"); }
  if (n) {
    gh(["issue", "comment", n, "--body", `Dev OS: everything is in place.${done.length ? ` Resumed: ${done.join(", ")}.` : ""} Closing.\n<!-- devos-setup-resumed -->`]);
    gh(["issue", "close", n]);
  }
  console.log(`setup: complete; resumed ${done.length ? done.join(", ") : "nothing"}`);
  process.exit(0);
}

console.error("usage: setup-issue.mjs wait --task Tnn --attempt N --review-only true|false --reason … [--manual] | sync [--confirmed]");
process.exit(2);
