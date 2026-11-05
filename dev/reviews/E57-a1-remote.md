VERDICT: PASS
MERGE
Fetched: `task/E57` @ abdd3c2 (`E57 a1: builder`), clean tree, over `main` @ 8cf8b17 · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?branch=task/E57`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD` · Refused calls: none

E57 adds `devos remove` (engine 1.8.0), in two runs:
- **With an engine lock**, on a clean tree with a branch checked out:
  - on a new branch `devos/remove`, it removes every lock file git tracks whose hash is still the lock's (at its
    `at`), with the lock and `devos.config.json`, and prunes the folders it empties;
  - it keeps the project's own files, setup's settings, every DEV_OS file the developer edited (listed),
    `docs/method/`, `.gitignore` and `.gitattributes`;
  - on `yes` it commits, pushes, opens "Remove DEV_OS" and sets `DEVOS_PAUSED` to `true`; `--local` commits only;
  - a failure before the commit resets the branch and deletes it.
- **Without a lock**, it lists what is left:
  - the branch `devos/adopt` on this computer, deleted after `yes` with its worktree;
  - on GitHub, read from origin's configured URL: the branch `devos/adopt`, DEV_OS's secrets, every `DEVOS_*`
    variable (the Control Tower link named) and every `devos:` label, deleted only after a typed `yes`;
  - the services' keys, asked apart. A secret DEV_OS does not know is never touched.

Risk 3, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote and rehearsed on
a copy of 8cf8b17 (536 tests); D3 proves the branch holds exactly those bytes. The builder's commit changes the 12
files and its report only. Read again on the branch:
- nothing on GitHub changes without a typed `yes`, except the pause after a confirmed first run (`DEVOS_PAUSED`,
  reversible);
- a deletion on this computer happens only on a branch made from a clean tree, so `git reset --hard` puts every
  file back;
- an untracked owned file is never deleted;
- no key value is read or printed, only names.
The builder's Windows run passed all six new tests (none skipped): the stub `gh.cmd`, the `insteadOf` file URL and the
worktree removal work there too.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 536`, `# pass 536`, `# fail 0`; the six `remove.test.mjs` tests are ok. The
  builder's Windows run: tests 536, pass 516, fail 0, skipped 20, the allowed count.
- D2 — PASS — `manifest up to date (315 files)`; `0 0`.
- D3 — PASS — `12 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (322 files scanned)`, `guard:manual PASS (123 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.8.0`.
- D6 — PASS — `engine-ci` run 42100548171 on abdd3c2, attempt 1, `success`: `checks` (with `actionlint`) success,
  `test (ubuntu-latest)` success with `# tests 536`, `# pass 536`, `# fail 0`.
- D7 — PASS — the 12 paths of S1, `dev/reports/E57.md`, `dev/LEDGER.md`, `dev/fences/E57.md` and `dev/fences/E57/**`
  (13 files: the 12 and `before.json`). Nothing else.

Scope: in the fence. No dependency; no payload, workflow or method file changes (the manifest changes its version
only).

Method (payload changes only): none. The payload's files and guards are untouched, so no precedent is needed and
`guard:manual` still checks 123 names. The command works outside the cycle, on the developer's computer, and keeps
every human gate: the file removals land as a pull request the owner merges.

Owner attention:
- **How to use it:** in a project, on main with nothing uncommitted, run `devos remove` and merge its pull request.
  Then pull, delete the local `devos/remove` branch, and run `devos remove` again to clear GitHub's settings with a
  typed `yes`.
- **1.8.0 is ready to release** after the merge (`dev/RELEASE.md`).
- **Next:** E58 (local mode as a handover), fenced on `task/E58` from `main` once you merge E57.

Commit message: E57: devos remove — DEV_OS's own files out by pull request (devos/remove, cycle paused), then its GitHub secrets, DEVOS_* variables and devos: labels after a typed yes, services' keys asked apart, a never-merged devos/adopt deleted; engine 1.8.0 — PASS a1
Next prompt: none on this branch. E58 is fenced on `task/E58` from `main` once you merge E57.
