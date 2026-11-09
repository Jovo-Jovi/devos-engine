// E67 (PR-91): units of acceptance. S = a static check of the workflow files; U = the scripts on crafted inputs. The
// live check (L, a two-task unit on devos-pilot) is the owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(root, "payload", "files");
const SCRIPTS = path.join(PAYLOAD, "scripts", "devos");
const WF = path.join(PAYLOAD, "dot-github", "workflows");
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const code = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const cycle = code(read(path.join(WF, "devos-cycle.yml")));
const windows = process.platform === "win32";

// A file URL, not a path: on Windows an absolute path reads as a URL scheme ("c:") and import() refuses it.
const load = (name) => import(pathToFileURL(path.join(SCRIPTS, name)).href);
const { unitOf, waitsOnTaskPr, acceptanceUnit, parsePhases } = await load("lib.mjs");
const { openUnits, decide, reportText } = await load("unit.mjs");
const { deploymentFindings } = await load("doctor.mjs");

function job(text, name) {
  const at = text.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  assert.notEqual(at, -1, `job ${name}`);
  const rest = text.slice(at + 1);
  const end = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  return end === -1 ? text.slice(at) : text.slice(at, at + 1 + end);
}
const steps = (jobText) => jobText.split(/^ {6}- /m).slice(1);

// A plan: P1 T01 · T02 (gate) · T03 | PM T04 (a method fix) | P2 T05 · T06 (gate) · T07.
const TABLE = (done = {}) => [
  "# Phases", "",
  "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |",
  "|---|---|---|---|---|---|---|---|",
  ...[["T01", "P1", 1, "—"], ["T02", "P1", 2, "G-Foundation"], ["T03", "P1", 2, "—"], ["T04", "PM", 3, "G-Method-9"], ["T05", "P2", 3, "—"], ["T06", "P2", 2, "G-Feature"], ["T07", "P2", 1, "—"]]
    .map(([t, p, r, g]) => `| ${t} | ${p} | build | Name ${t} | ${r} | ${g} | ${done[t] ? "[x]" : "[ ]"} | ${done[t] ? `PASS a1 — docs/reviews/${t}-a1.md` : "—"} |`),
  ""].join("\n");
const rows = (done) => parsePhases(TABLE(done)).rows;
const SHA = "a".repeat(40);
const USHA = "b".repeat(40);

// ---------- S: the workflow files -------------------------------------------------------------------------------------

