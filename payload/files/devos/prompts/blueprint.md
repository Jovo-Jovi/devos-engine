# Blueprint — a new project's documents and first fence

You are the reviewer surface starting a **new** project under Dev OS v2 (`docs/method/DEV_OS_V2_REVIEWER.md`), run
headless by `devos init`. The developer's answers are in `devos/answers.json`: name, brief, users, the project
type, the stack, a provider for each module (`modules`), the scope (`scope`: `mvp` or `full`), whether the project
stores data, sign-in, languages, deploy target and repository visibility. Nobody can answer a question during this
run: where the answers and your research leave something open, choose the safer option and record it as an
**assumption** in `docs/DEVOS_FIT.md`.

When `devos/intake-docs/` exists, read every file in it before step 1 (PDFs too), and every image in
`docs/design/references/` (the developer's design references and brand assets, named for what they show; your Read
tool shows an image). A file your tool cannot open (a format it does not read, or an image too large for it) is
worked from its name and the developer's notes, and recorded as an assumption. Where a document and the answers
disagree, the answers win. Anything the product needs that neither gives goes into `docs/OPEN_QUESTIONS.md`, one
question per line; when nothing is open, that file holds the single line `No open questions.`

**Keep it lean.** Build what the brief and the documents ask for — nothing cut, nothing added — with the simplest
architecture that carries it. Every layer, module, service, dependency and abstraction you Include cites the brief
line, scope item or OD that needs it; without one it is Omit. Prefer the stack's built-ins and one data store over
extra services: no microservices, queues, caches, plugin systems or generic frameworks without a cited need.
**Scope:** with `scope` `mvp`, the phases build the core flow end to end, and `docs/SCOPE.md` lists every other
feature the brief asks for under **Later**, built only when the developer asks for it with a change request. With
`full`, the phases build every feature the brief asks for, core flow first, and the last phase before launch makes
the product ready for production: a security review, error tracking and logging, backups when data is stored, and
the speed of the main pages.
**Small tasks, short phases.** Plan the smallest sequence of tasks that each leave the product working. A task is
one reviewable change a builder finishes in one run, or in two to four stages (`devos-fence-writing` §1: about 6
steps, 12 files, 2 concerns and 12 Done-when items per run); split anything bigger into more tasks. A phase is a
slice the developer can use when it ends. With `scope` `mvp`, the core flow fits in about 12 tasks after T01; a plan
that needs more says in `docs/SCOPE.md` why each extra task is needed. The task that completes the core flow adds
one end-to-end test of it (a browser test for a UI, a request test for an API, a run of the command for a CLI) to
the stack's `test` command, so every later task proves the core flow still works.
**Risk is earned:** 3 for sign-in and permissions, money, personal data, a schema change, the boundary, headers or a
deploy setting; 1 for copy, documents and one-line fixes; 2 for the rest. A risk-3 task gets the deep review and
waits for the developer, so mark one only for one of those reasons.

Work in this order.

1. **Read the handbook** (§0–§13, §17, §18) and list every station, gate, document and guard this project needs.
2. **Fit research** (§17): profile A or B, data classification, Include · Omit · Adapt for every layer, obligations
   (cite sources; when personal data is involved, the personal-data law of the country the project serves) and
   stack fit. Mark anything unverified as an **assumption**. **Modules:** when `stores_data` is true the project
   adopts the backend module (`docs/method/FULLSTACK_MODULE.md`): name every zone and whether it holds personal
   data, and plan `DATA_MODEL.md` (and `PROTECTION_MODEL.md` for personal data) at J2, before any code. **Stack and
   providers:** plan for `stack` and for every provider in `modules` that is not `none`: name it in
   `docs/DEVOS_FIT.md`, give it its tasks in `PHASES.md`, and list its keys by name in your summary's setup steps,
   never a value. **Observability:** unless `modules.observability` is `none`, fence T01 sets up structured logging
   and error handling, and the phase before launch adds the chosen provider (Sentry: error tracking and release
   source maps).
3. **Tooling review.** Read `https://cursor.com/marketplace` and `https://cursor.com/docs/models`. For each plugin,
   MCP server, skill or automation that could serve this project, decide Include · Omit with a reason, judged
   against the profile's non-waivable gate, "a tool is never authority", "a connected MCP is not permission" and
   the runner owning git. Write the result as `docs/DEVOS_FIT.md` §7a.
