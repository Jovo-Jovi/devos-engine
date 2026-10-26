# DEV_OS contract — version 1

## The DEV_OS Engine and the DEV_OS Control Tower

The DEV_OS Engine is the `devos` command and the method it installs into your repository. It runs on your computer and
in your repository's GitHub Actions: a builder agent writes each task, a reviewer agent reviews it, and you merge at the
gates. Every file it installs lives in your repository. It works fully on its own.

The DEV_OS Control Tower is a private service operated by Jovo-Jovi. It is not part of the engine, not a public
dashboard, and not a service available to engine users: you get no access to it, and nothing in the engine needs it.
It receives information only from projects whose developer chose to link them, and only after its operator has approved
the link.

## Linking a project to the Control Tower (optional)

Right after you accept this contract, setup asks whether to link this project. No answer is chosen for you.

No: nothing is ever sent to the Control Tower, and every feature of the engine works the same.

Yes: the project's cycle asks the Control Tower to link the repository, and its operator approves or declines the
request. The engine works the same whatever the answer. The request carries the repository and its owner, as GitHub's
identity for the workflow proves them, the project key it proposes, the engine version and the version of this
contract. After approval, each step of the cycle sends one event: the project key, the run id, a sequence number, the
phase, the task, the step, its status, the time, and the path and commit of the evidence file.

Connection and permission: the events go to https://devos-control-tower.vercel.app over HTTPS. They are sent by the
cycle's `report` job, which runs no AI agent and holds no key. That job alone receives GitHub's `id-token: write`
permission, to prove which repository is asking. No token or key is stored anywhere, and reporting never stops, fails
or slows a run beyond that job.

Changing your mind: the repository variable `DEVOS_REPORTING` holds your answer (GitHub, the repository, Settings,
Secrets and variables, Actions, Variables). `on` links and reports; `off`, or no variable at all, sends nothing from the
next run on.

## What is never sent

Your code, diffs, prompts, file contents, secrets, keys, email addresses and token counts. Nothing is sent from your
computer: only the cycle on GitHub sends, and only when the project is linked.

## Your keys

DEV_OS never stores a secret value. The keys you type during setup stay in the engine's memory only until it hands each
one to GitHub (`gh secret set`, over standard input). No model, file, log or answer ever receives one.

## Your records

To ask for the records of a linked project to be deleted, open an issue in the DEV_OS Engine repository. Setting
`DEVOS_REPORTING` to `off` stops anything more from being sent.

## Accepting

Using DEV_OS requires accepting this contract. Type accept to continue. Anything else stops setup, and nothing is
written or sent. Accepting does not link your project: that is the next question, and its answer is yours.
