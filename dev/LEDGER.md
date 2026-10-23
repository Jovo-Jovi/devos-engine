# devos-engine — ledger

Only the reviewer writes *Done* and *Verdict*, after the remote check (the review of record since 2026-10-23; the local
`/engine-review` is optional). The owner merges on MERGE. Risk 3 = deep review (Opus) and the owner reads the verdict
before merging. Plan: `dev/PLAN.md` §12.

| Task | Name | Risk | Gate | Fence | Done | Verdict |
|---|---|---|---|---|---|---|
| E01 | Repository, verbatim payload, manifest, version | 2 | — | v2 | [x] | PASS a1 — dev/reviews/E01-a1.md |
| E02 | Config split: engine defaults + project file → generated config; `guard:config` | 3 | owner | v3 | [x] | PASS a1 — dev/reviews/E02-a1.md |
| E03 | Generalize the Tower-specific lines into project settings; module setup items from the pilot | 3 | owner | v4 | [x] | PASS a3 — dev/reviews/E03-a3.md · remote MERGE — dev/reviews/E03-a3-remote.md |
| E04 | `devos` command: doctor, status, developer profile, version, agent roster (PLAN §7a) | 2 | — | v4 | [x] | PASS a1 — dev/reviews/E04-a1.md |
| E11 | Agents in the runner: project `agents` config, reviewer picks the builder from the pool, any model per role (same tool per role) (PLAN §7a) | 3 | owner | v2 | [x] | PASS a1 — dev/reviews/E11-a1.md · remote MERGE — dev/reviews/E11-a1-remote.md |
| E12 | Cross-role agents: Claude Code as builder, Cursor as reviewer (verdict from the review file, PR-21) (PLAN §7a) | 3 | owner | v8 | [x] | PASS a3 — remote review of record (no local review: session limit) — dev/reviews/E12-a3-remote.md · FAIL a2 — dev/reviews/E12-a2.md · FAIL a1 — dev/reviews/E12-a1.md |
| E13 | Engine CI: on every push of `main` and `task/*` run `node --test`, parse every payload workflow with a real YAML parser, run actionlint (engine root `.github/`, not shipped) | 2 | — | v1 | [x] | PASS a1 — remote review of record (no local review: session limit) — dev/reviews/E13-a1-remote.md |
| E05 | `install` and `upgrade` (three-way, branch + PR, conflicts listed) | 3 | owner | v2 | [x] | PASS a2 — dev/reviews/E05-a2.md · remote MERGE — dev/reviews/E05-a2-remote.md · remote FIX a1 — dev/reviews/E05-a1-remote.md |
| E06 | `init` part 1: contract (typed accept), questions, install, blueprint through Claude Code, approval; OD citations out of the payload (PR-43) | 3 | owner | v2 issued (v1 not issuable — E05-a2-remote.md) | [x] | PASS a1 — dev/reviews/E06-a1.md · remote MERGE — dev/reviews/E06-a1-remote.md |
| E07 | `init` part 2: repository, secrets by name, variables, `SETUP.md`, first cycle | 3 | owner | v4 | [x] | PASS a2 — dev/reviews/E07-a2.md · remote MERGE — dev/reviews/E07-a2-remote.md · D8 moved to E15 D11 (v4) · PASS a1 — dev/reviews/E07-a1.md · remote a1 — dev/reviews/E07-a1-remote.md |
| P1 | Port the Tower's two supervisor fixes (PR-36): re-run a deploy an outside service broke; close finished requests | 2 | owner | folded into E15 v2 Stage 1 | [x] | done in E15 a1 — dev/reviews/E15-a1-remote.md |
| E15 | Agents and keys: any tool and model per role with strengths, gh scope preflight, attached documents, blueprint on the chosen agent, `project.json` agents, credentials by tool, all keys typed once (memory → `gh secret set` stdin), confirm before GitHub (PR-44); P1 port | 3 | owner | v2 | [x] | PASS a1 — remote review of record (local skipped by the owner) — dev/reviews/E15-a1-remote.md · D11 moved to E21 (owner) |
| E16 | Safe long runs (heartbeat, Ctrl-C kills the tree), `devos continue` checklist, adopt an empty existing repository (never overwrite), GitHub-role menus limited to cycle tools, Codex/Gemini blueprint flags, doctor fix line | 3 | owner | v3 | [x] | PASS a2 — remote review of record — dev/reviews/E16-a2-remote.md (a1 FIX: dev/reviews/E16-a1-remote.md) |
| E17 | Cycle runs Codex and Gemini too: `agents.mjs tools`, accounts, `agent-cli.mjs` (args, normalize), role kits per tool, `run-agent.sh`, CLI install in the workflow, setup items; picking by strength already done in E15 (method change, PR-45) | 3 | owner | v2 | [x] | PASS a2 — remote review of record — dev/reviews/E17-a2-remote.md (a1 FIX: dev/reviews/E17-a1-remote.md) |
| E18 | Catalogue: project type, stack the method runs, a provider per module (database, storage, auth, payments, email, jobs, search, product AI, hosting, observability); documents to prepare; module keys typed once (file keys by path); blueprint plans providers and observability (method change, PR-46) | 3 | owner | v1 issued | [x] | PASS a1 — remote review of record — dev/reviews/E18-a1-remote.md |
| E23a | Basic kit, right after E18 (owner, 2026-10-23): scope choice at init (MVP, or full product for production — owner 2026-10-23); lean by default (blueprint builds what the brief asks, nothing cut or added, simplest architecture, a cited need for every layer and dependency, `docs/STACK.md`; builders justify every dependency; reviewers fail what a fence does not need); Context7 for Claude Code, Cursor (builder and reviewer), Codex and Gemini in the cycle (method change, PR-47) | 3 | owner | v2 | [x] | PASS a1 — remote review of record — dev/reviews/E23a-a1-remote.md |
| E19 | Checks follow the stack: catalogue stacks gain toolchain, manifest and commands (all 20 run); `devos/project.json` `stack`; `run-checks.mjs` runs `stack.commands` for Python (uv), Go and Dart (Flutter), Node unchanged; toolchain setup in the cycle and `ci.yml`; non-Node stacks offer no Supabase, R2, Firebase or Vercel yet (method change, PR-48; owner chose it next, 2026-10-24) | 3 | owner | v2 | [x] | PASS a2 — remote review of record — dev/reviews/E19-a2-remote.md (a1 FIX: dev/reviews/E19-a1-remote.md) |
| E20 | T01 is the scaffold: a recipe per stack (`stack.scaffold`: generator, health route, logger, test runner, architecture rule); T01 builds no feature, wires the five check commands, one structured logger, error handling, health route, one architecture test, and passes only on green checks; Stage 0 drops E19's ignored-file deletion (method change, PR-49) | 3 | owner | v1 issued | [x] | PASS a1 — remote review of record — dev/reviews/E20-a1-remote.md |
| E22a | Guided UI part 1: plan mode (`devos init --plan`), `buildAnswers`/`validatePlan` shared with the terminal, `::devos-ask`/`::devos-step` markers (DEVOS_UI=1), a local server on 127.0.0.1 with a per-run token, Host and Origin checks, CSP, SSE progress, answers and keys relayed to the run, Stop; `devos ui` | 3 | owner | v1 issued | [ ] | — |
| E22b | Guided UI part 2: the page — Engine B's look and animations ported onto the E22a API (contract, agents, type/stack/modules/scope, project, documents upload, summary, live blueprint, approve or change, keys, GitHub plan, done); terminal fallback | 2 | owner | fence on PASS of E22a | [ ] | — |
| E08 | UI/UX gate part 1: design contract, design specification + `guard:design-spec`, `DESIGN_METHOD.md`, resource catalogue (PLAN §10 items 1, 2, 7; PR-44) | 3 | owner | v1 issued — re-rehearse before it runs (E17 took PR-45, E18 PR-46, E23a PR-47, E19 PR-48 and E20 PR-49, so its precedent becomes PR-50; manifest and provenance counts move) | [ ] | — |
| E14 | UI/UX gate part 2: missing evidence = failed check, axe `a11y` on every capture, vendored pinned design skills, objective/subjective verdict (PLAN §10 items 3–6) | 3 | owner | proposed (owner to confirm the split and the skills licence); fence on PASS of E08 | [ ] | — |
| E23b | Expert pack: skills and references for each layer (design: Lenis, GSAP, React Bits and the owner's references; middleware, backend, database, security) for every agent tool, at blueprint and in the cycle | 3 | owner | fence after E14 (owner order, 2026-10-24) | [ ] | — |
| E21 | First green run: watch the dispatched run, diagnose from its log, `verify`/`fix`/`watch`; the real end-to-end run on two stacks — includes E15 D11 (Windows hidden input, real keys, real repository) | 3 | owner | after every other task, right before the Tower link (owner, 2026-10-24: no real end-to-end run before then) | [ ] | — |
| E09 | Registry link: `report.mjs`, report steps, registration, cycle preflight | 3 | owner | fence on PASS of E07 and E08, after Tower TR1–TR2 | [ ] | — |
| E10 | Clean-machine run, docs, license, v1.0.0 | 2 | owner | fence on PASS of E09 and decision D-E4 | [ ] | — |

## Ports (Tower method changes after `a49ca6d` to carry into the payload)

| Tower commit | What changed | Engine task |
|---|---|---|
| `94db2b6` · `89d007c` · `93fe912` | builder streaming (PR-37), 10-minute builder report, staged fences with helper agents (PR-38) | absorbed: pin moved to `a49ca6d` on 2026-10-19, before E01 |
| `74d54be` | the supervisor re-runs a deploy that an outside service broke before the site moved (PR-36) | P1 |
| `02564ef` | the supervisor closes finished requests (PR-36) | P1 |

## Tower tasks this plan waits for

| Id | Name | Where | State |
|---|---|---|---|
| TR1 | Registry: claims, App installation binding, acceptance records, unique keys, receipt route | `devos-control-tower` (change request after T11) | not filed |
| TR2 | Ingestion for registered developer projects; disconnect on uninstall; Registered projects view | same | not filed |

## Follow-ups from reviews

| From | Item | Lands in |
|---|---|---|
| E03 a2 remote | The shipped handbook names the client project NEL / Nile Egypt Labs as its case study — owner decides if public; recommended: anonymize, add NEL/Nile/devos-plan to the release-check patterns | E10 (owner decision first) |
| E03 a2 remote | Prompts, workflows and engine defaults cite the reference project's OD numbers (OD-02…OD-08) | done in E06 a1 (PR-43) |
| E03 a2 remote | `vercel-bypass` is recommended even when `deploy.bypass` is false — gate it on the setting | E10 (method fix; E07 fence did not take it and froze the payload — moved in E07 a1) |
| E03 a3 remote | `devos-new-project.md` reads "Copy the copied `.claude/settings.json` last" (fence wording) | done in E06 a1 (command replaced) |
| E03 a3 remote | PRECEDENTS PR-26 Born-from still says "the reference project" — sweep with the release wording check | E10 |
| E04 a1 remote | `run()` passes a `.cmd` path to the shell unquoted; a path with a space breaks on Windows — quote it when `viaShell` | done in E12 a3 (`which.run` quotes the path) |
| E11 a1 remote | Reviewer-tool stop runs after the heartbeat starts | done in E12 (the stop is gone) |
| E11 a1 remote | AUTOMATION §4 calls `builder-model.mjs` "Grok model id" | done in E12 a3 |
| E12 a1 remote | Claude builder progress judged by tree/CPU only (json output); move to `stream-json --verbose` and adjust the usage parser | after E12 (v1.1 candidate) |
| E12 a3 remote | `which.run` quotes a `.cmd` path but not its arguments under `shell: true`; a spaced argument breaks on Windows | done in E05 a1 (S1) |
| E13 a1 remote | `role-env.test.mjs` cleanup flakes on git ≥ 2.47 (detached auto-maintenance → `ENOTEMPTY`); duplicate `git commit` in an assertion message | done in E05 a1 (S0) |
| E13 a1 remote | `dev/RELEASE.md` does not say whether the engine root `.github/` (engine CI) ships | E10 (owner) |
| E05 v1 fence | Installed projects get `devos/engine.lock.json`; neither the shipped README nor AUTOMATION §8 explains it yet | E10 (README) |
| E05 a1 remote | `compareSemver` throws on a pre-release version (`1.0.0-beta`): uncaught stack trace | E10 (release versions) |
| E05 a2 remote | `rollback()` restores all paths in one `git restore`; one path untracked in HEAD (an engine file the project ignores) makes git reject the whole list, so nothing is restored | E10 (clean-machine run) |
| E06 a1 | PLAN §3 lists the blueprint (step 5) before the engine files (step 6); `init` installs first because the blueprint reads the installed prompt and handbook | owner (amend PLAN §3) |
| E06 a1 | `keyFromName` can derive a key that fails `KEY_RE` (`X`, `!!!`, `日本`) and `init` writes it unchecked | done in E07 a1 (S2) |
| E06 a1 | `docs/method/FULLSTACK_MODULE.md:5` cites "`/devos-new-project`, step 5"; the command has no numbered steps now (the blueprint's step 5) | E10 (wording sweep) |
| E07 v1 fence | `devos/setup.json` steps cite `SETUP.md` §11.2, §12.1–§12.3, §13.1–§13.4 (the Tower's SETUP); the generated `SETUP.md` has no such sections | E10 (method wording) |
| E07 v1 fence | `vercel-var` has `when: always`, so a project with deploy `none` is told to turn Vercel on; `init` skips it, the setup issue still lists it (blocks deploy only) | E10 (method fix) |
| E06 v2 fence | The contract is a draft (`0-draft`); the deletion channel ("open an issue in the DEV_OS Engine repository") needs the owner's confirmation; legal review before v1.0.0 | E10 (owner) |
| E06 a1 remote | The automatic repair round sends the bare guard output with no instruction | done in E07 a1 (S5) |
| E07 a1 | The TTY secret hand-off (readline paused → `gh secret set` with inherited stdio) has no automated test; Linux was proved with a pseudo-terminal in the a1 remote check | E15 D11 (Windows) |
| E07 a1 remote | A project name that clashes with an existing repository stops at `repository`; `--continue` retries the same slug (way out: add the remote by hand or start again) | E10 (README) |
| ENGINE-COMPARE 2026-10-23 | Engine B (the other model's build) is not adopted as base: its cycle merges red PRs, loses ledger/fence/park state between runs and echoes secrets; its onboarding pieces are ported by E15–E22 | owner decisions D1–D7 |
| ENGINE-COMPARE owner 2026-10-23 | Expert knowledge pack: layer skills and references for every model at blueprint and during the cycle (design: Lenis, GSAP, React Bits and the owner's saved references; middleware, backend, database, security) | E23 (after E21 — a working tool first) — split (owner, 2026-10-23): E23a basic kit after E18; E23b the full pack for each layer with the UI/UX references |
| E15 a1 remote | Hidden key input reads one line per key; a multi-line value (service-account JSON) would break | E18 (module keys) |
| E15 a1 remote | GitHub-role menus offer Codex/Gemini/Muse/GLM, which the cycle refuses until E17; Codex/Gemini blueprint flags unproven; doctor fix line wrong for a rejected token | E16 S1–S2 |
