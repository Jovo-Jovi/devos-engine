MERGE

VERDICT: PASS
Fetched: `task/E25b` @ cd4cb48 (no uncommitted changes; `main` @ c0374be, E25a merged) · Commands run: scope listing (`git diff --name-only main...HEAD`), the fence and ledger against d2a9f36, D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40418347385 and its jobs, the builder commit and its report · Refused calls: none

E25b gives the guided page a Models panel for a started project:
- **The server.** `GET` and `POST /api/models` read and change the three model variables through `lib/models.mjs`.
  - They pass the same token, Host and Origin checks as every page route.
  - They use the folder rules of `GET /api/project`.
  - A change is refused while a run is going, and a refused change never reaches gh.
- **The page.** Every started project gets **Models** next to **Continue**, and a started folder gets **Models of this project**. The panel shows each role's tool and the model in use, with the tool's model list, **Use this model**, and **Back to the configured model** when a variable is set.
- **`lib/models.mjs`.** `changeMessage` gives the command and the page the same sentence, so `devos models` prints exactly what it did in E25a; `models.test.mjs` still passes unchanged.
- **Tests.** `ui-models.test.mjs` (a)–(c).

This is a deep review: risk 3, two routes that write repository variables. The 7 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence, and rendered the panel in Chromium at 1280 dark and 390 light with no console errors. The builder's commit adds only its report, which I read, and leaves the fence and the ledger as I wrote them (`git diff d2a9f36 HEAD -- dev/fences dev/LEDGER.md` is empty).
Ledger: D1 — PASS — my run on Linux: `tests 340`, `pass 340`, `fail 0`, `skipped 0`; `ui-models.test.mjs` (a)–(c) are `ok 276`–`ok 278`. The builder's report on Windows: `tests 340`, `pass 329`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `7 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.1.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40418347385 on cd4cb48, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists:
- the 7 copied paths;
- `dev/reports/E25b.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E25b.md`, `dev/fences/E25b/before.json` and the 7 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No change to `payload/`, the version, or any route other than `/api/models`. No dependency.
Method (payload changes only): N/A — no payload file changed. The manifest still lists 310 files.
Owner attention:
1. **Look at it once:** run `devos ui` in a started project and press **Models of this project** (the fence's owner step).
2. **Release 1.1.0** with the six steps of `dev/RELEASE.md`. Step 1 dates `## 1.1.0 — Unreleased`. This release also supersedes the v1.0.0 tag, which sits on the commit whose licence test failed.

Commit message: E25b: the guided page's Models panel (GET and POST /api/models through lib/models.mjs) — PASS a1
Next prompt: none — the release of 1.1.0 is yours (`dev/RELEASE.md`). E23b4's fence comes after the release, as its ledger row says.
