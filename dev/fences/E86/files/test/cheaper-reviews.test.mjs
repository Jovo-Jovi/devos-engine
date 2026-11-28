// E85f (PR-105): cheaper reviews and builds. A task's topics come from its fence's own words; the builder and the
// reviewer read only the required skill files whole; a later attempt's review starts from the diff since the last one;
// and publish says what each attempt used. Each case runs the code the cycle runs: skills.mjs and render-prompt.mjs as
// the prompts are rendered, main's review-tree on a branch with a review commit, and publish's step's own script.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { giveAgents, chosenAgents } from "./chosen-agents.mjs";
import { attemptLine } from "../payload/files/scripts/devos/usage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const PAYLOAD = path.join(root, "payload", "files");
const windows = process.platform === "win32";
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const write = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); };

// Each cause of learn-coptic T01's false topics, in a fence of its own kind: file names, paths, code, header lines, a
// Do NOT section and lines that forbid. What the task is about: a lockfile, and how the site deploys.
const FENCE = `## T01 — The checks run on the code as it is

- Phase: P01 · Risk: 3 · Gate: G-Checks
- Layers: ops · testing
- Paths: \`package.json\` · \`pnpm-lock.yaml\` · \`docs/session-context.md\`
- Dependencies: none

### Context to read first

- \`docs/SESSION_CONTEXT.md\` and SESSION_CONTEXT.md, then .cursor/** and src/app/**.

### What this task is

The checks cannot run: pnpm needs a lockfile, and the Vercel deploy keeps npm. Work from a fresh checkout of the branch.

\`\`\`bash
pnpm install --frozen-lockfile   # the session cookie, the tenant workspace
\`\`\`

Keep the scripts; do not add Playwright or a pnpm-workspace.yaml.
Do not change \`next.config.ts\` (its security headers stay).

### Do NOT

- Add a cursor-based pagination or a payment checkout page.

### Done when

- D1 the lint check passes.
`;

function project(rowText) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-cheaper-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  giveAgents(dir);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  const phases = path.join(dir, "docs", "PHASES.md");
  writeFileSync(phases, readFileSync(phases, "utf8").replace("| T01 | P1 | S1 | First task | 1 | — | [ ] | — |", rowText));
  write(dir, "docs/fences/T01.md", FENCE);
  return dir;
}
const node = (dir, args, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, DEVOS_REVIEW_MODE: "", ...env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};

test("cheaper-reviews.test.mjs (a) a fence's topics come from what it is about, never from its code, paths, file names, header lines or what it forbids", async () => {
  const { fenceTopics, ownWords } = await import("../payload/files/scripts/devos/skills.mjs");
  const topics = JSON.parse(read(path.join(PAYLOAD, "devos", "skills", "manifest.json"))).topics;
  // The rule before E85f, a topic's words anywhere in the fence: the false topics T01 got.
  const anywhere = Object.keys(topics).filter((name) => new RegExp(topics[name].match, "i").test(FENCE));
  for (const name of ["session", "tenant", "payment", "pagination", "headers", "e2e"]) assert.ok(anywhere.includes(name), name);
  assert.deepEqual(Object.keys(fenceTopics(FENCE, topics)), ["deploy", "dependencies"]);
  assert.deepEqual(fenceTopics(FENCE, topics).dependencies, 'the fence says "lockfile"');
  const own = ownWords(FENCE);
  for (const gone of ["SESSION_CONTEXT", "session-context", ".cursor", "pnpm-workspace", "Playwright", "security headers", "cookie", "pagination", "Dependencies:"]) {
    assert.equal(own.includes(gone), false, gone);
  }
  assert.match(own, /pnpm needs a lockfile, and the Vercel deploy keeps npm/);
  // A Topics line still names a topic; payment's "checkout" is a checkout page, session, flow, form or step, not a
  // checkout of a branch; a topic that is a header line (launch) is read from the header lines.
  assert.equal(fenceTopics(`${FENCE.replace("- Dependencies: none", "- Topics: session")}`, topics).session, "the fence's Topics line");
  assert.equal(fenceTopics("## T02 — Pay\n\n- Layers: api\n\n### What\n\nBuild the checkout page.\n", topics).payment, 'the fence says "checkout page"');
  assert.equal("payment" in fenceTopics("## T02 — CI\n\n- Layers: ops\n\n### What\n\nThe job runs on a fresh checkout of the branch.\n", topics), false);
  assert.equal(fenceTopics("## T03 — Ship\n\n- Layers: ops\n- Launch: production\n\n### What\n\nShip it.\n", topics).launch, 'the fence says "- Launch:"');
  assert.equal("launch" in fenceTopics("## T03 — Ship\n\n- Layers: ops\n\n### What\n\n- Launch: is a word in a list here.\n", topics), true);
});

