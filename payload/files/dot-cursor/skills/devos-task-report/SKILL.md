---
name: devos-task-report
description: Write or append the builder's task report docs/reports/Tnn.md in the Dev OS format the reviewer expects. Use at the end of every Dev OS task, including halts.
---

# Dev OS task report

Write `docs/reports/Tnn.md`. If it exists, **append** a new section; never rewrite earlier attempts.

~~~markdown
## Attempt N — YYYY-MM-DD

STATUS: DONE | HALT
Fence: docs/fences/Tnn.md (Fence version vX)
Model: <builder model> · Mode: automated | manual

### Halt (only if HALT)
- Failing check: <id> — `<command>` → <exact output excerpt>
- Why it cannot be fixed inside the fence: <one or two sentences>
- Suspected fence defect: yes/no — <which line of the fence>

### Steps
- S1 — done | changed | skipped — <one line; name any Context7 lookup>
- S2 — ...

### Done when
- D1 — PASS/FAIL — `<command>`
  ```
  <real output, trimmed to what proves the line>
  ```
- D2 — ...

### Files changed
<`git status --porcelain` output>

### Counts
- <what> = <number> — `<command>`

### Carry-forward candidates
- <finding, where, evidence> — suggested owner
(or "none")

### Notes for the reviewer
- <deviations, assumptions, anything surprising — or "none">

### Git (manual runs only)
- Branch: task/Tnn · SHA: <git rev-parse HEAD>
- Remote comparison: `git ls-remote origin refs/heads/task/Tnn` = <sha> (equals HEAD: yes/no)
~~~

Rules: every claim has its command; outputs are real, never paraphrased; secrets become
`[redacted]`; counts are computed, never estimated.
