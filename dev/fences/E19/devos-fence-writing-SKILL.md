---
name: devos-fence-writing
description: How the Dev OS reviewer writes a perfect fence - judging its size, splitting a big task into stages, and checking it before it is final. Use whenever you write or reissue docs/fences/Tnn.md.
---
# Writing a fence

A fence is a specification the builder executes alone (CLAUDE.md "Fence format"). Quality comes
first: never lower the builder's effort to save time; when a task is big, **split it into stages**.

## 1. Judge the size before writing

Count, from the PHASES row, its "Phase outlines" entry and the code it touches:

| Signal | One run | Split |
|---|---|---|
| Numbered steps | ≤ 6 | more |
| Files created or changed | ≤ 12 | more |
| Distinct concerns (data/migration · server/API · UI states · motion · e2e and captures · docs/ledgers) | ≤ 2 | 3 or more |
| Done-when items | ≤ 12 | more |
| Risk 3 with a visible change | — | always 2+ stages |
| History: a similar earlier task needed more than one time slice (`git log --format=%s origin/main \| grep -E "^T[0-9]+ a[0-9]+: builder .*time slice"`) | — | split |

A builder run has 72 minutes; aim for about 60 minutes of work per stage.

## 2. Splitting into stages (PR-38)

- Add the header bullet `- Stages: N` (2 to 4). Inside **Steps**, group the numbered steps under
  `### Stage k — <title>` blocks; each block lists its steps, the files it may touch, and the
  Done-when ids it proves at the end of that stage.
- One concern per stage, in this order: data and server first, then UI states, then motion, then
  e2e, captures, ledgers and the report.
- Every stage leaves the tree green: the stack's typecheck, lint and the tests it touches pass
  after it (`devos.config.json` `stack.commands`). No stage depends on a later one.
- The runner runs one stage per builder run and tells the builder which stage it is on. Each stage
  appends `## Attempt A · Stage k of N` to the report; the last stage runs **every** Done-when
  command and writes the full report. The review comes once, after the last stage.
- If even 4 stages would not fit (about 4 hours of work), write the fence with 4 stages for the most
  important part and say in `human_attention` how the rest should become a separate task (a change
  request the owner files). You cannot add ledger rows.

## 3. Check it before it is final

1. Write the fence.
2. Run the `fence-auditor` agent on it; fix every BLOCKER and DEFECT it reports and run it again
   until none is left.
3. Only then give its path in `Next prompt:`.

## 4. Reviewing with help

- UI task: run the `design-inspector` agent on the captures before you judge the design ledger.
- Deep review (risk 3, a gate, a critical path): run the `security-auditor` agent on the branch.
- You stay the judge: agents report, you decide and cite their evidence in the verdict.
