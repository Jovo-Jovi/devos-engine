VERDICT: PASS — MERGE
Fetched: task/E22d @ 8c82687 (clean tree), main @ 5b66b81 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `git diff --stat origin/main...HEAD -- payload`, the D3 compare (after a fresh checkout of the two `.cmd` fence copies), `sh devos --version`, `git grep -nE "\.listen\(" -- lib`, `node --check` on the four files, `git ls-files -s` on the launchers, `gh run view 40077859078`, a Chromium run for D6, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E22d a1 (risk 2: launchers, the page names the project folder, a light theme; the review of record).
- **S1.**
  - `startUiServer` takes `folder: null` (choose mode). `/api/state` gives `folder`, `empty`, `choose` and `suggest` as specified.
  - `/api/plan` applies the four folder rules in order with their exact sentences, and removes `folder` from the payload.
  - The run's folder changes only after the plan validates: `root` is set next to `held` (line 407).
  - `uiCommand` no longer falls back to `process.cwd()`, and prints the keep-open line.
- **S2–S5.**
  - Test (s) checks every refusal, the accepted folder, and the run in it.
  - The page, README and launchers are the fence copies. `.gitattributes` ends with `*.cmd text eol=crlf`.
  - Test (e) is in place.

Ledger: D1 — PASS — `# tests 204` / `# pass 204` / `# fail 0` / `# skipped 0` (Linux); CI windows: only the existing skips
Ledger: D2 — PASS — `manifest up to date (119 files)`; the payload diff is empty
Ledger: D3 — PASS — `true` ×8. The first compare printed `false` for the two `.cmd` files only because this machine's checkout of the fence copies predated the new `eol=crlf` rule; their blobs are identical (`32f10b0…`, `3aa790f…`), and after a fresh checkout every compare is `true`.
Ledger: D4 — PASS — `sh devos --version` prints `devos 0.1.0`; the only `.listen(` is `lib/ui-server.mjs:541` on `"127.0.0.1"`; `node --check` is clean
Ledger: D5 — PASS — run `40077859078` on `8c82687`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success
Ledger: D6 — PASS — `devos` and `Start DEV_OS.command` are `100755`. In Chromium (light theme, the server started without a folder, the harness stubs), the page named `<home>/devos-projects/northwind-ceramics`. The run created it, wrote `devos/project.json` there, and ended on "Your project is on GitHub" with `errors []`.

Scope: in the fence.
Method (payload changes only): none; the payload diff is empty.
Owner attention:
- (1) **Your real test of 2026-10-24.** The blueprint ran on the Cursor CLI (Grok), as you chose, and failed with `agent exited with 1`, printing nothing.
  - **The choice stays yours.** Any signed-in tool can draft the blueprint.
  - **What has never run.** The engine's Cursor blueprint call (`agent --trust --force -p --model … --output-format json`, prompt on standard input) has not run against the real Cursor CLI. E21's real run is still planned last.
  - **E22e will fix it once I have your diagnostic output.** The likely fixes:
    - the prompt as a short argument that points at the prompt file, instead of standard input;
    - when an agent fails without a word, the engine says so and prints the exact command to try by hand.
- (2) **E14** still waits for your licence decision.

Commit message: E22d: start with a double-click — Start DEV_OS launchers and devos/devos.cmd from the engine folder, devos ui without a folder lets the page name and create it, a light theme with a toggle — PASS a1
Next prompt: none yet — E22e follows the owner's diagnostic output; E14 follows the licence decision.
