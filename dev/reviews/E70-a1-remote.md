MERGE

VERDICT: PASS
Fetched: HEAD @ b9d2b0d (`E70: the deploy's settings check holds the Vercel credentials again (PR-96, 1.13.3)`) +
working tree clean · Commands run: D2–D6 and D8 on Linux; D1 as the seven changed test files here and the full suite in
`engine-ci`; D7 through `gh api` · Refused calls: none

E70 attempt 1 copied the package of v1 byte for byte: 14 changed files, none new, plus the report.
- **The package (PR-96, version 1.13.3):** "Settings the deploy needs (PR-27)" in `devos-deploy.yml` gets
  `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` again, beside its presence flags, as `devos-setup`'s check
  has them. 1.13.2 (E69, PR-95) had moved them into the Deploy step only, so the settings check could not list the
  Vercel project's Production variables and reported every Vercel item missing. Every production deploy on Vercel
  stopped there; the Control Tower's first deploy after its adoption is where it showed.
- **Who wrote it:** the reviewer, rehearsed on a copy of `main` @ 4e6c582 with one full suite run (658 of 658) and a
  deep self-review. Tests (i) and (m) were also run against 1.13.2's workflow: both fail there, so they catch this.
  No separate review agent ran (the owner's token budget): this check is the deep review of record.

Review depth (risk 3: production credentials). The copied files equal the package (D3), so every changed line is the
line reviewed for the package. For this check I read again, in `git diff main...HEAD`:
- the settings step's new environment and its comment, and the job's comment;
- the PR-96 row and the manual's production paragraph;
- `hardening.test.mjs` (i) and (m).

What the token reaches now: one more step, which runs only `setup-check.mjs` and its two imports (`lib.mjs`,
`modules.mjs`), from `main` (the deploy runs on a push to `main` or a dispatch on it). The script sends the token only to
`api.vercel.com`, with `decrypt=false`, and prints names only. The step is skipped for a preview dispatch. The job's
level still holds no secret. The project's dependencies, the guards and the CLIs step still see no Vercel token. Until
1.13.1 every step of the job had it.

The builder changed nothing under `dev/fences/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 7a217aa b9d2b0d` on them).

Ledger: D1 — PASS — two runs:
- the full suite on Linux, `engine-ci` run 42826538835, job `test (ubuntu-latest)`: `# tests 658`, `# pass 658`,
  `# fail 0`, with `ok 256 - hardening.test.mjs (m) …`;
- here, the seven test files the package changes (hardening, version, install, remove, upgrade, adopt-files,
  adopt-install): `# tests 75`, `# pass 75`, `# fail 0`. Afterwards `git status --porcelain test/fixtures` printed
  nothing.

The builder's Windows run: tests 658, pass 619, skipped 39, fail 0, as v1 says ((m) skips on Windows with its reason).
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `14 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.3`.
Ledger: D6 — PASS — actionlint 1.7.7 (checksum checked) `-color -shellcheck= -pyflakes=` on both workflow folders →
`exit 0`.
Ledger: D7 — PASS — `engine-ci` run 42826538835 on b9d2b0d (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 33 paths, only:
- the 14 paths of S1;
- `dev/reports/E70.md`;
- the 15 files of `dev/fences/E70/` (the 14 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E70.md`.

This review adds itself.

Scope: in fence. The report's only deviation is the owner's shell: actionlint was not on PATH, so the Windows binary of
1.7.7 (zip SHA-256 checked against the release's checksums) ran through Git bash.

Method (payload changes only):
- **The precedent:** PR-96 follows PR-95, the live maximum, and amends it.
- **The manual:** `AUTOMATION.md`'s production paragraph says the Vercel token is in the settings check and the Deploy
  step. `guard:manual` passes with 135 names: no new script, guard, workflow, variable, label or command.
- **Non-waivable rules, none weakened:**
  - **Human gates are kept.** Production still moves only on your merge.
  - **Role surfaces are untouched.**
  - **A red check still overrides a PASS.**
  - **Secrets never go in files.** The step reads three secrets from the environment and prints names only.
  - **The runner owns git.** No git change.

Owner attention:
- **Release 1.13.3,** then upgrade the Control Tower to it (`devos upgrade`, and merge its pull request yourself, so
  your merge starts the deploy).
- **The Tower still needs one setting (SETUP):** `DEVOS_PRODUCTION_URL` in the Vercel project's Production
  environment, the same address as its `TOWER_URL`. Until then its deploy stops at the same step, for that one item.
- **mawsim:** upgrade it straight to 1.13.3, never 1.13.2.
- **Two findings for a later task (your call), from the fence's "For the owner":** the `production-url` item asks for a
  Vercel variable that nothing reads unless `deploy.probe` is `production`, and then the smoke test reads a GitHub
  variable instead; and adopting an older copy drops the copy's own setup items (the Tower's `tower-url`,
  `github-webhook`, `github-app-var` and `SUPABASE_SECRET_KEY` are no longer checked).
- **Vercel's own Git deploys:** if the Tower's Vercel project is now connected to the repository with `main` on, Vercel
  deploys production from every push, outside `devos-deploy`'s backup, migrations and your merge. The Tower has no
  `vercel.json` to turn it off; an Ignored Build Step for `main` does.

Commit message: E70: the deploy's settings check holds the Vercel credentials again (PR-96, 1.13.3) — PASS a1
Next prompt: none (E71, the guided adopt flow, waits for your approval of its scope)
