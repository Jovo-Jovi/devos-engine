FIX: reissue the fence (v2). Three files change: `.github/workflows/engine-ci.yml`, `test/engine-ci.test.mjs` and `dev/MAINTAINERS.md`. Reviewer-only commits start no run, a task branch runs the Linux tests only, `main` adds Windows, and the tests run four files at a time. Nothing else changes.

VERDICT: FAIL
Fetched: `task/E23b3` @ f7105f0 (no uncommitted changes) · Commands run: scope listing (`git diff --name-only main...HEAD`, `git diff --name-only d17ed59 f7105f0`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, PR-59 count, staged guards), engine-ci run 40288101361 with its jobs, annotations and the Windows job's log · Refused calls: none

E23b3 ships the design reference library (`DESIGN_METHOD.md` §5: 27 libraries with licences and defaults, what good looks like for the 16 product types, ten galleries), keeps the developer's screenshots in `docs/design/references/` with `docs/design/REFERENCES.md`, gives every project a Direction of its own, and makes a redesign a change request. This is a deep review: risk 3, a method change, and a payload change. The 24 copied paths are byte-identical to the package (D3); I wrote and read every line of that package before issuing the fence. The builder's commit adds only `payload/manifest.json` (rebuilt by S2, 8 lines, identical to the rehearsal) and its report, which I read. The branch also carries the owner's merge of `main` (d17ed59), as the fence asked.
Ledger: D1 — PASS — my run on Linux: `tests 299`, `pass 299`, `fail 0`. `design-library.test.mjs` (a)–(c), `plan.test.mjs (h) screenshots up to 1 MB are design references; other images and bigger files are refused (PR-59)` and both PR-59 `init.test.mjs` tests are `ok`. The builder's report on Windows: `tests 299`, `pass 288`, `fail 0`, `skipped 11`.
Ledger: D2 — PASS — `manifest up to date (308 files)`; `0 0`.
Ledger: D3 — PASS — `24 files, 0 differ`.
Ledger: D4 — PASS — `devos 0.2.7`; `Live maximum: PR-59` → `1`; staged guards exit 0 with `guard:manual    PASS  (111 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — FAIL — engine-ci run 40288101361 on f7105f0: `checks` success, `test (ubuntu-latest)` success, `test (windows-latest)` cancelled, with the annotation `The job has exceeded the maximum execution time of 15m0s`.
- No test failed. The log shows `ok 1` to `ok 271`, the last at 08:03:10, and the cancel at 08:03:55.
- The Windows job had grown to 13.2–14.5 minutes on E23c's last runs (40245319733, 40246720286, 40246970160). This fence's six tests took it past the limit.
- On a private repository the runner has 2 CPUs, so `node --test` runs one file at a time.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 53 paths:
- the 24 copied paths and their 24 package copies;
- `dev/fences/E23b3.md`, `dev/fences/E23b3/before.json` and `dev/fences/E23b3/RESEARCH.md`;
- `payload/manifest.json` and `dev/reports/E23b3.md`.

Nothing else.
Scope: in fence. No dependency added; no library code or gallery content copied.
Method (payload changes only): no non-waivable rule is weakened. Human gates, role surfaces, a red check overriding PASS, secrets never in files and the runner owning git are untouched. The builder still may never change `docs/design/**`; only the intake gains `docs/design/REFERENCES.md`. A screenshot link in an issue is listed, never fetched. `checkBlueprint` only adds a requirement (`REFERENCES.md` naming every screenshot). PR-59 is the next id. `AUTOMATION.md` §6 names the new paths (`guard:manual` 111 names).
Classification of non-PASS items: FENCE DEFECT — the defect is the fence's own (PR-09). The fence relied on a Windows job already within a minute of its 15-minute limit. The builder did everything the fence asked.
Owner attention:
1. **Attempt 2 is the CI change you approved on 2026-10-26.** Measured on October's 115 runs:
   - 50 were commits that changed only `dev/` (fences, reviews, the ledger). They will start no run.
   - 36 were code commits on task branches. They drop the Windows job, the costly one (a Windows minute counts as two).
   - 29 were pushes to `main`. They keep all three jobs.
   - The tests run four files at a time. On 2 CPUs, as on the runner, the suite takes 123–131 s against 250 s.
   - Together, about 70% fewer counted minutes for engine work.
2. **Windows evidence before a merge** is now the builder's own D1 run, which the report gives. `main` runs Windows after each merge. To run it on a task branch, use the Actions tab, `engine-ci`, *Run workflow*.
3. **This run's cancelled Windows job** still counted about 30 minutes. My push of this review says `[skip ci]`, because this branch still has the old workflow until attempt 2.
4. **E23d is reissued v2 on `task/E23d`.** Only D5 changes (two jobs); its 19 baseline files and its package do not touch the three attempt-2 files. Re-rehearsed on f7105f0 with attempt 2 applied: P2 `19 files, 0 moved`, `tests 301`, `pass 301`.
Next prompt: dev/fences/E23b3.md (v2, on `task/E23b3`)
