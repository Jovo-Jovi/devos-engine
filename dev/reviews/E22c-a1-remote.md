VERDICT: PASS — MERGE
Fetched: task/E22c @ f012e16 (clean tree), main @ e99082b · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `git diff --stat origin/main...HEAD -- payload`, the D3 compare, the D4 image check, the D5 greps and `node --check lib/ui/app.js`, `gh run view 40049560299`, a Chromium run and a README render for D7, and `git diff origin/main...HEAD` read in full (the copied texts by compare) · Refused calls: none

This is the remote check of E22c a1 (risk 1: the README as a product page, and the DEV_OS mark on the guided page; the review of record).
- **The copy.** Sixteen files are copied unchanged:
  - the README;
  - the two logo files and nine screens;
  - four page texts.

  Nothing else changed, apart from the report.

Ledger: D1 — PASS — `# tests 193` / `# pass 193` / `# fail 0` / `# skipped 0` (Linux); CI windows: only the existing skips
Ledger: D2 — PASS — `manifest up to date (117 files)`; the payload diff is empty
Ledger: D3 — PASS — `true` ×16
Ledger: D4 — PASS — `11 true`
Ledger: D5 — PASS — `git grep -nE "\.listen\("` prints only `lib/ui-server.mjs:503: server.listen(port, "127.0.0.1", …)`; `innerHTML` prints nothing; `node --check lib/ui/app.js` is clean
Ledger: D6 — PASS — run `40049560299` on `f012e16`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success
Ledger: D7 — PASS — Chromium against this branch and the harness stubs: a full run ends on "Your project is on GitHub" with `errors: 0`, and the bar shows the triangle mark. The README rendered in GitHub's light and dark styles shows the logo, the badges, the hero screen, the feature grid and the gallery.

Scope: in the fence.
Method (payload changes only): none; the payload diff is empty.
Owner attention:
- (1) **The next fence, E08 v2, is re-rehearsed** (it was written on 2026-10-19).
  - **Its precedent** is PR-50.
  - **Its blueprint text** is rebased on today's prompt.
  - **The design contract** now applies only to project types with a web interface: the catalogue's `ui` flag, which `devos init` writes into `devos/project.json`.
  - **The numbers.** 202 tests, a manifest of 119 files, 102 names in the manual check, and a new `verify-source` line.
  - **The rehearsal** in a scratch copy passed every Done-when row.

Commit message: E22c: the README as a product page — the DEV_OS mark, colour badges, why and how, eight real screens; the guided page takes the same mark — PASS a1
Next prompt: dev/fences/E08.md (v2)
