VERDICT: PASS
MERGE
Fetched: `task/E86c` HEAD @ 86df28c (`E86c a1: the review under main's rules (builder)`) + working tree (clean), a fresh clone; merge-base with `next` 1b3a373 · Commands run: D1 (`node --test "test/*.test.mjs"`, alone, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`), D2 (`node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`), D3 (the byte check), D4 (the staged guards), D5 (`node bin/devos.mjs --version`), D6 (actionlint 1.7.7 on the repository, and E86b's installed-project command), D7 (`gh api …/actions/runs/46140239011/jobs`), D9 (`git diff --name-only next...HEAD`), D10 (gitleaks 8.24.3) · Refused calls: none

E86c makes the review run under main's rules. Main's `publish-verify.mjs review-tree` now lays main's method files (`OVERLAY`, the list `verify` already lays over publish's workspace) over the review tree, so the reviewer's prompt is rendered by main's script from main's template, config and skills, its tool and model are main's config, and `plan-agent.sh`, every script it runs, the tools' files, the role kits and `.cursor/rules` are main's. A method fix keeps its own method files in `.devos/branch-method/`, written only when `method_changed`, after the work job's evidence and with any evidence copy of that folder removed first. Main's reviewer prompt says both. The builder's commit is the fence's 8 files byte for byte (7 changed, 1 new) plus its report. Deep review (risk 3, Opus): I read the `review-tree` change, the template lines, the workflow comments, PR-108, the two manual rows and `review-rules.test.mjs` whole. The order in `review-tree` is right: the head's files, the evidence, the removal of `diff.patch`, `diff-stat.txt`, `ci-results.json` and `branch-method` from it, then the branch's method copy, then main's overlay, then publish's own diff files. The reviewer step's commands are unchanged; in the tree they now name main's scripts. A product task's review is unchanged in content: verify rejects a method file in a product task, and `resolve` merges main into an open unit (PR-91).

Ledger: P1/P2/S1 — PASS — the report: `7 as before, 0 new present`, then `7 modified, 1 new, 0 deleted, 0 other`
Ledger: D1 — PASS — the full run here: `tests 747 · pass 747 · fail 0`, exit 0; `git status --porcelain test/fixtures` printed nothing. The builder's Windows run: `tests 747 · pass 678 · fail 0 · skipped 69` (review-rules (a) and (b) skip there, as the fence says)
Ledger: D2 — PASS — `manifest up to date (370 files)`; `0 0`
Ledger: D3 — PASS — `8 files, 0 differ`
Ledger: D4 — PASS — `guard:secrets PASS (377 files scanned)`, `guard:manual PASS (140 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no devos/answers.json)`, `exit 0`
Ledger: D5 — PASS — `devos 1.14.0-rc.1`
Ledger: D6 — PASS — actionlint 1.7.7 on the repository: `exit 0`, no output; on an installed project: `14 workflows, exit 0` (the builder's report shows the same, through Git bash and with `ACTIONLINT` naming the binary)
Ledger: D7 — PASS — engine-ci run 46140239011 on 86df28c, attempt 1: `checks completed success`, `test (ubuntu-latest) completed success`
Ledger: D8 — N/A — none by the owner's decision (D-E19, amended): the live check runs in E91
Ledger: D9 — PASS — `git diff --name-only next...HEAD`: the 8 paths of S1, `dev/reports/E86c.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E86c.md`, `dev/fences/E86c/**` (with this review, `dev/reviews/E86c-a1-remote.md`); nothing else
Ledger: D10 — PASS — `no leaks found` (and the builder's gitleaks 8.30.1: `no leaks found`)

Scope: in fence. The builder's commit changes exactly S1's 8 paths and writes its report. Nothing under `dev/fences/E86c/` was edited, and no cycle or AI tool ran.

Method (payload changes only):
- PR-108 is the next id, and the live maximum moved to PR-108. It amends PR-28, PR-90 and PR-101.
- `AUTOMATION.md` names the change in the `devos-review.yml` and `publish-verify.mjs` rows; no new script, variable, label or command (`guard:manual` 140).
- Non-waivable rules: none weakened, and one strengthened. A method fix is still a deep review that waits for the human (PR-28), and it is now reviewed under main's rules. Role surfaces are unchanged: a method fix still may not touch `CLAUDE.md`, `.claude/**`, `.cursor/cli.json` or `.cursor/hooks*` (`surfaces.builder_method.deny`). A red check still overrides PASS; secrets never in files; the runner owns git.
- The design said "`$T/render-prompt.mjs` and `$T/plan-agent.sh` with `DEVOS_ROOT` the review tree"; the package lays main's files over the tree instead, as stated in the fence and the ledger, because those two scripts would still read the branch's template, config and kits there.

Owner attention:
- A method fix's reviewer reads and runs the branch's method files from `.devos/branch-method/`. A command run in place now runs main's version, which is the point. The method-fix paragraph of main's reviewer prompt says so.
- The overlay also removes from the review tree any `.cursor/` file outside `METHOD_RE` that a product task added (an `.cursor/mcp.json`, for one): the reviewer sees it in `.devos/diff.patch`, and its CLI no longer loads it. Publish's workspace already worked this way.

Commit message: E86c: the review under main's rules (PR-108) - PASS a1
Next prompt: none yet. E87 is a new design (capabilities and every kind of integration, and the second opinions on any tool), so its design fence v1 comes from `next` after this merge, for your approval, as E86's did.
