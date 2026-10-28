MERGE

VERDICT: PASS
Fetched: `task/E31` @ 0e7f82b (no uncommitted changes; `main` @ e23ab0f, `Release v1.3.1`) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git show --stat HEAD`, `git diff --stat be1efb3 HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4, engine-ci run 40666224755 and its jobs, the attempt-1 report · Refused calls: none

E31 answers the owner's question of 2026-10-28: the README did not explain most repository variables, or what a private repository costs in Actions minutes and storage.
- **The README** has two new sections before *Commands*.
  - "Settings you can change on GitHub" says where and how to set a variable and has a table of the everyday ones, with their defaults.
  - "GitHub minutes and storage" says what a private repository uses and how to keep it low.
- **The checklist's sections 8 and 9** link to both, and name `DEVOS_PAUSED` and `DEVOS_SCREENS_RETENTION_DAYS`.

This is a light review: risk 1, documentation only, no payload, script, test or version change. I wrote both files and rehearsed them on a clean copy of `main`. The 2 copied paths are byte-identical to the package (D3). The builder's commit adds only its report and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 382`, `pass 382`, `fail 0`, `skipped 0`. The builder's report on Windows: `tests 382`, `pass 366`, `fail 0`, `skipped 16` (E28's skips); `consent`, `licences` and `privacy` pass.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `2 files, 0 differ`.
Ledger: D4 — PASS — `2 sections, 2 links`.
Ledger: D5 — PASS — engine-ci run 40666224755 on 0e7f82b, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 8 paths:
- `README.md` and `docs/PROJECT-CHECKLIST.md`;
- `dev/reports/E31.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E31.md`, `dev/fences/E31/before.json` and the 2 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No version, changelog or payload change.
Method (payload changes only): N/A, no payload file changed.
Owner attention:
1. **The red engine-ci on `main` @ e23ab0f is not a defect of 1.3.1.**
   - Release step 4 (*Run workflow*) started a second engine-ci on `main` a minute after the `Release v1.3.1` push. engine-ci's concurrency group is one per branch, with `cancel-in-progress`, so it cancelled the push's test job (run 40657561639, attempt 1).
   - That dispatch run, 40657695421 on the same commit, is green on Ubuntu and Windows.
   - The cancelled run was re-run 45 minutes later (attempt 2). It hit a known flake: `continue.test.mjs` (l) could not delete its temporary repository because git's background maintenance was still writing to `.git/objects` (`ENOTEMPTY`).
   - E32 fixes both. Re-running that job is optional.
2. **Merge E31 now.** E31 and E32 both add a ledger row after E30. When I review E32, I bring `main` into `task/E32`, so its squash is clean.

Commit message: E31: the README explains the settings you change on GitHub and GitHub's minutes and storage — a table of the everyday repository variables, a section on what a private repository uses and how to keep it low, and the checklist's sections 8 and 9 link to both — PASS a1
Next prompt: `dev/fences/E32.md` on `task/E32` (the release's Run workflow no longer cancels the push's run, and the tests run git without background maintenance).
