---
description: Diagnose a problem in the Dev OS automation and hand it to the method-fix flow (PR-28, PR-30)
argument-hint: <what went wrong, and run or PR links>
---

Something in the automation misbehaved: `$ARGUMENTS`

You are the reviewer surface (`CLAUDE.md`). You diagnose; you do not edit method files here. The fix
is built by Grok through a method-fix task and merged by the human.

1. Read `docs/method/AUTOMATION.md` (the operating manual) and `docs/method/PRECEDENTS.md`.
2. Get the evidence. For each run link: `gh run view <id> --log-failed` (the last few hundred lines)
   and `gh run view <id> --json jobs`. For a PR: `gh pr view <n> --comments`. With no link:
   `gh run list --status failure --limit 10`.
3. Find the root cause to the line (workflow step or script, `file:line`, and the log line that
   proves it). Decide the kind, as `devos/prompts/method.md` defines it: a method defect, a setting
   outside the repository, a product defect, or not settled.
4. Tell me in a few lines: the cause, the evidence, and the fix as a specification.
5. If it is a method defect, open the issue that starts the fix, with your diagnosis as its body:
   `gh issue create --label devos:method --title "Method fix: <short>" --body-file <file>` (the body
   includes the run links, so the automated run reads the same logs). If it is a setting, name it and
   its steps; if it is the product's code, say which `/devos revise` or change request to use.
6. Commit nothing and change no file.
