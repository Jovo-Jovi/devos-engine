MERGE

VERDICT: PASS
Fetched: `task/E32` @ 39a1cb1 (no uncommitted changes; `main` @ 1a476ec, E31's squash, whose tree equals `task/E31` @ 5556390) · Commands run: scope listing (`git diff --name-only main HEAD`, and `main...HEAD` after bringing `main` in), the builder commit against the fence (`git show --stat HEAD`, `git diff --stat d9984c4 HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4, the manifest's diff, actionlint 1.7.7 with engine-ci's options, engine-ci run 40675323098 and its jobs, the attempt-1 report · Refused calls: none

E32 answers the owner's report of 2026-10-28: during the 1.3.1 release, engine-ci on `main` showed a cancelled run, and its re-run failed.
- **The concurrency group.** On `main`, each commit and each event now has a run of its own, so the release's Run workflow no longer cancels the push's run. On a task branch, a newer push still cancels the older run.
- **Git's background maintenance.** `test/harness.mjs` and `test/setup.test.mjs` turn it off for every git a test starts, as five other test files already did. That was the `ENOTEMPTY` of `continue.test.mjs` (l).
- **`devos` keeps its last lines.** `bin/devos.mjs` exits only after stdout and stderr have flushed, with a 10-second backstop. Before, on a busy pipe, `process.exit()` dropped the queued output. In my load test on `main`, `setup.test.mjs` "rejects a project name whose key is invalid" failed 12 times in 60 runs. With the change it had no failure in 135 runs. The guided page reads `devos init` and `devos continue` through a pipe, so a developer could lose the line that explains a stop.
- **The rest.** Engine 1.3.2 with a "Fixes" entry, `dev/RELEASE.md` step 4, and `test/stability.test.mjs` (a)–(c).

This is a standard review: risk 2, and `bin/devos.mjs` is the one shipped change. I wrote the package and rehearsed it on a clean copy. The 12 copied paths are byte-identical to the package (D3). The builder's commit adds only its report and the rebuilt manifest. It leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 385`, `pass 385`, `fail 0`, `skipped 0`; `stability.test.mjs` (a)–(c) pass. The builder's report on Windows: `tests 385`, `pass 369`, `fail 0`, `skipped 16` (E28's skips). (b) passing there shows the flush exits on Windows pipes too.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `12 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.3.2`.
Ledger: D5 — PASS — engine-ci run 40675323098 on 39a1cb1, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`. My actionlint 1.7.7 run passes on every workflow too.
Ledger: D6 — PASS — `git diff --name-only main HEAD` lists 29 paths:
- the 12 copied paths;
- `payload/manifest.json` and `dev/reports/E32.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E32.md`, `dev/fences/E32/before.json` and the 12 package copies.

Nothing else. The manifest's diff changes `engine_version` (1.3.1 to 1.3.2) only.
- **Bringing `main` in.** I merged `main` into `task/E32` (5eeadad) with no change to the tree, so `main...HEAD` lists the same 29 paths. The ledger conflicted, as both sides add a row after E30; I resolved it to `main`'s rows plus E32's. Squash-merging `task/E32` into `main` is now clean.
- This review and the ledger tick are added after it.

Scope: in fence. No payload file other than the manifest's version, no other workflow, and no other exit in `lib/`. No dependency.
Method (payload changes only): N/A. No method file changed; the manifest carries only the engine version.
Owner attention:
1. **Release 1.3.2** with the six steps of `dev/RELEASE.md`. Date the `## 1.3.2` heading on the day of the tag. At step 4, the release commit should show two green engine-ci runs (the push's and the Run workflow's) and no cancelled one.
2. **Projects** get the `devos` fix with **Upgrade to 1.3.2 by pull request**. A developer who runs `devos` with `npx` gets it on the next run.

Commit message: E32: a release stays green — engine-ci's concurrency is per event and, on main, per commit; the tests run git without background maintenance; devos exits only after stdout and stderr have flushed; engine 1.3.2 — PASS a1
Next prompt: none. Releasing 1.3.2 is yours (`dev/RELEASE.md`). E23b4's fence is still on offer, as its ledger row says.
