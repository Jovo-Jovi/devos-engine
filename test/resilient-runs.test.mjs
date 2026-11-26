// E85e (PR-104): a GitHub server error is tried again instead of stopping a run: main's stand-in for gh in publish and
// advance (gh-retry.sh), and the supervisor's rules read GitHub's own wording. Every workflow step here is run as written.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const SCRIPTS = path.join(root, "payload", "files", "scripts", "devos");
const WORKFLOWS = path.join(root, "payload", "files", "dot-github", "workflows");
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

/** A step's `run:` script, as written in its workflow: a block (`run: |`) or one line. */
function stepRun(file, name) {
  const lines = readFileSync(path.join(WORKFLOWS, file), "utf8").split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(at, -1, `${file}: no step named ${name}`);
  const n = lines.findIndex((line, i) => i > at && /^\s+run: /.test(line));
  const inline = lines[n].replace(/^\s+run: /, "");
  if (inline !== "|") return { at, script: inline };
  const indent = lines[n].indexOf("run:") + 2;
  const body = [];
  for (let i = n + 1; i < lines.length && (lines[i].trim() === "" || lines[i].search(/\S/) >= indent); i += 1) body.push(lines[i].slice(indent));
  return { at, script: body.join("\n") };
}

// A fake gh: counts its calls in GH_COUNT, logs them in GH_LOG, and answers by its first two arguments.
function fakeGh(dir) {
  const bin = path.join(dir, "real");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "gh"), [
    "#!/usr/bin/env bash",
    'n=$(( $(cat "$GH_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$GH_COUNT"',
    'echo "$*" >> "$GH_LOG"',
    'case "$1 $2" in',
    '  "api flaky") [ "$n" -le 2 ] && { echo "HTTP 502: Bad Gateway (https://api.github.com/repos/o/r/flaky)" >&2; exit 1; }; echo "ok on try $n" ;;',
    '  "api missing") echo "HTTP 404: Not Found (https://api.github.com/repos/o/r/missing)" >&2; exit 1 ;;',
    '  "api down") echo "HTTP 503: Service Unavailable" >&2; exit 1 ;;',
    '  "api input") [ "$n" -le 1 ] && { cat > /dev/null; echo "HTTP 503: Service Unavailable" >&2; exit 1; }; echo "read $(cat)" ;;',
    '  "pr create") echo "HTTP 502: Bad Gateway" >&2; exit 1 ;;',
    '  "pr list") echo "https://github.com/o/r/pull/7" ;;',
    '  *) echo "gh $*" ;;',
    "esac",
    "",
  ].join("\n"));
  chmodSync(path.join(bin, "gh"), 0o755);
  return bin;
}

