VERDICT: PASS — MERGE
Fetched: task/E15 @ 905a136 (clean tree), main @ 774eed5 (E07) · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower` (clone at the pin `a49ca6d`), `node tools/find-specifics.mjs --check`, the D5 Buffer compare (plus `blueprint.md`), a staged install with the fixture docs + `run-all.mjs`, `node bin/devos.mjs agents detect`, `git grep -n 'secret", "set"' -- lib`, `node --check` on every changed `.mjs`, `gh run view 39935699610`, a real pseudo-terminal run of the keys step (below), `git diff main...HEAD` read for every `lib/` and payload file · Refused calls: none

Review of record for E15 attempt 1 (risk 3, method change). The local review was skipped by the owner to save tokens.

**Stage 1 — payload and method.**
- P1: `supervisor.mjs` is byte-identical to the Tower's @ `02564ef`, and the AUTOMATION/PRECEDENTS text carries both Tower changes.
- `blueprint.md` and the contract (`0-draft-2`) equal their fence sources.
- `setup.json` has `tool:cursor` / `tool:claude`, and `setup-check.mjs` has `toolsInUse`, including the method-fix rule (PR-28).
- The `cursor-blueprint` kit has 10 allow and 21 deny entries.
- AUTOMATION §4/§8, PR-44 and provenance are in place.

**Stage 2 — the Engine B ports.** `lib/spawn.mjs`, `accounts.mjs`, `probes.mjs`, `adapters.mjs` and `data/tools.json` are ported. `which.run` keeps its interface and uses `runToolSync` for `.cmd`.

**Stage 3 — `init`.**
- The gh preflight runs before the contract.
- Agent menus cover every tool, with the blueprint agent limited to signed-in local tools; strengths go into the pool `note`.
- Attached documents are allowed: up to 8 files of at most 200 KB each, of the listed text types.
- `project.json` `agents` and `blueprint_agent` are written; three files are held back.
- The blueprint runs on the chosen tool, and the Cursor kit is installed during it.

**Stage 4 — keys.**
- `neededKeys` follows the agents and deploy target.
- Hidden input goes into a `Map` that is cleared on every path.
- The plan is shown, then `Create it now?`.
- Each key is uploaded with `gh secret set` and `input:`.

Ledger: D1 — PASS — `# tests 114` / `# pass 114` / `# fail 0` (Linux); `agents-kit.test.mjs` 22 cases; init (m)–(r), setup (s)–(u), kit (v) all `ok`
Ledger: D2 — PASS — `manifest up to date (112 files)`
Ledger: D3 — PASS — `69 identical, 32 changed (E03, E06, E11, E12, E15, P1, E02), 11 added (E02, E06, E15, E12, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D4 — PASS — `0 0`
Ledger: D5 — PASS — `Live maximum: PR-44` ×1, one `| PR-44 |` row, the P1 sentence present; Buffer compare `true true true` (supervisor, contract, blueprint)
Ledger: D6 — PASS — staged `run-all.mjs` exit 0, `guard:manual PASS (97 names checked)`
Ledger: D7 — PASS — `agents detect` → 6 entries (`cursor claude codex gemini muse glm`) = `lib/data/tools.json` tools (6)
Ledger: D8 — PASS — only `lib/setup.mjs:237 run("gh", ["secret", "set", key.name, "--repo", slug], { … input: value … })`
Ledger: D9 — PASS — `node --check` clean
Ledger: D10 — PASS — run `39935699610` on `905a136`, attempt 1: `test (ubuntu-latest)`, `test (windows-latest)`, `checks` success
Ledger: D11 — MOVED to E21 (owner, 2026-10-23: "mark D11 as moved to E21, the final end-to-end test")

**A real terminal test of the keys step** (Linux, `pty.fork()`).
- **Setup:** `devos init --continue` on an approved project, with a fake `gh` that logs only the length of what it reads on stdin. Typed `cursorvalue1` and `claudevalue22`, Enter three times for the optional Vercel keys, then Enter at `Create it now?`.
- **The screen** showed `************` and `*************`, never the values. The plan line read `Keys to upload: CURSOR_API_KEY, CLAUDE_CODE_OAUTH_TOKEN; to set later: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID`.
- **The confirmation** received the real Enter: no typed value leaked into the line reader.
- **The fake `gh`** logged:
  - `secret set CURSOR_API_KEY --repo devtest/demo-shop` and `STDIN CURSOR_API_KEY len=12`;
  - `secret set CLAUDE_CODE_OAUTH_TOKEN …` and `len=13`;
  - no value in any argument.
- **`grep -rl`** of both values over the project and the home folder: nothing.
- **The run ended** `devos init: devtest/demo-shop is set up; devos-cycle dispatched`.

Scope: in the fence (43 files; no workflow, no runner logic of the cycle).
Method: PR-44 at the next id; P1 (PR-36 text) ported; `guard:manual` passes; no non-waivable rule is weakened. Secrets are never in files, git stays the runner's, and the human gates are unchanged.

Owner attention — defects to fix in E16 (none blocks this merge for the owner's own use):
- (1) **The GitHub-role menus offer tools the cycle cannot run yet.** Codex, Gemini, Muse and GLM can be picked as reviewer or builder. The payload's `agents.mjs` and `lib/roster.mjs` accept only `cursor`/`claude`, so such a `project.json` stops the first cycle run, and the roster save fails. This is the fence's own gap: v2 said "keep the choice with a note". **Until E17: pick Claude Code or Cursor for every GitHub role.** E16 S1 restricts those menus.
- (2) **The Codex and Gemini blueprint flags are unproven.** Their documentation shows that `codex exec` needs `--sandbox workspace-write` (or `--full-auto`) to write files, and Gemini headless needs an approval mode such as `--yolo`. E16 S2 fixes both.
- (3) **Hidden input reads one line per key.** A multi-line value (a service-account JSON) would break. No such key is asked today; E18 adds module keys and must handle it.
- (4) **The doctor's fix line is wrong for a rejected token.** It prints `gh auth refresh … -s repo,workflow` where `gh auth login` is the fix (E16 S1).
- (5) Windows hidden input and the real GitHub run are E21 D-final.

Commit message: E15: agents and keys — any tool and model per role, gh preflight, attached documents, blueprint on the chosen agent, keys typed once, P1 port (PR-44) — PASS a1
Next prompt: dev/fences/E16.md
