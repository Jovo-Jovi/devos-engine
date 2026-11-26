// E85e (PR-104): every agent run shows its progress in the run's log, one line a minute, at every stage, whatever the
// tool; an effort a model's name carries is named so. Nothing is posted (D-E18). Each workflow step here runs as written.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { effortLabel } from "../payload/files/scripts/devos/builder-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const windows = process.platform === "win32";
const SCRIPTS = path.join(root, "payload", "files", "scripts", "devos");
const WORKFLOWS = path.join(root, "payload", "files", "dot-github", "workflows");
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
// A minute is a second here.
const FAST = { DEVOS_PROGRESS_EVERY: "1", DEVOS_PROGRESS_UNIT: "1", DEVOS_WATCHDOG_TICK: "1", DEVOS_WATCHDOG_UNIT: "1", DEVOS_REPORT_EVERY: "1" };

function stepRun(file, name) {
  const lines = readFileSync(path.join(WORKFLOWS, file), "utf8").split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(at, -1, `${file}: no step named ${name}`);
  const n = lines.findIndex((line, i) => i > at && /^\s+run: \|$/.test(line));
  const indent = lines[n].indexOf("run:") + 2;
  const body = [];
  for (let i = n + 1; i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) >= indent); i += 1) body.push(lines[i].slice(indent));
  return body.join("\n");
}

function fake(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path.join(dir, name), 0o755);
}

test("progress.test.mjs (a) the line names the stage, tool, model, effort and minutes; an effort in a model's name is said so", { skip: windows && "bash" }, () => {
  assert.deepEqual([
    effortLabel("cursor", "grok-4.7-xhigh", ""),
    effortLabel("cursor", "grok-4.7-low-fast", "low"),
    effortLabel("cursor", "grok-4.7", ""),
    effortLabel("claude", "claude-opus-5-5", "high"),
    effortLabel("codex", "gpt-5.5-codex", "medium"),
    effortLabel("gemini", "gemini-3.8-pro", ""),
    effortLabel("", "grok-4.7", ""),
  ], ["xhigh, from the model name", "low, from the model name", "none: the model name names none", "high", "medium", "none: gemini takes no effort", "none"]);
  const env = { ...process.env, DEVOS_PROGRESS_STAGE: "reviewer", DEVOS_PROGRESS_TOOL: "cursor", DEVOS_PROGRESS_MODEL: "grok-4.7-xhigh", DEVOS_PROGRESS_EFFORT: "" };
  const line = spawnSync("bash", [path.join(SCRIPTS, "progress.sh"), "line", "34", "review file 6 KB"], { encoding: "utf8", env });
  assert.deepEqual([line.status, line.stdout], [0, "reviewer · cursor grok-4.7-xhigh · effort xhigh, from the model name · 34 min · review file 6 KB\n"]);
  const label = spawnSync("bash", [path.join(SCRIPTS, "progress.sh"), "label", "gemini", "gemini-3.8-pro", ""], { encoding: "utf8" });
  assert.equal(label.stdout, "none: gemini takes no effort\n");
  // The evidence pack's review plan names it too (it read "effort ," for a Cursor reviewer).
  assert.match(readFileSync(path.join(SCRIPTS, "evidence.mjs"), "utf8"), /effort \$\{effortLabel\("", plan\.model, plan\.effort\)\}/);
});

// E85f a2: a test "minute" is one second and the clock counts whole seconds, while each line also waits for node to
// start (about half a second on a slow runner). So the test checks each line's shape, and that the minutes go up, but
// not their exact values; with real 60-second minutes the drift is a few seconds an hour.
test("progress.test.mjs (b) the watcher prints a line a minute, and ends at once when it is stopped", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-progress-"));
  try {
    writeFileSync(path.join(dir, "T01-a1.md"), "x".repeat(1500));
    const env = { ...process.env, ...FAST, DEVOS_PROGRESS_STAGE: "reviewer", DEVOS_PROGRESS_TOOL: "codex", DEVOS_PROGRESS_MODEL: "gpt-5.5-codex", DEVOS_PROGRESS_EFFORT: "high" };
    const started = Date.now();
    const run = spawnSync("bash", ["-c", `bash "${path.join(SCRIPTS, "progress.sh")}" watch review "${path.join(dir, "T01-a1.md")}" & w=$!; sleep 3.5; kill "$w"; wait "$w"; echo stopped`], { encoding: "utf8", env });
    assert.ok(Date.now() - started < 7000, "the watcher's sleep ends with it, so nothing holds the output open");
    const lines = run.stdout.trim().split("\n");
    assert.equal(lines.at(-1), "stopped", run.stdout);
    const minutes = lines.slice(0, -1).map((line) => {
      const m = /^reviewer · codex gpt-5\.5-codex · effort high · (\d+) min · review file 2 KB$/.exec(line);
      assert.ok(m, line);
      return Number(m[1]);
    });
    assert.ok(minutes.length >= 2, run.stdout);
    assert.ok(minutes[0] >= 1 && minutes.every((n, i) => i === 0 || n > minutes[i - 1]), run.stdout);
    for (const [kind, file, expected] of [["review", path.join(dir, "none.md"), "no review file yet"], ["answer", path.join(dir, "none.json"), "no answer yet"], ["answer", path.join(dir, "T01-a1.md"), "answer written"], ["running", "", "running"]]) {
      const one = spawnSync("bash", ["-c", `bash "${path.join(SCRIPTS, "progress.sh")}" watch ${kind} "${file}" & w=$!; sleep 2.5; kill "$w"; wait "$w"`], { encoding: "utf8", env });
      assert.match(one.stdout, new RegExp(`^reviewer · codex gpt-5\\.5-codex · effort high · \\d+ min · ${expected}\\n$`, "m"), `${kind} ${file}`);
    }
  } finally {
    cleanup(dir);
  }
});

