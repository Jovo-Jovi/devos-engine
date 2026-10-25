MERGE

VERDICT: PASS
Fetched: `task/E23c` @ 9f45723 (no uncommitted changes) · Commands run: scope listing (`git diff --name-only main...HEAD`, `git diff --name-only fcbb391 9f45723`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, PR-58 count, `fence-check.mjs` on the fixture T01 in a staged project, staged guards), engine-ci run 40245319733 · Refused calls: none

Attempt 2 of E23c changes the two test files fence v2 names, so that they run git without its background maintenance (the CI runner's git 2.55 raced the folder removal in attempt 1). It also sets the scope tests' `origin/main` with `git update-ref`. Everything else is attempt 1's work, unchanged and verified: D3 over all 37 package files. This is a deep review: risk 3, a method change, and a payload change. I wrote and read every line of the package before issuing the fence. The builder's commit adds only the two test files and its report's `## Attempt 2`, which I read: P3 printed exactly the two expected differences.
Ledger: D1 — PASS — my run on Linux: `tests 293`, `pass 293`, `fail 0`. The builder's report on Windows: `tests 293`, `pass 282`, `fail 0`, `skipped 11`. `guards-structure.test.mjs (f)` is `ok` in both.
Ledger: D2 — PASS — `manifest up to date (308 files)`; `0 0`.
Ledger: D3 — PASS — `37 files, 0 differ`.
Ledger: D4 — PASS — `devos 0.2.6`; `Live maximum: PR-58` → `1`; `fence-check: docs/fences/T01.md OK`; staged guards exit 0 with `guard:manual    PASS  (111 names checked)`, `guard:skills    PASS  (29 skills checked, 18 vendored)` and `guard:fences`, `guard:imports`, `guard:scope` N/A with the expected notes.
Ledger: D5 — PASS — engine-ci run 40245319733 on 9f45723, run attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` all `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 80 paths:
- the 37 copied paths and their 37 package copies;
- `payload/manifest.json` and `dev/reports/E23c.md`;
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E23c.md`, `dev/fences/E23c/before.json` and `dev/reviews/E23c-a1-remote.md`.

Nothing else.
Scope: in fence. No dependency added.
Method (payload changes only): as in the attempt 1 review. No non-waivable rule is weakened. The new guards and `fence-check` only add failures and HALTs. PR-58 is the next id. `AUTOMATION.md` names every new part (`guard:manual` 111 names).
Owner attention:
1. **Existing projects.** After `devos upgrade`, each open fence written before PR-58 makes its next builder run HALT on fence-check once, and the reviewer reissues it with the Builder, Layers and Paths lines.
2. **`usage.test.mjs (e)`** no longer races git on CI.
3. **E23b3 (v1, `task/E23b3`) re-rehearsed against this tree.** Its 23 baseline files and its package do not include either test file changed in attempt 2, and nothing it cites moved. On 9f45723 with its package applied, P2 prints `23 files, 0 moved` and the suite gives `tests 299`, `pass 299`. v1 stands. Merge `main` into `task/E23b3` after this squash, then run it.

Commit message: E23c: fences checked by machine, tasks held to their paths, modules that meet only at their public entries, and a plan of short tasks; engine 0.2.6 (PR-58) — PASS a2
Next prompt: dev/fences/E23b3.md (v1, on `task/E23b3`)
