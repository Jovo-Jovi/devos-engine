# Quick start

DEV_OS Engine is a local developer tool. You open **one file**. It checks your
computer, tells you exactly what is missing, and starts the guided setup only
after you approve. Nothing is created or changed before that approval.

## The one-file path

1. Get this folder on your computer: `git clone` it, or download and unzip it.
2. Open the folder.
3. Open the start file for your system:
   - **Windows:** double-click `start.bat`
   - **macOS / Linux:** run `./start.sh` in a terminal
4. Read the checklist it prints. Every missing item is named, with the page to
   get it from.
5. Everything ready? Type **Y** and press Enter. The guided setup opens at
   `http://127.0.0.1` in your browser. If no browser can open, the same steps
   work as a numbered list in the terminal.

To check without starting anything, run the same file with `--check`:

```
./start.sh --check        # macOS, Linux
start.bat --check         # Windows
```

## What you need

| Need | Why | Where to get it |
|------|-----|-----------------|
| Node 22 or newer | the engine runs on it | https://nodejs.org — pick the LTS |
| git | the repository work | https://git-scm.com/downloads |
| GitHub CLI, signed in | creates the repository, holds your secrets | https://cli.github.com — then run `gh auth login` |
| One AI CLI, signed in | you pick your reviewer and builder from these | Claude Code, Cursor Agent, Codex, Gemini CLI, Z.ai/GLM, or Muse |

The checklist tells you which of these is missing. Fix only what it names,
then open the start file again. Any one signed-in AI CLI is enough; the others
stay optional.

`devos init` also verifies the gh login **before** the configuration model
burns tokens: the account, the token against the GitHub API, and the `repo` +
`workflow` scopes. Missing scope? One command fixes it:

```
gh auth refresh -h github.com -s repo,workflow
```

## Every step, from empty folder to a running project

### Step 1 — Start the guided setup

`start.bat` / `./start.sh` prints the machine checklist (Node, git, gh with
login + scopes, and every AI CLI as installed/signed-out/missing) and asks for
approval. Nothing exists yet.

### Step 2 — Answer the nine questions

The guided UI (or the numbered terminal list, if no browser opened) walks
through:

1. **Machine check** — the same checklist, inside the wizard.
2. **How this works** — the one-screen explanation of the three model roles.
3. **Models** — you pick:
   - the **reviewer** — after GitHub exists, it reviews every task and writes
     the next task. GitHub-capable tools only.
   - the **builder** (default) — after GitHub exists, it writes the code.
   - optional **extra builders** with a strength tag.
   - the **light reviewer** — default: same as the reviewer.
   - **who picks the builder** on later tasks: the reviewer picks from your
     pool, or always the default builder.
   - the **configuration model** — the strongest reasoning model signed in on
     this computer. It runs exactly once, now, and never again. A local-only
     tool is allowed here. The dropdown marks every id the CLI itself
     reported with **— on your account**.
4. **Project** — name, repository slug `owner/name`, one-paragraph brief,
   audience, private/public, optional attached documents (.md/.txt/.csv/.json;
   they land in `devos/intake-docs/` for the model to read).
5. **Project type** — SaaS, web-app, dashboard, marketplace, commerce, api,
   mobile, ai-product, realtime, docs, cli, library, worker, extension, and
   more. The type pre-selects recommended modules.
6. **Framework** — Next.js, Vite React/Vue, SvelteKit, Remix, Nuxt, Astro,
   FastAPI, Django, Expo, Flutter, Go chi, Hono, Fastify, Nest, Starlight,
   node-cli/lib, python-lib, or **custom** (you type install/typecheck/lint/
   test/build commands).
7. **Core modules** — styling, ui-kit, database (Supabase/Firebase/Neon/Postgres/MongoDB),
   auth (better-auth/Supabase/Firebase/Clerk), storage, payments, email,
   jobs, search, product-ai, hosting (Vercel/Cloudflare/Fly/Railway/Docker),
   observability, languages/i18n, testing (unit + Playwright). Automation is
   always on and locked.
8. **Languages** — language codes the product speaks (default `en`).
9. **Summary** — everything you chose, one screen. **Confirm** is the first
   moment a project folder may exist.

Before confirm, the only files written are under `~/.devos/` (draft, answer
copies) and they contain no secrets — a built-in check refuses any field that
looks like a secret value.

### Step 3 — The configuration model writes your project

After you confirm, the saved configuration model runs **once**, in a sandbox:

- It may only write inside the project folder, read the engine's module
  templates, and call two shims: `init_github` and `request_secret`.
