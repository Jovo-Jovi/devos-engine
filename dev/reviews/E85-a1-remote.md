MERGE

VERDICT: PASS
Fetched: HEAD @ c5ad079 (`E85: build attempt 1`) + working tree clean · Commands run: D1 (the full suite with no git
identity, here, on Linux), D2–D6 and D9 on Linux, D7 through `gh run view`, the release check, and the scope and
reviewer-path diffs · Refused calls: none

Attempt 1 is fence v2's 41 exact files, copied byte for byte, the two deletions, and the builder's report. It is
version 1.13.16, a method change with precedent PR-101 and decision D-E18, and a deep review (risk 3). The cycle now
runs `resolve` → `work` → `review` → `publish`:
- `review` (`devos-review.yml`) holds a token that only reads and the reviewer tools' keys. It verifies the bundle
  with main's code, installs the reviewer's CLI at its pin (`install-agent.sh`), and runs the reviewer agent with its
  shell through `plan-agent.sh reviewer`;
- `publish` runs no AI. It takes the review job's artifact as data, checks the reviewed head, and decides as before;
- the planner jobs run the reviewer's tool, and every agent run leaves one output contract (`agent-result.mjs`).

The reviewer wrote these files. So the review of record is four things: the byte compare (D3), every Done-when row
that runs here, the engine's CI, and a second reading of every changed line under `payload/`, `tools/` and
`.github/`, checked against the security boundary of the fence's point 2 and the method's non-waivable rules. The
builder changed nothing under `dev/fences/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet c864b20 c5ad079` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite with no git identity** (`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`, Node 22.23.5,
  Linux): `# tests 708`, `# pass 708`, `# fail 0`, `# skipped 0`, exit 0. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run** (Node 24.21.0): tests 708, pass 660, fail 0, skipped 48, as the fence says.
