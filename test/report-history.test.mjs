import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup } from "./harness.mjs";

// E29 (PR-66): a link run's report job, once the registry has approved the link, sends one event for each task of
// docs/PHASES.md, so the registry shows the project's plan and progress. A finished task is `verdict pass`, dated by
// the commit that added its review; a task still to do is `intake pass`, dated by the commit of the plan. They form one
// run, `import-<that commit>`, paced under the registry's limit. Only paths and dates are read from git.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = path.join(root, "payload", "files", "scripts", "devos");
const HEADER = "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n|---|---|---|---|---|---|---|---|\n";

function git(cwd, args, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "Devos Test", GIT_AUTHOR_EMAIL: "devos@example.com", GIT_COMMITTER_NAME: "Devos Test", GIT_COMMITTER_EMAIL: "devos@example.com" };
  delete env.GIT_DIR;
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(dir, file, text) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

/**
 * A linked project with three commits: T01's review (2026-10-20), T02's review (2026-10-21), then the plan that ticks
 * them and keeps T03 and T04 open (2026-10-22). T02's verdict names a review that was never committed.
 */
function project(url = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-history-"));
  for (const file of ["report.mjs", "lib.mjs"]) write(dir, `scripts/devos/${file}`, readFileSync(path.join(scripts, file), "utf8"));
  write(dir, "devos.config.json", JSON.stringify({ project: "DEMO-SHOP", registry: { url } }));
  write(dir, "devos/answers.json", JSON.stringify({ registry_link: true, contract_version: "2" }));
  write(dir, ".gitignore", ".devos/\n");
  git(dir, ["init", "-q", "-b", "main"]);
  write(dir, "docs/reviews/T01-a2.md", "VERDICT: PASS\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "T01 review"], "2026-10-20T10:00:00+03:00");
  write(dir, "docs/notes.md", "T02 was reviewed elsewhere\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "T02"], "2026-10-21T10:00:00+03:00");
  write(dir, "docs/PHASES.md", `# Phases\n\n${HEADER}| T01 | P01 | J1 | Scaffold | 2 | — | [x] | PASS a2 — docs/reviews/T01-a2.md |\n| T02 | P01 | J2 | Command | 2 | — | [x] | PASS a1 — docs/reviews/T02-a1.md |\n| T03 | P02 | J3 | Colours | 1 | — | [ ] | — |\n| x9 | P02 | J4 | Not a task id | 1 | — | [ ] | — |\n| T04 | P03 | J5 | Release | 3 | owner | [ ] | — |\n`);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "plan"], "2026-10-22T10:00:00+03:00");
  return dir;
}

const link = (dir, value) => write(dir, ".devos/link.json", `${JSON.stringify(value)}\n`);

function cliEnv(env) {
  const all = { ...process.env, DEVOS_REPORTING: "on", ACTIONS_ID_TOKEN_REQUEST_URL: "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "", ...env };
  delete all.GIT_DIR;
  return all;
}

function cli(dir, args, env = {}) {
  const result = spawnSync(process.execPath, [path.join(dir, "scripts", "devos", "report.mjs"), ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: cliEnv(env) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n");
}

/** The same, without blocking this process, so a fake registry in this process can answer. */
function cliAsync(dir, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(dir, "scripts", "devos", "report.mjs"), ...args], { cwd: dir, windowsHide: true, env: cliEnv(env) });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim().split("\n")) : reject(new Error(`exit ${code}`))));
  });
}