test("cheaper-reviews.test.mjs (b) the builder and the reviewer read only the required files whole; every other file is listed, to open when the change needs it", () => {
  const dir = project("| T01 | P1 | S1 | First task | 3 | G-Checks | [ ] | — |");
  try {
    const rec = JSON.parse(node(dir, ["scripts/devos/skills.mjs", "select", "--task", "T01", "--role", "reviewer", "--json"], { DEVOS_REVIEW_MODE: "deep" }));
    assert.deepEqual(rec.topics.map((item) => item.topic), ["deploy", "dependencies"]);
    const whole = rec.files.filter((file) => file.read === "whole");
    const listed = rec.files.filter((file) => file.read === "listed");
    assert.ok(whole.length > 0 && listed.length > 0, JSON.stringify(rec.files.map((file) => [file.path, file.read])));
    assert.ok(rec.files.every((file) => file.read === "whole" || file.read === "listed"));
    // Required files are read whole; a skill's audit notes too when that skill has one, and listed when it has none.
    for (const file of rec.files.filter((item) => !item.path.endsWith("/DEVOS-NOTES.md"))) assert.equal(file.read, file.priority === "required" ? "whole" : "listed", file.path);
    for (const notes of rec.files.filter((item) => item.path.endsWith("/DEVOS-NOTES.md"))) {
      const hasRequired = rec.files.some((item) => item.id === notes.id && !item.path.endsWith("/DEVOS-NOTES.md") && item.priority === "required");
      assert.equal(notes.read, hasRequired ? "whole" : "listed", notes.path);
    }
    for (const role of ["builder", "reviewer"]) {
      const prompt = node(dir, ["scripts/devos/render-prompt.mjs", role, "T01", "1"], { DEVOS_REVIEW_MODE: "deep" });
      const block = prompt.split("\n").filter((line) => line.startsWith("- **Skills for this task**") || line.startsWith("  - `devos/skills/"));
      assert.match(block[0], /: read each \*\*required\*\* file whole, and a skill's `DEVOS-NOTES\.md` before its other files\. Open any other file only when the change touches what its line says, and read only the part you need \(that skill's `DEVOS-NOTES\.md` first\)\./, role);
      assert.equal(block[0].includes("read these files whole"), false, role);
      assert.match(block[0], /A \*\*required\*\* file comes with its layer or a gate: never skip it\./, role);
      // The files read whole come first, then the listed ones, each with what it covers.
      const sel = JSON.parse(node(dir, ["scripts/devos/skills.mjs", "select", "--task", "T01", "--role", role, "--json"], { DEVOS_REVIEW_MODE: "deep" }));
      const order = block.slice(1).map((line) => /`([^`]+)`/.exec(line)[1]);
      const expected = [...sel.files.filter((file) => file.read === "whole"), ...sel.files.filter((file) => file.read === "listed")].map((file) => file.path);
      assert.deepEqual(order, expected, role);
      assert.ok(block.slice(1).every((line) => / — \S/.test(line)), role);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- C: a later attempt's review, on a branch with its review commit ----------------------------------------

const quiet = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...quiet, ...env }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}
function git(args, cwd) {
  const r = run("git", args, cwd);
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.out}`);
  return r.stdout.trim();
}

