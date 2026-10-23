# {{NAME}}

{{BRIEF}}

- Stack: {{TYPE}} on {{FRAMEWORK}}
- Repository: {{SLUG}}
- Method: DEV_OS — the automation is documented in docs/method/AUTOMATION.md, the phase ledger is docs/PHASES.md, and every task starts from its fence in devos/fences/.

## Status

Bootstrapped by the DEV_OS configuration stage. The first task is **T01** (devos/fences/T01.md); the cycle in .github/workflows/devos-cycle.yml runs one attempt of one task per dispatch, in five visible steps (resolve -> Builder -> Checks -> Review -> Verdict) with the details of every stage as comments on the attempt PR.

## How the automation works

1. The builder writes the task on a branch; the required checks and the guards run.
2. The reviewer reads the diff, the check output, and the fence, then writes docs/reviews/T01-a1.md with a per-row verdict.
3. The runner parses the verdict: PASS merges (or labels devos:human-gate and waits), FAIL rewrites the fence and retries, up to maxAttempts.

## Development

- Checks: the commands in devos/project.json (requiredChecks) — the cycle runs them on every attempt.
- Secrets: names in .env.example; values are typed only with `gh secret set NAME --repo {{SLUG}}` (SETUP.md has the guide). A value never enters a file, a prompt, or an issue.
- Agent CLIs: installed by scripts/devos/install-clis.mjs, both on the runner and locally after a fresh clone.
- Agent rules: AGENTS.md is the contract every builder and reviewer follows in this repository.
- Decisions: docs/DECISIONS.md holds the decisions; docs/adr/ records the architecture decisions that constrain the build.
