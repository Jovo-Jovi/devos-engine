VERDICT: FAIL — FIX
Fetched: task/E19 @ d799c2b (clean tree), main @ f8eb207 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/verify-source.mjs --tower ../devos-sources/tower`, `node tools/find-specifics.mjs --check`, the D4 count and `includes` check, the seven D6 Buffer compares, `gh run list --branch task/E19`, a staged reproduction (below), and `git diff origin/main...HEAD` read in full · Refused calls: none

This is the remote check of E19 a1 (risk 3, a method change; the review of record).
- **The build follows the fence.**
  - The catalogue and defaults match their fence copies, and `devos init` writes `stack`.
  - Non-Node stacks print the note, and their module menus have no Supabase, R2, Firebase or Vercel.
  - `run-checks.mjs`: the Node path is untouched; the non-Node path runs `install` first and then `stack.commands`; `--install-only` works.
  - Both workflows gain the four toolchain steps, and the cycle runs `--install-only` before the builder.
  - The rules, skills, README, PR-48 and the manual edits are in place.
- **The two adjustments in the report are fine:**
  - the defaults were copied in Stage 1;
  - test (c) drops `stack.$comment`, because the merge keeps the defaults' `$` keys.

Every Done-when row passes, but reading the non-Node path turned up one real defect.

Ledger: D1 — PASS — `# tests 167` / `# pass 167` / `# fail 0` / `# skipped 0` (Linux)
Ledger: D2 — PASS — `manifest up to date (117 files)`
Ledger: D3 — PASS — `62 identical, 39 changed (E03, E06, E19, E11, E12, E17, E23a, E15, P1, E18, E02), 16 added (E23a, E02, E19, E06, E15, E18, E12, E17, E11), 2 removed (E03) — Jovo-Jovi/devos-control-tower@a49ca6d`; specifics `0 0`
Ledger: D4 — PASS — `Live maximum: PR-48` ×1, `includes` → `true`
Ledger: D5 — PASS — not re-run separately: no new script, variable, label or command; the staged run in the reproduction shows guards PASS
Ledger: D6 — PASS — `true` ×7
Ledger: D7 — PASS — `node --check` is clean
Ledger: D8 — PASS — run `40027138224` on `d799c2b`: success

**FIX 1 — a non-Node project's checks leave their output in the tree, and the cycle commits it.**
- **What the Node path does.** It records `before = changedPaths()`. After the checks, it restores tracked files the checks changed, and removes new files they created (`checks_modified_tracked_files`).
- **What the non-Node path does.** It returns before that block, so nothing is cleaned.
- **Reproduction** (staged project with a Python `stack`, a `pyproject.toml`, a `build` command that writes `.venv/x` and `app-bin`; all checks PASS): `git status --porcelain` then shows `?? .venv/` and `?? app-bin`.
- **The consequence.** In the cycle, the review step runs `git add -A` and commits that output. Real toolchains create it every run: `uv sync` makes `.venv/`, `go build ./...` makes the binary of a single-main project, Python leaves `__pycache__/`, and `uv build` makes `dist/`.
- **The fence's share.** It did not ask for the restore, so this is partly the fence's defect.

**FIX 2 — the installed `.gitignore` knows only Node output.**
- `--install-only` runs `uv sync` before the builder, so `.venv/` sits in the tree when the runner's builder commit runs `git add -A`.
- The method's `.gitignore` must ignore the Python, Go and Dart toolchain output.

Scope: in the fence.
Method (payload changes only): no non-waivable rule is weakened, PR-48 is at the live maximum, and the manual is updated. The two fixes protect "the runner owns git": nothing the checks or the toolchain produce reaches a commit.
Owner attention:
- (1) **Unproven on real runners.** The toolchain actions (`astral-sh/setup-uv@v6`, `actions/setup-go@v5`, `subosito/flutter-action@v2`) and the real commands (`uv`, `go`, `flutter`) have not run on a GitHub runner. E21's real run covers one stack; a second stack (Python or Go) is worth adding to it.

Next prompt: dev/fences/E19.md (v2, `### Attempt 2 focus`)
