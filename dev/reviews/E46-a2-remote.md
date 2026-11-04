MERGE

VERDICT: PASS
Fetched: `task/E46` @ ca6cd6c (no uncommitted changes; `main` @ 2ba2d74) · Commands run: the attempt's own change (`git diff 96b9406 HEAD`), scope listing (`git diff --name-only main`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 41884520955 and its jobs · Refused calls: none

Attempt 2 makes exactly the three changes of the FIX, and nothing else apart from its report:
- test (c) puts only a temporary folder with a `git` stub on PATH (`git.cmd` on Windows), and removes it afterwards;
- the local "everything is done" line has no final period, and test (d) matches the whole line;
- `runPlan` reads `plan?.cycle`.

Everything else is attempt 1, reviewed deep in `dev/reviews/E46-a1-remote.md`:
- `devos init --local` saves `"cycle": "local"` and asks no link, visibility or hosting question;
- the local doctor needs Node 22 and git, not gh;
- the project ends with a local README and `SETUP.md`, `git init -b main` and the bootstrap commit;
- the optional private GitHub backup sets `DEVOS_PAUSED=true` before the first push;
- `validatePlan`, `devos continue`, `devos verify` and the project's steps know local mode;
- the engine is 1.5.0.

**The review depth is deep (risk 3)** for attempt 1. For attempt 2, I read every line it changed.
Ledger: D1 — PASS — my run on Linux: `tests 473`, `pass 473`, `fail 0`, `skipped 0`, with no `not ok`. The five tests of `test/local-mode.test.mjs` are `ok`. The builder's report on Windows: `tests 473`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only main` lists fence v2's paths and nothing else.
Ledger: D4 — PASS — `devos 1.5.0`. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41884520955 on ca6cd6c, attempt 1: `checks` success, `test (ubuntu-latest)` success. Test (c) now passes on the runner whose `/usr/bin` holds both gh and git.
Ledger: D6 — PASS — as in the a1 review:
- a local path calls gh only after a yes to the backup, asks no link, and sets no key or variable other than `DEVOS_PAUSED`;
- a project without `cycle` takes today's path;
- nothing is written outside the project's folder.
Scope: in fence v2.
Method (payload changes only): none (`lib/` only).
Owner attention:
- Two follow-ups go to E47: the backup question is asked again when `origin` exists, and `devos verify` still lists a missing gh as a block for a local project.
- E46 is not released on its own. 1.5.0 is released after E47 and E48, before Medix starts.
Commit message: E46: a project can be set up on this computer with devos init --local, with an optional private GitHub backup where only CI runs; engine 1.5.0 — PASS a2
Next prompt: dev/fences/E47.md (the guided page's choice between automated and local development, `devos init --help`, `devos doctor --local`, and the two follow-ups; checked against this tree, so it arrives with the merge).
