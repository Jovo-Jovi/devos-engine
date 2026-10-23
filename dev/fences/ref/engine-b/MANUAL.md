# DEV_OS — the full manual

This is the complete reference for DEV_OS Engine: what it is, every command
with every flag, every file it writes, what appears on GitHub, what happens
when something fails, and the security rules that hold the whole design
together. Quick steps live in **QUICKSTART.md**; the internals for engineers
and AI models live in **ARCHITECTURE.md**.

---

## 1. What DEV_OS is

DEV_OS turns one guided configuration session into a self-developing
repository:

1. **You configure once**, on your own computer, in a guided wizard.
2. **The configuration model** — the strongest reasoning model signed in on
   your machine — writes the entire project skeleton and creates the GitHub
   repository. It runs exactly once and is never called again.
3. **GitHub Actions continues development**: the **reviewer** model reviews
   work and writes the next task, the **builder** model implements it, checks
   run on every push, and **you merge** at the human gates.

The three model roles, and the one rule that shapes everything:

| Role | Chosen by you | Runs | Forever after |
|------|---------------|------|---------------|
| Configuration model | at init | once, locally, in a sandbox | never called again |
| Reviewer | at init | on GitHub Actions | reviews every task, writes the next task |
| Builder (default + pool) | at init | on GitHub Actions | implements the current task |

The configuration model is never a reviewer or builder role, and the
automation refuses to run if anything tries. That rule is enforced in the
bootstrap guards, in the CI-side runner, and in the fences.

---

## 2. Prerequisites

| Requirement | Minimum | Checked by |
|-------------|---------|------------|
| Node.js | 22 | `start.sh`/`start.bat`, `devos doctor`, `devos init` |
| git | any recent | same |
| GitHub CLI (gh) | installed, `gh auth login` done, token has `repo` + `workflow` scopes and is API-verified | same, before any model runs |
| At least one AI CLI signed in | Claude Code, Cursor Agent, Codex, Gemini CLI, Z.ai (`z`), or Muse | same (warning only) |

The engine itself has **zero npm dependencies** and runs as plain ESM on
Node 22+. `npm test` runs the whole test suite offline.

---

## 3. Command reference

### `devos init` — new project

1. Runs the machine check; refuses to start (with fixes) if Node < 22, git
   missing, or gh missing / not signed in / scopes missing.
2. Serves the guided UI at `http://127.0.0.1:7788` (binds to localhost only;
   ports 7788–7808 are tried). Mirrors every event to the terminal.
3. If no browser opens, the same steps run as a numbered terminal wizard.

**Live progress while the model writes.** The terminal shows the model's whole
conversation live — Cursor runs in `--output-format stream-json` mode, so each
assistant message (`[agent] says…`), file write (`writes …`), and command
(`runs …`) appears the moment it happens, never buffered to the end — under a
one-line todo checklist plus a status line — `▸ 34% · 14 files · 3 modules ·
1m 42s · last output 8s ago · writes src/app/page.tsx · reconnecting ×2` —
refreshed on activity and heartbeat every 30 s. The UI run panel shows the
same as a percentage bar + todo list + counters + full log feed. The
percentage moves on real milestones (files, modules, repair rounds, GitHub)
with a slow time floor while the model is silently working, and freezes (never
fakes) on failure.

**The hairline figure stage.** While the model works, the UI run panel keeps
company with a rotating line-drawn figure — Terminal, firecrawl-reader,
Cabinet, cursor-tab, Slow (from hairline.lucasmarkes.com; the package is
vendored MIT-licensed in `ui/hairline.js`, the two custom figures in
`ui/hairline-custom.js`, the rotator in `ui/hairline-stage.js`). Each
animation switches to the next one on every phase change and every 20 s;
figures rest under `prefers-reduced-motion`.

**Stop / kill.** Two equivalent controls: the red **■ Stop** button in the UI
run panel (`POST /api/stop`), or **Ctrl+C** in the terminal. Both set the
run's stop flag and kill the model's whole process tree (`taskkill /T /F` on
Windows, SIGTERM→SIGKILL on POSIX). The run ends as `stopped: true` — "Stopped
by you", not a failure — keeping everything written so far; resume with
`devos init --continue <folder>`. A second Ctrl+C force-quits devos itself.

