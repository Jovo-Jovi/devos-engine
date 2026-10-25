# E23b2b — research, licence audit and decisions

The reviewer's record behind the E23b2b fence. It covers the second half of the owner brief of 2026-10-25: research,
audit, select, pin, integrate and validate reusable engineering skills for any stack. Every claim below was checked on
a file that was read, at the commit given. Nothing here is legal advice.

## 1. Scope

| Task | Layers | Areas | Status |
|---|---|---|---|
| E23b2a | security, api, database, backend | security, APIs, databases | merged (`4369fda`) |
| **E23b2b** (this) | architecture, reliability (new layers), testing, ops | backend architecture, reliability, observability, testing, CI/CD | fence v1 |
| E23b4 | every layer | OWASP ASVS levels and the sharp-edges review aid, in the production-readiness gates | planned |

## 2. Method

As in E23b2a §2: find maintained sources with a named owner and a licence; pin each to a release where one exists, and
otherwise to a full commit (never a branch); read every shipped file whole, including each licence and notice; scan
for instructions to the agent, scripts, network calls, installs and links; map each file to layers, roles, a priority
and a condition; validate on several stacks. The files were copied with `git show <commit>:<path>` from clones at the
pinned commits.

## 3. Candidates and decisions

| Candidate | Pin | Licence (file) | Class | Decision |
|---|---|---|---|---|
| OWASP Cheat Sheets: CI/CD Security, Docker Security, Vulnerable Dependency Management, Microservices Security | `a8ecf45` (E23b2a's pin) | CC BY-SA 4.0 (`LICENSE.md`) | conditions | **ship**, added to `owasp-cheat-sheets` (26 sheets) |
| OWASP Denial of Service sheet | `a8ecf45` | CC BY-SA 4.0 | conditions | read whole, **not shipped** (`excluded`): placeholders for future additions, mostly network-level |
| obra/superpowers: test-driven-development (2 files), systematic-debugging (4), verification-before-completion | `v7.0.1` = `2ce8aa1` | MIT (`LICENSE`, "Copyright (c) 2025 Jesse Vincent") | free | **ship** `superpowers` |
| Other superpowers skills (worktrees, finishing a branch, planning) and the authors' evaluation files | `v7.0.1` | MIT | free | not shipped (`excluded`): they drive the agent's own git and planning |
| Playwright `docs/src/best-practices-js.md` | `v1.64.1` = `cfe490d` | Apache-2.0 (`LICENSE`, `NOTICE`) | free | **ship** `playwright-best-practices`, Node stacks only |
| Azure Architecture Center: 10 cloud design patterns | `b60c2b4` (head 2026-10-24, no tags) | CC BY 4.0 docs (`LICENSE`), MIT code (`LICENSE-CODE`), `ThirdPartyNotices` | conditions | **ship** `azure-cloud-patterns` |
| The Twelve-Factor App, 13 pages | `1385d2c` (head 2026-05-18, no tags) | MIT (`LICENSE`, "Copyright (c) 2012 Adam Wiggins") | free | **ship** `twelve-factor`; `background`, `who`, `toc` not shipped |
| GitHub docs: Actions secure use reference | `02c25d1` (head 2026-10-23, no tags) | CC BY 4.0 docs (`LICENSE`), MIT code (`LICENSE-CODE`, "Copyright 2026 GitHub") | conditions | **ship** `github-actions-security`; the `pull_request_target` page not copied in this task |
| OpenTelemetry concepts: primer, traces, logs, metrics | `bb4e55d` (head 2026-10-25, no tags) | CC BY 4.0 docs (`LICENSE`), Apache-2.0 code (`LICENSE-CODE`); no NOTICE file | conditions | **ship** `opentelemetry-concepts` |
| wshobson slo-implementation | `0874a27` | MIT | free | external: Prometheus rules for infrastructure a DEV_OS project does not run; references not audited |
| wshobson github-actions-templates | `0874a27` | MIT | free | external: pins actions to tags (`@v4`), which GitHub's reference advises against |
| Trail of Bits sharp-edges | `196a907` | CC BY-SA 4.0 | conditions | external, moved to E23b4 (a security review aid) |

The 10 patterns: Retry, Circuit Breaker, Bulkhead, Health Endpoint Monitoring, Queue-Based Load Leveling, Idempotent
Consumer, Throttling, Compensating Transaction, Strangler Fig, Anti-Corruption Layer. The 13 factors' pages plus the
introduction: intro, codebase, dependencies, config, backing-services, build-release-run, processes, port-binding,
concurrency, disposability, dev-prod-parity, logs, admin-processes.

## 4. Licence and trust audit

| Bundle | Obligations and how they are met | Trust scan |
|---|---|---|
| `owasp-cheat-sheets` (+4) | as E23b2a; `ATTRIBUTION.md` now names 26 sheets | Tool lists are examples. Links to sheets not copied do not resolve. |
| `superpowers` | MIT notice in `LICENSE`; unchanged | **Tells the agent** to delete code written before its test, ask "your human partner", check `git diff`, commit and use worktrees. The notes override each (§5). Not copied: `find-polluter.sh` (a script) and an example `.ts` file. |
| `playwright-best-practices` | Apache-2.0 in `LICENSE`, the repository's `NOTICE` beside it; the page unchanged; `LICENSE` with its CRLF line endings as LF (the repository's `.gitattributes` stores text as LF), recorded in `changes` | Suggests staging tests, `@latest` upgrades and a real sign-in. The notes override each. Images are remote links. |
| `azure-cloud-patterns` | CC BY 4.0 attribution in `ATTRIBUTION.md`; MIT in `LICENSE-CODE`; `ThirdPartyNotices` (no trademark rights) shipped unchanged | Azure product examples; links to `.yml` pages and images not copied. No instruction to the agent. |
| `twelve-factor` | MIT notice in `LICENSE`; unchanged | Text from 2011–2012 with tools of its time. No instruction to the agent. |
| `github-actions-security` | CC BY 4.0 attribution in `ATTRIBUTION.md`; MIT in `LICENSE-CODE`; unchanged | Liquid templates (`{% data variables... %}`, `reusables`, `ifversion`); the notes give the variables' values, checked in the same commit's `data/variables/product.yml`. |
| `opentelemetry-concepts` | CC BY 4.0 attribution in `ATTRIBUTION.md`; Apache-2.0 in `LICENSE-CODE`; unchanged | A site template (`signal-support-table`) that does not render; links to `/docs/...`. |

