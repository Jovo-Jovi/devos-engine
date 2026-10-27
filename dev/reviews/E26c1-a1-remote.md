MERGE

VERDICT: PASS
Fetched: `task/E26c1` @ 6f92743 (no uncommitted changes; `main` @ 9d0b982, E26b merged) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 77809c8 HEAD`, `git diff 77809c8 HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), D5 (`bash -n` on the three scripts), D6 (engine-ci run 40481301998 and its jobs), D7 (the manifest diff, the method), actionlint 1.7.7 with engine-ci's options, the attempt-1 report · Refused calls: none

E26c1 gives each agent several models of its own tool (D-E12, PR-64):
- **The configuration.** An agent (the reviewer, the light reviewer, each pool builder) may list `fallback_models`: up to 4 model ids, none twice. `agents.mjs` gives them in order as `builder_fallbacks` and `reviewer_fallbacks`, and skips the agent's own model, so a model variable (PR-63) that names one is not tried twice.
- **The order.** Every builder run and review of `devos-cycle.yml` uses it, and so do `run-agent.sh` (Codex, Gemini) and `plan-agent.sh` (intake, method fixes, revisions). Each run loops over `devos_slots`: each model on every account of the tool, then the next model.
  - A usage limit moves to the next slot.
  - A model the account cannot use is skipped at once. `modelUnavailable` reads only the CLI's own error, never a tool's output in the transcript or a watchdog stop.
  - When no slot can run and one was limited, `devos_settle` ends the run limited, so it parks until the earliest reset.
  - The tool never changes.
- **Waiting for the earliest reset.** `builder-status.mjs --tool` reads the builder's own tool's limit files, not Cursor's always.
- **Reporting the model used.** The builder step outputs the `model` it used, for the commit message, the evidence and the reviewer; the run files add `model=`.
- **The manual and the precedent.** The manual names all of this, and PR-64 is "Live maximum".

This is a deep review: risk 3, a method change in the cycle workflow and five runner scripts. The 15 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence. A separate review of the runner's diff, made before the fence was issued, found no blocker, and its should-fix items are in the package.

The builder's commit adds only `payload/manifest.json` and its report, which I read. The manifest diff changes the hashes of the 11 changed payload files and nothing else; `engine_version` stays 1.2.0. The commit leaves the fence and the ledger as I wrote them (`git diff 77809c8 HEAD -- dev/fences dev/LEDGER.md` is empty).
Ledger: D1 — PASS — my run on Linux: `tests 362`, `pass 362`, `fail 0`, `skipped 0`; `fallback-models.test.mjs` (a)–(h) are `ok 111`–`ok 118`. The builder's report on Windows: `tests 362`, `pass 347`, `fail 0`, `skipped 15` (the existing 11, and (b), (d), (e) and (f), which run bash scripts, as the fence allows).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `15 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.2.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — `bash -n` exits 0 for `accounts.sh`, `run-agent.sh` and `plan-agent.sh`.
Ledger: D6 — PASS — engine-ci run 40481301998 on 6f92743, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`. My own actionlint 1.7.7 run with engine-ci's options also exits 0.
Ledger: D7 — PASS — the scope: `git diff --name-only main...HEAD` lists 35 paths:
- the 15 copied paths;
- `payload/manifest.json` and `dev/reports/E26c1.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E26c1.md`, `dev/fences/E26c1/before.json` and the 15 package copies.

Nothing else. The manifest changes 11 hashes only. The method is below. This review and the ledger row are added after it.
Scope: in fence. No change to the version, to a workflow other than `devos-cycle.yml`, or to which agent or tool a role uses. No secret is read or printed. No dependency.
Method (payload changes only):
- **Rules checked.** No non-waivable rule is weakened:
  - the human gates and the role surfaces are unchanged;
  - a red check still overrides a PASS;
  - no secret enters a file: limit files hold the CLI's own output, as since PR-29;
  - the runner still owns git;
  - no other agent or tool takes over (PR-53 holds, except its "no fallback model").
- **Precedent.** PR-64 is the next id ("Live maximum: PR-64").
- **Manual.** `AUTOMATION.md` names `fallback_models`, `devos_slots`, `devos_unavailable`, `devos_settle`, `limit-check.mjs --unavailable`, `builder_fallbacks` and `reviewer_fallbacks`, the run files' `model`, and §9's usage-limit row. No new script, guard, workflow, variable, label or command (`guard:manual` stays at 116).
Owner attention:
1. **Nothing changes until a project lists `fallback_models`.** Existing projects keep one model per role. A project gets PR-64 with `devos upgrade`, or with **Upgrade** on its page.
2. **Next:**
   - E27 (the project checklist), re-rehearsed on this merge;
   - then E26c2, which edits the lists with `devos models` and on the project's page, by pull request.

   Release 1.2.0 after E26c2.

Commit message: E26c1: several models per role in the runner — each agent's fallback_models of its own tool, tried after the other account; a model the account cannot use is skipped; the run waits for the earliest reset only when no model can run (PR-64) — PASS a1
Next prompt: dev/fences/E27.md (on `task/E27`, re-rehearsed on `main` after this merge); E26c2's fence follows.