test("units.test.mjs S1 no runner path merges into main: the one merge is publish's, into the run's unit branch", () => {
  const merges = [];
  for (const file of readdirSync(WF).filter((f) => f.endsWith(".yml"))) {
    const text = code(read(path.join(WF, file)));
    for (const m of text.matchAll(/gh pr merge|pulls\/[^ ]*\/merge/g)) merges.push(`${file}:${m.index}`);
  }
  assert.equal(merges.length, 1, merges.join(" "));
  const act = steps(job(cycle, "publish")).find((s) => s.startsWith("name: Act on the verdict"));
  const guard = act.indexOf('pr_base=$(gh pr view "$PRN" --repo "$REPO" --json baseRefName --jq .baseRefName');
  assert.ok(guard > 0 && guard < act.indexOf("gh pr merge"), "the base is read before the merge");
  assert.match(act, /devos\/unit-T\*\) \[ "\$pr_base" = "\$BASE" \] \|\| \{ ACTION=human_gate;/);
  assert.match(act, /\*\) ACTION=human_gate; echo "The PR targets \$\{pr_base:-an unknown base\}: the runner never merges into it \(PR-91\)/);
  for (const script of readdirSync(SCRIPTS).filter((f) => /\.(mjs|sh)$/.test(f) && f !== "loop.mjs")) {
    assert.equal(/gh", \["pr", "merge"|pr merge/.test(read(path.join(SCRIPTS, script))), false, script);
  }
});

test("units.test.mjs S2 the acceptance pull request is opened only by publish, from the unit's branch into main", () => {
  const all = readdirSync(WF).filter((f) => f.endsWith(".yml")).map((f) => [f, code(read(path.join(WF, f)))]);
  const opened = all.filter(([, t]) => /devos:acceptance"?\s*$/m.test(t) || /--label "devos:acceptance"/.test(t));
  assert.deepEqual(opened.map(([f]) => f), ["devos-cycle.yml"]);
  const accept = steps(job(cycle, "publish")).find((s) => s.startsWith("name: Open the acceptance pull request (PR-91)"));
  assert.match(accept, /if: needs\.resolve\.outputs\.accept == 'true'/);
  assert.match(accept, /gh pr create --repo "\$REPO" --base main --head "\$UNIT" --title "Unit \$first–\$last: your acceptance"/);
  assert.match(accept, /-f state=success -f context=devos\/verdict/);
  assert.equal(/gh pr merge/.test(accept), false);
  for (const name of ["resolve", "report", "wait-and-resume"]) assert.equal(/devos:acceptance|--base main --head/.test(job(cycle, name)), false, name);
  // With no work job, publish runs only that step and its record: verify and every build step are skipped.
  const publish = job(cycle, "publish");
  assert.match(publish, /\|\| needs\.resolve\.outputs\.accept == 'true'\)/);
  for (const name of ["The work job's bundle and evidence", "Verify the bundle (main's rules, publish's own diff)", "The builder's outcome, within main's limits", "Push the builder's work", "Open the pull request (or reuse it)"]) {
    const step = steps(publish).find((s) => s.startsWith(`name: ${name}`));
    assert.match(step, /\n {8}if: needs\.resolve\.outputs\.accept != 'true'\n/, name);
  }
  assert.match(job(cycle, "work"), /if: needs\.resolve\.outputs\.done == 'false' && needs\.resolve\.outputs\.build == 'true'/);
});

test("units.test.mjs S3 devos-deploy's triggers are unchanged; your merge of a unit starts the next one", () => {
  const deploy = read(path.join(WF, "devos-deploy.yml"));
  assert.match(deploy, /^on:\n {2}push:\n {4}branches: \[main\]\n/m);
  const advance = code(read(path.join(WF, "devos-advance.yml")));
  assert.match(advance, /startsWith\(github\.event\.pull_request\.head\.ref, 'devos\/unit-'\)/);
  assert.match(advance, /if \[\[ "\$HEAD" =~ \^devos\/unit-T\[0-9\]\{2,3\}\$ \]\] && \[ "\$BASE_REF" = "main" \]; then\n {12}gh workflow run devos-cycle\.yml --repo "\$REPO" --ref main\n/);
  assert.match(advance, /next=\$\(node scripts\/devos\/next-task\.mjs "\$\{unit_args\[@\]\}"/);
  // The task branch starts from the task's base; publish verifies against it.
  assert.match(job(cycle, "work"), /main_sha: \$\{\{ needs\.resolve\.outputs\.base_sha \|\| github\.sha \}\}\n {6}base: \$\{\{ needs\.resolve\.outputs\.base \|\| 'main' \}\}/);
  assert.match(job(cycle, "publish"), /--main-sha "\$BASE_SHA" --base "\$BASE"/);
});

// ---------- U: the scripts --------------------------------------------------------------------------------------------

test("units.test.mjs U1 unit boundaries from PHASES: a Gate and a phase's end (gate), phases (phase), every task (task)", () => {
  const r = rows();
  const units = (mode) => [...new Set(r.filter((x) => x.phase !== "PM").map((x) => unitOf(r, x.task, mode).branch))];
  assert.deepEqual(units("gate"), ["devos/unit-T02", "devos/unit-T03", "devos/unit-T06", "devos/unit-T07"]);
  assert.deepEqual(units("phase"), ["devos/unit-T03", "devos/unit-T07"]);
  assert.deepEqual(units("task"), ["devos/unit-T01", "devos/unit-T02", "devos/unit-T03", "devos/unit-T05", "devos/unit-T06", "devos/unit-T07"]);
  assert.deepEqual(unitOf(r, "T05", "gate"), { tasks: ["T05", "T06"], first: "T05", last: "T06", branch: "devos/unit-T06" });
  assert.equal(unitOf(r, "T04", "gate"), null);
  assert.equal(acceptanceUnit({}), "gate");
  assert.equal(acceptanceUnit({ acceptance: { unit: "phase" } }), "phase");
  assert.equal(acceptanceUnit({ acceptance: { unit: "nonsense" } }), "gate");
  // Q2 (a): a Gate is signed by the unit; risk 3 and a method fix still wait on their own PR.
  assert.deepEqual(r.map((x) => [x.task, waitsOnTaskPr(x)]), [["T01", false], ["T02", false], ["T03", false], ["T04", true], ["T05", true], ["T06", false], ["T07", false]]);
});

test("units.test.mjs U2 the open unit and where each task is built: a new unit, the open one, accept, waiting, a method fix", () => {
  const main = rows({ T01: true, T02: true });
  // T01–T02 ticked on main: unit-T02 is accepted; unit-T06 has work; a stray name is left alone.
  const found = openUnits(main, [{ name: "devos/unit-T02", sha: SHA }, { name: "devos/unit-T06", sha: USHA }, { name: "devos/unit-T05", sha: SHA }], "gate");
  assert.deepEqual(found.open.map((u) => [u.branch, u.sha, u.tasks.join(",")]), [["devos/unit-T06", USHA, "T05,T06"]]);
  assert.deepEqual(found.unknown, ["devos/unit-T05"]);
  // A unit's tasks are its own PHASES' at its start: a row main gains later in the same phase never moves it.
  const grown = parsePhases(TABLE().replace("| T07 | P2 | build | Name T07 | 1 | — | [ ] | — |", "| T07 | P2 | build | Name T07 | 1 | — | [ ] | — |\n| T08 | P2 | build | Name T08 | 1 | — | [ ] | — |")).rows;
  assert.deepEqual(openUnits(grown, [{ name: "devos/unit-T07", sha: SHA }], "gate").unknown, ["devos/unit-T07"]);
  const kept = openUnits(grown, [{ name: "devos/unit-T07", sha: SHA, rows: rows() }], "gate");
  assert.deepEqual([kept.open.map((u) => u.tasks.join(",")), kept.unknown], [["T07"], []]);
  const at = (o) => { const { note, ...rest } = o; return rest; };
  // No open unit: T03 starts its own unit, from main.
  assert.deepEqual(at(decide({ mainRows: main, unitRows: null, open: null, task: "T03", mode: "gate", mainSha: SHA })),
    { build: "true", base: "devos/unit-T03", base_sha: SHA, unit: "devos/unit-T03", unit_first: "T03", unit_last: "T03", unit_new: "true", accept: "false", waiting: "false", acceptance_pr: "" });
  // A method fix targets main, even while a unit waits for you.
  const waitingUnit = { ...unitOf(main, "T06", "gate"), sha: USHA, waiting_pr: 41, closed_pr: "" };
  assert.deepEqual(at(decide({ mainRows: main, unitRows: rows({ T05: true, T06: true }), open: waitingUnit, task: "T04", mode: "gate", mainSha: SHA })),
    { build: "true", base: "main", base_sha: SHA, unit: "", unit_first: "", unit_last: "", unit_new: "false", accept: "false", waiting: "false", acceptance_pr: "" });
  // The open unit with T06 still open: T06 is built on it, from its head.
  const open = { ...unitOf(main, "T06", "gate"), sha: USHA, waiting_pr: "", closed_pr: "" };
  const mid = decide({ mainRows: main, unitRows: rows({ T05: true }), open, task: "T06", mode: "gate", mainSha: SHA });
  assert.deepEqual([mid.build, mid.base, mid.base_sha, mid.unit_new, mid.accept], ["true", "devos/unit-T06", USHA, "false", "false"]);
  // Every row ticked on the unit: accept; with its PR open or closed: waiting, and nothing is built.
  const done = rows({ T05: true, T06: true });
  const acc = decide({ mainRows: main, unitRows: done, open, task: "T07", mode: "gate", mainSha: SHA });
  assert.deepEqual([acc.build, acc.accept, acc.waiting, acc.unit], ["false", "true", "false", "devos/unit-T06"]);
  const wait = decide({ mainRows: main, unitRows: done, open: waitingUnit, task: "T07", mode: "gate", mainSha: SHA });
  assert.deepEqual([wait.build, wait.accept, wait.waiting, wait.acceptance_pr], ["false", "false", "true", "41"]);
  assert.match(wait.note, /waits for your acceptance: pull request #41/);
  // A row ticked on main (an accept recorded there) counts as done inside the unit too.
  const viaMain = decide({ mainRows: rows({ T01: true, T02: true, T05: true }), unitRows: rows({ T06: true }), open, task: "T07", mode: "gate", mainSha: SHA });
  assert.equal(viaMain.accept, "true");
  const held = decide({ mainRows: main, unitRows: done, open: { ...open, closed_pr: 42 }, task: "", mode: "gate", mainSha: SHA });
  assert.deepEqual([held.build, held.waiting], ["false", "true"]);
  assert.match(held.note, /you closed its acceptance pull request #42\. Reopen it/);
});

test("units.test.mjs U3 next-task reads the open unit's progress for product rows, main's for method rows", { skip: windows && "a POSIX path in the fixture" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-units-"));
  try {
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    cpSync(SCRIPTS, path.join(dir, "scripts", "devos"), { recursive: true });
    writeFileSync(path.join(dir, "devos.config.json"), read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    writeFileSync(path.join(dir, "docs", "PHASES.md"), TABLE({ T01: true, T02: true, T04: true }));
    writeFileSync(path.join(dir, "unit.md"), TABLE({ T01: true, T02: true, T03: true, T04: false }));
    const next = (args) => {
      const r = spawnSync(process.execPath, [path.join(dir, "scripts", "devos", "next-task.mjs"), ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } });
      assert.equal(r.status, 0, r.stderr);
      return /^task=(.*)$/m.exec(r.stdout)[1];
    };
    assert.equal(next([]), "T03");
    // T03 is ticked on its unit; T04 (a method fix) stays ticked from main, so the next is T05.
    assert.equal(next(["--unit-phases", path.join(dir, "unit.md")]), "T05");
  } finally {
    cleanup(dir);
  }
});

test("units.test.mjs U4 the completion report: tasks, verdicts, reviews, pull requests, paths and how to check it", () => {
  const main = rows({ T01: true, T02: true });
  const unit = unitOf(main, "T06", "gate");
  const text = reportText({ unit, rows: main, unitRows: rows({ T05: true, T06: true }), prs: [{ number: 12, headRefName: "task/T05" }, { number: 13, headRefName: "task/T06" }],
    paths: ["src/a.ts", "src/`x`|y.ts"], total: 2, stack: { install: "pnpm install --frozen-lockfile", build: "pnpm run build", preview: "" } });
  for (const line of [
    "## Unit T05–T06: your acceptance",
    "| T05 | Name T05 | 3 | — | PASS a1 — docs/reviews/T05-a1.md | `docs/reviews/T05-a1.md` | #12 |",
    "| T06 | Name T06 | 2 | G-Feature | PASS a1 — docs/reviews/T06-a1.md | `docs/reviews/T06-a1.md` | #13 |",
    "### What changes against main (2 paths)",
    "src/ x  y.ts",
    "- **On your machine:** `git fetch origin devos/unit-T06`, `git switch devos/unit-T06`, then `pnpm install --frozen-lockfile`, `pnpm run build` and `pnpm exec next start`.",
    "- **A preview:** the cycle makes none (it holds no Vercel credential, D12). If your Vercel project builds branches from Git, the doctor's comment on this pull request links this branch's preview.",
    "- **Merge** this pull request: the only way this unit reaches main. Production deploys from your merge, and the next unit starts.",
  ]) assert.ok(text.split("\n").includes(line), line);
  assert.equal(text.includes("`x`"), false);
});

test("units.test.mjs U5 the doctor's deployment checks: main from Git, a variable shared with Preview; names only", () => {
  const project = { link: { type: "github", repo: "demo", productionBranch: "main" } };
  const envs = [
    { key: "NEXT_PUBLIC_SITE", target: ["production", "preview", "development"], value: "secret-value-1" },
    { key: "SUPABASE_SECRET_KEY", target: ["production"], value: "secret-value-2" },
    { key: "STRIPE_SECRET_KEY", target: ["preview", "production"], value: "secret-value-3" },
  ];
  const found = deploymentFindings(project, envs, null);
  assert.deepEqual(found.map((i) => [i.key, i.level, i.state]), [["deploy-git", "warn", "Vercel deploys main from Git"], ["deploy-env", "warn", "2 shared with Production"]]);
  assert.match(found[1].todo[0].text, /`NEXT_PUBLIC_SITE`, `STRIPE_SECRET_KEY`/);
  assert.equal(JSON.stringify(found).includes("secret-value"), false);
  assert.deepEqual(deploymentFindings(project, [], { git: { deploymentEnabled: { main: false } } }), []);
  assert.deepEqual(deploymentFindings({ ...project, commandForIgnoringBuildStep: "exit 0" }, [], null), []);
  assert.deepEqual(deploymentFindings({}, [], null), []);
});

// ---------- the publish job's git against a unit branch --------------------------------------------------------------

const quiet = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, env: quiet, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

test("units.test.mjs U6 publish-verify verifies against the unit branch and merges a unit that moved", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-units-git-"));
  try {
    const seed = path.join(dir, "seed");
    mkdirSync(path.join(seed, "docs", "fences"), { recursive: true });
    mkdirSync(path.join(seed, "src"), { recursive: true });
    cpSync(SCRIPTS, path.join(seed, "scripts", "devos"), { recursive: true });
    cpSync(path.join(PAYLOAD, "devos"), path.join(seed, "devos"), { recursive: true });
    writeFileSync(path.join(seed, "devos.config.json"), read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    writeFileSync(path.join(seed, "docs", "PHASES.md"), TABLE());
    for (const t of ["T01", "T02"]) writeFileSync(path.join(seed, "docs", "fences", `${t}.md`), `## ${t}\n\n- Paths: \`src/**\`\n\n### Prompt\n\nBuild.\n`);
    writeFileSync(path.join(seed, "src", "a.ts"), "export const a = 1;\n");
    git(["init", "-q", "-b", "main"], seed);
    git(["add", "-A"], seed);
    git(["commit", "-qm", "init"], seed);
    const remote = path.join(dir, "remote.git");
    git(["init", "-q", "--bare", "-b", "main", remote], dir);
    git(["push", "-q", remote, "main"], seed);
    // The unit's branch, one task further than main.
    git(["checkout", "-q", "-b", "devos/unit-T02"], seed);
    writeFileSync(path.join(seed, "src", "t01.ts"), "export const t01 = 1;\n");
    git(["add", "-A"], seed);
    git(["commit", "-qm", "T01 on the unit"], seed);
    git(["push", "-q", remote, "devos/unit-T02"], seed);
    const unitSha = git(["rev-parse", "HEAD"], seed);
    git(["clone", "-q", remote, path.join(dir, "trusted")], dir);
    // The work job: task/T02 from the unit's head.
    const work = path.join(dir, "work");
    git(["clone", "-q", remote, work], dir);
    git(["checkout", "-q", "-b", "task/T02", unitSha], work);
    writeFileSync(path.join(work, "src", "t02.ts"), "export const t02 = 2;\n");
    git(["add", "-A"], work);
    git(["commit", "-qm", "T02 a1: builder (work job)"], work);
    const bundle = path.join(dir, "branch.bundle");
    git(["bundle", "create", "-q", bundle, "refs/heads/task/T02", `^${unitSha}`], work);
    const T = path.join(dir, "trusted", "scripts", "devos");
    const out = path.join(dir, "out");
    const pv = (args) => spawnSync(process.execPath, [path.join(T, "publish-verify.mjs"), ...args], { cwd: dir, env: { ...quiet, DEVOS_ROOT: path.join(out, "decide"), DEVOS_BASE: "devos/unit-T02" }, encoding: "utf8" });
    const v = pv(["verify", "--task", "T02", "--attempt", "1", "--branch", "task/T02", "--main-sha", unitSha, "--base", "devos/unit-T02", "--out", out, "--bundle", bundle, "--remote", remote, "--builder", "true", "--exit", "0", "--model", "m", "--effort", "low", "--fast", "no"]);
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /^ {2}src\/t02\.ts$/m);
    assert.equal(/src\/t01\.ts/.test(v.stdout.split("diff ")[0]), false, "the unit's own work is not this run's");
    const state = JSON.parse(readFileSync(path.join(out, "verify.json"), "utf8"));
    assert.deepEqual([state.base, state.main_sha], ["devos/unit-T02", unitSha]);
    assert.equal(git(["rev-parse", "refs/remotes/origin/devos/unit-T02"], path.join(out, "decide")), unitSha);
    // The unit moves (a person's commit); sync merges the unit, not main.
    writeFileSync(path.join(seed, "src", "fix.ts"), "export const fix = 1;\n");
    git(["add", "-A"], seed);
    git(["commit", "-qm", "a fix on the unit"], seed);
    git(["push", "-q", remote, "devos/unit-T02"], seed);
    const s = pv(["sync", "--out", out, "--remote", remote]);
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /^sync: merged devos\/unit-T02 [0-9a-f]{12}; 1 path\(s\) came in, 1 of them code$/m);
    assert.equal(git(["log", "-1", "--format=%s", JSON.parse(readFileSync(path.join(out, "verify.json"), "utf8")).head], path.join(out, "decide")), "Merge devos/unit-T02 into task/T02");
    // A base that is neither main nor a unit is refused.
    const bad = pv(["verify", "--task", "T02", "--attempt", "1", "--branch", "task/T02", "--main-sha", unitSha, "--base", "release", "--out", path.join(dir, "out2"), "--remote", remote]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--base must be main or devos\/unit-Tnn/);
  } finally {
    cleanup(dir);
  }
});

test("units.test.mjs S4 the supervisor and devos-advance read the open unit; the local loop keeps a Gate", () => {
  const sup = read(path.join(SCRIPTS, "supervisor.mjs"));
  assert.ok(sup.includes('acceptance_prs: prs.filter((p) => p.labels.includes("devos:acceptance")).map((p) => p.number),'));
  assert.ok(sup.includes('execFileSync(process.execPath, [P("scripts/devos/unit.mjs"), "open", "--repo", REPO, "--out", dir]'));
  assert.ok(sup.includes("(facts.acceptance_prs ?? []).length > 0 || facts.unit_complete === true;"));
  const advance = code(read(path.join(WF, "devos-advance.yml")));
  assert.match(advance, /node scripts\/devos\/unit\.mjs open --repo "\$REPO"[^\n]*\n {10}if \[ -s \.devos\/unit\/PHASES\.md \]; then unit_args=\(--unit-phases \.devos\/unit\/PHASES\.md\); fi/);
  assert.ok(read(path.join(SCRIPTS, "loop.mjs")).includes('if (action === "merge" && isHumanGate(parsePhases().rows.find((r) => r.task === task) ?? {})) action = "human_gate";'));
});

test("units.test.mjs S5 resolve merges main into the open unit with GitHub's API only; the acceptance PR is this repository's, on the judged head", () => {
  const resolve = job(cycle, "resolve");
  assert.match(resolve, /^ {4}permissions:\n {6}contents: write\n {6}issues: write\n {6}pull-requests: read\n {6}actions: write\n/m);
  // A job that can write uses only GitHub's actions pinned by commit, and runs main's scripts.
  const uses = [...resolve.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 3);
  for (const u of uses) assert.match(u, /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/, u);
  const sync = steps(resolve).find((s) => s.startsWith("name: Bring main into the open unit (PR-91)"));
  assert.match(sync, /if: steps\.place\.outputs\.build == 'true' && steps\.place\.outputs\.unit_new == 'false' && steps\.place\.outputs\.base != 'main'/);
  assert.match(sync, /gh api "repos\/\$REPO\/merges" -f base="\$BASE" -f head="\$MAIN_SHA"/);
  // No git of its own (only the message tells you how to merge by hand), and never main as the base.
  assert.equal(/^\s+git\s|\$\(git\s|-f base="main"/m.test(sync), false);
  assert.match(resolve, /base_sha: \$\{\{ steps\.sync\.outputs\.base_sha \|\| steps\.place\.outputs\.base_sha \}\}/);
  const accept = steps(job(cycle, "publish")).find((s) => s.startsWith("name: Open the acceptance pull request (PR-91)"));
  assert.match(accept, /if \[ -z "\$UNIT_SHA" \] \|\| \[ "\$head" != "\$UNIT_SHA" \]; then/);
  assert.match(accept, /mine='\[\.\[\] \| select\(\.isCrossRepository \| not\)\]\[0\]\.number \/\/ empty'/);
  assert.match(accept, /gh api "repos\/\$REPO\/statuses\/\$UNIT_SHA"/);
  const unitSrc = read(path.join(SCRIPTS, "unit.mjs"));
  assert.ok(unitSrc.includes('.filter((p) => p.isCrossRepository === false)'));
  assert.ok(unitSrc.includes('p.state === "CLOSED" && p.headRefOid === unit.sha'));
  const open = steps(job(cycle, "publish")).find((s) => s.startsWith("name: Open the pull request (or reuse it)"));
  assert.match(open, /gh pr edit "\$PRN" --repo "\$REPO" --base "\$BASE"/);
});

test("units.test.mjs U7 unit.mjs open and place through a stand-in gh: forks and stale closed PRs ignored, an orphaned unit stops", { skip: windows && "a stand-in gh" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-units-gh-"));
  const bin = path.join(dir, "bin");
  try {
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    mkdirSync(bin);
    cpSync(SCRIPTS, path.join(dir, "scripts", "devos"), { recursive: true });
    writeFileSync(path.join(dir, "devos.config.json"), read(path.join(PAYLOAD, "devos", "engine.defaults.json")));
    writeFileSync(path.join(dir, "docs", "PHASES.md"), TABLE({ T01: true, T02: true }));
    writeFileSync(path.join(dir, "unit-T06.md"), TABLE({ T01: true, T02: true, T05: true, T06: true }));
    const stub = (refs, prs) => {
      writeFileSync(path.join(bin, "refs.json"), JSON.stringify(refs));
      writeFileSync(path.join(bin, "prs.json"), JSON.stringify(prs));
      writeFileSync(path.join(bin, "gh"), `#!/bin/sh
case "$*" in
  *"git/matching-refs/heads/devos/unit-"*) cat "${bin}/refs.json" ;;
  *"contents/docs/PHASES.md?ref="*) cat "${dir}/unit-T06.md" ;;
  *"pr list"*) cat "${bin}/prs.json" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`);
      spawnSync("chmod", ["755", path.join(bin, "gh")]);
    };
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: "" };
    const run = (args) => spawnSync(process.execPath, [path.join(dir, "scripts", "devos", "unit.mjs"), ...args], { cwd: dir, encoding: "utf8", env });
    const out = (r, key) => new RegExp(`^${key}=(.*)$`, "m").exec(r.stdout)?.[1];
    // unit-T02 is accepted (its last task ticked on main) and is not read; unit-T06 is complete; a fork's PR and a PR
    // closed on an older head do not count, so the run opens the acceptance PR.
    stub([{ ref: "refs/heads/devos/unit-T02", object: { sha: SHA } }, { ref: "refs/heads/devos/unit-T06", object: { sha: USHA } }],
      [{ number: 7, state: "OPEN", isCrossRepository: true, headRefOid: USHA }, { number: 8, state: "CLOSED", isCrossRepository: false, headRefOid: SHA }]);
    const o = run(["open", "--repo", "o/r"]);
    assert.equal(o.status, 0, o.stderr);
    assert.deepEqual([out(o, "unit"), out(o, "unit_sha"), out(o, "waiting_pr"), out(o, "closed_pr")], ["devos/unit-T06", USHA, "", ""]);
    const p = run(["place", "--main-sha", SHA, "--task", "T07"]);
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual([out(p, "build"), out(p, "accept"), out(p, "unit")], ["false", "true", "devos/unit-T06"]);
    // This repository's PR closed on the unit's head: the unit waits for you to reopen it.
    stub([{ ref: "refs/heads/devos/unit-T06", object: { sha: USHA } }], [{ number: 9, state: "CLOSED", isCrossRepository: false, headRefOid: USHA }]);
    assert.equal(out(run(["open", "--repo", "o/r"]), "closed_pr"), "9");
    assert.deepEqual([out(run(["place", "--main-sha", SHA, "--task", "T07"]), "waiting")], ["true"]);
    // PR-92: its acceptance PR open, its report giving the unit's verdicts: waiting. After /devos revise, T06 passed
    // again (PASS a2): the report is stale and publish renews it. A push that changes no verdict is not judged again.
    const report = "### Tasks\n\n| Task | Name | Risk | Gate | Verdict | Review | Pull request |\n|---|---|---|---|---|---|---|\n" +
      "| T05 | Name T05 | 3 | — | PASS a1 — docs/reviews/T05-a1.md | `docs/reviews/T05-a1.md` | #5 |\n| T06 | Name T06 | 2 | G-Feature | PASS a1 — docs/reviews/T06-a1.md | `docs/reviews/T06-a1.md` | #6 |\n";
    stub([{ ref: "refs/heads/devos/unit-T06", object: { sha: USHA } }], [{ number: 10, state: "OPEN", isCrossRepository: false, headRefOid: USHA, body: report }]);
    const current = run(["open", "--repo", "o/r"]);
    assert.deepEqual([out(current, "waiting_pr"), out(current, "refresh")], ["10", "false"]);
    assert.deepEqual([out(run(["place", "--main-sha", SHA, "--task", "T07"]), "waiting")], ["true"]);
    writeFileSync(path.join(dir, "unit-T06.md"), TABLE({ T01: true, T02: true, T05: true, T06: true }).replace("PASS a1 — docs/reviews/T06-a1.md", "PASS a2 — docs/reviews/T06-a2.md"));
    assert.equal(out(run(["open", "--repo", "o/r"]), "refresh"), "true");
    const renew = run(["place", "--main-sha", SHA, "--task", "T07"]);
    assert.deepEqual([out(renew, "accept"), out(renew, "waiting"), out(renew, "acceptance_pr")], ["true", "false", "10"]);
    writeFileSync(path.join(dir, "unit-T06.md"), TABLE({ T01: true, T02: true, T05: true, T06: true }));
    // A branch with work that is no unit under the setting stops the run instead of being rebuilt beside.
    stub([{ ref: "refs/heads/devos/unit-T05", object: { sha: USHA } }], []);
    const orphan = run(["open", "--repo", "o/r"]);
    assert.equal(orphan.status, 1);
    assert.match(orphan.stderr, /devos\/unit-T05 holds work not on main, and is not a unit under acceptance\.unit=gate/);
  } finally {
    cleanup(dir);
  }
});

test("units.test.mjs the manual, the precedent, the changelog and the defaults name the units", () => {
  const has = (file, text) => assert.ok(read(path.join(root, file)).includes(text), `${file}: ${text}`);
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-91 | **Only your merge reaches main: work lands in units, and a unit is accepted by your merge.**");
  assert.ok(Number(/\*\*Live maximum: PR-(\d+)\.\*\*/.exec(read(path.join(root, "payload/files/docs/method/PRECEDENTS.md")))?.[1]) >= 91);
  has("payload/files/docs/method/AUTOMATION.md", "**Units of acceptance (PR-91).**");
  has("payload/files/docs/method/AUTOMATION.md", "| `unit.mjs` | units of acceptance (PR-91)");
  has("CHANGELOG.md", "- **Only your merge reaches main (PR-91).**");
  assert.equal(JSON.parse(read(path.join(PAYLOAD, "devos", "engine.defaults.json"))).acceptance.unit, "gate");
});
