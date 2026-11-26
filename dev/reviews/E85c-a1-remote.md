MERGE

VERDICT: PASS
Fetched: HEAD @ 786cf84 (`E85c a1: builder`) + working tree clean · Commands run: D1 (the full suite with no git
identity, here, on Linux), D2–D6 and D10 on Linux, D7 through `gh run view`, the release check, and the scope and
reviewer-path diffs · Refused calls: none

Attempt 1 is fence v1's 18 exact files, copied byte for byte, and the builder's report. It is version 1.13.18, a method
change with precedent PR-103, and a deep review (risk 3). What it fixes is what E85b's D8 found
(`dev/reviews/E85b-d8.md`):
- the review job sets `DEVOS_BUILDER_MODEL` from the developer's variable, and passes the attempt's model as
  `DEVOS_BUILT_MODEL`, for the prompt alone;
- `plan-agent.sh` writes the prompt with its answer section to `.devos/<stage>-answer-prompt.md`, never over the
  prompt, so Cursor, Codex and Gemini reviews and plans get their whole prompt;
- the progress line ends with its sleep.

The reviewer wrote these files. So the review of record is four things: the byte compare (D3), every Done-when row
that runs here, the engine's CI, and a second reading of each changed line under `payload/`. The builder changed
nothing under `dev/fences/`, `dev/LEDGER.md`, `dev/reviews/`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 3355e1c 786cf84` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite with no git identity** (`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, Node 22.23.5,
  Linux): `# tests 710`, `# pass 710`, `# fail 0`, `# skipped 0`, exit 0. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run:** tests 710, pass 660, fail 0, skipped 50, as the fence says.
Ledger: D2 — PASS — `manifest up to date (363 files)`; `node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `18 files, 0 differ`.
Ledger: D4 — PASS — the staged guards: `guard:secrets PASS (370 files scanned)`, `guard:manual PASS (138 names
checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`,
`guard:media N/A (no devos/answers.json)`, `exit 0`.
Ledger: D5 — PASS — `devos 1.13.18`.
Ledger: D6 — PASS — actionlint 1.7.7 (`-color -shellcheck= -pyflakes=`) on the thirteen payload workflows and
`engine-ci.yml` exited 0 and printed nothing, here and on the builder's Windows.
Ledger: D7 — PASS — `engine-ci` run 45793140037 on `786cf84`, attempt 1: `checks` success, `test (ubuntu-latest)`
success.
Ledger: D8 — NOT YET — the owner's live run after the 1.13.18 release: learn-coptic upgraded, then T01, attempt 1,
review only. The reviewer reads it with `gh` against the fence's points.
Ledger: D9 — PASS — `git diff --name-only main...HEAD` lists:
- the 18 paths of S1;
- `dev/reports/E85c.md`;
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E85c.md`, the 19 files of `dev/fences/E85c/` (18 and
  `before.json`), `dev/reviews/E85b-d8.md` and this review.
Nothing else. The builder's commit holds exactly 19 paths: the 18 of S1 and the report.
Ledger: D10 — PASS — two runs:
- **Here,** `gitleaks git --redact --no-banner .` → `14 commits scanned`, `no leaks found`.
- **On the builder's Windows,** 307 commits → `no leaks found`.

Scope: in fence. The release check prints only `CHANGELOG.md: the 1.13.18 heading has no date; set it when you tag`.

Method (payload changes only):
- **Human gates, role surfaces, a red check over PASS, the runner owns git:** untouched.
- **The model reaches a prompt only through verify's trusted ids (N6):** kept. `DEVOS_BUILT_MODEL` is verify's
  `builder_model` (`hardening.test.mjs` (g)), and `DEVOS_BUILDER_MODEL` is `vars`, as in every other job.
- **Secrets never in files:** untouched. The answer prompt is a copy of the prompt plus the schema, and no key is in
  either.
- **Precedent:** PR-103, the next id after PR-102. It amends PR-101 and PR-102, and the live maximum line says
  PR-103.
- **Manual (`guard:manual`, 138 names):** no new name. The `plan-agent.sh` row names
  `.devos/<stage>-answer-prompt.md` and `DEVOS_BUILT_MODEL`.

Owner attention:
- **D8 is the first review in which the reviewer gets its instructions.** On 1.13.18, learn-coptic's T01 a1 review-only
  run gives Cursor the whole reviewer prompt: steps, fence rules and verdict format. It should be shorter and
  better aimed than E85's 74-minute run, but on `grok-4.7-xhigh` it is still a deep review. Expect the FAIL the last
  review found (T01's own fence: five existing `react-hooks` lint errors and no `guards` script), now with the
  verdict and the reissued fence reaching publish.
- **Run that cycle yourself.** The supervisor has escalated this key and will not re-run it.

Commit message: E85c: a review runs with its whole prompt and the developer's configuration (1.13.18) - PASS a1
Next prompt: none yet. E86's fence comes on `task/E86` from main once 1.13.18 is released and E85c's D8 has passed.
