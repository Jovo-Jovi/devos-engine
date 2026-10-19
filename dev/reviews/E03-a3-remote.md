REMOTE: MERGE
Fetched: origin/task/E03 @ affd7cf (base main @ 2a6f63e) · Node v22.22.0 · sources: devos-control-tower @ a49ca6d, devos-pilot @ 4ccbef7 (own clones) · Commands run: node --test "test/*.test.mjs"; node tools/build-manifest.mjs --check; node tools/verify-source.mjs --tower ../devos-sources/tower; node tools/find-specifics.mjs --check; git diff 1e8fbba affd7cf (every line); widened payload search (reference project, control-, devos-plan, M0 capacity, T01's review, TM01, OAuth app); deep-equal of the seven setup items against the pilot's.

Attempt 3 is the text-only fix of `dev/reviews/E03-a2-remote.md` and nothing else. D1 `# pass 28 / # fail 0` (the new no-broken-phrases test included); D2 `manifest up to date (104 files)`; D3 `82 identical, 19 changed (E03, E02), 3 added (E02), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; D4 `0 0`, allow-list `[]`, `dev/E01-specifics.md` unchanged at `Total: 52 lines in 19 files`.

Findings 1–6 of the a2 remote review are resolved: AUTOMATION §8 explains `DEVOS_PRODUCTION_URL` by the smoke test, the webhook secret and the `DEVOS_GITHUB_APP` row are gone, the art-script and inactive-module notes are neutral; `cursor`, `claude`, `pat-method`, `vercel`, `supabase-secrets`, `supabase-var`, `supabase-vercel` deep-equal the pilot's items; `setup.json` is back to the source style (one-line `names`/`when`); PRECEDENTS has no pin and no private plan reference; the new-project command and FULLSTACK no longer point at a project the developer cannot see.

Residual wording (not blocking, logged as follow-ups): `devos-new-project.md` now reads "Copy the copied `.claude/settings.json` last" — my fence's replacement text, rewritten anyway when E06 replaces the new-project flow; PRECEDENTS PR-26 Born-from still says "the reference project" in its own sense (the first project), to be swept with the release wording check in E10.

Merge: squash into `main` with `E03: Generalize the Tower-specific lines into project settings; module setup items from the pilot — PASS a3`.
Next prompt: dev/fences/E04.md (v2) — re-check on its own branch before the Cursor run.