test("report-history.test.mjs (a) the plan's events: a verdict per finished task, an intake per task to do, one import run", async () => {
  const dir = project();
  try {
    const plan = git(dir, ["rev-parse", "HEAD"]);
    const first = git(dir, ["rev-list", "--max-parents=0", "HEAD"]);
    const mod = await import(pathToFileURL(path.join(dir, "scripts", "devos", "report.mjs")).href);
    // Every git call, recorded: logs of paths and dates only, never a file's contents.
    const calls = [];
    const built = mod.historyEvents("DEMO-SHOP", (args) => {
      calls.push(args.join(" "));
      return git(dir, args);
    });
    assert.deepEqual(calls, [
      "log --no-renames -1 --format=%H%x09%cI -- docs/PHASES.md",
      "log --no-renames --diff-filter=A -1 --format=%H%x09%cI -- docs/reviews/T01-a2.md",
      "log --no-renames --diff-filter=A -1 --format=%H%x09%cI -- docs/reviews/T02-a1.md",
    ]);
    const base = { v: 1, project: "DEMO-SHOP", run: `import-${plan}` };
    assert.deepEqual(built, {
      run: `import-${plan}`,
      passed: [
        { ...base, seq: 1, phase: "P01", task: "T01", step: "verdict", status: "pass", at: "2026-10-20T07:00:00.000Z", evidence: `docs/reviews/T01-a2.md@${first}` },
        { ...base, seq: 2, phase: "P01", task: "T02", step: "verdict", status: "pass", at: "2026-10-22T07:00:00.000Z", evidence: `docs/PHASES.md@${plan}` },
      ],
      planned: [
        { ...base, seq: 3, phase: "P02", task: "T03", step: "intake", status: "pass", at: "2026-10-22T07:00:00.000Z", evidence: `docs/PHASES.md@${plan}` },
        { ...base, seq: 5, phase: "P03", task: "T04", step: "intake", status: "pass", at: "2026-10-22T07:00:00.000Z", evidence: `docs/PHASES.md@${plan}` },
      ],
      skipped: ["x9"],
    });
    for (const event of [...built.passed, ...built.planned]) assert.deepEqual(mod.problems(event), [], event.task);
    // A reader that finds no commit for the plan sends nothing.
    assert.deepEqual(mod.historyEvents("DEMO-SHOP", () => ""), { error: "docs/PHASES.md has no commit in this checkout" });
  } finally {
    cleanup(dir);
  }
});

test("report-history.test.mjs (b) the command sends only once the link is approved, in its order, and never with reporting off", () => {
  const dir = project();
  try {
    assert.deepEqual(cli(dir, ["history", "--dry"]), ["devos report: the project's tasks wait for the link (not asked); a link run after the approval sends them"]);
    link(dir, { status: "pending" });
    assert.deepEqual(cli(dir, ["history", "--dry"]), ["devos report: the project's tasks wait for the link (pending); a link run after the approval sends them"]);
    link(dir, { status: "linked", key: "DEMO-SHOP-2" });
    assert.deepEqual(cli(dir, ["history", "--dry"], { DEVOS_REPORTING: "off" }), ["devos report: reporting is off (DEVOS_REPORTING); no history sent"]);
    // Contract 2 describes the plan's events; a project that accepted contract 1 is asked to accept it first.
    write(dir, "devos/answers.json", JSON.stringify({ registry_link: true, contract_version: "1" }));
    assert.deepEqual(cli(dir, ["history", "--dry"]), [
      "devos report: the project's tasks are sent only to a project that accepted contract 2 or later, and this one accepted 1; accept it again from the project's page (Connect)",
    ]);
    write(dir, "devos/answers.json", JSON.stringify({ registry_link: true, contract_version: "2" }));
    const lines = cli(dir, ["history", "--dry"]);
    assert.equal(lines.at(-1), "devos report: history of 4 tasks (2 passed, 2 planned); nothing sent (--dry)");
    // The passed tasks first, then the planned ones from the last to the first: the first task to do is sent last.
    assert.deepEqual(lines.slice(0, -1).map((line) => JSON.parse(line)).map((event) => `${event.seq} ${event.task} ${event.step} ${event.project}`), [
      "1 T01 verdict DEMO-SHOP-2",
      "2 T02 verdict DEMO-SHOP-2",
      "5 T04 intake DEMO-SHOP-2",
      "3 T03 intake DEMO-SHOP-2",
    ]);
    assert.equal(cli(dir, ["history"])[0], "devos report: no OIDC token; the history of 4 tasks (2 passed, 2 planned) is not sent");
    write(dir, "docs/PHASES.md", "# Phases\n\nNo table.\n");
    assert.deepEqual(cli(dir, ["history", "--dry"]), ["devos report: docs/PHASES.md has no task table; no history sent"]);
  } finally {
    cleanup(dir);
  }
});

