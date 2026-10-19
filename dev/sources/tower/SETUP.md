# SETUP — link Cursor, Claude Code and GitHub, then start the cycle

About 30–40 minutes the first time. Commands are shown for **Windows PowerShell** (your machine) and
for macOS/Linux where they differ. Nothing in this repository holds a secret; every key goes into
GitHub Actions secrets or the Vercel Production environment. The complete list of names, with steps,
is `devos/setup.json`; the "Dev OS: setup needed" issue tracks their presence by name (§14). The B0
bootstrap runbook (`devos-plan` → `plan/tower-bootstrap/B0-BOOTSTRAP.md` §3.5) lists the same items.

---

## 0. What you need

| Account / tool | Why | Notes |
|---|---|---|
| GitHub (`Jovo-Jovi`) + `gh` CLI | this repository, Actions, PRs, the GitHub App | `winget install GitHub.cli`, then `gh auth login` |
| Cursor **Pro or higher** | builder: Grok 4.7 via the Cursor CLI | the India-only *Start* plan fixes Grok at medium effort |
| Claude **Pro / Max** (or a Console API key) | reviewer: Claude Code | subscription → `claude setup-token`; API → Console key |
| Node 22 + pnpm 10 + git | local checks, optional local loop | `npm i -g pnpm@10` |
| Supabase (organisation `TOWER-DEV_OS`) · Vercel | the Tower's Postgres and Auth · hosting | §12 · §11.2 |

---

## 1. The repository (your bootstrap push signs OD-01…OD-06)

`Jovo-Jovi/devos-control-tower` was created at B0 and its first commit written by hand from the
runbook: the method files from `devos-pilot` @ `4ccbef7`, the Tower's documents from `devos-plan`
@ `1a3c2a9`. Your push of that commit to `main` is the confirming act for OD-01…OD-06
(`docs/DECISIONS.md`): after the push, changes are new ODs.

```powershell
git push -u origin main
```

---

## 2. Cursor (the builder)

1. **Install the Cursor CLI** (the binary is `agent`):
   ```powershell
   irm 'https://cursor.com/install?win32=true' | iex
   ```
   macOS/Linux/WSL: `curl https://cursor.com/install -fsS | bash`
2. **Log in and confirm the model id:**
   ```powershell
   agent login
   agent models
   ```
   Look for Grok 4.7. `agent models` lists it with the effort in the id: use **`grok-4.7-high`**
   in `devos.config.json` → `builder.model` (the CLI has no separate effort flag).
3. **Create a Cursor API key** for CI in the Cursor dashboard (cursor.com → Dashboard → Integrations →
   API Keys → new key named `devos-tower`). Copy it for step 4.
4. **Open the folder in the Cursor IDE** (for manual work and watching):
   - Trust the workspace when asked, so `.cursor/hooks.json` runs.
   - Rules load from `.cursor/rules/` and skills from `.cursor/skills/` automatically.
   - MCP: either copy `.cursor/mcp.example.json` to `.cursor/mcp.json` (it is gitignored), **or**
     install the two marketplace plugins **Context7** and **Playwright** from
     Customize → Marketplace → Install → *project* scope. Install nothing else: the Tower is Profile A
     with the Boundary gate holding everywhere (OD-01), so PostHog and Sentry would breach it, and
     marketplace automations act without a fence.
   - In the model picker choose **Grok 4.7**, effort **High**.
   - Check: `agent mcp list` shows `context7`.

---

## 3. Claude Code (the reviewer)

1. **Install and log in:**
   ```powershell
   npm install -g @anthropic-ai/claude-code
   claude            # first run opens the browser login; then /exit
   ```
2. **Make a CI credential** (pick one):
   - Subscription: `claude setup-token` → approve in the browser → copy the printed token
     (valid one year). This becomes `CLAUDE_CODE_OAUTH_TOKEN`.
   - API billing: create a key at platform.claude.com. This becomes `ANTHROPIC_API_KEY`.