- Raw shell, git, gh, curl, wget, rm, secret values, and calling any
  reviewer/builder CLI are forbidden. Prompt and the model's whole conversation
  stream to the terminal and to the UI live (`says …`, `writes …`, `wrote …`,
  `module … included`).
- It writes the stack files, the architecture skeleton, all automation
  (workflows + scripts + prompts), the product documents, and
  `devos/fences/T01.md` (the first task). Anything the attached documents do
  not answer lands in `devos/OPEN_QUESTIONS.md` for you.
- If the result fails the engine's **bootstrap guards** (project config,
  module parity, env names, YAML, architecture, docs…), the model gets the
  guard report back and repairs — up to 5 rounds, automatically.
- When the tree is complete it calls `init_github` **once**: git init →
  commit → `gh repo create owner/name --private|--public --push` → writes the
  repository variables (`DEVOS_ACTIVE_MODULES`, `DEVOS_TYPE`,
  `DEVOS_FRAMEWORK`) → dispatches the first `devos-cycle` run → opens a setup
  issue if secret names are still missing.
- Then it calls `request_secret` per needed name: `gh` opens its own hidden
  prompt, **you type the value**, the model only hears "set" or "missing".

The run ends with exactly one line:
`devos init: owner/name is set up; devos-cycle dispatched.`

#### Watch it work — nothing is blind, and you can always stop it

You never have to guess what the model is doing. While it writes:

- **The conversation streams live.** The engine runs Cursor with
  `--output-format stream-json`, so every assistant message, file write, and
  command appears the moment it happens — not buffered until the end:
  ```
  [agent] session started · model grok-4.7 · permission mode default
  [agent] Reading the answers and scaffolding the project now.
  [agent] reads devos/answers.json
  [agent] writes package.json
  [devos] wrote package.json
  [agent] runs bash npm install
  ```
  Engine sentences stay `[devos]`; what the model says, reads, writes, and
  runs are all `[agent]`.
- **Terminal**: under the log, a one-line todo list and a progress line:
  ```
  [devos] todo: [x] answers saved · [·] model writes the project (14 files · 3 modules) · [ ] create the GitHub repository + first cycle · [ ] bootstrap guards & verify
  [devos] ▸ 34% · 14 files · 3 modules · 1m 42s · last output 8s ago · writes src/app/page.tsx
  ```
  The percent advances with real milestones (files, modules, repair rounds,
  GitHub) plus a slow time floor, so even a silent-but-working model shows
  motion — and it freezes instead of pretending if something fails. A
  heartbeat status line prints every 30 s even if the model is silent, always
  showing the age of the last output **and the last thing the model did**.
  `reconnecting ×3` in that line means the CLI is retrying its connection, not
  that devos died.
- **The UI run panel**: a percentage with a bar, the same todo checklist, live
  counters (files written, modules, model lines, last output age), the full
  log feed, and a red **■ Stop — kill the model process** button. Above the
  numbers a **hairline figure** keeps you company while the model works:
  Terminal, firecrawl-reader, Cabinet, cursor-tab, and Slow take turns — each
  animation switches to the next one as the run moves into a new phase (or
  every 20 s), and they rest if your OS asks for reduced motion.
- **Stop it any time**: the button in the UI, or **Ctrl+C** in the terminal.
  Both do the same thing: devos kills the model's whole process tree (the
  model's own subprocesses included), reports `Stopped by you`, and keeps
  everything already written. Nothing is lost — resume when ready:
  ```
  devos continue <project folder>
  ```
  Press Ctrl+C a second time only if you want to force-quit devos itself.

### Step 3b — Continue after an error, a limit, or a stop

A half-finished setup is never a dead end, and resuming is not guesswork.
`devos continue` (the smart resume — `devos init --continue` is the same flow)
checks the project first and prints the checklist:

```
$ devos continue C:\Users\you\Desktop\tinytasks
Checking what is already done and what is missing…
Continuing octodev/tinytasks — 2 of 5 steps already done.
 done : answers saved (devos/answers.json)
 done : project tree passes the guards
 wait: dependencies — installed after the tree passes the guards
 todo: GitHub repository + first cycle — init_github has not completed
 wait: GitHub secrets — checked once the repository is ready
```

Then it continues the next steps ITSELF, in order:

1. **The model only when it is needed.** If the project tree still fails the
   guards, the configuration model resumes (with the saved or overridden
   `--model`/`--cli`). A tree that already passes never wakes the model again —
   no wasted paid run.
2. **Dependencies**: the engine runs `npm install` (or pnpm/yarn/bun/go, from
   the stack) itself, streaming the output as `[deps] …`. The model never has
   to run it.