4. **Write the documents** in `docs/` with the layout of handbook §4: `DEVOS_FIT.md`, `PRODUCT_BRIEF.md`,
   `GLOSSARY.md`, `STACK.md` (the chosen stack in one page: the versions current today from its official
   documentation, the folder layout, the stack's commands from `devos.config.json` `stack.commands` (install,
   typecheck, lint, test, build), how to test, how to log with one structured logger, and the conventions every
   task follows), `DECISIONS.md` (ODs, including the automated relay OD and the tooling OD), `SCOPE.md`, the models
   the profile needs, `DESIGN_SYSTEM.md`, `PHASES.md`, `SESSION_CONTEXT.md`, `DEVELOPMENT_JOURNAL.md` and
   `method/CARRY_FORWARDS.md` (empty). When `devos/project.json` `ui` is `true`, `DESIGN_SYSTEM.md` is the design
   contract of `docs/method/DESIGN_METHOD.md` §1: write every part that section lists, including a decision (adopt,
   optional or reject, with the reason) for each resource of its §5.1 that fits the stack, and also write
   `docs/design/UI_ACCEPTANCE.md` and `docs/design/REFERENCES.md` (§5.4: every image in `docs/design/references/`
   by its file name, which you keep, every link the developer gave, then your library picks). Choose a direction of
   the project's own (§5.5): the developer's references first, then the library rows for the project's type (§5.2)
   and the Blueprint rows of `devos/skills/INDEX.md`, for each layer the product needs.
   `DESIGN_SYSTEM.md` opens with its Direction and signature. Never copy a reference, and never reuse one look for
   every project of a type.
   Two formats are read by guards and must be exact:
   - `docs/PHASES.md`: the header `| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |`, a separator
     row, then one row per task — `T01` first, ids ascending, Risk 1, 2 or 3, Done `[ ]`, Verdict `—`.
   - `docs/GLOSSARY.md`: a section whose heading starts `## 3.` and holds one fenced code block listing the
     forbidden bare nouns, separated by ` · `.
   Keep `docs/method/PRECEDENTS.md` as installed: its rows are the rules the runner implements. Rewrite PR-01 for
   this project's environment; new rulings continue from the live maximum.
5. **Configure the surfaces.** Edit `devos/project.json` (never `devos.config.json`), then run
   `node scripts/devos/config.mjs --write`. Its `structure.modules` holds one entry per feature area the phases
   build, and no more, each `{ "dir": …, "public": [ … ] }` from `devos.config.json` `stack.scaffold.modules` with
   `<name>` filled in (its `aliases`, when it has them, go to `structure.aliases`). Code outside a module imports it
   only through its public entry (`guard:imports`, PR-58); the task that first builds a module creates its folder
   and its public entry. Fill `.cursor/rules/10-security-data.mdc` and
   `.cursor/rules/30-vocabulary.mdc`. Write `.cursor/mcp.example.json` and `devos/ci/mcp.ci.json` from step 3, and
   `CLAUDE.md` from the handbook's §15.1 template. Write the `devos:boundary` line in `docs/BOUNDARY_MODEL.md`
   (PR-19). With the backend module, plan T01 or the first J4 task to create `supabase/`.
6. **Issue fence T01** as `docs/fences/T01.md` in the format of handbook §6.3, and rehearse every path it names.
   T01 is always the scaffold, from `devos.config.json` `stack.scaffold`, and builds no feature: run its `create`
   commands (where a flag has changed, the generator's current documentation wins and the builder reports the
   change), make each of the five `stack.commands` run, add one structured logger (`logger`) that every log line
   goes through, error handling that logs the error and returns a safe message, the health route when `health` is
   set, and one architecture test that proves the `architecture` rule with the test runner (`tests`). When `ui` is
   `true`, it also adds `@playwright/test` and `@axe-core/playwright` as dev dependencies, the tools of the
   runner's UI evidence (`docs/method/DESIGN_METHOD.md` §4). Its Done-when
   is `node scripts/devos/run-checks.mjs --strict` exiting 0. T01 is not a UI fence: it carries no `- Screens:` line.
   Every fence carries `- Layers: <layer> · <layer>` in its header: the layers of `devos/skills/INDEX.md` the task touches (`design`, `motion`, `frontend`, `accessibility`, `architecture`, `backend`, `api`, `database`, `security`, `reliability`, `testing`, `ops`); T01's are usually `ops · testing`. The runner gives the builder and the reviewer the skills of those layers, and a server-side or deep task always the security layer and a code task the testing layer (PR-55, PR-56, PR-57).
   Every fence also carries the builder line `- Builder: <an id of devos.config.json agents.pool> · Effort:
   <low|medium|high|xhigh> · Fast: <yes|no>` (T01: `high`, `no`) and `- Paths: \`<glob>\` · …`: every file and
   folder the task may change, each in backticks (T01's are the scaffold's: `*` for the files at the root, and its
   folders such as `src/**`, `public/**` and the test folders). `guard:scope` fails a change outside them; the report,
   `docs/SESSION_CONTEXT.md`, `docs/DEVELOPMENT_JOURNAL.md` and a lockfile beside a listed manifest are always
   allowed. Before you finish, run `node scripts/devos/fence-check.mjs docs/fences/T01.md` and fix every finding
   (PR-58).
   Every later fence that builds a screen carries a `- Screens:` line and a `### Design specification`
   (`docs/method/DESIGN_METHOD.md` §3).
7. **End with a summary** as your final message: the profile, the ODs the developer signs by approving, your
   assumptions, and the setup steps that change for this project.

Never write application code. Never run git or gh. Everything you produce is documents, configuration and the
first fence.
