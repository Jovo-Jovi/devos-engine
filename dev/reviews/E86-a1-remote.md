VERDICT: PASS
MERGE
Fetched: `task/E86` HEAD @ 5e2f2fb (`E86 a1: one registry for the agent tools (builder)`) + working tree (clean), a fresh clone; merge-base with `next` 3ecf68a · Commands run: D1 (`node --test "test/*.test.mjs"`, alone, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`), then `node --test test/progress.test.mjs` once alone (the STOP block's retry), D2 (`node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`), D3 (the byte check), D4 (the staged guards), D5 (`node bin/devos.mjs --version`), D6 (actionlint 1.7.7), D7 (`gh api …/commits/5e2f2fb…/check-runs`), D9 (`git diff --name-only next...HEAD`), D10 (gitleaks 8.24.3) · Refused calls: none

E86 puts each agent tool into one file, `devos/agents/<id>.json` (schema `devos/schemas/agent.schema.json`), read and checked by the new `scripts/devos/tools.mjs`. `run-agent.sh` runs every tool's builder, so the work job's two inline loops (Claude Code, Cursor) are gone, as is `run-agent.sh`'s reviewer branch that nothing called. `plan-agent.sh` runs every review and plan from the registry, and no runner names a tool. The builder's commit is the fence's 44 files byte for byte (35 changed, 9 new) plus its report. Deep review (risk 3, Opus): I read the four registry files, `tools.mjs`, `run-agent.sh`, `plan-agent.sh`, `accounts.sh`, `install-agent.sh`, `role-env.mjs`, `agent-watchdog.sh`, the work job's diff and the manual and precedent rows. The golden test (registry (a)) proves each tool's builder, reviewer, planner and install call exactly what `next` @ 3ecf68a called: same command, arguments, standard input, credential and role files. Its record was made from the base before any change. The registry holds names only, never a value. The watchdog still strips every account slot and runs nothing when it cannot read them.

Ledger: P1/P2/S1 — PASS — the report: `35 as before, 0 new present`, then `35 modified, 9 new, 0 deleted, 0 other`
Ledger: D1 — PASS — the full run here: `tests 739 · pass 738 · fail 1`. The failure was `progress.test.mjs (e)`, outside S1's files: `'… effort high · 2 min · running'` where it expects exactly `1 min`, a tick drifting while `node` starts. That is the E85f a1 flake class: (e) still asserts an exact minute. E86 changes neither `progress.sh` nor `review-user.sh`. Run again once alone, as the STOP block says: `tests 5 · pass 5 · fail 0`. The builder's Windows run: `tests 739 · pass 675 · fail 0 · skipped 64`. engine-ci on Linux: green (D7). `git status --porcelain test/fixtures` printed nothing here (committed); the builder's printed only `?? test/fixtures/agent-calls.json`, as D1 says.
Ledger: D2 — PASS — `manifest up to date (369 files)`; `0 0`
Ledger: D3 — PASS — `44 files, 0 differ`
Ledger: D4 — PASS — `guard:secrets PASS (376 files scanned)`, `guard:manual PASS (139 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no devos/answers.json)`, `exit 0`
Ledger: D5 — PASS — `devos 1.14.0-rc.1`
Ledger: D6 — PASS — actionlint 1.7.7 `exit 0`, no output (the builder ran it through Git bash after PowerShell left the globs unexpanded; noted in its report)
Ledger: D7 — PASS — engine-ci run 46125281265, attempt 1: `checks completed success`, `test (ubuntu-latest) completed success`
Ledger: D8 — N/A — none by the owner's decision (D-E19, amended): the live check runs in E91, whose row lists each tool as builder, reviewer and planner
Ledger: D9 — PASS — `git diff --name-only next...HEAD`: the 44 paths of S1, `dev/reports/E86.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E86.md`, `dev/fences/E86/**` (with this review, `dev/reviews/E86-a1-remote.md`); nothing else
Ledger: D10 — PASS — `no leaks found` (and the builder's gitleaks 8.30.1: `no leaks found`)

Scope: in fence. The builder's commit changes exactly S1's 44 paths and writes its report. Nothing under `dev/fences/E86/` was edited, and no cycle or AI tool ran.

Method (payload changes only):
- PR-106 is the next id, and the live maximum moved to PR-106. It amends PR-45, PR-71, PR-93, PR-99 and PR-101.
- PR-106 also states that the supervisor's and the doctor's second opinions and `loop.mjs` stay Claude Code until E87.
- `AUTOMATION.md` names `tools.mjs`, the registry folder and the new schema (`guard:manual` 139).
- Non-waivable rules unchanged: human gates; role surfaces (the same role kits, proven by the golden record); a red check still overrides PASS; secrets never in files (the registry holds names only); the runner owns git.
- The keys are still named literally in every job: reading them through the registry is E86b.

Owner attention:
- `progress.test.mjs (e)` asserts an exact first minute (line 148) and failed once here under load. It is the E85f a1 flake class again, and a red engine-ci would come from it alone. E86b's row now carries the fix: match `\d+ min` with minutes ≥ 1, as (b) does.
- `devos-supervisor.yml` and `devos-doctor.yml` stop their progress watcher with one `kill`, which is the pattern E86 fixed in `plan-agent.sh`. A lost stop there costs at most the step's limit (15–30 minutes), not a hang. This is old code that E87 rewrites, so it is noted on E87's row.
- Two messages read differently, as the fence says:
  - a builder without its key names the tool and both accounts' secrets, for every tool;
  - an unknown pool tool is listed as `claude, codex, cursor or gemini` (the registry's order).

Commit message: E86: one registry for the agent tools (PR-106) - PASS a1
Next prompt: none yet. As with E86, E86b's exact-file package is built from `next` after this merge, because its P1 names `next`'s commit. On "merged E86 — write E86b" its fence goes on `task/E86b`.
