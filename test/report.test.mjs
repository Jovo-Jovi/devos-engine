import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = path.join(root, "payload", "files", "scripts", "devos");
const PHASES = [
  "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |",
  "|---|---|---|---|---|---|---|---|",
  "| T01 | P01 | J1 | Skeleton | 2 | — | [ ] | — |",
  "",
].join("\n");

/** A project folder with the report script, as the runner checks it out. */
function project(url) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-report-"));
  mkdirSync(path.join(dir, "scripts", "devos"), { recursive: true });
  mkdirSync(path.join(dir, "devos"));
  mkdirSync(path.join(dir, "docs"));
  for (const file of ["report.mjs", "lib.mjs"]) copyFileSync(path.join(scripts, file), path.join(dir, "scripts", "devos", file));
  writeFileSync(path.join(dir, "devos.config.json"), JSON.stringify({ project: "DEMO-SHOP", registry: { url } }));
  writeFileSync(path.join(dir, "devos", "engine.lock.json"), JSON.stringify({ engine_version: "0.2.9" }));
  writeFileSync(path.join(dir, "devos", "answers.json"), JSON.stringify({ contract_version: "0-draft-3" }));
  writeFileSync(path.join(dir, "docs", "PHASES.md"), PHASES);
  return dir;
}

/** A fake registry and GitHub OIDC endpoint on this computer. Every request is recorded. */
async function registry({ link = 200, ingest = () => 200 } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      seen.push({ path: url.pathname, audience: url.searchParams.get("audience"), auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      const send = (status, value) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === "/token") {
        if (req.headers.authorization !== "Bearer request-token") return send(403, {});
        return send(200, { value: "oidc-jwt" });
      }
      if (url.pathname === "/api/link") {
        if (link === 200) return send(200, { status: "linked", key: "DEMO-SHOP-2" });
        if (link === 202) return send(202, { status: "pending" });
        if (link === 403) return send(403, { status: "declined" });
        return send(link, { error: "unavailable" });
      }
      if (url.pathname === "/api/ingest") {
        const status = ingest(JSON.parse(body));
        if (status === 200) return send(200, { stored: true, duplicate: false });
        if (status === "duplicate") return send(200, { stored: false, duplicate: true });
        if (status === 409) return send(409, { error: "duplicate_conflict" });
        return send(status, { error: "unavailable" });
      }
      return send(404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

// GIT_DIR names no repository, so no event takes a commit from a repository around the temporary folder.
const ENV = { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", TASK: "T01", DEVOS_REPORTING: "", GIT_DIR: path.join(tmpdir(), "devos-report-no-git") };

/** Runs report.mjs's main() from the project's copy, with these environment variables, and returns its lines. */
async function report(dir, argv, env = {}) {
  const saved = {};
  const all = { ...ENV, ACTIONS_ID_TOKEN_REQUEST_URL: "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "", ...env };
  for (const [key, value] of Object.entries(all)) {
    saved[key] = process.env[key];
    if (value === "") delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const mod = await import(pathToFileURL(path.join(dir, "scripts", "devos", "report.mjs")).href);
    const lines = [];
    const code = await mod.main(argv, (line) => lines.push(line));
    assert.equal(code, 0);
    return lines;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const journal = (dir) => readFileSync(path.join(dir, ".devos", "journal.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const oidcEnv = (base) => ({ ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/token?api-version=2.0`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token" });

test("report.test.mjs (a) note keeps each step's event in the journal, valid by the event contract v1", async () => {
  const dir = project("");
  try {
    assert.deepEqual(await report(dir, ["note", "--step", "build", "--status", "started"]), ["devos report: noted build started"]);
    await report(dir, ["note", "--step", "build", "--status", "pass", "--evidence", "@abcdef1"]);
    assert.deepEqual(await report(dir, ["note", "--step", "checks", "--status", "started"]), [
      "devos report: checks started is not a valid event (status started for checks); nothing noted",
    ]);
    await report(dir, ["note", "--step", "review", "--status", "started"]);
    assert.deepEqual(await report(dir, ["note", "--failed"]), ["devos report: noted review fail"]);
    assert.deepEqual(await report(dir, ["note", "--failed"]), ["devos report: no step was left open"]);
    const lines = journal(dir);
    assert.deepEqual(lines.map((line) => `${line.event.seq} ${line.event.step} ${line.event.status}`), ["1 build started", "2 build pass", "3 review started", "4 review fail"]);
    const first = lines[0];
    assert.deepEqual(Object.keys(first.event), ["v", "project", "run", "seq", "phase", "task", "step", "status", "at", "evidence"]);
    assert.equal(first.event.run, "gha-123-1");
    assert.equal(first.event.phase, "P01");
    assert.equal(first.event.task, "T01");
    assert.equal(first.event.evidence, null);
    assert.equal(lines[1].event.evidence, "@abcdef1");
    assert.equal(first.sent, false);
    assert.equal(first.attempts, 0);
    const mod = await import(pathToFileURL(path.join(dir, "scripts", "devos", "report.mjs")).href);
    assert.deepEqual(mod.problems({ ...first.event, project: "DEMO-SHOP" }), []);
    assert.deepEqual(mod.problems({ ...first.event, project: "DEMO-SHOP", extra: 1 }), ["unknown field extra"]);
    assert.deepEqual(mod.problems({ ...first.event, project: "DEMO-SHOP", evidence: `${"a".repeat(2100)}@abcdef1` }), ["evidence", "larger than 2048 bytes"]);
  } finally {
    cleanup(dir);
  }
});

test("report.test.mjs (b) link asks the registry with GitHub's OIDC identity and keeps its answer", async () => {
  for (const [status, line, kept] of [
    [200, "devos report: linked to the DEV_OS registry as DEMO-SHOP-2", { status: "linked", key: "DEMO-SHOP-2" }],
    [202, "devos report: link requested; it waits for the registry owner's approval, and the next run asks again", { status: "pending" }],
    [403, "devos report: the registry declined this repository's link; nothing is sent. To stop asking, set the repository variable DEVOS_REPORTING to off", { status: "declined" }],
    [429, "devos report: the registry takes no new link requests right now; the next run asks again", { status: "busy" }],
    [503, "devos report: the registry did not answer (503); the next run asks again", { status: "unreachable" }],
  ]) {
    const server = await registry({ link: status });
    const dir = project(`${server.base}/`);
    try {
      assert.deepEqual(await report(dir, ["link"], oidcEnv(server.base)), [line]);
      assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".devos", "link.json"), "utf8")), kept);
      const [token, ask] = server.seen;
      assert.equal(token.path, "/token");
      assert.equal(token.audience, server.base);
      assert.equal(ask.path, "/api/link");
      assert.equal(ask.auth, "Bearer oidc-jwt");
      assert.deepEqual(ask.body, { v: 1, key: "DEMO-SHOP", engine: "0.2.9", contract: "0-draft-3" });
    } finally {
      await server.close();
      cleanup(dir);
    }
  }
  const quiet = project("");
  try {
    assert.deepEqual(await report(quiet, ["link"]), ["devos report: no registry address in devos.config.json (registry.url); nothing sent"]);
    assert.deepEqual(await report(quiet, ["link"], { DEVOS_REPORTING: "off" }), ["devos report: reporting is off (DEVOS_REPORTING); nothing sent"]);
  } finally {
    cleanup(quiet);
  }
  const server = await registry();
  const tokenless = project(server.base);
  try {
    assert.deepEqual(await report(tokenless, ["link"]), ["devos report: no OIDC token (the job needs id-token: write; a fork has none); nothing sent"]);
    assert.equal(server.seen.length, 0);
  } finally {
    await server.close();
    cleanup(tokenless);
  }
});

test("report.test.mjs (c) flush sends each unsent event once, in order, and never again after a conflict", async () => {
  let down = true;
  const answers = { 1: 200, 2: "duplicate", 3: 409 };
  const server = await registry({ ingest: (event) => answers[event.seq] ?? (down ? 503 : 200) });
  const dir = project(server.base);
  try {
    for (const step of ["build", "checks", "verdict", "merge"]) await report(dir, ["note", "--step", step, "--status", "pass"]);
    assert.deepEqual(await report(dir, ["flush"], oidcEnv(server.base)), ["devos report: not linked (not asked); 4 events kept, not sent"]);
    await report(dir, ["link"], oidcEnv(server.base));
    server.seen.length = 0;
    assert.deepEqual(await report(dir, ["flush"], oidcEnv(server.base)), [
      "devos report: conflict: gha-123-1 seq 3",
      "devos report: sent 1, duplicate 1, conflict 1, kept 1",
    ]);
    const posted = server.seen.filter((item) => item.path === "/api/ingest");
    assert.deepEqual(posted.map((item) => item.body.seq), [1, 2, 3, 4]);
    assert.equal(posted.every((item) => item.body.project === "DEMO-SHOP-2" && item.auth === "Bearer oidc-jwt"), true);
    assert.deepEqual(journal(dir).map((line) => line.sent), [true, true, "conflict", false]);
    assert.equal(journal(dir)[3].attempts, 1);
    assert.equal(journal(dir)[3].last_error, "unavailable");

    down = false;
    server.seen.length = 0;
    assert.deepEqual(await report(dir, ["flush"], oidcEnv(server.base)), ["devos report: sent 1, duplicate 0, conflict 0, kept 0"]);
    assert.deepEqual(server.seen.filter((item) => item.path === "/api/ingest").map((item) => item.body.seq), [4]);
    assert.deepEqual(await report(dir, ["flush"], oidcEnv(server.base)), ["devos report: nothing to send"]);
  } finally {
    await server.close();
    cleanup(dir);
  }
});

test("report.test.mjs (d) --dry prints what would be sent and never a token", async () => {
  const server = await registry();
  const dir = project(server.base);
  try {
    const link = await report(dir, ["link", "--dry"], oidcEnv(server.base));
    assert.deepEqual(JSON.parse(link[0]), { url: `${server.base}/api/link`, body: { v: 1, key: "DEMO-SHOP", engine: "0.2.9", contract: "0-draft-3" } });
    await report(dir, ["note", "--step", "build", "--status", "started"]);
    await report(dir, ["link"], oidcEnv(server.base));
    const before = readFileSync(path.join(dir, ".devos", "journal.jsonl"), "utf8");
    server.seen.length = 0;
    const lines = await report(dir, ["flush", "--dry"], oidcEnv(server.base));
    assert.equal(JSON.parse(lines[0]).project, "DEMO-SHOP-2");
    assert.equal(server.seen.length, 0);
    assert.equal(readFileSync(path.join(dir, ".devos", "journal.jsonl"), "utf8"), before);
    for (const line of [...link, ...lines]) {
      assert.equal(line.includes("oidc-jwt"), false);
      assert.equal(line.includes("request-token"), false);
    }
  } finally {
    await server.close();
    cleanup(dir);
  }
});

test("report.test.mjs (e) reporting never blocks: every command exits 0, even with the registry down", async () => {
  const server = await registry();
  const base = server.base;
  await server.close();
  const dir = project(base);
  try {
    const run = spawnSync(process.execPath, [path.join(dir, "scripts", "devos", "report.mjs"), "link"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      env: { ...process.env, ...ENV, ...oidcEnv(base) },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /devos report: no OIDC token|devos report: the registry did not answer \(network\)/);
    assert.deepEqual(await report(dir, ["bogus"]), [
      "usage: node scripts/devos/report.mjs note --step <step> --status <status> [--evidence <path@sha>] | note --failed | link | flush [--dry]",
    ]);
    assert.equal(existsSync(path.join(dir, ".devos", "journal.jsonl")), false);
  } finally {
    cleanup(dir);
  }
});

test("report.test.mjs (f) only the report job holds the OIDC permission, and it runs no agent", () => {
  const text = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8").replaceAll("\r\n", "\n");
  const start = text.indexOf("\n  report:\n");
  const end = text.indexOf("\n  wait-and-resume:\n");
  assert.equal(start > 0 && end > start, true);
  const job = text.slice(start, end);
  const rest = text.slice(0, start) + text.slice(end);
  assert.equal(job.includes("      id-token: write"), true);
  assert.equal(rest.includes("id-token"), false);
  for (const agent of ["run-agent.sh", "agent -p", "claude -p", "codex", "gemini", "secrets."]) assert.equal(job.includes(agent), false, agent);
  // PR-62: only the developer's yes at devos init turns reporting on.
  assert.equal(job.includes("    if: always() && needs.cycle.result != 'skipped' && vars.DEVOS_REPORTING == 'on'"), true);
  assert.equal(job.includes("    continue-on-error: true"), true);
  assert.equal(job.includes("node scripts/devos/report.mjs link\n          node scripts/devos/report.mjs flush"), true);
  assert.equal(rest.includes("report.mjs link") || rest.includes("report.mjs flush"), false);
  const notes = rest.split("\n      - name: devos-report").slice(1);
  assert.equal(notes.length, 7);
  for (const step of notes) assert.equal(step.split("\n      - ")[0].includes("continue-on-error: true"), true, step.slice(0, 60));
});
