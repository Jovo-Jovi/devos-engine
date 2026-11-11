MERGE

VERDICT: PASS
Fetched: HEAD @ d1080a0 (`E74: the bypass secret advised only where it is sent (PR-98), and Claude Fable 5.2
(1.13.7)`) + working tree clean · Commands run: D2–D6 and D8 on Linux; D1 as the ten changed test files here and the
full suite in `engine-ci`; D7 through `gh run view` · Refused calls: none

E74 attempt 1 copied the v1 package byte for byte: 20 changed files, none new, plus the report. It is version 1.13.7,
with precedent **PR-98**:
- **The bypass secret.** The setup item `vercel-bypass` applies only when `deploy.bypass` is true (condition
  `bypass:true`, in `setup-check.mjs` and `lib/setup.mjs`). With bypass false, the Tower's setting, the check no longer
  advises the secret.
- **Claude Fable 5.2.** `claude-fable-5-2` is first in the Claude lists that Claude Code and Cursor offer. No default
  changes.

The reviewer wrote the package and rehearsed it on a copy of `main` @ 341982c with one full suite run. The remote check
is the review of record.

Review depth (risk 2). The copied files equal the package (D3), so every changed line is the line reviewed for the
package. I read again every changed line under `payload/` and in `lib/`:
- **The condition.** `bypass:true` holds only for `deploy.bypass === true`: a string `"true"` does not
  (`setup.test.mjs` (x)). The secret is sent under exactly that setting:
  - the deploy's smoke test deletes it unless `cfg.deploy.bypass === true`;
  - the doctor's preview check says "No bypass secret is added" when it is false.
- **What the item blocks.** The item is `recommended` and blocks nothing, so no deploy or cycle changes. It never was
  one of the keys `devos init` asks for (`neededKeys` takes only items that block the cycle or the deploy).
- **The model list.** It only adds an id: `claude-fable-5-2`, the Claude API's id for Claude Fable 5.2 (released
  2026-11-09, Anthropic's model page). A Cursor account still shows the names Cursor's own list gives.
- **Method rules.** No human gate, role surface, red-check rule, secret handling or git ownership changes. PR-98 is the
  next id after PR-97, and the live maximum says PR-98. `AUTOMATION.md` §8 names the condition, and `guard:manual`
  still checks 135.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 04f4969 d1080a0` on them).

Ledger: D1 — PASS — two runs:
- **Full suite on Linux:** `engine-ci` run 43057842584, job `test (ubuntu-latest)`, gave `# tests 669`,
  `# pass 669`, `# fail 0`. That run included `ok 262 - hardening.test.mjs (o) …` and
  `ok 499 - setup.test.mjs (x) …`.
- **Here, the ten changed test files:** `# tests 122`, `# pass 122`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.

The builder's Windows run gave tests 669, pass 628, skipped 41, fail 0, as v1 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `20 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.7`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 43057842584 on d1080a0 (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 44 paths before this review, and only these:
- the 20 paths of S1;
- `dev/reports/E74.md`;
- the 21 files of `dev/fences/E74/` (the 20 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E74.md`.

This review adds itself.

Scope: in fence. The report's only deviation is the owner's shell, as before: actionlint was not on PATH, so the
Windows binary of 1.7.7 ran through Git bash.

Method (payload changes only):
- **Rules checked:** human gates, role surfaces, red check overrides PASS, secrets never in files, runner owns git.
  None is weakened.
- **Precedent:** PR-98 (amends PR-40 and PR-97), and the live maximum PR-98.
- **Manual sections:** `AUTOMATION.md` §8.

Owner attention:
- **Release 1.13.7**, then upgrade the Tower: its setup check stops advising the bypass secret.
- **Fable 5.2 for a role:** `devos models set reviewer claude-fable-5-2`, or the page's Models panel.
- **Next: E75** (`devos models check` and the model list refresh) is built on top of this release. Its fence comes once
  1.13.7 is on `main`.

Commit message: E74: the bypass secret advised only where it is sent (PR-98), and Claude Fable 5.2 (1.13.7) — PASS a1
Next prompt: none yet (E75's fence follows the 1.13.7 release, on `task/E75`)
