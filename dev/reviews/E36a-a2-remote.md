MERGE

VERDICT: PASS
Fetched: `task/E36a` @ d9418a3 (no uncommitted changes; `main` @ f4dd788) · Commands run: scope listing (`git diff --name-only main...HEAD`), attempt 2 against fence v2 (`git diff --stat d60458c HEAD`, and its report's attempt 1 unchanged: 0 removed lines), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22, with no global git identity: `HOME` empty, `GIT_CONFIG_GLOBAL=/dev/null`), D2, D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41244858568 and its jobs, the attempt-2 report · Refused calls: none

E36a lets DEV_OS's files sit beside an existing project's own (PR-69, D-E13 step 4a):
- missing engine files are written, identical ones kept, and `.gitignore` and `.gitattributes` merged;
- the project's CI stays, and DEV_OS's goes to `devos-ci.yml` with the lock entry's `at`;
- any other differing engine file stops the placement before anything is written;
- `mergeAgentFile` keeps the project's text first;
- `devos upgrade` honours `at`, and `guard:manual` checks DEV_OS's workflows only.

Attempt 2 changes exactly the file of fence v2's *Attempt 2 focus*: `existing()` writes the test repository's own git identity. It also appends its report. The fence, the ledger and the review of attempt 1 are as I wrote them. The deep review of attempt 1's lines (`dev/reviews/E36a-a1-remote.md`) stands, and the code is byte-identical to the package (D3).
Ledger: D1 — PASS — my run on Linux with no global git identity: `tests 406`, `pass 406`, `fail 0`, `skipped 0`; `adopt-files.test.mjs` (a)–(e) pass. The builder's report on Windows: `tests 406`, `pass 390`, `fail 0`, `skipped 16` (E28's skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `11 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41244858568 on d9418a3, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`. That is the row attempt 1 failed.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 28 paths:
- the 11 paths;
- `payload/manifest.json` and `dev/reports/E36a.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E36a.md`, `dev/fences/E36a/before.json`, the 11 package copies and `dev/reviews/E36a-a1-remote.md`.

Nothing else. The manifest changes the hashes of `docs/method/AUTOMATION.md`, `docs/method/PRECEDENTS.md` and `scripts/guards/manual.mjs` only. This review and the ledger tick are added after it.
Scope: in fence. No other guard, workflow, `init`, `setup` or version change. No dependency.
Method (payload changes only):
- **The non-waivable rules hold.** The manual still names every part of DEV_OS's automation, and a red check still overrides PASS.
- **PR-69** is the next id, and "Live maximum: PR-69".
- **The manual** names the change in §5.
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **Your projects are unaffected.** Their locks have no `at`, so upgrades and `guard:manual` behave as before.
2. **E36b is next:** the install on a `devos/adopt` branch, with the documents written from your brief and the baseline. Your own checkout is not touched.

Commit message: E36a: adopting an existing project, step 4a — DEV_OS's files sit beside a project's own: missing ones written, identical ones kept, .gitignore and .gitattributes merged, the project's CI kept and DEV_OS's placed at devos-ci.yml (lock `at`, honoured by devos upgrade), any other differing engine file refused; CLAUDE.md merge with marked lines; guard:manual checks DEV_OS's workflows only (PR-69, D-E13) — PASS a2
Next prompt: `dev/fences/E36b.md`, written after this PASS on `task/E36b`, as its ledger row says.
