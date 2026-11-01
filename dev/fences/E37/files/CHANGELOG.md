# Changelog

The notable changes of each DEV_OS Engine release. Versions follow [Semantic Versioning](https://semver.org/).

## 1.4.0 — Unreleased

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
    A file of yours with one of DEV_OS's names stops it before the brief, and so does an older copy of DEV_OS,
    which a later version adopts.
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
- **A project in production stays in your hands (PR-72).**
  - **Your deploy stays yours.** A project that deploys itself keeps its deploy: DEV_OS never deploys and never
    sets its deploy variable. For Vercel, `devos adopt` asks first, and you may choose DEV_OS's deploy of `main` at
    the gates you sign instead. A repository that already has `DEVOS_VERCEL` keeps DEV_OS's deploy.
  - **Your gate on the risky paths.** The survey names the critical paths: the deploy files and workflows, the
    schema directories, and the sign-in and payment files, by directory name and by what the code imports. They
    are always reviewed deep. When the brief you confirm says production, a task that changes one stops for your
    review and merge (`reviewer.human_gate_paths_extra` in `devos/project.json`), even at risk 1 or 2. A move or a
    deletion counts. The list is what exists when DEV_OS is added; name a later file there yourself.
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
