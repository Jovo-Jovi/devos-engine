# devos-engine — ledger

Only the reviewer writes *Done* and *Verdict* (after `/engine-review`). The owner commits on PASS. Risk 3 = deep
review (Opus) and the owner reads the verdict before committing. Plan: `dev/PLAN.md` §12.

| Task | Name | Risk | Gate | Fence | Done | Verdict |
|---|---|---|---|---|---|---|
| E01 | Repository, verbatim payload, manifest, version | 2 | — | v2 | [x] | PASS a1 — dev/reviews/E01-a1.md |
| E02 | Config split: engine defaults + project file → generated config; `guard:config` | 3 | owner | v3 | [x] | PASS a1 — dev/reviews/E02-a1.md |
| E03 | Generalize the Tower-specific lines into project settings; module setup items from the pilot | 3 | owner | v4 | [x] | PASS a3 — dev/reviews/E03-a3.md · remote MERGE — dev/reviews/E03-a3-remote.md |
| E04 | `devos` command: doctor, status, developer profile, version, agent roster (PLAN §7a) | 2 | — | v4 | [x] | PASS a1 — dev/reviews/E04-a1.md |
| E11 | Agents in the runner: project `agents` config, reviewer picks the builder from the pool, any model per role (same tool per role) (PLAN §7a) | 3 | owner | v2 | [x] | PASS a1 — dev/reviews/E11-a1.md · remote MERGE — dev/reviews/E11-a1-remote.md |
| E12 | Cross-role agents: Claude Code as builder, Cursor as reviewer (verdict from the review file, PR-21) (PLAN §7a) | 3 | owner | v8 | [x] | PASS a3 — remote review of record (no local review: session limit) — dev/reviews/E12-a3-remote.md · FAIL a2 — dev/reviews/E12-a2.md · FAIL a1 — dev/reviews/E12-a1.md |
| E13 | Engine CI: on every push of `main` and `task/*` run `node --test`, parse every payload workflow with a real YAML parser, run actionlint (engine root `.github/`, not shipped) | 2 | — | v1 issued | [ ] | — |
| E05 | `install` and `upgrade` (three-way, branch + PR, conflicts listed) | 3 | owner | fence on PASS of E13 | [ ] | — |
| E06 | `init` part 1: contract, questions, blueprint through Claude Code, doc templates | 2 | owner | fence on PASS of E05 | [ ] | — |
| E07 | `init` part 2: repository, secrets by name, variables, `SETUP.md`, first cycle | 3 | owner | fence on PASS of E06 | [ ] | — |
| E08 | UI/UX gate: design contract, required spec, axe check, missing evidence = FAIL, pinned design skills, resource catalogue (PLAN §10) | 3 | owner | fence on PASS of E05 | [ ] | — |
| E09 | Registry link: `report.mjs`, report steps, registration, cycle preflight | 3 | owner | fence on PASS of E07 and E08, after Tower TR1–TR2 | [ ] | — |
| E10 | Clean-machine run, docs, license, v1.0.0 | 2 | owner | fence on PASS of E09 and decision D-E4 | [ ] | — |

## Ports (Tower method changes after `a49ca6d` to carry into the payload)

| Tower commit | What changed | Engine task |
|---|---|---|
| `94db2b6` · `89d007c` · `93fe912` | builder streaming (PR-37), 10-minute builder report, staged fences with helper agents (PR-38) | absorbed: pin moved to `a49ca6d` on 2026-10-19, before E01 |

## Tower tasks this plan waits for

| Id | Name | Where | State |
|---|---|---|---|
| TR1 | Registry: claims, App installation binding, acceptance records, unique keys, receipt route | `devos-control-tower` (change request after T11) | not filed |
| TR2 | Ingestion for registered developer projects; disconnect on uninstall; Registered projects view | same | not filed |

## Follow-ups from reviews

| From | Item | Lands in |
|---|---|---|
| E03 a2 remote | The shipped handbook names the client project NEL / Nile Egypt Labs as its case study — owner decides if public; recommended: anonymize, add NEL/Nile/devos-plan to the release-check patterns | E10 (owner decision first) |
| E03 a2 remote | Prompts, workflows and engine defaults cite the reference project's OD numbers (OD-02…OD-08) | E06 |
| E03 a2 remote | `vercel-bypass` is recommended even when `deploy.bypass` is false — gate it on the setting | E07 |
| E03 a3 remote | `devos-new-project.md` reads "Copy the copied `.claude/settings.json` last" (fence wording) | E06 |
| E03 a3 remote | PRECEDENTS PR-26 Born-from still says "the reference project" — sweep with the release wording check | E10 |
| E04 a1 remote | `run()` passes a `.cmd` path to the shell unquoted; a path with a space breaks on Windows — quote it when `viaShell` | done in E12 a3 (`which.run` quotes the path) |
| E11 a1 remote | Reviewer-tool stop runs after the heartbeat starts | done in E12 (the stop is gone) |
| E11 a1 remote | AUTOMATION §4 calls `builder-model.mjs` "Grok model id" | done in E12 a3 |
| E12 a1 remote | Claude builder progress judged by tree/CPU only (json output); move to `stream-json --verbose` and adjust the usage parser | after E12 (v1.1 candidate) |
| E12 a3 remote | `which.run` quotes a `.cmd` path but not its arguments under `shell: true`; a spaced argument breaks on Windows | E05 (install passes paths) |
