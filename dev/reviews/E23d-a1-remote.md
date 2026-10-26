MERGE

VERDICT: PASS
Fetched: `task/E23d` @ 076347d (no uncommitted changes) · Commands run: scope listing (`git diff --name-only main...HEAD`, `git diff --stat f05650f 076347d`), D1 (`node --test "test/*.test.mjs"` on Linux, Node 22), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4 (version, PR-60 count, staged guards), engine-ci runs 40297104113 (076347d) and 40295481190 (`main` @ 541a654) with their jobs and the Windows job's log · Refused calls: none

E23d lets the onboarding take every document and full-quality design image the developer has.
- **Documents:** two new kinds, wireframes or user flows (`flows`) and similar products (`similar`); each type's list was reviewed.
- **Limits:** text up to 1 MB; PDF up to 20 MB; PNG, JPEG, WebP and GIF up to 20 MB; 30 files and 200 MB in all.
- **Upload:** one file per request through `POST /api/file`, under the run's token, host and origin checks.
- **Naming:** advice in the page and the terminal.
- **The rest:** the blueprint reads PDFs and images, with DESIGN_METHOD §5.4, AUTOMATION §6, PR-60 and version 0.2.8.

This is a standard review: risk 2, payload text, no rule removed. The 19 copied paths are byte-identical to the package (D3). I wrote and read every line of that package before issuing the fence. The builder's commit adds only `payload/manifest.json` (rebuilt by S2, 5 lines, identical to the rehearsal) and its report, which I read. The branch also carries the owner's merge of `main` (f05650f), as the fence asked.
Ledger: D1 — PASS — my run on Linux: `tests 301`, `pass 301`, `fail 0`. `ui-server.test.mjs (z) attachments are sent one by one at full quality, and a plan names what was sent (PR-60)`, `plan.test.mjs (h)` and `init.test.mjs keeps a GIF with the design references and a PDF with the documents (PR-60)` are `ok`. The builder's report on Windows: `tests 301`, `pass 290`, `fail 0`, `skipped 11`.
Ledger: D2 — PASS — `manifest up to date (308 files)`; `0 0`.
Ledger: D3 — PASS — `19 files, 0 differ`.
Ledger: D4 — PASS — `devos 0.2.8`; `Live maximum: PR-60` → `1`; staged guards exit 0 with `guard:manual    PASS  (111 names checked)` and `guard:config    PASS  (generated config is current)`.
Ledger: D5 — PASS — engine-ci run 40297104113 on 076347d, run attempt 1: `checks` (7 s) and `test (ubuntu-latest)` (2 min 18 s), both `success`, and no Windows job.
Ledger: D6 — PASS — `git diff --name-only main...HEAD` lists 42 paths:
- the 19 copied paths and their 19 package copies;
- `payload/manifest.json` and `dev/reports/E23d.md`;
- the reviewer's files: `dev/fences/E23d.md` and `dev/fences/E23d/before.json`.

Nothing else.
Scope: in fence. No dependency added. The server's token, host and origin checks are unchanged and cover `POST /api/file`. SVG and HEIC are refused.
Method (payload changes only): no non-waivable rule is weakened. Gates, role surfaces, a red check overriding PASS, secrets never in files and the runner owning git are untouched. The blueprint prompt only reads more file kinds and keeps their names. PR-60 is the next id. `AUTOMATION.md` §6 states the formats and limits (`guard:manual` 111 names).
Owner attention:
1. **`main` after E23b3 is green in all three jobs** (run 40295481190).
   - The Windows tests took 14 min 18 s (`duration_ms 856737`) against 25 allowed.
   - Running four files at a time helped Linux (1 min 57 s on `main`, about 3 min before) but not Windows. There the tests are CPU-bound: their durations add up to 3,158 s, so the four files ran at once and each ran slower.
   - The slowest files are the full `devos init` flows: `init`, `continue`, `setup`, `ui-server`.
2. **Minutes from now on.** About 36 counted minutes per task: a task branch about 4, the merge to `main` about 33, most of it Windows. Before E23b3's change it was about 100.
3. **E21 uses real repositories.** If they are private, every `devos-cycle` run spends the same account's minutes. Its fence says how to keep that cheap.

Commit message: E23d: the onboarding takes every document and full-quality design image, each named for what it holds; engine 0.2.8 (PR-60) — PASS a1
Next prompt: dev/fences/E21.md (v1, on `task/E21`)
