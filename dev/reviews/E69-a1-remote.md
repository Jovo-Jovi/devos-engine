MERGE

VERDICT: PASS
Fetched: HEAD @ 9d16f4f (`E69: the deploy's CLIs from lockfiles, its secrets only where used; the cycle wakes the
supervisor … - attempt 1`) + working tree clean · Commands run: D1–D6 and D8 on Linux, D7 through `gh run view` ·
Refused calls: none

E69 attempt 1 copied the package of v1 byte for byte: 19 changed files and 4 new ones, plus the report.
- **The package (PR-95, version 1.13.2):**
  - **N5:** the deploy installs its Vercel and Firebase CLIs from lockfiles in `devos/tools/`, with no install script,
    in a step that holds no secret. The Vercel token is in the Deploy step only.
  - **C4:** a failed run the cycle started itself now starts the supervisor (`notify-supervisor`, `actions: write`
    only), and the supervisor waits for that run to finish.
  - **C5:** the supervisor takes a run's task from its artifacts, and reads the failed steps' log or says why it cannot.
  - **F1:** what Claude Code wrote is shown in one fenced block.
- **Who wrote it:** the reviewer, rehearsed on a copy of `main` @ 92fcf5c with one full suite run, both lockfiles
  installed with scripts off, and a deep self-review. No separate review agent ran (the owner's token budget): this
  check is the deep review of record.

Review depth (risk 3: production credentials). Every row was rerun here, and the copied files equal the package (D3),
so every changed line is the line reviewed for the package. For this check I read again, in `git diff main...HEAD`:
- the deploy job: no `secrets.` at its level, and the tools step before the Firestore step;
- `vercel-deploy.sh`;
- `notify-supervisor` and the supervisor's wait step;
- `supervisor.mjs`: `failingStep`, `runTask` and `report`.

The builder changed nothing under `dev/fences/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/` (`git diff --quiet
f6d8d7f 9d16f4f` on them).

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` on Linux:
- `# tests 657`, `# pass 657`, `# fail 0`;
- the 12 tests of `hardening.test.mjs` are all `ok`;
- `git status --porcelain test/fixtures` printed nothing.
The builder's Windows run: tests 657, pass 619, skipped 38, fail 0, as v1 says (`hardening.test.mjs` (i), (k) and (l)
skip on Windows; (j) runs).
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `23 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.2`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 42808058845 on 9d16f4f (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 50 paths, only:
- the 23 paths of S1;
- `dev/reports/E69.md`;
- the 24 files of `dev/fences/E69/` (the 23 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E69.md`.

This review adds itself.

Scope: in fence. The report's deviations are the owner's shell only. actionlint was not on PATH, so the Windows binary
of 1.7.7 ran through Git bash.

Method (payload changes only):
- **The precedent:** PR-95 follows PR-94, the live maximum, and amends PR-93 and PR-94.
- **The manual:** `AUTOMATION.md` names `devos/tools/vercel` and `devos/tools/firebase`, `notify-supervisor`,
  `after_run` and `DEVOS_VERCEL_BIN`, and gives the production order with the tools step and the secrets per step.
  `guard:manual` passes with 135 names: no new script under `scripts/devos/`, guard, variable, label or command.
- **Non-waivable rules, none weakened:**
  - **Human gates are kept.** The supervisor still proposes and you approve. The new job only starts it.
  - **Role surfaces are untouched.**
  - **A red check still overrides a PASS.**
  - **Secrets never go in files, and fewer steps see them.** No secret is at the deploy job's level, the Vercel token is
    in one step, and the lockfiles hold only package names, versions and hashes.
  - **The runner owns git.** No new push. The new job can only start a workflow.

Owner attention:
- **`vercel build` still runs the project's code with the Vercel token present:** the CLI needs it.
- **Each deploy installs its CLIs:** about 30 to 60 seconds more. Every project carries the two lockfiles, about
  450 KB.
- **A project that overrides `tool_versions` for vercel or firebase** has its deploy refused, with the reason, until
  `devos upgrade` brings matching lockfiles.
- **Untried on GitHub:** the tools step and the step-level token (at the first production deploy), and the
  supervisor's wake-up (at the next failed chained run). The fence's "For the owner, after the merge" says what to look
  for.

Commit message: E69: the deploy's CLIs from lockfiles, its secrets only where used; the cycle wakes the supervisor; the supervisor names the task and shows Claude's text inert (PR-95) — PASS a1
Next prompt: none. Every item the owner brought forward is done. F2, N2 steps 4–5, C3, the adopt warning and the
canary gaps G1–G4 stay deferred, as the auditor doc lists them.
