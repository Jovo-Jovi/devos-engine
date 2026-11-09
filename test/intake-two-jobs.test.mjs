// E64 (PR-92): planning, revising and accepting in two halves. S = a static check of devos-intake.yml; U = the scripts on
// crafted inputs. The live canary (L, T93 on devos-pilot) is the owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(root, "payload", "files");
const SCRIPTS = path.join(PAYLOAD, "scripts", "devos");
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const code = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const intake = code(read(path.join(PAYLOAD, "dot-github", "workflows", "devos-intake.yml")));
const windows = process.platform === "win32";
const load = (name) => import(pathToFileURL(path.join(SCRIPTS, name)).href);
const { parsePhases } = await load("lib.mjs");
const { requestText, fromRunner, parseComments } = await load("intake-request.mjs");
const { decide, staleTasks } = await load("unit.mjs");

function job(text, name) {
  const at = text.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  assert.notEqual(at, -1, `job ${name}`);
  const rest = text.slice(at + 1);
  const end = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  return end === -1 ? text.slice(at) : text.slice(at, at + 1 + end);
}
const steps = (jobText) => jobText.split(/^ {6}- /m).slice(1);
const READ_ONLY = /^ {4}permissions:\n((?: {6}[a-z-]+: read\n)+) {4}[a-z]/m;
const CLAUDE = ["secrets.ANTHROPIC_API_KEY", "secrets.ANTHROPIC_API_KEY_2", "secrets.CLAUDE_CODE_OAUTH_TOKEN", "secrets.CLAUDE_CODE_OAUTH_TOKEN_2"];

// ---------- S: devos-intake.yml --------------------------------------------------------------------------------------

