MERGE

VERDICT: PASS
Fetched: `task/E10c` @ aa7fb3c (no uncommitted changes; `main` @ 9790535, D-E11 confirmed, merged in at ba19502) · Commands run: scope listing (`git diff --name-only main...HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), D5 (`node tools/release-check.mjs`), engine-ci run 40341486171 and its jobs, the builder commit and its report, D-E11 on `main`, and the release check on a copy of the tree with the changelog dated · Refused calls: none

E10c makes the engine releasable in place (D-E10):
- **`tools/release-check.mjs`** (new, not shipped): the owner runs it before every tag. It checks that the versions agree, the changelog heading is dated, the licence and its notice, `SECURITY.md`, the README's install text, that D-E11 is confirmed, and that no secret pattern appears in a shipped file. It runs no git and no network, and it prints a finding's file, line and kind, never its value.
- **`SECURITY.md`** (new, shipped): report through GitHub's private vulnerability reporting, never in a public issue. It names the scope, and for data held by the Control Tower it points to the contract's "Your rights". It adds no new address.
- **`README.md`:** the install step no longer says the repository is private, and a "Security" section points to `SECURITY.md`.
- **`package.json`:** `files` gains `SECURITY.md`.
- **`dev/RELEASE.md`:** rewritten for release in place: what ships, and the six owner steps of each release.
- **`test/release-check.test.mjs`** (a)–(d), on synthetic trees.

This is a deep review: risk 3, and the last task before the repository goes public. The 6 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence, and I re-read `tools/release-check.mjs`, `SECURITY.md`, `dev/RELEASE.md` and the README and `package.json` diffs on the branch. The builder's commit adds only those 6 paths and its report, which I read. Nothing in `bin/`, `lib/` or `payload/` changed.

The owner's commit 9790535 on `main` replaces "provisionally, until the owner confirms the legal identity" with "the legal identity the owner confirmed on 2026-10-26". The rest of D-E11 is unchanged. That is what P1 waited for.
Ledger: D1 — PASS — my run on Linux: `tests 332`, `pass 332`, `fail 0`, `skipped 0`. `release-check.test.mjs` (a)–(d) are `ok 201`–`ok 204`. The builder's report on Windows: `tests 332`, `pass 321`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `6 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.0.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (113 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — `node tools/release-check.mjs` exits 1 and prints exactly `release check: 1 problem` and `- CHANGELOG.md: the 1.0.0 heading has no date; set it when you tag`. On a `git archive` copy of this tree with the heading set to `## 1.0.0 — 2026-10-27`, it prints `release check: ok (355 files scanned)` and exits 0. So the date is the only thing that stands between this tree and step 2 of `dev/RELEASE.md`.
Ledger: D6 — PASS — engine-ci run 40341486171 on aa7fb3c, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D7 — PASS — `git diff --name-only main...HEAD` lists:
- the 6 copied paths;
- `dev/reports/E10c.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E10c.md`, `dev/fences/E10c/before.json` and the 6 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No dependency added. `bin/`, `lib/`, `payload/`, the contract, `CHANGELOG.md`, `LICENSE` and the version are unchanged. No tag, release or visibility change was made.
Method (payload changes only): N/A — no payload file changed. The manifest still lists 310 files.
Owner attention:
1. **Going public is permanent for the history.** Everyone can then read `dev/`, including the Tower and pilot configuration copies in `dev/sources/` (accepted in D-E10), and the privacy contact address. Step 3 of `dev/RELEASE.md` repeats the gitleaks scan of the whole history before you change the visibility.
2. **The texts state where the records are, but no legal basis for the transfer** (counsel has not confirmed one, D-E11). Nothing claims legal compliance.
3. **The Windows run (step 4)** is engine-ci's manual run on `main`, after the `Release v1.0.0` commit.

Commit message: E10c: the public release in place — a release check, SECURITY.md, the release procedure; engine 1.0.0 — PASS a1
Next prompt: none — the release steps are yours (`dev/RELEASE.md`). E23b4's fence comes after the release, as its ledger row says.
