VERDICT: PASS — MERGE
Fetched: task/E12 @ d456f27 (clean tree) · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower` (own clone pinned at a49ca6d), `node tools/find-specifics.mjs --check`, the D9 column-0 one-liner, `node tools/stage.mjs` + `config.mjs --write` + `run-all.mjs --only config,manual` in a scratch folder, `node --check` on every changed `.mjs`, a PyYAML parse of every payload workflow, `git diff main...HEAD` read in full · Refused calls: none

Review of record for attempt 3 (risk 3, deep, Opus). The local review was skipped (Claude session limit), so this remote check is the only review of a3 and it replaces it. Attempt 3 changes what fence v8 asked: `test/manifest.test.mjs` hashes the LF-normalized bytes with `normalizeLf`/`sha256Hex` from `tools/sources.mjs`, the same function the manifest uses, so a CRLF working copy no longer fails the suite; the Claude builder's `node` heredoc in `devos-cycle.yml` is indented inside its `run: |` block, and every payload workflow now parses. I re-read every changed line of the branch against `main`: the workflow's builder and reviewer branches for both tools, `role-env.mjs`, both role kits, `agents.mjs` (`next --after`, `reviewer_id`), `lib/which.mjs`, the four test files, `tools/sources.mjs`, the manifest, and the AUTOMATION and PRECEDENTS changes.

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` → `# pass 34` / `# fail 0`; `agents.test.mjs` and `command.test.mjs` both run (their test names are printed)
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (110 files)`
Ledger: D3 — PASS — `node tools/verify-source.mjs --tower ../devos-sources/tower` exit 0 → `79 identical, 22 changed (E03, E11, E12, E02), 9 added (E02, E12, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D4 — PASS — `node tools/find-specifics.mjs --check` → `0 0`
Ledger: D5 — PASS — `dev/reports/E12.md` `## Attempt 3` holds the diff. `grep -c 'arrives in E12'` → `0`. The Cursor `agent -p --force --trust --approve-mcps --model "$MODEL" --output-format stream-json` line is present 3 times, and `--permission-mode dontAsk` is also present 3 times. The diff adds the Claude builder branch, the Cursor reviewer branch, and one `next --after "$builder_id"` run, and there is no reviewer next-agent run (the test asserts both).
Ledger: D6 — PASS — staged folder (DEMO project) → `guard:config    PASS  (generated config is current)`, `guard:manual    PASS  (96 names checked)`
Ledger: D7 — PASS — `node --check` exits 0 for every `.mjs` in `git diff --name-only main...HEAD`
Ledger: D8 — PASS (Linux half) — the `command.test.mjs` quoting case exits 0 on Linux. The Windows evidence line is in the owner's a3 report and was not re-runnable here.
Ledger: D9 — PASS — the column-0 one-liner → `0`. Independently, PyYAML parses all payload workflows (`yaml ok`); this is the check a1 and a2 both missed.

Scope: The change is in the fence. Paths changed outside `dev/`: `lib/which.mjs`, the four role-kit files, `role-env.mjs`, `agents.mjs`, `devos-cycle.yml`, `AUTOMATION.md`, `PRECEDENTS.md`, the manifest, `tools/sources.mjs` (provenance), and four tests. `.editorconfig` arrived in the owner's fence-v7 commit, not from the builder. Nothing in the Do NOT list was touched: there is no invented limit exit code, no home-directory read, no verdict written by the workflow, no Codex/Gemini adapter, `install`/`upgrade` are untouched, and the `--force`, `--trust`, `--approve-mcps`, `dontAsk` and reviewer `--disallowedTools` flags are kept.

Method (payload changes only):
- PR-42 is added at the next id, and the live maximum line is `PR-42`. Its text states the following:
  - the role kit is installed and then restored;
  - the review file is the verdict (PR-21);
  - there is one next-pool run, for a builder usage limit, only after that agent's accounts are exhausted;
  - "a reviewer never falls back into the pool";
  - a method fix is always reviewed by Claude Code with the gate model (PR-28 kept).
- Non-waivable rules hold:
  - Human gates are unchanged.
  - Role surfaces: the Claude builder kit denies every `surfaces.builder.deny` glob for both Edit and Write, plus git writes, `gh`, `curl` and `wget`, and the test enumerates them from `engine.defaults.json`. The Cursor reviewer kit writes only `docs/reviews/**` and `docs/fences/**`.
  - Red check overrides PASS: the same verdict path as before.
  - No secrets in files.
  - The runner owns git: restore runs before the `changed` count, and `git status --porcelain -- .cursor .claude CLAUDE.md` must be empty or restore exits 1.
- AUTOMATION is updated:
  - §4 names `role-env.mjs` and `agents.mjs` `next --after`.
  - The `builder-model.mjs` row no longer says "Grok model id", which closes the E11 a1 remote follow-up.
  - §8 `agents` notes either role and the one builder fallback.
  - `guard:manual` passes.

Owner attention:
- (1) This is the first task merged without a local review. The record is this file, not `E12-a3.md`.
- (2) D8's Windows half rests on your report. When you next run the suite on Windows, check that it prints `run("sample", []) exited 0; stdout contained quoted-ok`.
- (3) `which.run` quotes the `.cmd` path; arguments passed through `shell: true` are still not quoted. No current caller passes a spaced argument, so this is noted as a follow-up for E05, where `install` passes paths.
- (4) Next is E13 (engine CI), which makes the YAML parse a gate instead of a reviewer's habit.

Commit message: E12: Cross-role agents: Claude Code as builder, Cursor as reviewer (verdict from the review file, PR-21) (PLAN §7a) — PASS a3
Next prompt: dev/fences/E13.md (written on this branch)
