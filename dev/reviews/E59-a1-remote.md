VERDICT: PASS
MERGE
Fetched: `task/E59` @ b2f6486 (`E59 a1: builder`), clean tree, over `main` @ 0dd6f96 · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?head_sha=b2f6486…`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD`, and `git diff --stat 99e225e HEAD -- dev/fences dev/LEDGER.md` · Refused calls: none

E59 is the dependency gate (PR-85, engine 1.10.0), Node first:
- **The fence line.** `- Dependencies:` names every package a task may add, or says `none`. `fence-check` checks
  each name, an empty line and a repeat, and a fence without the line names none.
- **`guard:deps`** (`scripts/guards/deps.mjs`, in `run-all.mjs`):
  - a package a `package.json` gains that the line does not name fails the task;
  - whenever a manifest or `pnpm-lock.yaml` changed, `pnpm audit` blocks high and critical advisories, and an
    audit that does not answer (asked twice) or a missing lockfile fails too;
  - a copyleft licence is a note, never a failure;
  - a manifest the task creates is the scaffold's;
  - N/A without `TASK`, without the fence, or for another toolchain.
- **The text.** The prompts, skills, fence auditor, handbook §6.3 and `AUTOMATION.md` say so.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of 0dd6f96 (551 tests). D3 proves the branch holds exactly those bytes, and the fence and
ledger are as issued. The builder's commit changes the 27 files and its report only. Read again on the branch:
- **Tests:** the five new tests put a `pnpm` stub first on `PATH` (a `.cmd` on Windows), so none runs a real
  `pnpm`, reads a key or reaches the network.
- **Audit command:** `pnpm audit` runs with an argument list, and through a shell only on Windows, where `pnpm` is a
  `.cmd`; its arguments are fixed.
- **Untrusted text:** package names and advisory titles come from the project and the registry and appear only in
  the guard's findings and note, never in a command or a path.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 551`, `# pass 551`, `# fail 0`; the five `deps-gate.test.mjs` tests are ok.
  The builder's Windows run: tests 551, pass 531, fail 0, skipped 20, the allowed count; the five new tests passed
  there too.
- D2 — PASS — `manifest up to date (316 files)`; `0 0`.
- D3 — PASS — `27 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (323 files scanned)`, `guard:manual PASS (124 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.10.0`.
- D6 — PASS — `engine-ci` run 42413724245 on b2f6486, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success with `# tests 551`, `# pass 551`, `# fail 0`.
- D7 — PASS — the 27 paths of S1, `dev/reports/E59.md`, `dev/LEDGER.md`, `dev/fences/E59.md` and
  `dev/fences/E59/**` (28 files: the 27 and `before.json`): 58 paths. Nothing else.

Scope: in the fence. No dependency; no workflow changes.

Method (payload changes only):
- Non-waivable rules: none is weakened. The gate only adds a red check, and a red check overrides PASS as before.
  - An audit waiver needs the owner's recorded decision (PR-85, the reviewer prompt), so it is a human gate, not a
    reviewer's call.
  - Secrets, role surfaces and the runner owning git are untouched; the guard reads files and runs `pnpm audit`, and
    writes nothing.
- Precedent: PR-85 was added, and the live maximum is now PR-85; `deps-gate.test.mjs` (e) pins both, and
  `adopt-handover.test.mjs` (f) no longer pins the maximum.
- Manual: the new guard `deps` is in `AUTOMATION.md`'s guard list, so `guard:manual` checks 124 names; no new
  script outside the guards, setting, variable, label or command.

Owner attention:
- **Release 1.10.0 when you choose** (`dev/RELEASE.md`): after this merge, or together with E60.
- **Projects pick the gate up with `devos upgrade`.** From then on, a task that adds an unnamed package fails
  `guard:deps`, and its reviewer reissues the fence with the package named when it is needed. The first task that
  changes the dependencies of a project with old high or critical advisories must fix or waive them (Mawsim, on 1.4.x,
  will meet this when it upgrades).
- **The audit needs the registry.** A task that changes the dependencies while the npm registry does not answer
  fails `guard:deps` until it answers (asked twice), by design: the gate is never passed unseen.
- **A test run flips six `test/fixtures/agents/*` files to mode 755** on Linux (an older test's chmod), as noted at
  E58b; the reviewer restored them.
- **Next:** E60, the Models panel, fenced on `task/E60` from `main` once you merge this.

Commit message: E59: the dependency gate — every fence names the packages its task may add (- Dependencies:); guard:deps fails an unnamed package a package.json gains and, when the dependencies change, a high or critical pnpm audit advisory (waiver: pnpm.auditConfig with the owner's recorded decision); copyleft licences are a warning; Node first; engine 1.10.0 (PR-85) — PASS a1
Next prompt: none on this branch. E60 is fenced on `task/E60` from `main` once you merge E59.
