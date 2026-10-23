# DEV_OS Engine — full comparison and final plan (2026-10-23)

Three things are compared here:

- **Our engine** — `Jovo-Jovi/devos-engine`, `main` after E07 (`efa007d`). This is the repository of record (D-E9).
- **Engine B** — the build another model made, attached as `devos-engine.zip` on 2026-10-23. It has 217 files and
  25,636 lines, and its 172 tests pass offline (I ran them).
- **The Tower** — `Jovo-Jovi/devos-control-tower` @ `3ddd006`. Its method is the one our payload was taken from.

**Short answer.** Keep our repository as the base, and keep the Tower's method as the automation core: it is proven,
and Engine B's replacement for it has serious defects (§3). Engine B's onboarding is the better part of it. Take its
pieces one task at a time into our engine (§5). The order is a solid core first, then support for every kind of
project, then a confirmed first green run, then the guided UI and animations, then the link to the Tower dashboard,
then the release (§8).

---

## 1. What each one is

| | Our engine | Engine B | Tower (method part) |
|---|---|---|---|
| Purpose | Package the Tower's method, install it into a project, onboard the developer | One local tool: guided setup, then its own GitHub automation | The method running for real on a real product (T01–T14 built by it) |
| Engine code | `bin/` + `lib/`: 13 files, 1,623 lines | `bin/` + `lib/`: 36 files, 8,068 lines; `ui/`: 8,066 lines (wizard, plus 5,958 vendored for animations) | — |
| Automation it installs | The Tower method, 111 files: 10 workflows (2,384 lines), 36 runner-script files (4,564), 11 guards with `lib`/`run-all` (684), 8 prompts (449), 4 method documents (1,486), 43 precedents | Its own rewrite: 10 workflows plus scripts, 2,116 lines in total. `devos-cycle.yml` has 77 lines and `cycle.mjs` 564 | Same as our payload, plus 2 later supervisor fixes (§6) |
| Tests | 83, plus CI on Ubuntu and Windows | 172 (all pass), no CI | the method's own tests, plus a real project |
| How the files get into a project | Deterministic: a manifest and lock, a three-way upgrade with rollback, provenance against the Tower | The configuration model **copies** templates into the project, then guards check the result | — |

---

## 2. The journey from an empty folder to a running cycle, step by step

`✓` done · `◐` partly · `✗` missing.

