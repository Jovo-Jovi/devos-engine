# Changelog

The notable changes of each DEV_OS Engine release. Versions follow [Semantic Versioning](https://semver.org/).

## 1.2.0 — Unreleased

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
