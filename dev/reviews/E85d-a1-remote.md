VERDICT: PASS — MERGE (into `next`, D-E19)
Fetched: `task/E85d` @ f4b51ee (`E85d a1: builder`, on the reviewer's 2b30317, from `next` @ fcdac91) + a clean
working tree · Commands run: D9 `git diff --name-only next...HEAD`, the builder commit's paths, D3, D2, D5 (version
and release check), D6 (actionlint 1.7.7), D4 (the staged guards), D10 (gitleaks), D1 (the full suite alone, no git
identity, Linux), D7 (`gh api` on the commit's runs and jobs) · Refused calls: none

E85d makes release candidates possible for test projects:
- `devos upgrade --pre` takes one, and a plain upgrade and the project page refuse one;
- one version order (`lib/version.mjs`) for the command, the page and the release check;
- `next` gets `engine-ci` runs, and D-E19 records the owner's release policy;
- version 1.14.0-rc.1, and the tests read the version from `package.json`.

The reviewer wrote the package and rehearsed it, so this check is of the builder's copy and the tree it gives:
- D3 proves all 26 files byte for byte;
- the builder's commit touches only those 26 paths and its report;
- every row that runs without the owner's machine was run again on a clean clone.

Deep review (risk 3): the rehearsal read every changed line under `bin/`, `lib/` and `tools/`, and the page was
opened in Chrome. No file under `payload/files/` changes.

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` (alone, `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`):
`# tests 718`, `# pass 718`, `# fail 0`; `git status --porcelain test/fixtures` empty. The builder's Windows run:
tests 718, pass 668, skipped 50 (report).
Ledger: D2 — PASS — `manifest up to date (363 files)`; `0 0`.
Ledger: D3 — PASS — `26 files, 0 differ`.
Ledger: D4 — PASS — the six lines exactly: secrets 370, manual 138, config current, skills 29 / 20 vendored, media
N/A, `exit 0`.
Ledger: D5 — PASS — `devos 1.14.0-rc.1`; the release check exits 1 with `release check: 1 problem` and
`- CHANGELOG.md: the 1.14.0-rc.1 heading has no date; set it when you tag`.
Ledger: D6 — PASS — actionlint 1.7.7 over the payload's 13 workflows and `engine-ci.yml` exits 0. The builder used the
Windows binary already in `%TEMP%` (report, *Deviations*), and that is the same version.
Ledger: D7 — PASS — engine-ci run 45821965082 on f4b51ee, attempt 1: `checks` success, `test (ubuntu-latest)`
success.
Ledger: D8 — DEFERRED to E91 — the owner's decision (2026-11-26, 14:44): no live check until every task is done; E91
runs them all, by him.
- Not a defect.
- The logic D8 would show is covered by:
  - `upgrade.test.mjs` (E85d) ×3: a candidate only with `--pre`; a project on a candidate takes the release, never an
    older engine; the usage;
  - `hub-actions.test.mjs` (a), (b) and (e);
  - `versions.test.mjs`;
  - the page in Chrome in the rehearsal.
- What only a live run shows is GitHub's side: the prerelease, `releases/latest`, and a real upgrade pull request.
  The E91 row now lists it.
Ledger: D9 — PASS — `git diff --name-only next...HEAD` lists the 26 paths of S1, `dev/reports/E85d.md`, and the
reviewer's `dev/LEDGER.md`, `dev/fences/E85d.md`, `dev/fences/E85d/**` and `dev/reviews/E85c-d8.md`; this file is
added now. Nothing else.
Ledger: D10 — PASS — gitleaks over the branch's history: `no leaks found` (the builder's 8.30.1 over 311 commits: the
same).
Scope: in fence. The builder's commit f4b51ee changes the 26 package paths and `dev/reports/E85d.md` only. Nothing in
`dev/fences/E85d/` was edited.
Method (payload changes only): none. The manifest changes only `engine_version`; no precedent is needed (the live
maximum stays PR-103).
Owner attention:
- **Merge into `next`, not `main`.** `CLAUDE.md` says the change under review is `main...HEAD` and the merge squashes
  into `main`. D-E19, which this branch adds to `dev/DECISIONS.md`, says to read `next` for `main` until 1.14.0.
  `dev/DECISIONS.md` is first in `CLAUDE.md`'s order of authority, so this review used `next...HEAD`.
- **D-E19's text is older than your decision of 14:44.** It still says each task's D8 runs on a published candidate,
  and `dev/RELEASE.md` says each package sets the next one. Your decision supersedes that: no live check per task, and
  no candidate published before E91.
  - E85e's package amends D-E19, `dev/RELEASE.md` and `dev/MAINTAINERS.md` (ledger row E85e).
  - Until then, nothing needs publishing, and `next` stays `1.14.0-rc.1`.
- **What deferring the live checks costs.** E85's and E85b's D8s found five defects that every test had missed, and
  E85c fixed them. With no live run per task, such defects wait for E91, and several may show up together there.
  - The mitigation is in every package from E85e on: a behaviour test runs each changed workflow step's own `run:`
    script, as `review-job.test.mjs` (g) does. A test that only matches a workflow's text is not enough.
Commit message: E85d: release candidates for test projects (1.14.0-rc.1) - PASS a1
Next prompt: none yet. E85e's design fence (v1) is written from `next` after this merge, for the owner's approval
first: it changes the cycle's workflows (a method change).
