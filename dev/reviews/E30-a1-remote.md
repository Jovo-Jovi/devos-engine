MERGE

VERDICT: PASS
Fetched: `task/E30` @ 9df774e (no uncommitted changes; `main` @ d10c9b9, `Release v1.3.0`) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --name-only 94261cb HEAD`, `git diff 94261cb HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), the manifest's diff, engine-ci run 40655488644 and its jobs, the attempt-1 report · Refused calls: none

E30 follows the owner's decision of 2026-10-28, made after GitHub's 90% Actions storage warning: only the screenshots need a short life.
- **Screenshots.** A cycle run's PNGs (`.devos/screens/*.png`) now go to an artifact of their own, `devos-<task>-a<attempt>-screens`, kept `DEVOS_SCREENS_RETENTION_DAYS` days (3 when unset). That upload has `continue-on-error`, so it never fails a run.
- **The rest of the evidence.** `motion.json`, the logs, the results, the journal and `ci-evidence` keep the repository's own retention, without the PNGs and without `.devos/*.env`.
- **What still reads the evidence.**
  - The report job downloads the evidence artifact by its unchanged name.
  - The gate doctor reads only `ci-results.json` and `logs/` from `ci-evidence`.
- **The rest.** Engine 1.3.1, with PR-67 and the manual. The history test no longer pins the precedents' live maximum.

This is a standard review: risk 2, two upload steps and the manual, no script, and the job with `id-token: write` untouched. I wrote the package and rehearsed it on a clean copy of `main`. The 13 copied paths are byte-identical to the package (D3). The builder's commit adds only its report and the rebuilt manifest, which I read, and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 382`, `pass 382`, `fail 0`, `skipped 0`; `artifacts.test.mjs` (a)–(c) pass. The builder's report on Windows: `tests 382`, `pass 366`, `fail 0`, `skipped 16` (E28's skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `13 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.3.1`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40655488644 on 9df774e, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 31 paths:
- the 13 copied paths;
- `payload/manifest.json` and `dev/reports/E30.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E30.md`, `dev/fences/E30/before.json` and the 13 package copies.

Nothing else. The manifest's diff changes `engine_version` (1.3.0 to 1.3.1) and the hashes of the 4 payload files only (10 changed lines). This review and the ledger row are added after it.
Scope: in fence. No script, no other upload, and no capture setting changes. No dependency.
Method (payload changes only):
- **The non-waivable rules hold.** The human gates, the roles' surfaces and the runner's git are untouched. A failed screenshots upload cannot fail a run or override a check. No secret is in any file, and `.devos/*.env` no longer reaches an artifact.
- **PR-67** is the next id, and "Live maximum: PR-67".
- **The manual** names the change: the run scratch bullet and `DEVOS_SCREENS_RETENTION_DAYS` in §8 (`guard:manual` 117).
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **Release 1.3.1** with the six steps of `dev/RELEASE.md`. Date the `## 1.3.1` heading on the day of the tag. Each project gets the change with **Upgrade to 1.3.1 by pull request**.
2. **Your current repositories:** clean their old artifacts with `cleanup-artifacts.mjs`, one repository at a time. Set a shorter "Artifact and log retention" where the workflows do not come from the engine: the Control Tower, devos-pilot and B2S.

Commit message: E30: screenshots are kept 3 days — a cycle run's PNGs go to their own artifact (DEVOS_SCREENS_RETENTION_DAYS, 3); the rest of the evidence and ci-evidence keep the repository's retention, without PNGs or .env files; engine 1.3.1 (PR-67) — PASS a1
Next prompt: none. Releasing 1.3.1 is yours (`dev/RELEASE.md`). E23b4's fence is on offer after the release, as its ledger row says.
