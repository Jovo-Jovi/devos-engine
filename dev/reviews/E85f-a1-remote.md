VERDICT: FAIL — FIX: reissue the fence (v3); the defect is the fence's own
FIX: D7 failed. On the builder's commit, engine-ci's `test (ubuntu-latest)` failed on its first run, 733 of 734. The
failing test is `progress.test.mjs` (b), from E85e, not E85f's code. Attempt 2 copies fence v3's package: the same 15
files, plus `test/progress.test.mjs` and `test/review-job.test.mjs`, whose timing no longer depends on how fast
`node` starts. Nothing else changes.
Fetched: `task/E85f` @ 98fa783 (from `next` @ ce9202a) + working tree clean · Commands run: D1, D2, D3, D4, D5, D6,
D9, D10 on a clean clone; D7 from GitHub's API (run 45896303244); the watcher tests with a slow `node`; a byte compare
of the 15 files with the reviewer's build · Refused calls: none

The builder copied fence v2's 15 exact files byte for byte. The topics now come from the fence's own words, only the
required skill files are read whole, a later attempt's review gets `.devos/diff-since-a<N-1>.patch`, and publish
posts the attempt's usage. This was a deep review (risk 3, a method change). Every changed line under `payload/`
and `test/` was read, and those files are byte-identical to the build that passed 734 tests here. The one failure is
outside E85f: `progress.test.mjs` (b) asserts the exact minute of the watcher's second line. A test minute is one
second, the clock counts whole seconds, and each line also waits for `node` to start (`progress.sh line`), so the second
tick drifts by that start time. With `node` slowed by 0.45 s, the test failed 2 runs in 4, exactly as on GitHub: it
printed `3 min` where it expected `2 min`. On a real run a minute is 60 s, and the drift is a few seconds an hour.
The same drift makes two more tests borderline: `progress.test.mjs` (e) and `review-job.test.mjs` (h) need a second
line before a 2.5 s or 2.6 s fake agent ends.

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` (Linux, alone, no git identity): `# tests 734` · `# pass 734` ·
`# fail 0`; the builder's Windows run: 734 / 671 / 63 skipped (60 + the 3 bash cases of `cheaper-reviews`)
Ledger: D2 — PASS — `manifest up to date (363 files)` and `0 0`
Ledger: D3 — PASS — `15 files, 0 differ`
Ledger: D4 — PASS — secrets 370, manual 138, config current, skills 29 / 20 vendored, media N/A, `exit 0`
Ledger: D5 — PASS — `devos 1.14.0-rc.1`
Ledger: D6 — PASS — actionlint 1.7.7 over the 14 workflows: exit 0, no output
Ledger: D7 — FAIL — engine-ci run 45896303244 on 98fa783: `checks` success, `test (ubuntu-latest)` failure,
`# pass 733` · `# fail 1`: `not ok 459 - progress.test.mjs (b) the watcher prints a line a minute…`, actual
`reviewer · codex gpt-5.5-codex · effort high · 3 min · review file 2 KB`, expected `… · 2 min · …`
Ledger: D8 — none (E91, by the owner's decision; the E91 row lists E85f's live checks)
Ledger: D9 — PASS — `git diff --name-only next...HEAD`: the 15 paths of S1, `dev/reports/E85f.md`, and the reviewer's
files (`dev/LEDGER.md`, `dev/fences/E85f.md`, `dev/fences/E85f/**`); the builder's commit touches only its 16 files
Ledger: D10 — PASS — gitleaks: `no leaks found`
Scope: in the fence. The builder's commit changes the 15 files of S1 and its report, nothing else.
Method (payload changes only):
- No non-waivable rule is weakened:
  - human gates, the role surfaces and "a red check overrides PASS" are unchanged; the attempt-2 prompt says a red or
    missing required check fails the attempt whatever the last review said, and `checks` still decides in publish;
  - no secret is in a file;
  - the runner owns git: `diff-since` is written by main's `publish-verify.mjs` in the review job, and the reviewer only
    reads it;
  - publish's new step runs main's `usage.mjs` with no AI and no token. Its text comes from records that `cleanUsage`
    rebuilt (`tool` `[a-z]+`, `model` `[A-Za-z0-9._:/@+-]+`), and `docs/usage/**` is outside the builder's surface,
    so no line break can reach the notice.
- Precedent PR-105 is the next id (live maximum PR-105).
- `AUTOMATION.md` names `review-tree`'s new file, `usage.mjs notice`, publish's step *What this attempt used*, and the
  skills rules.
Owner attention:
- The flaky test is already in `next` (E85e). Any task's engine-ci can fail on it until fence v3's two test files merge.
  Re-running would likely turn it green, but D7 asks for the first run, and the fix costs one copy.
- The defect was the fence's own: its package relied on a test that only passes on a fast runner.
Next prompt: dev/fences/E85f.md (Fence version 3, `### Attempt 2 focus`)