test("intake-two-jobs.test.mjs S1 the planners read only, hold only Claude's keys, and write nothing to GitHub", () => {
  for (const name of ["intake", "revise"]) {
    const j = job(intake, name);
    assert.match(j, READ_ONLY, `${name}: its token only reads`);
    assert.deepEqual([...new Set(j.match(/secrets\.[A-Z0-9_]+/g))].sort(), CLAUDE, name);
    assert.equal(/DEVOS_PAT|toJSON\(secrets\)|secrets\[/.test(j), false, name);
    assert.match(j, /tool=\$\(node scripts\/devos\/agents\.mjs reviewer --mode deep[^\n]*\n {10}if \[ "\$tool" != "claude" \]; then/);
    for (const line of j.split("\n")) {
      assert.equal(/\bgh (pr|issue) (comment|create|edit|merge)|gh api -X|gh workflow run|git push|statuses\//.test(line), false, `${name}: ${line.trim()}`);
    }
  }
});

test("intake-two-jobs.test.mjs S2 the publish jobs check out only main, run only main's scripts and GitHub's actions pinned by commit", () => {
  for (const name of ["intake-publish", "revise-publish", "accept"]) {
    const j = job(intake, name);
    for (const m of j.matchAll(/^\s+(?:- )?uses: (\S+)/gm)) assert.match(m[1], /^actions\/(checkout|setup-node|download-artifact)@[0-9a-f]{40}$/, `${name}: ${m[1]}`);
    const checkouts = steps(j).filter((s) => /uses: actions\/checkout@/.test(s));
    assert.match(checkouts[0], /ref: \$\{\{ github\.sha \}\}\n\s+path: trusted\n\s+persist-credentials: false/, name);
    for (const line of j.split("\n")) {
      for (const m of line.matchAll(/(?:^|[\s;(|&$])node\s+(\S+)/g)) assert.match(m[1], /^("\$T\/|"\$D\/scripts\/guards\/run-all\.mjs"|-e$)/, `${name}: ${line.trim()}`);
      assert.equal(/\bnpm\b|\bnpx\b|\bpnpm\b|bash scripts\/|plan-agent/.test(line), false, `${name}: ${line.trim()}`);
    }
  }
  // accept's second checkout is the branch it writes on, as data; nothing of it runs.
  const accept = job(intake, "accept");
  assert.match(accept, /path: data\n\s+fetch-depth: 0\n\s+persist-credentials: false/);
  assert.match(accept, /node "\$T\/accept\.mjs" --task "\$TASK"/);
  assert.match(accept, /DEVOS_ROOT: \$\{\{ github\.workspace \}\}\/data/);
  assert.match(accept, /hg\(\) \{ git -c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false /);
  assert.equal(/sync-main\.sh|x-access-token:\$\{GH_TOKEN\}@/.test(accept), false);
});

test("intake-two-jobs.test.mjs S3 only the publish jobs post devos/verdict; nothing merges or deploys; every PR waits for you", () => {
  for (const name of ["intake-ack", "intake-refuse", "intake", "intake-publish", "intake-wait", "go", "revise-prep", "revise", "revise-publish", "accept"]) {
    assert.equal(/statuses: write/.test(job(intake, name)), ["intake-publish", "revise-publish"].includes(name), name);
  }
  assert.equal((intake.match(/context=devos\/verdict/g) ?? []).length, 2);
  // revise-publish only marks a revised unit's new head pending; success comes from the cycle when the task passes.
  assert.match(job(intake, "revise-publish"), /gh api "repos\/\$REPO\/statuses\/\$head" -f state=pending -f context=devos\/verdict/);
  assert.equal(/gh pr merge|pulls\/[^ ]*\/merge|devos-deploy/.test(intake), false);
  const act = steps(job(intake, "intake-publish")).find((s) => s.startsWith("name: Act on the decision"));
  assert.match(act, /gh pr create --repo "\$REPO" --base main --head "\$BR" --title "Method fix #\$ISSUE/);
  assert.match(act, /gh pr create --repo "\$REPO" --base main --head "\$BR" --title "Intake #\$ISSUE/);
  // The planner's decision is its claim: a plan that publish did not verify is never pushed.
  assert.match(act, /if \(d === "accept" && !verified\) d = process\.env\.HAS_PLAN === "true" \? "rejected" : "error";/);
  assert.match(act, /if \[ "\$verified" = "true" \] && \{ \[ "\$DEC" = "accept" \]/);
});

test("intake-two-jobs.test.mjs S4 M1: who can start a plan, and the comment reaches a shell only through the environment", () => {
  const plan = job(intake, "intake");
  assert.match(plan, /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.issue\.author_association\) &&/);
  assert.equal(/devos:acceptance|\/devos revise/.test(plan + job(intake, "intake-ack")), false);
  assert.match(job(intake, "intake-refuse"), /!contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.issue\.author_association\)/);
  // /devos revise on a unit's acceptance PR (this repository's, into main) revises the unit's last task on its branch.
  const prep = job(intake, "revise-prep");
  assert.match(prep, /ACCEPTANCE: \$\{\{ contains\(github\.event\.issue\.labels\.\*\.name, 'devos:acceptance'\) \}\}/);
  assert.match(prep, /devos\/unit-T\[0-9\]\[0-9\]\)\n\s+if \[ "\$ACCEPTANCE" != "true" \] \|\| \[ "\$into" != "main" \]; then/);
  assert.match(prep, /task="\$\{ref#devos\/unit-\}"; unit="\$ref"\n/);
  assert.match(prep, /\[ "\$same" = "true" \] \|\|/);
  // One revision of a unit at a time: its last task's row must be ticked on the unit.
  assert.ok(prep.includes('grep -qE "^\\| $task \\|.*\\| \\[x\\] \\|"'));
  for (const line of intake.split("\n").filter((l) => l.includes("github.event.comment.body") || l.includes("github.event.issue.body"))) {
    assert.match(line.trim(), /^(startsWith\(github\.event\.comment\.body|\(github\.event_name == 'issue_comment' && startsWith\(github\.event\.comment\.body|github\.event_name == 'issue_comment' && github\.event\.issue\.pull_request|RESUME: |EV_COMMENT: \$\{\{ github\.event\.comment\.body \}\}$|EV_BODY: \$\{\{ github\.event\.issue\.body \}\}$|NOTE: \$\{\{ github\.event\.comment\.body \}\}$)/, line.trim());
  }
});

test("intake-two-jobs.test.mjs S5 what a planner runs is main's; a revision commits only its fence; publish scrubs and explains", () => {
  const overlay = 'for p in .github scripts/devos scripts/guards devos devos.config.json CLAUDE.md CLAUDE.local.md .claude .cursor .mcp.json; do\n            rm -rf -- "$p"\n            if git cat-file -e "origin/main:$p" 2>/dev/null; then git archive origin/main -- "$p" | tar -x; fi\n          done';
  // intake checks out main itself; before it switches to a plan branch, nothing of a branch runs.
  const planner = job(intake, "intake");
  assert.match(planner, /uses: actions\/checkout@[0-9a-f]{40} # v6\.0\.2\n\s+with:\n\s+ref: main\n/);
  assert.ok(planner.indexOf(overlay) > planner.indexOf('git checkout -B "$BR" "$base_sha"') && planner.indexOf(overlay) < planner.indexOf("render-prompt.mjs"));
  // revise checks out the task's or the unit's branch: main's files are laid over it before any script runs.
  const revise = job(intake, "revise");
  const first = Math.min(...["agents.mjs", "render-prompt.mjs", "plan-agent.sh", "guard-surfaces.mjs", "lib.mjs"].map((x) => revise.indexOf(x)).filter((i) => i >= 0));
  assert.ok(revise.includes(overlay) && revise.indexOf(overlay) < first);
  assert.match(revise, /git add -A -- "docs\/fences\/\$TASK\.md"/);
  assert.match(revise, /DEVOS_REVISE_UNIT: \$\{\{ needs\.revise-prep\.outputs\.unit \}\}/);
  assert.equal(/concurrency:/.test(revise) || /concurrency:/.test(job(intake, "revise-publish")), false);
  const rp = job(intake, "revise-publish");
  assert.ok(rp.indexOf('[ "$(gh pr view "$PR" --repo "$REPO" --json state --jq .state)" != "OPEN" ]') < rp.indexOf('node "$T/publish-verify.mjs" push --out "$OUT"'));
  assert.match(rp, /--head "task\/\$TASK" --base "\$UNIT" --state merged[^\n]*\n\s+gh api -X DELETE "repos\/\$REPO\/git\/refs\/heads\/task\/\$TASK"/);
  const act = steps(job(intake, "intake-publish")).find((x) => x.startsWith("name: Act on the decision"));
  // Every comment publish posts is scrubbed of the keys it holds first, and carries the runner's marker.
  assert.ok(act.lastIndexOf("\n          say\n") < act.lastIndexOf('gh api "repos/$REPO/issues/$ISSUE/comments" -F body=@"$RUNNER_TEMP/comment.md"'));
  assert.match(act, /"<!-- devos-comment -->\\n"/);
  assert.match(job(intake, "revise-publish"), /say\(\) \{ printf '%s\\n' "\$1" > "\$RUNNER_TEMP\/comment\.md"; node "\$T\/scrub\.mjs" --names SCRUB_PAT,SCRUB_TOKEN,SCRUB_C1,SCRUB_C2,SCRUB_A1,SCRUB_A2 "\$RUNNER_TEMP\/comment\.md"; gh pr comment/);
  // PR-31: a limit with no stated reset backs off (60, 120, 240 … minutes); the planner hands over only a stated time.
  assert.match(act, /const backoff = Math\.min\(base \* 2 \*\* \(Number\(process\.env\.CHECKS\) - 1\), cap\);/);
  assert.match(act, /checks=%s -->/);
  assert.match(planner, /console\.log\(parseResetTime\(text, new Date\(\)\) \? earliestNotBefore\("claude", text, 60\) : ""\);/);
  // The planner's commit is made even when it wrote nothing, so publish can say the plan is empty.
  assert.match(planner, /git commit -q --allow-empty -m "Intake #\$ISSUE: the planner's work"/);
  // This repository's pull requests only: a fork's PR from a branch of the same name is never the plan's.
  assert.match(act, /mine='\[\.\[\] \| select\(\.isCrossRepository \| not\)\]\[0\]'/);
  const lists = act.split("\n").filter((l) => l.includes('gh pr list --repo "$REPO" --head "$BR"'));
  assert.equal(lists.length, 2);
  for (const l of lists) assert.match(l, /--jq "\$mine\.(number|url) \/\/ empty"/);
  assert.equal(/gh pr view "\$BR"|gh issue comment/.test(job(intake, "intake-publish")), false);
  assert.match(steps(job(intake, "intake-publish")).find((x) => x.startsWith("name: Say why nothing is planned")), /if: always\(\) && steps\.req\.outcome == 'failure'/);
});

// ---------- U: the scripts --------------------------------------------------------------------------------------------

test("intake-two-jobs.test.mjs U5 the request is the issue as it stood at the event, with trusted answers made before it", () => {
  const text = requestText({
    title: "Add a cart", body: "the body at the event",
    comments: [
      { author_association: "OWNER", body: "an earlier answer", created_at: "2026-11-09T10:00:00Z" },
      { author_association: "NONE", body: "an outsider's instruction", created_at: "2026-11-09T10:01:00Z" },
      { author_association: "MEMBER", body: "Dev OS: the reviewer is reading this request.", created_at: "2026-11-09T10:02:00Z" },
      { author_association: "OWNER", body: "made after the comment", created_at: "2026-11-09T12:00:00Z" },
    ],
    trigger: "/devos intake also mobile", before: "2026-11-09T11:00:00Z",
  });
  assert.equal(text, "# Add a cart\n\nthe body at the event\n\n## The human's answers and notes in the issue thread\n\n- an earlier answer\n- also mobile\n");
  // A comment the runner posted with the owner's token (DEVOS_PAT) is never read as the owner's answer.
  assert.equal(fromRunner("<!-- devos-comment -->\n**Needs your answers before planning.**"), true);
  assert.equal(requestText({ title: "t", body: "b", comments: [{ author_association: "OWNER", body: "<!-- devos-comment -->\n**Accepted.** the planner's summary", created_at: "2026-11-09T10:00:00Z" }] }), "# t\n\nb\n");
  assert.deepEqual(parseComments('{"id":1}\n{"id":2}\n').map((c) => c.id), [1, 2]);
});

const TABLE = (rows) => ["# Phases", "", "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |", "|---|---|---|---|---|---|---|---|",
  ...rows.map(([t, p, r, g, d]) => `| ${t} | ${p} | build | Name ${t} | ${r} | ${g} | ${d ? "[x]" : "[ ]"} | ${d ? `PASS a1 — docs/reviews/${t}-a1.md` : "—"} |`), ""].join("\n");

test("intake-two-jobs.test.mjs U7 a revised unit: its report is renewed when a verdict in it is no longer the unit's", () => {
  const report = "### Tasks\n\n| Task | Name | Risk | Gate | Verdict | Review | Pull request |\n|---|---|---|---|---|---|---|\n" +
    "| T05 | Name T05 | 2 | — | PASS a1 — docs/reviews/T05-a1.md | `docs/reviews/T05-a1.md` | #3 |\n| T06 | Name T06 | 2 | G-Feature | PASS a1 — docs/reviews/T06-a1.md | `docs/reviews/T06-a1.md` | #4 |\n";
  const asReported = parsePhases(TABLE([["T05", "P2", 2, "—", true], ["T06", "P2", 2, "G-Feature", true]])).rows;
  assert.deepEqual(staleTasks(["T05", "T06"], asReported, report), []);
  // /devos revise on the acceptance PR: T06 built again, PASS a2.
  const revised = asReported.map((r) => (r.task === "T06" ? { ...r, verdict: "PASS a2 — docs/reviews/T06-a2.md" } : r));
  assert.deepEqual(staleTasks(["T05", "T06"], revised, report), ["T06"]);
  assert.deepEqual(staleTasks(["T05", "T06"], asReported, report.replace(/\| T05 .*\n/, "")), ["T05"]);
  // decide: complete with its PR open and a stale report, publish renews it; with the report current, it waits.
  const main = parsePhases(TABLE([["T05", "P2", 2, "—", false], ["T06", "P2", 2, "G-Feature", false], ["T07", "P2", 1, "—", false]])).rows;
  const open = { tasks: ["T05", "T06"], first: "T05", last: "T06", branch: "devos/unit-T06", sha: "b".repeat(40), waiting_pr: 41, closed_pr: "", refresh: false };
  const at = (refresh) => decide({ mainRows: main, unitRows: revised, open: { ...open, refresh }, task: "T07", mode: "gate", mainSha: "a".repeat(40) });
  assert.deepEqual([at(true).accept, at(true).waiting, at(true).acceptance_pr], ["true", "false", "41"]);
  assert.deepEqual([at(false).accept, at(false).waiting], ["false", "true"]);
  // While T06 is built again (its row open on the unit), the cycle builds it on the unit, from its head.
  const reopened = revised.map((r) => (r.task === "T06" ? { ...r, done: false, doneRaw: "[ ]", verdict: "—" } : r));
  const build = decide({ mainRows: main, unitRows: reopened, open, task: "T06", mode: "gate", mainSha: "a".repeat(40) });
  assert.deepEqual([build.build, build.base, build.base_sha], ["true", "devos/unit-T06", "b".repeat(40)]);
});

// ---------- publish-verify plan and the request on a fixture "GitHub" ------------------------------------------------

const quiet = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, env: quiet, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}
const write = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-intake-"));
  const seed = path.join(dir, "seed");
  cpSync(SCRIPTS, path.join(seed, "scripts", "devos"), { recursive: true });
  cpSync(path.join(PAYLOAD, "scripts", "guards"), path.join(seed, "scripts", "guards"), { recursive: true });
  cpSync(path.join(PAYLOAD, "devos"), path.join(seed, "devos"), { recursive: true });
  write(seed, "devos.config.json", read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
  write(seed, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", false]]));
  write(seed, "docs/fences/T02.md", "## T02\n\n- Paths: `src/**`\n\n### Prompt\n\nBuild.\n");
  write(seed, "src/a.ts", "export const a = 1;\n");
  git(["init", "-q", "-b", "main"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-qm", "init"], seed);
  const remote = path.join(dir, "remote.git");
  git(["init", "-q", "--bare", "-b", "main", remote], dir);
  git(["push", "-q", remote, "main"], seed);
  git(["clone", "-q", remote, path.join(dir, "trusted")], dir);
  return { dir, seed, remote, mainSha: git(["rev-parse", "HEAD"], seed), T: path.join(dir, "trusted", "scripts", "devos") };
}
/** The planner's job: a clone at `from` on `branch`, `change` applied, committed, bundled against `exclude`. */
function planBundle(fx, branch, change, { from = fx.mainSha, exclude = [fx.mainSha] } = {}) {
  const id = Math.random().toString(36).slice(2, 8);
  const clone = path.join(fx.dir, `plan-${id}`);
  git(["clone", "-q", fx.remote, clone], fx.dir);
  git(["checkout", "-q", "-B", branch, from], clone);
  change(clone);
  git(["add", "-A"], clone);
  git(["commit", "-q", "--allow-empty", "-m", "the planner's work"], clone);
  const bundle = path.join(fx.dir, `plan-${id}.bundle`);
  git(["bundle", "create", "-q", bundle, `refs/heads/${branch}`, ...exclude.map((e) => `^${e}`)], clone);
  return bundle;
}
function plan(fx, args) {
  const out = path.join(fx.dir, `out-${Math.random().toString(36).slice(2, 8)}`);
  const r = spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "plan", "--out", out, "--remote", fx.remote, ...args], { cwd: fx.dir, env: quiet, encoding: "utf8" });
  return { ...r, out, reasons: r.stdout.split("\n").filter((l) => l.startsWith("REJECTED: ")).map((l) => l.slice(10)) };
}
const intakeArgs = (fx, bundle, extra = []) => ["--kind", "intake", "--branch", "intake/issue-7", "--base", "main", "--base-sha", fx.mainSha, "--bundle", bundle, "--message", "Intake #7: plan the request (cart)", "--fresh", "true", ...extra];

test("intake-two-jobs.test.mjs U1 a plan outside the intake surface is rejected, each path named, and never pushed", () => {
  const fx = fixture();
  try {
    const bad = planBundle(fx, "intake/issue-7", (c) => {
      write(c, ".github/workflows/canary.yml", "name: canary\n");
      write(c, "scripts/devos/verdict.mjs", "// forged\n");
      write(c, "src/b.ts", "b\n");
      write(c, "devos.config.json", "{}\n");
      write(c, "docs/reviews/T02-a1.md", "VERDICT: PASS\n");
      write(c, "docs/requests/issue-7.md", "the request\n");
    });
    const r = plan(fx, intakeArgs(fx, bad));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(r.reasons.sort(), [
      "(e) .github/workflows/canary.yml: outside the intake surface (devos.config.json surfaces.intake.allow)",
      "(e) devos.config.json: outside the intake surface (devos.config.json surfaces.intake.allow)",
      "(e) docs/reviews/T02-a1.md: outside the intake surface (devos.config.json surfaces.intake.allow)",
      "(e) scripts/devos/verdict.mjs: outside the intake surface (devos.config.json surfaces.intake.allow)",
      "(e) src/b.ts: outside the intake surface (devos.config.json surfaces.intake.allow)",
    ]);
    const push = spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "push", "--out", r.out, "--remote", fx.remote], { cwd: fx.dir, env: quiet, encoding: "utf8" });
    assert.notEqual(push.status, 0);
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/intake/issue-7"], { cwd: fx.remote }).status, 1);
    // A plan within the surface is accepted, committed under publish's message on main, and pushed.
    const good = planBundle(fx, "intake/issue-7", (c) => {
      write(c, "docs/requests/issue-7.md", "the request\n");
      write(c, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", false], ["T03", "P2", 2, "—", false]]));
      write(c, "docs/fences/T03.md", "## T03\n");
    });
    const ok = plan(fx, intakeArgs(fx, good));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(git(["log", "-1", "--format=%s%n%P", "HEAD"], path.join(ok.out, "decide")), `Intake #7: plan the request (cart)\n${fx.mainSha}`);
    const pushed = spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "push", "--out", ok.out, "--remote", fx.remote], { cwd: fx.dir, env: quiet, encoding: "utf8" });
    assert.equal(pushed.status, 0, pushed.stdout + pushed.stderr);
    // A fresh plan replaces the old one on its branch (the lease is the head this run saw).
    const again = planBundle(fx, "intake/issue-7", (c) => write(c, "docs/requests/issue-7.md", "planned afresh\n"));
    const second = plan(fx, intakeArgs(fx, again));
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "push", "--out", second.out, "--remote", fx.remote], { cwd: fx.dir, env: quiet, encoding: "utf8" }).status, 0);
    assert.equal(git(["show", "refs/heads/intake/issue-7:docs/requests/issue-7.md"], fx.remote), "planned afresh");
    // A base commit that is not main's is refused.
    const notMain = plan(fx, ["--kind", "intake", "--branch", "intake/issue-7", "--base", "main", "--base-sha", "c".repeat(40), "--bundle", good, "--message", "m", "--fresh", "true"]);
    assert.equal(notMain.status, 1);
    assert.match(notMain.stderr, /is not a commit of main/);
  } finally {
    cleanup(fx.dir);
  }
});

test("intake-two-jobs.test.mjs U3 a plan adds rows and changes none, never a number twice; a method fix adds Phase PM only", () => {
  const fx = fixture();
  try {
    const changedRow = planBundle(fx, "intake/issue-7", (c) => write(c, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 1, "—", true]])));
    assert.deepEqual(plan(fx, intakeArgs(fx, changedRow)).reasons, ["(d) docs/PHASES.md: T02's row is changed (a plan only adds rows)"]);
    const product = planBundle(fx, "intake/issue-7", (c) => write(c, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", false], ["T03", "P2", 1, "—", false]])));
    assert.deepEqual(plan(fx, intakeArgs(fx, product, ["--method", "true"])).reasons, ["(d) docs/PHASES.md: a method fix adds Phase PM rows only, not T03 (Phase P2)"]);
    const twice = planBundle(fx, "intake/issue-7", (c) => write(c, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", false], ["T03", "P2", 1, "—", false], ["T03", "P2", 1, "—", false]])));
    assert.deepEqual(plan(fx, intakeArgs(fx, twice)).reasons, ["(d) docs/PHASES.md: T03 has more than one row"]);
    const ticked = planBundle(fx, "intake/issue-7", (c) => write(c, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", false], ["T03", "P2", 1, "—", true]])));
    assert.deepEqual(plan(fx, intakeArgs(fx, ticked)).reasons, ["(d) docs/PHASES.md: the new row T03 is ticked or has a verdict"]);
    // A plan only made on main.
    const notMain = plan(fx, ["--kind", "intake", "--branch", "intake/issue-7", "--base", "devos/unit-T02", "--base-sha", fx.mainSha, "--bundle", product, "--message", "m", "--fresh", "true"]);
    assert.equal(notMain.status, 2);
    // A planner that wrote nothing: accepted as a commit with no change, and publish learns the plan holds nothing.
    const nothing = planBundle(fx, "intake/issue-7", () => {});
    const empty = plan(fx, intakeArgs(fx, nothing));
    assert.equal(empty.status, 0, empty.stdout + empty.stderr);
    assert.match(empty.stdout, /^planned=0$/m);
  } finally {
    cleanup(fx.dir);
  }
});

test("intake-two-jobs.test.mjs U2 a revision changes only its task's fence, under publish's message with the next attempt", () => {
  const fx = fixture();
  try {
    git(["checkout", "-q", "-b", "task/T02"], fx.seed);
    write(fx.seed, "docs/reviews/T02-a1.md", "VERDICT: FAIL\n");
    git(["add", "-A"], fx.seed);
    git(["commit", "-qm", "T02 a2: builder (m)"], fx.seed);
    git(["push", "-q", fx.remote, "task/T02"], fx.seed);
    const head = git(["rev-parse", "HEAD"], fx.seed);
    const rev = (b) => ["--kind", "revise", "--branch", "task/T02", "--task", "T02", "--bundle", b];
    const wide = planBundle(fx, "task/T02", (c) => { write(c, "docs/fences/T02.md", "## T02 v2\n"); write(c, "docs/requests/x.md", "x\n"); write(c, "src/a.ts", "changed\n"); }, { from: head, exclude: [head] });
    assert.deepEqual(plan(fx, rev(wide)).reasons.sort(), ["(e) docs/requests/x.md: a revision changes only docs/fences/T02.md", "(e) src/a.ts: a revision changes only docs/fences/T02.md"]);
    const fence = planBundle(fx, "task/T02", (c) => write(c, "docs/fences/T02.md", "## T02 v2\n"), { from: head, exclude: [head] });
    const ok = plan(fx, rev(fence));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^attempt=3$/m);
    assert.equal(git(["log", "-1", "--format=%s", "HEAD"], path.join(ok.out, "decide")), "T02: fence reissued for human revision (attempt 3)");
    // /devos revise on a unit's acceptance PR: the unit's last task, on the unit's branch, its row opened again.
    git(["checkout", "-q", "-b", "devos/unit-T02", "main"], fx.seed);
    write(fx.seed, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "G-Foundation", true]]));
    write(fx.seed, "docs/reviews/T02-a1.md", "VERDICT: PASS\n");
    git(["add", "-A"], fx.seed);
    git(["commit", "-qm", "T02 a1: review — PASS"], fx.seed);
    git(["push", "-q", fx.remote, "devos/unit-T02"], fx.seed);
    const unitHead = git(["rev-parse", "HEAD"], fx.seed);
    const unitFence = planBundle(fx, "devos/unit-T02", (c) => write(c, "docs/fences/T02.md", "## T02 v2\n\n### Attempt 2 focus (human revision)\n"), { from: unitHead, exclude: [unitHead] });
    const onUnit = plan(fx, ["--kind", "revise", "--branch", "devos/unit-T02", "--task", "T02", "--bundle", unitFence]);
    assert.equal(onUnit.status, 0, onUnit.stdout + onUnit.stderr);
    assert.match(onUnit.stdout, /^attempt=2$/m);
    const amend = spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "commit", "--out", onUnit.out, "--amend"], { cwd: fx.dir, env: quiet, encoding: "utf8" });
    assert.equal(amend.status, 0, amend.stdout + amend.stderr);
    const decided = path.join(onUnit.out, "decide");
    assert.equal(git(["log", "-1", "--format=%s", "HEAD"], decided), "T02: fence reissued for human revision (attempt 2)");
    assert.deepEqual(git(["diff", "--name-only", unitHead, "HEAD"], decided).split("\n").sort(), ["docs/PHASES.md", "docs/fences/T02.md"]);
    assert.match(git(["show", "HEAD:docs/PHASES.md"], decided), /^\| T02 \| P1 \| build \| Name T02 \| 2 \| G-Foundation \| \[ \] \| REVISE a2 — your revision on the acceptance PR \(PR-92\) \|$/m);
    assert.equal(spawnSync(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "push", "--out", onUnit.out, "--remote", fx.remote], { cwd: fx.dir, env: quiet, encoding: "utf8" }).status, 0);
    // One revision at a time: with the row open on the unit, a second one is refused.
    const pushed = git(["rev-parse", "refs/heads/devos/unit-T02"], fx.remote);
    const second = plan(fx, ["--kind", "revise", "--branch", "devos/unit-T02", "--task", "T02", "--bundle", planBundle(fx, "devos/unit-T02", (c) => write(c, "docs/fences/T02.md", "## T02 v3\n"), { from: pushed, exclude: [pushed] })]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /T02 is already being revised on devos\/unit-T02: comment \/devos revise on its task PR instead/);
    // Only the unit of that task: a unit branch for another task is refused before anything is read.
    assert.equal(plan(fx, ["--kind", "revise", "--branch", "devos/unit-T03", "--task", "T02", "--bundle", unitFence]).status, 2);
  } finally {
    cleanup(fx.dir);
  }
});

test("intake-two-jobs.test.mjs U6 intake-request: an outsider's issue is refused in one sentence; the event's text is the request", { skip: windows && "a stand-in gh" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-request-"));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "comments.json"), JSON.stringify([{ id: 1, author_association: "OWNER", body: "my earlier answer", created_at: "2026-11-09T10:00:00Z" }, { id: 2, author_association: "OWNER", body: "/devos intake now", created_at: "2026-11-09T11:00:00Z" }]));
    writeFileSync(path.join(bin, "issue.json"), JSON.stringify({ title: "Edited later", body: "a body edited after your comment", author_association: "NONE", labels: [{ name: "devos:request" }] }));
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh
case "$*" in
  *"issues/7/comments"*) cat "${bin}/comments.json" ;;
  *"issues/7"*) cat "${bin}/issue.json" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const run = (env) => spawnSync(process.execPath, [path.join(SCRIPTS, "intake-request.mjs"), "--out", path.join(dir, "out")], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: "", REPO: "o/r", ISSUE: "7", EV_LABELS: '["devos:request"]', ...env } });
    // Your comment on an issue someone else opened.
    const outsider = run({ EVENT: "issue_comment", EV_TITLE: "t", EV_BODY: "b", EV_AUTHOR_ASSOC: "NONE", EV_COMMENT: "/devos intake", EV_COMMENT_ID: "2", EV_COMMENT_AT: "2026-11-09T11:00:00Z" });
    assert.equal(outsider.status, 1);
    assert.match(outsider.stdout, /^refused=plans are made only for issues opened by the repository's owners, members or collaborators$/m);
    // The same issue resumed by dispatch is read from GitHub and held to the same rule.
    assert.equal(run({ EVENT: "workflow_dispatch" }).status, 1);
    // Your own issue: the event's title and body, your earlier answer, and the triggering comment's text.
    const own = run({ EVENT: "issue_comment", EV_TITLE: "Add a cart", EV_BODY: "the body at the event", EV_AUTHOR_ASSOC: "OWNER", EV_COMMENT: "/devos intake now", EV_COMMENT_ID: "2", EV_COMMENT_AT: "2026-11-09T11:00:00Z" });
    assert.equal(own.status, 0, own.stderr);
    assert.match(own.stdout, /^mode=intake$/m);
    assert.match(own.stdout, /^base=main$/m);
    assert.equal(read(path.join(dir, "out", "request.md")), "# Add a cart\n\nthe body at the event\n\n## The human's answers and notes in the issue thread\n\n- my earlier answer\n- now\n");
  } finally {
    cleanup(dir);
  }
});

