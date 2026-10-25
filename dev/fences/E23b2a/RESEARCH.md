# E23b2a — research, licence audit and decisions

The reviewer's record behind the E23b2a fence (owner brief of 2026-10-25: research, audit, select, pin, integrate and
validate reusable engineering skills for any stack). Every claim below was checked on a file that was read, at the
commit given. Nothing here is legal advice.

## 1. Scope and split

The brief covers nine areas. They split by what is ready to ship:

| Task | Layers | Areas | Status |
|---|---|---|---|
| **E23b2a** (this) | security, api, database, backend | security, APIs, databases | fence v1 |
| E23b2b | architecture, reliability (new layers), testing, ops | backend architecture, reliability, observability, testing, CI/CD | fence on PASS of E23b2a |
| E23b4 | every layer | OWASP ASVS as the verification levels of the production-readiness gates | planned |

## 2. Method

1. **Find.** Maintained sources with a named owner and a licence: OWASP (Cheat Sheet Series, API Security Top 10, ASVS),
   Google's API Improvement Proposals, Supabase's own agent skills, and agent-skill collections (Trail of Bits,
   wshobson/agents, obra/superpowers, anthropics/skills).
2. **Pin.** Clone each at one commit. Releases are used where they exist (`supabase/agent-skills` `v0.1.9` =
   `544bfc5`). OWASP's two repositories and the AIPs publish no release tags for this text, so the pin is the full
   commit; no branch is ever the source.
3. **Read whole.** Every shipped file was read in full on 2026-10-25, including each licence and notice.
4. **Trust scan.** Look for instructions to the agent (prompt injection), scripts, network calls, installs and links
   that would be followed. Result per bundle in §4.
5. **Check claims that matter.** A sample that would break a product was run (§5).
6. **Map.** Layers, roles, priority and condition per file; the security gate (§6).
7. **Validate.** Scenarios A–E on five stacks, guard tests, the full suite and the staged guards (§7).

## 3. Candidates and decisions

| Candidate | Pin | Licence (file) | Class | Decision |
|---|---|---|---|---|
| OWASP Cheat Sheet Series, 22 sheets | `a8ecf45` (head 2026-10-25, no tags) | CC BY-SA 4.0 (`LICENSE.md`, SPDX line) | conditions | **ship** `owasp-cheat-sheets` |
| OWASP API Security Top 10 2023 (`editions/2023/en`, 12 files) | `33cea37` (tags are 2019's) | CC BY-SA 4.0 (`LICENSE`; README "Licensing") | conditions | **ship** `owasp-api-top10-2023` |
| Google AIP-155, 158, 180, 193 | `2ccc61a` (no tags) | CC BY 4.0 text + Apache-2.0 code samples (`LICENSE.md`, README "License") | conditions | **ship** `google-aips` |
| Supabase Postgres Best Practices | `v0.1.9` `544bfc5` | MIT (`LICENSE`, "Copyright (c) 2026 Supabase"; `license: MIT` in SKILL.md) | free | **ship** for projects with the Supabase module |
| Supabase skill | `v0.1.9` `544bfc5` | MIT (same file) | free | **ship SKILL.md only**, Supabase module |
| wshobson api-design-principles | `0874a27` (no tags) | MIT | free | external: generic advice, ships a Python template; SKILL.md read, references not audited |
| Trail of Bits supply-chain-risk-auditor | `196a907` | CC BY-SA 4.0 | conditions | external: runs `uv` scripts that query OSV, npm, PyPI, Go and deps.dev |
| Trail of Bits sharp-edges | `196a907` | CC BY-SA 4.0 | conditions | external for now: ~19,000 words in 22 files; audit in E23b2b |
| OWASP ASVS | `2b47a9d` | CC BY-SA 4.0 | conditions | external: a verification standard, mapped by the E23b4 gates |
| obra/superpowers, wshobson ops and observability skills | `2ce8aa1` (tags to v7.0.1), `0874a27` | MIT | free | candidates for E23b2b |

The 22 sheets: Authentication, Authorization, Session Management, Password Storage, Input Validation, Injection
Prevention, SQL Injection Prevention, Cross Site Scripting Prevention, Cross-Site Request Forgery Prevention, Server
Side Request Forgery Prevention, Secrets Management, Logging, Error Handling, File Upload, HTTP Headers, Insecure Direct
Object Reference Prevention, Mass Assignment, Multi-Tenant Security, Threat Modeling, REST Security, Webhook Security,
Database Security. They are the sheets a build or a review of server-side work cites; the series has more than 100.

## 4. Licence and trust audit

| Bundle | Obligations and how they are met | Trust scan |
|---|---|---|
| `owasp-cheat-sheets` | CC BY-SA 4.0: attribution (title, author, source at the commit, licence and link, changes: none) in `ATTRIBUTION.md`; full licence `LICENSE.md`; files unchanged (ShareAlike would bind an adaptation); DEV_OS's notes kept apart | No instruction to the agent. Code samples in several languages (illustrative). Links to `../assets/` (images, two third-party PDFs not under the sheets' licence) and to 30 sheets not copied: they do not resolve, and the notes say not to fetch them. No nested licence. |
| `owasp-api-top10-2023` | as above; `0x00-notice.md` names the project leaders and ships as a notice | Risk text only. One invalid GraphQL sample (`0xa1`). |
| `google-aips` | CC BY 4.0 attribution in `ATTRIBUTION.md`; Apache-2.0 text in `LICENSE.md` (both texts in the one file); no NOTICE file exists; unchanged | Proto and JSON samples; one invalid (`0180`). |
| `supabase-postgres-best-practices` | MIT notice in `LICENSE`; unchanged | SQL samples; links to docs. One sample breaks its policy (§5). Not copied: `CHANGELOG.md`, `references/_sections.md`, `_contributing.md`, `_template.md`. |
| `supabase` | MIT notice in `LICENSE`; unchanged | **Tells the agent to fetch** the changelog and docs, use the CLI and MCP server (`curl` to `mcp.supabase.com`), and file feedback issues. Shipped as SKILL.md alone; `DEVOS-NOTES.md` lists what to read and what to skip. Not copied: `CHANGELOG.md`, `assets/feedback-issue-template.md`, `references/skill-feedback.md`. |

