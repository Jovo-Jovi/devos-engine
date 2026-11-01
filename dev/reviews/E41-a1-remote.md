MERGE

VERDICT: PASS
Fetched: `task/E41` @ 1f05786 (no uncommitted changes; `main` @ e3ea074, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff 77b5d9c HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), the PR-73 row compared with the fence's text, engine-ci run 41355287400 and its jobs, the attempt-1 report · Refused calls: none

E41 makes the fixes needed before the first real adoption (owner, 2026-11-01).
- **The code guards read every source folder.** `guards.source_roots` (default `src`) is read by `naming`, `design`, `i18n`, `literals` and `boundary`. The route checks read each root's `app/`. `devos adopt` adds a project's own top-level code folders before the baseline is written.
- **The import gate.** In production, a changed source file that imports a sign-in or payment package stops at the human gate and is reviewed deep (`reviewer.human_gate_imports`).
- **`.gitignore`.** Adopting merges only DEV_OS's own lines, and `devos upgrade` stages engine files with `git add -f`.
- **The method.** PR-73 and the manual record all of this. The engine is 1.4.1.

**The review depth is deep (risk 3).** It was a specification fence, so I read every changed line of `payload/` and `lib/`.
Ledger: D1 — PASS — my run on Linux: `tests 449`, `pass 449`, `fail 0`, `skipped 0`, with no `not ok`. The six new tests are `ok`:
- `adopt-files.test.mjs` (f), `adopt-install.test.mjs` (ac) and `adopt.test.mjs` (s);
- `guards-structure.test.mjs` (i) and `reviewer-output.test.mjs` (f);
- `upgrade.test.mjs --local stages an engine file the project's .gitignore leaves out`.

The builder's report on Windows: `tests 449`, `fail 0`, `skipped 20`, the skips the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — the builder's commit changes only the fence's paths:
- the payload's guards, runner scripts, defaults and method documents, and `payload/manifest.json`;
- `lib/adopt.mjs`, `lib/upgrade.mjs`, `package.json`, `README.md` and `CHANGELOG.md`;
- the S6 and S7 tests, the one `config-equivalence` line, and `dev/reports/E41.md`.

`dev/LEDGER.md` and `dev/fences/E41.md` are the reviewer's, from 77b5d9c. As the builder noted, the upgrade tests' simulated next branch (`devos/upgrade-1.4.2`) moved with the simulated version, as S6 intends.
Ledger: D4 — PASS — `devos 1.4.1`. The staged guards exit 0 with:
- `guard:secrets   PASS  (317 files scanned)`;
- `guard:manual    PASS  (117 names checked)`;
- `guard:config    PASS  (generated config is current)`;
- `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41355287400 on 1f05786, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — the deep review confirms:
- **No guard reads outside the repository through a new path.**
  - `sourceRoots()` refuses an entry outside `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, or one with a `.` or `..` part: no absolute path, drive or parent.
  - `importsGated` resolves each path inside `ROOT`, uses `lstat` and never follows a link, skips `docs/`, reads at most 1 MiB, and reads nothing when the list is empty.
- **The gate only adds `human_gate`.**
  - `gatePaths()` unions the path and import matches. `[UNREAD]` still holds the gate when the diff cannot be read.
  - Red checks are still decided before it (PR-08).
  - `reviewPlan` only adds paths to `critical`.
- **A project without the new settings behaves as before.** `source_roots` defaults to `["src"]` (a missing key too), and `human_gate_imports` to `[]`. Only the N/A note text changes.
- **Adopting.**
  - The `.gitignore` merge adds only `ADOPT_IGNORE`, which (s) proves equals `dot-gitignore`'s lines before `# Node / Next.js`.
  - Source roots and the import list are written to `devos/project.json` before `config.mjs --write` and the baseline.
- **The method.** PR-73 is the next id, after PR-72, with `Live maximum: PR-73`. Its row matches the fence's text exactly. `AUTOMATION.md` names `source_roots` and `human_gate_imports` in the three places S5 lists.
Scope: in fence. No workflow, no dependency, no `lib/install.mjs`, no guided-page change. `surveyLines`, the verdict notes and the adopt pull request texts are unchanged.
Method (payload changes only):
- **Non-waivable rules.** None is weakened: human gates are strengthened, `boundary` now reads every source folder, and red still overrides PASS. The role surfaces, the no-secrets rule and the runner's ownership of git are unchanged.
- **The precedent:** PR-73.
- **The manual:** §5 "Source folders (PR-73)", the `review-mode.mjs` row, the `devos.config.json` paragraph and the "Merged" bullet. `guard:manual` passes with 117 names.
Owner attention:
1. **`boundary` now reads an adopted project's real code.** If the existing code has a form, input or tracker outside a declared zone, the adoption stops before anything is committed, with "DEV_OS's checks fail on the project as it is". Declare the zones in its `docs/BOUNDARY_MODEL.md`, or fix the code. A project started with `devos init`, and the Control Tower, keep their code under `src/`, so nothing changes for them.
2. **Projects already on DEV_OS** see no change after `devos upgrade` to 1.4.1 unless they set the new settings.
3. **Not new, for a later task.** The guards read the files `git ls-files` lists, and `readFileSync` follows a tracked symbolic link. This was already true under `src/`, and adopted folders widen it. A finding prints at most 120 characters of a line. A guard that skips links would close it.
Commit message: E41: before the first real adoption — the code guards (boundary included) read every source folder (guards.source_roots; devos adopt adds a project's own before the baseline), in production a changed file that imports a sign-in or payment package stops at the human gate and is reviewed deep (reviewer.human_gate_imports), adopting merges only DEV_OS's own .gitignore lines and devos upgrade stages engine files the project ignores; engine 1.4.1 (PR-73) — PASS a1
Next prompt: none. The owner's next steps are a test on a new project, then the Control Tower's adoption (`devos adopt --check` first).
