MERGE

VERDICT: PASS
Fetched: HEAD @ 0fa50ea (`E64 a1: builder`) + working tree clean · Commands run: D1–D6 and D8 on Linux, D7 through
`gh run view` · Refused calls: none

E64 attempt 1 copied the package of v1 (PR-92) byte for byte: 18 changed files and 2 new ones, plus the report.
- **The package:** it splits planning (`/devos intake`, method fixes) and revising into a read-only planner job and a
  trusted publish job, and makes `accept` run main's script over the branch as data.
- **On the unit:** `/devos revise` on a unit's acceptance PR revises the unit's last task there, and `/devos accept`
  records on the unit.
- **Who wrote it:** the reviewer, rehearsed on a copy of `main` and on this branch. Three independent reviews found 26
  defects, all fixed before v1.

Deep review (risk 3): every row was rerun here, and the copied files equal the package (D3), so every changed line is
the reviewed line. The builder changed nothing under `dev/fences/` or `dev/LEDGER.md` (`git diff 5d2127d 0fa50ea` on
them is empty).

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` on Linux:
- `# tests 629`, `# pass 629`, `# fail 0`;
- the 16 tests of `intake-two-jobs.test.mjs`, the 13 of `units.test.mjs` and the 21 of `two-jobs.test.mjs` are all
  `ok`;
- `git status --porcelain test/fixtures` printed nothing.
The builder's Windows run: tests 629, pass 597, skipped 32 (E67's 30, and U6 and U9), fail 0, as v1 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (355 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `20 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (362 files scanned)`
- `guard:manual PASS (134 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.0`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `gh run view 42658961772` → `headSha 0fa50ea…`, `attempt 1`, `conclusion success`; jobs `checks`
success, `test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists only:
- the 20 paths of S1;
- `dev/reports/E64.md`;
- the 21 files of `dev/fences/E64/` (the 20 and `before.json`);
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E64.md` and this review.

Scope: in fence. The report's deviations are the owner's shell only: PowerShell, so the fetch ran through `cmd /c` and
the globs were expanded by hand; and actionlint as the Windows binary of 1.7.7, checksum matching the release.

Method (payload changes only):
- **The precedent:** PR-92 follows PR-91, and the live maximum is PR-92.
- **The manual:** `AUTOMATION.md` names `intake-request.mjs`, the jobs `intake-ack`, `intake-refuse`, `intake`,
  `intake-publish`, `revise-prep`, `revise` and `revise-publish`, `publish-verify.mjs plan`, and the `REVISE aN`
  marker. `guard:manual` passes with 134 names.
- **Non-waivable rules, none weakened:**
  - Human gates are kept: every plan, revision and acceptance PR waits for your merge, and nothing in
    `devos-intake.yml` merges or dispatches `devos-deploy`.
  - Role surfaces: a plan only within `surfaces.intake.allow`, a revision only its fence, both checked by main's code
    before any push.
  - A red check still overrides a PASS.
  - No secret goes in a file: the planners hold only Claude's keys and a read-only token, and every comment of the
    publish jobs is scrubbed.
  - The runner owns git: all git in the publish jobs is `publish-verify.mjs`'s or hardened.

Owner attention:
- **Your merge confirms the changed unit revision:** `/devos revise` on an acceptance PR rebuilds the unit's last task
  with your change, not new tasks inside the unit. Adding rows breaks `guard:phases`. New scope stays a change request.
- **Planning now needs Claude Code as the reviewer** (D11 extended). A project on another reviewer tool gets a one-line
  message with the command to switch.
- **The revise planner left the cycle's concurrency group.** A cycle run that moves the branch meanwhile makes publish
  reject the fence, and the PR says so.
- **Limitations 1–8 of the fence.** The two to weigh:
  - While the fence is being planned, the acceptance PR still shows its old success, and with no branch protection you
    could merge mid-revision.
  - The planner could hide its own key in a plan document, the same limitation as E63.
- **None of E63, E67 or E64 has run on GitHub yet.** The optional L1 (T93) on devos-pilot would show a GitHub-only
  failure before Medix does.

Commit message: E64: planning, revising and accepting in two halves (PR-92) — /devos intake, method fixes and /devos revise run the planner (Claude Code, its keys only) in a read-only job that hands a git bundle to a trusted job running only main's code (publish-verify.mjs plan: the intake surface, rows only added and no number twice, a revision only its fence) before any push, PR or devos/verdict; only an issue the owners, members or collaborators opened is planned, from the issue as it stood at the event (audit M1); /devos accept runs main's accept.mjs over the branch as data; on a unit, /devos revise rebuilds its last task (REVISE aN, reviewed deep, the acceptance PR renewed) and /devos accept records on the unit — PASS a1
Next prompt: none written. E65's row says "fence after E64": its package is built and rehearsed against `main` after
this merge, on your word, as E64's was.
