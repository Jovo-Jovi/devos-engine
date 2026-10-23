# Blueprint — a new project's documents and first fence

You are the reviewer surface starting a **new** project under Dev OS v2 (`docs/method/DEV_OS_V2_REVIEWER.md`),
run headless by `devos init`. The developer's answers are in `devos/answers.json`: name, brief, users, whether the
project stores data, sign-in, languages, deploy target and repository visibility. Nobody can answer a question
during this run: where the answers and your research leave something open, choose the safer option and record it as
an **assumption** in `docs/DEVOS_FIT.md`.

Work in this order.

1. **Read the handbook** (§0–§13, §17, §18) and list every station, gate, document and guard this project needs.
2. **Fit research** (§17): profile A or B, data classification, Include · Omit · Adapt for every layer, obligations
   (cite sources; when personal data is involved, the personal-data law of the country the project serves) and
   stack fit. Mark anything unverified as an **assumption**. **Modules:** when `stores_data` is true the project
   adopts the backend module (`docs/method/FULLSTACK_MODULE.md`): name every zone and whether it holds personal
   data, and plan `DATA_MODEL.md` (and `PROTECTION_MODEL.md` for personal data) at J2, before any code.
3. **Tooling review.** Read `https://cursor.com/marketplace` and `https://cursor.com/docs/models`. For each plugin,
   MCP server, skill or automation that could serve this project, decide Include · Omit with a reason, judged
   against the profile's non-waivable gate, "a tool is never authority", "a connected MCP is not permission" and
   the runner owning git. Write the result as `docs/DEVOS_FIT.md` §7a.
4. **Write the documents** in `docs/` with the layout of handbook §4: `DEVOS_FIT.md`, `PRODUCT_BRIEF.md`,
   `GLOSSARY.md`, `DECISIONS.md` (ODs, including the automated relay OD and the tooling OD), `SCOPE.md`, the models
   the profile needs, `PHASES.md`, `SESSION_CONTEXT.md`, `DEVELOPMENT_JOURNAL.md` and `method/CARRY_FORWARDS.md`
   (empty). Write the design contract of `docs/method/DESIGN_METHOD.md` §1: `DESIGN_SYSTEM.md` with every part that
   section lists, including a decision (adopt, optional or reject, with the reason) for each resource of its §5, and
   `docs/design/UI_ACCEPTANCE.md`. Two formats are read by guards and must be exact:
   - `docs/PHASES.md`: the header `| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |`, a separator
     row, then one row per task — `T01` first, ids ascending, Risk 1, 2 or 3, Done `[ ]`, Verdict `—`.
   - `docs/GLOSSARY.md`: a section whose heading starts `## 3.` and holds one fenced code block listing the
     forbidden bare nouns, separated by ` · `.
   Keep `docs/method/PRECEDENTS.md` as installed: its rows are the rules the runner implements. Rewrite PR-01 for
   this project's environment; new rulings continue from the live maximum.
5. **Configure the surfaces.** Edit `devos/project.json` (never `devos.config.json`), then run
   `node scripts/devos/config.mjs --write`. Fill `.cursor/rules/10-security-data.mdc` and
   `.cursor/rules/30-vocabulary.mdc`. Write `.cursor/mcp.example.json` and `devos/ci/mcp.ci.json` from step 3, and
   `CLAUDE.md` from the handbook's §15.1 template. Write the `devos:boundary` line in `docs/BOUNDARY_MODEL.md`
   (PR-19). With the backend module, plan T01 or the first J4 task to create `supabase/`.
6. **Issue fence T01** as `docs/fences/T01.md` in the format of handbook §6.3, and rehearse every path it names.
   When T01 builds a screen, its header carries the `- Screens:` line and its `### Design specification` follows
   `docs/method/DESIGN_METHOD.md` §3.
7. **End with a summary** as your final message: the profile, the ODs the developer signs by approving, your
   assumptions, and the setup steps that change for this project.

Never write application code. Never run git or gh. Everything you produce is documents, configuration and the
first fence.