| # | Step | Our engine | Engine B | What we take |
|---|---|---|---|---|
| 1 | Machine check | ◐ `doctor` checks `gh` only; `init` checks `claude` | ✓ Node ≥ 22, git, gh **with token scopes (`repo`, `workflow`)** checked via `gh api user`, every agent CLI with sign-in and account | **Take.** Without the `workflow` scope, pushing `.github/workflows/` is refused. Our `init` does not check it, so the push can fail on a fresh `gh` login |
| 2 | Contract | ✓ shown in full, typed `accept`, nothing written before (D-E3) | ✗ no contract step (README only) | Keep ours |
| 3 | Agents and models | ◐ E15 (fence issued): reviewer, light, pool, policy, blueprint agent; Claude Code and Cursor | ✓ detects 6 tools (Cursor, Claude Code, Codex, Gemini, Muse, GLM) plus custom tools. Model lists are seeded and merged with what each CLI reports. Account and plan detection, a "free plan = Auto only" hint, a recommended configuration model, and **builder strengths** (ui, backend, data, tests, fast, deep) | **Take** detection, model lists, adapters and strengths into E15–E17 |
| 4 | Project questions | ✓ 8 questions (name, brief, users, data, sign-in, languages, deploy, visibility) | ✓ name, slug, brief, audience, visibility, **attached documents** (.md/.txt/.csv/.json/.yaml), `OPEN_QUESTIONS.md` for gaps | **Take** attachments and open questions |
| 5 | Project type, framework, modules | ✗ v1 assumed Next.js (D-E7) | ✓ 16 types, 21 stacks with their commands, 16 modules with providers and env names, cross-module rules, architecture manifests | **Take** the catalogue as data (E18); the method must learn to use it (E19) |
| 6 | Summary and confirm | ◐ E15 adds it | ✓ | — |
| 7 | Install the method | ✓ deterministic install, manifest and lock, `.claude/settings.json` held back | ◐ the model copies templates; guards check 11 areas | Keep ours |
| 8 | Blueprint (documents, T01) | ✓ headless blueprint prompt, guards `phases`/`naming`, 5 rounds, approve or ask for changes, `--continue` | ✓ one "configuration model" run that writes the documents **and scaffolds the stack** (manifests, configs, architecture, health route, architecture test) | **Take** the scaffold idea, but deterministic from stack templates (E20). The model writes documents only |
| 9 | Run the model safely | ✓ allowed-tool lists; `.cmd` quoting | ✓ `spawn.mjs` (Windows-safe, prompt on stdin, kill the whole process tree), stream-json progress, Stop / Ctrl-C, classifiers for usage limit, trust gate, plan limit and command rejection | **Take** `spawn.mjs`, the classifiers and Stop (E16) |
| 10 | Local commit and repository | ✓ git init, commit, `gh repo create`, push | ✓ plus **adopting an existing repository** and a fallback when GraphQL says "Could not resolve" | **Take** adoption (E16) |
| 11 | Repository settings | ✓ Actions may open PRs; `DEVOS_VERCEL` variable | ◐ variables for the active modules | Merge both (E18) |
| 12 | Secrets | ✓ each value typed into `gh`'s own prompt; only the tools in use (E15) | ✓ three paths: gh's hidden prompt; a **local file** `devos/secrets.local.json` (values on disk, gitignored); a **password card in the browser** (value → engine → `gh` stdin). A where-to-get line for 50 keys | **Take** the where-to-get catalogue. Disk and browser paths are an owner decision (§7, D2) |
| 13 | Check settings | ✓ `setup-check --for cycle` | ✓ `devos keys --check`, `verify` / `fix` / `watch` audit loop with "who fixes it" | **Take** verify/fix/watch (E21) |
| 14 | First cycle | ✓ dispatch with retries | ✓ dispatch, then **watch the run until it is green**: reads the failed run's log, finds keys that were empty, repairs and re-dispatches | **Take** the first-green-run loop (E21) |
| 15 | Resume | ◐ `init --continue` (blueprint or setup) | ✓ `devos continue`: an ordered checklist (answers → guards → dependencies → GitHub → secrets), each step done/todo/wait with who owns it; asks the model for a fix only with your approval | **Take** (E16) |
| 16 | Upgrade | ✓ three-way, branch and PR, conflicts listed, rollback | ✓ similar (hash baselines, rollback) | Keep ours |
| 17 | Guided UI and animations | ✗ terminal | ✓ localhost wizard (9 steps), live progress, Stop button, animated figures (`hairline`, MIT) | **Take last** (E22), as you asked |
| 18 | Engine docs | ◐ PLAN, fences, reviews | ✓ QUICKSTART, MANUAL, ARCHITECTURE (written for engineers and AI) | **Take** the shape for E10 |

**What is missing in our engine before GitHub**, in one list:
- the gh scope check (`repo`, `workflow`);
- agents beyond Cursor and Claude Code, model lists, and strengths;
- a stack and module catalogue;
- attached documents and open questions;
- a scaffold the first checks can run on;
- Windows-safe long runs with Stop and progress;
- `devos continue` with a checklist and repository adoption;
- watching the first run until it is green.

---

## 3. The GitHub automation (after init): Engine B's cycle vs the Tower's method

Engine B wrote a new, much shorter cycle. Reading it, I found defects that would break a real project. Line numbers
refer to Engine B's `payload/modules/automation/template/`.

| Defect in Engine B's cycle | Where | Effect |
|---|---|---|
| A reviewer PASS merges **even when checks are red**. `checksFailed` is recorded and never read again | `scripts/devos/cycle.mjs` 348 vs 480–500 | Red code reaches `main`. This breaks "red overrides PASS" (our PR-08) |
| It merges by `git merge` + `git push origin main` from the runner, not through the pull request | `cycle.mjs` 491–493 | Bypasses branch protection and required checks |
| After a merge the ledger is updated on disk but **never committed** | `cycle.mjs` 495, `common.mjs` `updatePhaseRow` | `docs/PHASES.md` on GitHub never shows T01 done, so the next run starts T01 again |
| Each attempt **recreates `task/Tnn` from `main`**, so the fence the reviewer rewrote (pushed to the task branch) is lost and the attempt number restarts | `cycle.mjs` 219–223, 517–522 | The attempt limit is never reached, and the same failing fence repeats |
| The usage-limit park is written to `devos/state/`, which the cycle itself gitignores | `cycle.mjs` 61–68, 270; `resume.mjs` | The next workflow run has a fresh checkout without the file, so a parked task never resumes |
| A "Key presence" step **echoes the secret variables** into the log and relies on GitHub's masking | `.github/workflows/devos-cycle.yml` 36–44 | Masking fails for transformed or multi-line values. Never print secrets |
| Builders can edit fences, reviews and workflows (no role-surface guard) | — | The builder can change its own contract |
| The reviewer gets only `git diff --stat`, a 31-line prompt, and a checkbox format | `devos/prompts/reviewer.md` | No evidence pack, no light/deep modes, no visual check |
| The local wizard server has no session token and no Origin/Host check on `POST /api/confirm`, `/api/keys`, `/api/stop` | `lib/server.mjs` | A web page open in the same browser can post to `127.0.0.1:7788` |

