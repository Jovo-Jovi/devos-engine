MERGE

VERDICT: PASS
Fetched: `task/E26b` @ 615e0da (no uncommitted changes; `main` @ 97ca5fa, E26a merged) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat f0f79fc HEAD`, `git diff f0f79fc HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40473926536 and its jobs, the attempt-1 report · Refused calls: none

E26b lets a project's page change the project, each step only when the page's facts allow it:
- **Upgrade by pull request.** **Upgrade to 1.2.0 by pull request** runs this engine's `devos upgrade` in the project's folder. It is offered when the project on GitHub is older than this engine, the folder matches GitHub, the default branch is checked out, and no upgrade pull request is open. An engine older than the latest release is told to update first.
- **Bring this folder up to date.** It runs `git pull --ff-only` after the upgrade is merged on GitHub.
- **Connect to the Control Tower.** It needs this engine, the project on GitHub and the latest release at the same version, and an explicit yes after reading the contract (`/api/connect` refuses without `accept: true` and the contract version, before any gh call). Then, through the GitHub API, a pull request on `devos/connect` records `registry_link: true` in `devos/answers.json`, and `DEVOS_REPORTING` turns on. The folder is not touched.
- **Choose a folder…** (asked before attempt 1, fence v2). On *Open a current project*, the page server opens the system's own folder dialog and returns only the chosen path:
  - PowerShell's folder browser on Windows;
  - `osascript` on macOS;
  - zenity, then kdialog, on Linux.

  One dialog opens at a time, it runs without a shell, and it stops after 10 minutes.
- **The server and the page.** Four routes are added: `POST /api/upgrade`, `/api/pull`, `/api/connect` and `/api/pick-folder`. Each answers 409 while a run is going and passes the token, Host and Origin checks. `GET /api/hub` adds `actions`.

This is a deep review: risk 3, routes that run `devos upgrade`, `git pull`, gh writes and a system dialog. The 9 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence, including in Chromium at 1280 dark and 390 light. The builder's commit adds only its report, which I read. It leaves the fence and the ledger as I wrote them (`git diff f0f79fc HEAD -- dev/fences dev/LEDGER.md` is empty). No payload file changed.
Ledger: D1 — PASS — my run on Linux: `tests 354`, `pass 354`, `fail 0`, `skipped 0`; `folder-picker.test.mjs` (a)–(c) and `hub-actions.test.mjs` (a)–(f) are `ok 118`–`ok 120` and `ok 128`–`ok 133`. The builder's report on Windows: `tests 354`, `pass 343`, `fail 0`, `skipped 11` (the existing Windows skips). Windows also ran `hub-actions.test.mjs` (e), the real `devos upgrade` through the server.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `9 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.2.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40473926536 on 615e0da, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 22 paths:
- the 9 copied paths;
- `dev/reports/E26b.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E26b.md`, `dev/fences/E26b/before.json` and the 9 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No change to `payload/`, to the version, or to any route except `/api/hub`, `/api/upgrade`, `/api/pull`, `/api/connect` and `/api/pick-folder`. No dependency.
Method (payload changes only): N/A — no payload file changed. The manifest still lists 310 files.
Owner attention:
1. **Look at it once** (the fence's owner step), on Windows: on **Current project**, press **Choose a folder…**. The dialog may open behind the browser.
2. **Connecting waits for the release.** The page offers **Connect by pull request** only when this engine, the project and the latest release are 1.2.0. Release 1.2.0 after E26c.

Commit message: E26b: from a project's page, upgrade by pull request, bring the folder up to date and connect to the Control Tower by pull request after an explicit yes; choose a folder in this computer's own dialog — PASS a1
Next prompt: E26c's fence, on `task/E26c` from `main` after this merge (its ledger row: "fence on PASS of E26b").
