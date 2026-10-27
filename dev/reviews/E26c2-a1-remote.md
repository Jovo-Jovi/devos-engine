MERGE

VERDICT: PASS
Fetched: `task/E26c2` @ d770717 (no uncommitted changes; `main` @ 5198aea, E27 merged) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 128982e HEAD`, `git diff 128982e HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40501334021 and its jobs, the attempt-1 report · Refused calls: none

E26c2 lets the developer edit each role's next models, which E26c1 (PR-64) taught the runner to try:
- **The command.** `devos models` shows them ("; then …"). `devos models fallback <reviewer|light|builder> <model,model…|none>` changes them.
- **The page.** The Models panel shows them for each role. **Next models** opens an editor: Move up, Remove, Add (from the tool's models, up to 4) and **Save by pull request**.
- **How a change is made.** `lib/fallbacks.mjs` works through the GitHub API, and the folder on this computer is not touched:
  - it reads `devos/project.json`, `devos/engine.defaults.json` and `devos.config.json` on the default branch;
  - it changes the role's `fallback_models`;
  - it makes the config with the payload's own `merge`;
  - it commits both files on `devos/models-<role>` and opens a pull request.

  The same list changes nothing. A project without a light reviewer of its own is told to change the reviewer's list.
- **The route.** `POST /api/fallbacks` follows the folder rules, answers 409 during a run, and passes the token, Host and Origin checks.
- **The docs.** The README, the changelog and section 9 of the project checklist say all this.

This is a deep review: risk 3, a command and a route that write a branch, two commits and a pull request on GitHub. The 11 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence. I also rendered the panel in Chromium at 1280 dark and 390 light, with the editor and a save showing the pull request's link and no console errors. The builder's commit adds only its report, which I read, and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 368`, `pass 368`, `fail 0`, `skipped 0`; `fallbacks.test.mjs` (a)–(f) are `ok 119`–`ok 124`. The builder's report on Windows: `tests 368`, `pass 353`, `fail 0`, `skipped 15` (E26c1's skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `11 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.2.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40501334021 on d770717, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 26 paths:
- the 11 copied paths;
- `dev/reports/E26c2.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E26c2.md`, `dev/fences/E26c2/before.json` and the 11 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No change to `payload/` (the manifest still lists 310 files), to the version, or to any route except `/api/fallbacks`. The engine never merges, never pushes to a default branch, and never touches the folder. No dependency.
Method (payload changes only): N/A — no payload file changed.
Owner attention:
1. **Look at it once** (the fence's owner step): on a project's page, open **Models of this project**, then **Next models**. Save only if you mean to open that pull request.
2. **Release 1.2.0.** It now holds E26a, E26b, E26c1, E26c2 and E27. Follow the six steps of `dev/RELEASE.md`, and date the `## 1.2.0` heading on the day of the tag. The project page's **Connect** needs this release.

Commit message: E26c2: several models per role, edited — devos models fallback and the Models panel's Next models open a pull request with devos/project.json and its generated config; the folder is not touched — PASS a1
Next prompt: none — the release of 1.2.0 is yours (`dev/RELEASE.md`). E23b4's fence is on offer after the release, as its ledger row says.
