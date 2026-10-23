VERDICT: FAIL — FIX
Fetched: task/E17 @ 0454764 (clean tree), main @ e35babb · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 counts and `includes` check, the D5 staged guards (install `DEMO`, fixture docs, `run-all.mjs`), the D6 Buffer compares, `node --check` on every changed `.mjs`, `bash -n run-agent.sh`, `gh run list --branch task/E17`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E17 a1 (risk 3, a method change; the review of record). The report's STATUS is HALT, at D3 only. I read every changed line in `payload/`, `lib/`, `tools/` and `test/`.
- **The build follows the fence.**
  - `agents.mjs`: `tools`, and four tools.
  - `accounts.sh`: Codex and Gemini accounts; Cursor and Claude unchanged.
  - `agent-cli.mjs`: `args` and `normalize`.
  - The four role kits, and the Gemini policy (byte for byte).
  - `run-agent.sh`, the workflow branches and the setup items.
  - The engine roster, catalogue and Gemini blueprint flags.
  - PR-45, the manual rows and the provenance.
- **The proven Cursor and Claude command lines are untouched.** Test (m) counts them at 2, 1, 2 and 1.

**The halt was correct, and the defect was the fence's.** The secrets guard requires every setup-item secret name in `devos-setup.yml`'s presence list. The fence's rehearsal missed that workflow. The builder added the four names there and tagged the file `E17` in `LOCAL`, which is the right change. With it, the D3 line is `67 identical, 34 changed …`. v2 makes that the expected line.

Reading the code turned up two real defects, below.

Ledger: D1 — PASS — `# tests 144` / `# pass 144` / `# fail 0` / `# skipped 0` (Linux; (j), (k) and (l) run here)
Ledger: D2 — PASS — `manifest up to date (115 files)`
Ledger: D3 — FAIL against v1, PASS against v2 — `67 identical, 34 changed (E03, E06, E11, E12, E17, E15, P1, E02), 14 added (E02, E06, E15, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`. The extra changed file is `.github/workflows/devos-setup.yml`. This was the fence's defect.
Ledger: D4 — PASS — `Live maximum: PR-45` ×1, one `| PR-45 |` row, `includes` → `true`
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true true`
Ledger: D7 — PASS — `node --check` is clean; `bash -n run-agent.sh` exits 0
Ledger: D8 — PASS — run `40013478794` on `0454764`, attempt 1: success (actionlint included)

**FIX 1 — `run-agent.sh` can read another tool's output.**
- **The cause.** `agent-cli.mjs normalize` prefers `<raw>.stream.jsonl`, and `run-agent.sh` never deletes the files a previous run left behind. The Cursor builder's watchdog leaves `.devos/builder.json.stream.jsonl`.
- **The failure.** Take a pool of Cursor and Gemini. Cursor reaches its usage limit on both accounts, so the fallback runs Gemini. `normalize` then parses Cursor's stream instead of Gemini's JSON. It returns `is_error: true` with Cursor's text, so `builder-status.mjs` treats a finished Gemini build as a failed builder.
- **Other effects.** A Codex run followed by a Gemini run has the same problem. A stale `-o` file can also stand in for a run that wrote none.

**FIX 2 — Gemini token counts are always 0.**
- **The cause.** Gemini's `--output-format json` gives `stats.models` as an object keyed by model name (`metrics.models: Record<string, …>` in its source). `normalizeGemini` sums only an array.
- **Why the test missed it.** Test (h) used an array. The fence's wording ("over `stats.models`") did not fix the shape, so this is partly the fence's defect too.

Scope: in the fence, plus `devos-setup.yml`, which the secrets guard requires (see above).
Method (payload changes only):
- **Non-waivable rules hold.**
  - Human gates and PR-28 are unchanged.
  - The role surfaces hold: the kits are removed before `guard-surfaces`, and `restore` checks `AGENTS.md` and `GEMINI.md`.
  - A red check still overrides PASS.
  - Secrets stay out of files: the keys go to the agent's environment only, and the policy blocks `gh`, `curl` and git writes.
  - The runner owns git: checkout keeps no credential, and the watchdog strips `GH_TOKEN`.
- **The record is complete.** PR-45 is added at the live maximum. `AUTOMATION.md` names `run-agent.sh`, `agent-cli.mjs`, both account variables and the four kits, and `guard:manual` passes with 101 names.
Owner attention:
- (1) **Codex and Gemini have not run for real** on a GitHub runner, and these flags are untested against the real CLIs: Codex `--sandbox workspace-write` with network for the builder, and Gemini `--approval-mode yolo` with the user policy. E21 needs an OpenAI key or a Gemini key for that run.
- (2) **The CLIs are installed unpinned**, as Claude Code and Cursor already are. A breaking CLI release would show up as a failed run.

Next prompt: dev/fences/E17.md (v2, `### Attempt 2 focus`)
