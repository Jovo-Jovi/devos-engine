MERGE

VERDICT: PASS
Fetched: `task/E47` @ 39e69c2 (no uncommitted changes; `main` @ 165f653) · Commands run: the attempt's own change (`git diff 70f32e9 HEAD`), scope listing (`git diff --name-only origin/main`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, `init --help` compared with S2's text, staged guards on a fresh `install --key DEMO`), engine-ci run 41899154812 and its jobs, the page's first screen in Chromium (Playwright) · Refused calls: none

Attempt 3 makes exactly the four changes of the FIX, line for line as rehearsed, and nothing else apart from its report:
- `workerAc` stages a Cursor stub (`stage({ tools: ["agent"] })`);
- picking `local` sets `app.draft.modules.hosting` to `"none"` before the draft is saved;
- the first screen's lede no longer says GitHub;
- `ui-page.test.mjs (j)` checks both texts.

Everything else is attempt 2, reviewed deep in `dev/reviews/E47-a2-remote.md`:
- **The page.** The first screen asks for automated development (GitHub) or local development (this computer). The local path sends `cycle: "local"` with no link, no keys and no hosting, has its own Backup and Finish screens, and reads the local doctor.
- **The terminal.** `devos help`, `--help` and `-h` print the usage. `devos init --help` explains `--local` and never reaches the folder logic. `devos doctor --local` checks only Node.js and git.
- **E46's two follow-ups.** A project with an `origin` is not asked for a backup again, and `devos verify` shows a missing gh as a `note` for a local project.

**The review depth is deep (risk 3)** for attempt 2. For attempt 3, I read every line it changed. In Chromium, on 39e69c2, in this sandbox where gh is not signed in:
- automated development blocks on the GitHub check;
- picking local development makes the engine row `Ready`, with the rail ending in `This computer`;
- the saved draft then has `cycle` `local` and `hosting` `none`;
- the lede reads `DEV_OS turns an empty folder into a project that AI agents build and review…`;
- there is no page error.

Ledger: D1 — PASS — my run on Linux: `tests 482`, `pass 482`, `fail 0`, `skipped 0`, with no `not ok`. `ui-server.test.mjs (ac)` is `ok`. The builder's report on Windows: `tests 482`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only origin/main` lists fence v3's paths and nothing else. There is no `app.css` change, and no existing test changed.
Ledger: D4 — PASS — `devos 1.5.0`. `devos init --help` equals S2's text byte for byte. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41899154812 on 39e69c2, attempt 1: `checks` success, `test (ubuntu-latest)` success. Test (ac) now passes on the runner, which has no Cursor CLI.
Ledger: D6 — PASS — as in the a2 review:
- a GitHub plan, draft, screen and run are exactly today's;
- a local run from the page sends no key, calls gh only after a yes to the backup, and is asked no link;
- `--help` never reaches the folder logic;
- the remote's URL is never printed.

The hosting change applies only when `local` is picked, and `buildPlan`'s own override stays.
Scope: in fence v3.
Method (payload changes only): none (`bin/` and `lib/` only).
Owner attention:
- **1.5.0 is not released yet.** E46 and E47 wait for E48, then the release, then Medix.
- **The a2 review's notes stand.**
  - A local project needs every agent tool of its roster signed in on this computer; with the default roster, that includes the Cursor CLI.
  - Opening a started local project from the page still checks the GitHub doctor.
  - The README's screenshots can be retaken at the release.
Commit message: E47: the guided page offers automated or local development, devos init --help explains --local, devos doctor --local checks only Node and git, and a project with an origin is not asked for a backup again; engine 1.5.0 — PASS a3
Next prompt: dev/fences/E48.md (the product README), written by the reviewer on `task/E48` from `main` after this merge.
