# devos-engine — ledger

Only the reviewer writes *Done* and *Verdict* (after `/engine-review`). The owner commits on PASS. Risk 3 = deep
review (Opus) and the owner reads the verdict before committing. Plan: `dev/PLAN.md` §12.

| Task | Name | Risk | Gate | Fence | Done | Verdict |
|---|---|---|---|---|---|---|
| E01 | Repository, verbatim payload, manifest, version | 2 | — | v2 | [x] | PASS a1 — dev/reviews/E01-a1.md |
| E02 | Config split: engine defaults + project file → generated config; `guard:config` | 3 | owner | v3 issued | [ ] | — |
| E03 | Generalize the Tower-specific lines into project settings; module setup items from the pilot | 3 | owner | fence on PASS of E02 | [ ] | — |
| E04 | `devos` command: doctor, status, developer profile, version | 2 | — | fence on PASS of E03 | [ ] | — |
| E05 | `install` and `upgrade` (three-way, branch + PR, conflicts listed) | 3 | owner | fence on PASS of E04 | [ ] | — |
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
