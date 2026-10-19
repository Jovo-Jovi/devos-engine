# DEV_OS Engine — plan (v1)

Approved by the owner on 2026-10-18. Source of truth: `../../seed/00-SEED.md`. Decisions: `../../seed/05-decisions.md`
(rows 2, 4, 6–8 updated today). This plan **replaces M4** of `../00-PLAN.md` and absorbs M3 (as E08) and the sender
side of PM01/PM02 (as E09). The Tower plan (M1 tail, then its registry tasks) continues in parallel.

## 1. Decisions taken on 2026-10-18

| # | Decision | Consequence in this plan |
|---|---|---|
| D-E1 | **Engine now, in parallel** with the Tower's open tasks (T09–T11). | The method is frozen at `devos-control-tower` @ `a49ca6d` for E01. Later Tower method fixes are ported by hand as engine tasks. Both tracks share your Cursor and Claude usage limits. |
| D-E2 | **Free first; paid tiers later**, after reach. | v1 ships free. The license must keep paid tiers possible later (D-E4). |
| D-E3 | **Contract required to use DEV_OS.** Declining stops setup. | `devos init` opens with the contract. A project is registered before its first automated cycle. Nothing is sent before acceptance. |
| D-E4 | *Open, before E10:* the license text. | Recommendation in §16. |
| D-E5 | Distribution (seed decision 2): **one `devos` command** (plain Node, no dependencies), run with `npx` from the GitHub repository; every release also a ZIP. Projects receive the engine files with a manifest; `devos upgrade` is a reviewable pull request. | Template repository dropped. No package registry in v1 (can be added at launch without changing anything). |
| D-E6 | Seeing other people's projects (seed decision 4): **by contract only** — registration through the GitHub App installed on the project's repository. Anonymous ping and manifest search are dropped. | Tower tasks TR1–TR2 (§12). |

## 2. What the Engine is

One reusable engine that takes a developer from an empty folder to a project that builds itself on GitHub:
the **Adaptive onboarding** mode (a guided `devos init`) and the **Automated workflow** mode (the proven
`devos-*` workflows) in v1; the **Local workflow** mode (local runner parity, M2) follows as an upgrade.
It is the Tower's method — scripts, guards, workflows, prompts, rules, skills, handbook, manual and
precedents — packaged, versioned and made project-neutral. Nothing that works is rewritten.

The developer never needs to know the Tower exists. The contract states plainly that the project registers with
the **DEV_OS registry, operated by Jovo-Jovi**, and what each event contains.

## 3. The developer journey — from scratch (v1)

| # | Step | Who | What happens |
|---|---|---|---|
| 0 | Install prerequisites | developer | Node 22+, pnpm, git, GitHub CLI (`gh auth login`), Cursor (account + API key), Claude Code (subscription + `claude setup-token`), Docker only for the database module. |
| 1 | `npx github:Jovo-Jovi/devos-engine init my-app` | developer | Creates the folder and starts the guided flow. |
| 2 | Doctor | DEV_OS | Checks every prerequisite and prints what is missing with the exact fix. Changes nothing. |
| 3 | **Contract** | developer | Shown in full: what DEV_OS is, what is reported (§8), what never leaves the machine, how to disconnect. Typed `accept` continues; anything else stops setup. |
| 4 | Questions | developer | Only what cannot be inferred: name, one-paragraph brief, users, data stored or not, sign-in, languages, deploy target, repository visibility (private by default). Defaults come from the developer profile (§6). |
| 5 | Blueprint | DEV_OS (Claude, reviewer role) | The `/devos-new-project` flow, headless: fit research, product brief, scope, decisions to sign, design system, data model when data is stored, `PHASES.md`, fence T01. Shown for approval; the developer can ask for changes. |
| 6 | Engine files | DEV_OS | Installs the engine (workflows, scripts, guards, rules, skills, prompts, manual), writes `devos/project.json`, generates `devos.config.json` and `SETUP.md`, commits locally. |
| 7 | GitHub | DEV_OS + developer | Creates the repository (private by default) and pushes. Then the setup checklist: for each secret, DEV_OS runs `gh secret set <NAME>` and the developer pastes the value into GitHub's own prompt — DEV_OS never reads or stores a value. Variables are set the same way. `setup-check` confirms the names. |
| 8 | Registration | developer | DEV_OS opens the GitHub App install page for this one repository. Installing it completes the contract; DEV_OS receives the receipt and commits `devos/contract.json`. |
| 9 | First cycle | DEV_OS | Dispatches `devos-cycle`. From here the automated workflow builds T01, reviews, retries, waits for usage limits, resumes, deploys after merges. The developer merges at gates and answers the supervisor. `devos status` shows where things stand. |