Engine B's tests pass because they check the local working copy, not what reaches GitHub.

**What the Tower's method has that Engine B lacks entirely:**
- PR-based merges with required checks;
- the verdict file validated against a schema, and red-overrides-PASS (PR-08, PR-21);
- the role-surface guard (PR-07) and role kits (PR-42);
- human gates for risk 3, schema changes, and tasks without a next fence;
- light/deep review modes with deep paths;
- the method-fix track (PR-28);
- two accounts per tool with rotation, a watchdog, and parking that survives runs (PR-12, PR-29);
- the evidence pack, screenshots and motion evidence (PR-35);
- the gate doctor, and a supervisor that explains failures and fixes what is safe (PR-36);
- issue intake for change requests and `/devos revise`;
- deploys with Supabase backups and migrations, plus the R2 and Firebase modules;
- the setup issue with resumption (PR-27);
- a local runner (`loop.mjs`);
- 11 guards;
- staged fences (PR-38);
- 43 precedents.

**Conclusion.** Engine B's cycle must not replace the Tower's. Two small ideas from it are worth taking into the method
later:
- comments on the pull request at each stage (builder outcome, checks, verdict), with `devos/checks` and `devos/verdict` statuses;
- installing every selected agent CLI in the workflow (`install-clis.mjs`).

---

## 4. Our engine: strong and weak points

**Strong**
- **The method is proven.** It is the Tower's, frozen at `a49ca6d`, generalized (E03), with precedents and a manual
  that `guard:manual` keeps in step.
- **Deterministic install and upgrade.** A manifest, a lock, a three-way upgrade, rollback, and provenance checked
  against the Tower.
- **Safety by design.** The contract before anything is written. Secrets only typed into `gh`. Settings held back
  during the blueprint. No git and no gh for the models.
- **Discipline.** Every task has a fence, a local review, a remote review, and CI on Ubuntu and Windows. Defects get
  caught (E05 rollback, E12 YAML, E07 error output).

**Weak**
- **Onboarding is bare:** terminal questions, two tools, no model lists, no catalogue.
- **The method assumes Next.js and pnpm.** `run-checks` runs `pnpm run …`, `ci.yml` uses pnpm, and the `design`,
  `i18n`, `boundary` and `literals` guards look at `src/`. Cursor rules carry the bilingual RTL rule
  (`20-bilingual-rtl.mdc`). In a Python, Go or mobile project, `run-checks` finds no `package.json` and skips every check except the guards, so nothing is really tested and red-overrides-PASS protects nothing.
- **Nothing proves the first run is green.** `init` stops at "dispatched".
- **Slow and costly to build:** two reviews per task, and the Claude weekly limit stops work. To save it, use Sonnet
  for risk 1–2 and keep Opus for risk 3.
- The handbook still names its case study (follow-up for E10).

---

## 5. What to take from Engine B, and what not

**Take.** All of it is zero-dependency Node, the same constraint as ours. Each item is ported as engine code with
its tests, behind our fences.

