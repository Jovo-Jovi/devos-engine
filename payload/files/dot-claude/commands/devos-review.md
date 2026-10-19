---
description: Review a Dev OS task branch by hand (same procedure as the automated cycle)
argument-hint: Tnn [attempt]
---

Review Dev OS task `$ARGUMENTS` by hand, as the reviewer surface defined in `CLAUDE.md`.

1. Confirm the current branch is `task/<Tnn>` (`git branch --show-current`). If it is not, stop and
   tell me which branch to check out.
2. If `.devos/ci-results.json` is missing or its `head` is not the current `git rev-parse HEAD`,
   run `pnpm guards`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` yourself and
   treat their results as the checks (PR-08 still applies: a red required check means FAIL).
3. Follow `devos/prompts/reviewer.md` from "## Procedure" step 1, reading `{{TASK}}` as the task id
   and `{{ATTEMPT}}` as the attempt number (default 1), with base `main`.
4. When done, tell me the verdict in one line and the path of the fence you wrote. Do not commit.
