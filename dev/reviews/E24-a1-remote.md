VERDICT: PASS — MERGE
Fetched: task/E24 @ 7abb9d7 (clean tree), main @ ca93a4c · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, the D3 Buffer compare, `node bin/devos.mjs --version`, the three D4 greps, the D5 staged guards, `node --check` and `bash -n` (D6), `gh run view 40120184288` (with its logs), `git diff --name-only main...HEAD`, actionlint 1.7.7 and `shellcheck -S warning` · Refused calls: none

This is the remote check of E24 a1. It is risk 3 and a method change (PR-52), so it is a deep review and the review of record.
- **The copies.** All 26 files are byte-identical to `dev/fences/E24/files/`. They are my texts, read line by line when I wrote and rehearsed them.
- **The manifest** is generated: 155 files, with `scripts/devos/usage.mjs` added.
- **The report** is from Windows: 244 tests, 9 skipped (the 7 existing ones and `usage.test.mjs` (e) and (f)).

Ledger: D1 — PASS — `# tests 244` / `# pass 244` / `# fail 0` (Linux), naming `usage.test.mjs` (a)–(g) and `init.test.mjs` (z) (8 lines). CI Windows: `tests 244`, `pass 235`, `skipped 9`.
Ledger: D2 — PASS — `manifest up to date (155 files)` · `0 0`
Ledger: D3 — PASS — `26 files, 0 differ`
Ledger: D4 — PASS — `devos 0.2.0` · `1` · `1` · `2`
Ledger: D5 — PASS — exit 0, `guard:manual    PASS  (105 names checked)`, and `devos/prices.json` installed
Ledger: D6 — PASS — `node --check` is clean for the four files, and `bash -n` for the three scripts
Ledger: D7 — PASS — run `40120184288` on `7abb9d7`, attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` success
Ledger: D8 — PASS
- **The scope.** `git diff --name-only main...HEAD` lists the 26 paths, `payload/manifest.json`, `dev/reports/E24.md`, and the fence and ledger committed with the fence.
- **The lint.** actionlint is clean, and `shellcheck -S warning` is clean on all three scripts, as before.

Scope: in the fence.
Method (payload changes only):
- **Non-waivable rules.**
  - A record never fails a run: every call ends in `|| true`, and `usage.mjs` catches its own errors.
  - The builder may not edit `docs/usage/**` or `docs/USAGE.md` (surfaces, both builder kits).
  - The runner alone commits the record. No secret is read or written.
  - A red check still overrides PASS, and the gates are unchanged.
- **The precedent.** PR-52, the next id after PR-51.
- **The manual.** `guard:manual` checks 105 names. AUTOMATION §4 names `usage.mjs` and §7 the usage record.

Owner attention:
- (1) **The engine is 0.2.0.** To give a project made earlier the record, run `devos upgrade` in it and merge its `devos/upgrade-0.2.0` pull request.
- (2) **E22g is next:** `dev/fences/E22g.md` and `dev/fences/E22g/`. It is rehearsed on this build:
  - P2 `9 files, 0 moved`;
  - 251 tests;
  - Chromium clean.

  It is what lets hello-cli continue straight to the review.

Commit message: E24: the usage record — every agent run's tokens in docs/usage/<task>.jsonl, totals by model, stage and task in docs/USAGE.md, priced from the tool's own cost or devos/prices.json; engine 0.2.0 (PR-52) — PASS a1
Next prompt: dev/fences/E22g.md
