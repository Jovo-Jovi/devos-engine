# devos-engine — decisions

The owner's decisions for the Engine. The full record, with the history behind each row, is
`devos-plan/seed/05-decisions.md` (rows 2, 4, 6–8) and `devos-plan/plan/engine/00-ENGINE-PLAN.md` §1.

| Id | Decision | Date |
|---|---|---|
| D-E1 | The Engine starts now, in parallel with the Tower's open tasks. The method is frozen at `devos-control-tower` @ `a49ca6d`; later Tower method fixes are ported as engine tasks (ledger *Ports*). | 2026-10-18 |
| D-E2 | Free first; paid tiers later, after reach. | 2026-10-18 |
| D-E3 | Accepting the contract is required to use DEV_OS. Declining stops setup. Nothing is sent before acceptance. Per-step reporting never blocks a run. | 2026-10-18 |
| D-E4 | **Open — before E10:** the license. Recommendation: source-available (free use for one's own projects; no redistribution, resale or hosting as a service), reviewed by a lawyer. Until then: all rights reserved. | — |
| D-E5 | One `devos` command (plain Node, no dependencies) run with `npx` from the GitHub repository; a ZIP per release; engine files installed with a manifest; `devos upgrade` is a reviewable pull request. | 2026-10-18 |
| D-E6 | Other people's projects are seen by contract only: registration through the GitHub App installed on the project's repository. No anonymous ping, no manifest search. | 2026-10-18 |
| D-E7 | v1 scope: new projects from scratch (Next.js, with the existing Supabase, R2 and Firebase modules), automated workflow on GitHub, UI/UX gate as a hard gate. Later: adopting existing or production projects, the local runner, more stacks. | 2026-10-18 |
| D-E8 | Toward developers the dashboard is never named: the contract speaks of the **DEV_OS registry, operated by Jovo-Jovi**, and states exactly what each event contains. | 2026-10-18 |
| D-E9 | **One place for changes.** From 2026-10-19 every engine change — plan, decisions, fences, reviews, code — is made in this repository only. `devos-plan` is no longer updated for the Engine; `dev/PLAN.md` here is the plan of record. | 2026-10-19 |
| D-E10 | **The released engine is a clean repository.** The public `devos-engine` that developers take from contains only the product: `bin/`, `lib/`, `payload/`, the engine's own tests, README, LICENSE, CHANGELOG. No build history (`dev/`), no source pins or extraction tools that name other repositories, no fixtures of other projects, no references to the reference projects. Rules in `dev/RELEASE.md`; enforced in E10. | 2026-10-19 |