/** A project on a bare "GitHub"; `trusted/` is main's checkout, where publish and the review job run main's scripts. */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-since-"));
  const seed = path.join(dir, "seed");
  cpSync(path.join(PAYLOAD, "scripts", "devos"), path.join(seed, "scripts", "devos"), { recursive: true });
  cpSync(path.join(PAYLOAD, "devos"), path.join(seed, "devos"), { recursive: true });
  const defaults = JSON.parse(read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
  write(seed, "devos.config.json", `${JSON.stringify({ ...defaults, max_attempts: 3, agents: chosenAgents() }, null, 2)}\n`);
  write(seed, "docs/PHASES.md", ["# Phases", "", "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |", "|---|---|---|---|---|---|---|---|", "| T01 | P1 | build | First | 2 | — | [ ] | — |", ""].join("\n"));
  write(seed, "docs/fences/T01.md", "## T01 — First\n\n- Phase: P1 · Risk: 2 · Gate: —\n- Paths: `src/**`\n- Fence version: 1\n\n### Prompt\n\nBuild it.\n");
  write(seed, "package.json", '{ "name": "demo", "private": true }\n');
  write(seed, "src/a.ts", "export const a = 1;\n");
  git(["init", "-q", "-b", "main"], seed);
  git(["add", "-A"], seed);
  git(["commit", "-qm", "init"], seed);
  git(["init", "-q", "--bare", "-b", "main", path.join(dir, "remote.git")], dir);
  git(["push", "-q", path.join(dir, "remote.git"), "main"], seed);
  git(["clone", "-q", path.join(dir, "remote.git"), path.join(dir, "trusted")], dir);
  return { dir, remote: path.join(dir, "remote.git"), mainSha: git(["rev-parse", "HEAD"], seed), T: path.join(dir, "trusted", "scripts", "devos") };
}
const pv = (fx, args) => run(process.execPath, [path.join(fx.T, "publish-verify.mjs"), ...args], path.join(fx.dir, "out", "decide"), { DEVOS_ROOT: path.join(fx.dir, "out", "decide") });
function verify(fx, bundle, attempt, mainSha) {
  rmSync(path.join(fx.dir, "out"), { recursive: true, force: true });
  const r = run(process.execPath, [path.join(fx.T, "publish-verify.mjs"), "verify", "--task", "T01", "--attempt", String(attempt), "--branch", "task/T01", "--main-sha", mainSha,
    "--out", path.join(fx.dir, "out"), "--bundle", bundle, "--remote", fx.remote, "--builder", "true", "--exit", "0", "--model", "grok-4.7", "--effort", "low", "--fast", "no"], fx.dir);
  assert.equal(r.status, 0, r.out);
}
/** The review job's tree, from main's review-tree, in a fresh folder. */
function reviewTree(fx, name) {
  const dest = path.join(fx.dir, name);
  const r = pv(fx, ["review-tree", "--out", path.join(fx.dir, "out"), "--dest", dest]);
  assert.equal(r.status, 0, r.out);
  return { dest, out: r.out };
}

