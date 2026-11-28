VERDICT: PASS
MERGE
Fetched: `task/E86b` HEAD @ 83ffa7e (`E86b a1: keys by name, the planners' own workflow (builder)`) + working tree (clean), a fresh clone; merge-base with `next` 19d48e7 · Commands run: D1 (`node --test "test/*.test.mjs"`, alone, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`), D2 (`node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`), D3 (the byte check), D4 (the staged guards), D5 (`node bin/devos.mjs --version`), D6 (actionlint 1.7.7 on the repository, and the fence's installed-project command), D7 (`gh api …/actions/runs/46134765022/jobs`), D9 (`git diff --name-only next...HEAD`), D10 (gitleaks 8.24.3); and, beyond the fence, the cycle's *Choose the builder from the pool, and name the reviewer tools* step run as written in an installed project, and a diff of the moved planner jobs against `next`'s · Refused calls: none

E86b chooses each AI job's keys by name in its caller and moves the planners into their own workflow. `tools.mjs secrets` gives a tool's secret names from its registry file; `resolve`, `intake-resolve` and `revise-resolve` write them, and each call passes only the secrets of those names, each written literally, never `secrets[…]`. Inside, the work, review and planner jobs hold the keys only as `DEVOS_KEY_1/2` and `DEVOS_ALT_1/2`, which `accounts.sh`'s `devos_tool` turns into the tool's account slots and clears; the watchdog strips them too. Intake and revise call `devos-intake-planner.yml`, so the planner's runner no longer holds all ten secrets of the four tools. The builder's commit is the fence's 23 files byte for byte (21 changed, 2 new) plus its report. Deep review (risk 3, Opus): I read the four workflows' diffs, the new planner workflow and `keys-by-name.test.mjs` whole, `accounts.sh`, the watchdog, `tools.mjs`, and the manual and precedent rows. The moved `intake` and `revise` jobs differ from `next`'s only by their inputs (`inputs.issue`, `inputs.resume`, `inputs.task`, `inputs.branch`, `inputs.unit`), the `if: inputs.stage == …` line, the tool check in their `pt` step and the four generic key lines; the concurrency group moved to the calling job. The golden record (keys-by-name (c)) proves every tool's builder, reviewer and planner calls exactly what E86 called, with the keys generic.

Ledger: P1/P2/S1 — PASS — the report: `21 as before, 0 new present`, then `21 modified, 2 new, 0 deleted, 0 other`
Ledger: D1 — PASS — the full run here: `tests 745 · pass 745 · fail 0`, exit 0; `git status --porcelain test/fixtures` printed nothing. The builder's Windows run: `tests 745 · pass 678 · fail 0 · skipped 67`
Ledger: D2 — PASS — `manifest up to date (370 files)`; `0 0`
Ledger: D3 — PASS — `23 files, 0 differ`
Ledger: D4 — PASS — `guard:secrets PASS (377 files scanned)`, `guard:manual PASS (140 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no devos/answers.json)`, `exit 0`
Ledger: D5 — PASS — `devos 1.14.0-rc.1`
Ledger: D6 — PASS — actionlint 1.7.7 on the repository: `exit 0`, no output; on an installed project: `14 workflows, exit 0` (the builder's report shows the same two results, run through Git bash and with `ACTIONLINT` naming the binary)
Ledger: D7 — PASS — engine-ci run 46134765022 on 83ffa7e, attempt 1: `checks completed success`, `test (ubuntu-latest) completed success`
Ledger: D8 — N/A — none by the owner's decision (D-E19, amended): the live check runs in E91, whose row lists each tool as builder, reviewer and planner, and intake and revision
Ledger: D9 — PASS — `git diff --name-only next...HEAD`: the 23 paths of S1, `dev/reports/E86b.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E86b.md`, `dev/fences/E86b/**` (with this review, `dev/reviews/E86b-a1-remote.md`); nothing else
Ledger: D10 — PASS — `no leaks found` (and the builder's gitleaks 8.30.1: `no leaks found`)

Beyond the fence:
- The cycle's agent-choice step has no test that runs it, so I ran its `run:` block as written (`bash -eo pipefail`, a `gh` stand-in), in an installed project. Cursor builder with a Claude deep and light reviewer: `builder_key=CURSOR_API_KEY`, `review_key=CLAUDE_CODE_OAUTH_TOKEN`, `review_alt=ANTHROPIC_API_KEY`, `light_tool=` and `light_key=` (same tool, so the light review takes `KEY_*`). Codex builder, Cursor deep, Gemini light: `builder_key=OPENAI_API_KEY`, `review_key=CURSOR_API_KEY`, `light_key=GEMINI_API_KEY`. Exit 0 both.
- The light-key change is safe for a light reviewer on the deep reviewer's tool: the review job's `light` is `true` only when the review's tool is another tool and equals `light_tool` (`devos-review.yml` line 165), so that review still takes `KEY_*`.
- `intake-resolve` and `revise-resolve` hold no secret and a token that only reads. The publish jobs' downloads keep `continue-on-error: true`, so a planner that never ran still leads to a message on the request or PR.

Scope: in fence. The builder's commit changes exactly S1's 23 paths and writes its report. Nothing under `dev/fences/E86b/` was edited, and no cycle or AI tool ran.

Method (payload changes only):
- PR-107 is the next id, and the live maximum moved to PR-107. It amends PR-90, PR-92, PR-101 and PR-106, and says that main's prompt and runner for the review are E86c.
- `AUTOMATION.md` names `devos-intake-planner.yml`, the `intake-resolve` and `revise-resolve` jobs, `tools.mjs secrets`, the six resolve outputs and the generic key names (`guard:manual` 140).
- Non-waivable rules unchanged: human gates; role surfaces; a red check still overrides PASS; secrets never in files (the registry and the outputs carry names only); the runner owns git. D-E18 now holds for the planners as well: no AI job names another tool's secret.

Owner attention:
- Two behaviour changes, both stated in the fence and the changelog:
  - a light review on another tool whose own key is missing gets no key and stops, where before it was handed the deep reviewer's key;
  - intake and revise post to the request or PR also when no planner could be named.
- A planner whose tool changes in main's config between `*-resolve` and the planner job stops with "run it again", rather than running with the other tool's keys.
- The new workflow reaches projects through `devos upgrade` like any new payload file. The live intake and revision runs are in E91's matrix.

Commit message: E86b: keys by name, the planners' own workflow (PR-107) - PASS a1
Next prompt: none yet. E86c's exact-file package is built from `next` after this merge, because its P1 names `next`'s commit. On "merged E86b — write E86c" its fence goes on `task/E86c`.
