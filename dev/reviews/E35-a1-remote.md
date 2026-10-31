MERGE

VERDICT: PASS
Fetched: `task/E35` @ cca270d (no uncommitted changes; `main` @ 03a743a) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat c066f8d HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), the manifest's changed entries (old and new `payload/manifest.json` compared by path), engine-ci run 41205240402 and its jobs, the attempt-1 report, and the deep review of `lib.mjs` and `run-all.mjs` · Refused calls: none

E35 is D-E13's step 3, a method change (PR-68). The code a project already has gets a baseline.
- **What the baseline holds.** `devos/baseline.json` records once the findings of `naming`, `design`, `i18n`, `literals` and `imports`, matched by guard, file, rule and line text, up to a count.
- **How the guards use it.** `run-all.mjs` passes the findings it holds, with the note `N known (baseline)`, and fails every new or edited one.
- **The commands.** `--write-baseline` writes it once, `--shrink-baseline` only removes, and `--no-baseline` shows every finding.
- **What is never baselined.** `secrets`, `boundary`, `data`, `services`, the method's own guards, and a guard that crashed.

A project without the file behaves as before. This is a deep review: risk 3 and a method change. I wrote the package and rehearsed it on a clean copy of `main`. The 8 copied paths are byte-identical to it (D3). The builder's commit adds only its report and the rebuilt manifest.
Ledger: D1 — PASS — my run on Linux: `tests 401`, `pass 401`, `fail 0`, `skipped 0`; `baseline.test.mjs` (a)–(d) pass. The builder's report on Windows: `tests 401`, `pass 385`, `fail 0`, `skipped 16` (E28's skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `8 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`, and no `devos/baseline.json` is written. The builder's run printed `fatal: not a git repository` on stderr because its staging folder had no `git init`. That is the same as before this task and harmless.
Ledger: D5 — PASS — engine-ci run 41205240402 on cca270d, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 21 paths:
- the 8 copied paths;
- `payload/manifest.json` and `dev/reports/E35.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E35.md`, `dev/fences/E35/before.json` and the 8 package copies.

Nothing else.
- **The manifest.** Its diff changes the hashes of exactly `devos/prompts/reviewer.md`, `docs/method/AUTOMATION.md`, `docs/method/PRECEDENTS.md`, `scripts/guards/lib.mjs` and `scripts/guards/run-all.mjs` (10 lines). `engine_version` stays 1.4.0.
- **The deep review.**
  - The fingerprint strips only a line number between the path and ` — `.
  - `applyBaseline` never touches a guard that is not FAIL, nor one the baseline does not name.
  - `readBaseline` refuses any guard outside `BASELINE_GUARDS`, so a hand-added `secrets` entry is a `guard:baseline` FAIL.
  - The two write paths cannot add to an existing file: `--write-baseline` exits 2 when it exists, and `--shrink-baseline` uses `Math.min`.
  - The exit code follows the shown results.

This review and the ledger tick are added after it.
Scope: in fence. No other guard, workflow, `lib/` file or version change. No dependency.
Method (payload changes only):
- **The non-waivable rules hold.** The human gates, the roles' surfaces and the runner's git are untouched. `secrets` and `boundary` (and `data`, `services`) can never pass by a baseline, and a red check still overrides PASS.
- **PR-68** is the next id, and "Live maximum: PR-68".
- **The manual** gets its §5 paragraph and the reviewer prompt its rule. No new script file, so `guard:manual` stays at 117 names.
- **The guards** were run on a fresh install (D4).
Owner attention:
1. **You test at the end, with the guided page (E39).** Noted. Each step until then is proved by its tests, and E39's fence will carry the end-to-end check on a real project of yours.
2. **Projects get PR-68** with the next upgrade. Projects started with `devos init` never write a baseline, so nothing changes for them.

Commit message: E35: adopting an existing project, step 3 — the code a project already has gets a baseline (devos/baseline.json: naming, design, i18n, literals and imports, matched by file, rule and line text); run-all passes what it holds and fails what is new or changed; written once, only shrinks; secrets, boundary, data and services never baselined (PR-68, D-E13) — PASS a1
Next prompt: `dev/fences/E36.md` (install by pull request), written after this PASS, as its ledger row says.