After step 9 the project runs exactly like the Tower runs today.

## 4. Keys and accounts

| Level | What | Where it lives | Set when |
|---|---|---|---|
| Developer (once per machine) | GitHub CLI login | `gh` keychain | step 0 |
| Developer | Cursor API key (one or two accounts) | developer's password manager → pasted per project into GitHub | step 7 |
| Developer | Claude Code OAuth token or Anthropic API key (one or two accounts) | same | step 7 |
| Developer | Preferences: GitHub owner, default visibility, builder model family, reviewer models, number of accounts, default stack | `~/.devos/developer.json` — **names and choices only, never a value** | first `init`, editable |
| Project | `DEVOS_PAT` (fine-grained, this repository only, ≤ 90 days) — only for method fixes that change workflows | GitHub secret | step 7, optional |
| Project | Vercel token + org id + project id | GitHub secrets | step 7, when deploy is on |
| Project | Supabase access token, project ref, DB password, backup passphrase; app values in Vercel | GitHub secrets + Vercel env | step 7, database module only |
| Project | R2 / Firebase names | as in `FULLSTACK_MODULE.md` | only when the module is active |

The checklist is generated from `devos/setup.json` (plus module items), so only rows that apply appear.

## 5. Layout

**The engine repository (`devos-engine`):**

```
bin/devos.mjs            the one command (E04)
lib/                     command internals (E04–E07, E09)
payload/files/           engine-owned files, installed and upgraded (dot-directories stored as dot-*)
payload/templates/       project-owned starting points, written once at install, never upgraded
payload/manifest.json    every engine-owned path with its sha256 (generated)
tools/                   build-manifest, verify-source, stage (install into a scratch folder for tests)
test/                    node:test suites, no dependencies
dev/                     building the engine itself: LEDGER, DECISIONS, fences, reports, reviews, sources
```

Dot-directories are stored as `dot-github/`, `dot-cursor/`, `dot-claude/`, `dot-gitignore`: the engine
repository's own Cursor and Claude sessions never load the payload's rules, and packaging never drops them.

**An installed project** looks like the Tower minus its product: `.github/workflows/devos-*.yml`,
`.github/ISSUE_TEMPLATE/`, `.cursor/`, `.claude/`, `scripts/devos/`, `scripts/guards/`, `devos/` (prompts,
schemas, setup items, `engine.defaults.json`, `project.json`, `engine.lock.json`, `contract.json`),
`devos.config.json` (generated), `docs/method/` (handbook, manual, module guide, precedents), the project's own
`docs/`, `CLAUDE.md`, `AGENTS.md`, `SETUP.md`.

## 6. Commands (v1)

`devos init [folder]` · `devos doctor` · `devos status` · `devos config --write|--check` · `devos upgrade
[--to <version>]` · `devos contract` (show the accepted contract and the receipt) · `devos --version`.
Later: `devos adopt` (existing projects), `devos run|resume` (local runner).

## 7. Config levels

`devos/engine.defaults.json` (engine-owned: models by risk, review modes, surfaces, checks, modules, resume,
supervisor, guard defaults) + `devos/project.json` (project-owned: key, scenario, screens, extra deep paths,
guard settings, deploy settings, registry receipt reference) → **`devos.config.json`, generated**. The workflows
keep reading `devos.config.json` exactly as today, so no workflow changes for the split; `guard:config` fails if
the generated file was edited by hand. Developer preferences (§4) only seed `project.json` at init.

