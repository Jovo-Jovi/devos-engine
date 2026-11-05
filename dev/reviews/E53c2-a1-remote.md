VERDICT: PASS
MERGE
Fetched: `task/E53c2` @ 2a0a0af (`E53c2 a1: builder`), clean tree, over `main` @ f31277e · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the fence's staged-guard command, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs/42045369827` and its jobs, D7 `git diff --name-only origin/main...HEAD` · Refused calls: none

E53c2 makes the cycle generate a task's planned media before its builder (PR-81):
- a fence names its items in `- Media:`, checked by `fence-check`;
- a "Generated media" step runs `media.mjs --fence` within `DEVOS_MEDIA_BUDGET` (unset: 0, an estimate only),
  alone holds `DEVOS_MEDIA_XAI_KEY`, commits only what it changed and never stops the task;
- `guard:scope` takes the named files as the runner's, and the builder's surface refuses every planned file;
- the evidence pack reports the step;
- setup offers the key as an optional secret under the condition `media:xai`.

Risk 3, a method change with a workflow edit, deep review: every changed line is the fence's exact-file package,
which the reviewer wrote and rehearsed on a copy of f31277e, with `actionlint` 1.7.7 clean. D3 proves the branch holds
exactly those bytes. The builder's commit changes the 23 files and its report only: the PowerShell cache folder its
report mentions was removed before the commit, and is not in the diff. The reviewer's files are as the fence commit
left them.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 522`, `# pass 522`, `# fail 0`; the seven `media-cycle.test.mjs` tests are ok.
  The builder's Windows run: tests 522, fail 0, skipped 20, the allowed count.
- D2 — PASS — `manifest up to date (315 files)`; `0 0`.
- D3 — PASS — `23 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (322 files scanned)`, `guard:manual PASS (123 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.6.0`.
- D6 — PASS — `engine-ci` run 42045369827 on 2a0a0af, attempt 1, `success`: `checks` (with `actionlint`) success,
  `test (ubuntu-latest)` success.
- D7 — PASS — 50 paths: the 23 of S1, `dev/reports/E53c2.md`, `dev/LEDGER.md`, `dev/fences/E53c2.md` and
  `dev/fences/E53c2/**`. Nothing else.

Scope: in the fence. `package.json` and the version are unchanged; no dependency.

Method (payload changes only):
- Non-waivable rules: none is weakened.
- Secrets never in files: the key reaches one step only (one `secrets.DEVOS_MEDIA_XAI_KEY` in `devos-cycle.yml`, test
  (f)). `devos-setup.yml` sees only its presence.
- Role surfaces: no agent runs in the media step, and the builder may change no planned file (test (d)).
- The runner owns git: the step commits, and the builder's push carries that commit.
- A failed item never stops a task.
- Human gates and red-check-overrides-PASS are untouched.
- Precedent: PR-81 was added, and the live maximum is now PR-81.
- Manual:
  - `AUTOMATION.md` names `DEVOS_MEDIA_BUDGET` (§8), the secret, the step in the attempt flow (§2), `--fence` (§4)
    and the scope rule (§5);
  - `guard:manual` checks 123 names.

Owner attention:
- **Spending needs both settings on a project's repository:** the secret `DEVOS_MEDIA_XAI_KEY`, and the variable
  `DEVOS_MEDIA_BUDGET` above 0. Without both, a task that names media shows only its estimate.
- **1.6.0 is complete:** E52, E53a, E53b, E53c1, E53c2 and E55. `dev/RELEASE.md` is ready for your release steps.
- **A Windows note for later:** PowerShell left an untracked `Microsoft/` cache folder in the repository during the
  builder's run. It was removed and nothing was committed. The ledger keeps it as a follow-up, in case it happens
  again.

Commit message: E53c2: the cycle makes a task's planned media before its builder — - Media: line, Generated media step, DEVOS_MEDIA_BUDGET, optional DEVOS_MEDIA_XAI_KEY (PR-81) — PASS a1
Next prompt: none. E56 (images you own) waits for the owner's word; the release of 1.6.0 is the owner's.