test("intake-two-jobs.test.mjs U9 a resume plans only an issue labelled for it, never a pull request, and the issue number is exact", { skip: windows && "a stand-in gh" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-request-resume-"));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "issue41.json"), JSON.stringify({ title: "Unit T05–T06", body: "", author_association: "OWNER", labels: [{ name: "devos:acceptance" }], pull_request: {} }));
    writeFileSync(path.join(bin, "issue8.json"), JSON.stringify({ title: "x", body: "y", author_association: "OWNER", labels: [] }));
    writeFileSync(path.join(bin, "issue9.json"), JSON.stringify({ title: "Add a cart", body: "the body now", author_association: "MEMBER", labels: [{ name: "devos:method" }] }));
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh
case "$*" in
  *"issues/9/comments"*) echo '{"id":1,"author_association":"OWNER","body":"an answer","created_at":"2026-11-09T10:00:00Z"}' ;;
  *"issues/41"*) cat "${bin}/issue41.json" ;;
  *"issues/8"*) cat "${bin}/issue8.json" ;;
  *"issues/9"*) cat "${bin}/issue9.json" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const run = (issue) => spawnSync(process.execPath, [path.join(SCRIPTS, "intake-request.mjs"), "--out", path.join(dir, "out")], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: "", REPO: "o/r", ISSUE: issue, EVENT: "workflow_dispatch" } });
    const refused = (issue) => { const r = run(issue); return [r.status, /^refused=(.*)$/m.exec(r.stdout)?.[1]]; };
    assert.deepEqual(refused("41"), [1, "a pull request is not planned: `/devos revise <what to change>` on it asks for a revision"]);
    assert.deepEqual(refused("8"), [1, "only an issue labelled devos:request or devos:method is planned"]);
    assert.equal(run("09").status, 2);
    const ok = run("9");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^mode=method\nbase=main\ntitle=Add a cart\nrefused=$/m);
    assert.equal(read(path.join(dir, "out", "request.md")), "# Add a cart\n\nthe body now\n\n## The human's answers and notes in the issue thread\n\n- an answer\n");
  } finally {
    cleanup(dir);
  }
});

