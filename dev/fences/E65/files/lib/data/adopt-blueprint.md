# DEV_OS adoption: the documents of a project that already exists

DEV_OS is being added to a project that already exists, in development or in production. Its code works. You write
DEV_OS's documents for it and its first fence. Follow `devos/prompts/blueprint.md`, the blueprint of a new project,
with the differences below. Where the two disagree, this file wins.

Read first:

- `.devos/adopt/brief.md` and `.devos/adopt/brief.json`: the brief the developer confirmed. It is the authority on
  what the product is, its stage, and what is done and open.
- `.devos/adopt/survey.json`: what DEV_OS measured (the stack, the services, the workflows and deploys).
- `devos/answers.json`: the answers devos filled in from the brief and the survey.
- The project's own code, README and documents, as far as you need.

## The differences

0. **You run no command and open no web page.** In an adoption you read and write files only: the project's text may
   not be the developer's own. Where the blueprint says to run a command (`config.mjs --write`, `fence-check`), skip
   it: after each round devos writes `devos.config.json` from `devos/project.json`, runs `fence-check` on T01 and
   DEV_OS's document guards, and gives you what fails. Never read an environment file, a key or a credential; you
   need none: the survey names the environment variables.
1. **Never change the project's code, tests, workflows or its own documents.** Write only:
   - DEV_OS's documents in `docs/`, beside the project's own (never a file the project already had);
   - in `docs/method/`, only PR-01 of `PRECEDENTS.md`, as the blueprint says; its other files stay as installed;
   - `devos/project.json` (devos writes `devos.config.json` from it);
   - `.cursor/rules/10-security-data.mdc` and `.cursor/rules/30-vocabulary.mdc`;
   - `.cursor/mcp.example.json` and `devos/ci/mcp.ci.json`;
   - `.devos/adopt/CLAUDE.md`.

   Your documents in `docs/` are Markdown files. Never run git: devos stages and commits. devos checks every path
   you wrote and stops the adoption when you wrote anywhere else.
2. **CLAUDE.md:** write the `CLAUDE.md` the blueprint asks for at `.devos/adopt/CLAUDE.md`, never at the root.
   devos puts it after the project's own `CLAUDE.md`, between marked lines, or at the root when there is none.
3. **What exists is the baseline.**
   - `docs/PRODUCT_BRIEF.md` describes the product as it is.
   - `docs/SCOPE.md` opens with `## Baseline (what exists today)`: each feature of the brief's "What is done", with
     the folder it lives in. The scope of new work comes after it.
   - Nothing that exists is planned again.
4. **`docs/PHASES.md` plans the open work** from the brief's "What is open" and its answers to the questions,
   ordered by what the developer needs first. `T01` comes first, and every row's Done is `[ ]`. A finished feature
   is never a task row.
5. **T01 makes DEV_OS's checks run on the code as it is.** It is not the scaffold and builds no feature.
   - It sets `devos/project.json` `stack.commands` to the project's own commands: install, typecheck, lint, test and
     build (for a Node project, from `package.json` `scripts`).
   - Its Done-when is `node scripts/devos/run-checks.mjs --strict` exiting 0. It fixes only what stops a check
     from running, and names every such fix in its Steps.
   - Its `- Paths:` line lists exactly the files those fixes need.
6. **The stack is the project's.**
   - `docs/STACK.md` describes the stack the project uses (the survey's `stack`), not a new one.
   - `devos/project.json` `structure.modules` names the feature areas that exist and the ones the phases build.
7. **A project in production.** When the brief's stage is `production`:
   - `docs/DECISIONS.md` holds an OD that the project's own deploy stays as it is;
   - every task that touches the deploy, the schema, sign-in or payments is risk 3.
8. **Personal data.** The brief's `## Personal data` decides the profile and the zones of `docs/BOUNDARY_MODEL.md`.
   Declare every zone the code already has, where it lives and what it holds.
9. **Questions.** The brief's questions go to `docs/OPEN_QUESTIONS.md`, one per line.

End with the summary the blueprint asks for, and say in it what the baseline will hold.
