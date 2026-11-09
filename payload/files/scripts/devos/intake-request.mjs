#!/usr/bin/env node
// The request a planning run works from (PR-92), and where its plan goes. It runs twice, from main's code: in the
// planner's job, to write the request for the agent, and in the publish job, which decides from its own run of it.
//
//   node scripts/devos/intake-request.mjs --out .devos
//
// The request is the issue as it stood at the event: its title and body, and the comment that started the run, are
// taken from the event payload (EV_*), never fetched later, so an edit after your comment does not reach the planner.
// Earlier answers in the thread are the comments of the repository's owners, members and collaborators made before it.
// Only an issue opened by one of them is planned (M1). A workflow_dispatch resume reads the issue from GitHub and holds
// it to the same rule, and to its label; a pull request is never planned. Comments the runner posted ("Dev OS: …", or
// the <!-- devos-comment --> marker) are never read as your answers.
//
// Env: EVENT, REPO, ISSUE, GH_TOKEN (read); EV_TITLE, EV_BODY, EV_AUTHOR_ASSOC, EV_LABELS (JSON), EV_COMMENT,
// EV_COMMENT_AT, EV_COMMENT_ID.
// Writes <out>/request.md and <out>/request.json; prints mode, base, title and, for a refusal, refused=<why>.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emit, fail } from "./lib.mjs";

export const TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"];

/** A comment the runner posted (its comments start "Dev OS:" or carry the marker), never read as the human's answer. */
export const fromRunner = (body) => /^\s*Dev OS:/.test(String(body ?? "")) || String(body ?? "").includes("<!-- devos-comment -->");

/** The request's text: the issue, then the trusted answers in the thread up to the event, then the triggering comment. */
export function requestText({ title, body, comments = [], trigger = "", before = "" }) {
  const notes = comments
    .filter((c) => TRUSTED.includes(c.author_association) && !fromRunner(c.body))
    .filter((c) => !before || String(c.created_at ?? "") < before)
    .map((c) => String(c.body ?? "").replace(/^\/devos intake( resume)?\s*/, "").trim())
    .filter(Boolean);
  const said = String(trigger ?? "").replace(/^\/devos (intake( resume)?|revise)\s*/, "").trim();
  if (said) notes.push(said);
  const out = [`# ${String(title ?? "").trim()}`, "", String(body ?? "")];
  if (notes.length) out.push("", "## The human's answers and notes in the issue thread", "", ...notes.map((n) => `- ${n.replace(/\n/g, "\n  ")}`));
  return `${out.join("\n")}\n`;
}

/** Comments read with `gh api --paginate --jq '.[]'` (one per line), or one JSON array. */
export function parseComments(text) {
  const t = String(text ?? "").trim();
  if (!t) return [];
  if (t.startsWith("[")) { try { return JSON.parse(t); } catch { /* lines below */ } }
  return t.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) fail(`gh ${args.slice(0, 2).join(" ")}: ${(r.stderr || "").trim().slice(0, 300)}`);
  return r.stdout;
}

if (process.argv[1] && path.basename(process.argv[1]) === "intake-request.mjs") {
  const env = process.env;
  const out = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : ".devos"; })();
  const repo = String(env.REPO ?? "");
  const issue = String(env.ISSUE ?? "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[1-9]\d{0,6}$/.test(issue)) fail("REPO and ISSUE (a number, no leading zero) are required", 2);
  mkdirSync(out, { recursive: true });
  const refuse = (why) => { writeFileSync(path.join(out, "request.json"), `${JSON.stringify({ refused: why })}\n`); emit({ refused: why }); process.exit(1); };
  let { EV_TITLE: title, EV_BODY: body, EV_AUTHOR_ASSOC: assoc } = env;
  let labels = [];
  try { labels = JSON.parse(env.EV_LABELS || "[]"); } catch { labels = []; }
  if (env.EVENT === "workflow_dispatch") {
    const i = JSON.parse(gh(["api", `repos/${repo}/issues/${issue}`]) || "{}");
    ({ title, body } = i);
    assoc = i.author_association;
    labels = (i.labels ?? []).map((l) => l.name);
    if (i.pull_request) refuse("a pull request is not planned: `/devos revise <what to change>` on it asks for a revision");
    if (!labels.includes("devos:request") && !labels.includes("devos:method")) refuse("only an issue labelled devos:request or devos:method is planned");
  }
  if (!TRUSTED.includes(String(assoc ?? ""))) refuse("plans are made only for issues opened by the repository's owners, members or collaborators");
  const mode = labels.includes("devos:method") ? "method" : "intake";
  const base = "main";
  const comments = parseComments(gh(["api", "--paginate", `repos/${repo}/issues/${issue}/comments?per_page=100`, "--jq", ".[]"]))
    .filter((c) => String(c.id) !== String(env.EV_COMMENT_ID ?? ""));
  const text = requestText({ title, body, comments, trigger: env.EV_COMMENT ?? "", before: env.EV_COMMENT_AT ?? "" });
  writeFileSync(path.join(out, "request.md"), text);
  const clean = String(title ?? "").replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, 120) || "change request";
  writeFileSync(path.join(out, "request.json"), `${JSON.stringify({ mode, base, title: clean })}\n`);
  emit({ mode, base, title: clean, refused: "" });
}
