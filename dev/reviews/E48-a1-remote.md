MERGE

VERDICT: PASS
Fetched: `task/E48` @ 6b3861b (no uncommitted changes; `main` @ e9d076a) · Commands run: scope listing (`git diff --name-only origin/main`), every changed file compared byte for byte with the reviewer's rehearsal (the fence's texts applied to e9d076a by script), every changed line of `lib/`, `scope.mjs` and the tests, `writeProjectReadme` on a README without a final newline, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 41908191740 and its jobs, `tools/release-check.mjs` on a copy with 1.5.0 dated · Refused calls: none

E48 makes the product README part of the method (PR-77).
- **The blueprint writes it** for the people who use or try the product: what it does, features, screenshots, getting started, what it is built with, status.
- **Setup keeps it.** It adds `## How this project is built` once, and writes today's README when there is none.
- **Every task that builds a feature or changes a screen keeps it current**, as its fence says. Both reviewers write that step into their fences: the runner's prompt and the handbook the chat reviewer reads.
- **No task deletes it.** The runner's builder prompt, the IDE builder's Cursor rule, both reviewers and the blueprint say so. `guard:scope` fails a task that deletes a README its base has, even when the fence's Paths allow the root. That is the hole Mawsim's T01 went through (mawsim 3ab4ede: its own fence asked `ls README.md` to fail).

**The review depth is deep (risk 3, a method change).**
- **The method texts match the rehearsal byte for byte:** the three prompts, the handbook, the Cursor rule, PRECEDENTS (PR-77, live maximum PR-77), AUTOMATION.md, the changelog and `describeDoc`.
- **The code is the builder's own:**
  - `guard:scope`'s finding is the rehearsal's; only `baseHas` sits above `scope()` instead of below it;
  - `blueprintFiles` is the same behaviour, written with `unshift`;
  - `projectReadme` is byte for byte today's output (`chosen.test.mjs` untouched).

Ledger: D1 — PASS — my run on Linux: `tests 486`, `pass 486`, `fail 0`, `skipped 0`, with no `not ok`. The four new tests are `ok`. The builder's report on Windows: `tests 486`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only origin/main` lists the fence's paths and nothing else.
Ledger: D4 — PASS — `devos 1.5.0`. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41908191740 on 6b3861b, attempt 1: `checks` success, `test (ubuntu-latest)` success.
Ledger: D6 — PASS — every changed line:
- **No rule is weakened.** No surface's deny list or `ALWAYS_ALLOWED` changes, so a fence still names `README.md` in its Paths to change it. `guards-structure.test.mjs (e)` is untouched.
- **A project whose blueprint writes no README gets exactly today's README.**
- **`guard:scope` adds only the deletion finding.** Its N/A cases and note are unchanged.

Scope: in fence.
Method (payload changes): every change adds a duty or a check, and none is taken away.
- PR-77 is the next id.
- `guard:manual` stays at 120 names.
- The new texts never name a project or a person.
- Existing projects get the rule with `devos upgrade`.

Owner attention:
- **Two small follow-ups, for the next engine task** (ledger, Follow-ups from reviews). Neither changes what a user sees, so neither fails the task.
  - **A duplicate test letter, the fence's own defect.** The fence named the new scope test `guards-structure.test.mjs (i)`, but an `(i)` already existed (PR-73, source roots); the reviewer read only to `(h)`. Both pass, and their titles differ. The new one becomes `(j)`.
  - **A missing blank line.** `writeProjectReadme` replaces trailing whitespace with `/\s+$/`, so a README with no final newline gets `## How this project is built` on the very next line, not after a blank line. S8 asked for one `\n` in every case. GitHub still renders it as a heading.
- **Mawsim** gets PR-77 with `devos upgrade`. Its README is still deleted: restoring it is a change request in Mawsim.
- **1.5.0 is ready to release** after this merge (`dev/RELEASE.md`). `tools/release-check.mjs` passes on a copy with `## 1.5.0 — <date>`: `release check: ok (363 files scanned)`. The `## 1.4.5 — Unreleased` heading below it was never tagged; its changes ship in 1.5.0.

Commit message: E48: the blueprint writes the product README, every task that builds a feature or changes a screen keeps it current, and guard:scope fails a task that deletes it; engine 1.5.0 (PR-77) — PASS a1
Next prompt: none. Next: the 1.5.0 release (the owner, `dev/RELEASE.md`), then Medix.