test("progress.test.mjs (c) the watchdog prints the builder's line every minute and at the end, whatever the tool", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-watchdog-progress-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
    mkdirSync(path.join(dir, ".devos"));
    const fakes = path.join(`${dir}-fakes`);
    // Cursor's CLI is `agent`; Codex's is `codex`. Each edits a file, then works on for a while.
    for (const name of ["agent", "codex"]) fake(fakes, name, "sleep 1; echo a > made.txt; sleep 2; echo done");
    for (const [command, model, tool, effort, label] of [["agent", "grok-4.7-low", "cursor", "low", "low, from the model name"], ["codex", "gpt-5.5-codex", "codex", "medium", "medium"]]) {
      rmSync(path.join(dir, "made.txt"), { force: true });
      const run = spawnSync("bash", [path.join(SCRIPTS, "agent-watchdog.sh"), "30", "10", ".devos/builder.json", ".devos/builder.err", "--", command, "--model", model, "-p", "x"], {
        cwd: dir, encoding: "utf8", env: { ...process.env, ...FAST, PATH: `${fakes}${path.delimiter}${process.env.PATH}`, DEVOS_USAGE_STAGE: "builder", DEVOS_BUILDER_EFFORT: effort },
      });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const lines = run.stdout.trim().split("\n");
      assert.equal(lines[0], `builder · ${tool} ${model} · effort ${label} · 0 min · 1 file(s) changed`);
      assert.ok(lines.length >= 3, run.stdout);
      assert.match(lines.at(-1), new RegExp(`^builder · ${tool} ${model.replaceAll(".", "\\.")} · effort ${label} · \\d+ min · ✅ builder finished \\(exit 0\\) — next: checks and review · 2 file\\(s\\) changed$`));
      assert.equal(lines.every((line) => line.startsWith(`builder · ${tool} ${model} · effort ${label} · `)), true, run.stdout);
    }
  } finally {
    cleanup(dir);
    cleanup(`${dir}-fakes`);
  }
});

test("progress.test.mjs (d) the work job and the review job leave the progress to the runners: no loop of their own", () => {
  const work = stepRun("devos-work.yml", "Builder (the project's builder agent)");
  assert.equal(work.includes("Cursor is working"), false);
  assert.equal(/\bhb=\$!|kill "\$hb"/.test(work), false);
  const review = readFileSync(path.join(WORKFLOWS, "devos-review.yml"), "utf8");
  assert.equal(review.includes("sleep 300"), false);
  assert.equal(review.includes('export DEVOS_PROGRESS_FILE="docs/reviews/$TASK-a$ATTEMPT.md"'), true);
});

test("progress.test.mjs (e) the supervisor's second opinion prints its line every minute, run as written; the doctor's the same", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-second-opinion-"));
  try {
    const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const configPath = path.join(dir, "devos.config.json");
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    cfg.agents = { reviewer: { id: "rev", tool: "claude", model: "claude-opus-5-5", effort: "high", gate_effort: "high", light_effort: "high" },
      pool: [{ id: "b", tool: "cursor", model: "grok-4.7", default: true, note: "default builder", effort: "fence" }], policy: "always-default", raise_on_retry: false };
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    mkdirSync(path.join(dir, ".devos", "supervisor"), { recursive: true });
    // review-user.sh's user and sandbox need root; here it runs the command in the workspace it names.
    writeFileSync(path.join(dir, "scripts", "devos", "review-user.sh"), '#!/usr/bin/env bash\ncase "$1" in run) cd "$2" && shift 3 && exec "$@" ;; *) exit 0 ;; esac\n');
    const fakes = path.join(dir, "fakes");
    // E85f a2: long enough for two lines when each line also waits for node to start on a slow runner.
    fake(fakes, "claude", 'sleep 4.5; echo \'{"type":"result","is_error":false,"structured_output":{"incidents":[]}}\'');
    const RW = path.join(dir, "rw");
    mkdirSync(RW);
    const started = Date.now();
    const run = spawnSync("bash", ["-e", "-c", stepRun("devos-supervisor.yml", "Diagnose — Claude Code (read-only, its own user)")], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, ...FAST, PATH: `${fakes}${path.delimiter}${process.env.PATH}`, OAUTH: "o", APIKEY: "", RW, DEVOS_SCRIPTS: path.join(dir, "scripts", "devos"), GITHUB_STEP_SUMMARY: path.join(dir, "summary.md") },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(Date.now() - started < 15000, "the step ends with its second opinion");
    const lines = run.stdout.split("\n").filter((line) => line.startsWith("supervisor · "));
    assert.ok(lines.length >= 2, run.stdout);
    assert.equal(lines[0], "supervisor · claude claude-opus-5-5 · effort high · 1 min · running");
    assert.equal(JSON.parse(readFileSync(path.join(dir, ".devos", "supervisor", "claude.json"), "utf8")).type, "result");
    const doctor = stepRun("devos-doctor.yml", "Second opinion — Claude Code (read-only, its own user, no shell)");
    assert.equal(doctor.includes('DEVOS_PROGRESS_STAGE=doctor DEVOS_PROGRESS_TOOL=claude DEVOS_PROGRESS_MODEL="$MODEL" DEVOS_PROGRESS_EFFORT="$EFFORT" \\\n  bash scripts/devos/progress.sh watch running & watcher=$!'), true);
    assert.equal(doctor.includes('kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true'), true);
    assert.equal(existsSync(path.join(dir, ".devos", "progress-comment")), false);
  } finally {
    cleanup(dir);
  }
});
