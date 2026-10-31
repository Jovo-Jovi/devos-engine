FIX: `test/adopt-files.test.mjs`'s `existing()` sets the test repository's own `user.name`, `user.email`, `commit.gpgsign` and `core.autocrlf`, because test (d)'s `devos upgrade --local` commits there and a CI runner has no global git identity. The exact file is in `dev/fences/E36a/files/` (fence v2).

VERDICT: FAIL
Fetched: `task/E36a` @ 07f737a (no uncommitted changes; `main` @ f4dd788) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat a302a82 HEAD`), the manifest's changed entries (old and new `payload/manifest.json` compared by path), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22, with and without a global git identity), D2, D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41242739217 and its failed log, the attempt-1 report, and the deep review of `lib/upgrade.mjs`, `lib/engine.mjs`, `manual.mjs` and the E36a part of `lib/adopt.mjs` · Refused calls: none

E36a lets DEV_OS's files sit beside an existing project's own (PR-69):
- missing files are written, identical ones kept, and `.gitignore` and `.gitattributes` merged;
- the project's CI stays, and DEV_OS's goes to `devos-ci.yml` with the lock entry's `at`;
- any other differing engine file stops the placement;
- `devos upgrade` honours `at`, and `guard:manual` checks DEV_OS's workflows only.

The builder's attempt is exact: every row it can run holds, and the 11 copies are byte-identical. The FAIL is the fence's own defect: a test that needed a global git identity.
Ledger: D1 — PASS on the builder's machine and mine, FAIL on the runner. The builder's report on Windows: `tests 406`, `pass 390`, `fail 0`, `skipped 16`. My run on Linux: `tests 406`, `pass 406`, `fail 0`. On a machine with no global git identity (`HOME` empty, `GIT_CONFIG_GLOBAL=/dev/null`), `adopt-files.test.mjs` (d) fails with `Author identity unknown` from the upgrade's commit, as on the runner.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `11 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — FAIL — engine-ci run 41242739217 on 07f737a, run attempt 1: `checks` `success`, and `test (ubuntu-latest)` `failure`.
- `not ok 4 - adopt-files.test.mjs (d) devos upgrade updates DEV_OS's CI where it lives and never touches the project's`;
- `devos: upgrade failed; rolled back, nothing changed`;
- `fatal: empty ident name (for <runner@…>) not allowed`;
- 405 of 406 pass.

The cause: `existing()` passes `-c user.name=…` to its own git calls only, while `upgrade.test.mjs`'s `initRepo` writes the identity into the repository's config.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 27 paths:
- the 11 paths;
- `payload/manifest.json` and `dev/reports/E36a.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E36a.md`, `dev/fences/E36a/before.json` and the 11 package copies.

Nothing else.
- **The manifest** changes the hashes of `docs/method/AUTOMATION.md`, `docs/method/PRECEDENTS.md` and `scripts/guards/manual.mjs` only, and `engine_version` stays 1.4.0.
- **The deep review holds.**
  - Every disk operation of `devos upgrade` goes through `where()`: the hash, write, remove, restore and staging, plus the rollback's `git reset` and delete.
  - `safeRelative` checks each `at`, and `lockEntries` keeps it.
  - `writeLock` writes `at` only when it is a string.
  - `manual.mjs` without a lock checks every workflow, as before. With one, it names the lock's workflows by their engine path and reads them at `at`.
  - `placeEngineFiles` plans everything before it writes, so a refusal writes nothing. It renames only a top-level `name: ci` line.
Scope: in fence.
Method (payload changes only):
- **The non-waivable rules hold.** The human gates, the roles' surfaces and the runner's git are untouched. The manual still names every part of DEV_OS's automation, and a red check still overrides PASS.
- **PR-69** is the next id, and "Live maximum: PR-69".
- **The manual's** §5 paragraph and `manual` line name the change.
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **The fix (fence v2):** `existing()` writes the repository's own `user.name`, `user.email`, `commit.gpgsign` and `core.autocrlf` after `git init`. I ran the whole suite with no global git identity: 406 tests, fail 0. So no other test depends on one.
2. **Attempt 2 changes one file.** The other ten are already on the branch.

Commit message: none (FAIL).
Next prompt: `dev/fences/E36a.md` v2 on `task/E36a`, with *Attempt 2 focus*.
