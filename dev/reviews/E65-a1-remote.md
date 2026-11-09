MERGE

VERDICT: PASS
Fetched: HEAD @ a2bb182 (`E65: adopt - every AI tool fenced as far as it allows; one list of secret files -
attempt 1`) + working tree clean · Commands run: D1–D6 and D8 on Linux, D7 through `gh run view` and `gh api` ·
Refused calls: none

E65 attempt 1 copied the package of v1 byte for byte: 8 changed files and 1 new one, plus the report.
- **The package:** an adoption's AI tool is kept to reading and writing files, as far as each tool allows:
  - Claude Code: no shell (Bash or PowerShell), web, MCP, project settings or project `CLAUDE.md`; reads kept to its
    folder; 2.1.257 or later.
  - Cursor: no shell, web or MCP.
  - Gemini: an admin policy with no shell, web page or web search.
  - Codex: unchanged.
  - Claude Code and Cursor: no secret file read.
- **devos does the rest:** it writes `devos.config.json` itself after each document round. A project's own tool
  configuration stops the adoption, and a brief round's leftovers are removed before the next. One `SECRET_GLOBS` list
  drives adopt, the read denies and the shipped `.gitignore`.
- **Who wrote it:** the reviewer, rehearsed on a copy of `main` and on this branch. Two independent reviews found 14
  defects and 4 nits; each is fixed and tested or reported as a limitation.

Review depth (risk 2): every row was rerun here, and the copied files equal the package (D3), so every changed line is
the reviewed line; I read them all again in `git diff main...HEAD`. The builder changed nothing under `dev/fences/`,
`dev/LEDGER.md`, `CLAUDE.md`, `.claude/` or `.cursor/` (`git diff --quiet 173f0d0 a2bb182` on them).

Ledger: D1 — PASS — `node --test "test/*.test.mjs"` on Linux:
- `# tests 638`, `# pass 638`, `# fail 0`;
- the 7 tests of `adopt-tools.test.mjs` and adopt-install (ad) and (ae) are all `ok`;
- `git status --porcelain test/fixtures` printed nothing.
The builder's Windows run: tests 638, pass 606, skipped 32, fail 0, as v1 says.
Ledger: D2 — PASS — `node tools/build-manifest.mjs --check` → `manifest up to date (355 files)`;
`node tools/find-specifics.mjs --check` → `0 0`.
Ledger: D3 — PASS — the byte compare → `9 files, 0 differ`.
Ledger: D4 — PASS — the staged guards printed exactly the fence's lines, `exit 0`:
- `guard:secrets PASS (362 files scanned)`
- `guard:manual PASS (134 names checked)`
- `guard:config PASS (generated config is current)`
- `guard:skills PASS (29 skills checked, 20 vendored)`
- `guard:media N/A (no devos/answers.json)`
Ledger: D5 — PASS — `node bin/devos.mjs --version` → `devos 1.13.0`.
Ledger: D6 — PASS — actionlint 1.7.7 `-color -shellcheck= -pyflakes=` on both workflow folders → `exit 0`.
Ledger: D7 — PASS — `gh run view 42671075690` → `headSha a2bb182`, `conclusion success` at attempt 3; jobs
`checks` success, `test (ubuntu-latest)` success.
- Attempts 1 and 2 failed through no fault of this change. GitHub's "Incident with Actions and Checks API"
  (critical, opened 18:12 UTC) kept the `checks` job from being created in attempt 1 (18:06; `test` was green), and
  every job in attempt 2 (18:26).
- `engine-ci.yml` is unchanged, and the `checks` job's commands are D2 and D6, which passed here.
- The fence asks for green "on the first run"; I read that as no job of this change ever running red, which holds. I
  say so here rather than reconcile it silently.
Ledger: D8 — PASS — `git diff --name-only main...HEAD` lists only:
- the 9 paths of S1;
- `dev/reports/E65.md`;
- the 10 files of `dev/fences/E65/` (the 9 and `before.json`);
- the reviewer's files: `dev/LEDGER.md`, `dev/fences/E65.md` and this review.

Scope: in fence. The report's deviations are the owner's shell only: PowerShell, so the git commands ran one by one
and the actionlint globs were expanded through Git bash; and actionlint as the Windows binary of 1.7.7, its zip's
checksum matching the release's `checksums.txt`.

Method (payload changes only): the one payload file is `payload/files/dot-gitignore`, whose secret-file section now
lists the whole `SECRET_GLOBS`. No method rule, workflow, precedent or manual name changes, so no precedent row is due
and `guard:manual` is unchanged (134 names). Non-waivable rules, none weakened: no secret goes in a file (more secret
files are ignored); human gates, role surfaces, a red check over a PASS, and the runner owning git are untouched.

Owner attention:
- **D7 needed a rerun because GitHub was down,** not because of anything in E65: see D7. The fence's "first run" was
  meant to catch a flaky test, and none ran red.
- **Codex and Cursor can still read files outside the project** (limitations 1 and 3); the CHANGELOG tells you to
  adopt an untrusted project with Claude Code.
- **Untried on the real tools** until the live tests: Gemini's `--admin-policy`, Cursor's `Shell(*)`, `WebFetch(*)` and
  `Mcp(*:*)`, and Claude Code's `claudeMdExcludes`. The fence's "For the owner, after the merge" says what to check.
- **A project whose `.gitignore` is its own** (every adopted one) gets the new secret lines as a conflict in its next
  upgrade pull request, to add by hand.

Commit message: E65: adopt — every AI tool fenced as far as it allows; one list of secret files (audit H2, L1) — PASS a1
Next prompt: none. E66's fence is issued after E65's merge, on your word, as E65's was.
