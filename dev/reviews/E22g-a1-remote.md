VERDICT: PASS — MERGE
Fetched: task/E22g @ 1d376d4 (clean tree), main @ 9b707f9 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, the D3 Buffer compare, `node --check` on the eight files, `gh run view 40121843751` (with its logs), `git diff --name-only main...HEAD`, the D6 Chromium run against this branch · Refused calls: none

This is the remote check of E22g a1. It is risk 3: how a blueprint round ends and how `devos continue` resumes. It is the review of record.
- **The copies.** All 9 files are byte-identical to `dev/fences/E22g/files/`. They are my texts, read when I wrote and rehearsed them.
- **The rest of the diff** is the report.
- **Nothing in `payload/` changes.**

Ledger: D1 — PASS — `# tests 251` / `# pass 251` / `# fail 0` (Linux), naming `init.test.mjs` (aa) and (ab), `continue.test.mjs` (p) and (q), `ui-server.test.mjs` (x) and (y), and `ui-page.test.mjs` (h) (7 lines). CI Windows: `tests 251`, `pass 242`, `skipped 9`.
Ledger: D2 — PASS — `manifest up to date (155 files)` · `0 0`
Ledger: D3 — PASS — `9 files, 0 differ`
Ledger: D4 — PASS — `node --check` is clean for the three `lib/` files and the five tests
Ledger: D5 — PASS — run `40121843751` on `1d376d4`, attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` success
Ledger: D6 — PASS
- **The scope.** 9 paths and `dev/reports/E22g.md`.
- **The page.** Chromium against this branch, with `errors []`:
  - `choices.json` holds no project text;
  - a new start offered `cursor grok-4.7-high` and `cli`;
  - Continue on `hello-cli` went straight to "Review the blueprint" with the title block "Hello CLI · CLI or developer tool · Full product".

Scope: in the fence.
Method (payload changes only): none.
Owner attention:
- (1) **Your first real run (hello-cli, 2026-10-24) found three defects in the cycle,** all in the method E22h fixes:
  - **The cycle stopped at `agents.mjs pick`:** "agents: must have reviewer, reviewer_light, pool and policy". The page saves "same as the reviewer" as `reviewer_light: null`. The generated config drops a null, and `validate` requires the key.
  - **The setup issue asked for Vercel and Firebase settings that hello-cli did not choose:**
    - `vercel-var` applied to every project (`when: always`);
    - Firebase's `fence_hint` ("Firestore|Firebase") matched T01's rule "do not add … Firebase", so Firebase counted as planned;
    - the same false match makes the cycle install `firebase-tools` for T01.
  - **The supervisor's "runner-failure, unknown"** is that stopped run. It had no diagnosis because the project has no Claude key.
- (2) **E22h is next:** `dev/fences/E22h.md` and `dev/fences/E22h/`, engine 0.2.1, PR-53. hello-cli takes it with `devos upgrade`. Until then, the unblock steps are in my reply.

Commit message: E22g: a quiet blueprint round stops itself and a finished one goes to review, devos continue checks a written blueprint instead of drafting it again, the page keeps the last choices in ~/.devos/choices.json and shows a continued project's own choices — PASS a1
Next prompt: dev/fences/E22h.md
