VERDICT: PASS — MERGE
Fetched: task/E23a @ cb60e9f (clean tree), main @ a4564a9 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 counts and `includes` check, the D5 staged guards, the six D6 Buffer compares, `node --check` on every changed `.mjs`, `bash -n run-agent.sh`, `gh run view 40023650529`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E23a a1 (risk 3, a method change; the review of record), against fence v2. I read every changed line in `lib/`, `payload/`, `tools/` and `test/`.
- **The scope menu.** It follows the modules, offers `mvp` and `full` with the default first, writes `scope` after `modules`, and prints `Scope:` in the summary.
- **The three prompts** match their fence copies byte for byte.
- **Claude Code.** Its two builder lines and its reviewer command each gain `mcp__context7` in `--allowedTools` and `--mcp-config devos/ci/mcp.claude.json`, and nothing else on those lines changes.
- **The Cursor reviewer.** It copies `mcp.ci.json` after the swap and removes it after the restore. The file is gitignored, so `role-env`'s check is unaffected.
- **Codex and Gemini.** Codex gets the `mcp_servers.context7.url` pair, and Gemini's `run-agent.sh` copies `settings.json` into `$HOME/.gemini`.
- **The record.** The PR-47 row is in place, the `AUTOMATION.md` MCP row is updated, and the provenance is exact.

Ledger: D1 — PASS — `# tests 160` / `# pass 160` / `# fail 0` / `# skipped 0` (Linux); (r), (s) and (t) present
Ledger: D2 — PASS — `manifest up to date (117 files)`
Ledger: D3 — PASS — `67 identical, 34 changed (E03, E06, E11, E12, E17, E23a, E15, P1, E18, E02), 16 added (E23a, E02, E06, E15, E18, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-47` ×1, one `| PR-47 |` row, `includes` → `true`
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true true true true true true`
Ledger: D7 — PASS — `node --check` is clean; `bash -n run-agent.sh` exits 0
Ledger: D8 — PASS — run `40023650529` on `cb60e9f`, attempt 1: `checks` (actionlint), `test (ubuntu-latest)`, `test (windows-latest)` success

Scope: in the fence (v2).
Method (payload changes only):
- **Non-waivable rules hold.** Human gates and PR-28 are unchanged. The surfaces are unchanged: MCP files are gitignored or live in `$HOME`. A red check still overrides PASS. No secret is involved, because Context7 needs no key, and the runner still owns git.
- **The only new permission is `mcp__context7`**, a read-only documentation server.
- **The record.** PR-47 is at the live maximum and the manual is updated. There are no new scripts, variables, labels or commands, so the count stays at 101 names.
Owner attention:
- (1) **Context7 and the new rules are untested with real CLIs.** That covers Context7 across the four tools, the lean and scope rules in a real blueprint, and `docs/STACK.md`. E21's real run proves them.
- (2) **Your choice of next task, 2026-10-24: E19.** That is more stacks, and checks that follow the stack.

Commit message: E23a: basic kit — scope choice (MVP or full product for production), lean by default, docs/STACK.md, Context7 for every agent tool (PR-47) — PASS a1
Next prompt: dev/fences/E19.md
