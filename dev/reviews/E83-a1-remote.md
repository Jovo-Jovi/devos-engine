MERGE

VERDICT: PASS
Fetched: HEAD @ 2ab1942 (`E83: build attempt 1`) + working tree clean · Commands run: D1 (the full suite, here, on
Linux), D2–D6 and D9 on Linux, D8 through `gh run view`, the scope and protected-path diffs · Refused calls: none

Attempt 1 is fence v1's 25 exact files, copied byte for byte, and the builder's report. It is version 1.13.15, a
method change with precedent PR-100, and a deep review (risk 3):
- `tools/review-probe.mjs`, the engine maintainer's check of whether a tool still runs a command with its shell off;
- `devos models tool` and the Models panel ask each effort the new tool takes, and choose none;
- the supervisor starts the next open task while main's checks are red, when nothing runs or waits for the owner. The
  act reports on the scan's issue, and a later open supervisor issue is closed with a line naming the oldest;
- a test shows the Keys step asks a Gemini reviewer's and a Codex light reviewer's keys.

The reviewer wrote these files, so the review of record is the byte compare (D3), every Done-when row, and a second
reading of the method lines against the method's non-waivable rules. The builder changed nothing under
`dev/fences/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/` (`git diff --quiet df51478 2ab1942` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite on Linux** (Node 22.23.4): `# tests 702`, `# pass 702`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing, and the probe tests left no `devos-review-probe-*` folder.
- **The builder's Windows run** (Node 24.21.0): tests 702, pass 658, fail 0, skipped 44.
Ledger: D2 — PASS — `manifest up to date (360 files)`; `node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `25 files, 0 differ`.
Ledger: D4 — PASS — the staged guards: `guard:secrets PASS (367 files scanned)`, `guard:manual PASS (135 names
checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`,
`guard:media N/A (no devos/answers.json)`, `exit 0`.
Ledger: D5 — PASS — `devos 1.13.15`; `devos models tool reviewer muse m-1` → `devos: models: "muse" is not a cycle
tool: use cursor, claude, codex or gemini`, exit 2.
Ledger: D6 — PASS — actionlint 1.7.7 (`-color -shellcheck= -pyflakes=`) on the twelve payload workflows and
`engine-ci.yml` exited 0, here and on the builder's Windows.
Ledger: D7 — PASS — the builder's four lines (the owner's Windows, real accounts):
- `review-probe: cursor · grok-4.7-low: holds — it read notes.txt and wrote answer.txt with its file tools, and ran no
  command (exit 0 …)`, Cursor CLI `2026.10.22-27dcf5f`;
- `review-probe: claude · claude-sonnet-5-5 · low: holds — … ran no command (exit 0 …)`, Claude Code `2.1.296`;
- `codex` and `gemini`: not on this computer (exit 4).
Neither required line is exit 2 or 4. The lines are E84's evidence (see Owner attention for what they do not show).
Ledger: D8 — PASS — `engine-ci` run 45583150867 on `2ab1942`, attempt 1: `checks` success, `test (ubuntu-latest)`
success.
Ledger: D9 — PASS — `git diff --name-only main...HEAD` lists 54 paths: the 25 of S1, `dev/reports/E83.md`,
`dev/LEDGER.md`, `dev/fences/E83.md` and the 26 files of `dev/fences/E83/` (25 and `before.json`). Nothing else.

Scope: in fence. The builder's commit `2ab1942` holds the 25 paths of S1 and `dev/reports/E83.md` (26 files).

Method (payload changes only):
- **Human gates:** unchanged. The supervisor still never merges or pushes to main; the next task it starts is one the
  plan already holds, through the same idle action as before. Only the rule that a red main blocks it is gone, by the
  owner's decision of 2026-11-25.
- **Role surfaces:** unchanged. No workflow lets a review run a shell: the cycle still refuses a reviewer on any tool
  but Claude Code (PR-90). E83 adds only the check that E84 needs.
- **A red check overrides PASS:** untouched. A task started on a red main runs its own checks in `work`, and its
  verdict still follows them.
- **Secrets never in files:** the probe's secret is random per run, lives only in the tool's environment, and appears
  in a file only when the tool runs the command (which is the failure it detects). The supervisor's new calls carry no
  token in an argument.
- **The runner owns git:** untouched.
- **Precedent:** PR-100, the next id after PR-99. The live maximum line now says PR-100; it still said PR-98 after E79.
- **Manual (`guard:manual`, 135 names):** no new payload script, workflow, variable, label or command. The new `act
  --issue` option and the issue rule are on row 250. The tool move's efforts are in the `devos models tool` paragraph,
  and the Reviewer role row and the `resolve` step name PR-100.

Owner attention:
- **What D7's "holds" proves, and what it does not.** The secret was not written. That shows a tool with its setting
  on ran no command, but not why. The deny rule may have blocked a call, or the model may have declined on its own.
  E84 adds a control run with the shell allowed, which must say `fails`, before a tool counts as checked.
- **Codex and Gemini are unchecked** (not on your computer). Until someone signed in runs the check, E84 refuses them
  as reviewer, with that reason.
- **A closed duplicate issue's comments leave the counts per cause** (`max_auto_per_key`, PR-70). The actions recorded
  only on the later issue are forgotten, so one cause can be retried up to that many more times. This was a one-time
  case: learn-coptic's #7.
- **Two pairs of test letters repeat** in `hardening.test.mjs`. The new (n) and (o) share their letters with PR-97's and
  PR-98's tests, though not their names. E84 renames them (p) and (q).
- **Release 1.13.15 after the merge**, then in learn-coptic: upgrade, close #7 if the supervisor has not, and keep the
  reviewer on Claude Code until E84.

Commit message: E83: any tool may review once its no-shell run is checked; the next task on a red main; one supervisor issue — PASS a1
Next prompt: dev/fences/E84.md (on `task/E84`, from main after this merge)
