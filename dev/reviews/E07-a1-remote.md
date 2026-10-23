VERDICT: PASS — MERGE after D8
Fetched: task/E07 @ 4ae5919 (clean tree), main @ bd1d0dc · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `git diff --stat main...HEAD -- payload tools .github`, `node --check` on `lib/`, `bin/`, `test/`, `gh run view 39296849735`, a pseudo-terminal run of `devos init --continue` (below), and `git diff main...HEAD` read in full · Refused calls: none

Remote check of E07 a1 (risk 3; the local review `E07-a1.md` is Opus). I read every line of `lib/setup.mjs` and the `lib/init.mjs`, `lib/which.mjs` and `bin/devos.mjs` diffs.

**Secret values never pass through DEV_OS.** `gh secret set <NAME> --repo <slug>` runs with inherited stdio and no `--body`. A non-TTY run only prints the commands. `SECRETS_JSON` carries `"1"`/`""` per name, never a value. Nothing is written or logged.

**The other steps** follow fence v2 in order: owner, `SETUP.md`, commit, repository, workflow permissions, variables, secrets, check and dispatch (with two retries). Each failure stops with `--continue` guidance. S2 re-asks a name whose key fails `KEY_RE`. The repair round carries the instruction from fence v2.

Ledger: D1 — PASS — `# tests 81` / `# pass 81` / `# fail 0` (Linux); `setup.test.mjs` runs and the ten `init.test.mjs` cases pass
Ledger: D2 — PASS — `manifest up to date (111 files)`
Ledger: D3 — PASS — `0 0`
Ledger: D4 — PASS — the E06 line, unchanged
Ledger: D5 — PASS — `git diff --stat main...HEAD -- payload tools .github` prints nothing
Ledger: D6 — PASS — `node --check` clean
Ledger: D7 — PASS — run `39296849735` on `4ae5919`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success
Ledger: D8 — OPEN (owner) — not run yet; the only gh login on the owner's machine is the main account

**The TTY hand-off has no automated test, so I proved it on Linux with a real pseudo-terminal.**
- **Setup:** an installed project with an approved blueprint (fixture docs, settings and answers), and a `gh` stub that prompts `? Paste your secret:` and reads the value from the terminal itself. It logs only the value's length.
- **Run:** `node bin/devos.mjs init --continue <folder>` under `pty.fork()`, answering Enter, a value, Enter, a value.
- **Result:**
  - The stub logged `GOT CURSOR_API_KEY len=10 tty=true` and `GOT CLAUDE_CODE_OAUTH_TOKEN len=10 tty=true`: each child got the terminal and the whole value. devos's paused readline swallowed nothing.
  - The flow ended with `devos init: devtest/demo-shop is set up; devos-cycle dispatched` (exit 0).
  - The gh call order matched the fence.

Windows' console is still unproven, which is what D8 is for. Opus's note about an empty first prompt applies there.

Scope: in the fence. The change is `lib/setup.mjs`, `lib/init.mjs`, `lib/which.mjs` (`stdio`), `bin/devos.mjs` and the tests; no payload change.
Method (payload changes only): none.
Owner attention:
- (1) **D8 is required before the merge.** If no throwaway account is available, use your own account with a throwaway project name, for example `devos-d8-test`. The slug is then `jovo-jovi/devos-d8-test`, and it is private by default. Delete it afterwards with `gh repo delete jovo-jovi/devos-d8-test --yes`, which needs the `delete_repo` scope: `gh auth refresh -s delete_repo`. The run consumes a little Cursor/Claude usage, because the cycle starts T01.
- (2) A name that clashes with an existing repository stops at `repository`. `--continue` retries the same slug, so the way out is to add the remote yourself (`git remote add origin …`) or start again with another name. This is noted for E10's README.
- (3) `dev/fences/E08.md` does not exist, although the ledger said "v1 issued". I corrected the ledger and wrote it here (see `Next prompt`).

Commit message (after D8): E07: init part 2: repository, secrets by name, variables, SETUP.md, first cycle — PASS a1
Next prompt: dev/fences/E08.md
