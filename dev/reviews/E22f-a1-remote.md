VERDICT: PASS — MERGE
Fetched: task/E22f @ 51f10f6 (clean tree), main @ 2a96f7c · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, the D3 Buffer compare, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node --check` on the 14 D5 files, `gh run view 40100087309` (with its logs), `git diff --name-only main...HEAD`, the D7 Chromium run against this branch at 1440 px dark and 390 px light, and `dev/reports/E22f.md` read in full · Refused calls: none

This is the remote check of E22f a1. It is risk 3: how a blueprint round runs and ends, two server routes, the page and the README; it is the review of record.
- **The copies.** All 23 files are byte-identical to `dev/fences/E22f/files/`. They are my texts, read line by line when I wrote and rehearsed them.
- **The rest of the diff** is the report. It records P2 `20 files, 0 moved` before the copy and the real output of every row.
- **Nothing in `payload/` changes,** so this is not a method change.

Ledger: D1 — PASS — `# tests 236` / `# pass 236` / `# fail 0` (Linux), naming 13 lines:
- `agent-stream.test.mjs` (a)–(e);
- `init.test.mjs` (v), (w), (x) and (y);
- `ui-server.test.mjs` (v) and (w);
- `ui-page.test.mjs` (g);
- `agents-kit.test.mjs model rejection classifier`.

CI Windows: `tests 236`, `pass 229`, `skipped 7` (the existing skips).
Ledger: D2 — PASS — `manifest up to date (154 files)` · `0 0`
Ledger: D3 — PASS — `23 files, 0 differ`
Ledger: D4 — PASS — E14's line, unchanged: `59 identical, 42 changed (…), 53 added (…), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D5 — PASS — `node --check` is clean for the ten `lib/` files and the four tests
Ledger: D6 — PASS — run `40100087309` on `51f10f6`, attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` success
Ledger: D7 — PASS
- **The scope.** `git diff --name-only main...HEAD` lists 24 paths: the 23 and `dev/reports/E22f.md`.
- **The page.** Chromium against this branch, the harness stubs and a slow streaming stand-in for `agent`. It gives the rehearsal's lines in both runs, with `errors []`:
  - models `auto grok-4.7-high grok-4.7-xhigh-fast`;
  - the alert `devos: agent cannot use the model grok-4.7-high; choose another model it lists`, with "Try again with this model", Start a new project and Close DEV_OS;
  - the live panel "Cursor CLI is working" with each step;
  - a stop at the approval without the model picker;
  - `hello-cli` listed with "It picks up at: approve the blueprint, or ask for changes.";
  - the finder's "That folder holds no started DEV_OS project." for a wrong folder, then Continue to "Review the blueprint";
  - "DEV_OS is closed", and the server exited 0.

Scope: in the fence.
Method (payload changes only): none; the payload is unchanged (D2, D4).
Owner attention:
- (1) **The Tower pin is retired** (your decision of 2026-10-24: `devos-engine` is the source of truth). Recorded in the ledger: the Ports table is closed, fences from E24 on have no `verify-source` row, and a cleanup follow-up goes to E10. At the merge, remove "One-time setup" from `dev/MAINTAINERS.md` (the merge steps below do it). In `CLAUDE.md` (yours), drop "Ports from the Tower" and the `../devos-sources` clause of "Remote check", and point "Running a task" at `dev/MAINTAINERS.md`.
- (2) **Old branches.** `task/E08`, `task/E22a`, `task/E22b`, `task/E22c` and `task/E22d` are each identical to their squash commit on `main` (`git diff` empty), so they are safe to delete. My sandbox may not delete branches on GitHub (HTTP 403 from its proxy), so the delete command is in the merge steps.
- (3) **Engine updates reach a project through `devos upgrade`.** It works at the same version, but its branch is `devos/upgrade-<version>`, and a second upgrade at an unchanged version stops on "branch … already exists". From E24 on, every payload change raises the engine version.
- (4) **E24 is next.** I write its fence on `task/E24` from `main` after this merge, rehearsed on the merged tree.

Commit message: E22f: real-run fixes — bare model ids from the tool's own list, Cursor and Claude rounds stream their steps live and end on the agent's result, repair rounds resume the same session, any project continues from the page with its resume step, the blueprint model changes after an error, Start a new project and Close DEV_OS, a project folder inside the engine refused, the README a user guide — PASS a1
Next prompt: dev/fences/E24.md (written after this merge, on task/E24)