Flags: none. Environment: `DEVOS_PORT` overrides the port; `DEVOS_NO_BROWSER=1`
forces the terminal wizard.

### `devos continue [<folder>] [--model <id>] [--cli <tool>]`

The smart resume for a project that already started — after an error, a usage
limit, or a Stop you did not mean to press. `<folder>` defaults to the last
project. The run has four moves, in order:

1. **Check** — prints what is done and what is missing (answers, guards, deps,
   repository, secrets), each step with its owner. Nothing is changed yet.
2. **Model, only if the tree fails the guards** — the configuration model
   resumes with the saved (or overridden) model/tool; overrides are persisted.
   A tree that already passes never wakes the model again.
3. **Engine steps** — `npm install` (or the stack's own install command; the
   installed marker is `node_modules`, or the engine's continue-state record for
   go) and then init_github, both run BY the engine. A repository that already
   exists is adopted: verified, remote aimed, main pushed (a rejected push is
   retried once as a rebase with the project tree winning conflicts), variables
   set, first cycle dispatched, setup issue opened. When gh answers GraphQL
   "Could not resolve to a Repository" (the slug's owner is not the account gh
   is signed in with, the name differs slightly, or the repo does not exist
   yet), devos looks under the signed-in login (`gh api user`), matches by name
   in your repository list, adopts what it finds under its real name — and only
   then retries the create itself. "Could not resolve" can no longer end the
   run.
4. **Consult on a stubborn failure** — if the install or the GitHub step still
   fails after every engine attempt, the configuration model is asked ONCE to
   analyze the exact error and propose a fix: `diagnosis`, at most 5
   non-interactive local commands, and the steps only you can do. The proposal
   prints in the terminal (`Apply this fix? [y/N]`) or shows as an
   Approve/Decline card in the browser. Approved: only the listed commands run
   (`[fix] …`), then the failed step is retried once. Declined, unanswered, or
   stopped: nothing is applied and the ordinary resumable failure prints.
   Secret values never appear in a proposal; logins/plans/keys are listed as
   user steps, never run.
