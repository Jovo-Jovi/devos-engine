MERGE

VERDICT: PASS
Fetched: `task/E25a` @ 1198504 (no uncommitted changes; `main` @ a2845f7) · Commands run: scope listing (`git diff --name-only main...HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), D5 (`devos models set boss grok-5`), engine-ci run 40414743619 and its jobs, the builder commit's manifest diff and report · Refused calls: none

E25a lets a project change its models without a commit, and setup now offers each agent tool's second account:
- **The runner (payload).**
  - `lib.mjs` `config()` applies `DEVOS_REVIEWER_MODEL`, `DEVOS_REVIEWER_LIGHT_MODEL` and `DEVOS_BUILDER_MODEL`. Each replaces one role's model and keeps its tool; a value that is not a model id is ignored, with a note.
  - `agents.mjs` reports the change in `builder_note` and the new `reviewer_note`.
  - Six workflow jobs pass the three variables in.
  - `AUTOMATION.md` names the variables, and `PRECEDENTS.md` adds PR-63.
- **The engine.**
  - `devos models` shows the three roles and sets or removes the variables through gh only. It never commits and never touches a key.
  - `neededKeys` offers each tool's `_2` key as an optional key, right after the first.
  - The version is 1.1.0.
- **Tests.** `models.test.mjs` (a)–(e), and the key lists and version strings of nine existing test files.

This is a deep review: risk 3, a method change in four workflows and two runner scripts. The 24 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence; the rehearsal on a clean `main` also ran actionlint 1.7.7 on every workflow. The builder's commit adds only `payload/manifest.json` and its report. I read both: the manifest changes `engine_version` and the eight hashes of the changed payload files, nothing else.
Ledger: D1 — PASS — my run on Linux: `tests 337`, `pass 337`, `fail 0`, `skipped 0`; `models.test.mjs` (a)–(e) are `ok 179`–`ok 183`. The builder's report on Windows: `tests 337`, `pass 326`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `24 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.1.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (116 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — exit 2 and exactly `devos: models: "boss" is not a role: use reviewer, light or builder`.
Ledger: D6 — PASS — engine-ci run 40414743619 on 1198504, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`.
Ledger: D7 — PASS — `git diff --name-only main...HEAD` lists:
- the 24 copied paths;
- `payload/manifest.json` and `dev/reports/E25a.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E25a.md`, `dev/fences/E25a/before.json` and the 24 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No dependency, workflow input, secret or other variable added. `devos models` calls only `git remote get-url origin` and `gh variable list|set|delete`.
Method (payload changes only):
- **Rules checked.** No non-waivable rule is weakened:
  - the human gates and the role surfaces are unchanged;
  - a red check still overrides a PASS;
  - no secret enters a file: the variables hold model ids, which are not secrets;
  - the runner still owns git.
- **Precedent.** PR-63 is the next id ("Live maximum: PR-63").
- **Manual.** `AUTOMATION.md` names the three variables (`guard:manual` 113 → 116) and the models note. No new script, guard, workflow, label or command.
Owner attention:
1. **The Tower is not an engine project.** These variables do nothing there until a Tower method fix adopts them.
2. **Existing engine projects** get 1.1.0 with `devos upgrade` (a pull request in each project).
3. **`CHANGELOG.md` says `## 1.1.0 — Unreleased`.** Release 1.1.0 after E25b, with the six steps of `dev/RELEASE.md`.

Commit message: E25a: a project's models change without a commit (repository variables, devos models) and setup offers each agent tool's second account; engine 1.1.0 (PR-63) — PASS a1
Next prompt: dev/fences/E25b.md (on `task/E25b`)
