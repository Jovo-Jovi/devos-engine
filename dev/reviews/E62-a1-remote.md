VERDICT: FAIL
FIX: attempt 2 copies the reissued package (fence v2): the handbook drops "the BETK edition" and `find-specifics` refuses `BETK` (the owner's decision of 2026-11-09, 01:41). The build itself has no defect.
Fetched: `task/E62` @ eeb0c19 (`E62 a1: builder`), clean tree, over `main` @ 2e1fac1 · Commands run: D1 `node --test "test/*.test.mjs"` and `git status --porcelain test/fixtures`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare and `existsSync('tools/verify-source.mjs')`, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?head_sha=eeb0c19…`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD`, `git diff --name-only 3a90481 eeb0c19` and `git diff --stat 3a90481 HEAD -- dev/fences dev/LEDGER.md` · Refused calls: none

E62 is the last open follow-ups before the next client project (PR-89, engine 1.12.0):
- **The Claude Code builder streams** (`stream-json --verbose`). The watchdog reads its tool calls for the last
  action and keeps the final result where `json` put it. The builder's report gives its plan, latest note and totals.
  The usage record counts a stream stopped before its result.
- **`devos upgrade`** names a version that is not a release in one line. Its rollback puts back an engine file `HEAD`
  does not track, and a removed one no longer fails `git add`.
- **The handbook names no client;** `find-specifics` refuses the client's names.
- **Wording:** `FULLSTACK_MODULE.md`, seven setup items' steps, `AUTOMATION.md`'s settings table, PR-26 and an intake
  comment.
- **The rest:** `tools/verify-source.mjs` deleted; PLAN §3 and §5, D-E14 and D-E15.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of 2e1fac1 (579 tests; each new test failed on 2e1fac1's code). D3 proves the branch holds
exactly those bytes, and the fence and ledger are as issued. The builder's commit changes the 22 files, deletes
`tools/verify-source.mjs` and adds its report: 24 paths, nothing else.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 579`, `# pass 579`, `# fail 0`. Afterwards, `git status --porcelain
  test/fixtures` prints nothing. The builder's Windows run: tests 579, pass 555, fail 0, skipped 24, the allowed
  count. Of the ten new tests, the git-hook rollback test and `followups.test.mjs` (a) were skipped there; the other
  eight passed.
- D2 — PASS — `manifest up to date (348 files)`; `0 0`.
- D3 — PASS — `22 files, 0 differ`; `false`.
- D4 — PASS — `guard:secrets PASS (355 files scanned)`, `guard:manual PASS (127 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.12.0`.
- D6 — PASS — `engine-ci` run 42536346154 on eeb0c19, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success with `# tests 579`, `# pass 579`, `# fail 0`.
- D7 — PASS — the 22 paths of S1, `tools/verify-source.mjs`, `dev/reports/E62.md`, `dev/LEDGER.md`,
  `dev/fences/E62.md` and `dev/fences/E62/**` (23 files): 49 paths. Nothing else.

Scope: in the fence. No dependency.

Method (payload changes only):
- Non-waivable rules: none is weakened.
  - Human gates and red check overrides PASS: untouched. The builder's output format changes, not how it is judged.
    The limit, unusable-model and server-error checks read the same final result object, and a stopped stream's end,
    as they do for Cursor (PR-54).
  - Secrets never in files: the watchdog still removes `DEVOS_PROGRESS_TOKEN` and the GitHub tokens from the agent's
    environment. The kept stream holds only what the builder printed, as Cursor's does.
  - Role surfaces and the runner owning git: untouched. The Claude builder's allowed and denied tools are the same.
- Precedent: PR-89 was added, and the live maximum is now PR-89. `followups.test.mjs` (f) pins both;
  `readiness.test.mjs` (f) no longer pins the maximum.
- Manual: no new script, guard, variable, label or command; `guard:manual` checks 127 names. The `agent-watchdog.sh`
  and `builder-report.mjs` rows describe Claude Code's stream.

Owner attention:
- **Why FIX on a clean build:** the fence asked you whether "the BETK edition" (DEV_OS v1's name) should go. Your
  answer (2026-11-09, 01:41: "go too") came after the build. The defect is the fence's own, and attempt 2 is that one
  change:
  - the handbook's two lines say "Dev OS v1";
  - `find-specifics` refuses `BETK`;
  - D-E14, PR-89, the changelog bullet and `followups.test.mjs` (d) say so.
  Everything a1 built stays. The package is reissued whole (v2), so D3 still proves the whole task.
- **After the MERGE of attempt 2:** release 1.12.0 (it carries 1.11.0's changes), then open the new chat with your
  audit. The kickoff doc in the project is up to date for it.

Next prompt: `dev/fences/E62.md` v2, attempt 2.
