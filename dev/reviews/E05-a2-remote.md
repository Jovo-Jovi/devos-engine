VERDICT: PASS — MERGE
Fetched: task/E05 @ ca40a18 (clean tree), main @ 81b7da1 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `node --check lib/upgrade.mjs test/upgrade.test.mjs`, `git diff --name-only main...HEAD`, `git diff d287fd9..HEAD -- lib/upgrade.mjs` read in full, my a1 failure reproduction re-run with the a2 `lib/`, `gh run view 39284783248` + the Windows job log · Refused calls: none

Remote check of attempt 2 (risk 3). The local review `E05-a2.md` is Opus. The change is only the attempt-2 focus of fence v2:
- `rollback()` runs on every failure between `git switch -c` and a successful commit: the writes, the lock, the config regeneration, the body write, `git add` and `git commit`. It restores update/remove paths, the lock and `devos.config.json` from HEAD, unstages and deletes added files, switches back, deletes the empty branch and prints `devos: upgrade failed; rolled back, nothing changed`.
- The body path comes from `git rev-parse --absolute-git-dir`, run before the switch.
- A push or `gh` failure keeps the committed branch and prints the by-hand line.

Ledger: D1 — PASS — `node --test` → `# tests 62` / `# pass 62` / `# fail 0` (Linux), with `ok 59 - upgrade.test.mjs rolls back when config generation fails`, `ok 60 - … rolls back when the commit fails`, `ok 61 - … keeps the branch when the push fails`
Ledger: D2 — PASS — `manifest up to date (110 files)`; no payload, tool or workflow path in `git diff --name-only main...HEAD`
Ledger: D3 — PASS — `0 0`
Ledger: D4–D7 — PASS — unchanged since a1 (`E05-a1-remote.md`); `node --check` exits 0 for both changed files
Ledger: D8 — PASS — run `39284783248` on `ca40a18`, attempt 1: all three jobs success. Windows: `# pass 61`, `# fail 0`, `# skipped 1` (`ok 60 … # SKIP`, the hook-based commit failure, as the fence allows); 59 and 61 pass there.

**The a1 defect is fixed, and I confirmed it with my own reproduction.** The setup was the next release 0.1.1 with `reviewer.deep_paths` as a string, then `upgrade --local`. Result:
- `config: reviewer.deep_paths_extra needs an array reviewer.deep_paths`, then `devos: upgrade failed; rolled back, nothing changed`, exit 1;
- `git status --porcelain` empty, branch `main`, no `devos/*` branch;
- the lock still `"engine_version": "0.1.0"`.

Residual, not blocking. `rollback()` restores with a single `git restore … -- <paths>` call. If one path is not tracked in HEAD (an engine file the project put in `.gitignore`), git rejects the whole pathspec list and nothing is restored; the failure is printed but not reported as a failed rollback. This is filed for E10's clean-machine run.

Scope: the attempt-2 focus only (`lib/upgrade.mjs`, `test/upgrade.test.mjs`, the report).
Method (payload changes only): none.
Owner attention: `dev/fences/E06.md` v1 (from the a1 local review) is not issuable. I rewrote it as v2 on this branch (see the ledger and the fence header). It is risk 3 and has two owner items: the contract text is a draft, and the deletion-request channel needs confirming.
Commit message: E05: install and upgrade (three-way, branch + PR, conflicts listed) — PASS a2
Next prompt: dev/fences/E06.md v2
