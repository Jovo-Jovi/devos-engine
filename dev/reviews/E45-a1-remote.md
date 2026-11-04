MERGE

VERDICT: PASS
Fetched: `task/E45` @ 3b6dee1 (no uncommitted changes; `main` @ e6905be, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main`), every changed line of `payload/` and the tests, actionlint 1.7.7 on every workflow, the dispatch-input count of `devos-cycle.yml`, the version-pinned tests compared with `main` after the two-step move, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 41869754329 and its jobs · Refused calls: none

E45 fixes what the Mawsim test found on 2026-11-03 and 2026-11-04.
- **A reset in days.** `parseResetTime` reads days. "Resets in 5 days" resumes after 4.5 days, never as the one-hour default that re-ran T06 every hour.
- **A fallback builder of another tool.**
  - When every account and model of the builder's tool is out longer than a run waits, `builder-status.mjs` gives `switch`.
  - The cycle then labels the PR `devos:fallback-builder` and dispatches the same attempt.
  - `agents.mjs pick` reads the label and returns `agents.fallback_builder`.
- **A model variable never strands a role.** It keeps the configured model as its next one (`keepConfigured`).
- **A resume survives a failed label removal.** Six label removals can no longer end a resume step.
- **The supervisor can restart a task.** Its token has `actions: write`, so it can re-dispatch without a `DEVOS_PAT` secret.
- **The method.** PR-76 records all of it. The engine is 1.4.5.

**The review depth is deep (risk 3).** I read every changed line of `payload/` and every test.
Ledger: D1 — PASS — my run on Linux: `tests 468`, `pass 468`, `fail 0`, `skipped 0`, with no `not ok`. The six new tests are `ok`:
- `fallback-models.test.mjs` (i), (j), (k) and (l);
- `models.test.mjs (f)`;
- `cycle-tools.test.mjs (v)`.

The builder's report on Windows: `tests 468`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`, with `main`'s allowlist.
Ledger: D3 — PASS — `git diff --name-only main` lists the fence's paths: the nine payload files, `package.json`, `README.md`, `CHANGELOG.md`, the nine tests and the report, plus the reviewer's two. The version-pinned tests equal `main`'s after `1.4.5 → 1.4.6`, then `1.4.4 → 1.4.5`; `adopt-files.test.mjs (b)` also moves to `120 names checked`, as S8 names.
Ledger: D4 — PASS — `devos 1.4.5`. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41869754329 on 3b6dee1, attempt 1: `checks` success (actionlint included), `test (ubuntu-latest)` success.
Ledger: D6 — PASS — deep read of every changed `payload/` line:
- **No fallback without the setting.** `switch` needs `agents.fallback_builder`, an item of another tool, a run builder that is not already that item, and a reset later than `resume.inline_wait_max_minutes`. A stall or a short limit is still `quota`. A limit with no stated reset keeps the 60-minute default, so it never switches.
- **The switch costs nothing.** It spends no review and no attempt, commits nothing new, and writes no resume marker. Its report note exits early (`continue|switch`).
- **The label is the only state.** `pick` reads it before the policy, and only with the setting. `validate` refuses a `fallback_builder` of the default's tool, an unknown id or a non-string.
- **The cycle keeps 10 dispatch inputs**, and actionlint 1.7.7 passes on every workflow.
- **Exactly six label removals** end in the `|| echo` warning. The cycle's own `>/dev/null 2>&1 || true` removal is unchanged.
- **`devos-supervisor.yml` changes in one line only,** `actions: write`.
- **`keepConfigured` stays inside PR-64's limit.** It keeps at most 4 next models, and a variable equal to the configured model changes nothing.
- **PR-76 is the next id,** the live maximum says PR-76, and `AUTOMATION.md` names `devos:fallback-builder` and `agents.fallback_builder`.
Scope: in fence.
Method (payload changes only): every change adds a way to keep going, and no check is taken away. The new label is in the manual (`guard:manual` 120). The supervisor's token gains only the permission its documented repairs use.
Owner attention:
- To use the fallback in a project, add a pool builder of another tool and `"fallback_builder": "<its id>"` to `devos/project.json` `agents`, then run `node scripts/devos/config.mjs --write` and commit. Nothing changes until you do.
- Mawsim's supervisor can now restart a stuck task once Mawsim runs `devos upgrade` to 1.4.5.
Commit message: E45: a weekly limit waits days, a long limit moves the task to a fallback builder of another tool, a model variable never strands a role, and a resume survives a failed label removal; engine 1.4.5 (PR-76) — PASS a1
Next prompt: dev/fences/E46.md (local mode, step 1; checked against this tree, so it arrives with the merge).
