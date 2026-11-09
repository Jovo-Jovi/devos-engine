import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// E40 (PR-70): a check that hangs is stopped at its time limit, with everything it started, and recorded as
// timeout; the checks share a budget; the supervisor resumes a cycle run GitHub stopped at its time limit.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function staged(settings) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-limits-"));
  assert.equal(spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true }).status, 0);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir, windowsHide: true }).status, 0);
  const project = JSON.parse(readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8").replaceAll("__PROJECT_KEY__", "DEMO"));
  Object.assign(project, settings);
  writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  return dir;
}

function checks(dir) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["scripts/devos/run-checks.mjs"], { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 120000 });
  const report = JSON.parse(readFileSync(path.join(dir, ".devos", "ci-results.json"), "utf8"));
  return { result, report, seconds: (Date.now() - started) / 1000, named: (name) => report.results.find((item) => item.name === name) };
}

// A command that never ends, with a child of its own that keeps the output open and writes its pid.
const hang = (pidFile) => `node -e "const c=require('child_process').spawn(process.execPath,['-e','require(\\'fs\\').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)','${pidFile.replaceAll("\\", "/")}'],{stdio:'inherit'});setInterval(()=>{},1000)"`;
const OK = "node -e \"process.exit(0)\"";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("time-limits.test.mjs (a) a check that hangs is stopped at its limit with what it started, and is recorded as timeout", () => {
  const dir = staged({ check_timeout_minutes: 0.05 });
  // Outside the project: run-checks removes what a check leaves in it.
  const outside = mkdtempSync(path.join(tmpdir(), "devos-pid-"));
  const pidFile = path.join(outside, "child.pid");
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const project = JSON.parse(readFileSync(path.join(dir, "devos", "project.json"), "utf8"));
    project.stack = { toolchain: "python", manifest: "pyproject.toml", commands: { install: OK, typecheck: OK, lint: OK, test: hang(pidFile), build: OK } };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, windowsHide: true }).status, 0);
    const run = checks(dir);
    assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
    assert.equal(run.seconds < 60, true, `run-checks took ${run.seconds} s`);
    assert.equal(run.named("test").status, "timeout");
    assert.equal(run.named("test").required, true);
    assert.equal(run.named("build").status, "pass");
    assert.equal(run.report.all_required_passed, false);
    // guards fails too: the staged project has no documents.
    assert.deepEqual(run.report.failed_required.filter((name) => name !== "guards"), ["test"]);
    assert.equal(run.result.stdout.includes("TIMEOUT            test\n"), true, run.result.stdout);
    assert.equal(readFileSync(path.join(dir, ".devos", "logs", "test.log"), "utf8").endsWith("\ndevos: test passed its time limit of 0.05 minutes (check_timeout_minutes) and was stopped (PR-70)"), true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    const until = Date.now() + 10000;
    while (alive(pid) && Date.now() < until) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
    assert.equal(alive(pid), false, "the check's child is still running");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("time-limits.test.mjs (b) the checks share a budget: a check left when it is used up is not started", () => {
  const dir = staged({ check_timeout_minutes: 10, checks_budget_minutes: 0.05 });
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const project = JSON.parse(readFileSync(path.join(dir, "devos", "project.json"), "utf8"));
    project.stack = { toolchain: "python", manifest: "pyproject.toml", commands: { install: OK, typecheck: OK, lint: hang(path.join(tmpdir(), `devos-lint-${process.pid}.pid`)), test: OK, build: OK } };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, windowsHide: true }).status, 0);
    const run = checks(dir);
    assert.equal(run.seconds < 60, true, `run-checks took ${run.seconds} s`);
    assert.equal(run.named("lint").status, "timeout");
    assert.equal(readFileSync(path.join(dir, ".devos", "logs", "lint.log"), "utf8").endsWith("\ndevos: lint was stopped when the checks' budget of 0.05 minutes (checks_budget_minutes) ran out (PR-70)"), true);
    for (const name of ["test", "build"]) {
      assert.equal(run.named(name).status, "timeout", name);
      assert.equal(readFileSync(path.join(dir, ".devos", "logs", `${name}.log`), "utf8"), `$ ${OK}\n\ndevos: ${name} was not started: the checks' budget of 0.05 minutes (checks_budget_minutes) was used up (PR-70)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("time-limits.test.mjs (c) the browser install for e2e keeps its log, and the defaults name the limits", () => {
  const dir = staged({ check_timeout_minutes: 0.05 });
  try {
    writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "demo", private: true, scripts: { e2e: OK } }, null, 2)}\n`);
    checks(dir);
    assert.equal(readFileSync(path.join(dir, ".devos", "logs", "e2e-install.log"), "utf8").startsWith("$ pnpm exec playwright install --with-deps chromium\n"), true);
    const config = JSON.parse(readFileSync(path.join(dir, "devos.config.json"), "utf8"));
    assert.equal(config.check_timeout_minutes, 0.05);
    const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
    assert.deepEqual([defaults.check_timeout_minutes, defaults.checks_budget_minutes], [30, 60]);
    const manual = readFileSync(path.join(root, "payload", "files", "docs", "method", "AUTOMATION.md"), "utf8");
    for (const part of ["`check_timeout_minutes`, 30", "`checks_budget_minutes`, 60", "its log `e2e-install.log`", "a cycle run GitHub stopped at its time limit"]) assert.equal(manual.includes(part), true, part);
    const precedents = readFileSync(path.join(root, "payload", "files", "docs", "method", "PRECEDENTS.md"), "utf8");
    assert.equal(precedents.includes("| PR-70 | **A check that hangs fails; it never holds the run.**"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A gh that answers the supervisor's API calls from a map; a .cmd cannot be run without a shell on Windows.
test("time-limits.test.mjs (d) the supervisor resumes a run GitHub stopped at its time limit, and leaves a cancelled one alone", { skip: process.platform === "win32" && "a stand-in gh.cmd cannot run without a shell on Windows" }, () => {
  const dir = staged({});
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const bin = mkdtempSync(path.join(tmpdir(), "devos-gh-"));
  try {
    const R = "repos/devtest/demo";
    const run = (id, title) => ({ id, display_title: title, status: "completed", conclusion: "cancelled", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T02:30:00Z", html_url: `https://github.com/devtest/demo/actions/runs/${id}` });
    const job = (id, pushed) => ({ jobs: [{ id, name: "cycle", conclusion: "cancelled", steps: [
      { name: "Builder — Cursor CLI", conclusion: pushed ? "success" : "cancelled" },
      { name: "Commit and push the builder's work, write runner evidence", conclusion: pushed ? "success" : "skipped" },
      { name: "Checks (evidence for the reviewer)", conclusion: pushed ? "cancelled" : "skipped" },
    ] }] });
    const limit = [{ message: "The job running on runner GitHub Actions 12 has exceeded the maximum execution time of 150 minutes." }];
    const map = {
      [`api ${R}/actions/runs/101`]: run(101, "devos T20 · attempt 2"),
      [`api ${R}/actions/runs/101/jobs`]: job(9001, true),
      [`api ${R}/check-runs/9001/annotations`]: limit,
      [`api ${R}/actions/runs/102`]: run(102, "devos T21 · attempt 1"),
      [`api ${R}/actions/runs/102/jobs`]: job(9002, true),
      [`api ${R}/check-runs/9002/annotations`]: [],
      [`api ${R}/actions/runs/103`]: run(103, "devos T22 · attempt 1"),
      [`api ${R}/actions/runs/103/jobs`]: job(9003, false),
      [`api ${R}/check-runs/9003/annotations`]: limit,
      // No annotations to read: the job's run time against the cycle job's own limit (150 minutes) decides.
      [`api ${R}/actions/runs/104`]: run(104, "devos T23 · attempt 1"),
      [`api ${R}/actions/runs/104/jobs`]: { jobs: [{ ...job(9004, true).jobs[0], started_at: "2026-11-01T00:00:00Z", completed_at: "2026-11-01T02:30:20Z" }] },
      [`api ${R}/actions/runs/105`]: run(105, "devos T24 · attempt 1"),
      [`api ${R}/actions/runs/105/jobs`]: { jobs: [{ ...job(9005, true).jobs[0], started_at: "2026-11-01T00:00:00Z", completed_at: "2026-11-01T00:20:00Z" }] },
      // A wait the owner stopped: cancelling wait-and-resume is how a wait is stopped, however long it ran.
      [`api ${R}/actions/runs/106`]: run(106, "devos T25 · attempt 1"),
      [`api ${R}/actions/runs/106/jobs`]: { jobs: [{ id: 9006, name: "wait-and-resume", conclusion: "cancelled", steps: [], started_at: "2026-11-01T00:00:00Z", completed_at: "2026-11-01T03:20:00Z" }] },
      // PR-90: the two jobs. publish stopped after it pushed the builder's work; work stopped before it handed it over.
      [`api ${R}/actions/runs/107`]: run(107, "devos T26 · attempt 1"),
      [`api ${R}/actions/runs/107/jobs`]: { jobs: [{ id: 9007, name: "publish", conclusion: "cancelled", steps: [{ name: "Push the builder's work", conclusion: "success" }, { name: "Reviewer (Claude Code, its own user, no shell)", conclusion: "cancelled" }] }] },
      [`api ${R}/check-runs/9007/annotations`]: limit,
      [`api ${R}/actions/runs/108`]: run(108, "devos T27 · attempt 1"),
      [`api ${R}/actions/runs/108/jobs`]: { jobs: [{ id: 9008, name: "work / work", conclusion: "cancelled", steps: [{ name: "Checks (evidence for the reviewer)", conclusion: "cancelled" }] }] },
      [`api ${R}/check-runs/9008/annotations`]: limit,
    };
    writeFileSync(path.join(bin, "map.json"), JSON.stringify(map));
    writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node\nconst map = require(${JSON.stringify(path.join(bin, "map.json"))});\nconst key = process.argv.slice(2).join(" ");\nif (key.endsWith("/logs")) { process.stdout.write("##[error]The operation was canceled.\\n"); process.exit(0); }\nif (!(key in map)) process.exit(1);\nprocess.stdout.write(JSON.stringify(map[key]));\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const classify = (id) => {
      const out = spawnSync(process.execPath, ["scripts/devos/supervisor.mjs", "classify", "--run", String(id)], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, REPO: "devtest/demo" } });
      assert.equal(out.status, 0, out.stderr);
      return out.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    };
    assert.deepEqual(classify(101), [{ kind: "runner-failure", task: "T20", attempt: 2, step: "Checks (evidence for the reviewer)", key: "T20:a2:time-limit", cause: "GitHub stopped the run at its time limit, in \"Checks (evidence for the reviewer)\"; the builder's work is on the branch, so only the checks and the review run again", action: "redispatch", rescue: null, review_only: true }]);
    assert.deepEqual(classify(102), []);
    const building = classify(103);
    assert.equal(building.length, 1);
    assert.deepEqual([building[0].key, building[0].action, building[0].review_only, building[0].step], ["T22:a1:time-limit", "redispatch", false, "Builder — Cursor CLI"]);
    assert.deepEqual(classify(104).map((i) => [i.key, i.review_only]), [["T23:a1:time-limit", true]]);
    assert.deepEqual(classify(105), []);
    assert.deepEqual(classify(106), []);
    assert.deepEqual(classify(107).map((i) => [i.key, i.review_only]), [["T26:a1:time-limit", true]]);
    assert.deepEqual(classify(108).map((i) => [i.key, i.review_only]), [["T27:a1:time-limit", false]]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(bin, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("time-limits.test.mjs (e) a check that leaves a child holding its output, or reads its input, still ends at once", () => {
  const dir = staged({ check_timeout_minutes: 5 });
  const outside = mkdtempSync(path.join(tmpdir(), "devos-pid-"));
  const pidFile = path.join(outside, "left.pid");
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    // lint ends at once but leaves a child that keeps the output open; test reads its input to the end.
    const leaves = `node -e "require('child_process').spawn(process.execPath,['-e','require(\\'fs\\').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)','${pidFile.replaceAll("\\", "/")}'],{stdio:'inherit'}).unref()"`;
    const reads = "node -e \"process.stdin.resume();process.stdin.on('end',()=>process.exit(0))\"";
    const project = JSON.parse(readFileSync(path.join(dir, "devos", "project.json"), "utf8"));
    project.stack = { toolchain: "python", manifest: "pyproject.toml", commands: { install: OK, typecheck: OK, lint: leaves, test: reads, build: OK } };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, windowsHide: true }).status, 0);
    const run = checks(dir);
    assert.equal(run.seconds < 30, true, `run-checks took ${run.seconds} s`);
    assert.equal(run.named("lint").status, "pass");
    assert.equal(run.named("test").status, "pass");
    if (process.platform !== "win32") {
      const pid = Number(readFileSync(pidFile, "utf8"));
      const until = Date.now() + 10000;
      while (alive(pid) && Date.now() < until) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
      assert.equal(alive(pid), false, "what the check left running is still running");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("time-limits.test.mjs (f) Ctrl-C during a check ends it, writes no results and exits 130", { skip: process.platform === "win32" && "Windows has no SIGINT to send to a process" }, async () => {
  const dir = staged({ check_timeout_minutes: 5 });
  const outside = mkdtempSync(path.join(tmpdir(), "devos-pid-"));
  const pidFile = path.join(outside, "child.pid");
  try {
    writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    const project = JSON.parse(readFileSync(path.join(dir, "devos", "project.json"), "utf8"));
    project.stack = { toolchain: "python", manifest: "pyproject.toml", commands: { install: OK, typecheck: hang(pidFile), lint: OK, test: OK, build: OK } };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    assert.equal(spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, windowsHide: true }).status, 0);
    const child = spawn(process.execPath, ["scripts/devos/run-checks.mjs"], { cwd: dir, stdio: "ignore" });
    const ended = new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? signal)));
    const until = Date.now() + 20000;
    while (!existsSync(pidFile) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(existsSync(pidFile), true, "the check never started");
    child.kill("SIGINT");
    assert.equal(await ended, 130);
    assert.equal(existsSync(path.join(dir, ".devos", "ci-results.json")), false);
    const pid = Number(readFileSync(pidFile, "utf8"));
    const gone = Date.now() + 10000;
    while (alive(pid) && Date.now() < gone) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(alive(pid), false, "the check's child is still running");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