5. **Finish the keys with you — your choice of three paths.** The run does not
   stop at a list of names anymore. The keys stage writes `devos/SECRETS_GUIDE.md`
   (the configuration model organizes the where-to-get steps in an interactive
   terminal; the built-in catalog is the fallback) and creates
   `devos/secrets.local.json` (gitignored — it never leaves the folder and no
   model ever reads it). Then devos asks once, and remembers the answer:

   1. **You paste** (default) — you fill the file; the run WAITS in the terminal
      and uploads each key the moment you save. Ctrl+C is a safe pause.
   2. **The model walks you through** — the configuration model requests each
      key by NAME (`request_secret NAME`); you type each value into gh's own
      hidden prompt; the model receives only set/missing. Anything left over
      falls back to the local file.
   3. **The wizard window's Missing keys card** — in a UI run the browser shows
      one password field per missing key; you type the values there, Submit,
      and the engine uploads them (`gh secret set`, stdin-only), re-checks
      GitHub's own list, and re-opens the card carrying only the names still
      missing — until GitHub confirms every key and the run continues on its
      own. A value lives in the POST body and the gh pipe and nowhere else.

   Either way a value never touches chat or any model. Non-interactive runs
   print the steps and exit with exact instructions; `--keys-mode local|model`
   picks a path without asking. The final line says "fully set up" only when
   GitHub itself confirms every needed key AND the first cycle run has finished
   green — until then, every `devos continue` is another round.

   **The first-run loop.** The configuration model's job is not "the repository
   exists" — it is "the FIRST `devos-cycle` run is green with the selected
   keys". Each `devos continue` works the current round from GitHub's own
   truth: a run already going is watched to the end; a green run records the
   goal (`devos/state/continue.json` → `first-run-green`) and the engine is
   done — from there any issue continues on GitHub (human-gate PRs); a failed
   run is diagnosed from its own log (the failing step's words, plus WHICH
   keys the run saw as EMPTY — judged only among the keys of the tools YOU
   selected; an unselected tool's key is named once as irrelevant), and then
   the engine fixes what it can before spending the round: a selected key with
   no value on GitHub opens the intake right there (type the values into the
   **Missing keys card in the wizard window** — the engine uploads each one and
   re-checks, re-opening the card until GitHub confirms every key — or paste
   into `devos/secrets.local.json`, or let the model walk you through gh's
   hidden prompt; a value never reaches the model, a log, or an event), and
   selected keys that ARE on GitHub yet were seen EMPTY point at the workflow's own
   mapping — the engine reads the repository's `devos-cycle.yml`, repairs it
   deterministically (a top-level `env:` block every step inherits, plus
   `secrets: inherit` in callers), pushes it, and dispatches a FRESH run that
   is watched to a plain-English report. Nothing is ever "spent": a red round
   never blocks the next one — apply the fix the report names (`devos keys`
   for a key, `devos upgrade` for an outdated engine), then run `devos
   continue` again. Every round is written to the ledger (`cycle-attempts`)
   so the story is always readable.

```
devos continue C:\path\to\project              # check + finish
devos continue <folder> --model auto            # Cursor picks (Free plans)
devos continue <folder> --cli claude            # switch the tool
devos continue <folder> --keys-mode model       # the model walks you through the keys
devos continue <folder> --keys-mode local       # paste into the file, engine uploads
devos continue <folder> --no-wait-keys          # print the steps and exit
```

Exit codes: 0 when the setup is finished, 130 after a deliberate stop
(resumable), 1 on a failure (the remaining-steps list prints).

`devos init` also points at a started project: the terminal prints the
`devos continue` line for the last project (and anything beside the workspace),
and the guided UI shows a continue card with the same checklist before the
question wizard.

### `devos init --continue <folder> [--model <id>] [--cli <tool>]`

The same smart resume as `devos continue` (kept for old habits and old docs):
check for misses first, then finish the missing steps — the model only when the
guards still fail.

Resumes a stopped setup at the configuration model without re-asking the
questions. The answer file at `<folder>/devos/answers.json` is the source of
truth; `--model` / `--cli` **patch and persist** it, so later resumes keep the
override. Typical uses:

```
devos continue C:\path\to\project                    # check + finish (smart resume)
devos continue <folder> --model auto                  # Cursor picks (Free plans)
devos continue <folder> --cli claude                  # switch the tool
devos init --continue <folder>                        # the same flow, old spelling
```

A failed run always ends with the remaining-steps list (audit rows, each with
its fix and its owner: you or the model).

### `devos doctor [--json]`

The machine checklist: Node, git, gh (login, API-verified token, scopes), and
every agent CLI as ready / signed-out / missing / optional, with account email
and plan where the CLI reports one. `--json` prints the same as JSON.

### `devos status [<folder>]`

Saved models (configuration/reviewer/builder), active modules, and the latest
`devos-cycle` run with its URL. Uses the last project when no folder is given.

### `devos agents detect`

Every detected CLI as JSON: status, version, signed-in state, account, model
groups (seeded catalogue ids ∪ ids the CLI itself reports; ids reported by the
account sort first and are marked "on your account").

### `devos accounts`

Two sections. **GitHub credentials**: installed, signed in as, token scopes,
whether the token works against the API, and the exact fix if not.
**Agent CLIs**: per tool — signed-in account and plan, the models that account
reports as available, and tool-specific guidance (Cursor two-account note,
Claude weekly-limit note). This answers "who am I paying on which tool, and
can that account run the model I picked?" before anything runs.

### `devos verify [<folder>] [--json]`

The full-journey audit. Four sections, one row per check:

- **MACHINE** — Node 22+, git.
- **GITHUB** — gh installed, login, API-verified token, `repo`+`workflow` scopes.
- **AGENTS** — the CLI you actually chose as configuration model, audited
  deeply: installed, signed in, and is the chosen model in that account's own
  list (a Cursor model outside `agent models` warns with the account-switch
  fix before you burn a run on it). CLIs you did not choose get no rows once
  a choice exists, and only quiet info rows (never fixes) before it.
- **PROJECT** — answer file valid, bootstrap guards, repository created and
  visible, required workflows present, secrets set (names only), first cycle
  run status.

Every not-ok row carries `fix` (the exact command) and `who` — `you` (logins,
plans, key values; never sent to any model) or `model` (project-folder
problems; `devos fix` handles them). Exit code 1 while not ready. `--json`
prints the rows for scripts and the UI.

### `devos fix [<folder>] [--cli <tool>] [--model <id>]`

The model-executed half of the loop. Loads the answers (applying and
persisting `--cli`/`--model` overrides), audits, and:

- **Nothing model-fixable?** The model is never invoked. You get the report
  and the list of your own steps.
- **Model-fixable rows exist?** They go to the configuration model as a plain
  repair prompt — same restricted sandbox as init (file tools + the two
  shims, nothing else, no secret values anywhere in the prompt) — then the
  project is re-audited and the before → model pass → after report prints.

Usage limits, trust gates, and plan walls during a fix are classified exactly
like during init, with the same recovery commands.

### `devos watch [<folder>] [--interval <sec>] [--once] [--max-passes <n>] [--json]`

`devos verify` in a loop. One pass is the **full audit, everything at once**;
then it re-tests every `--interval` seconds (default 15, minimum 3). Each pass
re-reads the answer file and re-probes machine/GitHub/accounts, so fixes by
you or by `devos fix` appear on the next pass automatically. Rows whose state
changed since the previous pass print with a `*`. The first all-green pass
prints **ALL GREEN** and the watch stops by itself. Ctrl+C stops politely.
Exit code 1 while not ready (so `--max-passes` makes it CI-usable). `--json`
prints one JSON document per pass.

### `devos keys [--check] [--push] [--project <folder>]`

The keys moment. Without flags: writes `devos/KEYS-NOTES.example.md` (names,
where to get each one, the security rules), creates `devos/secrets.local.json`
(the file the VALUES go into — gitignored, never pushed, never seen by a
model), and prints the organized steps.

With `--push`: uploads every value already present in
`devos/secrets.local.json` to GitHub (`gh secret set`, value piped on stdin)
and reports what is still missing.

With `--check`: compares `gh secret list` with what the project needs, prints
`ready` / `MISSING` per name, exits 1 while something is missing.

A key that already exists on GitHub but was set outside devos (e.g. by the
model) is reported as unconfirmed: paste the real value into the local file to
overwrite it, or set the value to `__keep__` to keep what is there.

The keys-mode choice (local file vs model walkthrough) is remembered in
`devos/state/keys-mode.json` — `devos continue` offers the remembered choice
as the default. Override for one run with `devos continue --keys-mode local|model`.

### `devos upgrade`

Run inside a bootstrapped project. Updates **engine files only** —
`scripts/devos/`, `scripts/guards/`, `devos-*.yml` + `ci.yml` workflows, and
`devos/prompts/` — on a branch `devos/upgrade-<version>`, using per-file
hash baselines (`devos/engine-hashes.json`) to detect files you edited
yourself: those are listed as conflicts and left untouched. Needs a clean
working tree; rolls back completely on any failure.

### `devos ui`

Opens the guided UI for a draft without running init (same server as init).

### `devos --help`

Every command in plain sentences.

### The start files

`start.bat` (Windows) / `start.sh` (macOS, Linux) print the machine
checklist, list every missing item with its download page, and start `devos
init` only after you approve. `--check` runs the checklist without prompting.

---

## 4. The guided setup, question by question

| Step | What you answer |
|------|-----------------|
| Machine check | read-only; blockers stop the wizard |
| How this works | the three roles on one screen |
| Models | reviewer, builder (+ extras with strengths), light reviewer (default: same as reviewer), who picks the builder (reviewer-picks or default-only), configuration model (recommended strongest available) |
| Project | name, slug `owner/name`, brief (≥20 chars), audience, private/public, attached documents |
| Project type | 16 catalogue types; each pre-selects recommended modules and framework |
| Framework | 21 stacks or custom (you supply install/typecheck/lint/test/build) |
| Core modules | 16 modules; automation locked on; database/auth/hosting validated against each other (e.g. Supabase Auth needs Supabase DB, shadcn needs a React framework) |
| Languages | product languages (default `en`) |
| Summary | everything on one screen — **Confirm** starts the run |

Draft autosaves to `~/.devos/draft.json`; "save as default" stores model ids
and preferences in `~/.devos/defaults.json`.

---

## 5. The configuration-model stage in detail

**Sandbox.** The model runs with cwd = the project folder. Its environment
has `DEVOS_PROJECT_DIR`, `DEVOS_ANSWERS`, `DEVOS_PAYLOAD`,
`DEVOS_REPAIR_ROUND`; `GH_TOKEN`/`GITHUB_TOKEN` are stripped. The only engine
tools are two PATH shims:

- `init_github` — create repo, push main, set variables, dispatch cycle, open
  setup issue. Runs **once**; refuses to run twice.
- `request_secret NAME` — runs `gh secret set NAME` with your real terminal
  so you type the value hidden; the model only hears `set` or `missing`.

No shell, git, gh, curl, wget, or rm is offered; the prompt forbids them.

**The run.** The one-shot prompt embeds the verbatim answer file, the module
state with template paths, and the 8-step build order (stack files →
devos.config.json + devos/project.json → architecture skeleton → automation →
product docs → progress events → init_github + request_secret → the exact
final line). The model streams JSON events (`{"event":"file",...}`,
`{"event":"module",...}`) that the UI shows live.

**Live conversation.** Cursor runs with `--output-format stream-json`: the CLI
emits one JSON event per line as it works, and `lib/streamjson.mjs` turns each
into the engine's own events — assistant messages become `[agent]` say lines,
write/read/shell tool calls become `writes …` / `reads …` / `runs …` lines, and
a completed write also counts as a `file` event. File paths are deduped against
the model's contract lines so each write counts once. The `result` event is
never repeated if the conversation already streamed it. Plain-text CLIs keep
the old pass-through behavior unchanged.

**Repair rounds.** After each model run the engine validates the tree with
the bootstrap guards (11 areas: project config, devos.config.json, stack
files, automation + docs, T01 fence headers, module parity, .env.example
names, no-configuration-model-in-automation, workflow YAML, architecture
manifest, DECISIONS records). Failures go back to the model as an explicit
repair-round prompt — up to 5 rounds, automatically.

**Classification of a stopped run.** Non-zero exit output is matched against
five outcomes before anything else — and a deliberate stop is checked first,
so killing the model can never be misread as a model failure: **stopped by
you** (Stop button or Ctrl+C; the stop flag is set and the process tree was
killed) → "Stopped by you — resume with `devos continue <folder>`";
**usage limit** (rate limit, quota, 429, credits, and Claude Code's
weekly-limit wording) → "a wait, not a failed task"; **permission wall** (the
model's commands — `npm install`, `init_github` — were rejected; Cursor print
mode needs `--force`, which the engine passes automatically) → update the CLI
(`agent update`) and resume; **trust gate** (Cursor's
directory-trust prompt) → the exact one-time fix (newer builds pass `--trust`
automatically so this never appears); **plan restriction** (Cursor Free's
"Named models unavailable") → the three ways out (`--model auto`,
`--cli <tool>`, upgrade). Anything else is a plain error with the last 8
lines. One exception mirrors the run's own rules: if GitHub was already set
up before the stop, the engine lets the guards judge the tree instead — the
bootstrap may already be complete. The permission wall is also recognized on
exit 0: a model that finished its turn, left a complete tree, but never called
`init_github` while its own words say commands were rejected is reported as
the permission wall, not the generic resume hint.

---

## 6. What lands in the project folder

```
project/
├─ devos/
│  ├─ answers.json            the verbatim product choices (resume source)
│  ├─ project.json            reviewer/builder/configurationModel + base main,
│  │                          maxAttempts 3, pickPolicy, requiredChecks, repo
│  ├─ config → devos.config.json (engine config in the project root)
│  ├─ state/
│  │  ├─ init.json            init_github state (status/repo/urls)
│  │  ├─ secrets.json         secret NAMES + set/missing only
│  │  └─ config-prompt.md     the prompt the configuration model received
│  ├─ intake-docs/            documents you attached
│  ├─ OPEN_QUESTIONS.md       model's questions to you (or "No open questions.")
│  ├─ KEYS-NOTES.example.md   keys guide (names only)
│  ├─ engine-hashes.json      upgrade baselines
│  ├─ fences/T01.md           the first task, with Reviewer/Builder headers
│  └─ prompts/                builder.md, reviewer.md, intake.md, revise.md
├─ .github/
│  ├─ workflows/              ci.yml + devos-*.yml (see §7)
│  └─ ISSUE_TEMPLATE/         change-request.yml, method-fix.yml
├─ scripts/
│  ├─ devos/                  cycle.mjs, common.mjs, advance, intake, doctor,
│  │                          resume, setup, supervisor, wait, deploy
│  └─ guards/run-all.mjs      the project's own checks
├─ docs/                      ARCHITECTURE, PHASES, PRODUCT_BRIEF, SCOPE,
│                             DECISIONS, GLOSSARY, BOUNDARY_MODEL,
│                             DESIGN_SYSTEM (UI types), method/AUTOMATION
├─ SETUP.md                   secret names + where to get them
└─ …stack files…              per your framework/modules; .env.example names only
```

---

## 7. What lands on GitHub

**Repository** — created at your chosen visibility from your existing `gh`
login; main pushed; first `devos-cycle` dispatched; setup issue opened when
secret names are still missing.

**Repository variables** — `DEVOS_ACTIVE_MODULES`, `DEVOS_TYPE`,
`DEVOS_FRAMEWORK`.

**Actions secrets** — only you set values: the reviewer tool's secret, the
builder tool's secret, and module secrets (e.g. `CURSOR_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `ZAI_API_KEY`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, ...).
The configuration model never gets a secret.

**Workflows** (from the automation template):

| Workflow | Job |
|----------|-----|
| `devos-cycle.yml` | one attempt of one task in five visible steps: resolve, Builder (heartbeat), Checks, Review, Verdict — the PR gets the builder outcome, the checks and the verdict as comments; devos/checks + devos/verdict statuses |
| `devos-intake.yml` | turns a change-request issue into the next task |
| `devos-advance.yml` | moves to the next phase/task after a merge |
| `devos-doctor.yml` | diagnoses a stuck project and opens a fix |
| `devos-resume.yml` | resumes an interrupted task |
| `devos-setup.yml` | verifies the setup once secrets land |
| `devos-deploy.yml` | deploys per the hosting module |
| `devos-wait.yml` | waits on long-running checks |
| `devos-supervisor.yml` | keeps the loop alive / retries safely |
| `ci.yml` | typecheck, lint, test, build on every push |

**Gates.** Pull requests labeled **`devos:human-gate`** are yours to merge
when `devos/checks`, `devos/verdict`, and `devos/gate` are green. Everything
else — including secrets and merging — stays with you.

---

## 8. Failure modes and recovery

Every failure ends in a step list, never a dead end.

| Symptom (classified) | What it means | Recovery |
|---|---|---|
| **Usage limit** — "usage limit", "rate limit", quota, 429, credits exhausted, "weekly limit… will reset" | the account hit a limit; the work is paused, not lost | wait for the reset, then `devos continue <folder>` (or resume on another CLI: `--cli <tool>`) |
| **Permission wall** — the model reports "Command execution was rejected on every attempt" (or the CLI refuses its commands) | Cursor print mode only *proposes* changes unless `--force` is passed; the engine passes it automatically, so a current CLI never shows this | update the CLI (`agent update`), then `devos continue <folder>` — the tree written so far is kept, and the engine now installs the dependencies and runs init_github ITSELF (the model is only woken when the guards still fail); recognized in the model's own words even on exit 0 |
| **Trust gate** — Cursor's "Do you trust the contents of this directory?" | one-time folder trust for a folder DEV_OS created | automatic via `--trust` on current builds; otherwise run `agent` once in the folder, answer Yes, quit, then `devos continue <folder>` |
| **Plan restriction** — "ActionRequiredError / Named models unavailable / Free plans can only use Auto" | the signed-in account's plan refuses the named model (the Pro-plan/different-account case) | `devos continue <folder> --model auto` · or `--cli <tool>` · or upgrade the plan, or switch the CLI account (`agent logout` → `agent login` as the paying user) and confirm with `agent models` |
| **Guard failure after 5 repair rounds** | the tree still fails the bootstrap checks | `devos verify <folder>` then `devos fix <folder>` (each fix pass is one targeted model run) |
| **init_github failed** | gh credentials/scope/visibility problem | the engine now tries the whole ladder itself: view → look under the signed-in login → listing match → adopt, then retry the create; if every attempt fails it consults the configuration model for a fix proposal that YOU approve (terminal y/N or the browser card) before anything runs; `devos continue` re-runs the stage safely — an existing repository is adopted (push rejected once → rebase with the project tree winning), and init_github never creates a second repo |
| **GraphQL: Could not resolve to a Repository** | the repo is not visible under the slug's exact name (different owner account, different name, or not created) | no action needed — `devos continue` resolves it: the engine searches under the real login, adopts a name-match from your repository list, or creates the repository; the run no longer dead-ends on this error |
| **Secrets missing** | names listed in the setup issue and `devos keys --check` | `gh secret set NAME --repo owner/name` per name, then re-run the cycle or push |
| **CLI not installed / signed out** | the chosen configuration tool is gone or logged out | install/sign in, or resume with `--cli <installed-tool>` |
| **Wrong Cursor account** (two accounts on the machine) | the CLI answered as the Free account; `agent status` may print no details | `devos accounts` shows what the CLI itself reports; switch with `agent logout` / `agent login`; judge by `agent models`, not by silence — "signed in (account details unavailable)" does NOT mean Pro |
| **Stopped by you** (`stopped: true`, "Stopped by you…") | you tapped ■ Stop in the UI or pressed Ctrl+C; the model's process tree was killed on purpose | nothing to fix — everything written is kept; resume with `devos continue <folder>` when ready (the UI offers the same as a button) |
| **Silence during writing** (no new lines for a while) | a large write, a slow model, or the CLI retrying its connection — the terminal heartbeat keeps printing `▸ N% · … · last output Xs ago · <last action>`, and `reconnecting ×N` means retries, not death | usually wait; the heartbeat proves the engine is alive and the percent still advances during silence; stop with the ■ Stop button / Ctrl+C if you decide to abandon the pass |

`devos watch <folder>` ties all of it together: one command tests everything
at once, again and again, stars whatever your last fix moved, and stops on
the first all-green pass.

---

## 9. The security model

1. **A key value is typed exactly once**, into the hidden prompt `gh secret
   set` opens. It never appears in chat, email, an issue, a file, or a
   prompt. The engine's answer-file writer refuses any field that looks like
   a secret value (`assertNoSecrets`).
2. **The configuration model never sees a secret.** Its environment strips
   `GH_TOKEN`/`GITHUB_TOKEN`; `request_secret` returns only `set`/`missing`.
3. **Repair prompts carry no secrets.** `devos fix` sends only model-fixable
   rows; logins, plans, and key values are structurally excluded (a test
   asserts no secret name leaks into the prompt).
4. **The sandbox is tool-shaped, not promise-shaped.** The model gets file
   tools plus the two shims — no shell, no git, no gh, no network tools.
5. **The UI binds to 127.0.0.1** only. Nothing is a hosted service; the
   engine is a local CLI with zero npm dependencies.
6. **The cycle never runs the configuration model** — enforced by the
   bootstrap guards and re-checked by the CI-side runner
   (`assertNotConfigurationModel`).
7. **`gh secret list` is the only read**, and GitHub never returns values.
   `devos keys --check` compares names only.

---

## 10. FAQ

**Can I use the same tool for reviewer and builder?**
Yes — the roles matter, not the ids. The wizard warns when one model would
grade its own work; you can continue.

**Can the configuration model be a local-only tool?**
Yes. Only the reviewer and builder must be GitHub-capable.

**Where is the draft saved?**
`~/.devos/draft.json` (autosaved); "save as default" writes
`~/.devos/defaults.json`. Answer copies accumulate in `~/.devos/answers/`.

**How do I change the configuration model after a failure?**
`devos continue <folder> --model auto` / `--cli <tool>` — the override
is persisted into `devos/answers.json`.

**How do I start completely over?**
Delete the project folder (nothing on GitHub was created unless init_github
completed) and run `devos init` again. If the repo already exists, reuse the
name or pick a new slug.

**Does the engine touch my global git/gh config?**
No. It runs `git` and `gh` with your existing login, only inside the project
folder.

**Windows specifics?**
Fully supported: the engine resolves `.cmd`/`.exe` shims through `where` and
spawns them safely (no deprecated `shell:true` + args array), and prompts
travel over stdin, never argv.

**What do I merge?**
Pull requests labeled `devos:human-gate` when `devos/checks`,
`devos/verdict`, and `devos/gate` are green.

**Where do the engine's own design decisions live?**
`DECISIONS.md` in the engine folder records them; `ARCHITECTURE.md` maps the
code for modifications.