## 7a. Model choice (owner request, 2026-10-19)

**Today the method is fixed to two tools and one builder family:** the builder runs through the Cursor CLI and
`builder-model.mjs` builds ids as `grok-4.7-<effort>[-fast]`; the reviewer, planner and supervisor run through the
Claude Code CLI with Claude model ids, `--effort`, `--fallback-model` and a JSON schema for the verdict; usage-limit
detection and account switching know only these two tools.

**v1 (E04):** any model the developer has **inside those two tools**. The developer profile and `devos/project.json`
gain a `models` section: builder `{ tool: "cursor", model: <any id from \`agent models\`>, effort_ids: <optional
map low|medium|high|xhigh → id> }` — without the map, one id serves every effort; reviewer `{ tool: "claude-code",
light: <id>, deep: <id>, fallback: <id> }`; supervisor `<id>`. `devos init` lists the models each CLI reports and
asks. `builder-model.mjs` reads the map instead of the Grok naming; the Grok family stays the shipped default. Rule:
when the builder and the reviewer would be the same model, `devos doctor` warns (a reviewer grading its own model's
work is weaker); it never blocks.

**v1.1 (adapters):** other CLIs as builder or reviewer (for example Codex CLI or Gemini CLI). Each adapter needs: the
invocation, structured output for the verdict, usage-limit patterns and reset parsing, usage counts, and account
switching. One adapter per task after v1.0, chosen by demand.

## 8. Contract and registry

**In the repository:** `devos/contract.json` — contract version, project key, repository, accepted-by GitHub
login, accepted-at, receipt id, reporting scope. No credential of any kind.
**On the server (the Tower):** the authoritative acceptance record and the project row.

**Registration (TR1):** after the repository exists, `devos init` asks the registry for a claim (repository,
proposed key, contract version, engine version) and opens the App's install page for that repository. Installing
an App needs admin rights over the repository, so the installation proves both the repository and the person; the Tower
binds the claim to the installation, assigns a unique project key (suffix on clash), records the acceptance and
returns a receipt that `devos init` commits.

**Reporting (E09):** one event per workflow step, exactly the Tower's event contract v1 — project key, run id,
sequence, phase, task, step, status, time, evidence path@commit, and token counts for builds and reviews. Sent
with GitHub OIDC (no stored token). Never sent: code, diffs, prompts, file contents, secrets, emails.
`if: always()`, `continue-on-error`, 5-second timeout, journal on failure, re-sent later: **reporting never
blocks a run.**

**Required (D-E3):** setup stops if the contract is declined; the cycle's preflight requires a receipt (setup
issue item "Registration"), with a 72-hour grace while the registry is unreachable so an outage of yours never
stops a developer for long. Honest limit: in a free tool whose files sit in the developer's repository, this is
a lock by terms, not by force — the license (D-E4) is what makes it binding.

**Disconnect:** uninstalling the App stops ingestion; the project shows as disconnected. The contract says how to
ask for deletion.

## 9. Versions and upgrades

Engine version = `package.json` version, semver, stamped into `payload/manifest.json` and into each project's
`devos/engine.lock.json` (version + installed hashes). Contract version and event-contract version are separate.
`devos upgrade`: three-way per file (installed hash, current file, new release) → engine files only, on a branch
`devos/upgrade-<version>`, as a pull request with the diff and release notes. A file the project edited is
listed under `conflicts:` and left untouched. A new contract version asks for acceptance again; an engine upgrade
alone never implies it. Releases: tag + GitHub Release + ZIP asset; `npx github:Jovo-Jovi/devos-engine#v1.2.0`
pins a version.

## 10. UI/UX gate (E08 — the seed's rule, now mechanical)

**Lifecycle per UI task:** design brief → visual direction → design specification (in the fence) →
implementation → browser verification → reviewer design verdict → remediation and re-verification. The reviewer
(Claude) owns direction and acceptance; the builder (Grok) implements and self-checks; only rendered evidence
counts. A correct page with poor UI/UX does not pass. Project-specific aesthetics are allowed; one look is never
forced on every project.

