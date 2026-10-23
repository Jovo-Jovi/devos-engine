VERDICT: PASS — MERGE
Fetched: task/E19 @ e5d34ff (clean tree), main @ f8eb207 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 count, the eight D6 Buffer compares, `node --check` on every changed `.mjs`, the D5 staged guards, `gh run list --branch task/E19`, and `git diff a45d60b..HEAD` read in full · Refused calls: none

This is the remote check of E19 a2 (risk 3, a method change; the review of record).
- **FIX 1.** After its checks, the non-Node path restores and cleans the tracked and untracked paths the checks changed, with the same `before` set and the same `git` calls as the Node path. The summary lists those paths, and the WARN line prints.
- **FIX 2.** `dot-gitignore` matches its fence copy, and `.gitignore` is tagged `E19`.

The report records one adjustment. Because `.venv/` is now ignored, test (h)'s `.venv/x` never reaches `git clean`. To pass (h), the builder also deletes the ignored files the checks created, found by comparing `git status --ignored` before and after. That makes (h) pass. It is not a defect for this merge, but it goes further than it should; see Owner attention (1).

Ledger: D1 — PASS — `# tests 168` / `# pass 168` / `# fail 0` / `# skipped 0` (Linux); `stack.test.mjs` (a)–(h)
Ledger: D2 — PASS — `manifest up to date (117 files)`
Ledger: D3 — PASS — `61 identical, 40 changed (E03, E06, E19, E11, E12, E17, E23a, E15, P1, E18, E02), 16 added (E23a, E02, E19, E06, E15, E18, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-48` ×1
Ledger: D5 — PASS — staged `run-all.mjs` exit 0, `guard:manual    PASS  (101 names checked)`
Ledger: D6 — PASS — `true` ×8
Ledger: D7 — PASS — `node --check` is clean
Ledger: D8 — PASS — run `40029417068` on `e5d34ff`: success

Scope: in the fence (v2), plus the ignored-file deletion explained above.
Method (payload changes only): no non-waivable rule is weakened; nothing the checks create reaches a commit. PR-48 is at the live maximum, and the manual is updated.
Owner attention:
- (1) **Follow-up, carried by E20 as its Stage 0.** Ignored files are never committed, so deleting them is unnecessary. It can also remove files the checks' own `install` just wrote into `.venv/`, partly breaking the environment for the rest of the job. The Node path never touches `node_modules/` or `.next/`. E20 removes the ignored-file deletion. Test (h) then asserts:
  - `app-bin` is gone;
  - `.venv/x` stays, and is ignored;
  - `git status --porcelain` prints nothing.

  This was my fence's defect: v2's (h) asked for `.venv/x` to be gone.
- (2) **Your order, 2026-10-24.** Keep the current steps, and run no real end-to-end test until every other step is done, right before the Control Tower link. In the ledger, E21 moves to just before E09. The order after E19 is now: E20, E22, E08, E14, E23b, E21, E09, E10.

Commit message: E19: checks follow the stack — toolchain, manifest and commands per stack, Python (uv), Go and Dart (Flutter) run, toolchain setup in the cycle and ci.yml, toolchain .gitignore (PR-48) — PASS a2
Next prompt: dev/fences/E20.md