function installed(dir) {
  const real = fakeGh(dir);
  const env = { ...process.env, PATH: `${real}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: path.join(dir, "rt"), GITHUB_PATH: path.join(dir, "github-path"), GH_COUNT: path.join(dir, "count"), GH_LOG: path.join(dir, "log"), DEVOS_GH_RETRY_WAIT: "0 0 0" };
  const r = spawnSync("bash", [path.join(SCRIPTS, "gh-retry.sh"), "install"], { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const stand = readFileSync(env.GITHUB_PATH, "utf8").trim();
  return { env: { ...env, PATH: `${stand}${path.delimiter}${env.PATH}` }, gh: path.join(stand, "gh") };
}

test("resilient-runs.test.mjs (a) the stand-in tries a GitHub server error again, never a 4xx, and keeps its answer and input", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-gh-retry-"));
  try {
    const { env } = installed(dir);
    const gh = (args, extra = {}) => {
      rmSync(env.GH_COUNT, { force: true });
      const r = spawnSync("bash", ["-c", `gh ${args}`], { encoding: "utf8", env, ...extra });
      return { ...r, calls: Number(readFileSync(env.GH_COUNT, "utf8")) };
    };
    const flaky = gh("api flaky");
    assert.deepEqual([flaky.status, flaky.stdout, flaky.calls], [0, "ok on try 3\n", 3]);
    assert.deepEqual(flaky.stderr.trim().split("\n"), [
      "gh-retry: GitHub answered 'HTTP 502' to gh api flaky; trying again in 0 s (1 of 3)",
      "gh-retry: GitHub answered 'HTTP 502' to gh api flaky; trying again in 0 s (2 of 3)",
    ]);
    const missing = gh("api missing");
    assert.deepEqual([missing.status, missing.stdout, missing.stderr, missing.calls], [1, "", "HTTP 404: Not Found (https://api.github.com/repos/o/r/missing)\n", 1]);
    const down = gh("api down");
    assert.deepEqual([down.status, down.calls], [1, 4]);
    assert.match(down.stderr, /\(3 of 3\)\nHTTP 503: Service Unavailable\n$/);
    const input = gh("api input --input -", { input: "the body" });
    assert.deepEqual([input.status, input.stdout, input.calls], [0, "read the body\n", 2]);
    const made = gh("pr create --repo o/r --base main --head task/T01 --title T01");
    assert.deepEqual([made.status, made.stdout, made.calls], [0, "https://github.com/o/r/pull/7\n", 2]);
    assert.match(made.stderr, /the pull request was made by the try that failed: https:\/\/github\.com\/o\/r\/pull\/7/);
    assert.deepEqual(readFileSync(env.GH_LOG, "utf8").trim().split("\n").slice(-2), ["pr create --repo o/r --base main --head task/T01 --title T01", "pr list --repo o/r --head task/T01 --state open --json url --jq .[0].url // empty"]);
    // gh reads no input unless told to, so a loop that feeds itself from standard input keeps every line.
    const loop = spawnSync("bash", ["-c", "printf 'a\\nb\\nc\\n' | while read -r x; do gh api item \"$x\"; done"], { encoding: "utf8", env });
    assert.equal(loop.stdout, "gh api item a\ngh api item b\ngh api item c\n");
  } finally {
    cleanup(dir);
  }
});

test("resilient-runs.test.mjs (b) publish and advance install the stand-in first, as written, before any other GitHub call", { skip: windows && "bash" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-gh-install-"));
  try {
    const real = fakeGh(dir);
    for (const [file, cwd, env] of [
      ["devos-cycle.yml", dir, { T: SCRIPTS }],
      ["devos-advance.yml", path.join(root, "payload", "files"), {}],
    ]) {
      const step = stepRun(file, "Retry GitHub's server errors");
      const temp = path.join(dir, file);
      const r = spawnSync("bash", ["-e", "-c", step.script], { cwd, encoding: "utf8", env: { ...process.env, ...env, PATH: `${real}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_PATH: path.join(dir, `${file}.path`), GH_COUNT: path.join(dir, "count"), GH_LOG: path.join(dir, "log") } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(path.join(dir, `${file}.path`), "utf8"), `${path.join(temp, "devos-gh")}\n`);
      assert.equal(readFileSync(path.join(temp, "devos-gh", "real"), "utf8").trim(), path.join(real, "gh"));
      assert.equal(existsSync(path.join(temp, "devos-gh", "gh")), true);
      // Nothing before it in its job calls gh.
      const lines = readFileSync(path.join(WORKFLOWS, file), "utf8").split("\n");
      const job = lines.slice(0, step.at).findLastIndex((line) => /^ {2}[a-z][a-z-]*:$/.test(line));
      assert.equal(lines.slice(job, step.at).some((line) => /\bgh (api|pr|run|issue|label|workflow)\b/.test(line)), false, file);
    }
    assert.equal(stepRun("devos-cycle.yml", "Retry GitHub's server errors").script, 'bash "$T/gh-retry.sh" install');
    assert.equal(stepRun("devos-advance.yml", "Retry GitHub's server errors").script, "bash scripts/devos/gh-retry.sh install");
  } finally {
    cleanup(dir);
  }
});