3. **GitHub**: the engine calls init_github itself. A repository you already
   created by hand (or by a half-finished attempt) is **adopted, never
   recreated** — devos aims the remote, pushes main, sets the variables, and
   dispatches the first cycle. If gh answers GraphQL "Could not resolve to a
   Repository" (the repo lives under a different account than the project
   slug, or it does not exist yet), devos looks for it under the signed-in
   login, matches it by name in your repository list, and adopts what it
   finds — or creates the repository for real. That error can no longer
   dead-end the setup.
4. **Keys**: `devos/SECRETS_GUIDE.md` organizes the where-to-get steps for
   every missing key (the configuration model writes it in an interactive
   terminal; the built-in catalog is the fallback), `devos/secrets.local.json`
   is created as the ONE file values go into (gitignored, never pushed, never
   seen by a model), and every value you already pasted is uploaded by the
   engine. In a terminal the run WAITS while you fill the file and uploads each
   key the moment it lands — Ctrl+C is a safe pause. In the wizard window the
   run opens the **Missing keys card**: type each value into its password
   field, press Submit, and the engine uploads every value straight to GitHub
   (`gh secret set` over stdin), re-checks GitHub's own list, and re-opens the
   card for anything still missing — the loop repeats until GitHub confirms
   every key, and then the run continues on its own. Values are still typed
   only by you; a value is never displayed again, never logged, never sent to
   a model.

**If a step still fails, the configuration model gets a say.** The engine asks
it to analyze the exact error and propose ONE fix — a short list of
non-interactive commands and the steps only you can do (logins, plans, key
values). Nothing runs until you decide:

- In the **terminal**, the proposal prints and devos asks `Apply this fix? [y/N]`.
  `y` runs only the listed commands, then retries the failed step; `n` (or a
  closed input) ends the run with a resume command and applies nothing.
- In the **browser**, the same proposal appears as an Approve/Decline card over
  the run log. Stop still kills the run — stopping also declines a waiting
  proposal, so nothing hangs.

The model is consulted at most once per failed step, its commands are shown to
you before they run, and secret values never appear anywhere in this flow.

Stop it mid-way and run `devos continue` again as often as you like — each run
re-checks everything first. In the guided UI the same continue is offered as a
card on the start screen (with the same checklist and a Continue button), and
every stopped or failed run ends with a "Continue where it stopped" button.

### Step 4 — Set the keys (your choice)

`devos continue` (or `devos keys`) writes `devos/SECRETS_GUIDE.md`: every
secret name with its own where-to-get walkthrough (the configuration model
organizes it in an interactive terminal; the built-in catalog is the fallback)
and creates the gitignored `devos/secrets.local.json`. Then devos asks once —
and remembers the answer:

1. **You paste (default)** — fill each value into `devos/secrets.local.json`
   and save. In a terminal the run WAITS and uploads every key the moment it
   lands (`gh secret set`, value piped on stdin), then finishes when GitHub
   confirms them all. Ctrl+C is a safe pause; `devos continue` picks the rest up.
2. **The model walks you through** (`--keys-mode model`) — the configuration
   model requests each key by NAME; you type each value into gh's own hidden
   prompt; the model receives only set/missing. Anything it cannot get falls
   back to the local file.

Either way a value never reaches chat, an issue, a guide, an answer file, or
any model. Without waiting:

```
devos keys --push     # uploads what is filled, without waiting
devos keys --check    # ready / MISSING per name, from GitHub's own list
```

The local file is gitignored: it never leaves the folder and no model ever
sees it. A key that already exists on GitHub but was set outside devos counts
as unconfirmed — paste the real value to overwrite it, or set it to `__keep__`
to keep what is there. The choice is remembered in `devos/state/keys-mode.json`.

### Step 5 — Watch the first cycle run

You do not have to watch anything: `devos continue` does. When the keys are
on GitHub, the engine dispatches a FRESH `devos-cycle` run (a run that failed
before the keys existed stays as history), watches it to the end, and writes
the report: green — what happens next; red — the failing step's own words,
WHICH of your SELECTED keys the run saw as empty (keys of tools you did not
pick are named once as irrelevant), the likely cause, and the exact fix. The
configuration model's job is done only when the FIRST run finishes green —
`devos status` shows it, and the next `devos continue` just says so. If the
run is red, run `devos continue` again — the intake for the missing values
opens right in the flow (type them into the **Missing keys card in the wizard
window**, paste into `devos/secrets.local.json`, or type each value into gh's
hidden prompt via the model walkthrough — the engine uploads every value
itself, re-checks GitHub's list, and re-opens the card until nothing is
missing; a value never reaches the model), and if the values were already on
GitHub yet the run saw them empty, the engine repairs the workflow's secret
mapping itself, pushes it, and starts the next fresh round. Every continue is
another round, nothing is spent.

