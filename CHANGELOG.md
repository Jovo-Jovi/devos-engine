# Changelog

The notable changes of each DEV_OS Engine release. Versions follow [Semantic Versioning](https://semver.org/).

## 1.8.0 — 2026-11-05

- **`devos remove`** takes DEV_OS out of a project, in two runs. The first removes, on a new branch `devos/remove`, every file DEV_OS installed and still owns, with the engine lock and `devos.config.json`, opens a pull request and pauses the cycle (`--local`: one commit, nothing pushed). It keeps your documents, fences, reviews and `devos/answers.json`, the settings written for your project at setup, `docs/method/` (your fences and reviews cite it), `.gitignore` and `.gitattributes`, and lists every DEV_OS file you edited, which it keeps. After the merge, the second run lists what DEV_OS left on GitHub (its secrets, `DEVOS_*` variables, including the Control Tower link, and `devos:` labels) and deletes it only after you type yes. Your services' keys (hosting, database, storage) are asked apart, and a secret DEV_OS does not know is never touched. It also deletes the branch `devos/adopt` of an adoption that was never merged: on this computer after yes, and on GitHub after a typed yes.

## 1.7.0 — 2026-11-05

- **Images you own (PR-82).** A project with screens takes your own images (a logo, product or team photos) at setup, apart from the design references: a second drop zone on the guided page, and one more question in `devos init`. They are kept as they are in `docs/design/own/`, and the media plan lists each one with the source `own`, with or without generated media (without it, the plan holds only these). The "Generated media" step and `devos media` place each one where the product serves it: a checked copy, free, with no key and at any budget. It is never generated, edited or cropped, and the builder never changes it.
- **The media step is quiet without media.** A fence that names no media makes nothing, even in a project without a media plan; before, each task's run said the plan was missing.
- **A PATH entry in double quotes is found on Windows** (`"C:\Program Files\x"`), with a semicolon inside the quotes too, when DEV_OS looks for an AI tool, git or gh.

## 1.6.0 — 2026-11-05

- **Effort you can choose.** The guided page asks the blueprint agent's effort (high by default; Claude Code and Codex) and each builder's: chosen by the reviewer for each task, or fixed for every task, with Fast for Cursor. A fixed effort is written in every fence, and `fence-check` refuses another (PR-78). A Cursor model id that names its effort runs as it is, and the runner reports that effort.
- **Generated media and the visual ambition, chosen at setup.** A project with screens can choose generated media (xAI: images, video or voice) and its visual ambition (Calm, Expressive or Showcase), on the guided page and in `devos init`. Both are kept in `devos/answers.json` for the blueprint. Nothing is generated yet.
- **The media plan (PR-79).** With generated media chosen, the blueprint writes `docs/design/media.json`: every image, video and voice item the screens need, with its use, file, prompt (or text and voice) and `planned` status. `DESIGN_SYSTEM.md` names the visual ambition and follows it. A screen shows an item by its file path, with a designed fallback until the file exists, and a new guard, `guard:media`, checks the plan, the ambition and, once an item is generated, its provenance. A change request may add items.
- **Generation within a budget (PR-80).** `devos media` makes a project's planned media on your computer, with the key in your shell (`DEVOS_MEDIA_XAI_KEY`); xAI is the first provider (Grok Imagine images and video, text to speech). The budget is the authorization: without one (0) it only estimates, and with one it asks before it pays. Each file is checked before it is kept, made once, recorded with its model, date, terms and cost in the plan and in `docs/usage/media.jsonl`, and a started video is resumed rather than paid twice. It never commits.
- **Generated media in the cycle (PR-81).** A fence whose screens show planned media names them (`- Media:`), and a "Generated media" step makes them before the builder, within the repository variable `DEVOS_MEDIA_BUDGET` (not set: 0, an estimate only), and commits them. Only that step receives `DEVOS_MEDIA_XAI_KEY`, which setup now offers as an optional key when xAI media was chosen. A failure never stops the task, the builder can never change a planned file, and the reviewer's evidence says what was made.
- **Two small fixes.** A README with no final newline gets a blank line before `## How this project is built`, and two tests no longer share a name.

## 1.5.0 — 2026-11-04

- **Local mode, step 1: a project set up on this computer.** `devos init --local` ends with the approved blueprint, a local SETUP.md and the first commit, with no gh needed. One question can add a private GitHub backup where only CI runs (`DEVOS_PAUSED` is set before the first push). `devos continue`, `devos verify` and the project's page know a local project. Each task is then built in your IDE from its fence and reviewed on its branch.
- **The guided page offers automated or local development.** Its first screen asks "Automated development (GitHub)" or "Local development (this computer)". The local path asks no link, visibility or hosting, lists no keys, and ends with the optional private backup. `devos init --help` and `devos help` explain both ways, `devos doctor --local` checks only Node.js and git, a project that already has an `origin` is not asked for a backup again, and `devos verify` shows a missing gh as a note for a local project.
- **The product README is kept up to date.** The blueprint writes the project's `README.md` for its users (what it does, features, screenshots, getting started, what it is built with, status), and setup adds how the project is built. A task that builds a feature or changes a screen updates it; no fence deletes it, and `guard:scope` fails a task that does (PR-77).

## 1.4.5 — Unreleased

- **A weekly limit waits days, not an hour.** A reset stated in days ("resets in 5 days") is read half a day early; before, it was read as nothing and retried every hour.
- **A fallback builder of another tool.** When the builder's tool is out for longer than a run waits, `agents.fallback_builder` builds the rest of the task, under the `devos:fallback-builder` label.
- **A model variable never strands a role.** The configured model becomes the variable's next model, so a model the tool cannot use moves on to it.
- **A resume never stops on its label, and the supervisor can restart a task.** A failed removal of the `devos:quota-wait` label no longer ends the step before the run starts, and the supervisor's own token may re-dispatch (`actions: write`).

## 1.4.4 — 2026-11-02

- **The project's state reaches the Control Tower twice a day.** A new workflow, `devos-state`, asks for the link and sends the task history at 03:41 and 15:41 UTC, in its own concurrency group so it never holds a task. The repository variable `DEVOS_STATE` switches it off.
- **A link waits for its approval.** After the connect pull request, and after `devos init` links a project, `devos-state` asks the Control Tower every minute for up to 15 minutes until the link is approved or declined.

## 1.4.3 — 2026-11-02

- **Reporting survives a slow token service.** The report job gives each call 20 seconds and asks GitHub for the OIDC token up to 3 times. Its messages name the real cause, and say that events not sent stay in the run's evidence, where re-running the report job sends them.
- **Every switch shows on the Variables page.** `devos init` and `devos adopt` set the pause, supervisor, heavy-run and account switches, each agent tool's account, the three role models and screenshot retention, each with its value. A variable already set keeps its value.
- **More builder strengths:** motion, accessibility, i18n, security, devops and docs.

## 1.4.2 — 2026-11-02

- **The blueprint agent starts on Windows when its CLI came from npm.** DEV_OS looked the program up with `where`, which lists npm's shell script with no extension before `claude.cmd`; it now tries only the PATHEXT extensions, as the agent check does. When an agent cannot start, the message says why.

## 1.4.1 — 2026-11-02

- **The code guards read every source folder.** `guards.source_roots` (default `src`) names the folders `naming`, `design`, `i18n`, `literals` and `boundary` read, and the route checks read each one's `app/`.
- **A new sign-in or payment import stops at the human gate.** `reviewer.human_gate_imports` names the packages. A PASS that adds or changes a source file importing one stops for a person and is reviewed deep.
- **Adopting writes those settings and leaves the toolchain `.gitignore` alone.** `devos adopt` adds the project's top-level code folders as `guards.source_roots_extra` and, in production, the sign-in and payment packages as `reviewer.human_gate_imports_extra`. It merges only DEV_OS's own `.gitignore` lines, never the toolchain's.
- **`devos upgrade` stages an engine file the project's `.gitignore` leaves out,** so a later upgrade still commits it.

## 1.4.0 — 2026-11-01

### Adopting an existing project (D-E13)

- **`devos adopt --check [folder]` surveys a project you already have.** It is the first step of adding DEV_OS to a
  project in development or in production. In the project's own clone, it reports:
  - its stage (prototype, in development or production, with the reasons);
  - its stack and the catalogue stack it matches, its services (database, auth, payments, email and others);
  - its workflows and where it deploys, and an older copy of DEV_OS, with its precedents;
  - the engine files and project documents DEV_OS would overlap;
  - what stops the adoption: no GitHub origin, uncommitted changes, an account that does not administer the
    repository, or a project that already has the engine.
- **It changes nothing.** It reads tracked files only, and of environment files only an example file's variable
  names. `--json` prints the survey.
- **`devos adopt [folder]` writes the brief you confirm.** After the survey, your own AI tool writes a brief:
  - what the project is and its stage, with the reasons;
  - how it is built, what is done and what is open;
  - its risks and the personal data it handles;
  - what DEV_OS will add, and its questions for you.
  - **Where it works.** In `~/.devos/adopt/`, on a copy of the tracked files, never in the project. The copy leaves
    out environment files other than an example one, and private keys: the tool sends what it reads to its
    provider. The project's HEAD and status are checked unchanged after every round.
  - **Your answer.** Type `yes` to keep the brief, or write what to change and the tool revises it. `--agent`
    chooses the tool. It then asks whether to add DEV_OS now; `no` keeps the brief for `devos adopt --install`.
- **`devos adopt --install [folder]` adds DEV_OS on a branch.** From the brief you confirmed for this commit:
  - **Where.** A new branch `devos/adopt`, made in a worktree in `~/.devos/adopt/`, in one commit. Your checkout
    stays on `main`, unchanged.
  - **The documents.** Your AI tool writes DEV_OS's documents from the brief: what exists as the baseline of the
    scope, the open work as the phases, and `T01` to make DEV_OS's checks run on your code. If it changes your
    code, your own documents or an engine file, or commits, DEV_OS stops and removes the branch. So does Ctrl-C.
  - **Beside your files.** Your CI, `.gitignore` and `CLAUDE.md` are kept, with DEV_OS's beside them or after them.
    A file of yours with one of DEV_OS's names stops it before the brief.
  - **The baseline.** The guards' findings on your code as it is go to `devos/baseline.json`, and every guard must
    pass before the commit.
  - **The commit.** It holds only what was checked: your git hooks do not run on it. DEV_OS's files are committed
    even where your `.gitignore` leaves them out, and devos names them.
  - **Before anything is written,** it shows the contract and asks for the Control Tower link and the cycle's agents,
    as `devos init` does.
  - It needs a default branch named `main`.
- **`devos adopt --publish [folder]` opens the pull request.** It pushes `devos/adopt` and opens its pull request
  into `main` once you type `yes`, the same step `devos adopt` ends with:
  - **The description** summarises the brief: what it is, its stage, the open work and what DEV_OS adds, with the
    settings by name. The brief's risks, personal data and questions stay on your computer.
  - **The repository** gets what the cycle needs, as `devos init` sets it: the keys (typed hidden, or by name to set
    later), the variables, the labels `devos:request` and `devos:method`, and GitHub Actions allowed to create and
    approve pull requests, which applies to every workflow of the repository. Keys and variables already there are
    kept, and the keys are named. Your workflows' default permissions, your Wiki and your Projects stay as they are.
  - **The cycle** starts once you merge: the supervisor starts `T01` within half an hour. Run again, `--publish`
    does only what is missing.
- **An older copy of DEV_OS is adopted too.** A project that tracks DEV_OS's cycle workflow and scripts, copied by
  hand with no engine lock, gets the engine in the same pull request:
  - **Its method files become the engine's:** scripts, guards, workflows, prompts and kits. Those the engine no
    longer ships are removed (`scripts/devos/`, `scripts/guards/`, `devos-*.yml` workflows, `devos/` kits), so no
    old script runs beside the new ones; the pull request names them. Its CI is replaced where it is, beside the
    project's own when it was placed there.
  - **Its documents stay:** phases, fences, reviews, carry-forwards, `CLAUDE.md`, its own rules and setup items.
    No AI tool writes documents; only the brief is written, for the pull request.
  - **Its settings stay:** `devos.config.json` becomes the smallest `devos/project.json` over DEV_OS's defaults.
    Its values are kept, and arrays keep everything the engine added. The role surfaces are always DEV_OS's, and a
    setting that would take away a rule (a null, or a list turned into something else) stops the adoption.
  - **Its precedents:** DEV_OS's rulings bind, with its own PR-01. Its file is kept at
    `docs/method/before-adopt/PRECEDENTS.md` for reference, to carry over any ruling of its own.
  - **Between tasks only.** It stops while a pull request from a `task/` branch is open or a DEV_OS cycle has not
    completed. After the merge, the cycle goes on with the next open task.
  - **Links** where devos writes, the generated config and the lock among them, stop it before the brief.
- **A project in production stays in your hands (PR-72).**
  - **Your deploy stays yours.** A project that deploys itself keeps its deploy: DEV_OS never deploys and never
    sets its deploy variable. For Vercel, `devos adopt` asks first, and you may choose DEV_OS's deploy of `main` at
    the gates you sign instead. A repository that already has `DEVOS_VERCEL` keeps DEV_OS's deploy.
  - **Your gate on the risky paths.** The survey names the critical paths: the deploy files and workflows, the
    schema directories, and the sign-in and payment files, by directory name and by what the code imports. They
    are always reviewed deep. When the brief you confirm says production, a task that changes one stops for your
    review and merge (`reviewer.human_gate_paths_extra` in `devos/project.json`), even at risk 1 or 2. A move or a
    deletion counts. The list is what exists when DEV_OS is added; name a later file there yourself.
- **The guided page can add DEV_OS to an existing project.** `devos ui`, with no folder, offers Existing project:
  a folder on this computer or a GitHub address, then the survey and the same questions `devos adopt` asks.
  Nothing in the project changes until you merge DEV_OS's pull request.
- **The code a project already has gets a baseline (PR-68).** The guards pass what `devos/baseline.json` records:
  the findings of `naming`, `design`, `i18n`, `literals` and `imports` on the code that existed when DEV_OS was
  added, matched by file, rule and line text. New or changed code must pass. `secrets`, `boundary`, `data` and
  `services` are never baselined. `node scripts/guards/run-all.mjs --write-baseline` writes it once,
  `--shrink-baseline` removes what is fixed, and `--no-baseline` shows every finding. A project started with
  `devos init` has no baseline and works as before.
- **DEV_OS's files sit beside a project's own (PR-69).** For the coming install by pull request:
  - **Merged:** `.gitignore` and `.gitattributes`.
  - **Kept beside:** a project's own CI workflow stays where it is, and DEV_OS's goes to `devos-ci.yml`, which
    `devos upgrade` now updates there.
  - **Your instructions first:** your `CLAUDE.md` and `AGENTS.md` keep your text, with DEV_OS's rules after it.
  - **The manual guard** no longer asks the manual to name a project's own workflows.

### Fixes

- **An agent can no longer stop itself (PR-71).** The agents got their whole prompt on the command line, so a
  command the builder ran to stop its servers (`pkill -f "next dev"`) also matched the builder, whose prompt named
  that command, and stopped it.
  - **The prompt is never an argument.** Claude Code, Codex and Gemini read it on standard input, and Cursor gets
    one line that names the file. This holds for the builder, the reviewer and the planning runs.
  - **The builder stops only what it started,** by its PID; `pkill` and `killall` are denied to it.
  - **A builder stopped by a signal from inside its run restarts once in place,** from what it finished, as a lost
    connection does. The watchdog, if signalled itself, ends the agent's whole session first, and what an agent
    left running ends with it.
- **The gates read a branch's paths as they are (PR-72).** A rename counts by both of its paths, and a name git
  would quote is read plainly, for the schema gate (PR-17), the review depth, the method gate (PR-28) and
  `guard:scope`. Before, moving a file out of a gated folder listed only its new path.
- **A check that hangs fails; it never holds the cycle (PR-70).**
  - **A time limit for every check.** Each check has 30 minutes (`check_timeout_minutes`), and all of them 60
    (`checks_budget_minutes`), the Supabase CLI's checks included. At its limit, a check is stopped with everything
    it started, and it is recorded as `timeout`, with its log. A check gets no input, and what it leaves running
    ends with it. Before, a check that never ended held the run until GitHub cancelled the whole job, and the
    review never ran.
  - **The browser install is logged.** Playwright's browser install for `e2e` has 10 minutes, and its output goes
    to `.devos/logs/e2e-install.log` instead of being thrown away.
  - **The supervisor resumes a stopped run.** A cycle run GitHub stopped at its job's time limit ends "cancelled",
    which no rule acted on, so the task waited. The supervisor now dispatches its attempt again: review-only when
    the builder's work was pushed. A run that someone cancelled is left alone. Its workflow gets `checks: read` to
    read GitHub's note, and its counts per cause now read every page of its issue.

## 1.3.2 — 2026-10-28

### Fixes

- **`devos` keeps its last lines.** When its output went to a busy pipe, such as the guided page reading `devos init`,
  the command could end before that output was written, and the last line, often the one that explains the stop, was
  lost. It now ends only after its output is written.

## 1.3.1 — 2026-10-28

### Storage

- **Screenshots are kept 3 days (PR-67).** A cycle run's PNG screenshots, most of its Actions storage, now go to an
  artifact of their own, `devos-<task>-a<attempt>-screens`, kept 3 days. The repository variable
  `DEVOS_SCREENS_RETENTION_DAYS` changes that. The rest of the run's evidence and `ci-evidence` are kept as before,
  without the screenshots. No `.devos/*.env` file is uploaded any more.

## 1.3.0 — 2026-10-27

### The Control Tower

- **A linked project's plan reaches the Control Tower (PR-66).** Once the Control Tower has approved the link, a link
  run (**Ask the Control Tower now**, or `devos-cycle` with `task=link`) sends one event for each task of
  `docs/PHASES.md`: `verdict pass` for a finished task, dated by its review's commit, and `intake pass` for a task
  still to do. The Control Tower then shows every task, what is done and the current phase. The events carry the
  contract's fields only, and git gives only paths and dates. A second link run on the same plan sends duplicates
  only, and a long plan goes at 50 events a minute, the rest at the next link run.
- **Contract version 2.** The contract now says that a link run sends the plan, including tasks finished before the
  link. The plan goes only to a project that accepted version 2: a project linked under version 1 reads it on its
  page and presses **Accept by pull request**; once that pull request is merged, a link run sends the plan.

## 1.2.1 — 2026-10-27

### Fixed

- **The Control Tower link is asked without a task to run (PR-65).** A project whose every task is PASS never asked
  for its link: only a `devos-cycle` run with a task did. Now a link run (`devos-cycle` with `task=link`) builds
  nothing and runs only its `report` job, which asks. Merging the project page's link pull request starts one, and
  with the link on, the page's **Ask the Control Tower now** does the same; neither starts one while a `devos-cycle`
  run is queued or going. A run with every task PASS asks too, so with `DEVOS_REPORTING` on, every run asks until the
  link is approved, as task runs did; a declined repository stops asking when `DEVOS_REPORTING` is `off`. The
  `report` job is still the only one that gets `id-token: write`, and no agent runs.
- **The project page says what the link waits for.** With `DEVOS_REPORTING` on, the page says "On" and that a cycle
  run asks the Control Tower, not "Linked": the link exists only once the Control Tower's operator approves it.

## 1.2.0 — 2026-10-27

### The guided page

- **New or current project.** After the computer check, the page asks whether to start a new project or open a
  current one. A current project comes from your projects folder, from its folder, or from its GitHub address: the gh
  account must own or administer the repository, and DEV_OS checks that it is a DEV_OS project before it clones it
  into your projects folder.
- **A project's page.** It shows the project's setup, its version next to this engine's and the latest release, its
  models (the Models panel) and its Control Tower link. Opening a project changes nothing in it.
- **Upgrade from the project's page.** When the project on GitHub is older than this engine, **Upgrade to 1.2.0 by
  pull request** (this engine's version) runs `devos upgrade` in its folder. An engine older than the latest release
  is told to update first. After you merge the pull request on GitHub, **Bring this folder up to date** pulls it into
  the folder, fast-forward only.
- **Choose a folder.** On *Open a current project*, **Choose a folder…** opens this computer's own folder dialog
  (Windows, macOS, or zenity or kdialog on Linux) and opens the project you pick. Pasting the path still works.
- **Connect to the Control Tower from the project's page.** It is offered only when this engine, the project on GitHub
  and the latest release are the same version. The page shows the contract and asks for an explicit yes. Then a pull
  request records your answer in `devos/answers.json`, and the repository variable `DEVOS_REPORTING` turns on. The
  folder on your computer is not touched.

### Agents

- **Several models per role (PR-64).** The reviewer, the light reviewer and each builder in `devos/project.json`
  `agents` may list `fallback_models`, up to 4 model ids of their own tool. A run tries its model on each account,
  then the next model: a usage limit moves on, a model the account cannot use is skipped at once, and the run waits
  for the earliest reset only when no model can run. No other tool ever takes over. A model variable still replaces
  the first model only.
- **Edit the next models (PR-64).** `devos models` shows each role's next models, and `devos models fallback <role>
  <model>,<model>` (or `none`) changes them by pull request. On a project's page, the Models panel's **Next models**
  orders, removes and adds them, then saves by pull request. Your project folder is not touched.

## 1.1.0 — 2026-10-27

### Agents

- **Change a model without a commit.** The repository variables `DEVOS_REVIEWER_MODEL`, `DEVOS_REVIEWER_LIGHT_MODEL`
  and `DEVOS_BUILDER_MODEL` each replace one role's model from the next cycle run, with the same tool; removing one
  goes back to the model in `devos.config.json` (PR-63). `devos models` shows the three roles and sets or removes them,
  and so does the Models panel of a started project in the guided page (`devos ui`), with each tool's model list.
- **A second account at setup.** `devos init` and the guided page offer each agent tool's second account key as an
  optional key. At a usage limit the run continues on the other account, and waits for the earliest reset when both
  are limited (PR-29).

## 1.0.0 — 2026-10-26

The first public release.

### Setup

- `devos init` takes an empty folder to a GitHub repository that AI agents build, review and ship task by task, from
  the terminal or from a guided page in the browser (`devos ui`).
- The contract, version 1, is shown in full and accepted before anything is written or sent.
- Sixteen project types and twenty stacks, each with its own checks, first-task scaffold and module providers.
- Claude Code, Cursor, Codex or Gemini as the reviewer and the builders, with any model their tool offers.
- Keys are typed once and handed straight to GitHub secrets. DEV_OS never stores one.
- `devos upgrade` proposes a new engine version as a pull request; `devos verify` and `devos watch` say what stands
  between a computer and a green first run.

### The method it installs

- The automated cycle on GitHub Actions: fence, build, checks, review, verdict, human gates, merge and deploy.
- Guards, the UI/UX gate, the security and test gates, a skills catalogue with 18 vendored skills, and the usage
  record of every agent run.

### The Control Tower link

- Linking a project to the private DEV_OS Control Tower is optional and asked as a plain yes or no at setup. Nothing
  is sent without a yes, and the engine works the same either way.
- Before you answer, the contract says what the Control Tower keeps, why, for how long and where, and how to reach its
  operator to see, correct or delete it.

### Licences

- The engine is under PolyForm Shield 1.0.0, the files it installs into a project under MIT, and the third-party files
  under their own licences (`LICENSES.md`, `THIRD_PARTY_NOTICES.md`).

## Before 1.0.0

Versions 0.1.0 to 0.3.0 were private pre-releases.