3. **Optional, recommended:** inside `claude` in this repo run `/install-github-app`. The cycle does
   not need it, but it lets you write `@claude …` on any PR to ask the reviewer questions.

---

## 4. GitHub settings

```powershell
gh secret set CURSOR_API_KEY --repo Jovo-Jovi/devos-control-tower
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo Jovo-Jovi/devos-control-tower   # or: gh secret set ANTHROPIC_API_KEY ...
gh variable set DEVOS_PAUSED --body false --repo Jovo-Jovi/devos-control-tower
```
(each `secret set` prompts for the value, so it never lands in your shell history)

Then in **Settings → Actions → General → Workflow permissions** (set at B0; check it is still so):

- select **Read and write permissions**, and
- tick **Allow GitHub Actions to create and approve pull requests** (the runner opens the PRs).

**Branch protection on `main`:** required status checks `devos/checks` and `devos/verdict`, no
required approvals (the runner merges risk-1/2 PASSes itself; every Tower M1 task is risk 2–3 and
stops for you anyway). Leave yourself able to bypass so you can push method patches. See §11.6.
`DEVOS_PAT` (a fine-grained token for **this repository only**) is needed only when a method fix
changes a workflow file (§14.2); it is never the pilot's token (OD-03 §4).

---

## 5. Optional local checks before the first run

```powershell
node scripts/guards/run-all.mjs        # secrets, phases, naming, manual PASS; src-based guards N/A until T01
node scripts/devos/next-task.mjs       # task=T01, builder_model=grok-4.7-high, reviewer_model=claude-opus-5-5
node scripts/devos/setup-check.mjs     # names only: what the cycle and the deploy still lack
```

Local loop instead of Actions (macOS, Linux or WSL; it uses your logged-in `agent` and `claude`):
`node scripts/devos/loop.mjs --task T01` (add `--push` to push branches and main). For the Tower a
local result never counts as a PASS (OD-03 §2): every M1 task runs through `devos-cycle` on GitHub.

---

## 6. Start the cycle

GitHub → **Actions → devos-cycle → Run workflow** (leave both inputs blank), or:

```powershell
gh workflow run devos-cycle.yml --repo Jovo-Jovi/devos-control-tower
```

What you will see (`docs/PHASES.md`; the plan is milestone M1 of `devos-plan`):

| Step | Task | What happens | Your action |
|---|---|---|---|
| 1 | T01 Skeleton, Supabase module, owner-only GitHub sign-in (risk 3, G-Tower-Auth) | Opus 5.5 deep review → PR labelled `devos:human-gate` | insert the one `owner_allowlist` row in the SQL editor after the migration; review the sign-in screenshots (1280/390, three states), the Advisors screenshot and the forged-metadata proof; **merge** |
| 2 | T02 Schema + OIDC-verified ingestion (risk 3, G-Tower-Ingest) | deep review → PR waits | read `docs/reviews/T02-a1.md`, then **merge** |
| — | pilot PM01 (method fix in `devos-pilot`) and the **CK1** checkpoint | you register the pilot by one SQL insert, merge PM01, run one pilot cycle | SQL proofs into `docs/DEVELOPMENT_JOURNAL.md`; fail → stop, no T03 |
| 3 | T03 GitHub App webhook receiver (risk 3, G-Tower-Observe) | deep review → PR waits | **merge** |
| 4 | T04 · T05 · T06 · T07 pages (risk 2; T05 stops at G-Design-v3 for your look) | light or deep review by the diff; design judged by hand at 1280/390 | merge each when `devos/gate` is green |
| 5 | T10 Pilot history replay (G-Tower-v1), after the T09 sign-in retrofit | PR waits | check 25/25 on the project page, then **merge** |

Every merge you make triggers `devos-advance`, which dispatches the next task. On a FAIL the runner
dispatches the reissued fence (attempt 2, then 3) on the same branch.

