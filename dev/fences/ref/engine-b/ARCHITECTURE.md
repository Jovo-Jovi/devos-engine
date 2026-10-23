# DEV_OS Engine — architecture and internals

This document is written so an engineer **or another AI model** can open the
codebase and modify it safely without reverse-engineering it. It maps every
module, every data file, every contract, the test conventions, and the rules
a modification must follow. Companion documents: `QUICKSTART.md` (steps),
`MANUAL.md` (reference), `DECISIONS.md` (why things are the way they are),
`worklog.md` (what changed, task by task).

---

## 1. Purpose and hard constraints

DEV_OS Engine is a local CLI (`devos`) + a localhost wizard UI. One guided
session → the configuration model writes a project → GitHub Actions continues
development with reviewer/builder models behind human merge gates.

Hard constraints every change must respect:

1. **Zero npm dependencies.** Plain Node.js 22+ ESM only. If you need a
   library, you are probably solving it wrong — or the constraint changed,
   and then DECISIONS.md must say so.
2. **Local only.** The UI server binds to `127.0.0.1`. No hosted service, no
   telemetry, no accounts.
3. **No secret values on disk or in prompts.** `assertNoSecrets` guards the
   answer/draft/defaults writers; `request_secret` returns only
   `set`/`missing`; repair prompts are built from rows that carry names, not
   values; a test asserts no secret name leaks into a repair prompt.
4. **Synchronous probing, async runs.** Machine/CLI probes use `spawnSync`
   (simple, deterministic, fast enough); the configuration model runs as an
   async child with streamed lines.
5. **The configuration model runs once.** `configurationModel.stage` is
   `"configuration-only"`; guards, CI-side runner, and fences all refuse to
   call it again.
6. **Windows is a first-class platform.** All spawning goes through
   `lib/spawn.mjs` (DEP0190-safe); prompts travel over **stdin**, never argv.
7. **Tests are the contract.** `npm test` must stay green; behavior changes
   come with tests. The suite is fully offline via fake executables.

---

## 2. Repository layout

```
devos-engine/
├─ bin/devos.mjs            CLI entry: routes commands, internal: shims
├─ lib/                     the engine (see §4 module map)
├─ ui/                      index.html + app.css + app.js (the wizard UI)
├─ payload/                 read-only material the configuration model copies
│  ├─ catalogue.json        types, modules, tools, pickPolicies, customTool
│  ├─ stacks/*.json         21 framework stacks (commands, configFiles, arch)
│  ├─ modules/<id>/template per-module skeleton the model copies when ON
│  ├─ modules/automation/   workflows + scripts/devos + prompts + fences
│  └─ architecture/<arch>/  manifest.json (expected/absent paths, health)
├─ test/                    node:test suite + fixtures/bin (fake CLIs)
├─ start.sh / start.bat     the one-file launcher
├─ QUICKSTART.md  MANUAL.md  ARCHITECTURE.md  README.md  DECISIONS.md
└─ package.json             name devos-engine, bin devos, engines >=22
```

The engine's own folder is never mixed with a project's folder: a project is
`<workspace>/<slug-name>/`, created only at Confirm.

---

## 3. Runtime flow (who calls what)

```
start.sh/.bat
  └─ lib/start.mjs runStart()        checklist + approval (DI: {check, launch})
       └─ lib/cli.mjs cmdInit()
            ├─ lib/doctor.mjs machineCheck()          blocks or continues
            ├─ lib/server.mjs startServer()           UI at 127.0.0.1:7788
            │    ├─ GET /api/state → catalogue + agents + machine + draft (+ live progress)
            │    │                    + resume.candidates[] (local continue checklist)
            │    ├─ POST /api/draft → save draft (~/.devos/draft.json)
            │    ├─ POST /api/stop  → flag stop + kill the model's process tree
            │    ├─ POST /api/confirm → lib/init.mjs runInit()
            │    └─ POST /api/continue → lib/continue.mjs runContinue() (wrapped into
            │         beginRun's {result, projectDir, answers} shape)
            └─ terminal: devos continue / init --continue → lib/continue.mjs runContinue()
            │         ├─ lib/answers.mjs finalizeAnswers() (+ assertNoSecrets)
            │         ├─ createProjectFolder() + devos/answers.json
            │         └─ lib/configmodel.mjs runConfigurationModel()
            │              ├─ lib/prompt.mjs buildConfigPrompt()
            │              ├─ lib/adapters.mjs getAdapter() + spawn via lib/spawn.mjs
            │              ├─ shims: init_github / request_secret (bin internal:*)
            │              ├─ lib/guards.mjs validateBootstrap() → repair rounds (≤5)
            │              ├─ lib/initgithub.mjs runInitGithub() (via the shim)
            │              └─ every event → lib/progress.mjs reducer → SSE + terminal
            └─ terminal fallback: lib/termwizard.mjs
Standalone commands: continue, doctor, status, agents detect, accounts, verify,
fix, watch, keys, upgrade, ui  (all in lib/cli.mjs, routed by bin/devos.mjs)
```

The verify→fix→watch loop:

```
lib/verify.mjs auditSetup() ── rows {section,label,state,detail,fix,who}
        │                                        who ∈ you | model | devos
        ├─ lib/fix.mjs  runFix()   → lib/configmodel.mjs runRepairModel()
        └─ lib/watch.mjs runWatch() → loop auditSetup() until ready
```

---

## 4. Module map (`lib/`)

