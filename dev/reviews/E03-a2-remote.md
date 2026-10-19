REMOTE: FIX
Fetched: origin/task/E03 @ 60cbd7b (base main @ 2a6f63e) · Node v22.22.0 · sources: devos-control-tower @ a49ca6d, devos-pilot @ 4ccbef7 (own clones) · Commands run: node --test "test/*.test.mjs"; node tools/build-manifest.mjs --check; node tools/verify-source.mjs --tower ../devos-sources/tower; node tools/find-specifics.mjs --check; git diff main...HEAD (every payload line); a widened search of payload/ for devos-plan, control-, NEL, OD-nn, "reference project"; a deep-equal of shipped setup items against the pilot's.

Mechanics are right and stay: D1 `# pass 27 / # fail 0`; D2 `manifest up to date (104 files)`; D3 `82 identical, 19 changed (E03, E02), 3 added (E02), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; D4 `0 0`, allow-list `[]`, `dev/E01-specifics.md` still `Total: 52 lines in 19 files`. Guards, probe, doctor, deploy workflow, defaults and fixtures read correctly.

What fails is the text a developer will read. S7's word-for-word substitution (fence defect, shared with the builder who applied it inside identifiers) made the scan reach zero while leaving sentences that are wrong or meaningless, and S5 kept Tower-only setup steps. The local verdict saw two of these and still passed; they are material because these files ship.

Findings (all in payload/files):
1. docs/method/AUTOMATION.md §8 — `reference project.url` and `devos-control-reference project` (twice) are broken identifiers; "installed on the reference project and the reference project" is meaningless; the `GITHUB_WEBHOOK_SECRET` bullet and the `DEVOS_GITHUB_APP` row describe a Tower-only App that no shipped workflow or setup item uses (`vars.DEVOS_GITHUB_APP` appears in no workflow or script); the `DEVOS_PRODUCTION_URL` bullet still explains the Tower's OIDC audience.
2. docs/method/AUTOMATION.md — "`scripts/scene/art.mjs` is product code of the reference project (T04)…" describes a Tower product script that does not ship; "(the storage and Firestore modules are inactive in the reference project…)" describes the Tower.
3. devos/setup.json — `vercel` step 3 says "Do NOT create a Protection Bypass for Automation secret (the no-bypass policy)" right before the new `vercel-bypass` item that recommends one; `vercel` step 1 "verify by name in T01's review" and `supabase-secrets` step 1 ("after the M0 capacity check…", "GitHub ON with the reference project's GitHub OAuth app…, Email OFF") are the Tower's own choices; `pat-method` mentions "(TM01)". The pilot's versions of these seven items are neutral and pattern-free (checked).
4. devos/setup.json — the whole file was re-serialized (one-line `names`/`when` arrays expanded), against the builder rule "never reformat a file"; it inflates every future upgrade diff.
5. docs/method/PRECEDENTS.md — header "(`the reference repository` @ `4ccbef7`)" and PR-01 ("Every M1 task of the reference project … (`devos-plan` `plan/M1.md` §3)", Born-from "(NEL §16.5) … (`devos-plan` @ `1a3c2a9`, `the B0 bootstrap plan` §3.4)") ship private plan references.
6. .claude/commands/devos-new-project.md and FULLSTACK_MODULE.md — "not in the reference project", "copy the reference project's method files", "reference project's `.claude/settings.json`" no longer say anything a developer can act on.

Fix = fence v4, Attempt 3 focus (text only; no code, test or manifest logic changes beyond the rebuild).

Owner attention (not E03 scope; recorded in the ledger as follow-ups):
- The shipped handbook `docs/method/DEV_OS_V2_REVIEWER.md` names your client project NEL / Nile Egypt Labs as its case study (lines 6, 386, 410, 895). Decide before E10 whether that may be public; my recommendation is to anonymize it ("a bilingual client project") and add NEL/Nile/devos-plan to the release-check patterns.
- Prompts, workflows and engine defaults cite `OD-02…OD-08`, which are the Tower's decision numbers; a new project's ODs mean other things. E06 (doc templates) should replace them with the rule they stand for.
- `vercel-bypass` is recommended whenever `DEVOS_VERCEL` is set, even with `deploy.bypass` false; E07 (setup generation) should gate it on `deploy.bypass`.

Next prompt: dev/fences/E03.md (v4, Attempt 3 focus). Merge only after attempt 3 passes the local review and a remote MERGE.
