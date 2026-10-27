FIX: reissue the fence; the defect is the fence's own (fence v2)

VERDICT: FAIL
Fetched: `task/E26a` @ 1019fa3. The builder halted and committed nothing; its report, `dev/reports/E26a.md`, stays on the owner's machine. · Commands run: the halted test reproduced on Linux with `core.autocrlf` true (`GIT_CONFIG_GLOBAL` pointing at a config that sets it): `node --test test/hub.test.mjs` → `not ok 3`, `# pass 4`, `# fail 1`; then the same with the corrected test, with `core.autocrlf` true and unset → `# pass 5`, `# fail 0` · Refused calls: none

Attempt 1 copied the 13 files byte for byte (`13 files, 0 differ`) and halted, as the STOP block asks, on one failing test. The owner relayed the builder's report:
- `hub.test.mjs` (c) failed;
- tests 345, pass 333, fail 1, skipped 11 (the existing Windows skips);
- the manifest check, the specifics check, `devos 1.2.0` and the staged guards passed.

The cause is the fence's test. It compared the cloned `devos/engine.lock.json` byte for byte with an LF text, and `git clone` on the owner's Windows machine (`core.autocrlf` true) checks that file out with CRLF. `lib/hub.mjs` reads the file as JSON, so the product is not affected. Only the assertion was wrong.
Ledger: D1 — FAIL — the relayed report: `hub.test.mjs` (c) not ok, fail 1. Reproduced on Linux with `core.autocrlf` true.
Ledger: D2 — PASS — relayed: `manifest up to date (310 files)` and `0 0`.
Ledger: D3 — PASS — relayed: `13 files, 0 differ`.
Ledger: D4 — PASS — relayed: `devos 1.2.0` and the four staged guard lines.
Ledger: D5 — not run — nothing was committed.
Ledger: D6 — not run — nothing was committed.
Scope: nothing outside the fence was touched; nothing was committed.
Method (payload changes only): N/A — no payload file changes except the manifest's version.
Owner attention: none beyond restoring the tree for attempt 2 (the fence's "Attempt 2 focus").
Next prompt: dev/fences/E26a.md (v2, on `task/E26a`)
