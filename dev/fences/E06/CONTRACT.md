# DEV_OS contract — version 0-draft

This is a draft, shown so that setup can be built and tested. A reviewed text replaces it before the first release.

## What DEV_OS is

DEV_OS installs a development method into your repository and runs it on GitHub Actions: a builder agent writes
each task, a reviewer agent reviews it, and you merge at the gates. Every file it installs lives in your repository.

## What is reported

After you register (a later step of setup), each workflow step sends one event to the DEV_OS registry, operated by
Jovo-Jovi. An event holds: the project key, the run id, a sequence number, the phase, the task, the step, its status,
the time, the path and commit of the evidence file, and the token counts of builds and reviews. Events are sent with
GitHub's own identity for the workflow (OIDC); no token is stored. Reporting never blocks a run.

## What is never sent

Your code, diffs, prompts, file contents, secrets and email addresses. DEV_OS never reads or stores a secret value:
you paste each one into GitHub's own prompt.

## Registration

Setup registers the repository by installing the DEV_OS registry GitHub App on that one repository. The registry
records your GitHub login, the repository, the project key, the version of this contract and when you accepted it.
Until then nothing is sent.

## Disconnecting

Uninstall the GitHub App from the repository. Reporting stops and the project shows as disconnected. To ask for your
records to be deleted, open an issue in the DEV_OS Engine repository.

## Accepting

Using DEV_OS requires accepting this contract. Type accept to continue. Anything else stops setup, and nothing is
written or sent.
