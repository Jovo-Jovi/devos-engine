FIX: (1) `ui-server.test.mjs (ac)`: `workerAc`'s planned stage is `stage({ tools: ["agent"] })`, so the roster's Cursor builder has a stub and the test never depends on a real, signed-in Cursor CLI; (2) picking `local` on the first screen also sets `app.draft.modules.hosting` to `"none"` when the draft has a `hosting` key, so a local draft no longer lists `Hosting: Vercel` on the review card and in the drafting diagram; (3) the first screen's lede no longer says GitHub: `DEV_OS turns an empty folder into a project that AI agents build and review, with you approving each step. First, a quick look at this computer.`; (4) `ui-page.test.mjs (j)` also checks those two texts. Nothing else changes. The reissued fence is dev/fences/E47.md v3 (`### Attempt 3 focus`).

VERDICT: FAIL
Fetched: `task/E47` @ aac15d0 (no uncommitted changes; `main` @ 165f653, E46's merge) · Commands run: scope listing (`git diff --name-only origin/main`), every changed line of `bin/`, `lib/` and the tests, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, `init --help` compared with S2's text, staged guards on a fresh `install --key DEMO`), engine-ci run 41894779702 and its failed job's log, worker `ac` run alone with its events traced, the page's first screen in Chromium (Playwright) · Refused calls: none

E47 gives the guided page the owner's choice, and the terminal its help.
- **The first screen asks "How will it be built?"** with two cards, "Automated development (GitHub)" and "Local development (this computer)".
  - **The local path** sends `cycle: "local"` with no link, `private` and no hosting. It lists no keys. Its rail ends with "This computer: Backup, Finish".
  - **Its engine row** reads the local doctor.
  - **Its new Backup screen** answers the `backup` ask, and its Finish screen says what to do next.
- **The terminal.**
  - `devos help`, `--help` and `-h` print the usage, whose second line is `devos help`.
  - `devos init --help` prints S2's text exactly; `--help` never reaches the folder logic, and an unknown option is refused.
  - `devos doctor --local` checks only Node.js and git.
- **E46's two follow-ups.** A project with an `origin` is not asked for a backup again, and the URL is never printed. `devos verify` shows a missing gh as a `note` for a local project.

**The review depth is deep (risk 3).** I read every changed line, and checked the first screen in a real browser. In this sandbox gh is not signed in:
- automated development shows `Needs attention` and blocks;
- local development shows `Node.js 22 and git are ready. Local development needs nothing else.`, with no blocking notice and no page error.

Ledger: D1 — FAIL — my run on Linux: `tests 482`, `pass 481`, `fail 1`, `skipped 0`. The only `not ok` is `ui-server.test.mjs (ac)` with `asks approve`. The builder's report on Windows: `tests 482`, `fail 0`, `skipped 20`.
Ledger: D2 — PASS — `manifest up to date (311 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only origin/main` lists:
- `bin/devos.mjs`, `lib/init.mjs`, `lib/setup.mjs`, `lib/verify.mjs`, `lib/ui-server.mjs`, `lib/ui/app.js`;
- `README.md`, `CHANGELOG.md`;
- `test/cli-help.test.mjs`, `test/local-mode.test.mjs`, `test/ui-server.test.mjs`, `test/ui-page.test.mjs`;
- the report, and the reviewer's fence and ledger.

There is no `app.css` change, and no existing test changed.
Ledger: D4 — PASS — `devos 1.5.0`. `devos init --help` exits 0, and its output equals S2's text byte for byte. Staged guards exit 0: `guard:secrets PASS (318 files scanned)`, `guard:manual PASS (120 names checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`.
Ledger: D5 — FAIL — engine-ci run 41894779702 on aac15d0, attempt 1: `checks` success, `test (ubuntu-latest)` failure: `not ok 442 - ui-server.test.mjs (ac) a local plan runs through the page: no keys, one backup ask, no gh call` (`asks approve`, `1 !== 0`); `tests 482`, `pass 481`, `fail 1`.
- **The cause.** Traced by running worker `ac` alone with its events printed.
  - The plan's roster comes from the default roster: a Claude reviewer and a Cursor builder.
  - `stage()` writes only the `claude` and `gh` stubs. After the approval, `localSetup`'s tools check stops the run with `devos: Cursor CLI is not installed or not signed in on this computer`, and `done` 1, before the backup ask.
  - The GitHub path has no local tools check, so `workerL` never met this.
  - On your Windows machine the real Cursor CLI is on PATH and signed in, so the test passed there.
- **The fix is rehearsed.**
  - With `stage({ tools: ["agent"] })`, the worker passes, also under a PATH that holds no real agent tool.
  - `node --test` on `(l)`, `(ac)` and `(ad)` passes 3 of 3.
- **The product is right.** E46 S4 requires every agent tool of the roster to be signed in on this computer.
Ledger: D6 — PASS — deep read:
- **A GitHub plan, draft, screen and run are exactly today's.**
  - `buildPlan` returns early without a `cycle` key.
  - Every local branch is behind `localDraft()`.
  - `flowSteps()` gives a GitHub draft the same 17 steps as before.
  - The current and existing entries still check `st.doctor.ok`.
  - `consent.test.mjs (e)`'s GitHub link line is untouched; a local draft returns before it.
- **A local run from the page:**
  - `/api/plan` answers `keys: []`;
  - the run asks `approve` and then `backup` once;
  - `maybe` gets `Answer yes or no.`;
  - gh is called only after a yes (worker `ac`, once the stub is there: empty gh log);
  - no link is asked.
- **`--help` is checked first in `initCommand`.** cli-help (b) shows no folder created, also for `init <folder> --help`.
- **The remote's URL is never printed.** Test (g) asserts it.

Scope: in fence v2. Two gaps of the fence's own, found by the browser check and the deep read, ride with the FIX:
- **The review card and the drafting diagram list `Hosting: Vercel` for a local draft.** They read `d.modules`, and the default stack sets `hosting` to `vercel`; the plan sends `none`. The fix is rehearsed in Chromium: after picking local, the saved draft has `hosting` `none`.
- **The first screen's lede says "a GitHub project" under the local choice.**

`ui-page`, `consent`, `stability`, `ui-models` and `hub` pass 29 of 29 with both.
Method (payload changes only): none (`bin/` and `lib/` only).
Owner attention:
- **A local project's tools.** It needs every agent tool of its roster installed and signed in on this computer, as E46 set. With the default roster that includes the Cursor CLI (`agent`), not only the Cursor IDE.
- **Opening a started local project from the page** still checks the GitHub doctor (the hub, which E47 leaves alone). From a terminal, `devos continue` works.
- **`rememberChoices` keeps a local plan's `private`.** The next new project's default visibility is then private, the safe default.
- **The README's screenshots** show the first screen without the new choice. They can be retaken at the 1.5.0 release.
Next prompt: dev/fences/E47.md v3 (`### Attempt 3 focus`).