test("intake-two-jobs.test.mjs U10 the revise prompt says when the revision was asked for on the unit's acceptance PR", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-prompt-"));
  try {
    cpSync(path.join(PAYLOAD, "devos"), path.join(dir, "devos"), { recursive: true });
    write(dir, "devos.config.json", read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    write(dir, "docs/PHASES.md", TABLE([["T05", "P2", 2, "—", true], ["T06", "P2", 2, "G-Feature", false]]));
    const render = (env) => spawnSync(process.execPath, [path.join(SCRIPTS, "render-prompt.mjs"), "revise", "T06", "2"], { cwd: dir, encoding: "utf8", env: { ...process.env, DEVOS_ROOT: dir, DEVOS_REVISE_UNIT: "", ...env } });
    const task = render({});
    assert.equal(task.status, 0, task.stderr);
    assert.ok(task.stdout.includes('asked for a **revision** of task T06 ("Name T06") on its open pull request. The work is on this'));
    const unit = render({ DEVOS_REVISE_UNIT: "devos/unit-T06" });
    assert.ok(unit.stdout.includes('asked for a **revision** of task T06 ("Name T06") on the acceptance pull request of the unit `devos/unit-T06`, whose last task it is: every task of the unit passed, and the human asks for this change before accepting it. Their change may touch any work of the unit (within its signed scope): put all of it in this task\'s fence. The work is on this'));
    assert.ok(render({ DEVOS_REVISE_UNIT: "devos/unit-T06; rm -rf" }).stdout.includes("on its open pull request"));
  } finally {
    cleanup(dir);
  }
});

