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

## One-time setup

```
<workspace>/
├── devos-engine/        this repository
└── devos-sources/
    ├── tower/           Jovo-Jovi/devos-control-tower, pinned at a49ca6d (the method's source)
    └── pilot/           Jovo-Jovi/devos-pilot, pinned at 4ccbef7 (module setup items)
```

From `<workspace>`:

```
git clone https://github.com/Jovo-Jovi/devos-engine.git
git clone https://github.com/Jovo-Jovi/devos-control-tower devos-sources/tower
git -C devos-sources/tower checkout a49ca6db268b98d6558077bf3e95b8ae759d91b3
git clone https://github.com/Jovo-Jovi/devos-pilot devos-sources/pilot
git -C devos-sources/pilot checkout 4ccbef799546315a491da86f4e3676ba46d8fa51
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
   starts `engine-ci` on Linux and Windows.
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
   `main` keeps one commit per accepted task.

If Cursor halts, that is the system working: send its report to the review as it is.
