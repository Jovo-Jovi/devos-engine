FIX: in `lib/adopt.mjs`, the copy for the AI tool leaves out environment files other than an example one and private keys, and the survey names any it finds as a note; `test/adopt.test.mjs` (b) and (g) prove it; README and CHANGELOG say so. The exact files are in `dev/fences/E34/files/` (fence v2).

VERDICT: FAIL
Fetched: `task/E34` @ d56688e (no uncommitted changes; `main` @ beef5ca) · Commands run: scope listing (`git diff --name-only main...HEAD`), the builder commit against the fence (`git show --stat HEAD`, `git diff --stat 024c429 HEAD -- dev/fences dev/LEDGER.md`), D2 (`build-manifest --check`, `find-specifics --check`), D3, D4, the manifest's diff, engine-ci run 41201527552, the attempt-1 report, and the deep review of every changed line of `lib/adopt.mjs`, `lib/init.mjs`, `lib/data/adopt-prompt.md` and `bin/devos.mjs` · Refused calls: none

E34 adds `devos adopt [folder]`. After the survey, the developer's own AI tool writes a brief of the project in `~/.devos/adopt/<owner>__<repo>/`, on a copy of the tracked files, and the developer types yes, a change or an empty line. The builder's attempt is exact: every *Done when* row it can run holds, and the 8 copies are byte-identical. The FAIL is the fence's own defect, found in the deep review that risk 3 asks for.
Ledger: D1 — PASS — the builder's report on Windows: `tests 397`, `pass 381`, `fail 0`, `skipped 16`; `adopt.test.mjs` (a)–(l) pass.
Ledger: D2 — PASS — `manifest up to date (310 files)`; `0 0`.
Ledger: D3 — PASS — `8 files, 0 differ`.
Ledger: D4 — PASS — `devos 1.4.0`; `1 Ready: no — this folder is the DEV_OS engine itself`.
Ledger: D5 — PASS — engine-ci run 41201527552 on d56688e, run attempt 1: `checks` and `test (ubuntu-latest)`, both `success`.
Ledger: D6 — FAIL — the scope is right: `git diff --name-only main...HEAD` lists the 8 paths, `dev/reports/E34.md` and the reviewer's files, 20 in all, and nothing else. The deep review's second question fails:
- **The defect.** `copyTracked` copies every tracked file into `workspace/`, the folder the AI tool reads.
  - A project that tracks a secret by mistake, such as `.env.local` or `certs/server.pem`, hands it to the tool.
  - Whatever the tool reads goes to its provider.
  - E33's survey never reads such a file, but E34's copy carries it.
  - Test (g) checked only an untracked `.env`, which git does not list anyway.
- **Why it blocks the merge.** `main` is what `npx github:Jovo-Jovi/devos-engine` runs, released or not. "Secrets never in files" is one of the method's non-waivable rules, and sending one to a model provider is worse.

The other points of the deep review hold:
- **Where the tool works.** It never runs in the project (`cwd` is the staging folder). The project's HEAD and status are compared after every round, before anything is shown or kept.
- **What reaches the tool.** `survey.json` drops the folder path, and nothing is sent anywhere by DEV_OS itself.
- **Claude Code's tools** are `Read,Glob,Grep,Write,Edit`, with `Bash,WebFetch,WebSearch` refused.
- **Cursor** writes `brief/**` only. Its later rounds read `adopt-next.md`, so the rules in `adopt-input.md` stay intact.
- **The exports from `lib/init.mjs`** change no behaviour.
Scope: in fence.
Method (payload changes only): N/A. No payload file changed.
Owner attention:
1. **The fix (fence v2):**
   - `secretFile()` names environment files other than `.env.example`, `.env.sample`, `.env.template` and `.env.dist`, plus `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore` and `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`;
   - `copyTracked` holds those back and counts them, and the start line says `(N held back: environment files and private keys)`;
   - the survey lists them in `secret_files` and adds the note `it tracks …, which may hold a secret: DEV_OS never reads or copies it`.
   - I rehearsed it on a clean copy: 397 tests, fail 0.
2. **A limit to know, not a defect.** The unchanged check sees tracked and untracked files, not ignored ones. A tool that wrote into an ignored path of the project would not be caught. The tool never runs in the project and is not told where it is, so this is defence in depth only. E36's install reviews it again.

Commit message: none (FAIL).
Next prompt: `dev/fences/E34.md` v2 on `task/E34`, with *Attempt 2 focus*.