---

## 7. Watching and stepping in

- **Labels:** `devos:human-gate` (your turn), `devos:halted` (needs a decision), `devos:quota-wait`
  (parked on a usage limit; resumes by itself), `devos:auto-merged`.
- **Each PR comment** holds the verdict summary; the full verdict is `docs/reviews/Tnn-aN.md`; the
  run's artifact `devos-Tnn-aN` holds the prompts, agent outputs and check logs.
- **Pause everything:** `gh variable set DEVOS_PAUSED --body true`. Resume with `false`, then run
  the workflow.
- **After a halt:** read the comment, fix the cause (or edit the fence yourself on the branch), then
  run the workflow with `task=Tnn` and `attempt=1`. It continues on the same branch.
- **Reviewer or infrastructure failure** (no verdict file, auth error, refused tool calls): run the
  workflow with `task=Tnn`, the same `attempt`, and **`review_only` ticked**. Only Claude runs again;
  the builder's commit is kept (PR-11).
- **Plan or rate limits (PR-12):** if Cursor or Claude runs out of usage, the PR gets
  `devos:quota-wait`, nothing is marked failed, and the hourly **devos-resume** workflow retries
  the same task and attempt (review-only when only Claude was blocked) until it goes through. To
  stop the retries, remove the label; to retry immediately, run devos-resume by hand.
- **"1 workflow awaiting approval" on a runner PR:** that is the plain `ci` workflow. GitHub holds
  runs on PRs opened by the Actions bot until someone approves them. Approving only runs the checks
  again; the cycle already ran them, so you can approve or ignore it.
- **Manual mode for any task** (the classic Dev OS loop): in the Cursor IDE, check out `task/Tnn`
  and send *"Read docs/SESSION_CONTEXT.md and docs/method/PRECEDENTS.md, then execute
  docs/fences/Tnn.md."* Then run `claude` in the repo and use `/devos-review Tnn`.

## 8. Where the Claude app fits

The cycle runs on **Claude Code** because it can be scripted (`claude -p`) in GitHub Actions; a
chat in the Claude app cannot be triggered by a workflow. Use the Claude app alongside it for
what needs you: discuss a halted verdict, draft a new OD, or plan the next project. With GitHub
connected, it can read the PRs and verdict files directly.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `agent: command not found` in Actions | the install path changed; check the install step's output and add that directory to `$GITHUB_PATH` |
| builder fails with an unknown model | run `agent models` and set `builder.model` in `devos.config.json` |
| reviewer exits at once with an auth error | the secret is missing or expired; regenerate with `claude setup-token` |
| "GitHub Actions is not permitted to create or approve pull requests" | step 4, the checkbox |
| merge refused | branch protection requires approvals; turn approvals off (§11.6) or use `DEVOS_PAT` with bypass |
| `guard:surfaces(builder): FAIL` | the builder touched a method file; the run halts by design. Read the list, revert, re-run |
| a reviewer PASS shows as FAIL | PR-08: a required check was red. See the run's `ci-results.json` |

## 10. How this repository was bootstrapped, and the next project

This repository did **not** run `/devos-new-project`. Its job — brief → documents → fence T01 — was done
by the planner in `devos-plan` and placed here by the B0 runbook (`plan/tower-bootstrap/B0-BOOTSTRAP.md`):

- the method, unchanged, from `devos-pilot` @ `4ccbef7` (`docs/method/AUTOMATION.md` §11 list);
- `docs/*.md`, `devos/setup.json`, `docs/contract/EVENT_CONTRACT.md`, `docs/adr/ADR-001…004`,
  `docs/fences/T01.md` from `devos-plan` @ `1a3c2a9`;
- the configuration edits of runbook §3.4 only: `project: "TOWER"` and two `deep_paths` in
  `devos.config.json`; one catalogue in `scripts/guards/i18n.mjs`; three GitHub hosts allow-listed in
  `scripts/guards/design.mjs`; PR-01 rewritten and PR-34 added; this file and `README.md`.

