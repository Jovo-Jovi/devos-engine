MERGE

VERDICT: PASS
Fetched: `task/E52` @ 196dda3 (no uncommitted changes; `main` @ f886812) · Commands run: scope listing (`git diff --name-only origin/main`), every changed file compared byte for byte with the reviewer's rehearsal (the fence's changes applied to f886812 by script), every line where the builder's code differs from it, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 42004407681 and its jobs, the guided page in Chromium (builders and blueprint screens) · Refused calls: none

E52 lets the developer choose effort (PR-78).
- **The blueprint agent runs at the effort chosen on the page:** High by default, for Claude Code (`--effort`) and Codex (`model_reasoning_effort`). Before, it ran at Claude Code's own default, medium. A terminal `devos init` asks nothing new and runs it at high.
- **Each builder's effort** is either the reviewer's choice for each task, as today, or a fixed level, with Fast for Cursor. A fixed level is saved on the pool item, shown to the reviewer in the pool list, and kept in every fence by `fence-check`.
- **A Cursor model id that names its effort runs as that id,** and the runner reports its effort and fast from the id. Mawsim's commits had recorded the fence's effort instead.
- **E48's two follow-ups are fixed,** and the engine is 1.5.1.

**The review depth is deep (risk 3).**
- **The texts match the rehearsal byte for byte:** every prompt and method text, PR-78, the changelog, the README and the six version-pinned tests.
- **The code is the builder's own, and every difference is equivalent:**
  - `Object.hasOwn` in place of `!== undefined`;
  - Codex's flag spliced into place;
  - named constants;
  - `fence-check`'s lookup returning early;
  - the page's options built from one list.
- **In Chromium on 196dda3:**
  - the builder's Effort lists `Reviewer chooses for each task` and the four fixed levels;
  - Fast appears only with a fixed level on a Cursor family, and the draft saves `grok-4.7`, `xhigh`, `fast: true`;
  - the blueprint's Effort shows `High` by default;
  - there is no page error.

Ledger: D1 — PASS — my run on Linux: `tests 494`, `pass 494`, `fail 0`, `skipped 0`, with no `not ok`. The eight new tests are `ok`. The builder's report on Windows: `tests 494`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only origin/main` lists the fence's paths, with E48's carried review, and nothing else. The tests changed are exactly S9's.
Ledger: D4 — PASS — `devos 1.5.1`. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 42004407681 on 196dda3, attempt 1: `checks` success, `test (ubuntu-latest)` success.
Ledger: D6 — PASS — every changed line:
- **Without a chosen effort, everything is exactly today's:** every argument (`blueprintArgs` without its sixth parameter), answer, roster, pool line and fence check. `init.test.mjs (o)` changes only because a terminal run now passes `high` to Codex, as S1 asks.
- **No workflow changes.**
- **A fixed effort can only be kept, never bypassed, by a fence.** The workflow's own `effort` input still wins, as before.

Scope: in fence.
Method (payload changes): the reviewer gains one duty, keeping a fixed effort, and `fence-check` enforces it. Nothing is taken away. PR-78 is the next id, and `guard:manual` stays at 120.
Owner attention:
- **Merge after this review's commit is on the branch.** E48's squash had left out its review; this branch carries it back.
- **1.5.1 is unreleased.** Medix can start from `main` after this merge; a release can follow.
- **Mawsim keeps its pool model `cursor-grok-4-7-xhigh-fast` until you change it.** With 1.5.1 its runs report `xhigh, fast` truthfully.

Commit message: E52: choose the blueprint agent's effort and each builder's, per task or fixed; a Cursor model id that names its effort runs as it is; engine 1.5.1 (PR-78) — PASS a1
Next prompt: none on this branch. Next: E53, media generation in the engine (images, video, voice), planned in `claude/KICKOFF-engine-and-tower.md` for a new chat.
