VERDICT: FAIL — FIX
Fetched: task/E22a @ 70aec4d (clean tree), main @ e51493a · Commands run: `node --test "test/*.test.mjs"`, `DEVOS_UI_WORKER=m node test/ui-server.test.mjs` (alone, and in an instrumented scratch copy), `node tools/build-manifest.mjs --check`, `git diff --stat main...HEAD -- payload`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, the D3 `git grep` pair, `node bin/devos.mjs`, `node --check` on every changed `.mjs`, two scratch reproductions against `startUiServer`, `gh run view 40037116331`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E22a a1 (risk 3: a local server that takes the developer's keys; the review of record).
- **What follows the fence.**
  - **Plan mode.** `buildAnswers` and `validatePlan` live in `lib/plan.mjs`, and `startProject` is shared by `devos init` and `devos init --plan`.
  - **Markers.** They print only under `DEVOS_UI=1`, and the terminal output is unchanged.
  - **Server checks.** It listens on 127.0.0.1 only, with a per-run token, the Host and Origin checks, the four headers and no CORS.
  - **Routes.** SSE replays the events so far to a late subscriber, and `devos ui` works.
- **What fails.** Three defects make the server unfit to take keys:
  - the server crashes on two ordinary inputs;
  - Stop leaves the model running on Linux and macOS;
  - a file key is written to disk.

  Two smaller defects are listed under FIX 4 and FIX 6.

Ledger: D1 — FAIL — `# tests 185` / `# pass 184` / `# fail 1`: `not ok 163 - ui-server.test.mjs (m) stop ends a hung model` (worker status `null`: killed at the 180 s limit)
Ledger: D2 — PASS — `manifest up to date (117 files)`; the payload diff is empty; `verify-source` prints E20's line unchanged
Ledger: D3 — PASS — only `lib/ui-server.mjs:381: server.listen(port, "127.0.0.1", …)`; no `Access-Control-Allow-Origin` in `lib`
Ledger: D4 — PASS — both usage lines are listed
Ledger: D5 — PASS — `node --check` is clean
Ledger: D6 — FAIL — run `40037116331` on `70aec4d`: `test (ubuntu-latest)` failure (test (m)), `test (windows-latest)` success, `checks` success

**FIX 1 — the server crashes after the first run ends.**
- **Cause.** `emit({type:"done"})` deletes the temp folder. Nothing creates it again, so the next `POST /api/plan` with an attachment, or the next `POST /api/start`, calls `writeFileSync` into a missing folder.
- **Reproduction.** `POST /api/stop` with no run gives `204`. The next plan then stops the process with `UNHANDLED: ENOENT`.
- **The fix.**
  - Create the temp folder again (mode 0700) whenever a new plan arrives after a `done`.
  - A new plan clears `events`, `finished` and `unanswered`.
  - `POST /api/stop` with no running child answers 409 `{"error":"state"}` and emits nothing.
- **The fence's share.** It said to delete the folder after `done`, and said nothing about the next run.

**FIX 2 — one bad body stops the server.**
- **Cause.** No handler is wrapped. A plan body of `null` reaches `payload.attachments`.
- **Reproduction.** `UNHANDLED: TypeError Cannot read properties of null (reading 'attachments')`, and the process exits.
- **The fix.**
  - A plan or answer body that is not a JSON object answers 400 `["The plan is not a JSON object."]` or `["The answer is not a JSON object."]`.
  - Every request runs inside one `try`/`catch`. An error answers 500 `{"error":"internal"}` (when headers are not yet sent) and is never printed with its message. The server keeps serving.

**FIX 3 — a file key is written to disk.**
- **Cause.** `/api/answer` writes the decoded JSON to `tempDir/key-<hex>.json` and sends that path.
- **The rule it breaks.** The contract: a key is never written to a file.
- **The fix.**
  - Plan mode's `readFileKey` also accepts a line `base64:<data>`. It decodes the data in memory, checks it with `JSON.parse`, and returns the text.
  - The server sends that line to the child's stdin and writes no file.
  - The terminal prompt's wording does not change.
- **The fence's share.** This was my fence's defect: S6 said to write the key to a temp file.

**FIX 4 — the body is read before the token is checked.**
- **Cause.** For a non-GET request, the server reads up to 24 MiB before it checks `X-DEVOS-Token`.
- **The fix.** Check the token, which is a header, before reading the body. An `/api/` request without the token answers 401, and nothing of its body is read.

**FIX 5 — Stop leaves the model running (POSIX).**
- **Cause.** `stopChild` sends SIGINT to `devos init`, then `killPidTree` sends SIGTERM to it at once. SIGTERM's default action ends node before its SIGINT handler runs. That handler is the code that kills the model, so the model is left orphaned (parent pid 1).
- **The fix, checked in a scratch copy.** Send SIGINT, and run `killPidTree(pid)` only if the child has not closed after 2 s. Clear that timer on `close`. With this change the model was gone, and worker (m) exited 0.
- **Windows.** `process.kill(pid, "SIGINT")` ends the child unconditionally, before `taskkill /T` can walk its tree. So on Windows, call `killPidTree(pid)` at once.
- **The fence's share.** Partly my fence's defect: S6 named `killPidTree(child.pid)` alone.

**FIX 6 — test (m) never reaches Stop.**
- **Cause.** `workerM` calls `planFrom(staged)` on the `hang` stage. That terminal `init` blocks on the hung model until the 180 s limit, and leaves an orphaned model behind. I found two from earlier runs on this machine.
- **The fix.** Build the plan from a separate, normal `stage()`, as `workerL` does.

Scope: in the fence.
Method (payload changes only): none; the payload diff is empty.
Owner attention:
- (1) **The rule FIX 3 restores.** The developer's keys reach only `gh secret set`, over standard input. They never reach a file, a log or an event. E22a v2 holds the server to that rule, and adds test (p) to prove it.
- (2) **E22b is the page.** Its fence follows the E22a PASS. It specifies a guided, high-end design, written as the exact texts of `index.html`, `app.css` and `app.js`, checked in a browser against a mocked API before the builder starts. The server only serves them.

Next prompt: dev/fences/E22a.md (v2, `### Attempt 2 focus`)
