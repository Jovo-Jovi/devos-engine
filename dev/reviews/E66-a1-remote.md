MERGE

VERDICT: PASS
Fetched: HEAD @ f91e590 (`E66: hygiene - every CLI at a pinned version, no agent's raw output kept, main protected
(PR-93) - attempt 1`) + working tree clean · Commands run: D1–D6 and D8 on Linux, D7 through `gh run view` and
`gh api` · Refused calls: none

E66 attempt 1 copied the package of v1 byte for byte: 27 changed files and 2 new ones, plus the report.
- **The package (PR-93):**
  - every npm CLI the workflows install is at the exact version `tool_versions` pins, read by the new `pins.mjs`;
  - Cursor's agent is installed by version, its SHA-256 checked before it is unpacked;
  - the three third-party actions are pinned by commit;
  - no artifact keeps an agent's raw output (D9);
  - `devos init` gives a new project a read-only workflow token and the `devos-main` ruleset, best effort (D4);
  - the dark theme's faint text reads at 4.81:1 or more (L3);
  - the Windows command line refuses `%` and `"` (L4), with Codex's effort argument and the probes adjusted.
- **Who wrote it:** the reviewer, rehearsed on a copy of `main` and on this branch. One independent review found 1
  blocker, 3 should-fixes and 5 nits; each is fixed and tested, or kept with a reason in the fence.

Review depth (risk 2, a method change): every row was rerun here, and the copied files equal the package (D3), so
every changed line is the reviewed line; I read them all again in `git diff main...HEAD`. The builder changed nothing
under `dev/fences/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/` (`git diff --quiet 8d0d539 f91e590` on
them).

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` on Linux:
- `# tests 645`, `# pass 645`, `# fail 0`;
- the 7 tests of `hygiene.test.mjs` are all `ok`;
- `git status --porcelain test/fixtures` printed nothing.
The builder's Windows run: tests 645, pass 613, skipped 32, fail 0, as v1 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (356 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `29 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (363 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.0`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `gh run view 42692954095` → `headSha f91e590`, `attempt 1`, `conclusion success`; jobs
`checks` success, `test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists only:
- the 29 paths of S1;
- `dev/reports/E66.md`;
- the 30 files of `dev/fences/E66/` (the 29 and `before.json`);
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E66.md` and this review.

Scope: in fence. The report's deviations are the owner's shell only: PowerShell, so the git commands ran one by one
and the actionlint globs were expanded through Git bash; and actionlint as the Windows binary of 1.7.7.

Method (payload changes only):
- **The precedent:** PR-93 follows PR-92, the live maximum, and amends PR-33 and PR-67.
- **The manual:** `AUTOMATION.md` names `pins.mjs` and `tool_versions`, adds the pinned-versions invariant, and says
  no artifact keeps an agent's raw output. `guard:manual` passes with 135 names.
- **Non-waivable rules, none weakened:**
  - Human gates are kept, and `main` gains the ruleset PR-13 assumes, with `devos/verdict` required.
  - Role surfaces are untouched.
  - A red check still overrides a PASS.
  - No secret goes in a file, and less agent output is kept.
  - The runner owns git: no new push, and the runner still never merges into `main` (PR-91).

Owner attention:
- **Your own pull requests into `main`** (`devos upgrade`, `devos models`, one made by hand) carry no
  `devos/verdict` once a project has the ruleset; merge them as an admin with "bypass rules" (limitation 3).
- **Only projects made by `devos init` from now on get the ruleset;** adopted and earlier projects have none
  (limitation 4).
- **Cursor's pin is trust on first use,** and its version is four days old (limitation 1). uv, Go and Flutter still
  follow their stable release (limitation 7).
- **Untried on GitHub** until the live tests: the ruleset call, Cursor's download and the pinned installs. The fence's
  "For the owner, after the merge" says what to look for.

Commit message: E66: hygiene — every CLI at a pinned version, no agent's raw output kept, main protected (PR-93) — PASS a1
Next prompt: none. The four tasks are done; the final audit check comes next, on your word.