Every shipped entry has `trust.runs_code: false` and `trust.fetches: false`: the cycle runs nothing from a skill and
fetches nothing. **DEV_OS's licence stays separate:** each folder keeps its own licence, `ATTRIBUTION.md` says DEV_OS's
licence does not cover the copies and theirs does not cover DEV_OS, and DEV_OS's commentary is in its own files
(`DEVOS-NOTES.md`, origin `devos`). No protected text was rewritten into a DEV_OS file to avoid a licence.

Pins verified: the 76 source files equal `git show <commit>:<from>` byte for byte (`76 source files, 0 differ from the
pinned commit`), and their sha256 (LF) matches the manifest.

## 5. Findings and corrections

| Where | Finding | Evidence | What the agents are told (`DEVOS-NOTES.md`) |
|---|---|---|---|
| `security-rls-performance.md` | The sample revokes `EXECUTE` on the policy's helper from `authenticated`, so the policy fails for that role | PostgreSQL 16.15, local: as printed `ERROR: permission denied for function is_team_member`; with `EXECUTE` granted to `authenticated` only, the query returned the member's row (`id 10`) and not the other team's | Revoke from `PUBLIC` and `anon`, grant to the roles the policy serves, keep the function in an unexposed schema, prove it with a policy test |
| `conn-idle-timeout.md`, `conn-limits.md` | `alter system`, not allowed on managed Supabase | read | Use the provider's settings, only when the fence asks |
| `schema-primary-keys.md` | `uuid_generate_v7()` needs the `pg_uuidv7` extension | read | Extensions only when the fence names one; identity or the rule's no-extension id; PG 18 has `uuidv7()` |
| `Database_Security` | The usual grants list leaves out `INSERT` | read | Grant each role exactly what its code runs |
| `Database_Security` | Credentials in a configuration file outside the web root | read | The method wins: secrets never in a repository file |
| AIP-193 vs IDOR sheet | `403` before existence vs one public answer such as `404` | read | Both hide existence; choose one per project in `docs/DECISIONS.md` |
| AIP-193 | Guidance says English messages; its changelog says the service's language | read | Follow the project's documents |
| AIP-180 | `int wheels = 2;` is not valid proto and conflates the field number with the default | read | Read the rule, not the sample |
| API Top 10 `0xa1` | GraphQL mutation has an extra pair of braces and an unused variable | read | Write the project's own tests |
| Supabase skill | Fetch, CLI, MCP and issue-filing instructions | read | Skip those parts; migrations follow `FULLSTACK_MODULE.md` and the human gate |

