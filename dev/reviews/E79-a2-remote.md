MERGE

VERDICT: PASS
Fetched: HEAD @ cc1bfc1 (`E79: the engine never picks a model or an effort (1.13.11) — attempt 2`) + working tree
clean · Commands run: D1 (the full suite, here), D2–D6 and D8 on Linux, D7 through `gh api` · Refused calls: none

Attempt 1 halted correctly at D1 on the owner's Windows computer, and was not committed. The fault was the fence's:
v1's tests answered the builder question with `cursor grok-4.7`. They saw that computer's own Cursor CLI, which lists
`grok-4.7-low` to `-xhigh` but no bare `grok-4.7`. Fence v2 (af403c2) changed `test/harness.mjs` only, so the staged
tests always use the stand-in `agent`. Attempt 2 copied that one file over attempt 1's uncommitted copy. The commit
holds the 72 package files (70 changed, 2 new) and the report. It is version 1.13.11.

The engine no longer picks a model or an effort (precedent PR-99, amending PR-53, PR-78 and PR-86):
- Every role starts empty in `devos init`, `devos adopt` and on the guided page, and earlier choices fill in nothing.
- An effort is asked for each role whose tool takes one, with a separate gate effort, the light reviews' effort, each
  builder's (fixed or `fence`), and `raise_on_retry` as a yes or no.
- `devos/engine.defaults.json` names no agent, model or effort. A missing choice stops the run and names its key.
- `devos upgrade` asks an older project once for what it lacks, and commits the answers.

Review depth (risk 3, deep, on Opus). The reviewer wrote the package and rehearsed it twice. The second run had a
stand-in Cursor CLI on `PATH` that lists the owner's ids. This check proves the copy and reruns the evidence:
- D3 on the branch: every file the builder's commit changed equals `dev/fences/E79/files/`.
- I read every changed line again (`git diff 4d5fc9b cc1bfc1`, 73 files):
  - `scripts/devos/lib.mjs` (`runChoice`, `raisesOnRetry`, `missingChoice`), `agents.mjs` (`validate`,
    `missingChoices`, `builderNeedsEffort`, `effort --kind`), `review-mode`, `heavy`, `builder-model`, `agent-cli`,
    `next-task`, `loop`, `render-prompt`, `fence-check` and `plan-agent.sh`;
  - the five workflows (the method, intake, revise, supervisor and doctor runs take `agents.mjs effort`);
  - `lib/menu.mjs` (no-default `select` and `confirm`), `init`, `adopt` (`chooseAgent`, `--effort`, the effort
    passed to every round), `roster`, `plan`, `upgrade` (`askMissingChoices`), `fallbacks`, `ui-server` and
    `ui/app.js` (empty agents, the effort fields, `problems("reviewers")`, no remembered agents, **Another tool**
    with no model picked);
  - the precedent, `AUTOMATION.md`, `DEV_OS_V2_REVIEWER.md`, the blueprint prompt, the README and the changelog;
  - the tests: `no-defaults.test.mjs` (a)–(f), `init.test.mjs` (m), (m2) and (b), the two `upgrade.test.mjs` (E79)
    tests, the rewritten effort and model tests, and `test/chosen-agents.mjs`.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet af403c2 cc1bfc1` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite on Linux:** `# tests 686`, `# pass 686`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run:** tests 686, pass 644, fail 0, skipped 42, as the fence says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `72 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.11`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 45388212529 on cc1bfc1 (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 148 paths before this review, and only these:
- the 72 paths of S1;
- `dev/reports/E79.md`;
- the 73 files of `dev/fences/E79/` (the 72 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E79.md`.

This review adds itself.

Scope: in fence. The porcelain count of attempt 2 printed `70 modified, 3 new, 0 other`, as v2's *Attempt 2 focus*
says. The third new path is attempt 1's report. The report has no key, token or private path.

Method (payload changes only):
- **No non-waivable rule is weakened.**
  - Human gates: `isHumanGate`, the gate review and the heavy hold are unchanged, and a gate gets its own effort.
  - Role surfaces, the role kits, `verdict.mjs` (a red check still overrides PASS) and the guards are untouched.
  - No secret is written: the upgrade writes efforts only, into `devos/project.json`.
  - The runner still owns git.
- **Precedent:** PR-99 is the next id after PR-98.
- **`AUTOMATION.md`:**
  - It names `agents.mjs effort --kind …`, the effort keys, `raise_on_retry`, and what `review-mode` and
    `builder-model` now do.
  - No workflow, variable or label is new: `guard:manual` still checks 135 names.

Owner attention:
- **Every existing project must run `devos upgrade` once, in a terminal, before its next cycle.** Until then its runs
  stop and name the missing efforts. The project page's **Upgrade** button cannot ask questions, so it says to run the
  upgrade in a terminal.
- **Stop, never substitute.** A builder whose fence asks for an effort that your Cursor account does not list now
  stops; it no longer runs `grok-4.7-high` or a lower or higher effort in its place. A Cursor model your account
  lists with no effort in its id at all runs as chosen.
- **Not in E79:**
  - The media module's own image, video and voice model ids (`media-providers/xai.mjs`) are still the engine's. A
    later fence could make them yours.
  - **Another tool** (`devos models tool`) asks no effort. When the new tool takes one, it refuses and names the key.

Commit message: E79: the engine never picks a model or an effort (1.13.11) — PASS a2
Next prompt: none (no next task in the ledger)
