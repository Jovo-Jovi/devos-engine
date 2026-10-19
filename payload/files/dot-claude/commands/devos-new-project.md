---
description: Bootstrap a new project with Dev OS v2 + the automated Cursor/Claude cycle (fit research, marketplace tooling review, docs, first fence)
argument-hint: <one-paragraph project brief>
---

You are the reviewer surface starting a **new** project under Dev OS v2
(`docs/method/DEV_OS_V2_REVIEWER.md`), to be run by the automated cycle this repository uses.
The project brief: $ARGUMENTS

Work in this order. Ask me only what research cannot answer, once, at the end of step 3.

1. **Parse the handbook** (§0–§13, §17, §18) and list every station, gate, document and guard.
2. **Fit research** (§17): profile A or B, data classification, Include · Omit · Adapt for every
   layer, obligations (cite sources; Egypt Law 151 of 2020 when personal data is involved),
   existing estate, stack fit. Mark anything unverified as an **assumption**.
   **Modules:** decide whether the project stores data. If it does, it adopts the backend module
   (`docs/method/FULLSTACK_MODULE.md`): name every zone (staff dashboard, member area) and whether
   it holds personal data, and plan `DATA_MODEL.md` (and `PROTECTION_MODEL.md` for personal data)
   at J2, before any code.
3. **Tooling review — Cursor marketplace.** Fetch `https://cursor.com/marketplace` and the Cursor
   models page `https://cursor.com/docs/models`. For each plugin, MCP server, skill or automation
   that could serve this project, decide Include · Omit with a reason, judged against:
   the profile's non-waivable gate (trackers and beacons breach Profile A's Boundary gate), "a
   tool is never authority" (skills that impose their own workflow compete with the fence),
   "a connected MCP is not permission" (read-only and project-scoped by default), and the runner
   owning git (the builder gets no GitHub tool). Confirm the builder model id and its default
   effort. Write the result as `DEVOS_FIT.md` §7a.
4. **Write the documents** with the same layout as this repository: `DEVOS_FIT.md`, brief,
   glossary (with the forbidden-noun code block `guard:naming` reads), decisions (ODs including
   the automated relay OD and the tooling OD), scope, the models the profile needs, the design
   system, `PHASES.md` (task table with Risk and Gate columns plus phase outlines),
   `SESSION_CONTEXT.md`, journal, carry-forwards (empty), and precedents. For precedents, keep the
   copied `PRECEDENTS.md` rows: they are the rules the runner implements and `AUTOMATION.md` cites.
   Rewrite PR-01 for this project's environment. New rulings continue from the live maximum.
5. **Configure the surfaces**: `devos.config.json` (models, surfaces), `.cursor/rules/*` (fill the
   vocabulary and environment rules), `.cursor/mcp.example.json` and `devos/ci/mcp.ci.json` from
   step 3, `.cursor/cli.json` deny list, `CLAUDE.md` from the §15.1 template.
   Write the `devos:boundary` line in `BOUNDARY_MODEL.md` with the profile and zones (PR-19). With
   the backend module: keep `modules.supabase` in `devos.config.json`, `.cursor/rules/70-supabase.mdc`,
   and plan T01 or the first J4 task to create `supabase/` (init, clients, first migration with RLS,
   pgTAP tests, synthetic seed, generated types).
6. **Issue fence T01** in the format of `docs/fences/T01.md` and rehearse every path it names.
7. Hand me: the fit file for approval, the list of ODs I sign by pushing the bootstrap commit, and
   the setup steps from `SETUP.md` that change for this project.

Never write application code. Everything you produce is documents, configuration and the first fence.

Where to run this: in the **new** project's repository, not in the pilot. Copy this command to
`~/.claude/commands/` so it is available everywhere. Then copy the pilot's method files into the
new repository (the list is in `docs/method/AUTOMATION.md` §11):

- `scripts/devos/` and `scripts/guards/`
- `devos/`
- `.github/workflows/` and `.github/ISSUE_TEMPLATE/`
- `.cursor/`
- `.claude/commands/`
- `devos.config.json`
- from `docs/method/`: `DEV_OS_V2_REVIEWER.md`, `FULLSTACK_MODULE.md`, `AUTOMATION.md` and
  `PRECEDENTS.md`

The modules stay inactive until their files exist (`supabase/config.toml`, `firebase.json`,
`src/lib/r2/`). Copy the
pilot's `.claude/settings.json` **last**, after the bootstrap is written: its deny rules lock the
reviewer out of everything but reviews and fences.
