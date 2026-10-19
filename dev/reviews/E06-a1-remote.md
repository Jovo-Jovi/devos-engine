VERDICT: PASS — MERGE
Fetched: task/E06 @ e057534 (clean tree), main @ e69f8b1 · Commands run: `diff -r` of the branch's `payload/files` and `tools/sources.mjs` `LOCAL` against my own rehearsal clone (E06 fence v2), `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `git grep -c "OD-0" -- payload/files`, the D6 Buffer comparison, a staged install with the fixture docs + `run-all.mjs`, `node --check` on `lib/`, `bin/`, `test/`, `tools/`, a `keyFromName` probe, `gh run view 39292332668` + the Windows job log, and a re-rehearsal of the E07 v1 fence's `setup.json` and `setup-check` claims · Refused calls: none

Remote check (risk 3, method change).

**Payload.** The branch's `payload/files/` is byte-identical to the tree I rehearsed when I wrote fence v2 (`diff -r` prints nothing), and so is `LOCAL` in `tools/sources.mjs`. The payload changes are:
- the OD citations come out of 22 lines in 15 files;
- the new `devos/prompts/blueprint.md` is added;
- the command is replaced;
- AUTOMATION §6 and §11 are updated;
- PR-43 is added.

**Code.** I read `lib/init.mjs`, `lib/contract.mjs` and the `lib/install.mjs`/`lib/which.mjs`/`bin/devos.mjs` diffs in full:
- the folder is created only after the contract and all eight answers (D-E3);
- `.claude/settings.json` is held back and written only on approval;
- the claude flags match the fence; there are at most 5 rounds;
- a failed check runs a repair round without asking.

Ledger: D1 — PASS — `# tests 72` / `# pass 72` / `# fail 0` (Linux); Windows `# pass 71` / `# skipped 1` / `# fail 0`; `init.test.mjs` cases `ok 17`–`ok 26` on both
Ledger: D2 — PASS — `manifest up to date (111 files)`
Ledger: D3 — PASS — `0 0`
Ledger: D4 — PASS — `71 identical, 30 changed (E03, E06, E11, E12, E02), 10 added (E02, E06, E12, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`
Ledger: D5 — PASS — `OD-0` only in `devos/schemas/intake.schema.json:1` and `docs/method/PRECEDENTS.md:4`
Ledger: D6 — PASS — `true true true`
Ledger: D7 — PASS — staged install + fixture docs: `guard:manual PASS (97 names checked)`, `run-all.mjs` exit 0
Ledger: D8 — PASS — `node --check` clean for every `.mjs`
Ledger: D9 — PASS — run `39292332668` on `e057534`, attempt 1, all three jobs success

Scope: in the fence. The changes are lib, bin, the contract, the payload changes listed above, provenance, the manifest, `init.test.mjs`, and the `110` → manifest-length change in two tests.

Method:
- **Precedent and manual.** PR-43 is appended at the next id with the live maximum `PR-43`, and no earlier row is edited. `guard:manual` names `blueprint.md`.
- **Non-waivable rules.** None is weakened:
  - the reviewer's settings still arrive, now last and automatically;
  - the blueprint's tools exclude git, gh, curl, wget and rm;
  - no secret is handled.

Owner attention:
- (1) The local review's points are confirmed: PLAN §3 lists the blueprint before the install, while `init` installs first so that the blueprint can read the installed handbook. PLAN outranks the fence, so this is yours to settle. The suggested PLAN §3 edit:
  - swap the rows, so 5 = "Engine files: installs the engine … writes `devos/project.json`, generates `devos.config.json`; `.claude/settings.json` waits for approval" and 6 = "Blueprint … shown for approval";
  - move "`SETUP.md`, commits locally" to step 7 (E07).
- (2) There is one small gap I add to E07 (fence v2). The automatic repair round sends the bare guard output to Claude, with no instruction around it. E07 wraps it in one sentence.
- (3) `keyFromName("!!!")` → `P`, which fails `KEY_RE`. E07 S2 already handles this.
- (4) The E07 v1 fence, from the local review, re-rehearses correctly here:
  - `devos/setup.json` has 16 items and 22 secret names;
  - `setup-check --for cycle` prints exactly the six lines it cites when all 22 names are present.

Commit message: E06: init part 1: contract (typed accept), questions, install, blueprint through Claude Code, approval; OD citations out of the payload (PR-43) — PASS a1
Next prompt: dev/fences/E07.md v2
