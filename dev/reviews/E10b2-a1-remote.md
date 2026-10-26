MERGE

VERDICT: PASS
Fetched: `task/E10b2` @ 477c7c0 (no uncommitted changes; `main` @ 3f28305 with D-E11 merged in at 4dd0dbc) · Commands run: scope listing (`git diff --name-only main...HEAD`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, staged guards on a fresh `install --key DEMO`), engine-ci run 40334279915 and its jobs, the builder commit's manifest diff and report, D-E11 on `main` · Refused calls: none

E10b2 tells a developer, before the link question, what the Control Tower keeps about a linked project, why, for how long, where, and how to reach its operator.
- **The contract** (version 1 unchanged; no project accepted it outside tests):
  - the request and each event name their format version;
  - the identity token is checked, only the repository and its owner's numeric id are kept from it, and the token is dropped;
  - "What the Control Tower keeps": who, what, why, how long (180 days, 365 days, while linked, backups up to 30 days) and where (Supabase `eu-central-1` and Vercel `fra1`, Frankfurt; backups on GitHub; US-based providers);
  - "Your rights", through the contact recorded in D-E11. It replaces the issue route.
- **The README** carries the same facts and the contact.
- **`report.mjs`:** a `403` tells the developer how to stop asking, and a `429` is kept as `busy` and asked again on the next run.
- **Tests:** `test/privacy.test.mjs` (a)–(c), including a test that the contract and README claim no legal compliance, and `report.test.mjs` (b) with the `429` case.

This is a deep review: risk 3, a method change, and a payload change to `report.mjs`. The 7 copied paths are byte-identical to the package (D3). I wrote, rehearsed and read every line of that package before issuing the fence. Every fact in the texts is one the owner verified (D-E11): the legal identity stays provisional, and there is no transfer-basis claim. The builder's commit adds only `payload/manifest.json` (the `report.mjs` hash) and its report, which I read.
Ledger: D1 — PASS — my run on Linux: `tests 328`, `pass 328`, `fail 0`, `skipped 0`; `privacy.test.mjs` (a)–(c) are `ok 193`–`ok 195` and `report.test.mjs (b)` is `ok 202`. The builder's report on Windows: `tests 328`, `pass 317`, `fail 0`, `skipped 11` (the existing Windows skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `7 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.0.0`; the guards exit 0 with `guard:secrets   PASS  (317 files scanned)`, `guard:manual    PASS  (113 names checked)`, `guard:config    PASS  (generated config is current)` and `guard:skills    PASS  (29 skills checked, 18 vendored)`.
Ledger: D5 — PASS — engine-ci run 40334279915 on 477c7c0, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists the 7 copied paths, `payload/manifest.json`, `dev/reports/E10b2.md`, and the reviewer's `dev/LEDGER.md`, `dev/fences/E10b2.md`, `dev/fences/E10b2/before.json` and the 7 package copies. Nothing else. This review and the ledger row are added after it.
Scope: in fence. No dependency added. The link question, the onboarding, the event schema, the request body and what is sent are unchanged.
Method (payload changes only): `report.mjs` changes two messages and adds the `busy` state for `429`. Every command still exits 0, so reporting still never blocks a run. No rule of the method changes, so there is no precedent row, and `guard:manual` still checks 113 names. The non-waivable rules are untouched.
Owner attention:
1. **Counsel reads "What the Control Tower keeps" and "Your rights"** with the Tower's `PROTECTION_MODEL.md` before the release.
2. **E10c publishes nothing until you confirm the legal identity in D-E11** (it still says "provisionally"). Its fence gates on that.
3. **Your address is now public** in the README and the contract once the repository is public, and permanently in its history (D-E10).

Commit message: E10b2: what the Control Tower keeps, why, for how long, where, and how to reach its operator — said before the link question — PASS a1
Next prompt: none yet — dev/fences/E10c.md is written next (ledger row E10c)