test("report-history.test.mjs (c) sending stays under the registry's limit in any minute, renews the token and keeps to its time budget", async () => {
  const dir = project();
  try {
    const mod = await import(pathToFileURL(path.join(dir, "scripts", "devos", "report.mjs")).href);
    const events = [1, 2, 3, 4, 5].map((seq) => ({ seq }));
    // A clock that moves 1 for each send and as long as the sender sleeps, and a registry whose answers the test chooses.
    const run = async (answers, options = {}) => {
      let clock = 0;
      const slept = [];
      const sent = [];
      const tokens = [];
      const tally = await mod.sendHistory(events, {
        url: "u",
        getToken: async () => {
          tokens.push(clock);
          return options.noToken !== undefined && tokens.length > options.noToken ? null : `t${tokens.length}`;
        },
        send: async (url, token, event) => {
          sent.push(`${event.seq}:${token}`);
          clock += 1;
          return answers(event.seq, sent.length);
        },
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms);
          clock += ms;
        },
        rate: 2,
        windowMs: 100,
        budgetMs: 1000,
        tokenMs: 1000,
        ...options,
      });
      return { tally, slept, sent, tokens };
    };
    const stored = { status: 200, answer: { stored: true, duplicate: false } };
    const duplicate = { status: 200, answer: { stored: false, duplicate: true } };
    // At most 2 stored in any 100: each send waits until the stored event 2 before it is 100 old.
    assert.deepEqual(await run(() => stored), {
      tally: { stored: 5, duplicate: 0, conflict: 0, left: 0, error: "" },
      slept: [99, 99],
      sent: ["1:t1", "2:t1", "3:t1", "4:t1", "5:t1"],
      tokens: [0],
    });
    // Duplicates are not stored again, so they do not count towards the limit.
    assert.deepEqual((await run((seq) => (seq < 5 ? duplicate : stored))).slept, []);
    // A conflict is counted and the next event goes on; one 429 waits a window and tries the same event again.
    assert.deepEqual(await run((seq, n) => (seq === 2 ? { status: 409, answer: {} } : seq === 3 && n === 3 ? { status: 429, answer: {} } : stored)), {
      tally: { stored: 4, duplicate: 0, conflict: 1, left: 0, error: "" },
      slept: [100, 99],
      sent: ["1:t1", "2:t1", "3:t1", "3:t1", "4:t1", "5:t1"],
      tokens: [0],
    });
    // A 401 asks for a new token once and sends the same event again with it.
    assert.deepEqual(await run((seq, n) => (seq === 2 && n === 2 ? { status: 401, answer: { error: "expired" } } : stored)), {
      tally: { stored: 5, duplicate: 0, conflict: 0, left: 0, error: "" },
      slept: [98, 1, 98],
      sent: ["1:t1", "2:t1", "2:t2", "3:t2", "4:t2", "5:t2"],
      tokens: [0, 2],
    });
    // A token older than tokenMs is renewed before the next send.
    assert.deepEqual((await run(() => stored, { tokenMs: 50 })).tokens, [0, 101, 202]);
    // A second 429 or 401 for the same event, or a registry that does not answer, leaves the rest for the next link run.
    assert.deepEqual((await run((seq) => (seq === 3 ? { status: 429, answer: { error: "rate_limited" } } : stored))).tally, { stored: 2, duplicate: 0, conflict: 0, left: 3, error: "rate_limited" });
    assert.deepEqual((await run((seq) => (seq === 3 ? { status: 401, answer: { error: "expired" } } : stored))).tally, { stored: 2, duplicate: 0, conflict: 0, left: 3, error: "expired" });
    assert.deepEqual((await run((seq) => (seq === 2 ? { status: 0, answer: {}, error: "timeout" } : stored))).tally, { stored: 1, duplicate: 0, conflict: 0, left: 4, error: "timeout" });
    // No token at all sends nothing; a token that cannot be renewed stops there.
    assert.deepEqual((await run(() => stored, { noToken: 0 })).tally, { stored: 0, duplicate: 0, conflict: 0, left: 5, error: "no OIDC token" });
    assert.deepEqual((await run(() => stored, { noToken: 1, tokenMs: 50 })).tally, { stored: 2, duplicate: 0, conflict: 0, left: 3, error: "no OIDC token" });
    // The budget is checked after each wait: past it, the rest waits for the next link run.
    assert.deepEqual((await run(() => stored, { budgetMs: 101 })).tally, { stored: 3, duplicate: 0, conflict: 0, left: 2, error: "" });
    assert.deepEqual((await run(() => stored, { budgetMs: 50 })).tally, { stored: 2, duplicate: 0, conflict: 0, left: 3, error: "" });
  } finally {
    cleanup(dir);
  }
});

