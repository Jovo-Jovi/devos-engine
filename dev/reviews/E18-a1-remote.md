VERDICT: PASS — MERGE
Fetched: task/E18 @ 74e3727 (clean tree), main @ ccb94e4 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 counts and `includes` check, the D5 staged guards (install `DEMO`, fixture docs, `run-all.mjs`), the D6 Buffer compares, `node --check` on every changed `.mjs`, `gh run view 40019988340`, and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E18 a1 (risk 3, a method change; the review of record). I read every changed line in `lib/`, `payload/`, `tools/` and `test/`.
- **`lib/catalogue.mjs`** is as specified: `stacksFor` filters on `runs`, `methodModules` leaves out `vercel`, `derivedAnswers` has its defaults, and `appKeys` keeps module and provider order.
- **`devos init`** asks the type, then the stack (with the note), then the type's module menus, then five questions. The prepare block comes before the attachments. The answers keep the old fields, now derived, and gain `type`, `stack` and `modules`; the summary has three new lines.
- **Keys.**
  - `holds("module:X")` is true for secret items only.
  - `neededKeys` lists the cycle keys, then the deploy-blocking module keys, then the app keys. The general rule reproduces the old Vercel branch exactly.
  - The seven new key sources match the fence text.
  - `readFileKey` reads a visible path, checks the JSON, tries three times and never prints the content.
  - `SETUP.md` gains the app-keys section.
- **The payload.** `blueprint.md` matches its fence copy byte for byte, and the PR-46 row is in place. `AUTOMATION.md` §11 has exactly the three fence lines.

Ledger: D1 — PASS — `# tests 157` / `# pass 157` / `# fail 0` / `# skipped 0` (Linux); `catalogue.test.mjs` (a)–(l) present
Ledger: D2 — PASS — `manifest up to date (115 files)`
Ledger: D3 — PASS — `67 identical, 34 changed (E03, E06, E11, E12, E17, E15, P1, E18, E02), 14 added (E02, E06, E15, E18, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-46` ×1, one `| PR-46 |` row, `includes` → `true`
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true true true` (catalogue, blueprint, README)
Ledger: D7 — PASS — `node --check` is clean
Ledger: D8 — PASS — run `40019988340` on `74e3727`, attempt 1: `checks`, `test (ubuntu-latest)`, `test (windows-latest)` success

Scope: in the fence, with one small addition. `moduleRead` in `lib/init.mjs` also accepts a module menu answered as `<module id> <provider>`, for example `database none`. I wrote the harness lines that way in S7. Every other answer form still works, and the addition is harmless, so it stays.
Method (payload changes only):
- **Non-waivable rules hold.** No gate, surface, check, secret rule or git rule changed.
- **Variables and Vercel items for `module:` conditions stay off at init**, so the method still turns them on when the module lands. Test (j) shows no `variable set DEVOS_SUPABASE`.
- **The record is complete.** PR-46 is at the live maximum, and `AUTOMATION.md` §11 is updated. There are no new scripts, variables, labels or commands, so the count stays at 101 names.
Owner attention:
- (1) **Keys your app reads are not copied to Vercel yet.** They are stored as GitHub secrets, and `SETUP.md` tells you to set them in Vercel too. The copy to Vercel is E21's.
- (2) **Avoiding over-engineering, your question of 2026-10-23.**
  - **Today the method already:**
    - stops builders from inventing scope;
    - fails a reviewer check when scope is added;
    - makes the blueprint decide Include · Omit · Adapt for every layer and tool;
    - has intake split work into the smallest tasks.
  - **What is missing** is an explicit proportion rule: cite the need for every layer, dependency and abstraction; prefer the simplest architecture; the first phase is the MVP. A one-page `docs/STACK.md` that builders follow is missing too.
  - **E23a adds both**, alongside Context7 for every tool (PR-47).

Commit message: E18: catalogue — project type, stack, modules with providers, documents to prepare, module keys once (file keys by path), blueprint plans providers and observability (PR-46) — PASS a1
Next prompt: dev/fences/E23a.md
