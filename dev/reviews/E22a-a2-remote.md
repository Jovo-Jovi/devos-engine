VERDICT: PASS — MERGE
Fetched: task/E22a @ 43cf031 (clean tree), main @ e51493a · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `git diff --stat main...HEAD -- payload`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, the three D3 `git grep` checks, `node bin/devos.mjs`, `node --check` on every changed `.mjs`, `ps` for orphaned models after the suite, `gh run view 40043045720` (with its logs), and `git diff 4854d9d..HEAD` read in full · Refused calls: none

This is the remote check of E22a a2 (risk 3: a local server that takes the developer's keys; the review of record).
- **FIX 1.**
  - `ensureTemp()` creates the 0700 temp folder again whenever it is gone.
  - A plan that arrives after a `done` clears the events, `finished`, `unanswered` and the held plan.
  - Stop with no child answers 409.
- **FIX 2.**
  - A body that is not a plain object answers 400 with the fence's sentences.
  - One `try`/`catch` covers the handler. It answers 500 `{"error":"internal"}` and prints nothing.
- **FIX 3.**
  - `readFileKey` takes a `base64:` line only when `read.interactive === true`, and decodes it in memory.
  - The server sends `base64:<value>` and writes no key file: `git grep "key-"` is empty.
- **FIX 4.** The order is Host, then Origin, then the token. A refused request is drained with `req.resume()` and never buffered.
- **FIX 5.**
  - On POSIX: SIGINT, then `killPidTree` after 2 s if the child has not closed.
  - On Windows: `killPidTree` at once.
  - `done` 130 comes from the child's `close`. `close()` waits for the child, at most 3 s.
- **FIX 6.** `workerM` builds its plan on a separate normal stage.
- **Tests (o) and (p)** do what S8 asks. (p) scans the temp folder, the project and the stage for the `fv-` value before it answers `create`.
- **No orphans.** After the full suite, no stub model is left running.

Ledger: D1 — PASS — `# tests 187` / `# pass 187` / `# fail 0` / `# skipped 0` (Linux, (m) included); CI windows: `tests 187`, `pass 180`, `skipped 7`, (m) the only new skip
Ledger: D2 — PASS — `manifest up to date (117 files)`; the payload diff is empty; `verify-source` prints E20's line unchanged
Ledger: D3 — PASS — only `lib/ui-server.mjs:463: server.listen(port, "127.0.0.1", …)`; no `Access-Control-Allow-Origin` in `lib`; no `key-` in `lib/ui-server.mjs`
Ledger: D4 — PASS — `devos init --plan <file> [folder]` and `devos ui [folder] [--no-open]` are listed
Ledger: D5 — PASS — `node --check` is clean for all four changed files
Ledger: D6 — PASS — run `40043045720` on `43cf031`, attempt 1: `checks`, `test (ubuntu-latest)` (with `ok 163 … (m)`), `test (windows-latest)` success

Scope: in the fence (v2).
Method (payload changes only): none; the payload diff is empty.
Owner attention:
- (1) **Four small gaps for the page, carried by E22b as its Stage 0.** None is reachable without the token, and nothing sends these answers until E22b. They come from my fence's thin answer rules.
  - An answer holding a line break is written as two stdin lines. A pasted key with a trailing newline would answer the next prompt too. A multi-line change request would become one model round per line.
  - The `create` value is not checked for `yes` or `no`.
  - A file key cannot be skipped: `""` fails the base64 JSON check and answers 400.
  - A subscriber that connects after `done` gets the replay, but the stream never ends.
- (2) **E22b is written.**
  - **The page.** A guided, high-end page in seventeen steps, on the owner's dark-and-gold direction. Its signature is a blueprint sheet that draws the project's own architecture while the model writes. It is given as exact fence texts.
  - **The check.** I ran it end to end in Chromium against the real server and the harness stubs: the full run, Stop, and Not now, on desktop and at 390 px. There were no console or CSP errors.
  - **Fonts.** It ships the IBM Plex fonts locally under the OFL. The CSP allows no outside fonts.

Commit message: E22a: guided UI part 1 — plan mode (devos init --plan), prompt markers, a 127.0.0.1 server with a per-run token, Host and Origin checks, CSP, SSE progress, answers and keys relayed without touching disk, Stop that ends the model; devos ui — PASS a2
Next prompt: dev/fences/E22b.md
