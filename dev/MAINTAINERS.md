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
tools/                 build-manifest, find-specifics, models-refresh, release-check, sources, stage
test/                  node:test suites, no dependencies (npm test)
dev/                   plan, decisions, ledger, fences, reports, reviews
```

## Running a task

Every task is built and reviewed on its own branch, and reaches `main` only after the review of record.

1. **Fence (the reviewer).** Claude in the DEVOS project writes `dev/fences/E16.md`, with its package (below), and
   pushes it to a new branch `task/E16` from `main`.
2. **Build (Cursor).** Run `git fetch`, then `git switch task/E16`. Open `devos-engine` in Cursor and start a new
   Agent chat with the model the fence header names. The prompt is `Execute dev/fences/E16.md exactly — attempt 1.`,
   and it may ask Cursor to commit and push `E16 a1: builder` when the steps are done. The rule
   `.cursor/rules/00-engine-dev.mdc` binds the builder: no git unless your prompt asks for it.
3. **Local review (optional, Claude Code).** In `devos-engine`, run `claude`, then `/engine-review E16`. It writes
   `dev/reviews/E16-a1.md`.
4. **Push.** When Cursor did not push, run `git add -A`, `git commit -m "E16 a1: builder"`, then `git push`. The push
   starts `engine-ci` with two jobs, `checks` and `test (ubuntu-latest)`. The Windows tests are the builder's own run
   (*Done when* D1 in the report).
5. **Remote review (the review of record).** Tell Claude in the DEVOS project "check task/E16". It runs every
   *Done when* check and writes `dev/reviews/E16-a1-remote.md` on the branch, with MERGE or FIX. It also updates the
   ledger and writes or reissues the next fence.
6. **On FIX, or when `engine-ci` is red:** pull the branch, run the next attempt in Cursor (`attempt 2`), and repeat
   from step 4.
7. **Merge (you), after MERGE:**
   ```
   git switch main
   git pull
   git merge --squash origin/task/E16
   git commit -m "<the commit message from the review>"
   git push
   git push origin --delete task/E16
   git branch -D task/E16
   ```
   `main` keeps one commit per accepted task, the review included. The push to `main` runs `checks` and the Linux
   tests. If a job is red, tell the reviewer before the next task starts.

If Cursor halts, that is the system working: send its report to the review as it is.

## Fences: exact-file packages

Since E53, a task that changes code ships as an exact-file package. It costs one build and one review, and every
package so far passed on its first attempt.

- **The reviewer writes the change.** It applies the change to a scratch copy of `main` and rehearses it in full:
  - the whole suite;
  - the manifest and `find-specifics`;
  - the staged guards;
  - `actionlint` when a workflow changes;
  - the page in Chromium when the page changes.

  Every existing test the change moves (a version pin, a manual count, a scripted answer, the live maximum) is fixed
  in the package before the fence is issued.
- **The package is the requirement.** Every changed file is under `dev/fences/E16/files/`, at its path from the
  repository root. `dev/fences/E16/before.json` holds the SHA-256 of each file it replaces, with CRLF read as LF.
- **The builder copies.** Cursor copies each file byte for byte, edits nothing, and runs the *Done when* rows:
  - the preconditions: `N files, 0 moved`;
  - the byte compare: `N files, 0 differ`;
  - the suite, the manifest, the staged guards and the version.

  A file of the package that would need an edit is a HALT, never a fix.
- **One fence for small things.** Small decided items (follow-ups, a fix, a policy line) ride together in one
  package. A task that needs the owner's design decision gets a fence of its own, so a failure never repeats the
  rest.
- **Short fences.** The fence states the owner's decision, the files, the rows and their exact expected output, and
  nothing the package already shows.

## The models every project is offered

`lib/data/tools.json` lists each AI tool's models, the ones the guided page and `devos init` offer first. Before a
release, or when a provider announces a model, refresh it (E75):

1. Put the keys you have in your shell, by name: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. Sign in to
   the Cursor CLI (`agent login`) for Cursor's own list. A missing key or tool is skipped and named.
2. `node tools/models-refresh.mjs` lists, per tool, the newer models its live list has and the engine's models it no
   longer lists.
3. `node tools/models-refresh.mjs --write` adds the newer ones, first in their family's group. It never removes one: a
   model one account no longer lists may still run for another. Remove one by hand, with a reason, when its provider
   retires it.
4. Commit `lib/data/tools.json` on a branch and open a pull request; the tests that pin a model id say so.

A project checks its own roles with `devos models check` (or Check for newer models on the guided page).

## GitHub Actions minutes

`engine-ci` spends the account's Actions minutes, and a Windows minute counts as two. It is shaped to spend few:

- **Commits that change only `dev/`** (fences, reviews, the ledger) start no run. The reviewer's commits are all like
  that.
- **Every push and pull request** runs `checks` and `test (ubuntu-latest)`, about 4 counted minutes.
- **The Windows tests run only by hand** (since E21): open the repository's Actions tab, choose `engine-ci`, then
  *Run workflow* on a branch. They take about 15 minutes, counted as 30. Run them before a release, and when a task
  changes how the engine spawns tools, reads paths or handles line endings. Every builder runs D1 on Windows.
- **The tests run four files at a time** (`--test-concurrency=4`), which halves the Linux suite on a 2-CPU runner.
  The Windows tests are CPU-bound and gain nothing from it.

GitHub filters by the files a push changes. A push that changes more than 300 files may be judged on the first 300
only; if a run is missing, start it by hand as above.
