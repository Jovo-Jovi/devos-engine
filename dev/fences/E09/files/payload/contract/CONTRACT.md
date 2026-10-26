# DEV_OS contract — version 0-draft-3

This is a draft, shown so that setup can be built and tested. A reviewed text replaces it before the first release.

## What DEV_OS is

DEV_OS installs a development method into your repository and runs it on GitHub Actions: a builder agent writes
each task, a reviewer agent reviews it, and you merge at the gates. Every file it installs lives in your repository.

## What is reported

Once your repository is linked (see Linking), each step of the cycle sends one event to the DEV_OS registry, operated
by Jovo-Jovi. An event holds: the project key, the run id, a sequence number, the phase, the task, the step, its
status, the time, and the path and commit of the evidence file. Events are sent with GitHub's own identity for the
workflow (OIDC), from a job of the cycle that runs no agent; no token is stored. Reporting never blocks a run.

## What is never sent

Your code, diffs, prompts, file contents, secrets and email addresses. DEV_OS never stores a secret value. The keys
you type during setup stay in the engine's memory only until it hands each one to GitHub (`gh secret set`, over
standard input). No model, file, log or answer ever receives one.

## Linking

The first cycle run asks the registry to link your repository. The request carries the repository and its owner, as
GitHub's OIDC identity proves them, the project key it proposes, the engine version and the version of this contract.
The registry's operator approves the link once and the registry names the project's key; until then no event is sent.
Linking never limits what you can do: DEV_OS works the same whether the link is approved, waiting or declined.

## Disconnecting

Set the repository variable `DEVOS_REPORTING` to `off`. Reporting stops and nothing more is sent. To ask for your
records to be deleted, open an issue in the DEV_OS Engine repository.

## Accepting

Using DEV_OS requires accepting this contract. Type accept to continue. Anything else stops setup, and nothing is
written or sent.
