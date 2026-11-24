MERGE

VERDICT: PASS
Fetched: HEAD @ a747cc5 (`E80: adopt moves aside the files git does not track - attempt 1`) + working tree clean ·
Commands run: D1 (the full suite, here), D2–D6 and D8 on Linux, D7 through `gh run view` · Refused calls: none

Attempt 1 copied the 14 package files and wrote the report; nothing else. It is version 1.13.12. The change:
- **One yes for every file with DEV_OS's names.** A file git ignores or does not track (learn-coptic's
  `docs/DECISIONS.md` and `docs/GLOSSARY.md`) is a move, `{ from, to, untracked: true }`, in the same plan as the
  committed ones: the survey, the terminal question, the page's card and `--move-aside`. The "not committed" stop is
  gone.
- **Its content on `devos/adopt`.** The move-aside commit adds a copy of each, with `git add -f`, in
  `docs/before-adopt/`. `adopted.aside` keeps `untracked: true`.
- **The original leaves the checkout once DEV_OS is committed**, for `~/.devos/adopt/<owner>__<repo>/before-adopt/`:
  byte for byte, only when its sha256 is the one committed, never over an earlier kept file, so the pull of the merge
  cannot overwrite it. A changed file stays, with a line saying to move it before the pull.
- An untracked folder or link with one of DEV_OS's names still stops, and says to move it out.
- **The guided page's adopt screen** shows the tool, model and effort pickers with nothing picked. **Write the brief**
  waits for all three and sends `agent` and `effort`.

Review depth (risk 2). The reviewer wrote the package and rehearsed it on a copy of `main` @ eaaf870. This check proves
the copy and reruns the evidence:
- D3 on the branch: every file the builder's commit changed equals `dev/fences/E80/files/`, and each equals the
  rehearsed tree.
- I read every changed line again (`git diff eaaf870 a747cc5`): `lib/adopt.mjs` (`adoptBlocks`, `plainProjectFile`,
  `keepAside`, `freePath`, `resetStaging`, `keptLine`, the move step and the keep step in `adoptInstall`,
  `adoptPullBody`, `asideStop`), `lib/ui/app.js` (`adoptPicked`, the pickers, the disabled button, the request body),
  the README, the changelog, `adopt.test.mjs` (u), `adopt-install.test.mjs` (ah), `ui-page.test.mjs` (m) and the five
  version-only test files.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet 25ac8e4 a747cc5` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite on Linux:** `# tests 688`, `# pass 688`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run:** tests 688, pass 646, fail 0, skipped 42, as the fence says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `14 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.12`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 45400927098 on a747cc5 (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 32 paths before this review, and only these:
- the 14 paths of S1;
- `dev/reports/E80.md`;
- the 15 files of `dev/fences/E80/` (the 14 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E80.md`.

This review adds itself.

Scope: in fence. The porcelain count printed `14 modified, 0 new, 0 other`. The report's one deviation is how D6 ran:
`actionlint` was not on `PATH`, so the builder used the 1.7.7 Windows binary already in `%TEMP%`, whose zip hash it
checked against the release's checksums, through Git bash for the globs. The same command exits 0 here and in
`engine-ci`, so D6 stands. The report has no key, token or private path.

Method (payload changes only): none. No file under `payload/files/` changed; `payload/manifest.json` changes only
`engine_version`. No precedent, no manual row.

Owner attention:
- **After an adoption with ignored files, they are no longer in the project folder.** Their content is in
  `docs/before-adopt/` once you merge `devos/adopt`. The originals are in
  `~/.devos/adopt/<owner>__<repo>/before-adopt/`, which a new brief never clears. Delete either when you no longer
  need it.
- Your `.gitignore` still lists those files. The adoption's "committed although your .gitignore leaves them out" line
  names DEV_OS's files it forced; narrow the `.gitignore` so later upgrades keep them.

Commit message: E80: adopt moves aside the files git does not track (1.13.12) — PASS a1
Next prompt: none (no next task in the ledger)
