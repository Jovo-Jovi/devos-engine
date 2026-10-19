# Dev OS automation — operating manual

The single description of the automated cycle as a machine: who does what, every workflow, script,
guard, label, status, marker and setting, how they hand off, what happens when something fails, and
how to change the automation safely. **Read this first for any work on the method itself** (a method
fix, a new module, a new check). `guard:manual` fails when a workflow, runner script, guard, prompt,
repository variable, label or `/devos` command exists that this manual does not name, so every
method change updates it in the same PR.

Precedence: `CLAUDE.md` and `docs/method/PRECEDENTS.md` (the binding rules) outrank this manual;
this manual describes how the repository implements them. Where they disagree, the precedent wins
and this file is corrected.

The method this machine runs is the handbook, `docs/method/DEV_OS_V2_REVIEWER.md`:

- the five pillars (§1);
- the journey J0–J11 (§3);
- the documents in precedence order (§4);
- ODs, carry-forwards and precedents (§5);
- the fence and the verdict (§6);
- gates (§10).

`README.md` summarises the method and this manual on one page.

## 1. Roles and invariants

| Role | Who | May change | Never |
|---|---|---|---|
| Human | you | everything; signs ODs and gates by merging | — |
| Builder | Grok in Cursor CLI (`agent`) | product code, tests, its report (`surfaces.builder.deny` says what not); in a method fix, the method files its fence names (`surfaces.builder_method`) | git, gh, secrets, fences, reviews, ledgers |
| Reviewer | Claude Code (`claude`) | `docs/reviews/**`, `docs/fences/**` (PR-07); intake/method runs: docs listed in `surfaces.intake` | code, tests, configs |
| Runner | GitHub Actions + `scripts/devos/` | git, PRs, labels, statuses, the PHASES ledger | deciding a verdict (it applies `verdict.mjs`) |

Invariants every change must keep: the Boundary gate is non-waivable · red checks override PASS
(PR-08) · nothing merges before its verdict (PR-13) · human gates (risk 3, a gate, a migration or
rules change, a method change) wait for your merge · agents never hold a git credential (PR-04) ·
secrets never enter a file · fetch, never paste (PR-02) · a usage limit is a wait, not a failure
(PR-12, PR-29).

## 2. The flows

**New work.** Issue form "Dev OS change request" (label `devos:request`) → `devos-intake` (Claude,
gate model) plans it on `intake/issue-N`: draft OD, scope row, PHASES rows, first fence,
`docs/requests/issue-N.md`, settings in `docs/setup-items.json` → intake PR (`devos:intake`) → your
merge signs the OD → `devos-advance` dispatches `devos-cycle`.

**Staged fences (PR-38).** Before writing a fence the reviewer (or intake) judges its size with the
`devos-fence-writing` skill; a fence that does not fit one builder run gets `- Stages: N` and
`### Stage k` blocks. The cycle builds one stage per run: the stage is read back from the attempt's
last builder commit ("(stage k of N done)" → k+1; "(stage k of N)" → continue k), a finished stage
makes `builder-status.mjs` return `continue` (unless its report says `STATUS: HALT`), and the review
runs once, after the last stage. Intake splits big work into separate ledger rows.

**One task attempt** (`devos-cycle`, one run = one attempt of one task):
1. `resolve`: `next-task.mjs` picks the task (method fixes first, PR-28); `setup-check.mjs --for
   cycle` stops a run that has no credentials (PR-27); `heavy.mjs` announces or holds heavy runs (PR-20).
