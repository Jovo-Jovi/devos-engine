MERGE

VERDICT: PASS
Fetched: `task/E29` @ c11d9ea (no uncommitted changes; `main` @ 133b92d, `Release v1.2.1`) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --name-only b244134 HEAD`, `git diff b244134 HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), the manifest's diff, engine-ci run 40568294138 and its jobs, the attempt-1 report · Refused calls: none

E29 answers the owner's request of 2026-10-27: a linked project shows its phases, tasks and completeness in the Control Tower.
- **What a link run sends.** Once the Tower has approved the link, a link run's `report` job sends one event for each task of `docs/PHASES.md`:
  - `verdict pass` for a finished task, dated by the commit that added its review;
  - `intake pass` for a task still to do.
- **How.** The events form one run, `import-<the plan's commit>`. They are paced under the Tower's limit, and the OIDC token is renewed.
- **The checkout** is exact: only the four paths `report.mjs` reads, with the plan's history read for paths and dates only.
- **Contract version 2** says that a link run sends the plan, before it is accepted. The plan goes only to a project that accepted version 2, and a project linked under version 1 accepts it by the same pull request as its link.
- **The engine** is 1.3.0, with PR-66 and the manual.

This is a deep review: risk 3, the job that holds `id-token: write`, and the contract. I wrote the package and rehearsed it on a clean copy of `main`. I also checked out a sparse, blob-less copy of hello-cli with the same patterns, ran `history --dry` on it, and rendered the page in Chromium. A separate security review read the first draft; its should-fix items are in the package. The 22 copied paths are byte-identical to the package (D3). The builder's commit adds only its report and the rebuilt manifest, which I read, and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 379`, `pass 379`, `fail 0`, `skipped 0`; `report-history.test.mjs` (a)–(e) pass. The builder's report on Windows: `tests 379`, `pass 363`, `fail 0`, `skipped 16` (E28's skips); `report-history.test.mjs` (a)–(e) pass there too.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `22 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.3.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40568294138 on c11d9ea, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 49 paths:
- the 22 copied paths;
- `payload/manifest.json` and `dev/reports/E29.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E29.md`, `dev/fences/E29/before.json` and the 22 package copies.

Nothing else. The manifest's diff changes `engine_version` (1.2.1 to 1.3.0) and the hashes of the 4 payload files only (10 changed lines). This review and the ledger row are added after it.
Scope: in fence. `id-token: write` appears once, in the cycle's `report` job. No task name or file content is sent: the events have the contract's ten fields, and `report-history.test.mjs` (a) asserts every git call. No dependency.
Method (payload changes only):
- **The non-waivable rules hold.** The human gates and the roles' surfaces are untouched. A link run reaches no check or merge. No secret is in any file. The runner still owns git.
- **Nothing is sent without the developer's yes.** Every send needs `DEVOS_REPORTING` on (PR-62), and the plan also needs the contract's version 2.
- **PR-66** is the next id, and "Live maximum: PR-66".
- **The manual** names the change: the `devos-cycle.yml` row of §3 and the `report.mjs` row (`history`).
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **Contract version 2 is yours.** Merging this publishes version 2 with its one added sentence (`payload/contract/CONTRACT.md`). Every linked project accepts it again before its plan is sent; today that is hello-cli only.
2. **Release 1.3.0** with the six steps of `dev/RELEASE.md`. Date the `## 1.3.0` heading on the day of the tag.
3. **Then hello-cli:**
   1. **Upgrade to 1.3.0 by pull request**, and merge it.
   2. **Read the contract**, tick the box, **Accept by pull request**, and merge it. The merge starts a link run.
   3. The Tower's HELLO-CLI card shows `2 of 2` tasks, phase P02.
4. **Optional, the Tower:** these events arrive as `ci`. A Tower change could store `import-*` runs with the `import` source.

Commit message: E29: a linked project's plan reaches the Control Tower — a link run sends one event per task of docs/PHASES.md (verdict pass, or intake pass for a task to do), paced, from an exact checkout; contract version 2; engine 1.3.0 (PR-66) — PASS a1
Next prompt: none. Contract version 2 and the release of 1.3.0 are yours (`dev/RELEASE.md`). E23b4's fence is on offer after the release, as its ledger row says.
