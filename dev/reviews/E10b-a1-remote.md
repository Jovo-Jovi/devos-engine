MERGE

VERDICT: PASS
Fetched: `task/E10b` @ 7a1f326 (no uncommitted changes; `main` @ 4976a01 merged in at ae80659) · Commands run: scope listing (`git diff --name-only main...HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40322990866 and its jobs, the builder commit's manifest diff and report · Refused calls: none

E10b licenses the engine for its release.
- `LICENSE` is the PolyForm Shield License 1.0.0, byte for byte, followed by the required notice.
- `payload/files/devos/LICENSE.md` (MIT) is installed as `devos/LICENSE.md`, so the manifest has 310 files.
- `LICENSES.md` maps each file to its licence: fonts OFL-1.1, the vendored skills' own licences, installed files MIT, everything else Shield.
- `THIRD_PARTY_NOTICES.md` lists the IBM Plex fonts and the 18 vendored skills.
- `CHANGELOG.md`, the README's licence section and version 1.0.0.
- `test/licences.test.mjs` (a)–(f).

This is a standard review: risk 2, no rule of the method changed. The 13 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence, including two negative checks: a changed licence text fails (a), and a removed notice row fails (c). The builder's commit adds only `payload/manifest.json` (engine version 1.0.0 and the `devos/LICENSE.md` entry, from S2) and its report, which I read.
Ledger: D1 — PASS — my run on Linux: `tests 325`, `pass 325`, `fail 0`, `skipped 0`; `licences.test.mjs` (a)–(f) are `ok 168`–`ok 173` and `devos --version prints devos 1.0.0` is `ok 325`. The builder's report on Windows: `tests 325`, `pass 314`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `13 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.0.0`; the install prints `devos install 1.0.0: 310 engine files, 4 templates, devos.config.json written`, and `devos/LICENSE.md` exists; the guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (113 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40322990866 on 7a1f326, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists the 13 copied paths, `payload/manifest.json`, `dev/reports/E10b.md`, and the reviewer's `dev/fences/E10b.md`, `dev/fences/E10b/before.json` and the 13 package copies. Nothing else. This review and the ledger rows are added after it.
Scope: in fence. No dependency added. No vendored skill file, contract text or engine code changed.
Method (payload changes only): the payload gains one file, `devos/LICENSE.md`, a licence notice. No rule of the method changes, so no precedent row is needed and `guard:manual` still checks 113 names. Every vendored skill keeps its licence and notice files (test (c)).
Owner attention:
1. **A lawyer reads `LICENSE`, `LICENSES.md`, `THIRD_PARTY_NOTICES.md` and `devos/LICENSE.md` before the release** (D-E4). The holder is `Jovo-Jovi`, provisional until you verify who holds the rights (your decision of 2026-10-26). A change touches one line in `LICENSE`, one in `payload/files/devos/LICENSE.md`, its allow-list entry, and the holder in `test/licences.test.mjs` (a) and (b). The hash in (a) covers only the licence text before the notice, so it does not change.
2. **Your E10c decisions are in the ledger:**
   - E10b2, the narrowly scoped privacy task, comes before E10c. Its fence waits for the facts only you can give.
   - E10c keeps the history and scans it for secrets.
   - Kept history also keeps every past file, so moving private material out of the tree today does not take it out of a public history. That is for you to decide before E10c.

Commit message: E10b: licences and notices — PolyForm Shield 1.0.0 for the engine, MIT for the files it installs, every third-party notice kept, the changelog; engine 1.0.0 — PASS a1
Next prompt: none yet — dev/fences/E10b2.md is written on the owner's privacy facts (ledger row E10b2)