**Conflict rule** (in every prompt that lists more than one skill, and in each notes file): the fence,
`docs/DECISIONS.md` and the method win; between skills, the stricter security rule wins, and the agent names the
conflict in its report or verdict.

## 6. Selection

- **Layers** come from the fence (`- Layers:`), as in PR-55.
- **The security gate** adds `security` to a task with `backend`, `api` or `database`, and to a deep task (risk 3, a
  gate, or a deep review). No fence removes it; a method fix is outside it. Its **required** files: Input Validation,
  IDOR Prevention and the API Top 10 list (about 2,600 words), plus `security-rls-basics.md` on a Supabase project.
- **Priorities.** `required` and `recommended` files come with their layers; a `conditional` file only when one clause
  of its `if` holds: a **topic** (28 in the manifest: words such as "upload", "webhook", "tenant", "paginated", or a
  `- Topics:` line), a **module** the project uses, or **deep**. This keeps a small task small: the 76 source files are
  never listed together.
- **Stack and module fit.** All five bundles fit `any` stack. The two Supabase skills apply only when the project chose
  or uses the Supabase module; the record says why they were left out otherwise (`not_selected`).
- **Notes first.** Each selected bundle's `DEVOS-NOTES.md` comes before its files.
- **Reproducible record.** `skills.mjs select --task Tnn --role R --json`: the fence, manifest and `local.json` by
  sha256, the risk and gate, the stack and modules, the layers (with the gate's reason), the topics (with the word that
  matched) and every file with its priority and reason. The same inputs give the same bytes (test (f)).

**Lifecycle mapping.** Blueprint (plans the product): `INDEX.md`'s Blueprint column, Threat Modeling for features that
cross a trust boundary. Build: the builder's prompt lists the selection for `builder`. Review: the reviewer's prompt
lists the selection for `reviewer`; a deep review adds every API Top 10 risk file, Threat Modeling and Authorization.
Gates (E23b4): ASVS levels.

## 7. Validation

| Scenario | Stack, modules | Task | Result (builder unless said) |
|---|---|---|---|
| A | `next`, Supabase | api · database: a workspace's paginated list with RLS on a new table | 26 files: OWASP gate files, Authorization, SQL injection, Mass Assignment, Multi-Tenant, REST; Top 10 list; AIP-158; Postgres SKILL, RLS basics, RLS performance, privileges, 5 schema rules, N+1, pagination; Supabase SKILL; 5 notes files |
| B | `fastapi`, none | backend · api, risk 3: Stripe payment webhooks, retries | gate (server-side; risk 3), SSRF and Webhook sheets, AIP-155; reviewer gets all 10 risk files, Threat Modeling, Error Handling; both Supabase skills in `not_selected` |
| C | `expo`, Firebase | backend · security: a profile image upload | gate files and File Upload; no Postgres rule |
| D | `sveltekit`, none | a UI screen rendering comment markdown; a pricing page | design skills plus the XSS sheet for markdown only; no gate file; the pricing page gets no OWASP file |
| E | `go-chi`, none | a one-line backend rename (risk 1); a `- Topics: secrets` line; a method fix | the gate's three required files are listed and marked; the Topics line adds Secrets Management; the method fix gets nothing |

Tests: `test/skills-select.test.mjs` (a)–(h) and `test/skills.test.mjs` (a)–(i). Full suite on Linux, Node 22:
271 tests, 271 pass. `manifest up to date (244 files)`; `find-specifics` `0 0` (one OWASP line, "cell/RF tower ID",
allowed in `tools/specifics-allow.json`). Staged guards exit 0: `guard:manual PASS (107 names checked)`,
`guard:skills PASS (21 skills checked, 12 vendored)`.

## 8. Limits

- Topics are word matches on the fence. A false match adds reading; it never removes a required file.
- The vendored copies are fixed at their commits. A new upstream version is a new engine task and a new review.
- The licence classes and obligations are DEV_OS's reading of the licence texts, recorded so a person can check them.
