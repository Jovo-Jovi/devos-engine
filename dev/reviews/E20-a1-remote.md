VERDICT: PASS — MERGE
Fetched: task/E20 @ 7392836 (clean tree), main @ d4262bb · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 counts and `includes` check, the four D6 Buffer compares, `node --check` on every changed `.mjs`, the D5 staged guards, `gh run view 40031840868`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E20 a1 (risk 3, a method change; the review of record).
- **Stage 0.** The non-Node path of `run-checks.mjs` no longer deletes ignored files, and its cleanup is now the Node path's `dirtied` restore exactly. Test (h) asserts that `app-bin` is gone, that `.venv/x` stays ignored, that the status is clean, and that the list is `["app-bin"]`.
- **Stage 1.** The catalogue and defaults match their fence copies. `devos init` copies `scaffold` into `project.stack`, with a new `create` array, and test (b) proves it reaches `devos.config.json`.
- **Stage 2.**
  - The blueprint's step 6 carries the T01 rule.
  - The PR-49 row is in place.
  - The `AUTOMATION.md` `stack` sentence names `scaffold`.
  - The README describes T01, and its roadmap follows the owner's order.
- **The report's note about the manifest is fine.** The builder rebuilt it during Stage 1 so the upgrade test would not see the new defaults as a local edit, and rebuilt it again after the provenance tags.

Ledger: D1 — PASS — `# tests 171` / `# pass 171` / `# fail 0` / `# skipped 0` (Linux)
Ledger: D2 — PASS — `manifest up to date (117 files)`
Ledger: D3 — PASS — `61 identical, 40 changed (E03, E06, E19, E11, E12, E17, E23a, E15, P1, E18, E20, E02), 16 added (E23a, E02, E19, E20, E06, E15, E18, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-49` ×1, one `| PR-49 |` row, `includes` → `true`
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true true true true`
Ledger: D7 — PASS — `node --check` is clean
Ledger: D8 — PASS — run `40031840868` on `7392836`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success

Scope: in the fence.
Method (payload changes only): no non-waivable rule changed. T01 still goes through the builder surface, the reviewer and the human gate. PR-49 is at the live maximum, and the manual is updated. There are no new names, so the count stays at 101.
Owner attention:
- (1) **The generator flags are unproven.** They are today's documented flags and have not run for real. T01's rule says the generator's current documentation wins, and the change is reported. E21's real run proves them.
- (2) **E22 is split in two.** E22a builds the engine side and a secure local server, with plan mode, prompt markers and a token-guarded API. E22b ports Engine B's page and animations onto it. Engine B's server had no token, Origin check or Host check, so E22a specifies a new server instead of porting it.

Commit message: E20: T01 is the scaffold — a recipe per stack (generator, health route, logger, test runner, architecture rule), T01 builds no feature and starts green (PR-49) — PASS a1
Next prompt: dev/fences/E22a.md
