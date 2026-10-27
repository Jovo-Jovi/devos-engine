MERGE

VERDICT: PASS
Fetched: `task/E27` @ cf7abc6 (no uncommitted changes; `main` @ a5d898e, E26c1 merged) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git diff --stat aac8333 HEAD`, `git diff aac8333 HEAD -- dev/fences dev/LEDGER.md`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22.23.4), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4, D5 (engine-ci run 40494563964 and its jobs), the attempt-1 report · Refused calls: none

E27 adds "Before you start a project" (`docs/PROJECT-CHECKLIST.md`), and the README links to it from *Requirements* and *Create a project*. The page has ten sections, in the order the setup asks, and ends with a worksheet to copy. Its lists come from the engine's own data:
- the types, stacks, modules, providers and documents: `lib/data/catalogue.json`;
- where each key comes from: `lib/keys.mjs`;
- the service settings: `payload/files/devos/setup.json`.

It names keys only, never a value, and makes no legal claim. This is a light review (risk 1, documentation only). The 2 copied paths are byte-identical to the package (D3), which I wrote and checked against those sources. The builder's commit adds only its report, which I read, and leaves the fence and the ledger as I wrote them.
Ledger: D1 — PASS — my run on Linux: `tests 362`, `pass 362`, `fail 0`, `skipped 0`; `consent`, `licences` and `privacy` pass. The builder's report on Windows: `tests 362`, `pass 347`, `fail 0`, `skipped 15` (E26c1's skips).
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `2 files, 0 differ`.
Ledger: D4 — PASS — `2 links`.
Ledger: D5 — PASS — engine-ci run 40494563964 on cf7abc6, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 8 paths:
- `README.md` and `docs/PROJECT-CHECKLIST.md`;
- `dev/reports/E27.md`;
- the reviewer's `dev/LEDGER.md`, `dev/fences/E27.md`, `dev/fences/E27/before.json` and the 2 package copies.

Nothing else. This review and the ledger row are added after it.
Scope: in fence. No change to `payload/`, `package.json`, the version or `CHANGELOG.md`.
Method (payload changes only): N/A.
Owner attention:
1. **Read it once** on GitHub: the README's two links open the page.
2. **Next: E26c2.** It edits each role's next models by pull request and updates section 9 of this page. Its fence comes on `task/E26c2` from `main` after this merge. Release 1.2.0 after E26c2.

Commit message: E27: Before you start a project — docs/PROJECT-CHECKLIST.md, every decision, piece of information, file and key the setup asks for, with a worksheet; linked from the README — PASS a1
Next prompt: E26c2's fence, on `task/E26c2` from `main` after this merge (its ledger row: "fence on PASS of E26c1").
