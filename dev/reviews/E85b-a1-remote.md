MERGE

VERDICT: PASS
Fetched: HEAD @ 1f8b07e (`E85b a1: builder`) + working tree clean · Commands run: D1 (the full suite with no git
identity, here, on Linux), D2–D6 and D10 on Linux, D7 through `gh run view`, the release check, and the scope and
reviewer-path diffs · Refused calls: none

Attempt 1 is fence v1's 19 exact files, copied byte for byte, and the builder's report. It is version 1.13.17, a method
change with precedent PR-102, and a deep review (risk 3). What it fixes is what E85's D8 found (`dev/reviews/E85-d8.md`):
- the review job's hand-over now takes the review file and fences up to 1 MiB, counted in bytes, and lists them;
- `verify` records `head_tree`, the review job hands over the tree it reviewed, and publish compares trees, never two
  commits that each job writes with its own time;
- the reviewer has 120 minutes and the job 135, with a line every 5 minutes;
- `.gitleaks.toml` allows the review job's key names.

The reviewer wrote these files. So the review of record is four things: the byte compare (D3), every Done-when row
that runs here, the engine's CI, and a second reading of each changed line under `payload/` and of `.gitleaks.toml`. The
builder changed nothing under `dev/fences/`, `dev/LEDGER.md`, `dev/reviews/`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 3df19ed 1f8b07e` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite with no git identity** (`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, Node 22.23.5,
  Linux): `# tests 709`, `# pass 709`, `# fail 0`, `# skipped 0`, exit 0. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run** (Node 24.21.0): tests 709, pass 660, fail 0, skipped 49, as the fence says.
Ledger: D2 — PASS — `manifest up to date (363 files)`; `node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `19 files, 0 differ`.
Ledger: D4 — PASS — the staged guards: `guard:secrets PASS (370 files scanned)`, `guard:manual PASS (138 names
checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`,
`guard:media N/A (no devos/answers.json)`, `exit 0`.
Ledger: D5 — PASS — `devos 1.13.17`.
Ledger: D6 — PASS — actionlint 1.7.7 (`-color -shellcheck= -pyflakes=`) on the thirteen payload workflows and
`engine-ci.yml` exited 0 and printed nothing, here and on the builder's Windows.
Ledger: D7 — PASS — `engine-ci` run 45780986751 on `1f8b07e`, attempt 1: `checks` success, `test (ubuntu-latest)`
success.
Ledger: D8 — NOT YET — the owner's live run after the 1.13.17 release: learn-coptic upgraded, then T01, attempt 1,
review only. The reviewer reads it with `gh` against the fence's points.
Ledger: D9 — PASS — `git diff --name-only main...HEAD` lists:
- the 19 paths of S1;
- `dev/reports/E85b.md`;
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E85b.md`, the 20 files of `dev/fences/E85b/` (19 and
  `before.json`), `dev/reviews/E85-d8.md` and this review.
Nothing else. The builder's commit holds exactly 20 paths: the 19 of S1 and the report.
Ledger: D10 — PASS — two runs:
- **Here,** `gitleaks git --redact --no-banner .` (8.24.3; `11 commits scanned`, this shallow clone's, among them
  E85's squash `5b2ba9f`, where the 4 findings were) → `no leaks found`.
- **On the builder's Windows,** gitleaks 8.30.1 over 303 commits → `no leaks found`. On main, the release found 4.

Scope: in fence. The release check prints only `CHANGELOG.md: the 1.13.17 heading has no date; set it when you tag`.

Method (payload changes only):
- **Human gates, role surfaces, a red check over PASS, the runner owns git:** untouched. The reviewer's written surface
  is still `take-review`; the review job holds no write token.
- **Secrets never in files:** the hand-over now carries the review file and fences, and they are scrubbed with all
  eight keys before upload as before (S6d runs that script on real files).
- **Precedent:** PR-102, the next id after PR-101. It amends PR-101, and the live maximum line says PR-102.
- **Manual (`guard:manual`, 138 names):** no new name. §2 and the `devos-review.yml` row say "the reviewed tree".

Owner attention:
- **D8 is still to come, and it costs a full review.** On learn-coptic, after the upgrade, the review-only run reviews
  T01 a1 again: about 75 minutes and a million input tokens on `grok-4.7-xhigh`. The last review found two problems
  with T01's own fence: lint fails on five existing `react-hooks/set-state-in-effect` errors, and there is no `guards`
  script. So expect a FAIL with a reissued T01 fence. This time both cross to publish, and the cycle goes on to
  attempt 2.
- **Enable the supervisor again only after the upgrade.** On 1.13.16 every review stops at publish.

Commit message: E85b: the review reaches publish, publish checks the reviewed tree (1.13.17) - PASS a1
Next prompt: none yet. E86's fence comes on `task/E86` from main once 1.13.17 is released and E85b's D8 has passed.
