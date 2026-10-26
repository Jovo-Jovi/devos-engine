# Building the engine (maintainers)

This page is for the people who build DEV_OS itself; the user guide is `README.md`. Like everything under `dev/`, it
does not ship in the public release.

The engine is built with its own method. Each task has a fence in `dev/fences/`. Cursor builds it, Claude reviews
it, and the owner commits. The plan is `dev/PLAN.md`, the decisions are `dev/DECISIONS.md`, and the task list is
`dev/LEDGER.md`.

## Layout

```
bin/devos.mjs          the command
lib/                   command internals; lib/data/tools.json lists the AI CLIs and their models
lib/ui/                the guided page that devos ui serves (IBM Plex fonts under the OFL, lib/ui/fonts/OFL.txt)
Start DEV_OS.cmd       Windows launcher of the guided page (Start DEV_OS.command on macOS)
devos, devos.cmd       the devos command from the engine folder, without npm link
payload/files/         the method, installed and upgraded (dot-directories are stored as dot-*)
payload/templates/     project-owned starting points, written once at install
payload/contract/      the contract shown by devos init
payload/manifest.json  every engine-owned path with its sha256 (generated: npm run manifest)
tools/                 build-manifest, verify-source, find-specifics, stage
test/                  node:test suites, no dependencies (npm test)
dev/                   plan, decisions, ledger, fences, reports, reviews
```

## Running a task

Every task is built and reviewed on its own branch, and reaches `main` only after the review of record.

1. **Branch (you).** Run `git switch main`, `git pull`, then `git switch -c task/E16` (the task id).
2. **Build (Cursor).** Open `devos-engine` in Cursor and start a new Agent chat with the model the fence header names.
   The prompt is `Execute dev/fences/E16.md exactly — attempt 1.` The rule `.cursor/rules/00-engine-dev.mdc` binds the
   builder: no git.
3. **Local review (optional, Claude Code).** In `devos-engine`, run `claude`, then `/engine-review E16`. It writes
   `dev/reviews/E16-a1.md`.
4. **Push (you).** Run `git add -A`, `git commit -m "E16 a1: build"`, then `git push -u origin task/E16`. The push
   starts `engine-ci` with two jobs, `checks` and `test (ubuntu-latest)`. The Windows tests are the builder's own
   run (*Done when* D1 in the report); `engine-ci` runs them on `main` after the merge.
5. **Remote review (the review of record).** Tell Claude in the DEVOS project "check task/E16". It runs every
   *Done when* check and writes `dev/reviews/E16-a1-remote.md` on the branch, with MERGE or FIX. It also updates the
   ledger and writes the next fence.
6. **On FIX, or when `engine-ci` is red:** pull the branch, run the next attempt in Cursor (`attempt 2`), and repeat
   from step 4.
7. **Merge (you), after MERGE:**
   ```
   git switch main
   git pull
   git merge --squash task/E16
   git commit -m "<the commit message from the review>"
   git push
   git push origin --delete task/E16
   git branch -D task/E16
   ```
   `main` keeps one commit per accepted task. The push to `main` runs `engine-ci` with the Windows tests too. If a
   job is red, tell the reviewer before the next task starts.

If Cursor halts, that is the system working: send its report to the review as it is.

## GitHub Actions minutes

`engine-ci` spends the account's Actions minutes, and a Windows minute counts as two. It is shaped to spend few:

- **Commits that change only `dev/`** (fences, reviews, the ledger) start no run. The reviewer's commits are all like
  that.
- **A task branch** runs `checks` and `test (ubuntu-latest)`. `main`, a pull request to `main` and a manual run add
  `test (windows-latest)`.
- **The tests run four files at a time** (`--test-concurrency=4`), which halves the suite on a 2-CPU runner.
- **To run the Windows tests on a task branch** before the merge, open the repository's Actions tab, choose
  `engine-ci`, then *Run workflow* on that branch.

GitHub filters by the files a push changes. A push that changes more than 300 files may be judged on the first 300
only; if a run is missing, start it by hand as above.
