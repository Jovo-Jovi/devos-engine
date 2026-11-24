MERGE

VERDICT: PASS
Fetched: HEAD @ 35f8de0 (`E81: adopt - letter case, crash rounds, try again, agent lists - attempt 1`) + working tree
clean · Commands run: D1 (the full suite, here), D2–D6 and D8 on Linux, D7 through `gh run view` · Refused calls: none

Attempt 1 copied the 19 package files and wrote the report; nothing else. It is version 1.13.13. The change:
- **Names that differ from DEV_OS's only in letter case**, found in git's own list on every system (`caseClashes`).
  learn-coptic's committed `docs/decisions.md` and `docs/glossary.md` go aside under their own names after the same
  single yes, as `git mv` in the first commit of `devos/adopt`; nothing leaves the checkout. A folder in other case, a
  file DEV_OS merges into, or a name tracked in both cases stops, with the two `git mv` that fix it.
- **A guard that crashes on a document under `docs/` or `devos/`** is the next documents round's input
  (`documentCrashes`), instead of a stop after the rounds.
- **A try again after a stop.** The brief and the answers (`brief/given.json`, kept once DEV_OS is about to be written)
  stay, and the last line names `devos adopt --install`. That run asks **Use the brief anyway?** after new commits and
  **Use them again?** for the answers. The page's stop screen offers **Try again from the brief** and **Start over with
  a new brief**.
- **The agents' lists** mark `listed by your account` and `effort asked next`, drawn as badges on the page. A note under
  the reviewer list says where each list comes from and that the keys are asked at the Keys step. A model typed without
  its marks is still found.

Review depth (risk 3, deep). The reviewer wrote the package and rehearsed it on a copy of `main` @ a4d7006. This check
proves the copy and reruns the evidence:
- D3 on the branch: every file the builder's commit changed equals `dev/fences/E81/files/`, and each equals the
  rehearsed tree.
- I read every changed line again (`git diff a4d7006 35f8de0`):
  - `lib/adopt.mjs`: `caseClashes`, `MERGED_IN`, the case pass in `adoptBlocks` and its skip in the moves loop,
    `moveNote` in the four places a move is shown, `sameMoves`, `documentCrashes` in `checkAdoptDocs`, the `since`
    check, `askGiven` and `given.json`, the retry line in `drop`;
  - `lib/init.mjs` (`MODEL_MARKS`, `agentListNote`), `lib/menu.mjs` (`matches`), `lib/ui-server.mjs` (`install`),
    `lib/ui/app.js` (`startAdopt`, the stop screen, `MODEL_BADGES`);
  - the README, the changelog, and the tests: (v), (ai), (aj), (ak), (n), the server's `install: "yes"` and the stub mode.

  Two choices hold up under the deep read. `given.json` is written only after the handover's tasks are accepted, so a
  declined run (adopt-handover (c)) leaves nothing to reuse. A stop before the brief is kept sends no `stopped`
  marker, so the page offers no try again there.

The builder changed nothing under `dev/fences/`, `dev/reviews/`, `dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/`
(`git diff --quiet d6becc7 35f8de0` on each).

Ledger: D1 — PASS — two runs:
- **Here, the full suite on Linux:** `# tests 693`, `# pass 693`, `# fail 0`. Afterwards
  `git status --porcelain test/fixtures` printed nothing.
- **The builder's Windows run:** tests 693, pass 651, fail 0, skipped 42, as the fence says. So the five new tests,
  learn-coptic's case (ai) among them, pass on a system where the two names are one file.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (360 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `19 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (367 files scanned)`
- `guard:manual PASS (135 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.13`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `engine-ci` run 45490834216 on 35f8de0 (push, attempt 1): `checks` success,
`test (ubuntu-latest)` success.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists 42 paths before this review, and only these:
- the 19 paths of S1;
- `dev/reports/E81.md`;
- the 20 files of `dev/fences/E81/` (the 19 and `before.json`);
- the reviewer's files: `dev/LEDGER.md` and `dev/fences/E81.md`.

This review adds itself.

Scope: in fence. The porcelain count printed `19 modified, 0 new, 0 other`. D6 ran as the fence allows: the 1.7.7
Windows binary in `%TEMP%`, its zip hash checked against the release's checksums, through Git bash. The report has no
key, token or private path.

Method (payload changes only): none. No file under `payload/files/` changed; `payload/manifest.json` changes only
`engine_version`. No precedent, no manual row.

Owner attention:
- **learn-coptic needs a new brief.** The brief kept before E81 holds your answer "keep the lower-case names", which no
  longer applies, and its moves (two untracked files) differ from E81's (two case moves), so `--install` from it stops.
  On the guided page choose **Existing project** and write a new brief.
- After that adoption's merge, your `docs/decisions.md` and `docs/glossary.md` are in `docs/before-adopt/`. DEV_OS's
  `docs/DECISIONS.md` and `docs/GLOSSARY.md` take their place, with what holds carried over.
- A try again writes the documents again (about 20 minutes); keeping them was left out of scope.

Commit message: E81: adopt — letter case, crash rounds, try again, agent lists (1.13.13) — PASS a1
Next prompt: none (no next task in the ledger)
