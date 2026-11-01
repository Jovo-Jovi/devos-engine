MERGE

VERDICT: PASS
Fetched: `task/E36c` @ 75f8110 (no uncommitted changes; `main` @ 831d03b, unmoved since fence v2) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat 1c5d75f HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO` in a git repository), engine-ci run 41308774461 and its jobs, the attempt-1 report · Refused calls: none

E36c is D-E13's step 4c, and the last step of the adoption in the terminal.
- **Before anything is written,** `devos adopt` asks what `devos init` asks: the contract (`accept`), the optional Control Tower link and the cycle's agents. A declined contract writes and sends nothing.
- **After the commit,** a typed `yes` pushes `devos/adopt` and opens its pull request into `main`. `devos adopt --publish` does the same later. The description is the summary the owner chose on 2026-11-01 ("Summary only").
- **Then the repository is set up as `init` sets it:**
  - the keys, typed hidden and sent on stdin, or named to set later;
  - only the variables that are missing;
  - the labels;
  - GitHub Actions allowed to create and approve pull requests, with the default workflow permissions written back as they were.

**The review depth is deep (risk 3).** As with every Engine package, I wrote `dev/fences/E36c/files/` and reviewed it line by line before issue. Two independent security reads came first. Their findings, all closed in v1, are listed in the fence. v2 only rebased the package on E40's `main`. D3 proves the branch's 10 copies are byte-identical to that package. The builder's commit adds only those copies and its report.
Ledger: D1 — PASS — my run on Linux: `tests 422`, `pass 422`, `fail 0`, `skipped 0`; `adopt-install.test.mjs` (m)–(v) all `ok` (10 matched). The builder's report on Windows: `tests 422`, `pass 404`, `fail 0`, `skipped 18`. The skips are E28's 16, plus `time-limits.test.mjs` (d) and (f), each listed by name.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `10 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`. The guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (117 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 41308774461 on 75f8110, run attempt 1: `checks` (actionlint included) and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 24 paths, nothing else:
- the 10 copied paths and `dev/reports/E36c.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E36c.md`, `dev/fences/E36c/before.json` and the 10 package copies.

No `payload/` path appears (count 0). **The deep review confirms:**
- **Nothing remote happens before a typed yes.** Before `go.trim().toLowerCase() !== "yes"` (`lib/adopt.mjs` near line 1678), the only calls to GitHub are reads: the key and variable lists and `actions/permissions/workflow`. Lines typed earlier are dropped (`read.drain`).
- **A key's value reaches only `gh secret set`, and only on stdin** (`input: value`). It is never in an argument, a file or a log line.
- **The description holds only the summary.** It goes through `publicText`: no home path, no `@name`.
- **The workflow permissions are kept.** The `PUT` writes back `default_workflow_permissions` as read, with `can_approve_pull_request_reviews=true`. No call names the Wiki or Projects.
- **The branch is safe.** The push is `git push -u origin devos/adopt`, without force. A remote branch with other commits stops the push and is not overwritten. After the commit, every failure returns and keeps the branch; `drop` runs only before it.
- **`devos init`'s questions and setup are unchanged.** `askAgents`'s `blueprint` option defaults to init's behaviour, and the setup functions are only exported.

This review and the ledger tick are added after it.
Scope: in fence. No payload file, no `lib/install.mjs`, no guided page, no workflow and no version change. No dependency. No dispatch.
Method (payload changes only): N/A. No payload file changes.
Owner attention:
1. **The adoption runs end to end from the terminal.** `devos adopt <folder>` goes from the survey and the brief to the branch, the pull request and the settings. Merging that pull request starts the cycle. Don't try it on the Control Tower yet: E38 is its adoption.
2. **The labels are made with `gh label create --force`.** An existing `devos:request` or `devos:method` label gets DEV_OS's colour and description. No other label is touched.
3. **The pull request permission applies to every workflow** of the repository, as with `devos init`. The summary before the `yes` says so.
Commit message: E36c: adopting an existing project, step 4c — devos adopt asks for the contract, the Control Tower link and the cycle's agents before anything is written; after a typed yes it pushes devos/adopt without force and opens its pull request with a summary of the brief (devos adopt --publish later), then sets the repository up as devos init does: keys on stdin or by name, only missing variables, labels, and GitHub Actions allowed to create and approve pull requests with the default permissions kept (D-E13) — PASS a1
Next prompt: `dev/fences/E37.md`, written next from `dev/PLAN.md`. On the owner's word of 2026-11-01, it also carries the builder fix proposed after T21's stop (PR-71): no agent can stop itself with `pkill -f`.
