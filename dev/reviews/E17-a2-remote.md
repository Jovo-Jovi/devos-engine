VERDICT: PASS — MERGE
Fetched: task/E17 @ f6277a7 (clean tree), main @ e35babb · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 counts and `includes` check, the D5 staged guards (install `DEMO`, fixture docs, `run-all.mjs`), the D6 Buffer compares, `node --check` on every changed `.mjs`, `bash -n run-agent.sh`, `gh run view 40015704664`, and `git diff 3326653..HEAD` read in full · Refused calls: none

This is the remote check of E17 a2 (risk 3, a method change; the review of record). Attempt 2 changes only what the v2 focus names:
- **FIX 1.** `rm -f "$out" "$out.stream.jsonl" "$last"` runs before every CLI start in `run-agent.sh`: each builder account and restart, and each reviewer account. The limit file is still saved before the next account clears the outputs. Case (q) proves that a stale Cursor stream is dropped and the Gemini result is read.
- **FIX 2.** `normalizeGemini` sums `Object.values(stats.models)` for the CLI's object shape, and still accepts an array. Test (h) uses the object shape.
- **FIX 3.** The `DEVOS_ACCOUNT_SWITCH` row now reads "shared by every agent tool".

Attempt 1's code, reviewed line by line in `E17-a1-remote.md`, is otherwise unchanged.

Ledger: D1 — PASS — `# tests 145` / `# pass 145` / `# fail 0` / `# skipped 0` (Linux; (j), (k), (l) and (q) run here)
Ledger: D2 — PASS — `manifest up to date (115 files)`
Ledger: D3 — PASS — `67 identical, 34 changed (E03, E06, E11, E12, E17, E15, P1, E02), 14 added (E02, E06, E15, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-45` ×1, one `| PR-45 |` row, `includes` → `true`
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true true`
Ledger: D7 — PASS — `node --check` is clean; `bash -n run-agent.sh` exits 0
Ledger: D8 — PASS — run `40015704664` on `f6277a7`, attempt 1: `checks` (actionlint), `test (ubuntu-latest)`, `test (windows-latest)` success

Scope: in the fence (v2), including the `devos-setup.yml` presence list that the secrets guard requires.
Method (payload changes only): the non-waivable rules, PR-45 and the manual are as checked in `E17-a1-remote.md`. The three a2 changes weaken nothing.
Owner attention:
- (1) **No real runs on GitHub yet** for Codex or Gemini, as builder or reviewer. E21 needs an `OPENAI_API_KEY` or a `GEMINI_API_KEY` for those runs.
- (2) **The order you approved on 2026-10-23 is now in the ledger:**
  - E18: the catalogue, the documents-to-prepare list, and the monitoring module;
  - E20: the scaffold, with a logger and a health route;
  - E23 is split: E23a is the basic kit (Context7 for all four tools, and stack skills) right after E18; E23b is the full skills pack for each layer, with the UI/UX references.

Commit message: E17: Codex and Gemini in the GitHub cycle — run-agent.sh, agent-cli.mjs, role kits, accounts, CLI install, setup items (PR-45) — PASS a2
Next prompt: dev/fences/E18.md
