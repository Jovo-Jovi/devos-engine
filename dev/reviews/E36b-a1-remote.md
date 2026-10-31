MERGE

VERDICT: PASS
Fetched: `task/E36b` @ 0a9d0bb (no uncommitted changes; `main` @ 4adda9e, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 5a923b3 HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41250887758 and its jobs, the attempt-1 report · Refused calls: none

E36b is D-E13's step 4b. From the brief the developer confirmed, `devos adopt` (yes after the brief, or `--install`) puts DEV_OS on a new local branch `devos/adopt`, in one commit.
- **Where it works.** In a worktree under `~/.devos/adopt/`, so the developer's checkout is never written.
- **What goes in.** The engine files sit beside the project's own (E36a). The developer's AI tool writes DEV_OS's documents from the brief (`lib/data/adopt-blueprint.md`). Then come the held permission files, the merged `CLAUDE.md` and the baseline (E35). Every guard must pass.
- **What stops it.** After each round, and again before the commit:
  - the tool moved the branch or changed the checkout;
  - a change outside Markdown in `docs/` and DEV_OS's settings files;
  - a change to a file of the project's, to an engine file (by hash, even one hidden from git), or a link.

  Before the brief, it also stops for an older copy, a tracked link, or files with DEV_OS's names. Any stop, a thrown error, Ctrl-C or `SIGTERM` removes the worktree and the branch.
- **The commit.** It runs without the project's hooks, and DEV_OS's files are committed even where the project's `.gitignore` hides them. Nothing is pushed (E36c).

**The review depth is deep (risk 3).** As with every Engine package, I wrote `dev/fences/E36b/files/` and reviewed it line by line before issue. Two independent security reads came first: the first found six gaps, the second confirmed their fixes and found four more, and v1 closes all ten (the fence lists them). D3 proves the branch's 8 copies are byte-identical to that package. The builder's commit adds only those copies and its report.
Ledger: D1 — PASS — my run on Linux: `tests 413`, `pass 413`, `fail 0`, `skipped 0`; `adopt-install.test.mjs` (m)–(s) all `ok`. The builder's report on Windows: `tests 413`, `pass 397`, `fail 0`, `skipped 16` (E28's skips, listed by name). (m)–(s) pass there too, including the failing project hook, the link made through the index, and Cursor.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `8 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41250887758 on 0a9d0bb, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`. The runner has no global git identity.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 20 paths:
- the 8 copied paths and `dev/reports/E36b.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E36b.md`, `dev/fences/E36b/before.json` and the 8 package copies.

There is no `payload/` path. **The deep review confirms:**
- the checkout is never written: every write goes through `writePlain` in the worktree, and `checkoutState` is compared after every round and before the commit;
- every return after `worktree add` goes through `drop`, inside `try`/`catch`, with the `exit` and signal handlers;
- the commit holds only what `strayPaths`, `changedEngineFiles` and the full `run-all` saw: everything is staged before the guards, and `diff --cached` against the base is checked last;
- `.devos/` stays ignored, so the brief and the survey never enter the commit;
- `BASELINE_GUARDS` is untouched, so `secrets`, `boundary`, `data` and `services` are never baselined.

This review and the ledger tick are added after it.
Scope: in fence. No payload file, `lib/init.mjs`, `lib/install.mjs`, `lib/setup.mjs`, guided page, workflow or version change. No dependency. No push, pull request or `gh` call beyond the survey.
Method (payload changes only): N/A. No payload file changes, so there is no precedent and no manual section.
Owner attention:
1. **The checks are not a sandbox.** They stop an AI tool that writes where it must not. A tool you let run any command (Gemini runs with `--approval-mode yolo`) can still act as you can on your computer. The code says so where `adoptInstall` is defined.
2. **Only `CLAUDE.md` is merged.** DEV_OS writes no `AGENTS.md` into a project, so the ledger row is corrected.
3. **A new follow-up is in the ledger** (E36b v1 fence). DEV_OS's `.gitignore` lines (`dist/`, `out/`, `/build`, `*.pem`) join the project's. A project whose `.gitignore` leaves out `.claude/` or `.cursor/` would trouble a later `devos upgrade`; the install names such files.
4. **Nothing is pushed yet.** Trying `devos adopt` on a clean clone ends with a local branch `devos/adopt`, and `git branch -D devos/adopt` undoes it.
Commit message: E36b: adopting an existing project, step 4b — from the confirmed brief, devos adopt (yes after the brief, or --install) puts DEV_OS on a new local branch devos/adopt in one commit, made in a worktree so the checkout is never written; the AI tool writes the documents (lib/data/adopt-blueprint.md); stops and removes the branch when it changes a project or engine file, commits, plants a link, or on Ctrl-C; an older copy, a tracked link or files with DEV_OS's names stop it before the brief; baseline and every guard before the commit, without the project's hooks (D-E13) — PASS a1
Next prompt: `dev/fences/E36c.md` (push, pull request and setup), written after this PASS, as its ledger row says.
