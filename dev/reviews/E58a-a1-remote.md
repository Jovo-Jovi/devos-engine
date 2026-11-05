VERDICT: PASS
MERGE
Fetched: `task/E58a` @ 3130a5f (`E58a a1: builder`), clean tree, over `main` @ 056d864 · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?branch=task/E58a`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD` · Refused calls: none

E58a makes local development a handover (PR-83, engine 1.9.0):
- **The handover** (`lib/handover.mjs`). After the approval and before the first commit:
  - `devos/answers.json` records `handover: { engine, on }`;
  - every engine-lock file leaves, except `docs/method/`, `.gitignore` and `.gitattributes`;
  - so do the lock, `devos.config.json`, the reviewer's `CLAUDE.md`, `devos/ci/` and `.devos/`, with any folder
    they empty;
  - the plan, `README.md`, `SETUP.md`, `devos/answers.json` and setup's settings stay;
  - a second run removes only what is left.
- **Local setup:**
  - no agent tool check;
  - the backup is a plain private repository: `gh repo create`, then the push, with no `DEVOS_PAUSED`;
  - `SETUP.md`, the README section, `--help`, the page and the README table describe the handover;
  - with generated media, `SETUP.md` says the plan stays and `devos media` makes it once DEV_OS is back.
- **Continue and verify:**
  - `devos continue` and `devos verify` have a handed-over step;
  - "local tools" is gone, with its helpers;
  - a local project committed before 1.9.0 is never handed over.
- **The method:** the precedent PR-83 and its live maximum. In the blueprint prompt, a local project's fences name
  only the stack's commands, and no `CLAUDE.md` is written there.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of 056d864 (540 tests). That rehearsal caught three existing tests the change moved, and the
package carries their fixes. D3 proves the branch holds exactly those bytes. The builder's commit changes the 23
files and its report only. Read again on the branch:
- **What the handover may delete.** Only paths the engine lock lists, plus four named DEV_OS paths, each through
  `safeRelative`.
- **When it runs.** Only from local setup, which skips it for a folder whose `HEAD` exists without a recorded handover
  while the lock is present. So a committed pre-1.9.0 project is never touched, as test (d) proves.
- **The blueprint sentence.** PR-77's pinned sentence stays whole: the local rule follows it.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 540`, `# pass 540`, `# fail 0`; the four `handover.test.mjs` tests are ok.
  The builder's Windows run: tests 540, pass 520, fail 0, skipped 20, the allowed count; the four new tests passed
  there too.
  - The reviewer's first run, made while the staged guards ran beside it, failed one older test: `init.test.mjs (f)
    Ctrl-C during a round exits 130`, at its check that the stopped model process is gone within 5 seconds.
  - E58a does not touch that path; its `lib/init.mjs` change is the `--help` text only.
  - The test passed 3 times of 3 alone, in CI, on Windows, and in the full rerun above with nothing else running.
  - It is a timing flake under load, kept as a follow-up.
- D2 — PASS — `manifest up to date (315 files)`; `0 0`.
- D3 — PASS — `23 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (322 files scanned)`, `guard:manual PASS (123 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.9.0`.
- D6 — PASS — `engine-ci` run 42111429779 on 3130a5f, attempt 1, `success`: `checks` (with `actionlint`) success,
  `test (ubuntu-latest)` success with `# tests 540`, `# pass 540`, `# fail 0`.
- D7 — PASS — the 23 paths of S1, `dev/reports/E58a.md`, `dev/LEDGER.md`, `dev/fences/E58a.md` and
  `dev/fences/E58a/**` (24 files: the 23 and `before.json`). Nothing else.

Scope: in the fence. No dependency; no workflow, script or guard changes.

Method (payload changes only):
- Non-waivable rules: none is weakened.
  - Human gates, role surfaces, red-check-overrides-PASS and secrets never in files are untouched.
  - The cycle's own behaviour is unchanged.
  - Only a new local project leaves DEV_OS's automation, by the developer's own choice of local development.
- Precedent: PR-83 was added, and the live maximum is now PR-83; `handover.test.mjs` (c) pins both.
- Manual: no new script, guard, variable, label or command, so `AUTOMATION.md` is unchanged and `guard:manual` still
  checks 123 names.

Owner attention:
- **Do not release 1.9.0 yet.** `SETUP.md`, the README and the page now say `devos adopt` brings DEV_OS back; E58b
  makes that true. Until then `devos adopt` stops on a handed-over folder and changes nothing.
- **Medix:** a Medix set up after this merge is handed over, without DEV_OS's scripts. To keep its reviewer-chat loop,
  set it up on 1.8.0 (or in automated mode) before you merge this. Once committed, it is never handed over.
- **Next:** E58b, fenced on `task/E58b` from `main` once you merge E58a.

Commit message: E58a: local development is a handover — after the approved blueprint, DEV_OS's scripts, guards, workflows, agent settings and lock leave before the first commit; the plan and docs/method/ stay; plain private backup; pre-1.9.0 local projects untouched; engine 1.9.0 (PR-83) — PASS a1
Next prompt: none on this branch. E58b is fenced on `task/E58b` from `main` once you merge E58a.