Ledger: D2 — PASS — `manifest up to date (363 files)`; `node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `41 files, 0 differ; deleted: 2 of 2`.
Ledger: D4 — PASS — the staged guards: `guard:secrets PASS (370 files scanned)`, `guard:manual PASS (138 names
checked)`, `guard:config PASS (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`,
`guard:media N/A (no devos/answers.json)`, `exit 0`.
Ledger: D5 — PASS — `devos 1.13.16`.
Ledger: D6 — PASS — actionlint 1.7.7 (built from source here; `-color -shellcheck= -pyflakes=`) on the thirteen payload
workflows and `engine-ci.yml` exited 0 and printed nothing, here and on the builder's Windows.
Ledger: D7 — PASS — `engine-ci` run 45609151612 on `c5ad079`, attempt 1: `checks` success, `test (ubuntu-latest)`
success.
Ledger: D8 — NOT RUN — moved after the release by the owner's instruction (2026-11-25, 13:59): "i cannot upgrade any
repo to test d8 because the task should be released on main branch" (`devos upgrade` runs between released engines,
`lib/upgrade.mjs`). This contradicts the fence, which puts D8 before MERGE. The owner's word is above the fence, so
it wins. The fault is the fence's own: it asked for an upgrade "from the engine at `task/E85`", which the engine does
not offer. D8 is now the first run of 1.13.16: learn-coptic, upgraded from the released engine, with its reviewer on
Cursor. The reviewer reads it with `gh` against the four points of the fence before E86 is fenced.
Ledger: D9 — PASS — `git diff --name-only main...HEAD` lists 89 paths with this file:
- the 41 of S1 and the 2 of S2;
- `dev/reports/E85.md`;
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E85.md`, the 42 files of `dev/fences/E85/` (41 and
  `before.json`), and this review.
Nothing else. The builder's commit holds exactly 44 paths: the 43 of S1–S2 and the report.

Scope: in fence. The release check prints only `CHANGELOG.md: the 1.13.16 heading has no date; set it when you tag`,
as the fence expected.

Security boundary (point 2, read line by line):
- **The review job's privileges.** `permissions: contents: read` at the workflow, at the job, and in the caller's
  `review:` job. There is no `id-token`, no `: write` and no PAT, `OWNER_TOKEN`, Vercel, Supabase or Firebase secret.
  GitHub hands it only `KEY_1/2`, `ALT_1/2`, `LKEY_1/2` and `LALT_1/2`, and the caller's mapping picks each one by the
  tool `resolve` named, with main's code. Its checkout has `persist-credentials: false`. The read token reaches git
  only as an environment header (`publish-verify.mjs`), never in a file. No step calls `gh` or `git push`.
- **What crosses to publish.** One artifact, scrubbed of all eight keys the job holds. Publish checks that the head
  in `review-head.txt` (hex only) equals its own verify's. It keeps only the plain `code|used|tool|model` and
  `accounts` lines of `reviewer-run.env`, and only the `- reviewer: …` lines of `accounts.md`. The usage records go
  through `publish-verify.mjs usage`, `take-review` is unchanged, and `scrub.mjs` now covers all four tools' keys.
  Publish runs no file from the artifact.
- **No AI call in a job with a write token.** `claude|agent|gemini -p`, `codex exec`, `plan-agent.sh`,
  `run-agent.sh` and `agent-watchdog.sh` appear only in `work`, `review`, `intake` and `revise`, and in the two named
  second opinions (see Owner attention). `publish` has none.
- **A review job that stops** makes publish push the builder's work and stop with the line the supervisor matches
  (`T…:a…:review-job`, review only). The supervisor's per-key limit still escalates a cause that repeats.

Method (payload changes only):
- **Human gates:** unchanged. `verdict.mjs` still decides `human_gate` for risk 3, a method fix, a schema change and
  `human_gate_paths`. The only change there is that it reads `limited` and `not_before` from the contract, and the
  date must match the ISO form.
- **Role surfaces:** the reviewer's written surface is unchanged (`take-review`, PR-07, PR-94). By D-E18 it now has a
  shell, in a job with no write token. The Cursor reviewer kit (`devos/roles/cursor-reviewer/`) is the one that
  already exists.
- **A red check overrides PASS:** untouched (PR-08 in `verdict.mjs`; the checks are publish's, as before).
- **Secrets never in files:** the artifact is scrubbed before upload and again in publish. The contract's `result` is
  cut at 8000 characters, and the agent's raw output is never in the artifact (D9).
- **The runner owns git:** untouched. Only publish's `publish-verify.mjs` writes git.
- **Precedent:** PR-101, the next id after PR-100. It amends PR-53, PR-90, PR-92 and PR-100, and the live maximum
  line says PR-101. Decision D-E18 is in `dev/DECISIONS.md` and supersedes D11.
- **Manual (`guard:manual`, 138 names, up from 135):** `devos-review.yml`, `install-agent.sh` and `agent-result.mjs`
  each have their row. The Reviewer role row, `resolve`'s step, publish's review step, `plan-agent.sh`,
  `review-user.sh` and `mcp-devos.mjs` say what changed.

Owner attention:
- **D8 runs after the release (see above).** Until it does, no real cycle has run the review job. If it fails on
  GitHub, publish stops after pushing the builder's work, and nothing reaches main. The supervisor runs the review
  again, then escalates. If D8 shows a defect, its fix is the next task, before E86.
- **Any code in a job can reach every secret that job holds.** On GitHub's runners the job's user has `sudo`. The
  boundary is therefore which secrets a job is given, and E85 gives the review job only the reviewer tools' keys. Two
  consequences:
  - the review job holds the light reviewer's keys even on a deep review, because the mode is computed inside the
    job, so a deep reviewer can reach them;
  - the planner jobs hold all four tools' keys (the limit the fence states).
  E86 narrows both through the callers' mappings.
- **The review job runs the review tree's own runner** (`scripts/devos/render-prompt.mjs`, `plan-agent.sh`, the
  kit and `devos/project.json`), not `trusted/`. For a product task these are main's files, because verify refuses
  a method file in a product task. A branch that changes them is a method fix, which is always a deep review and a
  human gate. So a review that the branch shaped cannot auto-merge, and it waits for you. E86 can run main's runner
  over the review tree to close this.
- **PR-101's headline says no AI call runs in a job with a write token, but there are two exceptions.** The
  supervisor's and the doctor's optional Claude Code second opinions still run as `devos-review` with no shell, in
  jobs with `issues: write` and `actions: write` (and, for the doctor, `pull-requests` and `statuses: write`). The
  fence and `two-jobs.test.mjs` S6c name them as deferred, but the precedent's text does not. These two are also
  still Claude Code only. E86's precedent states the exception, and moving them to a job of their own is not yet on
  the ledger: say if you want a row for it.
- **The ledger rows are corrected:** E85's row now describes the approved order, and E86's row states your key rule.
- **Release 1.13.16 after the merge** (the CHANGELOG date is the release check's one problem). Then run D8 in
  learn-coptic.

Commit message: E85: review and planning in their own jobs, one agent output contract (1.13.16) - PASS a1
Next prompt: none yet. E86's fence comes on `task/E86` from main once 1.13.16 is released and D8 has passed, as E84's
came after E83's release. Its base (the squash plus the release commit) does not exist before then.