test("intake-two-jobs.test.mjs U11 /devos accept keeps your note when publish passes it from outside the branch", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-accept-note-"));
  try {
    const data = path.join(dir, "data");
    write(data, "docs/PHASES.md", TABLE([["T01", "P1", 1, "—", true], ["T02", "P1", 2, "—", false]]));
    write(data, "docs/reviews/T02-a3.md", "VERDICT: FAIL\n");
    git(["init", "-q", "-b", "main"], data);
    git(["add", "-A"], data);
    git(["commit", "-qm", "init"], data);
    write(dir, "runner/note.md", " the overlap moves to T03\n");
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, "accept.mjs"), "--task", "T02", "--by", "owner", "--pr", "9", "--note-file", path.join(dir, "runner", "note.md"), "--date", "2026-11-09"], { cwd: dir, encoding: "utf8", env: { ...quiet, DEVOS_ROOT: data, GITHUB_OUTPUT: "" } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(read(path.join(data, "docs", "reviews", "T02-a4.md")), /The owner's note:\n\n> +the overlap moves to T03\n/);
  } finally {
    cleanup(dir);
  }
});

test("intake-two-jobs.test.mjs U12 a revised unit task is built at its attempt by any run, past the cap, and reviewed deep", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-revise-unit-"));
  try {
    write(dir, "devos.config.json", read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    write(dir, "docs/PHASES.md", TABLE([["T05", "P2", 2, "—", false], ["T06", "P2", 2, "—", false], ["T07", "P2", 1, "—", false]]));
    const unit = TABLE([["T05", "P2", 2, "—", true], ["T06", "P2", 2, "—", true], ["T07", "P2", 1, "—", false]])
      .replace("| [x] | PASS a1 — docs/reviews/T06-a1.md |", "| [ ] | REVISE a5 — your revision on the acceptance PR (PR-92) |");
    write(dir, "unit.md", unit);
    const next = (args) => spawnSync(process.execPath, [path.join(SCRIPTS, "next-task.mjs"), "--unit-phases", path.join(dir, "unit.md"), ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, DEVOS_ROOT: dir, GITHUB_OUTPUT: "" } });
    // A run with no task (the supervisor, devos-advance, by hand) builds T06 attempt 5, not attempt 1; max_attempts is 3.
    for (const args of [[], ["--task", "T06"]]) {
      const r = next(args);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^task=T06$/m);
      assert.match(r.stdout, /^attempt=5$/m);
    }
    // An automatic retry past the revision's own attempt is still capped.
    assert.match(next(["--task", "T06", "--attempt", "6"]).stderr, /attempt 6 exceeds max_attempts 3/);
    // The review of a revised unit task is deep, whatever the task's risk.
    const { reviewPlan } = await load("review-mode.mjs");
    const cfg = JSON.parse(read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    const row = parsePhases(unit).rows.find((r) => r.task === "T06");
    const plan5 = reviewPlan(row, [], 5, cfg);
    assert.equal(plan5.mode, "deep");
    assert.ok(plan5.reasons.includes("your revision of its unit"));
    assert.equal(reviewPlan({ ...row, verdict: "—" }, [], 1, cfg).mode, "light");
  } finally {
    cleanup(dir);
  }
});

test("intake-two-jobs.test.mjs the manual, the precedent and the changelog name the two halves", () => {
  const has = (file, text) => assert.ok(read(path.join(root, file)).includes(text), `${file}: ${text}`);
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-92 | **Planning, revising and accepting never share a job with a write token either.**");
  has("payload/files/docs/method/PRECEDENTS.md", "**Live maximum: PR-92.**");
  has("payload/files/docs/method/AUTOMATION.md", "| `intake-request.mjs` | the request a planning run works from (PR-92)");
  has("payload/files/docs/method/AUTOMATION.md", "`intake-ack`, `intake-refuse`, `intake` (the planner, read-only), `intake-publish`");
  has("CHANGELOG.md", "- **Planning works the same way (PR-92).**");
});
