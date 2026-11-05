VERDICT: PASS
MERGE
Fetched: `task/E53c1` @ fd58e8f (`E53c1 a1: builder`), clean tree, over `main` @ 25309c9 · Commands run: D1 `node --test "test/*.test.mjs"`, D2 `node tools/build-manifest.mjs --check` and `node tools/find-specifics.mjs --check`, D3 the fence's byte compare, D4 the fence's staged-guard command, D5 `node bin/devos.mjs --version` and `node bin/devos.mjs help`, D6 `gh api repos/Jovo-Jovi/devos-engine/actions/runs/42036741101` and its jobs, D7 `git diff --name-only origin/main...HEAD` · Refused calls: none

E53c1 adds generation within a budget (PR-80). `scripts/devos/media.mjs` makes the planned items through
`media-providers/` (xAI first), with a budget of 0 by default (an estimate only), the key from the environment only,
files written through `.part` and checked by their signature, provenance and cost in the plan and in
`docs/usage/media.jsonl`, made once, retried on 429/5xx/network, and a started video resumed rather than paid twice.
`devos media` runs it locally, asks before it pays and never commits. The engine is 1.6.0. Risk 3, a method change,
deep review: every changed line is the fence's exact-file package, which the reviewer wrote and rehearsed on a copy
of 25309c9 (the generator against a stubbed fetch only: no key, no network). D3 proves the branch holds exactly
those bytes. The builder's commit changes the 23 files and its report only; the reviewer's files are as the fence
commit left them.

Ledger:
- D1 — PASS — Linux, Node 22: `# tests 515`, `# pass 515`, `# fail 0`; the ten `media-generate.test.mjs` tests are
  ok. The builder's Windows run: tests 515, fail 0, skipped 20, the allowed count.
- D2 — PASS — `manifest up to date (315 files)`; `0 0`.
- D3 — PASS — `23 files, 0 differ`.
- D4 — PASS — `guard:secrets PASS (322 files scanned)`, `guard:manual PASS (122 names checked)`, `guard:config PASS
  (generated config is current)`, `guard:skills PASS (29 skills checked, 18 vendored)`, `guard:media N/A (no
  devos/answers.json)`, `exit 0`.
- D5 — PASS — `devos 1.6.0`; the help lists `devos media [folder] [--budget <usd>] [--only <id,id>] [--yes]`.
- D6 — PASS — `engine-ci` run 42036741101 on fd58e8f, attempt 1, `success`: `checks` success, `test (ubuntu-latest)`
  success.
- D7 — PASS — 50 paths: the 23 of S1, `dev/reports/E53c1.md`, `dev/LEDGER.md`, `dev/fences/E53c1.md` and
  `dev/fences/E53c1/**`. Nothing else.

Scope: in the fence. No workflow, no `payload/files/devos/setup.json` and no setup condition change; no dependency.

Method (payload changes only):
- Non-waivable rules: none is weakened.
- Secrets never in files:
  - the key is read from the environment only;
  - it is scrubbed from every message and error;
  - test (b) proves it is absent from the output, the plan and the ledger.
- No agent sees the key, and the runner still owns git: `devos media` never commits, and the cycle does not run the
  script yet.
- Human gates and red-check-overrides-PASS are untouched.
- Precedent: PR-80 was added, and the live maximum is now PR-80.
- Manual: `AUTOMATION.md` §4 names `media.mjs` and `media-providers/`. `guard:manual` checks 122 names.

Owner attention:
- **The xAI documentation shows JPEG images only,** so the generator saves `.jpg` and refuses, before paying, an
  image the plan names `.webp` or `.png`. `DESIGN_METHOD.md` §8 now says so, which steers new blueprints. Mawsim keeps
  its own image list (`content/photos.json`, OD-10); its change request after E53c2 decides how it moves to the plan.
- **No real call was made in this task.** The first paid run is yours, by `devos media <folder> --budget <usd>`
  with the key exported in your shell.

Commit message: E53c1: generate planned media within a budget, made once, xAI first; devos media; engine 1.6.0 (PR-80) — PASS a1
Next prompt: E53c2 is fenced on `task/E53c2` from `main` after this merge (its row: fence on PASS of E53c1).
