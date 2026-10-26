MERGE

VERDICT: PASS
Fetched: `task/E21` @ 89785c7 (no uncommitted changes) · Commands run: scope listing (`git diff --name-only main...HEAD`, `git diff --stat 6a5d3d9 89785c7`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (`devos verify` and `devos watch` on an empty folder, `devos watch --interval 2`), engine-ci run 40302948403 with its jobs · Refused calls: none

E21 adds `devos verify` and `devos watch` (`lib/verify.mjs`).
- **The audit:** the machine, the GitHub CLI, the project's steps (the checklist `devos continue` prints, now read from the same module), and the newest `devos-cycle` run.
- **A failed run** is quoted in its own words (annotations, then the failed step's error lines) with a likely cause, the fix and who applies it.
- **CI:** `engine-ci` runs the Windows tests by hand only.

This is a standard review: risk 2, no payload file changed. The 8 copied paths are byte-identical to the package (D3). I wrote and read every line of that package before issuing the fence, and tried its cause finder on two real failed runs of this repository. The builder's commit adds only its report, which I read; `payload/manifest.json` is untouched.
Ledger: D1 — PASS — my run on Linux: `tests 307`, `pass 307`, `fail 0`; `verify.test.mjs` (a)–(f) are `ok`. The builder's report on Windows: `tests 307`, `pass 296`, `fail 0`, `skipped 11`.
Ledger: D2 — PASS — `manifest up to date (308 files)`; `0 0`.
Ledger: D3 — PASS — `8 files, 0 differ`.
Ledger: D4 — PASS. The builder's run exited 0 with `ok    gh: signed in as Jovo-Jovi (repo, workflow)`. My run, on a session whose `gh auth status` reports no login, exited 1, and its one `STOP` row has `fix: Run: gh auth login`, as the fence requires. Both runs print `MACHINE`, `GITHUB`, `PROJECT` and `  ok    DEV_OS project: none in …`. Watch on the empty folder exits 1 with `devos: no DEV_OS project in …; start one with devos init`. `--interval 2` exits 2 with the usage line.
Ledger: D5 — PASS — engine-ci run 40302948403 on 89785c7, run attempt 1: `checks` (12 s) and `test (ubuntu-latest)` (2 min 29 s), both `success`, and no Windows job. The fence commit 6a5d3d9 (only `dev/`) started no run.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 20 paths:
- the 8 copied paths and their 8 package copies;
- `dev/reports/E21.md`;
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E21.md`, `dev/fences/E21/before.json`.

Nothing else: no payload file, no `payload/manifest.json`.
Scope: in fence. No dependency added. `devos verify` lists secret names only and never calls `gh secret set`.
Method (payload changes only): none — no payload file changed.
Owner attention:
1. **Windows tests by hand from now on.** Run them before the release (Actions → `engine-ci` → *Run workflow* on `main`): about 15 minutes, counted as 30.
2. **Your decisions of 2026-10-26 are in the ledger.**
   - E09 is the Tower link by request: the engine asks, you approve in the Tower, and nothing ever blocks a project.
   - E23b4 comes after the release.
   - E10 uses the recommended licence: PolyForm Shield 1.0.0 for the engine and MIT for the files it installs into a project.
   - Two rows of `dev/DECISIONS.md` are yours to update: D-E3 and D-E6 (the GitHub App and the receipt check) and D-E4 (the licence).
3. **The next fence is E09.** It is written on `task/E09` from `main` after this squash.

Commit message: E21: devos verify and devos watch — what stands between this computer and a green cycle run, a failed run in its own words — and the Windows tests run by hand — PASS a1
Next prompt: dev/fences/E09.md (v1, on `task/E09`, after this squash)