Later fences (`T02`…`T07`) are copied from `plan/fences/M1/` of `devos-plan` into `docs/fences/` as each
previous task's gate merges; the reviewer may reissue one with a version bump. Plan labels map to task
ids in `plan/ID-MAP.md` there.

**The next project** copies the method from here exactly as the pilot's §11 says, then runs
`/devos-new-project <brief>` in the new private repository (copy `.claude/commands/devos-new-project.md`
to `~/.claude/commands/` first). It rewrites PR-01 for its own environment and continues its rulings
from PR-34.

---

## 11. Automation (OD-03, OD-04)

### 11.1 Builder effort and Fast mode, chosen per task
Claude writes the choice into each fence header: `- Builder: grok-4.7 · Effort: high · Fast: no`.
The runner turns it into a Cursor model id and checks it against `agent models`. To see the ids
Cursor offers, run `agent models` once and confirm the effort variants look like `grok-4.7-low`,
`grok-4.7-medium`, `grok-4.7-high`, `grok-4.7-xhigh` (and their Fast variants). If an id is not
listed, the run falls back to `builder.model` and says so on the PR. To override one run by hand:
Actions → devos-cycle → Run workflow → **effort** / **fast**.

### 11.2 Vercel (project `devos-control-tower`)
1. The project exists from B0: team `jiovanny's projects`, framework Next.js, function region **`fra1`**
   (beside Supabase `eu-central-1`), **no** Git integration — Git deploys are off (`vercel.json`,
   `git.deploymentEnabled: false`, from T01) and every deploy goes through the runner with
   `VERCEL_TOKEN`, as in the pilot. Settings → Deployment Protection = **Standard** (verified by name in
   T01's review). Do **not** create a "Protection Bypass for Automation" secret: the Tower has none
   (Tower ADR-004); previews stay behind the Vercel login and the review uses the local build.
2. Create a token at vercel.com → Account Settings → Tokens, named `devos-tower`, scope: the team.
3. Secrets and the switch (the two ids are public values, the token is not):
   ```powershell
   gh secret set VERCEL_TOKEN --repo Jovo-Jovi/devos-control-tower
   gh secret set VERCEL_ORG_ID --repo Jovo-Jovi/devos-control-tower
   gh secret set VERCEL_PROJECT_ID --repo Jovo-Jovi/devos-control-tower
   gh variable set DEVOS_VERCEL --body true --repo Jovo-Jovi/devos-control-tower
   ```
4. Vercel → project → Settings → Environment Variables, **Production**: `TOWER_URL` =
   `https://<the production hostname>` with no trailing slash. It is the OIDC audience every reporting
   project uses as `tower.url` (pilot ADR-005) and the host the machine routes accept (Tower ADR-004).
   A custom domain later = a new audience: change it here and in every project's `tower.url` together.
5. Production: run Actions → **devos-deploy** once by hand after T01 merges. After that, every push to
   `main` that you make (gate merges included) deploys production; the runner's own auto-merges do not.

### 11.3 Change requests and revisions
- **New work:** GitHub → Issues → New issue → **Dev OS change request**. The reviewer replies on the
  issue: an intake PR to approve, questions (answer, then comment `/devos intake`), or a refusal with
  the reason. **Merging the intake PR signs its OD and starts the new tasks.**
- **Change a task in flight:** on its open PR, comment `/devos revise <what to change>`. Claude
  rewrites that task's fence and Cursor rebuilds it as the next attempt. Use this at a human gate
  instead of merging work you don't like.
- **Method fixes** (plan labels TM01, TM02…): New issue → **Dev OS method fix** (§14.2). The Tower's own
  reporting (TM01) is filed this way after PM02 merges in the pilot.

### 11.4 Usage limits
When Cursor or Claude hits a limit, the PR gets `devos:quota-wait` and the comment shows the reset
time. If the reset is within about 5½ hours, the same run waits and resumes the task by itself — no
schedule involved. Longer waits are picked up by `devos-resume` (every 2 hours, best effort) or by
running it by hand; `devos-wait` relays them only on a public repository (`resume.relay: "public"`,
PR-31). Removing the label cancels the wait. The waiting job uses Actions minutes while it sleeps (up
to ~330 per wait).

### 11.5 The design direction
`docs/DESIGN_SYSTEM.md` as committed at B0 is the approved **direction** (OD-06): idea, tokens, type,
components, compositions, quality floor. Each UI task's fence (T04–T07) carries a Design specification
that refines it; every page and state is checked against screenshots at 1280 and 390, by you and the
reviewer by hand in M1 (M3 makes the gate mechanical).

### 11.6 Protect `main` with the verdict (PR-13)
Settings → Rules → Rulesets (or a classic branch rule) for `main`: **Require status checks to pass**,
add `devos/checks` and `devos/verdict` (they appear after the first run that reports them). Leave
"Require approvals" off, and leave yourself able to bypass so you can still push method patches. After
this, GitHub will not let a task PR merge until Claude's verdict is PASS. Branch protection is free on a
public repository; on a private one it needs GitHub Pro — without it, merge only when `devos/checks`,
`devos/verdict` and `devos/gate` are green.

### 11.7 Before you merge: the gate doctor (PR-15)

You do not need to diagnose a red check yourself. On every task PR the **Dev OS gate doctor**
comment says what is wrong, whether it is the code or the environment, and who acts. Merge when the
commit status **`devos/gate`** is green. Comment `/devos doctor` to check again at any time.

| You see | What it means | What happens / what you do |
|---|---|---|
| ❌ ci checks, "environment (google-fonts / network / browser)" | The runner failed to download something; the code passed the cycle's own checks | Automatic: one re-run. If it fails again, merge on the verdict and file the prefilled change request the comment links |
| ❌ ci checks, "waiting for your approval" | GitHub holds `ci` on bot-opened PRs | Press **Approve and run** on the run; the doctor reports again when it finishes |
| ❌ ci checks, any other failure | Probably the task's code | Read Claude's second opinion in the comment, then paste its `/devos revise …` line as a comment, or press **Re-run failed jobs** if it calls it flaky |
| ⚠️ Vercel preview "Blocked" | Hobby teams only deploy commits authored by the owner | Handled by the upload script (PR-15, PR-16). Does not block the merge |
| ⚠️ Vercel preview "behind the Vercel login" | Deployment Protection is on — by design in the Tower (ADR-004) | Nothing; screenshots come from the local build. Never add a bypass secret |
| ❌ Review verdict "no verdict on …" | Commits landed after the review | Actions → devos-cycle → Run workflow: the task, the last attempt, **review_only** ticked |
| ❌ Branch vs main "conflicts" | main changed under the task | **Resolve conflicts** on the PR, then `/devos doctor` |
| ⏳ anything | The runner is handling it (a re-run, a usage-limit wait) | Nothing; the comment updates itself |

The label `devos:needs-you` marks PRs where only you can act; filter the PR list by it.

### 11.8 Heavy runs and your plans (PR-20)
Some runs use much more of your Claude and Cursor plans than others: planning a change request, and
any task reviewed by Opus or at extra-high effort (risk 3 and gate tasks), or built at extra-high. In
the Tower's M1 that is T01, T02 and T03 at least.
- **Subscribe** to the issue **"Dev OS: run notices"** (the runner opens it the first time). It
  comments there before each heavy run and when a phase starts, with the heavy tasks still ahead.
- To decide yourself when heavy work starts, set the repository variable `DEVOS_HEAVY` to `hold`.
  A heavy task then waits until you comment `/devos go` in that issue. Unset (or `notify`), it only
  announces. Retries and resumes of a task you already let start never wait.
- A usage limit never loses work: a task parks and resumes by itself (PR-12); a planning run keeps
  its partial plan and resumes by itself too. `/devos intake resume` continues one by hand.
- Mark small change requests "Small change" in the form: they are planned at high effort instead of
  extra-high, which costs noticeably less.
- Every verdict and plan comment ends with what the run cost (minutes, turns, tokens), so you can
  see which kinds of task are expensive.

### 11.9 Light and deep reviews (PR-22)
Grok builds and proves; Claude judges. After each build the runner writes an evidence pack and
picks the review depth: **light** (Sonnet, medium effort) for ordinary risk 1–2 work, **deep**
(Opus, high effort) for risk 3, gates, and any change to migrations, auth, headers, dependencies,
workflows, the contract code or the API routes (`reviewer.deep_paths` in `devos.config.json`, which
for the Tower adds `src/lib/contract/**` and `src/app/api/**`). The PR's verdict comment says which it
was and what it cost. To make the reviewer stricter or lighter, change `reviewer.modes` or
`reviewer.deep_paths` there.

## 12. Backend module: Supabase (PR-17 to PR-19)

The method side is in the repository; the product side (`supabase/config.toml`, the first migration,
pgTAP) arrives with T01. The order is: the hosted project and its secrets first (done at B0), then the
cycle.

### 12.1 The organisation and the project
1. supabase.com/dashboard → organisation **`TOWER-DEV_OS`** (the M0 capacity choice: a second, separate
   organisation so the Tower never shares a plan or a pause with the pilot; recorded in
   `docs/DEVELOPMENT_JOURNAL.md`).
2. In it, project **`devos-control-tower`**, region **`eu-central-1`** (Central EU, Frankfurt — beside
   Vercel's `fra1`). Reset the database password once from Project Settings → Database and keep it in
   your password manager; it is `SUPABASE_DB_PASSWORD`.
3. Project Settings → General: the **Reference ID** is `SUPABASE_PROJECT_REF`. Project Settings → API
   keys: the **publishable** key goes to Vercel for every environment, the **secret** key to Vercel
   Production only (never into a file).
4. Account → **Access Tokens** → generate one named `devos-tower deploy` → `SUPABASE_ACCESS_TOKEN`.

### 12.2 GitHub secrets and variables
```powershell
gh secret set SUPABASE_ACCESS_TOKEN --repo Jovo-Jovi/devos-control-tower
gh secret set SUPABASE_PROJECT_REF --repo Jovo-Jovi/devos-control-tower
gh secret set SUPABASE_DB_PASSWORD --repo Jovo-Jovi/devos-control-tower
gh secret set DEVOS_BACKUP_PASSPHRASE --repo Jovo-Jovi/devos-control-tower
gh variable set DEVOS_SUPABASE --body true --repo Jovo-Jovi/devos-control-tower
```
`DEVOS_BACKUP_PASSPHRASE` is a long random passphrase. Keep a copy offline: without it the encrypted
backups cannot be opened.

### 12.3 Vercel environment
Vercel → project → Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for **every** environment; `SUPABASE_SECRET_KEY` for
**Production only**, marked **Sensitive** (service role; read only by `src/lib/supabase/server/admin.ts`,
guard:data rule 6):
```powershell
vercel env add SUPABASE_SECRET_KEY production --sensitive
```
Previews are off while the module is active; the review uses the local build against the CI database
instead (PR-18).

### 12.4 Auth settings in the hosted project (owner-only sign-in, OD-02)
Authentication → Sign In / Providers: **GitHub ON** with the client id and secret of the GitHub OAuth
App `devos-control-tower-auth` (its callback is `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`);
**every other provider OFF, Email OFF**. URL Configuration: Site URL = `TOWER_URL`; redirect URLs =
`TOWER_URL/**`. The owner allow-list is one row in `public.owner_allowlist`, inserted by you in the SQL
editor once T01's migration is applied (`docs/DATA_MODEL.md`, ADR-002); it is in no file or setting.

### 12.5 The GitHub App `devos-control-tower` (observed facts, from T03)
GitHub → Settings → Developer settings → GitHub Apps → New, per Tower ADR-003: name
`devos-control-tower`; Homepage = `TOWER_URL`; Webhook URL `<TOWER_URL>/api/github/webhook` with a
generated secret (webhook **Active** only once T03 has merged); repository permissions **read**:
Actions, Checks, Commit statuses, Pull requests, Metadata; events `workflow_run`, `check_run`, `status`,
`pull_request`, `installation`, `installation_repositories`; "Only on this account". Install it on
**`devos-pilot` and `devos-control-tower` only**. Then:
```powershell
vercel env add GITHUB_WEBHOOK_SECRET production --sensitive
gh variable set DEVOS_GITHUB_APP --body true --repo Jovo-Jovi/devos-control-tower
```
The App ID is recorded in `docs/DEVELOPMENT_JOURNAL.md` (not a secret).

### 12.6 Things to know
- Free projects pause after a week without activity; a production deploy then fails at
  `supabase link` and says so. Restore the project in the dashboard and re-run `devos-deploy`.
  **The pilot's own Supabase project is paused:** restore it (free plan: within 90 days) or set the
  pilot's repository variable `DEVOS_SUPABASE=false` before PM01 merges, or the pilot deploy fails.
- Each cycle run starts a local Supabase in Docker, adding a few minutes.
- Supabase Advisors (Security) must report no errors and no warnings after T01's migration; the
  screenshot is part of T01's review.
- To try the stack yourself: install the Supabase CLI and Docker, `supabase start`, `supabase db reset`.

## 13. Storage (Cloudflare R2) and Firestore modules (PR-26)

**Inactive in the Tower** (Tower ADR-001 rejects Firestore; the Tower stores no files). The method keeps
both modules: they activate only when their detect files exist (`src/lib/r2/`, `firebase.json`), and
`devos/setup.json` lists none of their settings on purpose. Should a signed OD ever add one, the pilot's
`SETUP.md` §13 at `4ccbef7` and `docs/method/FULLSTACK_MODULE.md` describe the steps: a dedicated
account, a bucket or a Firestore database in Frankfurt, read-only runtime keys in Vercel (Sensitive),
deploy keys in GitHub, and the variables `DEVOS_R2` / `DEVOS_FIREBASE` = `true`. `devos-deploy` then
runs, in order: guards → storage preflight → database backup and migrations → Firestore rules → seed
→ app → smoke test.

## 14. Missing settings and method fixes (PR-27, PR-28)

### 14.1 The setup issue
You never have to guess what is missing. The workflow `devos-setup` checks, by name only, every
secret, variable and Vercel Production variable the project needs (`devos/setup.json`, plus
`docs/setup-items.json` for product-specific ones that intake adds), and keeps one issue,
**"Dev OS: setup needed"**, with the exact steps for each missing one. GitHub emails you when it is
opened or gets a comment about a new need.

- **Who fixes what.** Inside the repository (a script, a config file, an environment name in the
  code): Grok, through a failed review and a retry. Outside it (a key, a variable, a token
  permission, an account or a dashboard setting): you, with the steps in the issue.
- **Nothing is lost while you add them.** A cycle that cannot run does not start; a deploy that lacks a
  setting stops before anything moves; a review that finds only an outside cause stops without
  spending an attempt (label `devos:setup-wait`).
- **It resumes by itself.** After you add what is listed, within two hours (or at once if you
  comment `/devos setup` on the issue) the runner closes the issue, restarts every waiting run and
  re-runs a production deploy that failed. A cause the runner cannot see by name (a token's
  permission, a dashboard setting) waits for your `/devos setup`.

### 14.2 Method fixes: when the automation itself misbehaves
Open **New issue → Dev OS method fix**, say what you saw, and paste the links of the runs or PRs.
1. The runner fetches those runs' logs; the reviewer (Opus) finds the root cause to the line and
   opens a PR with the diagnosis and one method task (Phase `PM`). If the cause is a setting, it says
   so instead; if it is the product's code, it tells you to use a change request or `/devos revise`.
2. You merge that PR: the fix starts at once, before any product task.
3. Grok changes only the method files the task names and proves the fix with a reproduction; the
   reviewer reads every changed line. The workflow from main forces this deep review and your gate,
   whatever the branch changed.
4. You merge the fix: the task it unblocked restarts by itself.

**One-time requirement:** a fix that changes a workflow file must be pushed with `DEVOS_PAT`, a
**new** fine-grained token for this repository only — never the pilot's — with Read and write on
Contents, Pull requests and **Workflows**, expiry ≤ 90 days (pilot ADR-006 conditions, OD-03 §4).
The setup issue asks for it as soon as a method fix is planned (TM01 at the earliest).


## 15. Two accounts per agent (PR-29)

Optional. Add a second Cursor account and/or a second Claude account, and a run that hits a usage
limit carries on with the other one instead of waiting for the reset.

| What | GitHub secret (Settings → Secrets and variables → Actions) |
|---|---|
| Cursor, account 1 / 2 | `CURSOR_API_KEY` / `CURSOR_API_KEY_2` |
| Claude, account 1 / 2 | `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN_2` (`claude setup-token` while signed in to each account), or `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_2` |

**Choosing.** Repository variables (Settings → Secrets and variables → Actions → Variables):
- `DEVOS_CURSOR_ACCOUNT` = `1` or `2`: the Cursor account every run starts with (default `1`).
- `DEVOS_CLAUDE_ACCOUNT` = `1` or `2`: the same for every Claude run (reviews, planning, revisions).
- `DEVOS_ACCOUNT_SWITCH` = `off` to stay on the chosen account and wait at its limit; `auto` (default)
  switches.
- For a single run: Actions → devos-cycle → Run workflow → `cursor_account` / `claude_account`.

**What happens on a limit.** The builder continues the same attempt on the other account from the
partial work already in the tree; the planner continues its partial plan; a review starts again on
the other account. The PR comment says which account ran and when one ran out. Only when both are out
does the run park, and it resumes when the first of the two resets.

**Before you use it:** use accounts that are yours to use this way. Providers' terms differ on several
personal accounts used by one person; a plan for a team, or a pay-as-you-go API key as the second
account (`ANTHROPIC_API_KEY_2`), avoids the question.

## 16. Working without outside help (PR-30)

Everything the automation does is described in the repository itself, so a fresh Claude session (in
GitHub Actions or on your computer) can work on it without this conversation's history:

- **`docs/method/AUTOMATION.md`**, the operating manual: roles and invariants, every flow, workflow,
  runner script, guard, prompt, label, status, marker and setting, what happens when something
  fails, and how to change the automation safely. `guard:manual` fails any change that leaves it
  behind, so it stays complete.
- **`docs/HOW_TO_USE_DEVOS_AND_WORKFLOWS.md`**, the owner's guide in plain words, sorted by topic
  with an A–Z index: daily routine, requests, gates, progress, the supervisor, commands, settings,
  limits, deploys, what to do when something goes wrong, and every workflow and script.
- **`CLAUDE.md`** and **`docs/method/PRECEDENTS.md`**: the binding rules.
- **When the automation misbehaves:** open a "Dev OS method fix" issue with the run link (the
  reviewer diagnoses, Grok fixes, you merge), or run `claude` in the repository on your computer and
  type `/devos-method <what went wrong>`: it reads the manual and the logs, explains the cause, and
  opens the method-fix issue for you.
- **When a setting is missing:** the "Dev OS: setup needed" issue lists it with steps.