### `paths.mjs`
`engineRoot()`, `payloadPath()`, `uiPath()`, `devosHome()` (`DEVOS_HOME`
override → `~/.devos`), plus paths for `draft.json`, `defaults.json`,
`answers/`, `last-project.json`.

### `catalogue.mjs` (55 lines)
Loads `payload/catalogue.json`; `loadStack()`, `getType()`, `getModule()`,
`stackCards()`. The catalogue is data, not code — adding a stack or module is
a JSON edit plus (for modules) a template folder.

### `answers.mjs`
`defaultDraft()` (type `full` pre-selected), `applyModuleRecommendations()`,
`applyType()/applyFramework()` (respect `touched.framework/modules` so user
edits survive), `slugify()`, **`finalizeAnswers(draft)`** → the answer file
(`schema: devos/answers@1`): verbatim module states, resolved stack, custom
tool rows get their `agent` fields attached (command, modelFlag,
promptTemplate, githubCapable, localOnly). **`assertNoSecrets()`** refuses
any `secret|token|password|credential|apikey|value`-named field holding a
non-UPPER_SNAKE string. `writeDraft/readDraft`, `saveDefaults/readDefaults`,
`writeAnswers` (timestamped copy in `~/.devos/answers/`).

### `doctor.mjs`
`machineCheck()` → `{ready, blocks, rows, agents}`: Node ≥22, git, gh with
the **full `ghPreflight()`** (login, API-verified token, `repo`+`workflow`
scopes — a missing scope or rejected token is a blocker with the fix), and
every agent row with account detail. `printDoctor()` renders it.

### `accounts.mjs`
Per-CLI account probes `ACCOUNT_PROBES` (claude `auth status`; cursor
`status` then `whoami`; codex `login status`; glm `auth status`/`whoami`;
muse `auth status`; gemini none). `parseAccountText()` extracts email + plan
word; a CLI that answers nothing is `signedIn:'unknown'` with guidance —
**never a guess** (silence does not mean Pro). 60 s TTL cache,
`clearAccountCache()` for tests. **`ghPreflight()`**: installed → signed in →
parse login + `Token scopes:` → verify with `gh api user` → problems+fixes
(`gh auth refresh -h github.com -s <missing>`).

### `probes.mjs`
`detectAgents()`: for each catalogue tool — `which` (plus `altCommands`),
version, `authState()` (authProbe command or credential env var),
**`accountInfo()`**, `modelsArgs` → `reportedIds`, then
**`groupModels(seedGroups, reportedIds)`**: union of seeded and CLI-reported
ids; every reported id gets `available:true` (this account can run it);
groups sort available models first. `familyOf()` buckets unknown ids by
prefix (grok/claude/gpt/gemini/composer/glm/muse/other). `customAgent()`
builds the row for user-registered tools.

### `adapters.mjs`
`getAdapter(agent)` → per-tool launch recipe. **`promptDelivery: 'stdin'`**
for all built-ins (prompt size/escaping safety); `buildArgs(model)`:

| tool | args |
|------|------|
| claude | `-p --model M --permission-mode acceptEdits --allowedTools Read Edit Write Glob Grep 'Bash(init_github:*)' 'Bash(request_secret:*)'` |
| cursor | `--trust --force -p --output-format stream-json` and, for named models, `--model M`; **`auto` sends NO `--model`**. `--force` = force-allow commands in print mode (without it Cursor only *proposes* edits and rejects every command — the "Command execution was rejected" wall). `streamJson: true` on the adapter wires the NDJSON interpreter |
| codex | `exec --model M -` |
| gemini / muse / glm(command `z`) | `-p --model M` |
| custom | template with `{{MODEL}}`, `{{PROMPT_FILE}}`, `{{MODEL_FLAG}}` |

