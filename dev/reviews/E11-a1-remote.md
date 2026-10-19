REMOTE: MERGE
Fetched: origin/task/E11 @ 17fc770 (base main @ 939052f) · Node v22.22.0 · sources: devos-control-tower @ a49ca6d (own clone) · Commands run: node --test "test/*.test.mjs"; node tools/build-manifest.mjs --check; node tools/verify-source.mjs --tower ../devos-sources/tower; node tools/find-specifics.mjs --check; git diff main...HEAD on every payload file; lib.mjs `emit` (stdout and GITHUB_OUTPUT); render-prompt roles that receive `commonVars`; the reviewer step's existing outputs (no `reviewer_*` collision).

D1 `# pass 32 / # fail 0`, names `agents.test.mjs`; D2 `manifest up to date (105 files)`; D3 `79 identical, 22 changed (E03, E11, E02), 4 added (E02, E11), 2 removed (E03) — …@a49ca6d`; D4 `0 0`. The defaults reproduce today exactly (claude-opus-5-5 deep, claude-sonnet-5-5 light, one `cursor-grok` pool item). The workflow diff only adds the `ag` step, the tool checks and the family export: the `agent -p` and `claude -p` lines, flags, account loops, watchdog and `devos_limited` are untouched. `builder-model.mjs` and `review-mode.mjs` changes are the minimal ones the fence named; gate and method reviews still take `reviewer.gate_model`. The four prompts name `<pool id>` and receive `{{BUILDER_POOL}}`; intake and method render through `commonVars`, so the variable reaches them. The reviewer-tool check parses `agents.mjs` stdout, which `emit` always prints, so it works on GitHub too.

Follow-ups (ledger, E12): the reviewer-tool stop sits after the heartbeat starts (harmless now; E12 removes the stop); AUTOMATION §4 still describes `builder-model.mjs` as "Grok model id" — say "the builder model id from the pool item's family".

Process note for the owner: E11 is risk 3. The local review must be Claude Code with Opus (`/model`), not Cursor; if `dev/reviews/E11-a1.md` was written by Grok, this remote review is the deep review of record.

E12 fence v1 (written by the local review on this branch) is replaced by v2 in this commit: role kits so each tool gets the role's rules and permissions when it takes the other role, and the exact Claude builder flags. See its header.

Merge: squash into `main` with `E11: Agents in the runner: project agents config, reviewer picks the builder from the pool, any model per role (same tool per role) (PLAN §7a) — PASS a1`.
Next prompt: dev/fences/E12.md (v2) on a new branch `task/E12`.
