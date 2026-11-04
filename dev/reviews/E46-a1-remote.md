FIX: (1) test/local-mode.test.mjs (c) puts only a temporary folder with a `git` stub on PATH (`git` printing `git version 2.0.0` on POSIX, `git.cmd` on Windows), so it does not depend on where the runner keeps gh; (2) the local "everything is done" line is exactly `devos: everything is done — build each task in your IDE from its fence in docs/fences/` (no final period), and test (d) expects it; (3) `runPlan` reads `plan?.cycle`, so a plan file that is `null` reaches the plan's own messages instead of a stack trace. Nothing else changes. The reissued fence is dev/fences/E46.md v2.

VERDICT: FAIL
Fetched: `task/E46` @ 0e50c78 (no uncommitted changes; `main` @ 2ba2d74, E45's merge) · Commands run: scope listing (`git diff --name-only main`), every changed line of `lib/` and the tests, the version-pinned tests compared with `main` after the two-step move, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 41879467358 and its jobs · Refused calls: none

E46 is local mode's first step. `devos init --local` sets a project up on this computer.
- **What it asks and checks.** It asks no link, visibility or hosting question, and its doctor needs Node 22 and git, not gh.
- **What it saves and writes.** It saves `"cycle": "local"`, then writes a local README and a local `SETUP.md`, runs `git init -b main` and makes the bootstrap commit.
- **The optional backup.** If the owner says yes, a private GitHub repository is created with `DEVOS_PAUSED=true` set before the first push, so only CI runs there.
- **The other commands.** `validatePlan`, `devos continue`, `devos verify` and the project's steps know a local project. A project without `cycle` takes exactly today's path. The engine is 1.5.0.

**The review depth is deep (risk 3).** I read every changed line of `lib/` and every test.
Ledger: D1 — PASS — my run on Linux: `tests 473`, `pass 473`, `fail 0`, `skipped 0`, with no `not ok`. The five new tests of `test/local-mode.test.mjs` are `ok`. The builder's report on Windows: `tests 473`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only main` lists the fence's six `lib/` files, `package.json`, `payload/manifest.json`, `README.md`, `CHANGELOG.md`, `test/local-mode.test.mjs`, the four version-pinned tests, `test/version.test.mjs` and the report. The pinned tests equal `main`'s after `1.4.6 → 1.5.1`, then `1.4.5 → 1.5.0`.
Ledger: D4 — PASS — `devos 1.5.0`. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — FAIL — engine-ci run 41879467358 on 0e50c78, attempt 1:
- `checks` succeeded, but `test (ubuntu-latest)` failed: `not ok 266 - local-mode.test.mjs (c) the local doctor needs Node and git, not gh` (`1 !== 0` at line 183).
- **The cause.** The test hides gh by dropping every PATH folder that holds a `gh`. On the ubuntu-24.04 runner, gh and git are both in `/usr/bin`, so git is dropped too, and the local doctor rightly returns 1.
- **Why it passed here.** In the reviewer's sandbox gh is in `/usr/local/bin` and git in `/usr/bin`.
- **The fix is rehearsed.** With a PATH holding only a folder with a `git` stub, `doctorCommand({ local: true })` returns 0 and prints the ok line, and `doctorCommand()` returns 1.
Ledger: D6 — PASS — deep read:
- **A local path calls gh only after a yes to the backup.** Test (a) asserts an empty gh log. It never asks the link, and it sets no key and no variable other than `DEVOS_PAUSED`.
- **The backup goes in the right order:** doctor, then repo create, then `DEVOS_PAUSED`, then push. Any failure there prints its own error and goes on; the local project is already complete.
- **A project without `cycle` takes today's path.** Every GitHub test passes untouched.
- **Nothing is written outside the project's folder.**
Scope: in fence. One addition is accepted: `audit` (`devos verify`) no longer blocks a local project's steps on GitHub's sign-in, which is what R3 asked for.
Method (payload changes only): none (`lib/` only).
Owner attention. The FIX is one test and two one-line changes. The rest goes to E47:
- **The backup question repeats.** `devos continue` on a local project asks it again even when `origin` already exists, and a second yes then fails visibly. It should not be asked when there is an `origin`.
- **`devos verify` still blocks on gh for a local project.** Its machine rows list a missing gh as `block`; for a local project it should be information only.
Next prompt: dev/fences/E46.md v2 (`### Attempt 2 focus`).
