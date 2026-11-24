FIX: in test/adopt.test.mjs, test (w)'s `run` helper gives git the file's IDENTITY (one line, as dev/fences/E82.md v2 and its package hold); attempt 2 copies that file and nothing else changes.

VERDICT: FAIL
Fetched: HEAD @ 79f74e3 (`E82: adopt from GitHub's main as it is now - attempt 1`) + working tree clean · Commands
run: D1 (the full suite, here), D2–D6 and D8 on Linux, D7 through `gh run view` and the job's log · Refused calls: none

Attempt 1 copied the 16 package files and wrote the report; nothing else. The change is version 1.13.14:
- the survey fetches GitHub's `main` first and stops on a checkout behind it or apart from it;
- before the push, GitHub's new commits since the brief merge into `devos/adopt` after a yes, when git can do it
  cleanly, and the checks run again;
- `--publish` takes such a branch.

Every line and every local check holds. **One test fails on GitHub's runner, and only there.**

Review depth (risk 2). D3 proves the copy: every file the builder's commit changed equals `dev/fences/E82/files/`, and
each equals the rehearsed tree. I read every changed line again (`git diff 8e1e13f 79f74e3`). The builder changed
nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`.

Ledger: D1 — PASS — `# tests 696`, `# pass 696`, `# fail 0` here; the builder's Windows run: 696, pass 654, skipped 42.
Afterwards `git status --porcelain test/fixtures` printed nothing.
Ledger: D2 — PASS — `manifest up to date (360 files)`; `0 0`.
Ledger: D3 — PASS — `16 files, 0 differ`.
Ledger: D4 — PASS — not rerun: no payload file changed, and the builder's run and the rehearsal printed the fence's
lines exactly.
Ledger: D5 — PASS — `devos 1.13.14`.
Ledger: D6 — PASS — the builder's run with the checked 1.7.7 binary; `engine-ci`'s `checks` (actionlint) passed too.
Ledger: D7 — **FAIL** — `engine-ci` run 45508216985 on 79f74e3 (push, attempt 1): `checks` success,
`test (ubuntu-latest)` failure:
- `not ok 72 - adopt.test.mjs (w) E82: the survey fetches GitHub's main first; …`, at `test/adopt.test.mjs:812`;
- `128 !== 0`: `git commit -q --allow-empty -m "Ship pronunciation"` exited 128;
- `# tests 696`, `# pass 695`, `# fail 1`.

The cause is the test's own `run` helper: it gives git no identity, and GitHub's runner has no git user. The file's
`git` helper passes `IDENTITY` for exactly this. Here, with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, the
test fails the same way (`actual: 128`). With `IDENTITY` in `run` it passes, and `adopt`, `adopt-install` and
`adopt-handover` pass too (59 tests). The suite with no identity passes as well, as v2 records.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 36 paths before this review: the 16 of S1,
`dev/reports/E82.md`, the 17 files of `dev/fences/E82/` (the 16 and `before.json`), `dev/LEDGER.md` and
`dev/fences/E82.md`. Nothing else.

Scope: in fence (`16 modified, 0 new, 0 other`). D6 ran as the fence allows.

Method (payload changes only): none. No file under `payload/files/` changed; `payload/manifest.json` changes only
`engine_version`.

Owner attention:
- **The defect was the fence's own**, in the reviewer's test, not the builder's work. The engine change is unaffected.
- Attempt 2 copies one file. On Windows its D1 counts are unchanged (696, pass 654, skipped 42).

Next prompt: dev/fences/E82.md (fence v2, Attempt 2 focus)
