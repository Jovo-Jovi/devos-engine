# DEV_OS Engine

A local developer tool. You configure once, on your computer. The configuration model
writes your project and creates the GitHub repository. Then GitHub Actions continues
development with the reviewer model and the builder model you chose, while you merge
gates and type secrets.

- Command: `devos` — Package: `devos-engine` — Plain Node.js, ESM, Node 22 or newer.
- The engine is not a web framework. Each project it creates uses the stack you chose.
- The guided UI binds to 127.0.0.1 only. Nothing is a hosted service.
- New here? Open **QUICKSTART.md** — or just open `start.bat` (Windows) / `./start.sh`
  (macOS, Linux): it checks the machine, lists anything missing, and starts the guided
  setup after you approve.

## The path from an empty folder to automation

1. **`devos init`** — the machine check runs first. It shows Node, git, and gh, plus
   every agent CLI as installed and signed in, installed but signed out, or missing.
   It blocks only when Node is older than 22, git is missing, or gh is missing or
   logged out. A guided UI opens at http://127.0.0.1. If no browser can open, the
   same steps work as a numbered list in the terminal.
2. **You answer every question.** Nothing is created in a project folder and nothing
   is created on GitHub. The only files before confirm are under `~/.devos/` and they
   contain no secrets. You choose:
   - the **reviewer** ("After GitHub exists, this model reviews every task and writes
     the next task") and the **builder** ("After GitHub exists, this model writes the
     code") — GitHub-capable tools only — plus optional extra builders with strengths,
   - the **light reviewer** (default: same as the reviewer),
   - who picks the builder on later tasks (the reviewer picks from your pool, or
     always the default builder),
   - the **configuration model** (default: the reviewer; a local-only tool is allowed
     here and only here),
   - the project (name, slug, brief, audience, visibility), the project type, the
     framework, every core module, and the languages.
3. **You confirm the summary.** This is the first moment a project folder may exist.
4. **The configuration model runs once.** It receives your answer file and the
   core-module templates. Its only tools: write and edit files inside the new project
   folder, read the engine's core-module templates, `init_github` (once), and
   `request_secret NAME`. It is forbidden a raw shell, git, gh, curl, wget, rm,
   secret values, and calls to any reviewer or builder CLI. It writes the stack
   configuration, the codebase architecture, the active modules, the product
   documents, and the automation wired to your reviewer and builder.
5. **`init_github` is its last act.** The engine, using your existing `gh` login,
   creates the repository at the chosen visibility, pushes main, writes repository
   variables for the active modules, and dispatches `devos-cycle`.

The keys moment belongs to the engine now (see "Keys and tokens" below): on the
next `devos continue` the stage writes `devos/SECRETS_GUIDE.md` (the configuration
model organizes the where-to-get steps), creates the gitignored
`devos/secrets.local.json` fill-in file, and — your choice — either opens the
**Missing keys card in the wizard window** (type each value there; the engine
uploads it and re-checks, re-opening the card for anything still missing), waits
for you to paste the values into the local file (it uploads each the moment you
save), or has the configuration model walk you through every key while you type
each value into gh's own hidden prompt. A value never reaches chat, an issue, a
guide, an answer file, a log, or any model — the browser card is a password
field whose content travels browser → `gh secret set` and nowhere else.
6. **The engine's job ends at a green first run.** The configuration model's
   goal is not "the repository exists" — it is "the FIRST `devos-cycle` run
   finishes green with the selected, tested keys". Until then every `devos
   continue` is another round: it reads the failed run's own log and judges
   ONLY the keys of the tools you selected (an unselected tool's empty key is
   named once as irrelevant — never your problem), offers the intake for the
   real values right in the flow (the **Missing keys card in the wizard
   window**, the gitignored `devos/secrets.local.json`, or gh's hidden prompt —
   the engine uploads every value itself and re-checks GitHub's own list,
   re-opening the card until nothing is missing; a value never reaches the
   model), checks the repository's workflow and repairs its secret mapping when the
   run saw keys empty that GitHub holds (a top-level env block every step
   inherits; names only, no values), dispatches a FRESH run, watches it to the
   end, and reports. Once a run finishes green, the goal is recorded and the
   model rests: GitHub Actions continues — the builder writes code, the
   reviewer writes verdicts
   and the next task, and the cycle reads both from the committed
   `devos/project.json`.
7. **Your job (after the first green run)**: merge pull requests labeled
   `devos:human-gate` when `devos/checks`, `devos/verdict`, and `devos/gate`
   are green, and add anything the setup issue lists. Risk 3, a migration, a
   rules change, or a method change always waits for your merge. Any issue from
   here continues on GitHub — not in this engine.

If a run fails — a usage limit is a wait, not a failed task — resume with
`devos continue <folder>`: it checks what is done and what is missing, then
finishes the missing steps itself (the model only when the tree still fails the
guards, `npm install` and init_github by the engine — a repository that already
exists is adopted, never recreated, and a GraphQL "Could not resolve" reply is
resolved by finding the repo under your real login or creating it), or let
`devos-resume` unpark a cycle. If a step still fails after every engine
attempt, the configuration model proposes a fix and you approve it — `y/N` in
the terminal, an Approve/Decline card in the browser — before anything runs.

While the model writes, nothing is blind: Cursor runs with
`--output-format stream-json`, so the model's whole conversation — every
message, file write, and command — streams live (`[agent] …`) in the
terminal under a progress percentage and a todo list; the UI shows the same
as a bar + checklist + counters beside a rotating hairline figure (Terminal,
firecrawl-reader, Cabinet, cursor-tab, Slow), and a heartbeat proves the
engine is alive during silent stretches. Stop the run any time with the
UI's ■ Stop button or Ctrl+C — devos kills the model's process tree, keeps
everything written, and tells you the exact `devos continue` command.

## Commands

```
devos init                 Open the guided configuration UI and create a new project.
devos continue [<folder>]  The smart resume: check what is done, finish the missing
                           steps itself (model only when the guards fail; install and
                           init_github by the engine; an existing repo is adopted).
devos init --continue <folder>
                           Resume at the configuration model without asking again.
devos doctor               Show what this computer has: Node, git, gh, every agent CLI.
devos accounts             Show each CLI's signed-in account, plan, and available models;
                           verify the gh login and token scopes.
devos verify [<folder>]    Audit everything between here and a fully configured stack on
                           GitHub (only the configuration model you chose is audited
                           as an action item); every problem prints its fix and who
                           applies it — you (logins, plans, keys) or the model (files).
devos fix [<folder>]       Hand the model-fixable problems back to the configuration model,
                           then verify again. Logins, plans, and key values stay with you.
devos watch [<folder>]     Test everything at once (the full verify audit), then keep
                           re-testing every 15 s until a pass is all green; fixes by
                           you or devos fix are picked up automatically. --once / --interval <sec>.
devos keys [--check] [--push]
                           Write the keys guide, create devos/secrets.local.json (the
                           file values go into), print the steps; --push uploads what
                           is filled, --check compares gh secret list with the needs.
devos status [<folder>]    Show the saved models, active modules, latest cycle run.
devos agents detect        Print every detected agent CLI and its model list as JSON.
devos upgrade              Update engine files in a project on a branch, as a pull request.
devos ui                   Open the guided UI for a draft without running init.
devos --help               Show the help in plain sentences.
```

Model selection happens only in the configuration stage. Detection is the source of
truth: the engine probes each CLI (`agent --version`, `agent models`, `claude auth
status`, and so on), seeds the screen with known families, and adds every
id the CLI itself reports, labeled "reported by the CLI". It never offers an id the
CLI cannot run, and it never launches a CLI without `--model`.

Seeded families today: **Claude Code** shows the full Anthropic line-up (Claude
Fable 5.1 — the recommended configuration model for the best start — plus Opus 5.5,
Sonnet 5.5, Haiku 5.5, and the 4.5 generation); **Cursor CLI** shows its first-party
models (Grok 4.7 with its effort tiers, Grok 4.6/4.5, Composer 2.5) alongside the
models it hosts (Claude on Cursor, GPT-5.6 Sol/Terra/Luna, Gemini 4 Argon / 3.1 Pro /
3.8 Flash, Muse Wonder). The configuration-model row is preselected with the
strongest signed-in reasoning model and carries a "Recommended — best start" badge;
a manual pick always wins.

At the Project step you can **attach documentation** — .md, .txt, .csv, .json, .yaml
or paste notes. The files travel with the answers, land in `devos/intake-docs/`, and
the configuration model reads them before it builds: answers win over documents on
conflict, and anything still missing comes back to you as questions in
`devos/OPEN_QUESTIONS.md` and the setup issue — never invented.

## Keys and tokens

The engine owns the whole keys moment; the model never sees a value in either path.

`devos continue` (and `devos keys`) write `devos/SECRETS_GUIDE.md` — every key the
project needs with its own where-to-get walkthrough (the configuration model
organizes it in an interactive terminal; the built-in catalog is the fallback) —
and create `devos/secrets.local.json`: the ONE file values go into. It is
gitignored, never committed, never pushed, and no model ever reads it.

Then devos asks once how you want to set the keys, and remembers the choice:

1. **Local file (default)** — you paste each value next to its name and save. The
   engine waits and uploads every key the moment it lands (`gh secret set`, value
   piped on stdin) and finishes when GitHub confirms all of them. Ctrl+C is a safe
   pause; `devos continue` picks the rest up.
2. **Model walkthrough** — the configuration model requests each key by NAME
   (`request_secret NAME`); you type each value into gh's own hidden prompt; the
   model receives only `set` or `missing`. Anything the model cannot get falls
   back to the local file.

`devos keys --push` uploads what is filled without waiting; `devos keys --check`
compares `gh secret list` with the project's needs and exits 1 while something is
missing. A key that exists on GitHub but was set outside devos counts as
unconfirmed: paste the real value to overwrite it, or set the value to `__keep__`
to keep what is there. The choice is remembered in `devos/state/keys-mode.json`,
overridable per run with `--keys-mode local|model`.

## Project types, frameworks, core modules

The catalogue (`payload/catalogue.json`) ships 16 project types — saas, web-app, marketing,
dashboard, marketplace, commerce, api, mobile, ai-product, realtime, docs, cli,
library, worker, extension, and full — every framework under `payload/stacks/`
(Next.js, Nuxt, SvelteKit, Remix, Astro, Starlight, Vite+React, Vite+Vue, SolidStart,
Hono, Fastify, NestJS, FastAPI, Django, Go+chi, Expo, Flutter, node-cli, node-lib,
python-lib, custom), and 16 core modules under `payload/modules/`: language, styling,
ui-kit, database, auth, storage, payments, email, jobs, search, product-ai, i18n,
testing, hosting, observability, and automation (always on).

## What lands in every new repository

- Stack configuration as real files: manifest and lockfile inputs, language config,
  lint config, test config, framework config, `.env.example` with names only,
  `.gitignore`, `.editorconfig` with LF, and a `ci.yml` that runs the stack's
  install, typecheck, lint, test, and build.
- `devos.config.json` and `devos/project.json`: base branch main, max attempts 3,
  the exact reviewer and builder ids, the light reviewer, the builder pool, the pick
  policy, the required checks, the active modules, the hosting, and the
  configuration model with stage `configuration-only`.
- A codebase architecture that typechecks, `docs/ARCHITECTURE.md` with the folder
  map and dependency direction, a health route that returns 200, an architecture
  test that fails if a UI file imports the database, and typed "not configured"
  exports for every active server module.
- The automation module: `devos-cycle.yml`, `devos-intake.yml`, `devos-advance.yml`,
  `devos-doctor.yml`, `devos-resume.yml`, `devos-setup.yml`, `devos-deploy.yml`,
  `ci.yml`, `devos-wait.yml`, `devos-supervisor.yml`, plus `scripts/devos/`,
  `scripts/guards/`, `devos/prompts/`, the `docs/PHASES.md` ledger with T01 not
  done, `devos/fences/T01.md` carrying your reviewer and builder ids, issue forms
  for a change request and a method fix, `docs/method/AUTOMATION.md`, and `SETUP.md`.
- Product documents: `docs/PRODUCT_BRIEF.md`, `docs/SCOPE.md`, `docs/DECISIONS.md`,
  `docs/GLOSSARY.md`, `docs/BOUNDARY_MODEL.md`, and `docs/DESIGN_SYSTEM.md` when
  there is a web UI.

Guards run locally in Node with no network: secrets, phases, naming, manual,
boundary, catalogues (when there is more than one language), and data (migrations
append-only, no secret key in a public env name). PASS with no human gate merges and
dispatches the next task; PASS at a human gate waits for you; FAIL has the reviewer
rewrite the fence up to three attempts, then halts; a missing secret opens the
"Dev OS: setup needed" issue; a usage limit moves once to the next GitHub-capable
builder in the pool, then parks and resumes.

## Development

```
npm test        # node --test — fake gh, git, claude, agent, codex, and gemini on PATH; no network
```

Engine layout: `bin/devos.mjs`, `lib/` (CLI, doctor, probes, wizard, answer file,
configuration-model runner, init_github, secret handoff, upgrade), `ui/` (one HTML,
one CSS, one JS file served by the devos process), `payload/` (catalogue, stacks,
modules, architecture), `test/`. Decisions made while building are in DECISIONS.md.

Documentation set: **QUICKSTART.md** (every step), **MANUAL.md** (full reference —
commands, files, GitHub side, failure modes, security model), **ARCHITECTURE.md**
(internals for engineers and AI models — module map, data schemas, payload
contracts, test conventions, modification rules).
The license is a free-to-use, no-resale draft the owner can replace.
