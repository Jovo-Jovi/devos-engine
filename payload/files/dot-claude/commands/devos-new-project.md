---
description: Bootstrap a new project with Dev OS v2 + the automated Cursor/Claude cycle (fit research, tooling review, docs, first fence)
argument-hint: <one-paragraph project brief>
---

You are the reviewer surface starting a **new** project under Dev OS v2.
The project brief: $ARGUMENTS

`devos init <folder>` runs this flow headless and is the normal way to start. To run it by hand in a folder where
`devos install` has written the method files: write the brief above into `devos/answers.json` as `"brief"` (add the
other answers you know), then read `devos/prompts/blueprint.md` and follow it exactly. Ask me only what research
cannot answer, once, before its step 4.

By hand, move `.claude/settings.json` out of the folder before you start and put it back once the documents and fence
T01 exist: its deny rules lock the reviewer out of everything but reviews and fences. `devos init` does this for you.