**Already in the payload (kept, not rebuilt):** `screens.mjs` captures every page, state and interaction named on
the fence's `- Screens:` line at 1280 and 390, in light and dark, with settled, reduced-motion and filmstrip frames
and layout shift (PR-35); the reviewer's seven-row design ledger (hierarchy, consistency, accessibility,
responsiveness, craft, motion, truthfulness) in `reviewer.md`; `guard:design` (tokens, no raw colours, logical
properties); Motion as the standard interaction library; Context7 read-only for current library docs (PR-05).

**Added by E08:**
1. **Design contract in every project**, written by the blueprint step: `DESIGN_SYSTEM.md` (tokens, type, spacing,
   surfaces, themes, motion with reduced-motion behaviour, responsive rules, accessibility floor) plus
   `docs/design/UI_ACCEPTANCE.md` (explicit pass/fail criteria). Future agents work from these files, never from a
   past conversation.
2. **Design specification required** in every UI fence (`guard:design-spec`): the routes and states to build and
   capture — loading, empty, error, success, interactive, dialogs, forms, key journeys — and the criteria that apply.
3. **Missing evidence is a FAIL**, not a gap: a state named on the `- Screens:` line without an error-free capture,
   a layout shift above 0, a console error or failed request during capture.
4. **Accessibility check** `a11y` with `@axe-core/playwright` on every captured state, required for UI tasks.
   Automated results never replace the reviewer's keyboard, focus and contrast reading.
5. **Vendored design skills, pinned:** Anthropic `frontend-design` and Vercel `web-design-guidelines` copied into
   `.cursor/skills/` and the reviewer's references at a recorded version, read by the builder (implementation) and the
   reviewer (acceptance). Never fetched at run time: remote instructions can change.
6. **Objective vs subjective:** the verdict separates automated failures (always FAIL) from design findings (REVISE
   with exact corrections). Unresolved subjective points are recorded, never hidden; a justified exception is written
   into the verdict and visible to the owner, never a silent bypass.
7. **`DESIGN_METHOD.md`** in `docs/method/`: the lifecycle above, the acceptance gate (spec met · functional checks
   green · responsive and a11y checks done · captures reviewed · material defects fixed and re-captured · verdict with
   known limitations), and the resource catalogue below. Manual and precedent updated (PR-30).

**Resource catalogue — decided per project in the blueprint, never installed by default.** The blueprint step records
each as *adopt*, *optional* or *reject* in `DESIGN_SYSTEM.md`, with the reason; the reviewer must justify every
dependency, and the lightest tool that does the job wins.

| Resource | Use | Default |
|---|---|---|
| Motion | component transitions, hover/tap feedback, layout changes | adopt (already the method's standard) |
| shadcn/ui (CLI; MCP for interactive work) | accessible primitives the project owns | adopt when the stack uses it |
| GSAP + `@gsap/react` | coordinated, cinematic sequences (SVG, timelines) | optional — never on the same element as Motion |
| React Bits | individual effects, copied and owned | optional — one effect at a time |
| React Three Fiber (+ Spline for art direction) | genuine 3D only | optional — needs a reason in the brief |
| Storybook + a11y addon | isolated states of shared components | optional — larger UIs |
| Lenis, Rive | smooth scroll, designed micro-animations | reject unless the brief justifies them |

**MCP stays out of the gate.** Playwright MCP, shadcn MCP and Chrome DevTools MCP help when the developer works
interactively in Cursor; they go in `.cursor/mcp.example.json` as optional entries. The automated cycle never depends
on an MCP server being available: the runner captures the real browser itself, and the repository holds the contract,
the tests and the proof.

**E08 acceptance:** a correct but generic, admin-looking page gets design REVISE with exact corrections, then PASS
once fixed; a UI fence without a design specification fails the guard; a capture with an axe violation or a console
error fails the checks.

## 11. Source of the method, and what is generalized

Copied verbatim in E01 from `Jovo-Jovi/devos-control-tower` @ `a49ca6db268b98d6558077bf3e95b8ae759d91b3`
(103 files: `scripts/devos` 33, `scripts/guards` 12, `devos` 13, `.github/workflows` 10, `.github/ISSUE_TEMPLATE`
3, `.cursor` 18, `.claude` 8, four `docs/method` files, `.gitignore`, `.gitattributes`). The Tower is ahead of the
pilot (supervisor, watchdog, rescue, motion evidence, builder streaming and 10-minute report PR-37, staged fences with helper agents PR-38). Re-pinned on 2026-10-19 from `aaf9ab2` before E01 started, so these arrive in E01 instead of as ports. Reference only, not shipped: the Tower's
`devos.config.json`, `CLAUDE.md`, `AGENTS.md`, `SETUP.md`, and the pilot's `devos/setup.json` @ `4ccbef7` (for
the R2 and Firebase items the Tower removed).