Every shipped entry has `trust.runs_code: false` and `trust.fetches: false`. Each folder keeps its own licence; DEV_OS's
commentary is in its own files (`DEVOS-NOTES.md`, origin `devos`); no protected text was rewritten into a DEV_OS file
to avoid a licence.

**Pins verified** with a script that compares each copy with `git show <commit>:<path>` at its pin: `50 same, 1
differ`. The one is Playwright's `LICENSE`, equal to the pinned file with CRLF as LF. Their sha256 (LF) matches the
manifest.

## 5. Findings and corrections

| Where | Finding | What the agents are told (`DEVOS-NOTES.md`) |
|---|---|---|
| superpowers TDD | Delete code written before its test and start over | Never delete work: a reissue keeps the earlier attempt and changes only what fails |
| superpowers (several) | Ask the human partner; check git; commit; worktrees | Open questions in the report, HALT per the STOP block; the builder never runs git |
| `condition-based-waiting.md` | The first sample calls `waitFor` with one argument; the implementation shown needs a description | Pass the description |
| `circuit-breaker.md` | AI-adjusted thresholds; the example trips on the first `429`, unlike the threshold described | Fixed, tested thresholds; read the rule, not the example |
| `anti-corruption-layer.md` | A sentence of the solution sits in "might not be suitable when" | Keep the layer to translation |
| `throttling.md`, `bulkhead.md` | Limits changed at run time | A change of limits is a fence's configuration change; never change production from a task |
| Twelve-Factor `config.md`, `admin-processes.md` | Config in the environment; one-off consoles on production | Secrets never in a repository file; no console on the live database; migrations through `devos-deploy` |
| `best-practices-js.md` | Staging tests, `@latest`, a real password typed into a site | No real services or credentials; no upgrade from a task |
| `secure-use.md` | Repository settings (Dependabot, code scanning, runner groups) | The owner's to choose; `devos-*` workflows are method files (PR-28) |
| OTel `signals/logs.md` | The structured log sample records a token, a username and an IP address | Never log tokens or secrets; personal data only when the fence needs it |
| OTel `signals/traces.md` | Older attribute names (`http.method`, `net.peer.ip`); a sample span ends four hours after it starts | Use the current semantic conventions; a typo in the sample |
| OWASP CI/CD sheet | Advises against auto-merge | DEV_OS's runner merges only a reviewed PASS with green checks; the human gate holds risk 3 |

