VERDICT: PASS
MERGE
Fetched: `task/E23b4` @ c2459e2 (`E23b4 a1: builder`), clean tree, over `main` @ e3d9f6b · Commands run: D1 `node --test "test/*.test.mjs"` and `git status --porcelain test/fixtures`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the staged-guard command of `dev/fences/E53c2.md` D4, D5 `node bin/devos.mjs --version`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs?head_sha=c2459e2…`, the run's jobs and the test job's log, D7 `git diff --name-only main...HEAD`, and `git diff --stat 4f608dd HEAD -- dev/fences dev/LEDGER.md` · Refused calls: none

E23b4 is production readiness, the launch task's gates (PR-88, engine 1.12.0):
- **The launch task.** In a full-scope plan, the last task before launch has a `- Launch:` line naming its main
  pages, or `none`; `fence-check` checks the line.
- **`readiness.mjs`** makes the required check `readiness`, so a red check overrides PASS. It runs four checks:
  - security headers;
  - the full `pnpm audit`;
  - axe;
  - speed: largest contentful paint ≤ 2.5 s and layout shift ≤ 0.1.

  Only a `Readiness waiver:` line in `docs/DECISIONS.md` excepts a check. `.devos/readiness.md` gives the ASVS level
  (2 with personal data or payments), in the evidence pack.
- **`docs/method/READINESS.md`**, the reviewer's checklist per layer.
- **Two sources vendored**, read whole and pinned:
  - OWASP ASVS 5.0.0, V1–V16;
  - Trail of Bits' sharp edges, `SKILL.md` and five references.

  Both are for the reviewer only. The general chapters are selected by the topic `launch`, and a subject's chapter by
  a deep task.
- **Prompts and method.** The reviewer, the blueprint, the fence skill, the auditor, the handbook §10.4, PR-88 and
  `AUTOMATION.md` say so.
- **Folded in:** the fake-tool tests run from an executable copy.

Risk 3, a method change, deep review. Every changed line is the fence's exact-file package, which the reviewer wrote
and rehearsed on a copy of e3d9f6b:
- 569 tests;
- `readiness.mjs` in a real Chromium with `@axe-core/playwright`, where it caught three axe violations and a paint at
  3.2 s;
- the trust read of the two sources (no instruction to run or fetch anything; the notes in `DEVOS-NOTES.md`).

D3 proves the branch holds exactly those bytes, and the fence and ledger are as issued. The builder's commit changes
the 64 files and its report only. Read again on the branch:
- **Commands:**
  - the preview command is the project's own `stack.preview`, as `screens.mjs` uses it;
  - the page paths reach only `fetch` and the browser, after `fence-check`'s `^/[^\s?#]*$`;
  - `pnpm audit` keeps its fixed arguments (`guard:deps`' `audit()`, now exported).
- **Waivers** are read only from `docs/DECISIONS.md`, which the builder's surface denies and the reviewer's does not
  allow. Only the four mechanical checks can be waived there by name; the reviewer applies the rest.
- **Tests:** a `pnpm` stub answers the audit and a small Node server is the "build". No test runs a real `pnpm` or
  browser, reads a key or reaches the network.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 569`, `# pass 569`, `# fail 0`; the six `readiness.test.mjs` tests are ok;
  `git status --porcelain test/fixtures` prints nothing afterwards. The builder's Windows run: tests 569, pass 547,
  fail 0, skipped 22, the allowed count; the six new tests
  passed there, and `test/fixtures` stayed clean there too.
- D2 — PASS — `manifest up to date (348 files)`; `0 0`.
- D3 — PASS — `64 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (355 files scanned)`, `guard:manual PASS (127 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 20 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.12.0`.
- D6 — PASS — `engine-ci` run 42530868625 on c2459e2, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success with `# tests 569`, `# pass 569`, `# fail 0`.
- D7 — PASS — the 64 paths of S1, `dev/reports/E23b4.md`, `dev/LEDGER.md`, `dev/fences/E23b4.md` and
  `dev/fences/E23b4/**` (65 files: the 64 and `before.json`): 132 paths. Nothing else.

Scope: in the fence. No dependency of the engine; `@playwright/test` and `@axe-core/playwright` are the project's, as
for the UI evidence (PR-51).

Method (payload changes only):
- Non-waivable rules: none is weakened; the task adds a gate.
  - Human gates: the launch task is risk 3 with the owner's gate, and only the owner's written waiver excepts a check.
  - Red check overrides PASS: `readiness` is a required check, so a red one blocks the PASS as any red check does.
  - Secrets never in files: the vendored sample `export API_KEY="sk_live_xxx"` is a placeholder in a quoted
    illustration; `guard:secrets` passes over all 355 files.
  - Role surfaces and the runner owning git are untouched.
- Precedent: PR-88 was added, and the live maximum is now PR-88; `readiness.test.mjs` (f) pins both, and
  `resilience.test.mjs` (f) no longer pins the maximum.
- Manual: the new script `readiness.mjs` is in `AUTOMATION.md`, so `guard:manual` checks 127 names. No new guard,
  variable, label or command.
- Licences: both sources are CC BY-SA 4.0, copied unchanged with `LICENSE`, `ATTRIBUTION.md` and the notices, and
  listed in `THIRD_PARTY_NOTICES.md` (`licences.test.mjs` (c), 20 vendored).

Owner attention:
- **Release when you choose** (`dev/RELEASE.md`): 1.11.0 is on `main` untagged, and 1.12.0 comes with this merge.
  Releasing 1.12.0 alone also ships 1.11.0's changes, under both changelog sections.
- **The fence's readings are yours to change.** Speed is a lab measure; any axe violation fails; the headers are a
  baseline every level-1 site meets; waivers are lines in `docs/DECISIONS.md`.
- **The ledger is brought up to date with this review:**
  - E49–E51 are closed, not built (replaced by E58).
  - The review follow-ups that later tasks fixed are marked done, with the task.
  - E62 is filed, "Before Medix": the follow-ups still open.
  - Your two decisions stay open: NEL named in the handbook, and PLAN §3.
- **A test run no longer flips `test/fixtures/agents/*`**: the reviewer restored nothing this time.
- **Next:** E62 when you ask, then the release and your audit in a new chat before Medix.

Commit message: E23b4: production readiness — the launch task's - Launch: line; readiness.mjs makes the required check readiness (security headers, the full pnpm audit, axe, speed: LCP ≤ 2.5 s and CLS ≤ 0.1), waived only by the owner's line in docs/DECISIONS.md; docs/method/READINESS.md per layer; OWASP ASVS 5.0.0 (L1, L2 with personal data or payments) and Trail of Bits' sharp edges vendored for the reviewer; test runs leave test/fixtures/agents as they were; engine 1.12.0 (PR-88) — PASS a1
Next prompt: none on this branch. E62 is fenced on `task/E62` from `main` when the owner asks.