Tower-specific lines made configurable in E03 (E01 lists them all): `guard:design` allowed hosts, `guard:i18n`
catalogues, `guard:naming` route exceptions (PR-34) · `doctor.mjs` and `devos-deploy.yml` Vercel bypass policy
and probe paths (Tower ADR-004) · `devos-deploy.yml` production URL (`vars.TOWER_URL` → `vars.DEVOS_PRODUCTION_URL`)
· `setup.json` texts naming the Tower and its three Tower-only items · rules `10-security-data` and
`30-vocabulary` (become project templates).

## 12. Tasks

**Engine (`devos-engine`, built locally — §13):**

| ID | Title | Risk | Depends | Gate | Acceptance (proof) |
|---|---|---|---|---|---|
| E01 | Repository, verbatim payload, manifest, version | 2 | — | — | 103 files byte-identical to the Tower @ `a49ca6d`; manifest rebuilds identically; `devos --version` |
| E02 | Config split: engine defaults + project file → generated config; `guard:config` | 3 | E01 | you | a Tower fixture `project.json` regenerates the Tower's `devos.config.json` deep-equal; staged guards pass |
| E03 | Generalize the Tower-specific lines into project settings; module setup items from the pilot | 3 | E02 | you | E01's list resolves to zero Tower names in shipped files; Tower and pilot fixtures reproduce both behaviours |
| E04 | `devos` command: doctor, status, developer profile, version, **model choice (§7a)** | 2 | E03 | — | doctor on a machine missing `gh` prints the fix and exits 1; profile holds no value-like string; a fixture with a non-Grok builder model resolves through the map, and same-model builder/reviewer prints the warning |
| E05 | `install` and `upgrade` (three-way, branch + PR, conflicts listed) | 3 | E04 | you | install into an empty repo → all guards pass; one changed engine line → PR touching only that file and the lock; an edited file listed as a conflict |
| E06 | `init` part 1: contract, questions (onboarding definitions), blueprint through Claude Code, doc templates | 2 | E05 | you | declining stops with exit 1 and writes nothing; a scripted brief produces the documents and fence T01 that `guard:phases` accepts |
| E07 | `init` part 2: repository, secrets by name through `gh`, variables, generated `SETUP.md`, first cycle | 3 | E06 | you | on a throwaway account: empty folder → repo → `setup-check` green → `devos-cycle` starts T01 |
| E08 | UI/UX gate: design contract, required spec, axe check, missing evidence = FAIL, pinned design skills, resource catalogue (§10) | 3 | E05 | you | §10 "E08 acceptance" |
| E09 | Registry link: `report.mjs`, report and flush steps in every workflow, registration in `init`, cycle preflight | 3 | E07 + TR1–TR2 | you | a scratch project's T01 shows every step in the Tower within a minute; registry down → run completes, events arrive later once; no receipt → setup issue lists Registration |
| E10 | Clean-machine run, docs, license, v1.0.0 | 2 | E01–E09, D-E4 | you | a second machine goes from `npx … init` to T01 merged using only the README |

**Tower (`devos-control-tower`, through its own cycle; filed as one change request after T11):**

