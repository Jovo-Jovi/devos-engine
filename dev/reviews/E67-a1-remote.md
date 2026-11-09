FIX: test/units.test.mjs loads the scripts with import(pathToFileURL(…).href) instead of import(path.join(…)); the corrected file is in dev/fences/E67/files/test/units.test.mjs. Nothing else changes.

VERDICT: FAIL
Fetched: HEAD @ 5e5bb6a (`E67 a1: builder`) + working tree clean · Commands run: the scope check (the builder's commit
against `dev/fences/E67/files/`), D2, D3, D5 on Linux, D7 through `gh run list` · Refused calls: none

E67 attempt 1 copied the exact-file package (units of acceptance, PR-91) and halted on D1, as the fence's STOP block
says. **The defect is the fence's own:** the package's `test/units.test.mjs` loads `lib.mjs`, `unit.mjs` and
`doctor.mjs` with `await import(path.join(…))`. On Windows an absolute path such as `c:\…` is read as a URL with the
scheme `c:`, Node refuses it (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), and the file registers none of its 13 tests; on Linux
the path starts with `/` and loads, so the reviewer's rehearsal (Linux) and `engine-ci` (Ubuntu) were green. The
builder copied the package byte for byte and changed nothing else; no other row is in doubt.

Ledger: D1 — FAIL — the builder's Windows run: tests 601, pass 572, fail 1, skipped 28 (the fence: tests 613, fail 0);
`units.test.mjs` failed to load. Cause confirmed in the file: `await import(path.join(SCRIPTS, "lib.mjs"))`.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (354 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `25 files, 0 differ`.
Ledger: D4 — PASS (the builder's run; unchanged by this FIX) — 361 files scanned, 133 names checked, `exit 0`.
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.0`.
Ledger: D6 — PASS (the builder's run) — actionlint 1.7.7 exit 0; no workflow changes in this FIX.
Ledger: D7 — PASS — `gh run list` → run 42628664395 on 5e5bb6a, `completed success`.
Ledger: D8 — PASS — the builder's commit against `be33b45` is exactly the 25 package paths and `dev/reports/E67.md`.

Scope: in fence. Nothing outside the package and the report.

Method (payload changes only): unchanged from v1 (PR-91; the manual, the precedent and the changelog as packaged).

Owner attention: none beyond the fence's. The fix touches one test file; no payload file, workflow or count moves.

Next prompt: dev/fences/E67.md (v2, `### Attempt 2 focus`).
