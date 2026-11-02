MERGE

VERDICT: PASS
Fetched: `task/E42` @ c7ea922 (no uncommitted changes; `main` @ a1b54e7, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main`), every changed line of `lib/` and `test/`, the four version-pinned test files compared with `main` after the fence's two-step move, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, the `whereWin` and `'where'` counts), engine-ci run 41416699645 and its jobs, the attempt-2 report (D7) · Refused calls: none

E42 fixes the defect the Mawsim test found on 2026-11-02. On Windows the blueprint agent was started through `where`'s first hit. For an npm install, that hit is npm's shell script with no extension, so Node failed with `spawn … ENOENT`, and the engine printed no reason.
- **One PATH search.** The new `searchPathWin` in `lib/spawn.mjs` tries only the PATHEXT extensions, folder by folder. `resolveTool` uses it, and `which.mjs` now uses the same search, so the agent check and the start agree. `whereWin` and the `where` call are gone.
- **A start failure says why.** `startFailureLines` prints the error, a PATH hint on `ENOENT`, then the old line.
- **The Windows test fixture** writes npm's file with no extension beside each `.cmd`, so the suite now exercises the case that broke.
- **The version** is 1.4.2, and the version-pinned tests, the README and the changelog follow it.

**The review depth is standard (risk 2).** It was a specification fence, and I read every changed line of `lib/` and `test/`.
Ledger: D1 — PASS — my run on Linux: `tests 453`, `pass 453`, `fail 0`, `skipped 0`, with no `not ok`. The four new tests are `ok`: `init.test.mjs startFailureLines names why the agent could not start` and the three `spawn.test.mjs searchPathWin …` tests. The builder's report on Windows: `tests 453`, `fail 0`, `skipped 20`, the skips the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `git diff --name-only main` lists the 18 paths of D3 and nothing else. The four version-pinned test files equal `main`'s after `1.4.2 → 1.4.3`, then `1.4.1 → 1.4.2`, with no other change. `dev/LEDGER.md` and `dev/fences/E42.md` are the reviewer's.
Ledger: D4 — PASS — `devos 1.4.2`; `grep -c "whereWin" lib/spawn.mjs` prints `0`, and `grep -c "'where'" lib/spawn.mjs` prints `0`.
Ledger: D5 — PASS — engine-ci run 41416699645 on c7ea922, its first run: `checks` success, `test (ubuntu-latest)` success.
Ledger: D6 — PASS — `searchPathWin` is pure: folders, extensions and the file check all come from its arguments, and `path.win32.join` touches nothing. A bare name can only return `folder\name + ext` for an extension in the list, so npm's file with no extension and `claude.ps1` are never returned. `which.mjs` gives the same results on Windows: the same folders, extensions and order, with entries now trimmed. Both POSIX branches are unchanged; `which.mjs` only moved its `dirs` line below the Windows branch.
Ledger: D7 — PASS — the owner's Windows run in the report: `{"path":"c:\\Users\\…\\AppData\\Roaming\\npm\\claude.CMD","viaShell":true}`, on the same machine where `where.exe claude` listed `…\npm\claude` first.
Scope: in fence. Attempt 1 halted correctly on the fence's own defect (v1 missed the version-pinned tests), and v2 named them.
Method (payload changes only): none. Only `payload/manifest.json`'s `engine_version` changed, so there is no precedent and no `AUTOMATION.md` change.
Owner attention: none blocking. One note goes to the follow-ups: Windows allows a PATH entry in double quotes (`"C:\Program Files\x"`), which `where` accepted and `searchPathWin` does not strip. `which.mjs` had the same limit before, so nothing regresses; it is rare.
Commit message: E42: the blueprint agent starts on Windows when its CLI came from npm, and a start failure says why; engine 1.4.2 — PASS a2
Next prompt: none. Release 1.4.2 (`dev/RELEASE.md`), then restart Mawsim from `devos ui`.
