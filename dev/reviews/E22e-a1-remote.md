VERDICT: PASS — MERGE
Fetched: task/E22e @ 67c9ed5 (clean tree), main @ 09a463d · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `git diff --stat main...HEAD -- payload`, the D3 Buffer compare, the two D4 `git grep` checks, `node --check` on the eight changed files, `gh run view 40083454653` (with its logs), the D6 Chromium run against this branch and the harness stubs, and `git diff main...HEAD` read in full · Refused calls: none

This is the remote check of E22e a1 (risk 2: how the blueprint reaches the Cursor CLI, and a server route that runs `devos continue`; the review of record).
- **The Cursor call.** Each round's input goes to `.devos/blueprint-input.md`. The CLI gets `BLUEPRINT_POINTER` as its last argument, and its standard input is closed with nothing written. The other tools are unchanged.
- **A silent failure.** It prints the two S1 lines, with each argument quoted by the S1 rule.
- **`/api/continue`.** It follows S5 rule for rule. `runDevos` is shared with `/api/start`, the run's stderr reaches the page's events line by line, and `/api/state` carries `started` and `projects`.
- **`continueCommand`** prints the `done` marker and reads the page's answers under `DEVOS_UI=1`.
- **The one deviation** is correct. The builder added `child.stdin.on("error", () => {})`, so a tool that exits before reading its standard input cannot crash the round with a pipe error.

Ledger: D1 — PASS — `# tests 208` / `# pass 208` / `# fail 0` (Linux), naming init (u), ui-server (t) and (u), ui-page (f); CI windows: `tests 208`, `pass 201`, `skipped 7` (the existing skips)
Ledger: D2 — PASS — `manifest up to date (119 files)`; the payload diff is empty
Ledger: D3 — PASS — `true true`
Ledger: D4 — PASS — `git grep -nE "\.listen\(" -- lib` prints only `lib/ui-server.mjs:633`; `do exactly what it says` only in `lib/init.mjs:25` (`BLUEPRINT_POINTER`); `node --check` is clean for all eight files
Ledger: D5 — PASS — run `40083454653` on `67c9ed5`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success
Ledger: D6 — PASS — Chromium against this branch and the harness stubs, with Cursor picked as the blueprint agent:
- a silent agent ends on "The run stopped with an error", with the call to try by hand in the alert;
- Try again reaches "Review the blueprint";
- after a new server start, `hello-cli` is listed and its Continue goes through to "Your project is on GitHub";
- the agent got the pointer as its last argument, `""` on standard input, and the input file starting `# Blueprint`;
- `errors []`.

Scope: in the fence.
Method (payload changes only): none; the payload diff is empty.
Owner attention:
- (1) **Test hygiene, for E22f (my fence's wording).** Worker (u) creates a stage but does not apply its environment. So its `/api/state` probes the real CLIs on the machine (`--version`, `gh auth status`). It changes nothing, and on the CI runners those CLIs are absent, but the rule is that tests never call real CLIs. My S6 said "Stage the stubs" without saying to apply them.
- (2) **Your run of 2026-10-24 (hello-cli2, hello-cli3), diagnosed.**
  - **"Cannot use this model".** `detectAgents` keeps whole lines of `agent models` as model ids, for example `grok-4.7-xhigh-fast - Grok 4.7 Extra High Fast`, with zero-width spaces. That full line was saved and sent to `--model`. The Cursor IDE's idea (keep the id before ` - `, drop the heading and the tip) is right. The same dirty id also reaches the builder and reviewer models in `devos/project.json`, which the cycle sends on GitHub. E22f fixes it at the source, cleans saved answers, and refuses a model id with spaces in the plan check.
  - **The 47-minute blueprint.** The heartbeat counted 1 to 47 minutes without restarting, so it was a single engine round. Cursor's first session ended its turn at 2:53, and a newer CLI build (`2026.10.22`) then started with the same arguments, so the work began again. With `--output-format json` the engine sees nothing until the process exits. E22f:
    - switches Cursor (and Claude) to `stream-json`;
    - ends the round on the agent's own `result` event, and ends the process tree after it;
    - shows each step live;
    - resumes the same session for a repair round, and prints why the checks failed before it.
  - **On the page.** These become part of E22f:
    - a live working indicator with the agent's current step;
    - Start a new project and Close on every final screen;
    - continue a project from a folder path, with the step it will resume;
    - Change choices after an error (the blueprint model);
    - the README cleanup.
- (3) **E14 is next**, as fenced. I re-rehearsed it on this build: 221 tests, every *Done when* line holds. I write E22f while it builds.

Commit message: E22e: the blueprint runs on the tool the developer picks — Cursor reads its round from .devos/blueprint-input.md, a silent agent gets the call to try by hand, the run's stderr reaches the page, POST /api/continue with Try again, Continue and the started-projects list — PASS a1
Next prompt: dev/fences/E14.md