| From Engine B | Lands in |
|---|---|
| `lib/spawn.mjs` (Windows-safe spawn, prompt on stdin, `killPidTree`) | E16 (and E15 uses it) |
| `lib/probes.mjs`, `lib/accounts.mjs` (detection, model lists, account and plan, **gh scopes**) | E15 / E16 |
| `lib/adapters.mjs` launch recipes and classifiers (usage limit, trust gate, plan limit, command rejection) | E15 (local), E17 (runner) |
| `payload/catalogue.json` tools, `seedGroups`, `builderStrengths`, custom tools | E15 / E17 |
| `payload/catalogue.json` types and modules, `payload/stacks/*.json`, `payload/architecture/*`, module env names | E18 |
| `lib/keys.mjs` `KEY_SOURCES` (where to get each key) | E18 / E21 |
| Attached documents → `devos/intake-docs/`, `OPEN_QUESTIONS.md` | E15 |
| `lib/continue.mjs` assessment checklist, repository adoption from `initgithub.mjs` | E16 |
| `lib/verify.mjs`, `fix.mjs`, `watch.mjs` (audit with who-fixes), the first-green-run loop | E21 |
| `lib/progress.mjs` reducer, `streamjson.mjs`, Stop | E16 (terminal), E22 (UI) |
| `ui/` wizard and the `hairline` figures (MIT, with attribution) | E22 (UI polish) |
| QUICKSTART / MANUAL / ARCHITECTURE style | E10 |

**Do not take**
- **The cycle and its scripts** (§3). The Tower's method stays.
- **A model copying the automation files.** Our deterministic installer stays.
- **A model calling `init_github`.** The engine creates the repository only after you approve.
- **Echoing secret variables in a workflow.**
- **Secret values on disk** (`secrets.local.json`), unless you decide otherwise (D2).
- **The local server as written.** If the UI comes (E22), it needs a per-session token plus Origin and Host checks.
- **Its licence draft.** The licence is decision D-E4.

---

## 6. The Tower's latest method, as the engine's core modules

Since the pin `a49ca6d`, the Tower has 28 commits. Only **two** change the method, both in the supervisor:
- `74d54be` "the supervisor re-runs a deploy that an outside service broke before the site moved (PR-36)";
- `02564ef` "the supervisor closes finished requests (PR-36)".

Both change `scripts/devos/supervisor.mjs`, `AUTOMATION.md` and `PRECEDENTS.md`. The other method-path changes are
product code (`scripts/scene/`, `scripts/site/`). So **our payload is the Tower's latest method minus those two
fixes**, which become port task P1.

The core modules of the method, with nothing Tower-specific:

| Function | Files (in a project) |
|---|---|
| Run one task attempt | `devos-cycle.yml`; `next-task`, `agents`, `builder-model`, `render-prompt`, `role-env`, `accounts.sh`, `agent-watchdog.sh`, `progress.sh`, `builder-status`/`builder-report`, `guard-surfaces`, `run-checks`, `checks-status.sh`, `evidence`, `screens`, `review-mode`, `verdict`, `heavy`, `limits`/`limit-check`, `sync-main.sh`, `rescue.sh` |
| Move between tasks | `devos-advance.yml`, `devos-wait.yml`, `devos-resume.yml` |
| Talk to the human | `devos-intake.yml` (change requests, `/devos revise`), `devos-doctor.yml` (gate doctor), `devos-supervisor.yml` + `supervisor.mjs`, `devos-setup.yml` + `setup-check`/`setup-issue` |
| Deliver | `devos-deploy.yml` + `vercel-deploy.sh`; modules `supabase`, `r2`, `firebase` |
| Keep rules | `scripts/guards/` (11 guards, `config` included), `ci.yml` |
| Run locally | `loop.mjs` (the same cycle with your logged-in CLIs) |
| Instruct the agents | `devos/prompts/` (8), `devos/schemas/` (4), `.cursor/rules` (8), skills (3 + 1), Claude agents (3), hooks, role kits |
| Explain the method | `docs/method/` handbook, `AUTOMATION.md`, `FULLSTACK_MODULE.md`, `PRECEDENTS.md` |

**Tower-only (never in the engine):** the dashboard app, its scenes and art, the ingest route (OIDC) and the GitHub
webhook receiver. Those last two are what the engine will report to later (E09, after Tower tasks TR1/TR2).

---

## 7. Decisions for you

- **D1 — Base repository.** Recommended: **ours**. Engine B's engine code is tied to its own cycle: its `project.json`
  shape, its fence headers, and guards that require its workflow names. Switching the base would mean rewriting most
  of it anyway.
- **D2 — How secret values are entered.** Recommended for v1: only `gh`'s own hidden prompt, as the contract says
  ("DEV_OS never reads or stores a secret value"). Engine B's browser card and local file are friendlier, but the
  value passes through the engine or sits on disk. Choosing them means changing the contract text.
