---
name: web-interface-guidelines
description: Check UI code against the Web Interface Guidelines (Vercel Labs), pinned in command.md beside this file. Use when building or reviewing anything a person sees or uses.
---

# Web Interface Guidelines (pinned)

The rules are in `command.md` beside this file, copied unchanged from vercel-labs/web-interface-guidelines at the
commit `devos/skills/manifest.json` records (MIT, see `LICENSE`). Read that copy; never fetch a newer one at run time.
Its first lines speak to a command line (`$ARGUMENTS`): the files to check are the ones the task changes.

- **Builder:** before you report, check every UI file you changed against `command.md`, fix what breaks a rule, and
  list in the report any rule you left broken and why.
- **Reviewer:** cite a broken rule in the design findings as `file:line — rule — the correction`.

`docs/DESIGN_SYSTEM.md` and the fence win where they differ from a rule; say where they did.
