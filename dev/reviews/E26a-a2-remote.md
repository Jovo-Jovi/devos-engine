MERGE

VERDICT: PASS
Fetched: `task/E26a` @ 5ad918b (no uncommitted changes; `main` @ ad4c085) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 0c12929 HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40468862166 and its jobs, the manifest diff and the attempt-2 report · Refused calls: none

E26a gives the guided page a choice after the computer check: **New project** or **Current project**.
- **Opening a current project.** It comes from three places:
  - the started projects;
  - a folder on this computer;
  - a GitHub address. The gh account must own or administer the repository, and its default branch must hold `devos/engine.lock.json`. It is cloned into `~/devos-projects`, and a matching clone there is reused.
- **The project's page.** It shows the setup, the versions (the project's, this engine's and the latest release), the Control Tower link and, once the project is on GitHub, the Models panel. Reading changes nothing.
- **The server.** It adds `GET /api/hub` and `POST /api/clone`. Clone runs only when the page chooses the folder. Both routes answer 409 while a run is going, and both pass the token, Host and Origin checks.
- **The version** is 1.2.0 (`## 1.2.0 — Unreleased`).

This is a deep review: risk 3, a route that clones with gh. The 13 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence; v2 changes only `hub.test.mjs` (c), which now reads the cloned lock file as JSON. The builder's commit adds only `payload/manifest.json` and its report, which I read. The manifest changes `engine_version` from 1.1.0 to 1.2.0 and nothing else. The commit leaves the fence, the ledger and the a1 review as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 345`, `pass 345`, `fail 0`, `skipped 0`; `hub.test.mjs` (a)–(e) are `ok 125`–`ok 129`. The builder's report on Windows: `tests 345`, `pass 334`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `13 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.2.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40468862166 on 5ad918b, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 32 paths:
- the 13 copied paths;
- `payload/manifest.json` and `dev/reports/E26a.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E26a.md`, `dev/fences/E26a/before.json`, the 13 package copies and `dev/reviews/E26a-a1-remote.md`.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No change to `payload/` beyond the manifest's version. The only routes added are `/api/hub` and `/api/clone`. No dependency.
Method (payload changes only): N/A — no payload file changed except the manifest's `engine_version`.
Owner attention:
1. **Look at it once** (the fence's owner step): start DEV_OS, choose **Current project**, and open a project from the list or by its GitHub address.
2. **Do not release 1.2.0 yet.** E26b (upgrade and connect) and E26c (several models per role) also land in 1.2.0. Connecting will need the project, the engine and the latest release to match, so release 1.2.0 after E26c.

Commit message: E26a: new or current project — a current project's page, opened from this computer or cloned from GitHub (setup, versions, Control Tower link, models); engine 1.2.0 — PASS a2
Next prompt: E26b's fence, written on `task/E26b` from `main` after this merge (its ledger row: "fence on PASS of E26a").