Classification helpers: `DEFAULT_USAGE_LIMIT_PATTERNS` (usage/rate limit,
quota, 429, credits, **Claude weekly-limit wording**), `looksLikeUsageLimit`
(adapter can add patterns), `TRUST_GATE_PATTERNS` + `looksLikeTrustGate`,
`PLAN_RESTRICTION_PATTERNS` + `looksLikePlanRestriction`
(ActionRequiredError / Named models unavailable / Free plans can only use
Auto / switch to auto or upgrade), and `COMMAND_REJECTION_PATTERNS` +
`looksLikeCommandRejection` ("command execution was rejected", "rejected on
every attempt", command approval denied) — matched against the model's own
words AND CLI errors.

### `streamjson.mjs`
`createStreamJsonInterpreter()` — one instance per child for `streamJson`
adapters. `feed(line)` parses Cursor's NDJSON stream (`--output-format
stream-json`): `system:init` → one engine log (model + permission mode);
`assistant` → say lines per text segment; `tool_call` → `reads X` / `writes
X` / `runs <tool> <args>` logs, with a completed write also emitting a `file`
event (absolute path); `result` → one "run finished" log, never repeating
text already streamed; contract lines (`{"event":"file"|"module"}`) pass
through; non-JSON and malformed lines pass raw; `user` and unknown event
types are ignored. RunOnce additionally dedupes `file`/`module` events by
path/id so a write reported by BOTH the CLI and the model's contract counts
once. Plain-text adapters keep the old pass-through parse.

### `prompt.mjs`
`buildConfigPrompt()` — the one-shot contract. Embeds project dir, answer
path (only source of product choice), payload dir, the 8-step build order,
module state with template paths, the attached-docs protocol (answers win;
gaps → `devos/OPEN_QUESTIONS.md`; never invent product facts), the tool
allow-list and forbidden list, the request_secret protocol, and the **exact
final line** `devos init: <owner>/<slug> is set up; devos-cycle dispatched.`
Ends with the verbatim answers JSON.

### `configmodel.mjs`
`makeShims()/ensureShims()` — per-project tmp dir with `init_github` +
`request_secret` executables (sh + `.cmd` variants) calling
`bin/devos.mjs internal:* --project <dir>`; cached per run. `runOnce()` —
writes `devos/state/config-prompt.md`, spawns via `spawnTool`, strips
`GH_TOKEN`/`GITHUB_TOKEN`, adds shims to PATH, sets `DEVOS_PROJECT_DIR`,
`DEVOS_ANSWERS`, `DEVOS_PAYLOAD`, `DEVOS_REPAIR_ROUND`; streams lines;
parses JSON events (`file`, `module`); polls `devos/state/init.json` to
emit `creating-github` / `github`. **Stop support:** the module keeps ONE
slot for the live child — `killActiveChild(reason)` kills its whole tree via
`killPidTree`; `runConfigurationModel()`/`runRepairModel()` accept a
`shouldStop()` callback and check it (a) before each round and (b) right
after a child exits, returning `{ok:false, stopped:true}` with a resume
message and emitting the `stopped` phase. A stop is checked BEFORE the
usage-limit/trust/plan classification, so a kill is never misread as a model
failure — with one carve-out: if init state is already `done` (the model had
just finished GitHub), the tree goes to the guards instead.
**`runConfigurationModel()`** — the
round loop: classify non-zero exits (usage-limit → trust-gate →
plan-restriction → error; a non-zero exit **after** init done is recoverable
and falls through to the guards); run `validateBootstrap()`; guard failures
feed a `REPAIR ROUND n of 5` prompt; success requires guards ok **and**
init state `done`. **`runRepairModel()`** — one targeted run for `devos
fix` with the same sandbox and the same classification.

### `guards.mjs`
`validateBootstrap(projectDir, answers, {engineRoot})` → `{ok, report[]}`.
Eleven areas: (1) `devos/project.json` — base `main`, `maxAttempts: 3`,
reviewer/builder ids, `configurationModel.stage === 'configuration-only'`,
pickPolicy valid, builderPool contains default, requiredChecks carry
typecheck/test/build; (2) `devos.config.json` present; (3) stack files
(manifest, configFiles, tsconfig/pyproject/go.mod per language, `.env.example`
names only, `.gitignore`, `.editorconfig` LF); (4) automation — 10 workflows,
`scripts/devos/cycle.mjs`, `scripts/guards/run-all.mjs`, the docs set,
T01 fence, 4 prompts, 2 issue forms, PHASES has T01 not-done, OPEN_QUESTIONS
when docs attached; (5) fence headers `Reviewer:`/`Builder:` exactly, and
**never** a `Configuration model:` role; (6) module parity — ON modules'
files exist, OFF modules' files are absent (`moduleMarkers()`: server
modules per language dir, hosting files, tailwind/shadcn/playwright
markers, automation workflows); (7) `.env.example` names match module
providers/impls; (8) automation never references the configuration model
(regex scan of workflows + scripts/devos); (9) workflow YAML lint
(`lib/yamllint.mjs`); (10) architecture manifest (expected/absent paths,
health route file, architecture test); (11) `docs/DECISIONS.md` records
reviewer/builder/configuration-model ids and framework.

### `initgithub.mjs`
`runInitGithub({projectDir})` — the only GitHub write of the stage, via the
shim. Once-only (state `done` refuses). Writes `devos/state/init.json`
`running` → git init `-b main`, add, commit → `gh repo create
<owner/slug> --visibility … --source . --remote origin --push`. When that
fails the flow can no longer dead-end on GraphQL "Could not resolve to a
Repository" (the user's real continue run died exactly there):
  1. `gh repo view <owner/slug>` resolves → **adopt**: `aimRemote()` (add or
     re-point origin) + `pushMain()` (a rejected push is retried after
     `fetch` + `rebase -X theirs origin/main`, our tree wins conflicts).
  2. view replies NOT-FOUND → **`findOwnedRepo()`**: `gh api user` → the real
     login; if it differs from the slug owner, view `<login>/<name>`;
     then `gh repo list` with a case/separator-insensitive name match. A hit
     is adopted under its real name (`adoptedFrom` records the slug).
  3. still nothing → **retry the create** (plain, then remote + push).
  4. every attempt failed → throw with both error messages and the auth/scope
     guidance; the init state is left `status:'error'` (never stale
     `running`). `devos continue` then escalates to a model consultation.
→ `gh variable set DEVOS_ACTIVE_MODULES/DEVOS_TYPE/DEVOS_FRAMEWORK` →
`gh workflow run devos-cycle.yml` → setup issue listing missing secret
**names** (from `devos/state/secrets.json`) → record `repo` into
`devos/project.json` → final state `{status:'done', repo, repoUrl,
actionsUrl, setupIssueUrl, runUrl, visibility, dispatchedAt[, adoptedFrom]}`.
Uses `runToolSync` (Windows-safe).

### `secret.mjs`
State paths + `readInitState()`, `readSecretsState()`, and
**`runRequestSecret()`**: validates UPPER_SNAKE_CASE, requires init done,
spawns `gh secret set NAME --repo <repo>` with `stdio: 'inherit'` (your real
TTY, hidden input), records only `{name: {status, at}}`.

### `spawn.mjs`
The Windows-safe spawn layer. `resolveTool()` caches `where` results; `.exe`
execs directly, `.cmd/.bat` runs as a **quoted command line string** +
`shell:true` (args-array + shell:true is the deprecated DEP0190 combination
and is never used). `winQuote()` quotes only engine-controlled tokens;
prompt text never rides argv. `spawnTool()` (async, long runs) and
`runToolSync()` (gh/git). **`killPidTree(pid)`** — whole-tree kill:
`taskkill /pid X /T /F` on Windows, SIGTERM then SIGKILL on POSIX; never
throws on a dead pid.

### `init.mjs`
`createProjectFolder()` (workspace + slug name), `writeIntakeDocs()` (up to
8 docs, name sanitized, into `devos/intake-docs/`), **`runInit()`** —
finalize → write answers (~/.devos + project copy) → defaults if asked →
folder → last-project.json → resolve agent → `runConfigurationModel()`;
**`resumeInit({projectDir, overrides})`** — patch + persist
`answers.json`, resolve agent, run. Both thread an optional `shouldStop`
callback down to the run loops. A custom-tool CLI id resolves from the
answer's attached `agent` fields, not from detection.

### `continue.mjs`
The smart resume. **`assessProject({projectDir, answers, gh})`** — the ordered
checklist (answers → guards → deps → github → secrets) with done/todo/wait per
step and its owner; `gh:false` keeps it local-only for UI listings (deps WAITS
while the tree fails the guards — never install against a half-written tree).
**`runContinue({projectDir, home, overrides, emit, shouldStop, installFn, decide})`** —
assess → model resume ONLY when the guards fail (same restricted environment and
classification as init) → built-in install via `spawnTool` streamed as
`stream:'install'` (`[deps]` in terminals; node_modules marker or the
`devos/state/continue.json` record for go) → built-in `runInitGithub` (an
existing repository is adopted) → secrets names-only. **When the install or the
GitHub step still fails, the run escalates to `consultModel()` (consult.mjs):
the configuration model proposes a fix, the user approves it through the
injected `decide` callback, the approved commands run (`stream:'repair'`,
`[fix]`), and the failed step is retried once.** A decline, an unusable
proposal, or a stopped run returns the ordinary resumable failure. Persists
last-project.json and the continue-state record; returns FLAT (unlike runInit's
`{result, projectDir, answers}`) — callers wrap it. `devos init --continue`
routes through the same function; `resumeInit` in init.mjs stays as the raw
model-only resume for compat.

### `consult.mjs`
The model-consultation loop for failed built-in steps. **`parseProposal(lines)`**
— the LAST usable proposal in the model's output, normalized to
`{diagnosis, commands:[{run, why}] (≤5), userSteps[]}`, null when unusable.
Search order: fenced blocks in the raw text, then stream-json NDJSON lines
unwrapped to their string values (Cursor hides the fence inside a JSON string
field — the escaped form defeated the fence regex and cost a whole run), then
a bare object line, then a balanced-brace scan for fenceless output.
**`buildConsultPrompt({stepLabel, errorLines, tried, projectDir})`** — the
failure context plus the strict reply contract (non-interactive, local, safe
commands only; logins/plans/keys go to `userSteps`; no file edits).
**`consultModel({projectDir, answers, agent, stepLabel, errorLines, tried,
emit, shouldStop, env, decide})`** — emits phase `consulting`, runs the prompt
through `runRepairModel` (so usage-limit/trust/plan walls classify exactly like
init), emits the `proposal` event, awaits `decide(proposal)` (terminal y/N or
the browser card), and on approval emits phase `applying-fix` and runs each
command via `spawnTool` streamed as `stream:'repair'`, stopping at the first
nonzero exit. Nothing ever runs without the user's decision; a closed stdin is
a decline, never an approval.

### `progress.mjs`
The live-progress reducer — pure, no timers, injected `now` for tests.
`createProgressState()` + **`applyEvent(state, evt)`** consume the same run
events the UI already receives; **`progressSnapshot(state)`** renders
`{percent, phase, failKind, stopping, elapsedMs, lastOutputAgoMs,
counters:{files,modules,lines,reconnects,rounds}, lastLine, steps[4]}`.
Percent rules: baseline 2 → 6 on writing; +2/file, +1/module, +4/repair
round, capped 84 until GitHub; `creating-github` ≥88; github done ≥95;
final ok = 100; a slow time floor (+3%/min, cap 70) covers a silent-working
model; failed/stopping/stopped FREEZE the number (never fake progress).
**`progressSnapshot` recomputes the percent on every call** — a snapshot
taken during a silent stretch moves with the time floor even though no event
arrived (a percent that only moves on events sat frozen at 6% for ten-plus
minutes; that is the bug this kills). `renderStatusLine()` (one terminal
line, including the model's last action) and `renderChecklist()` (one-line
todo) format it; the todo marks exactly the step where a run ended
(`stopped`) via `state.activeStep`.

### `server.mjs`
`startServer({home, workspace, port})` — plain `node:http` on
127.0.0.1 (7788, then +1 up to +20). Routes: `GET /`, `/app.css`, `/app.js`,
`/hairline.js`, `/hairline-custom.js`, `/hairline-stage.js`;
`GET /api/state` (steps, draft, defaults, machine, agents, recommendation,
types, modules, stacks, tools, pickPolicies, running, **live progress**,
lastRun); `POST /api/draft`; `POST /api/probe`; `GET /api/events` (SSE:
replays buffered events then live, **including `progress` snapshots**);
`POST /api/confirm` (single run at a time; attaches `remainingSteps` audit
on failure); **`POST /api/stop`** (flags the run + `killActiveChild()`);
`GET /api/result`. Resolves `{server, url, port, stopRun, isRunning}` so
the CLI can wire Ctrl+C to the same stop path. Every event is mirrored to
the terminal: model lines as `[agent] …`, engine sentences as `[devos] …`,
a checklist line on each phase change, a status line at most every 10 s, a
30 s heartbeat while the run is alive, and `Stopped by you` (never
"FAILED") for a deliberate stop.

### `wizard.mjs`
`STEPS` (9 ids), `modelsReadiness()`, `reviewerOptions()/builderOptions()`
(installed + githubCapable + promptTemplate), `configurationModelOptions()`
(any installed), `recommendedConfiguration()` (CONFIG_PICKS preference list,
id must exist in visible groups), `selfGradingWarning()`,
`validateProject/Framework/Modules/Languages` (cross-module rules: Supabase
Auth needs Supabase DB, shadcn needs React, skeleton needs SvelteKit,
search postgres-fts needs a Postgres DB, non-UI types refuse
styling/ui-kit), `summaryRows()`, and **`requiredSecretNames(draft)`** —
the keys contract: reviewer tool secrets + builder tool secrets + ON-module
provider/impl env names (+ hosting). The configuration model gets none.

### `verify.mjs`
`auditSetup()` → rows over four sections (machine, github, agents, project);
`ready = no 'block'`; `youSteps`/`modelSteps`; `remainingSteps()` (compact
shape for UI/server); `printVerify()`; `buildRepairPrompt()` (model-fixable
rows only + the no-secrets rules + "fixed: <problem>" closing contract);
`resolveProjectFolder(args, home, cwd)` (a value directly after a `--flag`
is never the folder; falls back to `~/.devos/last-project.json`);
`printRemainingSteps()`.
**Agent-rows filter:** with a configuration model chosen, ONLY that CLI is
audited (installed → signed-in → model availability); unselected CLIs get no
rows at all. Without a choice, every CLI is a quiet `ok` info row with no
`fix` and no `who` — unselected tools must never become "you fix" work.

### `fix.mjs`
`runFix()` — load answers, apply/persist overrides, audit; **no
model-fixable rows → the model is never invoked** (returned with a clear
message); otherwise `buildRepairPrompt` → `runRepairModel` → re-audit →
`{ok, modelRan, before, after, message}`. `printFixReport()` renders
before → model pass → after.

### `watch.mjs`
`runWatch({projectDir, intervalMs, maxPasses, audit, readAnswers, sleepFn,
onPass, out})` — the audit loop. Each pass: re-read answers → audit → diff
row states (`section/label` key) → print via **`printWatchPass()`**
(compact rows, `*` marks changed rows, fix lines always shown for non-ok,
footer with you/model counts and next-pass countdown; final pass prints
`ALL GREEN` or `Still not ready after N passes`). Injectable
audit/readAnswers/sleepFn make tests instant. Returns
`{ready, passes, audit, slept}`.

### `keys.mjs`
`KEY_SOURCES` (name → where-to-get), `keyCatalog(answers)` from
`requiredSecretNames`, `listGithubSecrets` (`gh secret list --json name`),
`checkKeys` (needed ∩ set → ready/MISSING), `keysNotesMarkdown()` +
`writeKeysNotes()` (devos/KEYS-NOTES.example.md), `readAnswersFromProject()`.

### `upgrade.mjs`
`engineFilePaths()` (scripts/devos, scripts/guards, devos-*|ci.yml
workflows, devos/prompts), `runUpgrade()` — clean tree required; branch
`devos/upgrade-<v>`; LF-normalized sha256 baselines in
`devos/engine-hashes.json` detect user-edited files → conflicts left
untouched; full rollback (reset --hard, delete added files, delete branch)
on any failure.

### `cli.mjs`
HELP text (plain sentences) + `cmdInit` (with `--continue` parsing,
overrides, remaining-steps on failure, UI vs terminal wizard), `cmdUi`,
`cmdDoctor`, `cmdKeys`, `cmdVerify`, `cmdWatch` (SIGINT handler, interval
clamp ≥3 s, `--once`, `--max-passes`, `--json`), `cmdFix`, `cmdAgentsDetect`,
`cmdAccounts`, `cmdStatus`, `cmdUpgrade`. `printEvent()` maps engine phases
to terminal lines (model lines get the `[agent]` prefix here too);
`printFinalScreen()` prints links + your job, with a dedicated "stopped by
you" branch (exit code 130 for a stop, 1 for a failure).
**`stopOnCtrlC({onFirst})`** — the shared Ctrl+C policy for `init
--continue`, the terminal wizard, and `fix`: first Ctrl+C kills the model
process tree (`killActiveChild`) and lets the run return its clean stopped
result; a second Ctrl+C force-quits with code 130; the handler removes
itself when the run ends.

### `start.mjs`, `termwizard.mjs`, `logo.mjs`, `yamllint.mjs`, `docs.mjs`
`runStart()` — the launcher (DI `{argv, stdin, stdout, check, launch}`;
`--check`; blocks with download pages; approval gate). `runTerminalWizard()`
— the numbered-list fallback mirroring the UI steps. `renderLogo()`. A
minimal YAML sanity linter for workflow files. `collectDocs()` — attaches
user documents for the wizard.

### `ui/app.js` + `index.html` + `app.css` + `hairline*.js`
Vanilla JS wizard: polls `/api/state`, renders the 9 steps, dropdowns from
`groups` (marks CLI-reported ids "— on your account", Cursor Free-plan hint
account-aware), attaches docs, saves draft per step, Confirm → SSE progress
(log lines, file/module events, phases, **`progress` snapshots**), final
card with links and, on failure, the remaining-steps list with
you-fix/model-fix badges. The run view is the **live run panel**: percentage
+ bar, the 4-item todo checklist (`✓ done · ▸ active · · pending · ! where
the run ended`), counters (files, modules, model lines, reconnects, last
output age), the full log feed (capped at 800 lines), and the red
**■ Stop — kill the model process** button (`POST /api/stop`, then the UI
waits for the stopped final card). A `progress` SSE event fully replaces the
panel state — no client-side timers, no guessing.
**Figure stage:** `hairline-stage.js` (ES module, loads before `app.js`)
exposes `window.DEVOS_FIGURES {mount, setPhase, stop}` and rotates five
figures — `terminal`, `cabinet`, `slow` from the vendored **`hairline.js`**
(@lucasmarkes/hairline 0.5.1, MIT, full vendor of `dist/index.js` with
attribution banner) plus **`hairline-custom.js`** `firecrawlReader()` and
`cursorTab()` written in the same style (400×320 viewBox, `--hl-*` palette
with DEV_OS fallbacks, self-playing rAF loop, reduced-motion rest pose).
`app.js` mounts the stage when the run view renders, advances one figure per
phase change, and stops it on the final card.

---

## 5. Data files and schemas

### Under `~/.devos/` (or `DEVOS_HOME`)
| File | Schema / content |
|---|---|
| `draft.json` | `devos/draft@1` — the wizard draft; `assertNoSecrets` enforced |
| `defaults.json` | `devos/defaults@1` — saved model ids + visibility + languages |
| `answers/<slug>-<stamp>.json` | `devos/answers@1` — immutable copies per run |
| `last-project.json` | `{path, slug, at}` — default folder for status/verify/fix/watch/keys |

### Inside a project (`<workspace>/<slug-name>/devos/…`)
| File | Written by | Content |
|---|---|---|
| `answers.json` | runInit/resumeInit/fix | the product truth; overrides patch + persist here |
| `project.json` | the model; initgithub adds `repo` | base `main`, maxAttempts `3`, reviewer/builder/lightReviewer/builderPool/pickPolicy/requiredChecks, `configurationModel{stage:'configuration-only'}` |
| `state/init.json` | initgithub | `running` → `{status:'done', repo, repoUrl, actionsUrl, setupIssueUrl, runUrl, visibility, dispatchedAt}` |
| `state/secrets.json` | request_secret | names + `set`/`missing` only, never values |
| `state/config-prompt.md` | configmodel | the exact prompt the model received |
| `intake-docs/` | runInit | attached documents |
| `OPEN_QUESTIONS.md` | the model | questions to you (or "No open questions.") |
| `KEYS-NOTES.example.md` | devos keys | names + instructions only |
| `engine-hashes.json` | devos upgrade | LF-normalized sha256 baselines |
| `fences/T01.md`, `prompts/*.md` | the model | first task + role prompts |

---

## 6. `payload/` — what the configuration model copies

- **`catalogue.json`**: `types` (16), `modules` (16, incl. locked `automation`
  and provider/env tables), `tools` (6: cursor/`agent`, claude/`claude`,
  codex/`codex`, gemini/`gemini`, muse/`muse`, glm/`z` — each with
  `githubCapable`, `githubSecrets`, `seedGroups`, `modelsArgs`,
  `authProbe`, `altCommands`), `customTool` (registration spec),
  `builderStrengths`, `pickPolicies` (`reviewer-picks`, `default-only`).
- **`stacks/*.json`** (21): id, label, languages, `fits`, packageManager,
  `commands` (install/typecheck/lint/test/build/e2e), `configFiles`,
  `arch` (web/api/cli/library/mobile), note.
- **`modules/<id>/template/`**: skeleton files copied only for ON modules;
  `module.json` describes the module.
- **`modules/automation/template/`**: the 10 workflows, `scripts/devos/*.mjs`
  (cycle, common, advance, intake, doctor, resume, setup, supervisor, wait,
  deploy), `scripts/guards/run-all.mjs`, `devos/prompts/{builder,reviewer,
  intake,revise}.md`, `devos/fences/T01.md`, issue templates.
- **`architecture/<arch>/manifest.json`**: `paths` (must exist), `absent`
  (must not), `health`, `architectureTest` — enforced by the guards.

### The CI-side contract (`scripts/devos/common.mjs` in a project)
- `readProjectJson()/saveProjectJson()`, `writeState()/readState()` under
  `devos/state/`.
- **`assertNotConfigurationModel(cfg, role, cli, model)`** — refuses to run
  unless `configurationModel.stage === 'configuration-only'`, never runs role
  `configuration`, refuses empty role rows.
- `gh()/git()` helpers (Windows shell-safe).
- **`buildModelArgs(cli, model, promptFile)`** — the CI mirror of the local
  adapters: claude `-p --model … --permission-mode acceptEdits …`; cursor
  **`--trust --force -p`** with **no `--model` for `auto`** (the CI builder
  needs `--force` exactly like the local config model — without it print mode
  only proposes edits and a cycle stalls on its first change); codex
  `exec --model … <promptFile>`; gemini/muse/glm `-p --model …`.
  **If you change a local adapter, change this mirror in the same change.**

---

## 7. Test conventions (`test/`)

Runner: `node --test 'test/*.test.mjs'` — no test framework dependency.

### Environment (`helpers.mjs`)
`makeTestEnv(t)` sets `DEVOS_HOME` (temp), `DEVOS_FAKE_LOG`, `DEVOS_NO_BROWSER`,
`GITHUB_REPOSITORY=octodev/order-desk`, and **prepends
`test/fixtures/bin` to PATH** — every `agent`/`claude`/`gh`/`git`/`muse`
invocation in tests hits a fake. `cleanupTestEnv(t)` removes the temp dirs.
`fakeLogEntries(fakeLog)` reads what the fake was asked.

### Fake executables (`test/fixtures/bin/fake-cli.mjs`)
One dispatcher, mode-driven by env:
- `DEVOS_FAKE_MODE=untrusted` — the fake cursor refuses without `--trust`
  (verbatim trust-gate wording).
- `DEVOS_FAKE_MODE=plan-restricted` — the fake cursor refuses any `--model`
  invocation with the verbatim Free-plan error; `auto` invocations succeed.
- `DEVOS_FAKE_MODE=needs-force` — the fake cursor refuses any prompt-mode
  invocation without `--force` (verbatim "Command execution was rejected"
  wording); with `--force` it runs normally. Proves the flag is sent.
- `DEVOS_FAKE_MODE=stream` — the fake cursor speaks `--output-format
  stream-json` NDJSON (system init, assistant messages, completed write tool
  calls mirroring the writer's file events, result) around the ordinary
  bootstrap-writer; gated on `--force` AND `stream-json` being present.
- `DEVOS_FAKE_MODE=guard-always`, `no-github`, `no-github-reject` —
  guard/init failures; `no-github-reject` finishes the tree, never calls
  init_github, and says "Command execution was rejected on every attempt" in
  the model's own words (exit 0) — the permission-wall recognition path.
- `DEVOS_FAKE_MODE=hang` — the fake CLI prints a first line, then prints
  "Connection lost, reconnecting (attempt N)…" every 250 ms and NEVER exits
  (a live interval + a pending top-level await; it must not fall through to
  the bootstrap or to `die()`). Exists solely for the stop/kill path: the
  engine has to kill it and return `stopped: true`.
- `DEVOS_AGENT_ACCOUNT` — the fake `agent status`/`whoami` output.
- `DEVOS_AGENT_STATUS_FAIL=1` — status probe fails (account unknown path).
- `DEVOS_FAKE_MODELS` — newline-separated `agent models` output.
- `DEVOS_GH_MISSING_SCOPES=1` — fake `gh auth status` lacks repo/workflow.
- `DEVOS_GH_BAD_TOKEN=1` — fake `gh api user` returns 401.
- `DEVOS_GH_REPO_MISSING=1` — fake `gh repo view` fails (older flag: every view).
- `DEVOS_GH_REPO_EXISTS=1` — fake `gh repo create` refuses ("already exists");
  the adoption fallback (view + remote + push) is what runs.
- `DEVOS_GH_VIEW_MISS=<name>,…` — those exact repositories are NOT visible to
  fake `gh repo view` (the GraphQL "Could not resolve" reply the user hit);
- `DEVOS_GH_VIEW_MISS_FIRST=1` + `DEVOS_GH_STATE=<file>` — only the FIRST view
  misses (the counter file also drives `DEVOS_GH_CREATE_FAIL_FIRST=1`, which
  fails only the first create — together they prove the retry-after-consult
  loop); `DEVOS_GH_LOGIN=<login>` — the login `gh api user` reports (the
  owner-mismatch adoption); `DEVOS_GH_REPO_LIST=<json>` — the `repo list`
  payload the listing match reads.
- `DEVOS_FAKE_MODE=consult` — the fake agent answers a failure consultation
  with one fenced JSON proposal (`DEVOS_FAKE_CONSULT_CMD` overrides the single
  proposed command, default `git remote -v`).
- `DEVOS_GIT_FAKE_PUSH=1` — fake git virtualizes push/fetch/rebase (no live
  remote exists in tests); `DEVOS_GIT_FAIL_PUSH=1` makes push fail with a
  realistic rejection.

### Test files (121 tests, all must stay green)
`start`, `server`, `catalogue`, `probes` (incl. muse available-first),
`accounts`, `guards-doctor`, `keys-docs`, `init-configmodel` (--trust passthrough,
auto without --model, planIssue + persisted overrides), `verify-fix` (10),
`watch` (7), `progress-stop` (7: reducer/monotonic-freeze/renders,
killPidTree, shouldStop-before-spawn, the full Stop-button e2e against a
hung fake, stop-without-run), `stream-visibility` (9: cursor --force +
stream-json args, command-rejection patterns, the interpreter contract, the
stream e2e with file dedupe, needs-force e2e both ways, no-github-reject,
stale-percent fix, chosen-model-only audit, hairline stage served),
`continue` (11: the no-github-reject + repo-exists e2e where the engine
finishes ALONE with the model never woken, the already-done no-op, the
broken-tree model-resume e2e, the assessment checklist + deps-wait rule,
failed install, rejected push, secrets names-only, the devos-owned verify
row, the CLI no-project pointer, findStartedProjects, and the full
`bin/devos.mjs continue` journey),
`upgrade`, `cycle` (CI-side). Adding behavior?
Add a test here, using the fakes — never the network, never a real CLI.

### Testing patterns worth copying
- `runWatch` injects `audit/readAnswers/sleepFn/out` — time-free tests.
- `runFix`'s "no model-fixable rows → model never invoked" is asserted via
  the fake log (no fake invocation recorded).
- The repair-prompt secrecy test asserts no keyCatalog name appears.
- `progress.mjs` injects `now` — the whole percent/checklist state machine is
  tested with a fake clock; the Stop e2e is the only async one (hang fake,
  ~2 s).
- The stop e2e polls `counters.lines >= 1` as its "run is live" signal —
  percent has a nonzero baseline and is NOT a liveness signal.

---

## 8. Platform notes

- **Windows spawning**: never `spawn(cmd, args, {shell:true})` with an args
  array (DEP0190 + broken quoting). Use `lib/spawn.mjs`. Prompts go over
  stdin (`child.stdin.end(prompt)`), so no argv size/escaping limits.
- **PATH shims** exist as both `sh` and `.cmd` so the model's Bash calls work
  cross-platform.
- **`--trust`**: marks the project folder trusted for Cursor's CLI; it does
  NOT auto-approve tool calls.
- **`--force`** (alias `--yolo`): force-allows commands in Cursor print mode.
  Required for the config model AND the CI builder/reviewer — without it
  Cursor only *proposes* edits and rejects every command ("Command execution
  was rejected"). It is part of the sandbox contract: cwd confined to the
  project folder, fixed prompt, shims, no secrets.
- **Timezones/dates**: engine outputs ISO timestamps only.

---

## 9. How to modify the engine safely

1. **Read DECISIONS.md first** — most "why is it like this" questions end
   there (e.g. why auth-state is heuristic, why stdin delivery, why the
   configuration model is once-only).
2. **Keep the constraint list in §1.** Zero deps, local-only, no secret
   values, once-only configuration model, Windows-safe spawning.
3. **Mirror contracts**: local adapter change ⇒ `payload/.../common.mjs
   buildModelArgs` + fake fixture + tests. New detector pattern ⇒
   `lib/adapters.mjs` + a classification test with verbatim vendor wording.
4. **Guards are load-bearing**: if you add a file the model must write, add
   it to `validateBootstrap` AND to the automation template AND (when
   engine-owned) to `upgrade.mjs` `engineFilePaths`.
5. **Keys**: any new module provider must declare its `env` names in
   `catalogue.json` (they flow into `.env.example` guards,
   `requiredSecretNames`, and the keys guide) and get a `KEY_SOURCES` entry.
6. **Run `npm test`** before and after; new behavior needs a new test.
7. **Update the docs**: HELP text in `lib/cli.mjs` for CLI changes;
   QUICKSTART/MANUAL for user-facing steps; this file for structure.
8. **Repackage**: the deliverable zip is built from an explicit manifest
   (no logs, no `.env`, no worklog) into `download/devos-engine.zip`.
9. **Append to `worklog.md`** (Task ID + what + why) — it is the engine's
   change history.

### Known pitfalls (each one bit us once)
- Prompt handed as a file path where the prompt text belongs
  (`promptDelivery 'arg'` exists for that; built-ins use stdin).
- `join is not defined` in tests — helpers' `fresh()` must destructure what
  it returns; test files must import what they assert with.
- PassThrough stdin in tests is not a TTY — `runStart` prints a distinct
  line for that; do not assume interactive.
- A non-zero model exit **after** init_github succeeded is recoverable —
  classify via guards, do not fail the run outright.
- `resolveProjectFolder` must skip flag values (`--max-passes 2` is not a
  folder) — covered by a regression test.
- Account silence ≠ Pro: only `agent models` and the run-time refusal are
  authoritative; the engine never guesses a plan. But a CLI that never answers
  `agent models` must not park a model at "unverified — you fix" forever:
  after any completed model run the engine records the proof in
  `devos/state/model-run.json` and the audit shows the model as verified in
  practice (test: verify-fix "a completed model run proves availability").
- The cycle's Actions runner must have the agent CLIs installed by the WORKFLOW,
  never by luck: the canonical devos-cycle.yml runs `scripts/devos/install-clis.mjs`
  (cursor via cursor.com/install + GITHUB_PATH, the rest as npm globals), the
  guards require both the script and the workflow step, and cycle.mjs pre-flights
  the binary and the mapped secret before spending an attempt — a mapped-but-empty
  secret WAITS with the setup issue, a missing binary fails with the exact fix
  (the "builder exited with code null" wall).
- A real repository ships its own front matter: README.md (names the project),
  AGENTS.md (rules every agent reads), and docs/adr/ADR-001-stack.md — all
  required by the guards, templated in the automation payload (the bar the
  user's devos-control-tower set).
- Repairs after init_github are not lost on disk: when continue repairs the tree
  while the repository already exists, syncRepoPush commits and pushes the
  repaired tree to main ("github-sync" in the resumed list).

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Configuration model | the once-only local model that writes the project and creates the repo |
| Reviewer / Builder | the two GitHub-side roles chosen at init |
| Fence | `devos/fences/Txx.md` — one task, with Reviewer/Builder headers |
| Human gate | the `devos:human-gate` PR label only you merge |
| Bootstrap guards | `validateBootstrap()` — 11-area validation feeding repair rounds |
| Shims | `init_github` / `request_secret` PATH executables in the model's sandbox |
| Answer file | `devos/answers.json` — the single source of product choice |
| Remaining steps | audit rows (fix + who) attached to every failure — never a dead end |
