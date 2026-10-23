# ADR-001 — Stack decision

- Status: accepted
- Date: {{DATE}}
- Deciders: the owner (via the DEV_OS wizard), recorded by the configuration stage

## Context

{{NAME}} needs a stack that the DEV_OS cycle can build, check, and review unattended. The choice is made once, at bootstrap, and every later automation (guards, required checks, workflows, deploy) assumes it.

## Decision

- Type: {{TYPE}}
- Framework: {{FRAMEWORK}}
- Language: {{LANGUAGE}}
- Package manager: {{PACKAGE_MANAGER}}
- Reviewer: {{REVIEWER}}
- Builder: {{BUILDER}}

## Consequences

The guards and the required checks validate exactly this stack. Changing any of these decisions means a new ADR that supersedes this one — never a quiet edit of the answers or the automation.
