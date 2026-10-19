# devos-engine

DEV_OS Engine — guided onboarding and an automated Cursor ⇄ Claude development cycle for new projects.

Status: E01 — method extracted verbatim (103 files) · engine 0.1.0

This repository is being built locally, task by task, with the Dev OS method itself: a fence for each task in
`dev/fences/`, Cursor builds it, Claude reviews it, the owner commits. The plan is `dev/PLAN.md`; the task list is
`dev/LEDGER.md`.

## One-time setup (owner)

Folder layout on your machine:

```
<workspace>/
├── devos-engine/        this repository
└── devos-sources/
    ├── tower/           Jovo-Jovi/devos-control-tower, pinned at a49ca6d (the method's source)
    └── pilot/           Jovo-Jovi/devos-pilot, pinned at 4ccbef7 (module setup items)
```

From `<workspace>` (PowerShell, Command Prompt or bash — the commands are the same):

```
git clone https://github.com/Jovo-Jovi/devos-control-tower devos-sources/tower
git -C devos-sources/tower checkout a49ca6db268b98d6558077bf3e95b8ae759d91b3
git clone https://github.com/Jovo-Jovi/devos-pilot devos-sources/pilot
git -C devos-sources/pilot checkout 4ccbef799546315a491da86f4e3676ba46d8fa51
```

Then put the contents of this bootstrap into `devos-engine/` and, inside it:

```
git init -b main
git add -A
git commit -m "B0: engine bootstrap"
```

Optional: create a **private** GitHub repository `devos-engine` and push after each accepted task, as a backup. It
becomes public at launch (E10).

## Running a task (branch flow — from E03 attempt 2 on)

Every task is built and reviewed on its own branch and reaches `main` only after the remote check.

1. **Branch — you.** `git switch main`, `git pull`, `git switch -c task/E04` (the task id).
2. **Build — Cursor.** Open `devos-engine` in Cursor. New Agent chat, model as the fence header says. Prompt:
   `Execute dev/fences/E04.md exactly — attempt 1.` The rule `.cursor/rules/00-engine-dev.mdc` binds it (no git).
3. **Review — Claude Code.** In a terminal in `devos-engine`: `claude`, `/model` (Opus for risk 3, Sonnet for 1–2),
   `/engine-review E04`. It reviews `main...HEAD` plus the working tree, writes `dev/reviews/E04-a1.md`, updates the
   ledger and writes or reissues the fence.
4. **Push the branch — you.** `git add -A`, `git commit -m "E04 a1: build + local review"`, `git push -u origin task/E04`.
   The push starts the `engine-ci` workflow; when it is green, tell the remote reviewer (Claude in the DEVOS chat) "check task/E04". It reads the branch on GitHub, writes
   `dev/reviews/E04-a1-remote.md` on the branch, and says MERGE or FIX.
5. **On FAIL or FIX:** stay on the branch, pull, run the next attempt in Cursor, then steps 3–4 again (`a2`, …). A red `engine-ci` run is a FIX by itself.
6. **Merge — you, only after both reviews pass:**
   ```
   git switch main
   git pull
   git merge --squash task/E04
   git commit -m "<the PASS message from the review>"
   git push
   git push origin --delete task/E04
   git branch -D task/E04
   ```
   `main` keeps one commit per accepted task.

If Cursor halts, that is the system working: send its report to the review step as is.
