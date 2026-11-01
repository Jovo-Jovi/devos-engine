MERGE

VERDICT: PASS
Fetched: `task/E39` @ 254efd8 (no uncommitted changes; `main` @ 3bdd72e, unmoved since the fence) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff c7eca7e HEAD`), D1 (`node --test --test-concurrency=4 "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D4, engine-ci run 41328230307 and its jobs, the attempt-1 report · Refused calls: none

E39 is D-E13's step 7. With `devos ui` and no folder, the guided page now offers "Existing project": a folder on this computer or a GitHub address, then the survey, then the same `devos adopt` the terminal runs.
- **The command.** Under `DEVOS_UI=1`, `devos adopt` marks each question for the page (`uiReader`) and each key the way `devos init` does, and it ends with its real exit code. Without `DEVOS_UI` nothing changes.
- **Cloning.** `cloneProject` clones a repository without DEV_OS for adoption, and refuses one that already has the lock.
- **The server.** It has `/api/adopt/check` and `/api/adopt/start`, a `line` answer, and the run's kind in `/api/state`.
- **The page.** It has the entry, the `adopt` screen and the `adopting` screen.

The review is light for risk 2, with a full read of every changed line of `lib/`, since the page carries keys. It was a specification fence, so the builder wrote the code, and this review read it all.
Ledger: D1 — PASS — my run on Linux: `tests 443`, `pass 443`, `fail 0`, `skipped 0`, with no `not ok`. All six new tests are `ok`: `adopt.test.mjs` (r), `adopt-install.test.mjs` (ab), `hub.test.mjs` (f), `ui-server.test.mjs` (aa) and (ab), and `ui-page.test.mjs` (i). The builder's report on Windows: `tests 443`, `pass 423`, `fail 0`, `skipped 20`, the skips the fence allows.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — the builder's commit (`c7eca7e..254efd8`) changes only these 12 paths, all in the fence's list:
- `lib/adopt.mjs`, `lib/hub.mjs`, `lib/ui-server.mjs`, `lib/ui/app.js`;
- the five test files;
- `README.md`, `CHANGELOG.md` and `dev/reports/E39.md`.

Beside them, `main...HEAD` has only the reviewer's `dev/LEDGER.md` and `dev/fences/E39.md`.
Ledger: D4 — PASS — `devos 1.4.0`.
Ledger: D5 — PASS — engine-ci run 41328230307 on 254efd8, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — every changed line of `lib/` read:
- **No key value escapes.**
  - `devos adopt` reads a key from `read.raw`, so it sends no `line` marker, and `secret` reads it without echo.
  - The marker carries only `name`, `where`, `optional`, `file`, `index` and `total`.
  - The server's `key` path is unchanged: one line, a file key checked as base64 JSON.
  - The page clears the field before `answer()`, and keeps nothing, as the keys screen does.
- **The routes.**
  - `/api/adopt/check` and `/api/adopt/start` come after the existing host, origin and token checks (`lib/ui-server.mjs` before routing).
  - They answer `409` while a child runs and `400` outside choose mode.
  - `agent` is checked against the fence's pattern, and the folder is a full path to an existing directory outside the engine.
  - `runDevos` gets an argument array without a shell.
- **The terminal is unchanged.** Without `DEVOS_UI`, `uiReader` returns the same reader and `uiStep`/`uiAsk` print nothing. `read.raw ?? read` is the same reader, and `adoptPublishCommand` gets the same `lineReader` it built before.
- **The pull-request link.** It is made only for a line that matches `^https://github\.com/<owner>/<repo>/pull/<n>$`, with `rel="noopener noreferrer"`. Every other line is text (`el(..., { text })`), and `ui-page.test.mjs` (d) still bans markup.
Scope: in fence. No payload file, `lib/install.mjs`, `lib/upgrade.mjs`, workflow, dependency or version change. `devos adopt`'s questions, texts and order are unchanged.
Method (payload changes only): N/A. No payload file changes.
Owner attention:
1. **First, a full adoption through the page.** The tests stop at the brief. Before the Control Tower, run "Existing project" on a small repository of yours, through the push and the pull request.
2. **Two notes, not defects.**
   - If a file key were refused after it was sent, `devos adopt` would ask again without a new marker, as `devos init` does. The server's base64 JSON check makes that unreachable.
   - `/api/continue` sets `runKind` to `null`, since that run is neither kind.
Commit message: E39: adopting an existing project, step 7 — the guided page offers "Existing project" (a folder or a GitHub address, the survey, then the same devos adopt questions answered on the page: the brief, the contract, the deploy, the keys and the push); devos adopt marks its questions and its end for the page only under DEVOS_UI, and the terminal is unchanged; cloneProject clones a repository without DEV_OS for adoption (D-E13) — PASS a1
Next prompt: none. E39 closes D-E13's adoption tasks. Next is the 1.4.0 release, by `dev/RELEASE.md` (the owner's steps).
