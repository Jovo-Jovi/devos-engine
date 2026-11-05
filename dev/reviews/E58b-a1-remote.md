VERDICT: PASS
MERGE
Fetched: `task/E58b` @ 53e7995 (`E58b a1: builder`), clean tree, over `main` @ 14bb921 · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?head_sha=53e7995…`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD`, and `git diff --stat fb8e5cb HEAD -- dev/fences dev/LEDGER.md` · Refused calls: none

E58b is the way back from a handover (PR-84, engine 1.9.0). `devos adopt` on a project `devos init --local` handed
over (its tracked `devos/answers.json` records `handover`, and it has no lock) now:
- surveys it as `handover` instead of `partial`, and stops before the brief on a `devos/project.json` without its key
  or agents, a differing file with an engine file's name, a ledger DEV_OS cannot take (a tick after an open task, a
  task id that is not `Tnn`, an existing `Tnn-a0.md`), or a first open task whose fence is not committed;
- writes the brief from the plan, with no AI tool, for the developer's yes;
- keeps the plan, the templates (with the cycle's agents) and the developer's answers (without `cycle: local`, the
  handover kept in `adopted.handover`); `docs/method/` becomes the engine's with the project's PR-01, and the
  project's precedents stay beside only when it has a ruling of its own;
- accepts the tasks ticked as built after a yes, as attempt 0 (`docs/reviews/Tnn-a0.md`, `PASS a0`), and writes
  `CLAUDE.md` from `lib/data/handover-claude.md`, the cycle's `SETUP.md` and the README section;
- checks the resume fence with `fence-check` once DEV_OS's files are placed, and its pull request says the cycle
  resumes from `Tnn`.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of 14bb921 (546 tests, and `devos init --local` → a task built outside DEV_OS → `devos adopt`
to its pull request). D3 proves the branch holds exactly those bytes, and the fence and ledger are as issued. The
builder's commit changes the 10 files and its report only. Read again on the branch:
- **Writes:** every handover write into the worktree goes through `writePlain`/`plainFile` (a link throws, and the
  branch is dropped); task ids are checked `^T\d{2}$` before they name a file, and the pull request posts task ids
  only.
- **Commit contents:** the reviews, the ledger, the README and `CLAUDE.md` are force-added with DEV_OS's files, and
  `devos/project.json` and `SETUP.md` are in the late list, so the stray-path checks pass only for what devos wrote.
- **The other paths:** the AI-brief and older-copy adoptions keep their exact behaviour (the doc-round loop now ends
  on `passed`, the same condition for them; `keepBrief` keeps every message); all 17 existing `adopt-install`, 19
  `adopt` and 6 `adopt-files` tests pass unchanged.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 546`, `# pass 546`, `# fail 0`; the six `adopt-handover.test.mjs` tests are
  ok. The builder's Windows run: tests 546, pass 526, fail 0, skipped 20, the allowed count; the six new tests passed
  there too.
- D2 — PASS — `manifest up to date (315 files)`; `0 0`.
- D3 — PASS — `10 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (322 files scanned)`, `guard:manual PASS (123 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.9.0`.
- D6 — PASS — `engine-ci` run 42121632859 on 53e7995, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success with `# tests 546`, `# pass 546`, `# fail 0`.
- D7 — PASS — the 10 paths of S1, `dev/reports/E58b.md`, `dev/LEDGER.md`, `dev/fences/E58b.md` and
  `dev/fences/E58b/**` (11 files: the 10 and `before.json`). Nothing else.

Scope: in the fence. No dependency; no workflow, script or guard changes.

Method (payload changes only):
- Non-waivable rules: none is weakened.
  - Human gates: a handed-over project's stage is `production` when the survey says so, so its critical paths stop at
    the gate as in any adoption; the generated `CLAUDE.md` restates that risk 3 and gated tasks wait for the owner.
  - Red check overrides PASS, secrets never in files, role surfaces and the runner owning git are untouched; the
    adoption still runs every guard before its commit, with the baseline.
  - Attempt 0 is the owner's own acceptance, typed at the adoption, and PR-84 says it is never a DEV_OS attempt.
- Precedent: PR-84 was added, and the live maximum is now PR-84; `adopt-handover.test.mjs` (f) pins both, and
  `handover.test.mjs` (c) no longer pins the maximum.
- Manual: no new script, guard, variable, label or command; one bullet in `AUTOMATION.md` §5, and `guard:manual`
  still checks 123 names.

Owner attention:
- **Release 1.9.0 after the merge** (`dev/RELEASE.md`): date the changelog heading, `release check: ok`, gitleaks over
  the whole history, `engine-ci` with Windows on `main`, then tag `v1.9.0`. E58a and E58b ship together.
- **The readings in the fence's "For the owner"** are yours to change, chiefly: `CLAUDE.md` written by devos from a
  template rather than by an AI round, and the stage `production` when the survey says so.
- **A test run flips six `test/fixtures/agents/*` files to mode 755** on Linux (an older test's chmod); the reviewer
  restored them. Nothing to commit; a follow-up could make the test copy them first.
- **Next:** E59, the dependency gate, fenced on `task/E59` from `main` once you merge this.

Commit message: E58b: the way back from a handover — devos adopt brings a handed-over project back with no AI tool: brief from the plan, plan, settings and agents kept, docs/method/ the engine's with its PR-01, ticked tasks accepted as attempt 0 after a yes, CLAUDE.md from a template, resume from the first open task whose committed fence passes fence-check; engine 1.9.0 (PR-84) — PASS a1
Next prompt: none on this branch. E59 is fenced on `task/E59` from `main` once you merge E58b.
