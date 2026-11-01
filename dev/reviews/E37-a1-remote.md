MERGE

VERDICT: PASS
Fetched: `task/E37` @ e6ebb3d (no uncommitted changes; `main` @ 848a2e9, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 7f5c7ae HEAD`), the manifest diff, D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), actionlint 1.7.7 on the payload and engine workflows, engine-ci run 41315304185 and its jobs, the D6 method greps, the attempt-1 report · Refused calls: none

E37 is D-E13's step 5, with the builder fix after T21's stop (PR-71), on the owner's word of 2026-11-01.
- **A project in production keeps its own deploy.** Before, `devos adopt` set `deploy: "vercel"` for any project that deploys to Vercel. Setup then switched on DEV_OS's deploy beside the project's own, and every merge deployed twice. `askDeploy` now gives `own` by default, and DEV_OS deploys only when the developer chooses it or `DEVOS_VERCEL` is already set.
- **The risky paths stop at the gate (PR-72).** The survey names the critical paths: deploy, schema, sign-in and payments, by directory and by import. Every adoption reviews them deep. When the confirmed brief says production, a PASS that changes one stops at the human gate, at any risk.
  - A branch's paths are now read as they are (`diffPaths`: `--no-renames -z`), for this gate, the schema gate (PR-17), the review depth, PR-28's forced gate, the method-files step and `guard:scope`.
  - Before, a rename was named by its new path only, so moving a file out of a gated folder merged.
- **An agent can no longer stop itself (PR-71).**
  - No agent that can run a command gets its prompt as an argument: Claude Code, Codex and Gemini read standard input, and Cursor gets one line naming the file.
  - `pkill` and `killall` are denied to the builder and the Claude Code reviewer.
  - A builder stopped by a signal restarts once.
  - The watchdog ends the agent's session when it is signalled, and the next run ends what a watchdog killed outright left.

**The review depth is deep (risk 3).** As with every Engine package, I wrote `dev/fences/E37/files/` and reviewed it line by line before issue. Three independent security reads came first:
- the first failed it (the rename gap, prompts still on some command lines, the watchdog alone);
- the second passed it with four notes;
- the third passed those fixes.

v1 closes every finding. D3 proves the branch's 29 copies are byte-identical to that package. The builder's commit adds only those copies, the manifest and its report (31 files).
Ledger: D1 — PASS — my run on Linux: `tests 431`, `pass 431`, `fail 0`, `skipped 0`. All 9 new tests are `ok`: `adopt.test.mjs` (m), `adopt-install.test.mjs` (w)–(y), `reviewer-output.test.mjs` (d) and (e), `cycle-tools.test.mjs` (t) and (u), and `guards-structure.test.mjs` (h). The builder's report on Windows: `tests 431`, `pass 411`, `fail 0`, `skipped 20` (E28's 16, `time-limits.test.mjs` (d) and (f), `cycle-tools.test.mjs` (t) and (u)), as the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `29 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41315304185 on e6ebb3d, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`. My own actionlint run on the payload and engine workflows also passes.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 63 paths, nothing else:
- the 29 copied paths, `payload/manifest.json` and `dev/reports/E37.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E37.md`, `dev/fences/E37/before.json` and the 29 package copies.

The manifest diff changes the 17 payload hashes only (`17 insertions(+), 17 deletions(-)`). **The deep review confirms:**
- **The gate only adds `human_gate`.** In `verdict.mjs`, PR-08's red-check override runs before the decision, and `gatePaths` can only turn a `merge` into a `human_gate`. An unreadable diff holds the gate. The default `human_gate_paths: []` changes nothing for a project that does not set it.
- **No agent that can run a command gets its prompt as an argument.** A grep of every `.yml` and `.sh` under `payload/files` for `$(cat …prompt…)` finds only `devos-doctor.yml` and `devos-supervisor.yml`. Both are limited to `Read,Glob,Grep` with Bash disallowed, and test (m) checks that.
- **With the default answer, `DEVOS_VERCEL` is never set.** `deploy` is `own`; setup, keys and modules switch on Vercel only for `vercel`. Test (w) publishes and finds no `variable set DEVOS_VERCEL`.
- **The restart is once per step.** `restarted` is set before the slot loop; `devos_restart` gives a reason only for 125, 126, 137 and 143.
- **The watchdog's `pkill -KILL -s <sid>`** never acts on `0` or on its own session, and a session no process holds is nothing.
- **The survey reads only paths.** It never reads documents (`docs/`), files that may hold a secret, or links, and it keeps no text.

This review and the ledger tick are added after it.
Scope: in fence. No other workflow, no `lib/` file but `lib/adopt.mjs`, no version change, no dependency.
Method (payload changes only):
- non-waivable rules: human gates (strengthened), role surfaces, red overrides PASS (unchanged, before the gate), no secrets in files, and the runner owns git; none is weakened;
- the precedents are PR-71 and PR-72, the next ids (`Live maximum: PR-70` on `main`, `PR-72` here), written generically;
- the manual: `AUTOMATION.md` names `devos_prompt` (3 times), `devos_restart`, `DEVOS_STDIN` and `human_gate_paths` (3 times), in the rows the fence lists and §8;
- `guard:manual` passes with 117 names.
Owner attention:
1. **Every project's agents change how they get their prompt** after `devos upgrade`, or after E38 for the Control Tower. The Cursor pointer follows `devos init`'s blueprint run, which works in practice; the first cycle after the upgrade is its real proof. If a Cursor run ever says it cannot read `.devos/builder-prompt.md`, that is the place to look.
2. **The production gate holds what the survey named at adoption.** A later file elsewhere that imports Stripe or a sign-in package is gated only once you add it to `reviewer.human_gate_paths_extra` in `devos/project.json`.
3. **The denials match how a command starts.** `kill $(pgrep -f …)` is not denied. The prompt rule and the single restart are the backstop, as PR-71 says.
4. **The Control Tower still runs its older copy.** Until E38 adopts it, a T21-style stop there still reads as a usage limit (you removed and re-added the label today), and its agents still get their prompt as an argument.
Commit message: E37: adopting an existing project, step 5 — a project in production keeps its own deploy (devos adopt asks; DEVOS_VERCEL is set only when you choose DEV_OS's deploy) and a change to its deploy, schema, sign-in or payment files stops at the human gate (reviewer.human_gate_paths, from the survey's critical paths; renames and quoted names read as they are, PR-72); an agent never gets its prompt as an argument, the builder may not pkill or killall, a builder stopped by a signal restarts once, and the watchdog ends what it leaves (PR-71) — PASS a1
Next prompt: `dev/fences/E38.md` (adopting an older copy of DEV_OS, the Control Tower first), written next from `dev/PLAN.md` and D-E13, as E38's ledger row says.