- **D3 — Tools in v1.** Recommended: every tool in the local onboarding (detection and blueprint). On GitHub, Claude
  Code and Cursor now, then Codex and Gemini as soon as each passes a real run on a runner (E17). The others stay
  "experimental".
- **D4 — Every kind of project.** Recommended: ship the whole catalogue, but mark stacks as **proven** only after a
  real end-to-end run. Proven first: Next.js (web), one API stack (Hono or FastAPI), one CLI or library. The rest are
  "preview".
- **D5 — Who scaffolds the stack.** Recommended: the engine, deterministically, from stack templates. The blueprint
  model writes documents and T01. T01 builds the first slice, so the first checks have a real tree.
- **D6 — Licence (D-E4)** before the release. `hairline` is MIT and keeps its attribution if adopted.
- **D7 — PLAN §3 order** (install before blueprint) is still open from E06.

---

## 8. Final roadmap (replaces the tail of PLAN §12 once you approve)

The order follows your words: a solid engine for every kind of project, running smoothly on GitHub first; polish
after.

| Phase | Task | What | Takes from |
|---|---|---|---|
| 0 | **E07 merge** | Done (PASS a2, remote MERGE) | — |
| 0 | **P1** | Port the two supervisor fixes (PR-36) from the Tower | Tower |
| 1 Core | **E15 v2** | Agents: detect every tool, model lists (seeded and CLI-reported), roster with **strengths per layer**, the blueprint on the chosen tool and model, `project.json` agents, credentials by tool (PR-44), attached documents and `OPEN_QUESTIONS.md`; numbered terminal menus | B: probes, adapters, catalogue tools |
| 1 Core | **E16** | Preflight and resume: gh scopes `repo`+`workflow`, accounts, confirm before GitHub, adopt an existing repository, `devos continue` checklist, `spawn.mjs`, Stop / Ctrl-C, terminal progress | B: accounts, spawn, continue, initgithub fallbacks, progress |
| 1 Core | **E17** | The cycle runs Codex and Gemini too: runner adapters, CLI install in the workflow, role kits per tool, reviewer picks by strength (method change) | B: adapters and install-clis ideas, mirrored into the Tower method |
| 2 Any project | **E18** | Catalogue: 16 types, 21 stacks with commands, 16 modules with providers, env names and where-to-get keys; answers carry the stack | B: catalogue, stacks, keys |
| 2 Any project | **E19** | Generalize the method by stack: `required_checks` run the stack's commands (not pnpm only), `ci.yml` per package manager, guards apply by stack and module (N/A where they do not), screens only for UI types (method change) | Tower method + B stack commands |
| 2 Any project | **E20** | Deterministic scaffold: stack configuration, architecture skeleton, health route, architecture test, from `payload/architecture` + stacks; checks green before T01 | B: architecture manifests, stack templates |
| 3 Green | **E21** | First green run: watch the dispatched run, diagnose from its log (empty keys, missing CLI, mapping), `verify` / `fix` / `watch`; the real end-to-end run (former D8) on two stacks | B: verify, fix, watch, continue rounds |
| 3 Green | **E08** (+ **E14**) | UI/UX gate: design contract and specification guard, then evidence (axe, captures as checks) — for UI project types | Tower method |
| 4 Polish | **E22** | Guided UI: localhost wizard with a session token and Origin checks, live progress, Stop, animations; terminal stays as fallback | B: `ui/`, hairline |
| 5 Dashboard | **E09** | Registry link: report steps, registration, receipt — after Tower tasks TR1/TR2 | Tower ingest |
| 6 Release | **E10** | Clean repository, licence, QUICKSTART / MANUAL / ARCHITECTURE, a second machine from zero to T01 merged | B: documentation style |

**How the merge happens in practice.** There is no git merge between the repositories. Each task above names the
Engine B files it ports. The builder copies and adapts them into `lib/` with their tests. The fence pins each source
file to the zip's hash, so the copy is exact and reviewable. Engine B stays outside the repository; the clean release
(D-E10) contains only what the tasks landed.

**Process, so the weekly limit stops less work:**
- Sonnet for local reviews of risk 1–2; Opus only for risk 3.
- The remote check stays mine.
- Fences say "Stages" for big tasks, so a limit mid-task loses one stage, not the attempt.
