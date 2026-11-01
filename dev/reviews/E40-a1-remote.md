MERGE

VERDICT: PASS
Fetched: `task/E40` @ 11cacb4 (no uncommitted changes; `main` @ 57582b9, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat d01ca30 HEAD`), the manifest diff, D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), actionlint 1.7.7 on the payload and engine workflows, engine-ci run 41305936936 and its jobs, the attempt-1 report · Refused calls: none

E40 is PR-70. A project's cycle run waited for hours with nothing running: one of its checks hung, GitHub stopped the job at its time limit as `cancelled`, and the supervisor, which acts only on `failure`, left it there.
- **`run-checks.mjs` gives every check a time limit** (`check_timeout_minutes`, 30) within a budget for all of them (`checks_budget_minutes`, 60).
  - A stopped check is ended with everything it started: its process group on POSIX, and a final kill on exit.
  - It is recorded as `timeout`, with its log and a note naming the setting.
  - A check the spent budget leaves out is recorded as not started.
  - The Supabase steps have the same limits.
  - Playwright's browser install has 10 minutes and its own log (`e2e-install.log`).
  - Ctrl-C or `SIGTERM` stops everything and writes no results.
- **The supervisor reads GitHub's note** ("exceeded the maximum execution time") on a cancelled `cycle` job.
  - If the note cannot be read, it falls back to the job's run time against the cycle's `timeout-minutes`.
  - A run stopped that way gets its attempt dispatched again. That is review-only when the builder's work was pushed.
  - A run someone cancelled is left alone.
  - Its workflow gains `checks: read`, and its counts per cause read every page of the issue's comments.

**The review depth is deep (risk 3).** As with every Engine package, I wrote `dev/fences/E40/files/` and reviewed it line by line before issue. Independent security reads found real gaps, each fixed in v1 and confirmed: a leftover child holding the output open, stdin, the annotations' permission, the comment history's pages, the Supabase limits, the exit on a signal, the fallback, the `ETIMEDOUT` match, and pid reuse on Windows. D3 proves the branch's 10 copies are byte-identical to that package. The builder's commit adds only those copies, the manifest and its report.
Ledger: D1 — PASS — my run on Linux: `tests 419`, `pass 419`, `fail 0`, `skipped 0`; `time-limits.test.mjs` (a)–(f) all `ok` (6 matched). The builder's report on Windows: `tests 419`, `pass 401`, `fail 0`, `skipped 18`. The skips are E28's 16, plus `time-limits.test.mjs` (d) and (f), each listed by name with its reason.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `10 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41305936936 on 11cacb4, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`. My own actionlint run on the payload and engine workflows also passes.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 25 paths, nothing else:
- the 10 copied paths, `payload/manifest.json` and `dev/reports/E40.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E40.md`, `dev/fences/E40/before.json` and the 10 package copies.

The manifest diff changes the 6 payload hashes only (`6 insertions(+), 6 deletions(-)`). **The deep review confirms:**
- **A required `timeout` fails the checks, so red still overrides PASS (PR-08).** `failedRequired` counts every status but `pass` and `skipped-no-package`, in both the Node and the other-toolchain paths. `devos-cycle.yml` gates on `all_required_passed`, and `evidence.mjs` lists every non-pass row.
- **The supervisor never re-dispatches a run someone cancelled.** `stoppedRun` admits a `cancelled` run only when `timeLimit(runId).hit`, which looks only at jobs named `cycle`. Test (d) gives no incident for three cancelled runs: one with no note (102), one stopped after 20 minutes when its note cannot be read (105), and a wait the owner stopped (106).
- **The incident is keyed once per attempt.** The key is `<task>:a<attempt>:time-limit`, and the action is the existing `redispatch`; no new action or label.
- **The only new permission is `checks: read`** in `devos-supervisor.yml`. Its other lines are unchanged.

This review and the ledger tick are added after it.
Scope: in fence. No other workflow, no `supabase.mjs`, no `lib/`, no version change, no dependency.
Method (payload changes only):
- non-waivable rules: human gates, role surfaces, red overrides PASS, no secrets in files, and the runner owns git; none is weakened;
- the precedent is PR-70, the next id (`Live maximum: PR-69` on `main`, `PR-70` here), written generically;
- the manual: `AUTOMATION.md` §4 names the time limits in the `run-checks.mjs` row and the time-limit rule in the supervisor row, and §8 names `check_timeout_minutes` and `checks_budget_minutes` (PR-70);
- `guard:manual` passes with 117 names.
Owner attention:
1. **New projects get it on install; existing projects get it on `devos upgrade`.** The project that hit this gets PR-70 when it adopts the engine (E38), or when its own copy is changed by hand. Until then, a hung check there still waits for its 150-minute job limit.
2. **30 and 60 minutes are defaults.** A project whose real checks take longer raises `check_timeout_minutes` or `checks_budget_minutes` in `devos.config.json`. A check that times out says which setting to raise.
3. **The fallback is a guess.** When GitHub's note cannot be read, a cancelled run whose job ran within a minute of its limit is treated as stopped. A person who cancels a run in its last minute would see it dispatched once more.
Commit message: E40: a check that hangs fails, it never holds the cycle — every check has a time limit (check_timeout_minutes 30) within a budget (checks_budget_minutes 60), stopped with everything it started and recorded as timeout with its log; the e2e browser install has 10 minutes and a log; the supervisor re-dispatches a cycle run GitHub stopped at its time limit (review-only when the builder's work was pushed) and leaves a cancelled one alone; checks: read for the supervisor (PR-70) — PASS a1
Next prompt: `dev/fences/E36c.md`, refreshed to v2 against `main` after this merge (CHANGELOG.md and the test count move), as E40's ledger row says.
