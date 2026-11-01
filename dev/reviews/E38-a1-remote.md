MERGE

VERDICT: PASS
Fetched: `task/E38` @ a5bdfc1 (no uncommitted changes; `main` @ 5cc9ed5, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --name-only b0e02c4 HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41321972072 and its jobs, the attempt-1 report · Refused calls: none

E38 is D-E13's step 6: `devos adopt` now adopts an older, hand-copied DEV_OS.
- **What counts as a copy.** It tracks both DEV_OS's cycle workflow and its scripts, and has no engine lock. A project with only some of those files is `partial`, and stops.
- **What becomes the engine's.** Its method files are replaced where they are. Those the engine no longer ships, in DEV_OS's own folders, are removed and named.
- **What stays.** Its documents, `CLAUDE.md` and own rules stay. `devos.config.json` becomes the smallest `devos/project.json`; the role surfaces stay DEV_OS's, and a setting that would take away a rule stops the adoption.
- **The precedents.** DEV_OS's precedents bind, with the copy's PR-01, and the copy's file is kept beside them for reference.
- **When.** It is adopted only between tasks.

**The review depth is deep (risk 3).** As with every Engine package, I wrote `dev/fences/E38/files/` and reviewed it line by line before issue. Three independent security reads came first:
- the first failed it: writes through tracked links, a copy's own CI removed, one marker making a copy, settings that took away a rule;
- the second found two more defects;
- the third passed the fixes.

v1 closes them all, as the fence lists. D3 proves the branch's 6 copies are byte-identical to that package. The builder's commit adds only those copies and its report.
Ledger: D1 — PASS — my run on Linux: `tests 437`, `pass 437`, `fail 0`, `skipped 0`. All 6 new tests are `ok`: `adopt.test.mjs` (n)–(q), and `adopt-install.test.mjs` (z) and (aa). The builder's report on Windows: `tests 437`, `pass 417`, `fail 0`, `skipped 20`, the skips the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `6 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41321972072 on a5bdfc1, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 16 paths:
- the 6 copied paths and `dev/reports/E38.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E38.md`, `dev/fences/E38/before.json` and the 6 package copies.

There is no `payload/` path. The deep review, done on the package and proved identical by D3, confirms:
- every write of the copy path stays inside the worktree, and every path devos writes is a link target;
- only files in DEV_OS's method folders that the engine does not ship are removed, never `devos-ci.yml`;
- no setting of the copy's takes away a rule of DEV_OS's, and the surfaces are DEV_OS's;
- a project that is not a copy is adopted as before.

This review and the ledger tick are added after it.
Scope: in fence. No payload file, `lib/install.mjs`, `lib/upgrade.mjs`, workflow or version change. No dependency.
Method (payload changes only): N/A. No payload file changes.
Owner attention:
1. **Adopting the Control Tower** (after the release):
   - run `devos adopt` between tasks, and merge its pull request quickly, since the old copy's supervisor can still start a cycle;
   - read the removed files and the kept settings the pull request names;
   - carry over any ruling of its own from `docs/method/before-adopt/PRECEDENTS.md`.
2. **It was built without reading the Tower,** as you chose. The real copy may differ from the test fixtures; any surprise stops the adoption with a message, and nothing is written to `main` before you merge.
Commit message: E38: adopting an existing project, step 6 — an older copy of DEV_OS (its cycle workflow and scripts tracked, no engine lock) keeps its documents, CLAUDE.md and settings; its method files become the engine's and those no longer shipped are removed; devos.config.json becomes the smallest devos/project.json (role surfaces stay DEV_OS's, a setting that takes away a rule stops it); DEV_OS's precedents bind with its PR-01; adopted only between tasks; every path devos writes is a link target (D-E13) — PASS a1
Next prompt: `dev/fences/E39.md` (the guided page), written next, as E39's ledger row says.
