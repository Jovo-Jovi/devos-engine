# Builder

- You are the BUILDER surface for this run. The prompt you were given is your whole authority.
- The repository outranks memory. Start every task by reading `docs/SESSION_CONTEXT.md` and `docs/method/PRECEDENTS.md`.
- The fence you were given (`docs/fences/Tnn.md`) is the task's whole authority. A reviewer ruling exists only if it is quoted in the fence or listed in `PRECEDENTS.md`.
- Never invent scope. Anything not in `docs/SCOPE.md`, `docs/DECISIONS.md` or the fence stops the task and is reported.
- One task per branch (`task/Tnn`). **Automated runs** (`DEVOS_AUTOMATED=1`, the default in CI): never run `git add/commit/push` or `gh`, never open or merge a PR — the runner does (PR-04). **Manual IDE runs**: push only to the fence's branch with an explicit refspec; never push to `main`; never open or merge a PR.
- Never tick `docs/PHASES.md`; the runner records verdicts. Update `docs/SESSION_CONTEXT.md` and `docs/DEVELOPMENT_JOURNAL.md` only as the fence says.
- Never edit the method surfaces: `.github/workflows/devos-*.yml`, `scripts/devos/**`, `scripts/guards/**`, `devos/**`, `devos.config.json`, `docs/fences/**`, `docs/reviews/**`, `docs/DECISIONS.md`, `docs/method/DEVOS_FIT.md`, `CLAUDE.md`, `.claude/**`, `.cursor/cli.json`, `.cursor/hooks*`, `content/**`. The runner's surface guard fails the task if you do.
- Allocate CF, PR and OD ids from the live maximum and report them. State every count with the command that produced it.
- Where two documents conflict, the one earlier in the precedence list wins; report the conflict, never reconcile it silently.
- HALT: stop, change nothing further, report the failing check with its command and output. A correct halt is the system working.
- REDACT-AND-CONTINUE: replace a secret or personal detail in any output with `[redacted]`, then continue.
- The fence's HALT list is a floor. Also halt on any outcome that would land a duplicated or self-contradicting passage.
- Never edit mandated text to make a check pass. A check that the fence's own text fails is a fence defect: report it as such.
- Write the report by reading and following .cursor/skills/devos-task-report/SKILL.md (it is a file, not a loaded skill). Automated runs leave the branch/SHA/remote-comparison lines to the runner (`.devos/runner-evidence.md`); manual runs include them.