## 6. Selection

- **Two new layers.** `architecture` (system structure, boundaries, configuration, processes, migrations between
  systems) and `reliability` (timeouts, retries, queues, idempotency, health checks, graceful failure). 12 layers.
- **The security gate (PR-56)** now counts `reliability` as server-side.
- **The test gate (PR-57).** A task with frontend, architecture, backend, api, database or reliability also gets the
  `testing` layer. Its required files: the superpowers notes, `writing-good-tests.md` and, for the builder,
  `verification-before-completion/SKILL.md` (about 2,300 words). A method fix is outside both gates.
- **14 new topics:** bugfix, flaky, e2e, ci, deploy, container, dependencies, observability, resilience, health,
  rate-limit, distributed, legacy, config (42 in all). Conditional files come only with a topic the fence touches.
- **Stack fit.** Playwright's page is JavaScript and TypeScript: `stacks: ["node"]`; on another stack the record says
  why it was left out. Every other bundle fits `any`.
- **Lifecycle.** The blueprint gets the Twelve-Factor intro, codebase, port binding, backing services and processes for
  an architecture task, and Strangler Fig and Anti-Corruption Layer for a legacy one. The builder and the reviewer get
  the reliability and ops files by topic.

## 7. Validation

| Scenario | Stack | Task | Result (builder) |
|---|---|---|---|
| F | `fastapi` | backend · reliability: a payment worker with timeouts and retries | both gates; Retry, Circuit Breaker, Bulkhead, Queue-Based Load Leveling, Idempotent Consumer; processes and disposability |
| G | `next` | ops: a GitHub Actions workflow | no gate; CI/CD sheet, build-release-run, secure use |
| H | `sveltekit`, `django` | frontend · testing: a flaky end-to-end sign-up test | debugging and condition-based waiting; Playwright on Node only, `not_selected` on Python |
| I | `nest` | architecture · backend: billing out of a legacy monolith | both gates; Strangler Fig, Anti-Corruption Layer; backing services, processes; the blueprint gets 9 files |
| J | `go-chi` | ops · backend: structured logs and OpenTelemetry traces | Logging sheet, logs factor, the four OTel pages |

Gate checks (the `layers` command): reliability → `security reliability testing`; architecture → `architecture
testing`; ops → `ops`; design → `design`; a method fence → nothing; database · testing · security → no layer added.

Tests: `test/skills-layers.test.mjs` (a)–(g), with `skills-select.test.mjs` (a)–(h) and `skills.test.mjs` (a)–(i)
updated for the test gate. Full suite on Linux, Node 22: 278 tests, 278 pass. `manifest up to date (304 files)`;
`find-specifics` `0 0`. Staged guards exit 0: `guard:manual PASS (107 names checked)`, `guard:skills PASS (29 skills
checked, 18 vendored)`.

## 8. Limits

- Topics are word matches on the fence. A false match adds reading; it never removes a required file.
- The copies are fixed at their commits. A new upstream version is a new engine task and a new review.
- Google's SRE books were considered but their licence page could not be read from this session, so they are neither
  shipped nor recorded.
- The licence classes and obligations are DEV_OS's reading of the licence texts, recorded so a person can check them.
