FIX: copy fence v3's package again. Two files change, `lib/model-check.mjs` and `test/model-check.test.mjs`:
the model-list refresh compares and names models without their effort or speed ending (`none` to `max`, with or
without `-fast`). Then run D10, the refresh against the real Cursor list. The defect is the fence's own.

VERDICT: FAIL
Fetched: HEAD @ 2b7807d (`E75: attempt 2 — devos models check (1.13.8)`) + working tree clean · Commands run: D2–D6
and D8 on Linux; D1 as the eight changed test files here and the full suite in `engine-ci`; D7 through `gh run view`;
the refresh tool and the judge on the report's `agent models` list through a stand-in `agent` · Refused calls: none

Attempt 2 copied fence v2's package byte for byte: 20 files, 17 changed and 3 new, version 1.13.8. The HALT report of
attempt 1 is committed (`5158b8e`), and attempt 2 is below it. Every Done-when row passes, including the new D9 on the
owner's computer: the check calls the builder's model `current` against the real Cursor list.

Review depth (risk 2): I read every changed line of the package again. I then ran its two tools on the real Cursor
list in the report (276 model ids, model ids only):
- **`devos models check` is right on it.** Through a stand-in `agent` printing that list, `grok-4.7`, `claude-opus-5-5`,
  `claude-sonnet-5-5`, `claude-fable-5-2` and `gpt-5.6-sol` are each `current`. v1 called all five "not offered any
  more", the defect v2 fixed.
- **`tools/models-refresh.mjs` is wrong on it: the defect.** Its Cursor line names 85 "newer" models. 83 of them are
  models the engine already lists, at one effort and speed each (`claude-opus-5-5-max`, `gpt-5.6-sol-none-fast`,
  `grok-4.7-low-fast` …), and `--write` would add them all to `lib/data/tools.json`. Two causes:
  - `newerModels` judged each listed id as it is, so each variant counted as a new line of its family;
  - the effort words stopped at `xhigh`, while Cursor also lists `none` and `max`.

  No Done-when row covered the refresh against a real list. That gap is the fence's, not the builder's.
- **The fix (fence v3).** In `lib/model-check.mjs`:
  - the effort ending covers `none` to `max`;
  - `baseIds` drops the ending;
  - `newerModels` compares and names bases.

  On the same list the Cursor line then names three models: `claude-haiku-5-5-thinking`, `claude-fable-5-1-thinking`
  and `gemini-4-carbon`. The five roles stay `current`.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 9d315d5 2b7807d` on them).

Ledger: D1 — PASS — two runs:
- **Full suite on Linux:** `engine-ci` run 43073135034, job `test (ubuntu-latest)`, gave `# tests 674`,
  `# pass 674`, `# fail 0`, including `ok 393 - model-check.test.mjs (d) …`.
- **Here, the eight changed test files:** `# tests 75`, `# pass 75`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.

The builder's Windows run gave tests 674, pass 632, skipped 42, fail 0, as v2 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `20 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.8`. `node bin/devos.mjs models check --yes` →
`devos: usage: devos models [folder] | devos models check [folder] [--apply] | …`, exit 2.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 43073135034 on 2b7807d (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists, before this review, the 20 paths of S1,
`dev/reports/E75.md`, the 21 files of `dev/fences/E75/`, `dev/LEDGER.md` and `dev/fences/E75.md`, and nothing else.
Ledger: D9 — PASS — the report: `tool current -` on the owner's computer, with `agent models` holding model ids only.

Scope: in fence. The report's only deviation is the owner's shell, as before: actionlint was not on PATH, so the
Windows binary of 1.7.7 ran through Git bash.

Method (payload changes only): N/A. No payload file changes.

Owner attention:
- **Attempt 3 is a copy of two files.** Pull fence v3, copy, and run D1–D6, D9 and D10.
- **D10 runs the refresh on your computer.** Without `--write` it changes nothing; it only prints.
- **What the refresh found in your Cursor list:** `gemini-4-carbon`, `claude-fable-5-1-thinking` and
  `claude-haiku-5-5-thinking` are offered but missing from the engine's Cursor list. After the merge,
  `node tools/models-refresh.mjs --write` adds them on a branch for a pull request.

Next prompt: dev/fences/E75.md (v3)
