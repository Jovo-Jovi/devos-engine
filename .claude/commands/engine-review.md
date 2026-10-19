---
description: Review an engine task built by Cursor (same contract as the Dev OS cycle, run by hand)
argument-hint: Exx [attempt]
---

Review engine task `$ARGUMENTS` as the reviewer defined in `CLAUDE.md`.

1. Parse the task id (`E` + two digits) and the attempt. Without an attempt number, it is one more than the number of
   `dev/reviews/<id>-a*.md` files.
2. Read `dev/fences/<id>.md`, the latest `## Attempt` section of `dev/reports/<id>.md`, and the row in `dev/LEDGER.md`.
   No report, or a report whose STATUS is HALT → review the halt: is it a correct halt (precondition, STOP block)? Say
   what the owner must do, write the verdict as FAIL with that reason, and reissue the fence only if the fence was wrong.
3. Fetch the change: `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain`, then on a
   `task/<id>` branch `git diff --stat main...HEAD` and `git diff --stat HEAD`, on `main` only `git diff --stat HEAD`;
   and `git ls-files --others --exclude-standard`. One plain command per call. If the branch is neither `main` nor
   `task/<id>`, stop and tell me.
4. Run every *Done when* command of the fence yourself, in order, one per call, and compare each output with the
   expected result.
5. Read every changed line under `payload/`, `bin/`, `lib/`, `tools/`, and every new file in full. Check the fence's
   paths and its *Do NOT* list. For a payload change, apply the "Payload changes are method changes" rule of `CLAUDE.md`.
6. Write `dev/reviews/<id>-a<N>.md` in the verdict format of `CLAUDE.md`.
7. Then follow "After the verdict" in `CLAUDE.md` (ledger row, next fence or reissue).
8. Tell me, in three lines at most: the verdict, the commit message to use at merge on PASS (or what must change on
   FAIL), and the path of the fence that comes next. Remind me to push the branch for the remote check. Do not commit.
