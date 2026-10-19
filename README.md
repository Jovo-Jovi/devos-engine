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

## Running a task

1. **Build — Cursor.** Open `devos-engine` in Cursor. New Agent chat, model Grok 4.7 (the effort is in the fence
   header). Prompt: `Execute dev/fences/E01.md exactly.` The rule `.cursor/rules/00-engine-dev.mdc` binds it.
2. **Review — Claude Code.** In a terminal in `devos-engine`: `claude`, then `/model` (Opus for risk 3, Sonnet for
   risk 1–2), then `/engine-review E01`. It re-runs every check, writes `dev/reviews/E01-a1.md`, updates the ledger and
   prepares the next fence (or reissues this one on FAIL).
3. **Accept — you.** On PASS: `git add -A` and `git commit -m "<the message the review gives you>"`. On FAIL: back to
   step 1 with the reissued fence (`Execute dev/fences/E01.md exactly — attempt 2.`).

If Cursor halts, that is the system working: send its report to the review step as is.