### Step 6 — Your job from now on (the daily loop, after the first green run)

- Merge pull requests labeled **`devos:human-gate`** when `devos/checks`,
  `devos/verdict`, and `devos/gate` are green.
- Drop a change request into the issue form any time — the intake workflow
  turns it into the next task.
- The configuration model is never called again; GitHub Actions continues
  with the reviewer and builder you chose.

## After the first setup — every command

```
devos init                 Guided setup for a new project.
devos continue [<folder>] [--model auto] [--cli <tool>]
                           The smart resume: check what is done, then finish the
                           missing steps itself (model only when the guards fail,
                           npm install by the engine, init_github by the engine —
                           an existing repository is adopted). The folder
                           defaults to the last project.
devos init --continue <folder> [--model auto] [--cli <tool>]
                           Same smart resume as devos continue (kept for old
                           habits). Overrides are saved.
devos doctor [--json]      The machine checklist, any time.
devos status [<folder>]    Saved models, active modules, latest cycle run.
devos agents detect        Every detected CLI + model list, as JSON.
devos accounts             Which account + plan each CLI is signed in with,
                           the models each account can run, and the gh
                           login/token-scope check.
devos verify [<folder>]    Audit everything still missing; every problem
                           prints its fix and who applies it (you / model).
devos fix [<folder>] [--cli <tool>] [--model <id>]
                           Hand the model-fixable problems to the
                           configuration model, then verify again.
devos watch [<folder>] [--interval <sec>] [--once] [--json]
                           Test everything at once, then keep re-testing
                           every 15 s until a pass is all green.
devos keys [--check]       Write the keys guide; verify every needed secret.
devos upgrade              Update engine files in a project via a PR.
devos ui                   Open the guided UI for a draft without running init.
devos --help               Every command in plain sentences.
```

Folder arguments are optional for verify/fix/watch/keys/status — without one
they use the last project (`~/.devos/last-project.json`).

## The verify → fix → watch loop (until everything is configured)

Setup is rarely one clean pass. `devos verify` audits **everything** between
where you are and a fully configured stack on GitHub — machine, gh
credentials, the CLI account you actually chose and the models it can run,
project guards, the repository, the workflows, the secrets, the first cycle
run — and prints one line per problem with its fix and **who applies it**:

```
devos verify <folder>        # or just: devos verify (uses the last project)
```

Only your **chosen configuration model** is audited as an action item. CLIs
you did not pick are never listed as work for you — before a choice is made
they appear as quiet info rows only.

- Steps marked **you fix** never go to a model: logins, plan switches, and
  key values (`gh secret set`).
- Steps marked **model fixes** are problems inside the project folder
  (missing files, failed guards). Hand them to the model:

```
devos fix <folder>
```

`devos fix` sends only the model-fixable problems to your saved
configuration model, in the same restricted environment `devos init` used
(no shell, no secrets, `init_github`/`request_secret` shims only), then
re-audits and prints what remains. A failed `devos init` also ends with the
same remaining-steps list, on the terminal and on the UI's failure card, so
no failure is ever a dead end.

### Watch: test everything at once, keep testing until it is green

Typing `devos verify` after every fix gets old. `devos watch` runs the **full
audit at once** — the same report as verify — and then keeps re-running it:

```
devos watch <folder>              # full audit every 15 s, Ctrl+C to stop
devos watch <folder> --interval 5 # faster heartbeat
devos watch --once                # a single pass, then exit
```

Every pass re-reads the answer file and re-probes machine, GitHub, and the
CLI accounts, so fixes made by you (a login, `gh secret set`) or by the
model (`devos fix`) show up on the next pass automatically. Rows whose
state changed since the previous pass are marked with a `*`, so you see
exactly what your last fix moved. The moment a pass is all green the watch
prints **ALL GREEN** and stops by itself — there is nothing left to watch.

## When something stops: the three walls

### A usage limit (including Claude Code's weekly limit)

The run classifies limits as **a wait, not a failed task**. When the limit
resets, resume:

```
devos init --continue <folder>
```

### Cursor asks "Do you trust the contents of this directory?"

