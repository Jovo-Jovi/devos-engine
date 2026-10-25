# DEV_OS notes on the Superpowers testing and debugging skills

Written by DEV_OS after reading every copied file whole (2026-10-25). Read this before the files your prompt lists.
These notes are DEV_OS's own text, not part of the skills. The skills are copied unchanged under their MIT licence
(`LICENSE`).

## What they are for

- `test-driven-development/writing-good-tests.md`: every test you write or change names the break it catches and
  exercises the real code. The reviewer judges tests by the same rules.
- `verification-before-completion/SKILL.md`: no claim in the report without the command that proves it and its real
  output. It is the method's evidence rule.
- `test-driven-development/SKILL.md`: for a bug fix, the failing test comes first.
- `systematic-debugging/`: find the root cause before you change code.

## Where DEV_OS differs

- **Never delete work to start over.** The skills say to delete code written before its test, and to start again.
  In DEV_OS, the earlier attempt's work stays in the tree on a reissue: verify it against the Done-when list and change
  only what fails (the builder prompt's reissue rule). For new code, the fence's Done-when tests must exist and pass;
  writing them first is good practice, not a reason to throw code away.
- **No one answers during a run.** Where a skill says to ask or discuss with "your human partner", write the question
  under *Open questions* in the report, and HALT when the fence's STOP block says so.
- **The builder never runs git.** Where a skill says to check `git diff` and recent commits, commit, open a pull
  request or use a worktree, use the fence, the evidence pack (`.devos/evidence.md`) and the previous verdict instead.
- **"Run the project's test command".** Yes, and paste its real output in the report. The runner runs the full checks
  again; your report must not claim more than your own run showed.
- **Names like `superpowers:test-driven-development`** mean the files in this folder.

## Notes on the files

- `systematic-debugging/condition-based-waiting.md`: its first sample calls `waitFor(...)` with one argument, while the
  implementation it shows also requires a description. Pass the description.
- `systematic-debugging/root-cause-tracing.md` and `condition-based-waiting.md` name `find-polluter.sh` and
  `condition-based-waiting-example.ts`. They are not copied (one is a script, the other example code). Do not look for
  them.
- Not copied either: the authors' evaluation files (`test-academic.md`, `test-pressure-1.md` to `test-pressure-3.md`,
  `CREATION-LOG.md`) and the other Superpowers skills, which drive an agent's own git, branch and planning workflow.

## Who wins

The fence, `docs/DECISIONS.md` and the method win over every skill. Where a skill and another source disagree, follow
the project's documents and say so in your report or verdict.
