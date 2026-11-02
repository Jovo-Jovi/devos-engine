MERGE

VERDICT: PASS
Fetched: `task/E43` @ 0f3ec47 (no uncommitted changes; `main` @ fc5fef1, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main`), every changed line of `payload/`, `lib/` and `test/`, the four version-pinned test files compared with `main` after the fence's two-step move, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41446471670 and its jobs · Refused calls: none

E43 fixes what the Mawsim test found on 2026-11-02.
- **Reporting.** Two report jobs in other Azure regions hit the 5-second limit and blamed `id-token: write`. Each call now has 20 seconds. `oidcResult` asks GitHub for the token up to 3 times, 2 then 5 seconds apart, and names why none came: `permission`, `timeout`, `network`, `HTTP <status>` or `no token`. `link` and `flush` print the real cause. A run's unsent events are now said to stay in its evidence, where re-running the report job sends them, instead of "kept". `flush` stops at the first event the registry does not answer.
- **Variables.** `devos init` and `devos adopt` set every switch with its value (`switchVariables`). Adopt skips a variable the repository already has. `DEVOS_REPORTING` still follows only a yes.
- **Strengths.** The guided page now offers motion, accessibility, i18n, security, devops and docs.
- **The method.** PR-74 records this. The manual's report row and three model rows describe it. The engine is 1.4.3.

**The review depth is deep (risk 3).** I read every changed line of `payload/` and `lib/`, and every test.
Ledger: D1 — PASS — my run on Linux: `tests 458`, `pass 458`, `fail 0`, `skipped 0`, with no `not ok`. The five new tests are `ok`: `report.test.mjs` (g), (h) and (i), `setup.test.mjs (v)` and `catalogue.test.mjs (u)`. The builder's report on Windows: `tests 458`, `fail 0`, `skipped 20`, the skips the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only main` lists the fence's 19 builder paths and the reviewer's two, and nothing else. The four version-pinned test files equal `main`'s after `1.4.3 → 1.4.4`, then `1.4.2 → 1.4.3`; `adopt-install.test.mjs (t)` adds only S7's `DEVOS_PAUSED` line.
Ledger: D4 — PASS — `devos 1.4.3`. Staged guards exit 0: `guard:secrets PASS (317 files scanned)`, `guard:manual PASS (117 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41446471670 on 0f3ec47, attempt 1: `checks` success, `test (ubuntu-latest)` success.
Ledger: D6 — PASS — deep read:
- every report command still exits 0; `devos-cycle.yml` is unchanged, so the `report` job alone holds `id-token: write` and runs no agent;
- a cycle run's worst case stays inside the step's 7 minutes: `link` takes at most 67 s for the token plus 20 s for the registry, and `flush` the same token time plus one unanswered call;
- messages carry a reason, never a token; consent is unchanged;
- PR-74 is the next id, the live maximum says PR-74, and `guard:manual` still counts 117, so no new name.
Scope: in fence, with one addition, accepted. `setup.test.mjs` puts a stub `agent` (Cursor CLI) on PATH. A real Cursor CLI on the builder's computer would otherwise answer the model probe and change the default builder's model, which breaks S7's exact lines. It keeps the test off a real CLI (E01's environment rule), inside a file S7 names.
Method (payload changes only): no non-waivable rule is weakened, and no check is removed. The token request now retries and the messages are truthful. The variables are set only to the values the workflows already defaulted to. PR-74 is added, and `AUTOMATION.md` updates its variables section, three model rows and the `report.mjs` row.
Owner attention:
- After this, a model variable overrides `devos.config.json` in every new project; the manual says so. Change models from the project page's Models button, or delete the variable.
- Note, not blocking: a cycle link run (`task=link`, PR-65) also sends the history, whose own budget is 5 minutes. With a slow token service on several calls, it could pass the step's 7 minutes. The step's time limit then ends it, `continue-on-error` holds, and the next link run sends the rest. E44's `devos-state` gets 40 minutes for the same work.
Commit message: E43: reporting survives a slow token service, every switch shows on the Variables page, and the builder strengths cover motion; engine 1.4.3 (PR-74) — PASS a1
Next prompt: dev/fences/E44.md (written on this branch, so it arrives with the merge; the owner's design: two slots a day, 12 hours apart).
