VERDICT: FAIL — FIX
Fetched: task/E05 @ 982d8de (clean tree), main @ 81b7da1 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `git diff --stat main...HEAD -- payload tools .github`, `node bin/devos.mjs install <tmp>/p --key DEMO`, `node bin/devos.mjs`, `node --check` on `lib/*.mjs`, `bin/devos.mjs`, `test/*.mjs`, `gh run view 39271279765` + the Windows job log, a failure-path reproduction (below), `git diff main...HEAD` read in full · Refused calls: none

Deep remote review (risk 3). The local review `E05-a1.md` was done by Grok, not Opus, so this review covers it.

Every line of `lib/engine.mjs`, `lib/install.mjs`, `lib/upgrade.mjs`, the `lib/which.mjs` and `bin/devos.mjs` diffs, the S0 change to `role-env.test.mjs`, and the new tests was read. The happy paths are correct:
- the twelve-row plan matches the fence table exactly;
- conflicts and `kept` paths keep the installed hash in the lock;
- the commit stages only the upgrade's paths;
- `which.run` quotes every argument for a `.cmd`;
- `lib/` never imports `tools/`.

The defect is the failure path before the commit. The fence did not specify it (step 7 covered only publish failures), so it is partly the fence's own gap.

Ledger: D1 — PASS — `node --test` → `# pass 59` / `# fail 0`; names `install.test.mjs` (6), `upgrade.test.mjs` (12 plan rows + 5 end-to-end), `command.test.mjs run keeps one cmd argument that contains a space`
Ledger: D2 — PASS — `manifest up to date (110 files)`; `git diff --stat main...HEAD -- payload tools .github` empty
Ledger: D3 — PASS — `0 0`
Ledger: D4 — PASS — `devos install 0.1.0: 110 engine files, 3 templates, devos.config.json written` (exit 0)
Ledger: D5 — PASS — usage ends `devos install [folder] --key <KEY>` / `devos upgrade [--local]`
Ledger: D6 — PASS — `node --check` exits 0 for every `.mjs` under `lib/`, `bin/`, `test/`
Ledger: D7 — PASS — `git diff --name-only main...HEAD` is the fence's list plus the reviewer's `dev/` files
Ledger: D8 — PASS — run `39271279765` on `982d8de`, attempt 1: all three jobs success. The Windows log has `ok 17`–`ok 22` (install), `ok 42`–`ok 58` (upgrade) and `ok 6 - command.test.mjs run keeps one cmd argument that contains a space`.

**Defect — a failed upgrade leaves the base branch dirty and half-upgraded.** `runUpgrade` runs `git switch -c devos/upgrade-<y>` and then writes files and the lock. If the config regeneration, `git add` or `git commit` then fails, it only runs `git switch <base>`. The new branch still points at the base commit, so git carries the uncommitted changes back onto the base branch.

Reproduced with a next release (0.1.1) whose `engine.defaults.json` makes `reviewer.deep_paths` a string. That is a shape change the engine may ship; the default `project.json` has `deep_paths_extra`. Result:
- `config: reviewer.deep_paths_extra needs an array reviewer.deep_paths`, exit 1;
- the user is back on `main` with `M devos/engine.defaults.json` and `M devos/engine.lock.json` (lock says 0.1.1), uncommitted;
- the stray branch `devos/upgrade-0.1.1` exists;
- no message says what happened or how to recover.

A rerun refuses (`not clean`, then `branch … already exists`). A developer who commits that state gets a lock that claims 0.1.1 with a stale `devos.config.json`. The engine writes into developers' repositories, so a failure must leave nothing behind.

Minor, fixed in the same attempt:
- (a) The PR body path assumes `.git` is a directory. In a git worktree or a submodule `.git` is a file, so `writeFileSync` throws after the branch switch.
- (b) After a push or `gh` failure, the committed branch stays (correct), but the message does not say so.

Scope: in the fence. No payload, manifest, tool or workflow change; S0 and S1 close the two E12/E13 follow-ups.
Method (payload changes only): none.
Owner attention:
- (1) The local review says PASS; this remote check is FIX. Do not merge.
- (2) `dev/fences/E06.md` was written on this branch by the local review. I re-rehearse it after E05 passes.

Next prompt: dev/fences/E05.md v2 (`### Attempt 2 focus`)
