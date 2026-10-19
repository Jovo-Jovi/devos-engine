VERDICT: PASS — MERGE
Fetched: task/E13 @ 23b9530 (clean tree), main @ 03f28e2 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `node --check test/engine-ci.test.mjs`, `git diff --name-only main...HEAD`, `git diff main...HEAD -- README.md`, actionlint 1.7.7 (`-shellcheck= -pyflakes=`) on the branch and on `devos-cycle.yml` from `e184d2e`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `gh run view 39264681347`, the job logs of both attempts · Refused calls: none

Review of record for E13 attempt 1 (risk 2). The local review was skipped (Claude session limit), so this remote check is the only review. The change adds the engine's own CI, `.github/workflows/engine-ci.yml` at the root (not in `payload/`, not in the manifest). It runs `node --test` on Ubuntu and Windows, the manifest check, the specifics check (which now fails unless the output is `0 0`), and checksum-verified actionlint 1.7.7 over the ten payload workflows and itself. It also adds a text-only shape test and the two README sentences. I read every line of the workflow, the test and the README diff.

Ledger: D1 — PASS — `node --test` → `# pass 35` / `# fail 0`; the output names `ok 15 - engine-ci.test.mjs workflow shape`
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (110 files)`
Ledger: D3 — PASS — `node tools/find-specifics.mjs --check` → `0 0`
Ledger: D4 — PASS — `node --check test/engine-ci.test.mjs` exit 0
Ledger: D5 — PASS — `git diff --name-only main...HEAD` → `.github/workflows/engine-ci.yml`, `README.md`, `dev/reports/E13.md`, `test/engine-ci.test.mjs`
Ledger: D6 — PASS — the README diff is step 4's sentence ("The push starts the `engine-ci` workflow; when it is green, …") and step 5's added sentence ("A red `engine-ci` run is a FIX by itself."), nothing else
Ledger: D7 — PASS — run `39264681347` on head `23b9530`, attempt 2: `test (ubuntu-latest)` success, `test (windows-latest)` success, `checks` success. The Windows log has `# run("sample", []) exited 0; stdout contained quoted-ok` and `# pass 35` / `# fail 0`, which also closes E12 D8's Windows half on CI. actionlint here: the branch exits 0; `devos-cycle.yml` from `e184d2e` exits 1 (`could not parse as YAML` at line 238).

Attempt 1 of the run: `test (ubuntu-latest)` failed `not ok 32 - role-env.test.mjs swaps a role kit and restores the original bytes` with `ENOTEMPTY: directory not empty, rmdir '/tmp/devos-role-…/.git'` at the test's `finally` cleanup (`role-env.test.mjs:62`, `rmSync`). The assertions had passed: it was the temp folder's deletion that failed. The cause is E12's test, not E13. The runner has `git version 2.55.0`; since Git 2.47, `git commit` starts auto-maintenance **detached**, so a background git can still be writing into the temp `.git` while `rmSync` walks it. My machine has 2.43 and never flakes. Two related points in the same test:
- `assert.equal(git(["commit", …]).status, 0, git(["commit", …]).stderr)` runs `git commit` a second time just to build the message (arguments are evaluated eagerly), which starts a second background job.
- E13's fence forbade changing tests, so the builder was right to leave it.

Scope: in the fence. No payload, tool, `lib/` or `bin/` change; the manifest is unchanged; no secret, write permission, `workflow_dispatch` or third-party action beyond `actions/checkout@v6` and `actions/setup-node@v4`; the download is pinned and checksum-verified.
Method (payload changes only): none — the CI is engine-only. `dev/RELEASE.md` does not yet list `.github/` (owner, by E10).
Owner attention:
- (1) The flaky role-env cleanup makes "a red run is a FIX" noisy on Ubuntu until it is fixed. Until then, an Ubuntu failure whose only `not ok` is the `ENOTEMPTY` cleanup gets one rerun, not a FIX. The fix is S0 of the E05 fence:
  - the temp repo sets `maintenance.auto false` and `gc.auto 0`;
  - `rmSync` uses `maxRetries`;
  - the duplicate commit is removed.
- (2) E13 is merged without a local review, like E12.

Commit message: E13: Engine CI: tests on Linux and Windows, workflow lint, payload checks on every push — PASS a1
Next prompt: dev/fences/E05.md (written on this branch)
