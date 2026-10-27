MERGE

VERDICT: PASS
Fetched: `task/E28` @ 657f561 (no uncommitted changes; `main` @ b399b7c, `Release v1.2.0`) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 2f35c9d HEAD`, `git diff 2f35c9d HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), the manifest's diff, engine-ci run 40517616603 and its jobs, the attempt-1 report · Refused calls: none

E28 fixes the owner's report of 2026-10-27: on hello-cli, Connect sent nothing. Only the `report` job of a `devos-cycle` run with a task asked for the link, and hello-cli has none open. The fix:
- **A link run.** `devos-cycle` with `task=link` builds nothing. `next-task.mjs` says done before it reads `docs/PHASES.md`, and only the `report` job runs and asks. A run with every task PASS asks too.
- **Who starts one.** `devos-advance`'s new `link` job starts one after the link answer (`devos/connect`) is merged. The project page's **Ask the Control Tower now** also starts one. Both only start it when no `devos-cycle` run is queued or going, and never while paused.
- **What stays the same.** The `report` job stays the only one with `id-token: write`, no agent runs, and contract v1 stays true word for word.
- **The page** says "On", not "Linked", and gives the reason when it cannot ask.
- **Version.** Engine 1.2.1, with PR-65 and the manual.

This is a deep review: risk 3, a method change to the job that holds the OIDC permission, and a route that starts a workflow on GitHub. I wrote the package, rehearsed it on a clean copy of `main`, and had it reviewed separately for security; that review's four should-fix items are in it. The 21 copied paths are byte-identical to the package (D3). The builder's commit adds only its report and the rebuilt manifest, which I read, and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 374`, `pass 374`, `fail 0`, `skipped 0`; `tower-ask.test.mjs` (a)–(f) pass. The builder's report on Windows: `tests 374`, `pass 358`, `fail 0`, `skipped 16` (E26c1's 15 and `tower-ask.test.mjs` (d), which runs bash).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `21 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.2.1`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40517616603 on 657f561, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 47 paths:
- the 21 copied paths;
- `payload/manifest.json` and `dev/reports/E28.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E28.md`, `dev/fences/E28/before.json` and the 21 package copies.

Nothing else. The manifest's diff changes `engine_version` (1.2.0 to 1.2.1) and the hashes of the 5 payload files only (12 changed lines). This review and the ledger row are added after it.
Scope: in fence. `payload/contract/CONTRACT.md` and `CONTRACT_VERSION` are unchanged. `id-token: write` appears once, in the cycle's `report` job. The `link` job has `permissions: actions: write`, no checkout and no agent. No dependency.
Method (payload changes only):
- **The non-waivable rules hold.** The human gates are untouched. The roles' surfaces are unchanged. A red check still overrides a PASS, because a link run reaches no check or merge. No secret is in any file. The runner still owns git.
- **Nothing is sent without the developer's yes.** Every path is gated on `DEVOS_REPORTING == 'on'` (PR-62).
- **PR-65** is the next id, and "Live maximum: PR-65".
- **The manual** names the change: §3's `devos-cycle.yml` and `devos-advance.yml` rows (`advance`, `link`), the `report.mjs` row, and §11.
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **Release 1.2.1** with the six steps of `dev/RELEASE.md`. Date the `## 1.2.1` heading on the day of the tag. hello-cli needs 1.2.1 to ask.
2. **Then hello-cli:**
   1. **Upgrade to 1.2.1 by pull request**, and merge it.
   2. **Bring this folder up to date**.
   3. **Ask the Control Tower now**.
   4. Approve the request in the Control Tower's Overview.
3. **A behaviour to know:** with `DEVOS_REPORTING` on, every `devos-cycle` run asks until the link is approved, as task runs already did. A declined repository stops asking only when `DEVOS_REPORTING` is set to `off` (the run's report says so).

Commit message: E28: the Control Tower link without a task to run — a devos-cycle link run (task=link) builds nothing and its report job asks; devos-advance starts one after the link answer is merged, and the project page asks now; engine 1.2.1 (PR-65) — PASS a1
Next prompt: none. Releasing 1.2.1 is yours (`dev/RELEASE.md`). E23b4's fence is on offer after the release, as its ledger row says.
