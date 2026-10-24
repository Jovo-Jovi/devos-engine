VERDICT: PASS — MERGE
Fetched: task/E08 @ aadefa5 (clean tree), main @ 247088f · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, the D5 counts and `git diff origin/main -- …/PRECEDENTS.md`, the D6 Buffer compare, the staged guards (E17's D5 procedure), `node --check` on every changed `.mjs`, `gh run view 40074492756`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E08 a1 (risk 3, a method change; the review of record).
- **The guard.** `guard:design-spec` follows S1 finding for finding:
  - only open fences are checked;
  - a missing `UI_ACCEPTANCE.md` is reported once;
  - `N/A` covers both no `PHASES.md` and no open UI fence.

  It is registered in `run-all.mjs` with exactly the two lines.
- **The texts.** `DESIGN_METHOD.md` and `blueprint.md` match their fence copies. The three prompt edits, the two manual lines, PR-50 and the provenance labels are exact.
- **The engine.** `startProject` writes `project.ui` from the catalogue. `checkBlueprint` requires the two contract files only when `ui` is `true`, and runs `phases,naming,design-spec`.
- **The stubs.** All three write the two files.
- **The deviation.** Test (i) passes `modules: []` for `cli`, as the report says. This was my fence's defect: the rehearsal did the same, but the fence text wrote `flow({ type: "cli" })`. The default flow sends the SaaS module lines, which `cli` does not ask for.

Ledger: D1 — PASS — `# tests 202` / `# pass 202` / `# fail 0` / `# skipped 0` (Linux), `design-spec.test.mjs` (a)–(i) all `ok`; CI windows: only the existing skips
Ledger: D2 — PASS — `manifest up to date (119 files)`
Ledger: D3 — PASS — `0 0`
Ledger: D4 — PASS — `61 identical, 40 changed (E03, E06, E19, E11, E12, E17, E23a, E08, E15, P1, E18, E20, E02), 18 added (E23a, E02, E19, E20, E06, E15, E18, E08, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D5 — PASS — `Live maximum: PR-50` ×1, `| PR-50 |` ×1; the diff removes 1 line and adds 2
Ledger: D6 — PASS — `true true`
Ledger: D7 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (102 names checked)`, `guard:design-spec N/A  (no open UI fence)`
Ledger: D8 — PASS — `node --check` is clean for all seven changed files
Ledger: D9 — PASS — run `40074492756` on `aadefa5`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success

Scope: in the fence.
Method (payload changes only):
- **Non-waivable rules.** None is weakened. The new guard only adds a failure, and the reviewer still judges the captures.
- **PR-50** is at the live maximum.
- **The manual** names the guard and `DESIGN_METHOD.md`: 102 names.
Owner attention:
- (1) **Your local test of 2026-10-24.**
  - **Why `devos` was not found after `npm link`.** On Linux, the same `npm link` writes the `devos` shim. On your computer it went to npm's global folder, which is not where `claude.cmd` lives and is not on PATH.
  - **The fix, E22d.** It removes that step for users. `Start DEV_OS.cmd` (Windows) and `Start DEV_OS.command` (macOS) open the guided page with a double-click, and `devos` and `devos.cmd` run the command from the engine folder.
  - **No folder argument needed.** `devos ui` without a folder lets the page ask for the project's name and where to put it.
  - **A light theme.** It follows the system setting, with a toggle.
- (2) **E14 needs your decision before its fence.** It vendors pinned third-party design skills, so it needs your licence decision (PLAN §10 items 3–6).

Commit message: E08: UI/UX gate part 1 — the design contract for UI projects (DESIGN_SYSTEM, UI_ACCEPTANCE), the design specification and guard:design-spec, DESIGN_METHOD.md and its resource catalogue (PR-50) — PASS a1
Next prompt: dev/fences/E22d.md