test("report-history.test.mjs (d) a linked project's history reaches the registry with GitHub's OIDC identity", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      seen.push({ path: url.pathname, audience: url.searchParams.get("audience"), auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      if (url.pathname === "/token") res.end(JSON.stringify({ value: "oidc-jwt" }));
      else res.end(JSON.stringify(seen.filter((entry) => entry.path === "/api/ingest").length === 1 ? { stored: false, duplicate: true } : { stored: true, duplicate: false }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = project(base);
  try {
    link(dir, { status: "linked", key: "DEMO-SHOP-2" });
    const lines = await cliAsync(dir, ["history"], { ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/token?api-version=2.0`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token" });
    assert.deepEqual(lines, ["devos report: history of 4 tasks (2 passed, 2 planned): stored 3, duplicate 1, conflict 0"]);
    assert.deepEqual(seen[0], { path: "/token", audience: base, auth: "Bearer request-token", body: null });
    const posted = seen.slice(1);
    assert.deepEqual(posted.map((entry) => [entry.path, entry.auth, entry.body.task, entry.body.step]), [
      ["/api/ingest", "Bearer oidc-jwt", "T01", "verdict"],
      ["/api/ingest", "Bearer oidc-jwt", "T02", "verdict"],
      ["/api/ingest", "Bearer oidc-jwt", "T04", "intake"],
      ["/api/ingest", "Bearer oidc-jwt", "T03", "intake"],
    ]);
    for (const entry of posted) assert.deepEqual(Object.keys(entry.body), ["v", "project", "run", "seq", "phase", "task", "step", "status", "at", "evidence"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(dir);
  }
});

test("report-history.test.mjs (e) only a link run's report job sends the history, from a checkout with the plan's history and no file contents", () => {
  const cycle = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8").replaceAll("\r\n", "\n");
  const job = cycle.slice(cycle.indexOf("\n  report:\n"), cycle.indexOf("\n  wait-and-resume:\n"));
  for (const line of [
    "    timeout-minutes: 8\n",
    "          persist-credentials: false\n          fetch-depth: ${{ inputs.task == 'link' && '0' || '1' }}\n          filter: blob:none\n          sparse-checkout-cone-mode: false\n",
    "            /scripts/devos/\n            /devos/\n            /devos.config.json\n            /docs/PHASES.md\n",
    "        timeout-minutes: 7\n        env:\n          LINK_RUN: ${{ inputs.task == 'link' }}\n",
    "          node scripts/devos/report.mjs link\n          node scripts/devos/report.mjs flush\n          if [ \"$LINK_RUN\" = \"true\" ]; then node scripts/devos/report.mjs history; fi\n",
  ]) {
    assert.equal(job.includes(line), true, line);
  }
  assert.equal(cycle.split("report.mjs history").length - 1, 1);
  assert.equal(cycle.split("id-token: write").length - 1, 1);
  const report = readFileSync(path.join(scripts, "report.mjs"), "utf8");
  assert.equal(report.includes('"--no-renames"'), true);
  assert.equal(/\bgit\b[^\n]*\b(show|cat-file|blame)\b/.test(report), false);
  const precedents = readFileSync(path.join(root, "payload", "files", "docs", "method", "PRECEDENTS.md"), "utf8");
  assert.equal(precedents.includes("| PR-66 | **A linked project's plan and progress reach the registry from a link run.**"), true);
  const manual = readFileSync(path.join(root, "payload", "files", "docs", "method", "AUTOMATION.md"), "utf8");
  assert.equal(manual.includes("`history` (in a link run, PR-66)"), true);
  // Contract 2 says so before it is accepted.
  const contract = readFileSync(path.join(root, "payload", "contract", "CONTRACT.md"), "utf8").replace(/\s+/g, " ");
  assert.equal(contract.startsWith("# DEV_OS contract — version 2 "), true);
  assert.equal(contract.includes("After approval, a link run, which builds nothing, also sends the project's plan as events with the same fields: one for each task in `docs/PHASES.md`, marked passed for a task already finished, dated when its review was committed, or planned for a task still to do. This includes tasks finished before you linked the project."), true);
});