That message is Cursor's one-time directory-trust gate, not a DEV_OS failure.
The folder was just created by DEV_OS, so trusting it is safe. Newer engine
builds pass `--trust` automatically and you will never see the prompt. If an
older build shows it anyway:

1. Open a terminal in the project folder (`cd C:\...\your-project`).
2. Run `agent` once, answer the trust question with **Yes**, then quit.
3. Resume: `devos continue <folder>`.

### The model's commands are all rejected (nothing executes)

If the model says things like *"Command execution was rejected on every
attempt, including `npm install` and `init_github`"*, the CLI ran in print
mode without permission to execute. The engine passes `--force` ("force allow
commands unless explicitly denied") automatically on every Cursor run, so a
current CLI never hits this. If it still appears:

1. Update the CLI: `agent update` (then `agent --version`).
2. Resume: `devos continue <folder>`.

devos recognizes the rejection in the model's own words and reports it as a
permission wall with exactly this fix — the tree written so far is kept.

### Cursor says "Named models unavailable — Free plans can only use Auto"

Cursor's Free plan refuses every named model; only Auto runs. Three ways out:

1. Let Cursor pick the model: `devos continue <folder> --model auto`
2. Switch to another installed CLI: `devos continue <folder> --cli claude`
3. Upgrade the Cursor plan, then resume: `devos continue <folder>`.

The model dropdown also lists **Auto — Cursor picks** at the top of Cursor's
models, so new setups can choose it from the start.

## Which account, which plan, which model

Before you commit to a configuration model, check what each CLI can actually
run — accounts, plans, and the models each account enables:

```
devos accounts
```

- **Cursor**: the ids `agent models` reports are the ones your Cursor account
  can run. Free plans run only Auto; Pro unlocks the named models (Grok and
  Composer are part of the paid plans). Two accounts on one machine? The CLI
  uses the account signed in to the editor/CLI — confirm it at
  cursor.com/settings first. To switch the CLI to the other account:
  `agent logout`, then `agent login` (sign in as the paying user in the
  browser), then `agent models` to confirm the model you want is listed.
- **Claude Code**: weekly limits reset automatically. A run that hits the
  limit is a wait, not a failure — or resume on another CLI:
  `devos continue <folder> --cli cursor --model auto`.
- In the model dropdowns, ids marked **— on your account** were reported by
  the CLI itself; the rest of the catalogue may need plan access.
- `devos verify` warns **before** a run if the chosen Cursor model is not in
  the signed-in account's own list — that is the exact wall above, caught
  early.

## Keys and tokens — how they get where they belong

Your project needs API keys (the reviewer and builder CLIs, plus any module
you turned on: Vercel, Supabase, Firebase, Stripe, ...). The rules:

1. **Never put a key in chat** — not in any conversation with a model, not in
   an email, not in a GitHub issue. The configuration model never sees key
   values, by design.
2. **Terminal only.** Run `devos keys` in the project folder. It writes
   `devos/KEYS-NOTES.example.md` — a checklist naming every key, where to get
   it (the exact dashboard page), and the exact command to set it.
3. **Set each key with one command.** In PowerShell (Windows) or any terminal:

   ```
   gh secret set SECRET_NAME --repo owner/name
   ```

   `gh` asks for the value; what you type is hidden. That hidden prompt is the
   only place a key value is ever typed. Supabase, Firebase, Vercel, Stripe —
   same pattern every time: create the key on the provider's dashboard, then
   one `gh secret set` per name.

4. **Verify.** `devos keys --check` compares GitHub's own secret list with
   what the project needs, prints ready / MISSING per name, and exits 1 while
   something is missing. If `devos init` stopped early, run
   `devos continue <folder>` once every key is set — the configuration
   model verifies and finishes the job.

## Keep the engine current in your projects

Engine files inside a bootstrapped project (the automation scripts, the
workflows, the prompts) can be updated from this folder:

```
devos upgrade            # run inside the project folder
```

It puts the update on a branch `devos/upgrade-<version>` as files only —
files you edited yourself are listed as conflicts and left untouched.

## Put this engine on GitHub

The engine itself is a normal repository. From this folder:

```
git init
git add .
git commit -m "DEV_OS Engine"
gh repo create devos-engine --private --source . --push
```

Anyone who clones it gets the same one-file path: open `start.bat` on Windows
or `./start.sh` on macOS and Linux. Your projects are separate repositories,
each created by `devos init` in its own folder.

For the full reference — every command, every file the engine writes, the
GitHub side, and the security model — read **MANUAL.md**. For the internals
(module map, data files, test conventions, how to modify the engine safely,
written for engineers and AI models alike) read **ARCHITECTURE.md**.
