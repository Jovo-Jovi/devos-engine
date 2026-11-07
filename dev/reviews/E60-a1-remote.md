VERDICT: PASS
MERGE
Fetched: `task/E60` @ d7aeaf4 (`E60 a1: builder`), clean tree, over `main` @ e4886cc · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?head_sha=d7aeaf4…`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD`, and `git diff --stat 5b5232e HEAD -- dev/fences dev/LEDGER.md` · Refused calls: none

E60 is models and effort (PR-86, engine 1.10.0):
- **Another tool for a role.** `devos models tool <role> <tool> <model>` and the Models panel's Another tool
  (`POST /api/agent`) open a pull request on `devos/models-<role>` with `devos/project.json` `agents` and the config
  made from it. It is refused without a key for the new tool on the repository (by name), with the role's model
  variable set, for a shared light reviewer, for a reviewer at effort `max` leaving Claude Code, and when the runner's
  own `validate` refuses the agents. A new tool clears the role's next models and a builder's `fast`; the agent keeps
  its id.
- **`cursor-grok-*`** is listed under Grok.
- **Max for Claude Code:** the blueprint agent (page, plan, `--effort max`) and a Claude Code reviewer's settings; a
  retry stops at `xhigh` and leaves `max`; a `max` review is a heavy run.
- **No quiet change of effort:** `builder-model.mjs` tries the Fast id at the same effort before the configured
  model, reports the effort the chosen id runs at, and a changed one is a `::warning` and the evidence note.
- **The slow-machine test:** `init.test.mjs` (f) waits 20 s.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of e4886cc (557 tests). D3 proves the branch holds exactly those bytes, and the fence and
ledger are as issued. The builder's commit changes the 20 files and its report only. Read again on the branch:
- **GitHub writes:** `setAgent` writes only through the existing `openChange` path (branch, two contents PUTs, one
  pull request), which `setFallbacks` now shares with its exact calls and messages (`fallbacks.test.mjs` passes
  unchanged). Role, tool and model are checked before any call, and every `gh` call takes an argument list.
- **Secrets:** only `gh secret list --json name` is read: names, never values, and nothing is written.
- **The page:** `POST /api/agent` has the token and origin checks of every page call (a call without an origin is
  403), and is refused while a run is going.
- **Tests:** they use the harness's `gh` stub and a written `agent models` list; none runs a real CLI, reads a key or
  reaches the network.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 557`, `# pass 557`, `# fail 0`; the six `models-tool.test.mjs` tests are ok.
  The builder's Windows run: tests 557, pass 537, fail 0, skipped 20, the allowed count; the six new tests passed
  there too.
- D2 — PASS — `manifest up to date (316 files)`; `0 0`.
- D3 — PASS — `20 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (323 files scanned)`, `guard:manual PASS (124 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.10.0`.
- D6 — PASS — `engine-ci` run 42419199699 on d7aeaf4, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success with `# tests 557`, `# pass 557`, `# fail 0`.
- D7 — PASS — the 20 paths of S1, `dev/reports/E60.md`, `dev/LEDGER.md`, `dev/fences/E60.md` and
  `dev/fences/E60/**` (21 files: the 20 and `before.json`): 44 paths. Nothing else.

Scope: in the fence. No dependency; no workflow changes; `engine.defaults.json` unchanged (`config-equivalence`).

Method (payload changes only):
- Non-waivable rules: none is weakened.
  - Human gates: a role's tool changes only by a pull request the owner merges; nothing is merged here.
  - Secrets never in files: the key check reads secret names only.
  - Role surfaces and the runner owning git are untouched; the runner's own agent check runs before the pull request.
  - Red check overrides PASS: untouched.
- Precedent: PR-86 was added, and the live maximum is now PR-86; `models-tool.test.mjs` (f) pins both, and
  `deps-gate.test.mjs` (e) no longer pins the maximum.
- Manual: no new script, guard, variable, label or `/devos` command; `guard:manual` still checks 124 names.
  `AUTOMATION.md` names `devos models tool`, the Fast-then-configured order and the `max` review.

Owner attention:
- **Release 1.10.0 when you choose** (`dev/RELEASE.md`): E59 and E60 ship together.
- **The fence's readings are yours to change:** the agent keeps its id; a new tool clears the next models; a role
  variable blocks the move until you remove it; Max is for the blueprint agent and the reviewer, not the builders; the
  terminal `devos init` asks no effort (the page does).
- **The key check is by name only.** A wrong key still fails at the first run, as today.
- **A test run flips six `test/fixtures/agents/*` files to mode 755** on Linux (an older test's chmod); the reviewer
  restored them.
- **Next:** E61, the cycle's resilience (`/devos accept`, 2× screenshots, retrying a 5xx), fenced on `task/E61` from
  `main` once you merge this.

Commit message: E60: models and effort — devos models tool and the Models panel move a role to another tool by pull request once the repository has its key; cursor-grok-* under Grok; Max for a Claude Code blueprint agent and reviewer; the builder runs the Fast id at the same effort before another and never changes its effort quietly; init.test (f) waits 20 s; engine 1.10.0 (PR-86) — PASS a1
Next prompt: none on this branch. E61 is fenced on `task/E61` from `main` once you merge E60.