2. `cycle`: branch `task/Tnn` (a reissue continues it, PR-03) → `builder-model.mjs` picks the Grok
   id → `modules.mjs start` brings up the local services → Grok builds (`accounts.sh` switches
   Cursor accounts on a limit, PR-29; `agent-watchdog.sh` stops a hung CLI inside the step) → `guard-surfaces.mjs builder` + the method-file guard (from
   main's workflow) → commit, `sync-main.sh`, push → PR → `builder-status.mjs` (ok / park / halt) →
   `run-checks.mjs` + `checks-status.sh` (status `devos/checks`) → preview + `screens.mjs` (settled screenshot, filmstrip, reduced-motion screenshot and layout shift, written to `.devos/screens/motion.json`) →
   `review-mode.mjs` (light/deep) + `evidence.mjs` → Claude reviews (account switch, PR-29) →
   `guard-surfaces.mjs reviewer` → `verdict.mjs` decides → review commit, sync, re-check if main
   moved (PR-25), statuses → act.
3. Actions: `merge` (auto-merge, label `devos:auto-merged`, next task dispatched) · `human_gate`
   (label `devos:human-gate`, doctor dispatched) · `retry` (next attempt with the reissued fence) ·
   `quota_wait` (label `devos:quota-wait`, `wait-and-resume` job or `devos-resume`) · `setup_wait`
   (PR-27, `setup-issue.mjs wait`) · `halt` (label `devos:halted`, doctor dispatched).

**Gates.** `devos-doctor` keeps one comment per PR (marker `devos-doctor`), sets `devos/gate`, labels
`devos:needs-you` when only you can act, re-checks gate PRs when main moves (PR-25), and asks Claude
for a read-only second opinion when no rule explains a failure. Your merge → `devos-advance`.

**Production.** Push to main by you → `devos-deploy`: `which` skips the runner's auto-merges →
settings check (PR-27) → guards → storage preflight (PR-26) → database backup + migrations (PR-18) →
Firestore rules + seed (PR-26) → Vercel build and upload (`vercel-deploy.sh`, PR-16, PR-24) → strict
smoke test with `probe.mjs`.

**Settings.** `devos-setup` (push to main, `/devos setup`, every two hours via `devos-resume` while
the issue is open) → `setup-check.mjs` → `setup-issue.mjs sync` keeps the issue "Dev OS: setup
needed" (label `devos:setup`) and resumes waiting runs and a failed deploy when complete.

**Method fixes and improvements.** Issue form "Dev OS method fix" (label `devos:method`), for a
problem or for a change in how the automation works → `devos-intake` in method mode
(`devos/prompts/method.md`) with the linked runs' logs → PR with diagnosis and a Phase `PM`
task → your merge → the fix runs first, Grok builds, deep review forced, your gate forced →
`devos-advance` restarts the task the fence's `Resume after merge` names.

**Usage limits.** A run stopped by a limit is parked (label `devos:quota-wait`, a `devos-resume`
or `devos-intake-resume` marker with the reset time). Waits up to `resume.inline_wait_max_minutes`
are slept in the same workflow; longer ones go to `devos-wait`, which relays itself until the reset
(`resume.relay`: on public repositories by default, where runner minutes are free); `devos-resume`
is the scheduled backstop. A limit that states no reset time is retried after 60, 120, 240 …
minutes (capped by `resume.max_backoff_minutes`), and a parked planning run keeps one wait comment
on its issue, updated at each check (PR-31).

**Revisions.** `/devos revise <what>` on a task PR → reissued fence → next attempt (may pass
`max_attempts`). The revision is read from the task branch as well (the commit "Tnn: fence reissued
for human revision (attempt N)"), and every resume path passes `revision` on, so an attempt parked
by a usage limit resumes as the revision it is.

## 3. Workflows (`.github/workflows/`)

| File | Triggers | Jobs | Does |
|---|---|---|---|
| `devos-cycle.yml` | dispatch only (form: task, attempt, review_only, effort, fast, revision, reuse_review, go, cursor_account, claude_account) | `resolve`, `cycle`, `wait-and-resume` | one task attempt, end to end (§2) |
| `devos-intake.yml` | issue labelled `devos:request` / `devos:method`; comments `/devos intake`, `/devos go`, `/devos revise`; dispatch (resume) | `intake`, `intake-wait`, `go`, `revise` | plans requests and method fixes; holds and resumes plans across limits; releases held runs; revisions |
| `devos-advance.yml` | PR closed (merged, `task/` or `intake/`, not auto-merged) | `advance` | dispatches the next task, or restarts the task a method fix unblocked |
| `devos-doctor.yml` | ci finished; `/devos doctor`; push to main; dispatch (PR) | `gates`, `doctor` | the gate doctor (§2) |
| `devos-resume.yml` | every 2 hours; dispatch | `resume` | backstop for parked runs and plans; re-checks the setup issue |
| `devos-setup.yml` | push to main; `/devos setup`; dispatch | `setup` | the setup check and issue (PR-27) |
| `devos-deploy.yml` | push to main; dispatch (production/preview) | `which`, `deploy` | production order (§2) |
| `ci.yml` | push to main; dispatch | `checks` | the same checks on main (PRs are checked by the cycle, PR-25) |
| `devos-wait.yml` | dispatch only (from the waiting jobs) | `wait` | long usage-limit waits: sleeps as long as one job may, starts itself again, resumes the planning or task at the reset (PR-31) |
| `devos-supervisor.yml` | any `devos-cycle`, `devos-intake`, `devos-deploy`, `devos-resume`, `devos-wait`, `devos-advance` or `ci` run finishing; every 30 minutes (:11, :41); `/devos approve <id>` / `/devos reject <id>` on the supervisor issue; dispatch (dry run) | `supervise` | finds stopped or stalled work, fixes what is safe, turns the rest into approvals (`supervisor.mjs`, §4) |

GitHub rules the design depends on: pushes and merges made with the built-in `GITHUB_TOKEN` start no
workflows (except `workflow_dispatch`), so the runner dispatches explicitly; `GITHUB_TOKEN` can never
push a change to `.github/workflows/` (method fixes need `DEVOS_PAT` with Workflows); a scheduled
workflow may start late.

## 4. Runner scripts (`scripts/devos/`)

| Script | Role |
|---|---|
| `lib.mjs` | shared: config, PHASES parsing (`nextOpenTask`, `taskAfter`, method rows), globs, outputs, `.devos/*.env` |
| `next-task.mjs` | which task and attempt; refuses out-of-order product tasks |
| `heavy.mjs` | heavy-run notice or hold (`DEVOS_HEAVY`) |
| `builder-model.mjs` | Grok model id from the fence's Effort/Fast, checked against `agent models` |
| `modules.mjs` | starts every needed module (`supabase.mjs`, `r2.mjs`, `firebase.mjs`); `plannedModules()` |
| `supabase.mjs` · `r2.mjs` · `firebase.mjs` | each module's local service, env file and checks (PR-17, PR-26) |
| `accounts.sh` · `limit-check.mjs` | account order, credential export, limit detection (PR-29) |
| `guard-surfaces.mjs` | who may change what, per role |
| `sync-main.sh` | merges main into the task branch before every push (PR-14); `.gitattributes` merges the append-only journal by union, and any other conflict first pushes the run's work to `rescue/<branch>-<run id>` so it is never lost |
| `agent-watchdog.sh` | runs the Cursor CLI in 72-minute time slices with two checks: a lost connection with no progress for 10 minutes (`devos-stall:`, exit 125) and no activity at all for `builder.idle_stop_minutes` — no change in the tree, no CLI output (the builder runs with `--output-format stream-json`, one line per message and tool call) and no CPU use by the run's processes (`devos-stuck:` naming the last action, exit 126) are restarted once, then parked (stall) or halted (stuck); a slice that ends while files are still changing (exit 124) is committed and the same attempt continues in a fresh run, up to `builder.max_time_slices` (`builder-status.mjs` → `continue`). The agent's environment never holds a GitHub token |
| `builder-report.mjs` | reads the builder's stream-json output and prints its plan (the builder's own to-do list: done, in progress, left), its latest note and a timeline with one line per 10 minutes (files read, searches, commands, edits, the files it edited and the commands it ran); used by `progress.sh` and appended to the PR comment when a run continues, parks or halts |
| `progress.sh` | live builder progress for the owner: one comment per run on the open `devos:notices` issue, edited every 5 minutes (working · quiet · finished · time slice used · stuck), with the minutes, files changed, the builder's last action (from `.devos/builder-last-action`), the `builder-report.mjs` report and a link to the run |
| `supervisor.mjs` · `devos-supervisor.yml` | the supervisor: after every Dev OS workflow, every 30 minutes and on `/devos approve <id>` / `/devos reject <id>` (on the issue labelled `devos:supervisor`), it finds what has stopped (a failed cycle run — from the run's event, and on every scan the latest finished cycle run, because runs dispatched with the built-in token fire no event — a failed `ci` on main — re-run when an outside service such as Google Fonts caused it — or a failed production deploy, which it only reports and never re-runs, a halted or overdue parked task, a rescue branch, nothing running while a task waits), explains it with fixed rules (Claude Opus with the prompt `devos/prompts/supervisor.md`, read-only, only when none fits; at most `supervisor.max_ai_per_day`), fixes what is safe (re-run, resume, continue from the branch, recover a rescue branch, start the next task; at most `supervisor.max_auto_per_key` times per cause, then `devos:needs-you`), and turns the rest into a method-fix issue, a change request, a proposal to approve, or setup steps. One comment per incident on the "Dev OS: supervisor" issue, posted once (a reported key that was not acted on is never reported again; a halt the owner answered with `/devos revise` is skipped) with the built-in token, so its comments start no workflow; skipped or cancelled runs do not wake it (PR-36). Never merges, pushes to main or handles a secret value; off with `DEVOS_SUPERVISOR=off`. `supervisor.mjs classify --run <id>` shows how the rules read a past run |
| `rescue.sh` | the supervisor's recovery of a rescue branch: merges the task branch and main into it (journal by union), pushes it to the task branch without force, deletes the rescue branch; a real conflict stops with nothing pushed |
| `builder-status.mjs` | ok / continue (next time slice, or the next stage of a staged fence) / quota park (usage limit or `devos-stall:`) / halt after the build |
| `run-checks.mjs` | module checks, then guards, typecheck, lint, test, build, e2e → `.devos/ci-results.json` |
| `checks-status.sh` | posts `devos/checks` |
| `vercel-deploy.sh` | git-less prebuilt upload, prints only a real URL |
| `screens.mjs` · `probe.mjs` | motion evidence for the visual check: settled screenshot, filmstrip, reduced-motion screenshot and layout shift in `.devos/screens/motion.json` (PR-35); strict reachability probe |
| `screens.test.mjs` | self-test of that capture (the fence `- Screens:` line, frame pick, filmstrip, layout shift) |
| `review-mode.mjs` | light or deep review, model, effort, turns, critical paths |
| `evidence.mjs` | `.devos/evidence.md`, the reviewer's evidence pack |
| `render-prompt.mjs` | fills `devos/prompts/*.md` |
| `verdict.mjs` | validates the review, applies PR-08 and the gates, records PHASES, picks the action |
| `limits.mjs` | limit patterns, reset parsing, `earliestNotBefore`, run cost |
| `doctor.mjs` | the gate doctor's facts, rules and comment |
| `setup-check.mjs` · `setup-issue.mjs` | settings by name; the setup issue and resumptions (PR-27) |
| `loop.mjs` | the same cycle on your machine, with your logged-in CLIs |

## 5. Guards (`scripts/guards/`, run by `run-all.mjs` as the `guards` check)

`secrets` (no credential or project ref in any file) · `phases` (ledger structure; PM rows risk 3
with a gate) · `naming` · `design` (tokens, no raw colours, logical properties) · `i18n` (identical
catalogues) · `boundary` (no visitor data outside declared zones) · `literals` (no hard-coded contact
or locale) · `data` (migrations, RLS, grants, server-only secret key, synthetic seed, pgTAP) ·
`services` (R2 and Firebase rules) · `manual` (this file names every part of the automation).

## 6. Prompts, schemas, rules

`devos/prompts/`: `builder.md`, `reviewer.md`, `intake.md`, `method.md`, `revise.md`, `doctor.md`, `supervisor.md`.
`devos/schemas/`: verdict, intake (also revise and method), doctor, supervisor.

Other scripts: `scripts/scene/art.mjs` is product code of the Tower (T04): it prints the scene-art prompts, checks generated images (size, ratio, seams, poles, bytes) and verifies the bundled set. `.gitattributes` merges `docs/DEVELOPMENT_JOURNAL.md` by union.

A UI fence carries a header line `- Screens: \`<name> <path>[ click|hover|focus <selector>]\` · …` naming every page, state and interaction to capture. `screens.mjs` reads that line; without it, `devos.config.json` `screens.pages` is used.

| Surface | Files |
|---|---|
| Builder | rules in `.cursor/rules/` (`70-supabase`, `71-r2` and `72-firebase` for the modules) |
| | skills in `.cursor/skills/`: `devos-execute-fence`, `devos-task-report` (the report format, PR-10), `devos-compose-ui` |
| | hooks in `.cursor/hooks.json` and `.cursor/hooks/` (shell policy; guards on stop) |
| | CLI permissions in `.cursor/cli.json` |
| | MCP: `.cursor/mcp.example.json` in the IDE; `devos/ci/mcp.ci.json` in runs |
| Reviewer | rules in `CLAUDE.md`; permissions in `.claude/settings.json` (reviews and fences only) |
| | interactive Claude Code commands in `.claude/commands/`: `/devos-review`, `/devos-new-project`, `/devos-method` |
| | helper agents in `.claude/agents/` (read-only, they report and the reviewer decides): `fence-auditor` (every fence written), `design-inspector` (UI captures), `security-auditor` (deep reviews); skill `.claude/skills/devos-fence-writing` (size rules and staging, PR-38). The reviewer, intake and revise runs may use them (`Task`, `Agent`, `Skill` tools) |
| Issue forms | `.github/ISSUE_TEMPLATE/`: `devos-request.yml` ("Dev OS change request"), `devos-method-fix.yml` ("Dev OS method fix") |

## 7. State the runner keeps

- **Ledger:** `docs/PHASES.md` (Done and Verdict written only by `verdict.mjs`), reviews in
  `docs/reviews/`, fences in `docs/fences/`, reports in `docs/reports/`, requests in `docs/requests/`.
- **Commit statuses:** `devos/verdict` (the review's result), `devos/checks` (the runner's checks),
  `devos/gate` (the doctor: ready for your merge or not).
- **Labels:** `devos`, `risk-1..3`, `devos:auto-merged`, `devos:human-gate`, `devos:halted`,
  `devos:quota-wait`, `devos:setup-wait`, `devos:needs-you`, `devos:method`, `devos:intake`,
  `devos:request`, `devos:setup`, `devos:notices` (issue #1: run notices and the live builder progress
  comments), `devos:supervisor` (the supervisor's issue).
- **Branches:** `task/Tnn` (one per task), `intake/issue-N` (plans), `rescue/task/Tnn-<run id>` (the
  work of a run whose push conflicted; the supervisor recovers it with `rescue.sh`).
- **Comment markers** (HTML comments the runner reads back): `devos-resume` (park and resume),
  `devos-intake-resume`, `devos-held` / `devos-held-done` (PR-20), `devos-doctor`, `devos-setup`,
  `devos-setup-wait`, `devos-setup-missing`, `devos-setup-resumed`, `devos-supervisor` (one per
  incident: key, action, done, AI used, pending proposal), and the builder commit tag
  "(time slice k)" that tells the next run which slice it is.
- **Run scratch** (`.devos/`, never committed, kept as the run's artifact): prompts, agent output,
  `ci-results.json`, `logs/`, `evidence.md`, `screens/` (`motion.json` plus settled, filmstrip and reduced-motion PNGs), `*.env` (module services), `limits/`,
  `accounts.md`, `setup.md`, `setup-result.json`, `progress-issue` / `progress-comment` (the live
  progress comment), `supervisor/` (facts, incidents, Claude's diagnosis).

## 8. Settings

- **Secrets** (names only; the full list with steps is `devos/setup.json`; no workflow ever
  receives them all at once; checks get presence flags, PR-32, PR-33): `CURSOR_API_KEY`(`_2`),
  `CLAUDE_CODE_OAUTH_TOKEN`(`_2`) or `ANTHROPIC_API_KEY`(`_2`), `DEVOS_PAT`, `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SUPABASE_*` + `DEVOS_BACKUP_PASSPHRASE`, `R2_*`, `FIREBASE_*`
  (the storage and Firestore modules are inactive in the Tower; their names stay for the method).
  The Tower has **no** Vercel Protection Bypass for Automation secret (Tower ADR-004).
- **Vercel Production environment** (names only; `devos-setup` checks them through the Vercel API):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (every environment),
  `SUPABASE_SECRET_KEY` (Sensitive), `TOWER_URL` (the production URL, no trailing slash: the OIDC
  audience every reporting project uses as `tower.url` and the host the machine routes accept),
  `GITHUB_WEBHOOK_SECRET` (Sensitive; the GitHub App `devos-control-tower`, needed from T03).
- **Repository variables** (GitHub → Settings → Secrets and variables → Actions → **Variables**).
  A variable that is not set takes its default; changes apply from the next run.

  | Variable | Values (default **bold**) | What it does | More |
  |---|---|---|---|
  | `DEVOS_PAUSED` | true · **false** | true stops every `devos-*` workflow (`ci.yml` still checks main) | §9 |
  | `DEVOS_VERCEL` | true · **unset** | previews per attempt and production deploys on Vercel | SETUP §11.2 |
  | `DEVOS_GITHUB_APP` | true · **unset** | the GitHub App `devos-control-tower` exists and is installed on the pilot and the Tower; T03 reads it as a precondition by name | SETUP §12.5 |
  | `DEVOS_PREVIEW_DB` | true · **unset** | with the database module, previews use their own database | FULLSTACK_MODULE §2 |
  | `DEVOS_SUPABASE` | true · **unset** | deploy step: database backup, then migrations | SETUP §12 |
  | `DEVOS_R2` | true · **unset** | deploy step: storage preflight | SETUP §13 |
  | `DEVOS_FIREBASE` | true · **unset** | deploy step: Firestore rules, then seed | SETUP §13 |
  | `DEVOS_SUPABASE_CLI_VERSION` | a version · **2.120.0** | the Supabase CLI every workflow installs (pinned: "latest" calls a rate-limited GitHub API) | PR-33 |
  | `DEVOS_HEAVY` | **notify** · hold | heavy runs are announced; hold also waits for `/devos go` | SETUP §11.8 |
  | `DEVOS_CURSOR_ACCOUNT` | **1** · 2 | the Cursor account (builder) a run starts with | SETUP §15 |
  | `DEVOS_CLAUDE_ACCOUNT` | **1** · 2 | the Claude account (review, planning, revision) a run starts with | SETUP §15 |
  | `DEVOS_SUPERVISOR` | **on** · off | off stops the supervisor only (the cycle keeps running) | §4 |
  | `DEVOS_ACCOUNT_SWITCH` | **auto** · off | auto: at a usage limit the run continues on the other account; off: only the chosen one (shared by Cursor and Claude) | SETUP §15 |

  Accounts, in practice: nothing set = both accounts on, starting with 1 · only account 2 =
  `DEVOS_CURSOR_ACCOUNT`/`DEVOS_CLAUDE_ACCOUNT` = 2 and `DEVOS_ACCOUNT_SWITCH` = off · for a single
  run, the `cursor_account` / `claude_account` choices in devos-cycle's run form. A second account
  exists only if its `_2` secret is set.
- **`devos.config.json`:** `max_attempts`; `builder` (model family, effort by risk); `reviewer`
  (models and efforts by risk and gate, `modes.light/deep`, `deep_paths`, intake and method efforts);
  `required_checks` / `optional_checks`; `screens` (`pages`, `filmstrip_ms`, `settle_max_ms`; a fence `- Screens:` line overrides `pages`); `surfaces` (builder, builder_method, reviewer, intake,
  revise); `resume` (inline wait, relay, back-off, `stall_wait_minutes`); `modules` (supabase, r2, firebase); `heavy`; `retry_build_on`;
  `builder.max_time_slices` (4) and `builder.idle_stop_minutes` (30) for the watchdog; `supervisor`
  (`model`, `max_auto_per_key`, `max_ai_per_day`, `idle_minutes`, `overdue_park_minutes`, issue title and label).
- **Commands** (owners, members, collaborators only): `/devos intake [resume]`, `/devos revise …`,
  `/devos doctor`, `/devos go`, `/devos setup`, `/devos approve <id>`, `/devos reject <id>` (on the
  supervisor issue). A command works only when the comment **starts** with it; editing a comment
  does not run it.

## 9. When something goes wrong

| Symptom | What the automation does | What you do |
|---|---|---|
| Usage limit (Cursor or Claude) | switches to the other account; if both are out, parks, waits (relayed by `devos-wait`) and resumes after the first reset | nothing; to resume at once, run `devos-resume` by hand |
| Missing secret, variable, Vercel value | the run does not start or the deploy stops; the setup issue lists it with steps | add it; the rest resumes |
| Review finds an outside cause | `setup_wait`: no retry spent; steps in the verdict | add it, comment `/devos setup` |
| A check fails on the code | the reviewer FAILs with a focus; Grok retries up to `max_attempts` | only at halt: `/devos revise` or a change request |
| Review over its turn limit | the verdict is taken from the complete review file (PR-21) | nothing |
| Main moved during a run | merged in before push (the journal by union); a real conflict saves the work on `rescue/…` and the supervisor recovers it; re-checked before any merge (PR-14, PR-25) | nothing |
| The builder runs out of time while still working | the slice is committed and the same attempt continues in a fresh run (up to 4 slices) | nothing; watch issue #1 |
| The builder loses its connection or stops changing anything | restarted once; then parked (connection) or halted (stuck), and the supervisor re-dispatches within its limit | nothing, unless the supervisor asks |
| Any run stops and no rule above covers it | the supervisor asks Claude for a diagnosis and fixes or proposes | approve or reject on the supervisor issue |
| Google Fonts download fails the build | retried three times (PR-24) | nothing |
| Deploy fails (database paused, wrong key) | stops before the app moves, with the reason | fix the setting; a failed deploy re-runs when setup completes |
| The automation itself misbehaves | — | file a "Dev OS method fix" with the run link |
| A run shows "Action required: this workflow file may be malicious" | nothing runs until approved | check the last change to the workflow (usually a step given many secrets); if it is yours, approve once, then fix it with a method fix |
| `ci` or the cycle fails at "Supabase CLI" with "rate limit exceeded" | — (the version is pinned, so this needs a changed or wrong `DEVOS_SUPABASE_CLI_VERSION`) | set the variable to an existing release, or delete it |
| Everything must stop | — | set `DEVOS_PAUSED` = true (every `devos-*` workflow stops) |

## 10. Changing the automation

The normal path is a **method fix issue**, for a problem or an improvement: the reviewer diagnoses
from the logs (or designs the improvement with the recipes below), Grok builds, the reviewer reads
every line, you merge. Every method change, whoever makes it, must:

1. keep every invariant in §1 and fit every precedent, or amend one explicitly;
2. add a precedent row (`PRECEDENTS.md`, next id after the "Live maximum" line);
3. **update this manual** where the change lands (`guard:manual` checks the names);
4. prove itself: `node --check` on changed scripts, `node scripts/guards/run-all.mjs`, every changed
   workflow parsed as YAML, and a reproduction of what it fixes or adds.

Recipes:
- **A new stack module:** a script beside `r2.mjs` (isActive, start, cliPresent, env file); a
  `modules.<name>` entry in the config (detect, fence_hint, required_checks, env names); its checks in
  `run-checks.mjs`; its section in `evidence.mjs`; rules in `guard:services` or a new guard; a deploy
  step after the database and before the app; its settings in `devos/setup.json`; a builder rule
  `.cursor/rules/7x-<name>.mdc`; a section in `FULLSTACK_MODULE.md`; intake guidance.
- **A new check:** a package script plus its name in `required_checks` (product) or in a module
  (method). Red overrides PASS automatically.
- **A new guard:** `scripts/guards/<name>.mjs` returning `result(...)`, registered in `run-all.mjs`,
  listed in §5.
- **A new setting:** an item in `devos/setup.json` (method) or `docs/setup-items.json` (product).
- **A new workflow or label:** listed in §3 or §7; anything a bot push should trigger must be
  dispatched explicitly.

## 11. A finished project, and the next one

**The end of a project.** After the last gate merge, `devos-advance` dispatches the cycle. `resolve`
reports "every task in docs/PHASES.md is ticked" and the cycle stops. Nothing else runs until new
rows exist: `devos-deploy` has already shipped that merge, and `devos-resume` finds nothing parked.

Close-out is the human's commit:

- `docs/SESSION_CONTEXT.md` records the last verdict and the finished state. Normally the next
  task's first step records a verdict, and there is none.
- Open carry-forwards stay listed with their owners.

**More work later.** File a "Dev OS change request". Its intake PR adds the rows, and your merge
starts the cycle again.

**The next project.** Run `/devos-new-project` in a new private repository, after copying these
method files from this one:

- `scripts/devos/` and `scripts/guards/`
- `devos/`
- `.github/workflows/` and `.github/ISSUE_TEMPLATE/`
- `.cursor/`
- `.claude/commands/`
- `devos.config.json`
- from `docs/method/`: the handbook, `FULLSTACK_MODULE.md`, this manual, and `PRECEDENTS.md`

Keep the precedent rows: they are the rules the scripts implement and this manual cites. The new
project rewrites PR-01 for its environment, and its own rulings continue from the live maximum.
`guard:manual` fails the new repository if this manual is missing.

Copy `.claude/settings.json` last, once the bootstrap is written: it locks the reviewer to reviews
and fences. `SETUP.md` §10 and `README.md` give the same steps.
