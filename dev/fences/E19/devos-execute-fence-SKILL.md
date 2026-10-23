---
name: devos-execute-fence
description: Execute a Dev OS fence (docs/fences/Tnn.md) as the builder — preconditions, steps, Done-when evidence, STOP block, report. Use whenever a prompt names a fence or a Dev OS task id like T03.
---

# Execute a Dev OS fence

1. **Open the session**: read `docs/SESSION_CONTEXT.md` and `docs/method/PRECEDENTS.md`, then the
   whole fence. Read every document in its "Context to read first".
2. **Reissue?** If the fence has an `Attempt N focus` section or the prompt says REISSUE, read the
   previous verdict in `docs/reviews/`. The earlier work is in the tree: verify it, change only
   what fails, never redo it.
3. **Preconditions** in order. Any failure → HALT (see `.cursor/rules/50-report-halt.mdc`).
4. **Steps** in order, exactly as written. Mandated text (file contents, keys, values, scripts) is
   copied byte for byte. Use Context7 for current library APIs instead of guessing; name what you
   looked up in the report.
5. **Stay inside the fence.** If a step needs something the fence does not allow (a protected path,
   a new dependency it does not name, a tool it does not name), HALT. Do not improvise.
6. **Done when**: run every command yourself, in order, and keep the real output for the report.
   Fix what fails if the fix is inside the fence; otherwise HALT.
7. **Guards**: `node scripts/guards/run-all.mjs` (or `pnpm guards` once a Node `package.json` defines it)
   must print no FAIL.
8. **Ledgers**: only what the fence says (`SESSION_CONTEXT.md`, `DEVELOPMENT_JOURNAL.md`). Never
   tick `docs/PHASES.md`.
9. **Report** with the `devos-task-report` skill.
10. Automated runs: stop there. Do not commit, push or open a PR.

## Staged fences (PR-38)

A fence with `- Stages: N` is built one stage per run; the runner's prompt says which stage this run
builds. Read the whole fence for context, then do **only that stage's** `### Stage k` block: its steps,
its files, its Done-when items. Earlier stages are committed on the branch: verify them, never redo
them. Leave the tree green (typecheck, lint, the tests you touched). Append
`## Attempt A · Stage k of N` to the report with that stage's evidence (`STATUS: DONE` or
`STATUS: HALT` first). On the last stage, run every Done-when command of the whole fence and write the
full report.
