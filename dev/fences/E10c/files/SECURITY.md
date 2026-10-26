# Security

## Reporting a vulnerability

Report it privately through GitHub: this repository's **Security** tab, then **Report a vulnerability**. Do not open a
public issue for it. Say which engine version you use (`devos --version`), what you did, what happened, and how to
reproduce it.

Only the latest release receives security fixes.

## What is in scope

- The `devos` command and its guided page (`bin/`, `lib/`).
- The files DEV_OS installs into a project (`payload/`), including the workflows of the automated cycle.

The vendored third-party skills belong to their authors (`THIRD_PARTY_NOTICES.md`). Report a problem in one of them to
its source as well.

## Your data

To see, correct or delete what the private DEV_OS Control Tower keeps about a linked project, follow "Your rights" in
the contract (`payload/contract/CONTRACT.md`).