test("cheaper-reviews.test.mjs (c) attempt 2's review tree holds what changed since attempt 1's review, never what main brought, and its prompt starts from that review", { skip: windows && "git and bash fixtures" }, () => {
  const fx = fixture();
  try {
    // Attempt 1: the builder's work, verified, reviewed FAIL with a reissued fence, and pushed.
    const a1 = path.join(fx.dir, "a1");
    git(["clone", "-q", fx.remote, a1], fx.dir);
    git(["checkout", "-q", "-b", "task/T01"], a1);
    write(a1, "src/b.ts", "export const b = 1;\n");
    write(a1, "src/keep.ts", "export const keep = 1;\n");
    git(["add", "-A"], a1);
    git(["commit", "-qm", "T01 a1: builder (work job)"], a1);
    git(["bundle", "create", "-q", path.join(fx.dir, "a1.bundle"), "refs/heads/task/T01", `^${fx.mainSha}`], a1);
    verify(fx, path.join(fx.dir, "a1.bundle"), 1, fx.mainSha);
    const first = reviewTree(fx, "rv1");
    assert.equal(existsSync(path.join(first.dest, ".devos", "diff-since-a0.patch")), false);
    assert.equal(first.out.includes("diff-since"), false, first.out);
    const D = path.join(fx.dir, "out", "decide");
    write(D, "docs/reviews/T01-a1.md", "VERDICT: FAIL\nLedger: D1 — PASS — src/keep.ts\nLedger: D2 — FAIL — b must be 2\nNext prompt: docs/fences/T01.md\n");
    write(D, "docs/fences/T01.md", "## T01 — First\n\n- Phase: P1 · Risk: 2 · Gate: —\n- Paths: `src/**`\n- Fence version: 2\n\n### Attempt 2 focus\n\n- b is 2.\n\n### Prompt\n\nBuild it.\n");
    for (const args of [["commit", "--out", path.join(fx.dir, "out"), "--message", "T01 a1: review — FAIL (retry)"], ["push", "--out", path.join(fx.dir, "out"), "--remote", fx.remote]]) {
      const r = pv(fx, args);
      assert.equal(r.status, 0, `${args[0]}: ${r.out}`);
    }
    // main moves meanwhile; attempt 2's work job merges it, then fixes b and adds a file.
    const other = path.join(fx.dir, "other");
    git(["clone", "-q", fx.remote, other], fx.dir);
    write(other, "src/main-only.ts", "export const m = 1;\n");
    git(["add", "-A"], other);
    git(["commit", "-qm", "main moves"], other);
    git(["push", "-q", "origin", "main"], other);
    const main2 = git(["rev-parse", "HEAD"], other);
    const a2 = path.join(fx.dir, "a2");
    git(["clone", "-q", "-b", "task/T01", fx.remote, a2], fx.dir);
    const reviewed = git(["rev-parse", "HEAD"], a2);
    git(["merge", "-q", "--no-edit", "-m", "Merge main into task/T01", "origin/main"], a2);
    write(a2, "src/b.ts", "export const b = 2;\n");
    write(a2, "src/new.ts", "export const n = 1;\n");
    git(["add", "-A"], a2);
    git(["commit", "-qm", "T01 a2: builder (work job)"], a2);
    git(["bundle", "create", "-q", path.join(fx.dir, "a2.bundle"), "refs/heads/task/T01", `^${reviewed}`, `^${main2}`], a2);
    verify(fx, path.join(fx.dir, "a2.bundle"), 2, main2);
    const second = reviewTree(fx, "rv2");
    assert.match(second.out, /^review tree: what changed since T01 a1's review \([0-9a-f]{12}\) in \.devos\/diff-since-a1\.patch, 2 file\(s\)$/m);
    const since = read(path.join(second.dest, ".devos", "diff-since-a1.patch"));
    // Its file list first, then the patch: the builder's two files, not main's, not the fence the review reissued.
    assert.match(since.split("\n")[0], /^ src\/b\.ts +\| 2 \+-$/);
    assert.match(since, /^ 2 files changed, 2 insertions\(\+\), 1 deletion\(-\)$/m);
    assert.match(since, /^-export const b = 1;\n\+export const b = 2;$/m);
    assert.match(since, /^diff --git a\/src\/new\.ts b\/src\/new\.ts$/m);
    for (const absent of ["src/main-only.ts", "src/keep.ts", "docs/fences/T01.md", "docs/reviews/T01-a1.md"]) assert.equal(since.includes(absent), false, absent);
    // The whole diff is still the branch against main.
    assert.match(read(path.join(second.dest, ".devos", "diff.patch")), /^diff --git a\/src\/keep\.ts b\/src\/keep\.ts$/m);
    // The prompt the review job renders in that tree, with that tree's render-prompt, as its steps do.
    const review = read(path.join(PAYLOAD, "dot-github", "workflows", "devos-review.yml"));
    assert.match(review, /node "\$T\/publish-verify\.mjs" review-tree --out "\$OUT" --dest "\$RV" --evidence "\$W\/evidence"/);
    assert.match(review, /working-directory: \$\{\{ github\.workspace \}\}\/review\n[\s\S]*?node scripts\/devos\/render-prompt\.mjs reviewer "\$TASK" "\$ATTEMPT" --out \.devos\/reviewer-prompt\.md/);
    const prompt = node(second.dest, ["scripts/devos/render-prompt.mjs", "reviewer", "T01", "2"], { DEVOS_ROOT: second.dest, DEVOS_REVIEW_MODE: "deep" });
    assert.match(prompt, /^\*\*This is attempt 2: start from your last review \(PR-105\)\.\*\* `\.devos\/diff-since-a1\.patch` is what changed on the branch since your review of attempt 1 \(`docs\/reviews\/T01-a1\.md`\), its file list first\.$/m);
    assert.match(prompt, /^1\. Judge again each FAIL line of that verdict, and each point of the fence's "Attempt 2 focus", against this diff and the new evidence\.$/m);
    assert.match(prompt, /^2\. A line that passed stays PASS, citing that review, unless this diff touches what proved it/m);
    assert.match(prompt, /^3\. Every check ran again in the work job: a red or missing required check fails this attempt, whatever the last review said\.$/m);
    assert.ok(prompt.indexOf("start from your last review") < prompt.indexOf("## Evidence you have"));
    assert.equal(prompt.includes("{{"), false);
    // Without the file (a branch with no review commit), the review reads the whole diff, as before.
    rmSync(path.join(second.dest, ".devos", "diff-since-a1.patch"));
    const plain = node(second.dest, ["scripts/devos/render-prompt.mjs", "reviewer", "T01", "2"], { DEVOS_ROOT: second.dest, DEVOS_REVIEW_MODE: "deep" });
    assert.equal(plain.includes("start from your last review"), false);
    assert.match(plain, /^- `docs\/reviews\/T01-a1\.md`: your previous verdict on this task\.$/m);
    // The builder's prompt never gets the reviewer's block.
    assert.equal(node(second.dest, ["scripts/devos/render-prompt.mjs", "builder", "T01", "2"], { DEVOS_ROOT: second.dest }).includes("start from your last review"), false);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("cheaper-reviews.test.mjs (c2) a later attempt on a branch with no review commit gets no diff since, and says so", { skip: windows && "git fixtures" }, () => {
  const fx = fixture();
  try {
    const a1 = path.join(fx.dir, "a1");
    git(["clone", "-q", fx.remote, a1], fx.dir);
    git(["checkout", "-q", "-b", "task/T01"], a1);
    write(a1, "src/b.ts", "export const b = 1;\n");
    git(["add", "-A"], a1);
    git(["commit", "-qm", "T01 a1: builder (work job)"], a1);
    git(["push", "-q", "origin", "task/T01"], a1);
    const pushed = git(["rev-parse", "HEAD"], a1);
    write(a1, "src/b.ts", "export const b = 2;\n");
    git(["add", "-A"], a1);
    git(["commit", "-qm", "T01 a2: builder (work job)"], a1);
    git(["bundle", "create", "-q", path.join(fx.dir, "a2.bundle"), "refs/heads/task/T01", `^${pushed}`], a1);
    verify(fx, path.join(fx.dir, "a2.bundle"), 2, fx.mainSha);
    const tree = reviewTree(fx, "rv");
    assert.match(tree.out, /^review tree: no "T01 a1: review" commit on the branch, so this review reads the whole diff$/m);
    assert.equal(existsSync(path.join(tree.dest, ".devos", "diff-since-a1.patch")), false);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ---------- D: what the attempt used, in publish's notice ------------------------------------------------------------

const RECORDS = [
  { stage: "builder", attempt: 1, tool: "cursor", model: "grok-4.7-low", input: 10, output: 5, cache_read: 100, cache_write: 0, cost_usd: null, seconds: 600 },
  { stage: "builder", attempt: 2, tool: "cursor", model: "grok-4.7-low", input: 256000, output: 34000, cache_read: 2519040, cache_write: 0, cost_usd: null, seconds: 300 },
  { stage: "reviewer", attempt: 2, tool: "cursor", model: "grok-4.7-xhigh", input: 468777, output: 55367, cache_read: 3607168, cache_write: 0, cost_usd: null, seconds: 2040 },
  { stage: "builder", attempt: 2, tool: "cursor", model: "grok-4.7-low", input: 953, output: 249, cache_read: 0, cache_write: 0, cost_usd: null, seconds: 240 },
  { stage: "revise", attempt: 2, tool: "claude", model: "claude-opus-5-5", input: null, output: null, cache_read: null, cache_write: null, cost_usd: null, seconds: 20, reported: false },
].map((r, i) => ({ v: 1, id: `run${i}.1.${r.stage}.x`, at: `2026-11-26T1${i}:00:00.000Z`, task: "T01", exit: 0, reported: true, run: "", ...r }));
const LINE = "T01 a2 used: revise claude claude-opus-5-5, under 1 min (usage not reported) · builder cursor grok-4.7-low, 2 runs, 9 min (in 256,953 · out 34,249 · cache read 2,519,040) · reviewer cursor grok-4.7-xhigh, 34 min (in 468,777 · out 55,367 · cache read 3,607,168)";

/** A step's own `run:` script, from the workflow publish runs. */
function stepRun(file, name) {
  const lines = read(file).split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(at >= 0, name);
  const runAt = lines.findIndex((line, n) => n > at && /^\s+run: \|$/.test(line));
  const indent = lines[runAt].indexOf("run:") + 2;
  const body = [];
  for (let n = runAt + 1; n < lines.length && (lines[n].trim() === "" || lines[n].search(/\S/) >= indent); n += 1) body.push(lines[n].slice(indent));
  return { head: lines.slice(at, runAt).join("\n"), script: body.join("\n"), at };
}

test("cheaper-reviews.test.mjs (d) publish's notice says what the attempt used, each stage's tool, model, minutes and tokens, from the usage records", { skip: windows && "the step is bash" }, () => {
  assert.equal(attemptLine(RECORDS, "T01", 2, null), LINE);
  assert.equal(attemptLine(RECORDS, "T01", 3, null), "");
  assert.equal(attemptLine([{ ...RECORDS[2], cost_usd: 2.4873 }], "T01", 2, null), "T01 a2 used: reviewer cursor grok-4.7-xhigh, 34 min (in 468,777 · out 55,367 · cache read 3,607,168 · $2.49)");
  assert.equal(attemptLine([RECORDS[2]], "T01", 2, { "grok-4.7-xhigh": { input: 1, output: 2, cache_read: 0.1 } }), "T01 a2 used: reviewer cursor grok-4.7-xhigh, 34 min (in 468,777 · out 55,367 · cache read 3,607,168 · $0.94)");
  const cycle = path.join(PAYLOAD, "dot-github", "workflows", "devos-cycle.yml");
  const step = stepRun(cycle, "What this attempt used");
  assert.ok(step.at > stepRun(cycle, "Act on the verdict").at, "after the verdict's own notice");
  assert.match(step.head, /if: always\(\) && steps\.bs\.outputs\.state == 'ok'/);
  assert.match(step.head, /working-directory: \$\{\{ github\.workspace \}\}\/publish\/decide/);
  const dir = mkdtempSync(path.join(tmpdir(), "devos-notice-"));
  try {
    write(dir, "docs/usage/T01.jsonl", `${RECORDS.map((r) => JSON.stringify(r)).join("\n")}\n`);
    write(dir, "docs/usage/T02.jsonl", `${JSON.stringify({ ...RECORDS[2], id: "other", task: "T02" })}\n`);
    const env = { PATH: process.env.PATH ?? "", HOME: dir, T: path.join(PAYLOAD, "scripts", "devos"), TASK: "T01", DEVOS_ROOT: dir };
    const r = spawnSync("bash", ["-e", "-c", step.script], { cwd: dir, encoding: "utf8", env: { ...env, ATTEMPT: "2" } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, `::notice title=Dev OS::${LINE}\n`);
    const none = spawnSync("bash", ["-e", "-c", step.script], { cwd: dir, encoding: "utf8", env: { ...env, ATTEMPT: "3" } });
    assert.equal(none.status, 0, none.stdout + none.stderr);
    assert.equal(none.stdout, "no usage record for T01 attempt 3\n");
    // A broken record never fails the step.
    write(dir, "docs/usage/T01.jsonl", "not json\n");
    assert.equal(spawnSync("bash", ["-e", "-c", step.script], { cwd: dir, encoding: "utf8", env: { ...env, ATTEMPT: "2" } }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cheaper-reviews.test.mjs (e) the manual, the precedent and the changelog name the new rules", () => {
  const manual = read(path.join(PAYLOAD, "docs", "method", "AUTOMATION.md"));
  assert.match(manual, /`\.devos\/diff-since-a<N-1>\.patch`/);
  assert.match(manual, /`notice --task X --attempt N`/);
  assert.match(manual, /each \*\*required\*\* file is read whole/);
  const precedents = read(path.join(PAYLOAD, "docs", "method", "PRECEDENTS.md"));
  // PR-105 stays; a later task moves the live maximum past it (E86: PR-106).
  assert.ok(Number(precedents.match(/\*\*Live maximum: PR-(\d+)\.\*\*/)?.[1]) >= 105);
  assert.equal(precedents.split("\n").filter((line) => line.startsWith("| PR-105 |")).length, 1);
  assert.match(read(path.join(root, "CHANGELOG.md")).split("\n## ")[1], /^1\.14\.0-rc\.1 — Unreleased[\s\S]*PR-105/);
  for (const name of ["blueprint", "intake", "reviewer"]) assert.match(read(path.join(PAYLOAD, "devos", "prompts", `${name}.md`)), /add `- Topics: <topic> · <topic>`[^\n]*\(PR-105\)/, name);
});
