MERGE

VERDICT: PASS
Fetched: HEAD @ bbf96ef (`E73: the production address where it is read, an older copy's own settings kept (PR-97,
1.13.6)`) + working tree clean · Commands run: D2–D6 and D8 on Linux; D1 as the eleven changed test files here and
the full suite in `engine-ci`; D7 through `gh run view` · Refused calls: none

E73 attempt 1 copied the v1 package byte for byte: 21 changed files, none new, plus the report. It is version 1.13.6,
with precedent **PR-97**:
- **The production address.** `DEVOS_PRODUCTION_URL` is asked for as a GitHub repository variable, the one the deploy's
  smoke test reads, and only when `deploy.probe` is `production` with no `deploy.production_url_fallback`. Before, it
  was asked of every Vercel project as a Vercel variable that nothing read.
- **An older copy's own settings.** Its own setup items move to `docs/setup-items.json`, and the production address
  its deploy workflow smoke-tested becomes its `deploy` settings.

The reviewer wrote the package and rehearsed it on a copy of `main` @ 9d35750 with one full suite run. No separate
agent reviewed it, so this check is the deep review of record (risk 3: it changes what stops a production deploy).

Review depth (risk 3, deep). The copied files equal the package (D3), so every changed line is the line reviewed for
the package. I read again every changed line under `payload/` and in `lib/setup.mjs` and `lib/adopt.mjs`:
- **The setup check** (`scripts/devos/setup-check.mjs`):
  - **`probe:production`** reads `devos.config.json` through `config()`, already used there for the agents. It holds
    only for `deploy.probe` `production` with an empty fallback.
  - **The kind `address`** tests the variable against `^https:\/\/\S+$` and reports the constant
    `DEVOS_PRODUCTION_URL=https://…`. The value is never printed or written: `hardening.test.mjs` (n) checks stdout
    and `.devos/setup.md` for it.
  - **Both callers already pass the repository's variables** to the check (`VARS_JSON: ${{ toJSON(vars) }}`): the
    deploy's settings step (`devos-deploy.yml` line 118) and `devos-setup` (line 87). No workflow changed.
- **Nothing sets the address.** `devos init` and `devos adopt` set only items of kind `variable`
  (`lib/setup.mjs` line 633, `lib/adopt.mjs` line 2817: `if (item.kind !== "variable") continue;`), so neither
  writes a placeholder. `SETUP.md` prints a
  `gh variable set` block for kind `variable` only, which `setup.test.mjs` (w) pins.
- **The adoption** (`lib/adopt.mjs`):
  - **Reading:** the copy's `devos/setup.json`, `docs/setup-items.json` and old `devos-deploy.yml` are read as plain
    files of the checkout. A link stops the adoption (`plainFile`), and the workflow is read through `readSmall` (size
    limit, no binary).
  - **Validation:** a kept item has a checked id, kind and names (`[A-Z][A-Z0-9_]*`), and an entry that is not an
    item stops the adoption, named through `printable`. The smoke address must be an `https://` host
    (`[A-Za-z0-9-]` labels).
  - **Writing:** the only new write is `docs/setup-items.json` through `writePlain`, force-added with DEV_OS's files.
    No new git command.
  - **Untrusted text:** the pull request names ids through `named()`, which escapes backticks.
- **Method rules.** No human gate, role surface, red-check rule or git ownership changes. No secret enters a file: the
  moved items are names and steps the copy already committed. `AUTOMATION.md` names the variable (now in the variables
  table), the new kind and the condition, and `guard:manual` still checks 135. PR-97 is the next id after PR-96. The
  live maximum, which still said PR-92, now says PR-97.
- **Projects already on Vercel.** A project that probes its deployment (the default) is no longer asked. The Tower
  probes production with a fallback, so it is not asked either. A project that probes production with no fallback is
  now stopped before the deploy, where it used to fail at the smoke test.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 3652333 bbf96ef` on them).

Ledger: D1 — PASS — two runs:
- **Full suite on Linux:** `engine-ci` run 43027909321, job `test (ubuntu-latest)`, gave `# tests 667`,
  `# pass 667`, `# fail 0`. That run included `ok 261 - hardening.test.mjs (n) …`, `ok 497 - setup.test.mjs (w) …`,
  `ok 61 - adopt.test.mjs (t) …` and `ok 33 - adopt-install.test.mjs (af) …`.
- **Here, the eleven changed test files** (adopt-files, adopt-install, adopt, hardening, install, intake-two-jobs,
  remove, setup, upgrade, version): `# tests 129`, `# pass 129`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.

The builder's Windows run gave tests 667, pass 627, skipped 40, fail 0, as v1 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `21 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.6`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 43027909321 on bbf96ef (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 46 paths before this review, and only these:
- the 21 paths of S1;
- `dev/reports/E73.md`;
- the 22 files of `dev/fences/E73/` (the 21 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E73.md`.

This review adds itself.

Scope: in fence. The report's only deviation is the owner's shell, as in E70–E72. actionlint was not on PATH, so the
Windows binary of 1.7.7 (checksum checked) ran through Git bash.

Method (payload changes only):
- **Rules checked:** human gates, role surfaces, red check overrides PASS, secrets never in files, runner owns git.
  None is weakened.
- **Precedent:** PR-97 (amends PR-27 and PR-40), and the live maximum PR-97.
- **Manual sections:** `AUTOMATION.md` §8 (the Vercel list and the variables table) and §10 (a new setting, its
  kinds).

Owner attention:
- **Release 1.13.6.** Then upgrade the Control Tower (`devos upgrade`, and merge its pull request yourself). After
  that you may delete `DEVOS_PRODUCTION_URL` from the Tower's Vercel variables: nothing reads it there.
- **Another project that probes production with no fallback** will be asked for the GitHub variable before its next
  deploy. A project on the default probe is not affected.
- **The Tower's own settings** come next, outside the engine: its `docs/setup-items.json`.

Commit message: E73: the production address where it is read, an older copy's own settings kept (PR-97, 1.13.6) — PASS a1
Next prompt: none (the Tower's `docs/setup-items.json` is a change in the Tower, after this release)
