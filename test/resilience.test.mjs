import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptanceText, lastAttempt } from "../payload/files/scripts/devos/accept.mjs";
import { looksLikeServerError, serverError } from "../payload/files/scripts/devos/limits.mjs";

// E61 (PR-87): the cycle's resilience. `/devos accept` records the owner's acceptance of a task that stopped without a
// PASS and ticks its row, and a task merged by hand without one is not built again; the settled and reduced-motion
// screenshots are taken at 2×; a temporary server error runs the same agent again, three times with a growing wait.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const skipWindows = process.platform === "win32";
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const PAYLOAD = "payload/files";

// An installed project (devos install): the runner scripts, its guards and a generated devos.config.json, in git.
function staged(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  mkdirSync(path.join(dir, ".devos"), { recursive: true });
  return dir;
}

function repo(dir) {
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
  for (const args of [["init", "-q"], ["config", "user.email", "devos@example.com"], ["config", "user.name", "devos"], ["config", "core.autocrlf", "false"], ["config", "gc.auto", "0"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
    const result = git(args);
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  }
  return git;
}

const TABLE = "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |\n|---|---|---|---|---|---|---|---|\n";
function phases(dir, rows) {
  mkdirSync(path.join(dir, "docs", "reviews"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "PHASES.md"), `# Phases\n\n${TABLE}${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n`);
}

test("resilience.test.mjs (a) /devos accept records the owner's acceptance as the next attempt and ticks the row, and guard:phases passes", () => {
  const dir = staged("devos-accept-");
  try {
    phases(dir, [
      ["T01", "P01", "J1", "Setup", "1", "—", "[x]", "PASS a1 — docs/reviews/T01-a1.md"],
      ["T02", "P01", "J1", "Showcase", "2", "G-Show", "[ ]", "FAIL a3 — docs/reviews/T02-a3.md"],
      ["T03", "P01", "J1", "Next", "2", "—", "[ ]", "—"],
    ]);
    writeFileSync(path.join(dir, "docs", "reviews", "T01-a1.md"), "VERDICT: PASS\n");
    for (const n of [1, 2, 3]) writeFileSync(path.join(dir, "docs", "reviews", `T02-a${n}.md`), "VERDICT: FAIL\n\nThe badge covers the produce.\n");
    const git = repo(dir);
    const accept = (args, env = {}) => spawnSync(process.execPath, ["scripts/devos/accept.mjs", ...args], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: "", ...env } });
    writeFileSync(path.join(dir, ".devos", "note.md"), " \nThe badge overlap moves to T03.\n\nCaptures are fine.\n\n");
    const done = accept(["--task", "T02", "--by", "Jovo-Jovi", "--pr", "25", "--note-file", ".devos/note.md", "--date", "2026-11-08"]);
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.equal(done.stdout, "attempt=4\nreview=docs/reviews/T02-a4.md\n");
    assert.equal(readFileSync(path.join(dir, "docs", "reviews", "T02-a4.md"), "utf8"), [
      "VERDICT: PASS",
      "",
      "T02 · accepted by @Jovo-Jovi with `/devos accept` on #25 · 2026-11-08 · attempt 4 was not built or reviewed",
      "",
      "This file records the owner's decision, not a review (PR-87). The task stopped at attempt 3 without a PASS (`docs/reviews/T02-a3.md`: VERDICT: FAIL), and the owner accepted what its branch holds.",
      "",
      "The owner's note:",
      "",
      "> The badge overlap moves to T03.",
      ">",
      "> Captures are fine.",
      "",
      "Whatever the last review left open stays open: a change request or a later task takes it up.",
      "",
    ].join("\n"));
    assert.match(readFileSync(path.join(dir, "docs", "PHASES.md"), "utf8"), /^\| T02 \| P01 \| J1 \| Showcase \| 2 \| G-Show \| \[x\] \| PASS a4 — docs\/reviews\/T02-a4\.md \|$/m);
    const guards = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.match(guards.stdout, /guard:phases\s+PASS\s+\(3 tasks, 2 PASS\)/);
    const next = spawnSync(process.execPath, ["scripts/devos/next-task.mjs"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GITHUB_OUTPUT: "" } });
    assert.match(next.stdout, /^task=T03$/m);

    const refused = (args) => {
      const result = accept(args);
      return [result.status, result.stderr.trim()];
    };
    assert.deepEqual(refused(["--task", "T02", "--by", "Jovo-Jovi"]), [1, "DEVOS: T02 is already ticked (PASS a4 — docs/reviews/T02-a4.md); there is nothing to accept"]);
    assert.deepEqual(refused(["--task", "T09", "--by", "Jovo-Jovi"]), [1, "DEVOS: T09 is not in docs/PHASES.md"]);
    assert.deepEqual(refused(["--task", "T03", "--by", "bad login!"]), [1, "DEVOS: \"bad login!\" is not a GitHub login"]);
    assert.deepEqual(refused(["--task", "3", "--by", "Jovo-Jovi"]), [1, "DEVOS: usage: accept.mjs --task Tnn --by <login> [--pr <n>] [--note-file <file>]"]);
    phases(dir, [
      ["T01", "P01", "J1", "Setup", "1", "—", "[ ]", "—"],
      ["T02", "P01", "J1", "Showcase", "2", "—", "[ ]", "—"],
    ]);
    assert.deepEqual(refused(["--task", "T02", "--by", "Jovo-Jovi"]), [1, "DEVOS: T01 is still open before T02: tasks are accepted in order (guard:phases), so accept or finish T01 first"]);
    // A runner commit counts as an attempt, as /devos revise counts it.
    git(["commit", "-q", "--allow-empty", "-m", "T01 a5: builder (grok-4.7-high, effort high, fast no)"]);
    const counted = accept(["--task", "T01", "--by", "owner", "--date", "2026-11-08"]);
    assert.equal(counted.stdout, "attempt=6\nreview=docs/reviews/T01-a6.md\n", counted.stderr);
    assert.match(readFileSync(path.join(dir, "docs", "reviews", "T01-a6.md"), "utf8"), /stopped at attempt 5 without a PASS, with no review file on this branch, and the owner accepted what its branch holds\.\n\nThe owner gave no note\.\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  assert.equal(lastAttempt("T07", ["T07-a1.md", "T07-a2.md", "T17-a9.md", "T07-a10.txt"], ["T07 a3: builder", "T070 a9: x", "T07 a12 builder"]), 3);
  assert.match(acceptanceText({ task: "T01", attempt: 1, by: "o", date: "2026-11-08", previous: null }), /No attempt of this task was built by DEV_OS; the owner accepted the work as it is\./);
});

test("resilience.test.mjs (b) the comment, the job that commits it, and a merge by hand that never builds the task again (PR-87)", () => {
  const intake = read(`${PAYLOAD}/dot-github/workflows/devos-intake.yml`);
  const job = intake.slice(intake.indexOf("\n  accept:\n"));
  for (const text of [
    "startsWith(github.event.comment.body, '/devos accept')",
    "contains(fromJSON('[\"OWNER\",\"MEMBER\",\"COLLABORATOR\"]'), github.event.comment.author_association)",
    "OPEN) branch=\"$ref\"; base=\"$ref\" ;;",
    "MERGED) branch=\"devos/accept-$task\"; base=main ;;",
    "printf '%s\\n' \"${NOTE#/devos accept}\" > .devos/accept-note.md",
    "node scripts/devos/accept.mjs --task \"$TASK\" --by \"$BY\" --pr \"$PR\" --note-file .devos/accept-note.md",
    "git add \"docs/reviews/$TASK-a$ATTEMPT.md\" docs/PHASES.md",
    "git commit -q -m \"$TASK a$ATTEMPT: accepted by @$BY (/devos accept, PR-87)\"",
    "bash scripts/devos/sync-main.sh \"$remote\" || exit 1",
    "gh pr create --repo \"$REPO\" --base main --head \"$BR\" --title \"Dev OS: $TASK accepted by @$BY\" --body-file .devos/accept-body.md --label devos",
    "Merge this PR: the cycle then starts the next task.",
  ]) {
    assert.equal(job.includes(text), true, text);
  }
  // The comment's text reaches the shell only through the environment, never inside the script.
  assert.deepEqual(job.split("\n").filter((line) => line.includes("github.event.comment.body")).map((line) => line.trim()), [
    "startsWith(github.event.comment.body, '/devos accept') &&",
    "NOTE: ${{ github.event.comment.body }}",
  ]);
  assert.equal(job.includes("git push --force"), false);
  assert.equal(intake.includes("#   Accept:    comment \"/devos accept [note]\" on a task PR (task/Tnn) that stopped without a PASS"), true);
  assert.equal(read(`${PAYLOAD}/scripts/devos/verdict.mjs`).includes("stopped at its last attempt: comment \\`/devos revise <what to change>\\` on this PR for another attempt, or \\`/devos accept [note]\\` to accept it as it is (PR-87)"), true);

  const advance = read(`${PAYLOAD}/dot-github/workflows/devos-advance.yml`);
  assert.equal(advance.includes("startsWith(github.event.pull_request.head.ref, 'devos/accept-')) &&"), true);
  assert.equal(advance.includes("if [ \"$task\" != \"$HEAD\" ] && [ -n \"$next\" ] && [ \"$next\" = \"$task\" ]; then"), true);
  assert.equal(advance.includes("so the cycle does not build it again (PR-87). Comment \\`/devos accept\\` here to record your acceptance"), true);
  assert.ok(advance.indexOf("[ \"$next\" = \"$task\" ]") < advance.indexOf("gh workflow run devos-cycle.yml --repo \"$REPO\" --ref main -f task=\"$next\" -f attempt=1"));
});

test("resilience.test.mjs (c) a temporary server error is read from the CLI's own error only, and the waits grow", { skip: skipWindows }, () => {
  assert.equal(looksLikeServerError("Error: Request failed with status code 502"), true);
  assert.equal(looksLikeServerError("[unavailable] upstream error (retriable)"), true);
  assert.equal(looksLikeServerError("{\"retryable\":true}"), true);
  for (const text of ["non-retriable error", "not retriable", "\"retriable\": false", "You've hit your usage limit", "error code 429", "Cannot use this model: grok-9"]) {
    assert.equal(looksLikeServerError(text), false, text);
  }
  assert.equal(serverError("", "502 Bad Gateway", "1"), true);
  assert.equal(serverError("{\"type\":\"result\",\"is_error\":true,\"result\":\"API Error: 500 Internal server error\"}", "", "1"), true);
  assert.equal(serverError("{\"type\":\"assistant\",\"text\":\"the page answers 502 Bad Gateway\"}", "", "1"), false);
  assert.equal(serverError("{\"type\":\"result\",\"result\":\"fixed the 502\"}", "", "0"), false);
  assert.equal(serverError("", "read ECONNRESET", "125"), false);
  const dir = staged("devos-server-check-");
  try {
    const check = (out, err, exit) => {
      writeFileSync(path.join(dir, ".devos", "out.json"), out);
      writeFileSync(path.join(dir, ".devos", "out.err"), err);
      return spawnSync(process.execPath, ["scripts/devos/limit-check.mjs", "--server", "--json", ".devos/out.json", "--err", ".devos/out.err", "--exit", exit], { cwd: dir, windowsHide: true }).status;
    };
    assert.equal(check("", "HTTP 503 Service Unavailable", "1"), 0);
    assert.equal(check("", "You've hit your usage limit", "1"), 1);
    const waits = spawnSync("bash", ["-c", ". scripts/devos/accounts.sh; for n in 0 1 2 3; do devos_server_wait $n || echo none; done; DEVOS_SERVER_WAIT=0 devos_server_wait 2"], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(waits.stdout, "30\n60\n120\nnone\n0\n");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// A stand-in Codex that answers a 502 the first `fails` times it runs, then finishes.
function flakyCodex(dir, fails) {
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "codex"), [
    "#!/bin/sh",
    "prev=''; last=''",
    "for arg in \"$@\"; do",
    "  if [ \"$prev\" = '-o' ]; then last=$arg; fi",
    "  prev=$arg",
    "done",
    "echo run >> \"$DEVOS_SEEN\"",
    `if [ "$(wc -l < "$DEVOS_SEEN")" -le ${fails} ]; then echo 'stream error: unexpected status 502 Bad Gateway' >&2; exit 1; fi`,
    "printf '%s\\n' DONE > \"$last\"; exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  return binDir;
}

function runAgent(dir, binDir, role) {
  writeFileSync(path.join(dir, ".devos", `${role}-prompt.md`), "go\n");
  return spawnSync("bash", ["scripts/devos/run-agent.sh", role, "codex", "M1", "high", `.devos/${role}-prompt.md`], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`, CODEX_KEY_1: "k1", DEVOS_WATCHDOG_TICK: "1", DEVOS_SERVER_WAIT: "0", DEVOS_SEEN: path.join(dir, "seen.txt") },
  });
}

test("resilience.test.mjs (d) a builder run that meets a 502 runs again in place and finishes; a review stops after three retries", { skip: skipWindows }, () => {
  const dir = staged("devos-server-run-");
  try {
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Reviewer\n");
    repo(dir);
    const built = runAgent(dir, flakyCodex(dir, 2), "builder");
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    assert.equal(readFileSync(path.join(dir, "seen.txt"), "utf8"), "run\nrun\nrun\n");
    assert.match(readFileSync(path.join(dir, ".devos", "builder-run.env"), "utf8"), /^code=0$/m);
    const notes = readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8");
    assert.match(notes, /Builder: the Codex CLI stopped on a temporary server error; trying again in 0 s \(1 of 3\)\./);
    assert.match(notes, /Builder: the Codex CLI stopped on a temporary server error; trying again in 0 s \(2 of 3\)\./);
    assert.match(readFileSync(path.join(dir, ".devos", "builder-prompt.md"), "utf8"), /An earlier run of this attempt stopped on a temporary server error\./);

    rmSync(path.join(dir, "seen.txt"));
    rmSync(path.join(dir, ".devos", "accounts.md"));
    const reviewed = runAgent(dir, flakyCodex(dir, 9), "reviewer");
    assert.equal(reviewed.status, 0, `${reviewed.stdout}\n${reviewed.stderr}`);
    assert.equal(readFileSync(path.join(dir, "seen.txt"), "utf8"), "run\nrun\nrun\nrun\n");
    assert.match(readFileSync(path.join(dir, ".devos", "reviewer-run.env"), "utf8"), /^code=1$/m);
    assert.match(readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8"), /Reviewer: the Codex CLI stopped on a temporary server error; trying again in 0 s \(3 of 3\)\./);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("resilience.test.mjs (e) every builder, review and planning run of the cycle tries again on a server error before its other checks", () => {
  const count = (text, part) => text.split(part).length - 1;
  const cycle = read(`${PAYLOAD}/dot-github/workflows/devos-cycle.yml`);
  assert.equal(count(cycle, "pause=$(devos_server_wait \"$tries\")"), 4);
  assert.equal(count(cycle, "devos_server_error .devos/builder.json .devos/builder.err \"$code\""), 2);
  assert.equal(count(cycle, "devos_server_error .devos/reviewer.json .devos/reviewer.err \"$rc\""), 2);
  assert.ok(cycle.indexOf("devos_server_error .devos/builder.json") < cycle.indexOf("devos_limited .devos/builder.json"));
  assert.ok(cycle.indexOf("devos_server_error .devos/reviewer.json") < cycle.indexOf("devos_limited .devos/reviewer.json"));
  assert.equal(count(read(`${PAYLOAD}/scripts/devos/run-agent.sh`), "pause=$(devos_server_wait \"$tries\")"), 2);
  assert.equal(count(read(`${PAYLOAD}/scripts/devos/plan-agent.sh`), "pause=$(devos_server_wait \"$tries\")"), 1);
  assert.equal(read(`${PAYLOAD}/scripts/devos/accounts.sh`).includes("devos_server_error() { node scripts/devos/limit-check.mjs --server"), true);
});

test("resilience.test.mjs (f) the screenshots are at 2×, and the prompts, the method and the changelog say so (PR-87)", () => {
  const screens = read(`${PAYLOAD}/scripts/devos/screens.mjs`);
  assert.equal(screens.includes("export const SCALE = 2;"), true);
  assert.equal(screens.includes("    deviceScaleFactor: SCALE,\n"), true);
  assert.equal(screens.includes("filmstrip_ms: filmstripMs, screenshot_scale: SCALE, errors, captures };"), true);
  assert.equal(read(`${PAYLOAD}/scripts/devos/screens.test.mjs`).includes("test(\"the screenshots are taken at 2× and the filmstrip at 1×, and the summary says so (PR-87)\""), true);
  assert.equal(read(`${PAYLOAD}/devos/prompts/reviewer.md`).includes("The two screenshots are at 2× (PR-87): halve a length you read off one for CSS pixels."), true);
  assert.equal(read(`${PAYLOAD}/dot-cursor/skills/devos-compose-ui/SKILL.md`).includes("the settled and reduced-motion screenshots at\n   2× (PR-87)"), true);
  const precedents = read(`${PAYLOAD}/docs/method/PRECEDENTS.md`);
  assert.equal(precedents.includes("| PR-87 | **A stopped task is accepted by the owner's word, a screenshot is read at 2×, and a server's hiccup is not a failure.**"), true);
  const manual = read(`${PAYLOAD}/docs/method/AUTOMATION.md`);
  for (const text of ["| `accept.mjs` |", "`/devos accept [note]`", "devos_server_wait"]) assert.equal(manual.includes(text), true, text);
  const changes = read("CHANGELOG.md");
  for (const line of ["- **`/devos accept` (PR-87).**", "- **Screenshots at 2×.**", "- **A temporary server error is tried again.**"]) assert.equal(changes.includes(line), true, line);
  assert.equal(existsSync(path.join(root, PAYLOAD, "scripts", "devos", "accept.mjs")), true);
});
