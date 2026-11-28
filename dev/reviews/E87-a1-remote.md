VERDICT: PASS
MERGE
Fetched: `task/E87` HEAD @ 10e834c (`E87 a1: each tool's capabilities, and a project's own tool (builder)`) + working tree (clean), a fresh clone; merge-base with `next` 4f2fdac · Commands run: D1 (`node --test "test/*.test.mjs"`, alone, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`), D2 (`node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`), D3 (the byte check), D4 (the staged guards), D5 (`node bin/devos.mjs --version`), D6 (actionlint 1.7.7 on the repository, and E86b's installed-project command), D7 (`gh api …/actions/runs/46149608130/jobs`), D9 (`git diff --name-only next...HEAD`), D10 (gitleaks 8.24.3) · Refused calls: none

E87 gives each agent tool a `can` (`headless`, `edit`, `shell`) and each role its needs, so `agents.mjs` refuses a reviewer, light reviewer or pool builder whose tool cannot fill the role and names what it lacks. A project can add its own tool as `devos/agents/<id>.json`: it may print the agent output contract itself (parser `contract`, whose `usage` and `limited` are now read), run a command already on the runner (install `none`, which `install-agent.sh` only checks), and take its keys from `DEVOS_AGENT_KEY` and `DEVOS_AGENT_KEY_2`, which `tools.mjs secrets` adds beside the engine tools' secrets, so the ten caller lines in `devos-cycle.yml` and `devos-intake.yml` name it literally. `devos agents check <id>` (`lib/agents-check.mjs`) checks a tool's file on the developer's computer with no AI call. The manual's §10 has the recipe and an API-script example. The builder's commit is the fence's 24 files byte for byte (22 changed, 2 new) plus its report. Deep review (risk 3, Opus): I read every changed line of `tools.mjs`, `agents.mjs`, `install-agent.sh`, `limit-check.mjs`, `usage.mjs`, the schema and the four tool files, the caller lines of both workflows, `lib/agents-check.mjs`, `lib/roster.mjs`, `bin/devos.mjs`, the manual and PR-109, and `capabilities.test.mjs` whole. The golden record of every engine tool's calls (`test/fixtures/agent-calls.json`) is unchanged and still equal (registry (a), keys-by-name (c)).

Ledger: P1/P2/S1 — PASS — the report: `22 as before, 0 new present`, then `22 modified, 2 new, 0 deleted, 0 other`
Ledger: D1 — PASS — the full run here: `tests 752 · pass 752 · fail 0`, exit 0; `git status --porcelain test/fixtures` printed nothing. The builder's Windows run: `tests 752 · pass 681 · fail 1 · skipped 70`; the failure was `readiness.test.mjs (c)`, outside S1's files (headers `fail` where `pass` was expected, 66 s under the full suite), and that file run again alone passed (`6 tests, fail 0`), both runs in the report, as the STOP block allows
Ledger: D2 — PASS — `manifest up to date (370 files)`; `0 0`
Ledger: D3 — PASS — `24 files, 0 differ`
Ledger: D4 — PASS — `guard:secrets PASS (377 files scanned)`, `guard:manual PASS (140 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no devos/answers.json)`, `exit 0`
Ledger: D5 — PASS — `devos 1.14.0-rc.1`
Ledger: D6 — PASS — actionlint 1.7.7 on the repository: `exit 0`, no output; on an installed project: `14 workflows, exit 0` (the builder's report shows the same)
Ledger: D7 — PASS — engine-ci run 46149608130 on 10e834c, attempt 1: `checks completed success`, `test (ubuntu-latest) completed success`
Ledger: D8 — N/A — none by the owner's decision (D-E19, amended): the live check runs in E91
Ledger: D9 — PASS — `git diff --name-only next...HEAD`: the 24 paths of S1, `dev/reports/E87.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E87.md`, `dev/fences/E87/**` (with this review, `dev/reviews/E87-a1-remote.md`); nothing else
Ledger: D10 — PASS — `no leaks found` (and the builder's gitleaks 8.30.1: `no leaks found`)

Scope: in fence. The builder's commit changes exactly S1's 24 paths and writes its report. Nothing under `dev/fences/E87/` was edited, and no cycle or AI tool ran.

Method (payload changes only):
- PR-109 is the next id, and the live maximum moved to PR-109. It amends PR-53, PR-99 and PR-106.
- `AUTOMATION.md` names the changes in the `agents.mjs`, `accounts.sh` · `limit-check.mjs`, `install-agent.sh` and `tools.mjs` rows, and §10 has *A new agent tool*; no new runner script, workflow, variable, label or `/devos` command (`guard:manual` 140).
- Non-waivable rules unchanged: human gates; role surfaces (a project's own tool lives under `devos/agents/`, a method path, so a product task cannot change it and a review runs main's copy, PR-108); a red check still overrides PASS; secrets never in files (the registry holds names only); the runner owns git. The callers still name every secret literally (PR-107): `DEVOS_AGENT_KEY` is one more literal name, and no job gets a secret its tool's file does not name.

Owner attention:
- `readiness.test.mjs (c)` failed once on Windows under the full suite (headers `fail`, 66 s) and passed alone. It is older than E87 and outside the package. The test starts a local build twice, and its second run's headers check read `fail`, which fits a page fetch timing out under load or the first build still answering. The E87b row now asks its fence to look at it, as E86b took the progress flake.
- A project's own tool's secret is not in the setup check, as the fence says: the manual tells the developer to set `DEVOS_AGENT_KEY`, and a run without it stops with `no <name> key: set secret DEVOS_AGENT_KEY`.

Commit message: E87: each tool's capabilities, and a project's own tool (PR-109) - PASS a1
Next prompt: none yet. E87b's exact-file package is built from `next` after this merge, because its P1 names `next`'s commit. On "merged E87 — write E87b" its fence goes on `task/E87b`.