| ID | Title | Risk | Notes |
|---|---|---|---|
| TR1 | Registry: claims, App installation binding, acceptance records, unique keys, receipt route | 3 | ADR-005 (registration proof) first; App made installable by any account and given a neutral name (owner action); no dashboard access for registrants |
| TR2 | Ingestion for registered developer projects; disconnect on uninstall; Registered projects view (contract version, engine version, link state) | 3 | `owner_github_id` from the binding; rate limit per project |

**Owner actions:** make the GitHub App public and rename it neutrally (e.g. `devos-registry`) · give the Tower a
neutral production domain **before launch** (it is the OIDC audience every project carries) · decide D-E4 ·
have the contract and privacy text reviewed (it records GitHub identities and repository names).

## 13. How the local build runs

1. **Bootstrap (once):** create the folder `devos-engine`, unpack `bootstrap/` from this directory into it,
   `git init`, commit `B0: engine bootstrap`. Clone the two sources pinned beside it (`bootstrap/README.md`).
   A private GitHub repository for backup is optional; it becomes public at launch.
2. **Build:** open the folder in Cursor. Agent, Grok 4.7 at the fence's effort: *"Execute `dev/fences/E01.md`."*
   `.cursor/rules/00-engine-dev.mdc` binds it: follow the fence, HALT rules, report with real outputs, never git,
   never the fences or reviews.
3. **Review:** in the same folder, Claude Code: `/engine-review E01`. It re-runs every *Done when* command,
   reads the whole diff, writes `dev/reviews/E01-a1.md` (first line `VERDICT: PASS` or `VERDICT: FAIL`), and on
   FAIL reissues the fence with an *Attempt N focus*. It never commits.
4. **Accept:** on PASS you commit (`E01: <title> — PASS a1`). The reviewer ticks the ledger row in the review.
5. The reviewer (Claude, here or in Claude Code) writes the next fence against the committed tree. Only E01 and
   E02 exist now; each later fence is written after the previous PASS so it can be rehearsed against real files.

## 14. Not in v1

Adopting existing or production projects (`devos adopt`, the in-development and production scenarios) ·
the local runner at parity (M2) · stacks other than Next.js + the existing modules · local event reporting
(ingest keys) · builder or reviewer CLIs other than Cursor and Claude Code (§7a, v1.1) · paid tiers and license
keys · a package registry.

## 15. Risks → mitigation

- **The Tower and the engine drift** while both change → E01 pins `a49ca6d`; every later Tower method fix is
  listed in `dev/LEDGER.md` *Ports* and ported as an engine task before E10.
- **Registration becomes a single point of failure** for every new project → 72-hour grace, reporting never
  blocks, the registry route is tiny and on Vercel.
- **Windows line endings break hashes** → engine root `.gitattributes` `* text=auto eol=lf`; hashes over
  LF-normalized bytes.
- **Bash scripts on Windows** → v1 needs Git Bash locally only for the Tower-era `.sh` helpers; the runner
  itself is Linux. Port to `.mjs` later (PROPOSALS P-02).
- **The contract reads as hidden tracking** → shown in full before anything is created, listed in the README,
  and the event fields are fixed by the public contract.
- **Shared usage limits** with the Tower's cycle → build engine fences while the Tower waits on your merges.

## 16. Open decision D-E4 — license (before E10)

Free now, paid later. An open-source license (MIT, Apache-2.0) cannot be withdrawn from versions already
released: anyone could fork v1.x and give it away or resell it forever. A **source-available** license that
allows free use for building one's own projects, and forbids redistribution, resale and offering the engine as a
service, keeps paid tiers possible. Recommendation: source-available for v1, reviewed by a lawyer before release
(I am not one). Until then the engine repository stays *All rights reserved*, like the Tower.

## 17. Calendar

Ten engine tasks × ≈ 1.4 attempts × 45–90 minutes of Cursor + review each, plus your acceptances: about
**two weeks part-time**. TR1–TR2 run on the Tower's cycle in the same window; E09's live proof waits for them.
