VERDICT: PASS — MERGE
Fetched: task/E14 @ 6007ffd (clean tree), main @ 57324bb · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, the D3 Buffer compare, `node tools/verify-source.mjs --tower ../devos-sources/tower`, the three D5 checks, the D6 staged guards, `node --check` on the nine D7 files, `gh run view 40097282460` (with its logs), the three D9 checks (the `screens.test.mjs` self-test, a live run on a Next build, every vendored file against a fresh clone of its source), and `git diff main...HEAD` read outside the 52 exact copies · Refused calls: none

This is the remote check of E14 a1. It is risk 3 and a method change (PR-51), so it is a deep review and the review of record.
- **The copies.** 52 files from `dev/fences/E14/files/` are byte-identical to the fence. They are:
  - the 33 files of `devos/skills/`;
  - `ui-evidence.mjs` and `guards/skills.mjs`;
  - the changed scripts, prompts, method documents, workflow, defaults, catalogue and `tools/sources.mjs`;
  - three tests.
- **The rest of the diff.**
  - `lib/init.mjs` gains only the S2 line `preview: stackEntry.preview ?? "",`, after `commands`;
  - `payload/manifest.json` is generated: 35 new entries (the 33 skill files and the two scripts) and 12 new hashes, 154 files in all;
  - `dev/reports/E14.md` is the report, from Windows: 221 tests, 214 pass, 7 existing skips.
- **The method.**
  - The live maximum is PR-51 and its row is present.
  - The cycle gains one step between the screenshots and the evidence pack, and nothing else in the workflow changes.
  - A red `ui-evidence` or `a11y` check is a failed required check, so it overrides a PASS. The live run shows `all_required_passed: false`.

Ledger: D1 — PASS — `# tests 221` / `# pass 221` / `# fail 0` (Linux). It names `ui-evidence.test.mjs` (a)–(f), `skills.test.mjs` (a)–(f) and `scaffold.test.mjs` (d), 13 lines. CI Windows: `tests 221`, `pass 214`, `skipped 7` (the existing skips).
Ledger: D2 — PASS — `manifest up to date (154 files)` · `0 0`
Ledger: D3 — PASS — `52 files, 0 differ`
Ledger: D4 — PASS — `59 identical, 42 changed (E03, E06, E19, E14, E11, E12, E17, E23a, E08, E15, P1, E18, E20, E02), 53 added (E23a, E02, E19, E20, E14, E06, E15, E18, E08, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D5 — PASS — `1` · `1` · `git diff main...HEAD -- lib/init.mjs` adds the one S2 line and removes nothing
Ledger: D6 — PASS — exit 0; `guard:manual    PASS  (104 names checked)`; `guard:skills    PASS  (12 skills checked, 7 vendored)`. stderr `fatal: not a git repository` comes from a guard run outside git; it was there before E14, as the report notes.
Ledger: D7 — PASS — `node --check` is clean for `lib/init.mjs`, the five payload scripts and the three tests
Ledger: D8 — PASS — run `40097282460` on `6007ffd`, attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` success. `Lint workflows` runs actionlint on `payload/files/dot-github/workflows/*.yml`.
Ledger: D9 — PASS
- **The self-test.** `screens.test.mjs` gives `# tests 8` / `# pass 8`, with `@playwright/test` 1.56.0, `@axe-core/playwright` 4.14.0 and Chromium.
- **The live run.** On a `create-next-app` build served by its `stack.preview`, with this branch's scripts and the fence `Screens: home / · missing /nope`:
  - `screens.mjs --task T02` made 4 captures; `home` has console 0, failed 0, a11y 0, and `missing` has console 1, failed 1;
  - `ui-evidence.mjs --task T02` printed `ui-evidence: FAIL (4)` with the 404 console error and failed request for `missing` at 1280 and 390, and `a11y: PASS — 4 captures`;
  - `ci-results.json` has both as required, and `failed_required: ["ui-evidence"]`.
- **The sources.**
  - The six repositories were cloned fresh at their pinned commits.
  - `30 source files equal their pinned commit, 1 devos files, 0 problems`, by the guard's hash.
  - Each licence file says what `manifest.json` records: Apache-2.0 for `frontend-design` and `impeccable` (with `NOTICE.md`), MIT for the other five.

Scope: in the fence. The 52 copies, the S2 line, the generated manifest and the report; nothing else.
Method (payload changes only):
- **Non-waivable rules.**
  - A red check still overrides PASS (PR-08), and two required checks are added.
  - The human gates, the role surfaces and "runner owns git" are unchanged.
  - No secret is touched.
  - A skill is guidance, never authority (`devos/skills/README.md`, DESIGN_METHOD §7).
- **The precedent.** PR-51, the next id after PR-50.
- **The manual.** `guard:manual` checks 104 names. AUTOMATION names `ui-evidence.mjs`, `guard:skills`, the `ui-evidence` and `a11y` checks and `stack.preview`.

Owner attention:
- (1) **Third-party texts now ship in `payload/`,** under their own licences: Apache-2.0 with a NOTICE, and MIT. The licence decision for v1.0 (D-E4, E10) needs the third-party carve-out: "each folder of `devos/skills/` keeps its own licence".
- (2) **E22f is written:** `dev/fences/E22f.md` and `dev/fences/E22f/`. It is rehearsed on this branch with S1 applied:
  - P2 `20 files, 0 moved`;
  - D1 `# tests 236` / `# fail 0`;
  - D2 and D4 unchanged;
  - D3 `23 files, 0 differ`;
  - its Chromium run is clean.

  It covers points 1, 4–8 and 10 of your report of 2026-10-24.
- (3) **After E22f merges:**
  - drop the stash of the Cursor IDE fix;
  - change `README "Running a task"` in `CLAUDE.md` to `dev/MAINTAINERS.md "Running a task"`.

  The fence repeats both.

Commit message: E14: UI/UX gate part 2 — missing evidence and axe violations fail the required checks ui-evidence and a11y, every UI stack serves its build with stack.preview, licence-aware design skills pinned in devos/skills with an auditable manifest and guard:skills, automated failures apart from design findings (PR-51) — PASS a1
Next prompt: dev/fences/E22f.md