// The supervisor, on a staged project with a stand-in gh that answers from a map.
function supervised(map) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-github-5xx-"));
  assert.equal(spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], { encoding: "utf8", windowsHide: true }).status, 0);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir, windowsHide: true }).status, 0);
  const project = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8").replaceAll("__PROJECT_KEY__", "DEMO");
  writeFileSync(path.join(dir, "devos", "project.json"), project);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const bin = path.join(dir, "fake-bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "map.json"), JSON.stringify(map));
  writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(${JSON.stringify(path.join(bin, "calls.jsonl"))}, JSON.stringify(process.argv.slice(2)) + "\\n");
const map = require(${JSON.stringify(path.join(bin, "map.json"))});
const key = process.argv.slice(2).join(" ");
const hit = Object.keys(map).find((k) => key.startsWith(k));
if (hit === undefined) process.exit(1);
process.stdout.write(typeof map[hit] === "string" ? map[hit] : JSON.stringify(map[hit]));
`);
  chmodSync(path.join(bin, "gh"), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, REPO: "devtest/demo", GH_TOKEN: "t" };
  const sup = (args) => {
    const r = spawnSync(process.execPath, ["scripts/devos/supervisor.mjs", ...args], { cwd: dir, encoding: "utf8", env, windowsHide: true });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout;
  };
  return { dir, bin, sup };
}

test("resilient-runs.test.mjs (c) the supervisor re-runs a cycle run GitHub's server error stopped, and explains a red main's missing lockfile with no AI", { skip: windows && "a stand-in gh" }, () => {
  const R = "repos/devtest/demo";
  const run = (id, title, conclusion = "failure") => ({ id, display_title: title, status: "completed", conclusion, created_at: "2026-11-26T11:00:00Z", updated_at: "2026-11-26T11:40:00Z", html_url: `https://github.com/devtest/demo/actions/runs/${id}` });
  const failed = (id, job, step) => ({ jobs: [{ id, name: job, conclusion: "failure", steps: [{ name: step, conclusion: "failure" }] }] });
  const s = supervised({
    // learn-coptic's T01 a2 (run 45804169238): the review passed, then publish's pull request call met an HTTP 502.
    [`api ${R}/actions/runs/201/jobs`]: failed(7201, "publish", "Open the pull request"),
    [`api ${R}/actions/runs/201`]: run(201, "devos T01 · attempt 2"),
    "run view 201 --repo devtest/demo --log-failed": "publish\tOpen the pull request\tHTTP 502: Bad Gateway (https://api.github.com/graphql)\n##[error]Process completed with exit code 1.\n",
    // learn-coptic's main: pnpm finds no lockfile.
    [`api ${R}/actions/runs/202/jobs`]: failed(7202, "checks", "Install"),
    [`api ${R}/actions/runs/202`]: run(202, "ci"),
    "run view 202 --repo devtest/demo --log-failed": "checks\tInstall\t ERR_PNPM_NO_LOCKFILE  Cannot install with \"frozen-lockfile\" because pnpm-lock.yaml is absent\n",
    // A GitHub server error on main's checks is an outside failure: re-run.
    [`api ${R}/actions/runs/203/jobs`]: failed(7203, "checks", "Upload"),
    [`api ${R}/actions/runs/203`]: run(203, "ci"),
    "run view 203 --repo devtest/demo --log-failed": "checks\tUpload\tHTTP 503: Service Unavailable\n",
    "api repos/devtest/demo/issues?labels=": [{ number: 50 }],
    "api repos/devtest/demo/issues/50/comments --paginate": [[]],
    "api repos/devtest/demo/issues/50/comments -f": {},
  });
  try {
    const classify = (args) => s.sup(["classify", ...args]).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(classify(["--run", "201"]), [{ kind: "runner-failure", task: "T01", attempt: 2, step: "Open the pull request", key: "T01:a2:github-5xx:Open the pull request",
      cause: "GitHub answered with a server error (HTTP 502) in \"Open the pull request\"; the failed jobs run again, and the review is kept", action: "rerun-failed", rescue: null, review_only: false }]);
    const red = classify(["--run", "202", "--workflow", "ci"]);
    assert.equal(red.length, 1);
    assert.deepEqual([red[0].kind, red[0].key, red[0].action], ["main-failure", "main:ci:202", "report"]);
    assert.equal(red[0].cause, "the checks on main stop at install: the package manager they use finds no lockfile in the repository (ERR_PNPM_NO_LOCKFILE). This is set-up, not code");
    assert.match(red[0].owner_steps, /^- If an open task adds the lockfile, its merge makes main green: nothing to do\.\n- Otherwise commit the lockfile/);
    assert.deepEqual(classify(["--run", "203", "--workflow", "ci"]).map((i) => [i.key, i.action]), [["main:ci:203", "rerun-failed"]]);
    // The act: the steps are posted, nothing is re-run, and no AI is asked.
    const sup = path.join(s.dir, ".devos", "supervisor");
    mkdirSync(sup, { recursive: true });
    writeFileSync(path.join(sup, "facts.json"), JSON.stringify({ task_prs: [], active: [] }));
    writeFileSync(path.join(sup, "incidents.json"), JSON.stringify([{ id: "main-failure-x-1", attempt: 0, task: "", url: "https://github.com/devtest/demo/actions/runs/202", ...red[0] }]));
    s.sup(["act", "--issue", "50"]);
    const calls = readFileSync(path.join(s.bin, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.some((c) => c[0] === "run" && c[1] === "rerun"), false);
    const body = calls.filter((c) => c.includes("-f")).map((c) => c.find((a) => a.startsWith("body=")).slice(5)).pop();
    for (const part of ["### 🟡 Dev OS supervisor · — · main-failure", "**What happened:** the checks on main stop at install", "**What I did:** nothing re-run and no AI asked: this is set-up, not code (the steps below)", "**Steps for you:**\n- If an open task adds the lockfile"]) {
      assert.equal(body.includes(part), true, part);
    }
  } finally {
    cleanup(s.dir);
  }
});
