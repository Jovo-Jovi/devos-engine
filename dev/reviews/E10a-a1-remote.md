MERGE

VERDICT: PASS
Fetched: `task/E10a` @ 1a5679e (no uncommitted changes) · Commands run: P2 against `main`'s blobs (`23 files, 0 moved on origin/main`), scope listing (`git diff --name-only main...HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, PR-62 count, staged guards on a fresh `install --key DEMO`), engine-ci run 40315904734 and its jobs · Refused calls: none

E10a discloses the private DEV_OS Control Tower in the contract before it is accepted and makes the link the developer's own yes or no.
- **Contract version `1`.** It says what the engine is, that it works fully on its own, that the Control Tower is a private service operated by Jovo-Jovi with no access for engine users, what a link request and each event carry, what is never sent, the address and HTTPS, the `id-token: write` permission on the `report` job only, and how `DEVOS_REPORTING` turns it on or off.
- **Terminal** (`lib/init.mjs`): `LINK_QUESTION` right after `accept`; only `yes` or `no`; three other answers stop setup with nothing written; the answer is `registry_link` in `devos/answers.json` and in the summary.
- **Page** (`lib/ui/app.js`, `lib/plan.mjs`): `link: null` by default, both choices unselected, "Accept and continue" blocked until the contract is accepted and a choice is made; a plan without `link: true|false` is refused; `rememberChoices` keeps no `link` (unchanged, now tested).
- **Setup** (`lib/setup.mjs`): only a yes sets `DEVOS_REPORTING=on` and lists it under *Variables*; a no sets nothing.
- **Cycle:** the `report` job runs only when `vars.DEVOS_REPORTING == 'on'` (was `!= 'off'`). `registry.url` is `https://devos-control-tower.vercel.app` (allow-listed). Manual, PR-62, README section, version 0.3.0.

This is a deep review: risk 3, a method change, and a payload change. The 24 copied paths are byte-identical to the package (D3); the builder's commit adds only `payload/manifest.json` (rebuilt by S2) and its report, which I read. I read every changed line under `lib/`, `payload/` and `tools/`, the whole new `test/consent.test.mjs`, every changed test line, and the README section. I checked the contract's field list against the sender (`payload/files/scripts/devos/report.mjs`): the request body is `{ v, key, engine, contract }` with GitHub's OIDC token, and an event's fields are `v, project, run, seq, phase, task, step, status, at, evidence`. They match, apart from the format number `v` (Owner attention 4).
Ledger: D1 — PASS — my run on Linux: `tests 319`, `pass 319`, `fail 0`, `skipped 0`; `consent.test.mjs` (a)–(f) are `ok 63`–`ok 68` and `init.test.mjs contract version is 1` is `ok 135`. The builder's report on Windows: `tests 319`, `pass 308`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (309 files)`; `0 0`.
Ledger: D3 — PASS — `24 files, 0 differ`.
Ledger: D4 — PASS — `devos 0.3.0`; `Live maximum: PR-62` → `1`; staged guards exit 0 with `guard:manual    PASS  (113 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40315904734 on 1a5679e, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists the 24 copied paths and their 24 package copies, `payload/manifest.json`, `dev/reports/E10a.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E10a.md` and `dev/fences/E10a/before.json`. Nothing else. This review and the ledger rows are added after it.
Scope: in fence. No dependency added. Nothing is sent without a yes: with no variable, or `off`, the `report` job does not start; no other job gained `id-token` (`consent.test.mjs` (f) counts one).
Method (payload changes only): no non-waivable rule is weakened. Human gates, role surfaces, a red check overriding PASS, secrets never in files and the runner owning git are untouched; reporting is now opt-in, a narrowing. PR-62 is the next id after PR-61. `AUTOMATION.md` updates `DEVOS_REPORTING` (now **off** when not set) and `registry`; no new name (`guard:manual` 113 names).
Owner attention:
1. **`dev/DECISIONS.md` still records the old positions, and it outranks every fence (`CLAUDE.md`).**
   - D-E4 says the licence is open and, until then, all rights reserved.
   - D-E6 says registration goes through the GitHub App.
   - D-E8 says the dashboard is never named; E10a names it, as private, by your release decision.
   - D-E10 and `dev/RELEASE.md` say the public repository gets a fresh history and the build repository stays private. Your 14:43 answer keeps the current history, so this is the first conflict to settle before E10c.
   - I merge E10a on your 2026-10-26 decisions, which the ledger row quotes. Record D-E4, D-E6 and D-E8 in `dev/DECISIONS.md` before E10b runs: its fence stops (P1) until D-E4 names PolyForm Shield 1.0.0.
2. **An upgraded project stops reporting until its developer says yes.** A project made on 0.2.9 has no `registry_link`, and with the variable unset, reporting is now off. That is intended. No such project exists yet.
3. **The contract's "Your records" section is thin for Law 151.**
   - It sends deletion requests to an issue in the engine repository, which is private until E10c.
   - It does not say who controls the records, how long they are kept, or where they are hosted.
   - This is the third conflict; I propose it for E10c.
4. **The contract's field lists omit the format number `v`,** which both the request and each event carry. This is wording only; fold it into the same contract edit.
5. **`report.mjs` itself stops only on `off`.** In the cycle, the job's `== 'on'` condition is the only gate. Outside Actions there is no OIDC token, so nothing can be sent. No change is needed now.
6. **For E10c's release check:** `payload/manifest.json` ships `source.repo: Jovo-Jovi/devos-control-tower` and a commit, a source pin that D-E10 keeps out of the public tree.

Commit message: E10a: the private Control Tower disclosed before the contract is accepted, and a link that is the developer's explicit choice; engine 0.3.0 (PR-62) — PASS a1
Next prompt: dev/fences/E10b.md (v1, on `task/E10b`)
