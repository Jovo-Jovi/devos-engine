VERDICT: PASS — MERGE
Fetched: task/E22h @ 315e886 (clean tree), main @ aa42106 · Commands run: `node --test "test/*.test.mjs"`, `node tools/build-manifest.mjs --check`, `node tools/find-specifics.mjs --check`, the D3 Buffer compare, `node bin/devos.mjs --version`, the two D4/D5 `grep -c` lines, the staged guards (E24's D5 procedure), `gh run view 40134302912`, `git diff --name-only main...HEAD` · Refused calls: none

This is the remote check of E22h a1, the review of record. It is risk 3 and a method change (PR-53):
- **Only the chosen agents and models** in the cycle, intake, revise, doctor and supervisor workflows, with no fallback model and no cross-agent fallback;
- **only the chosen modules** in the setup check and at `devos init`;
- **a valid config without `reviewer_light`**;
- **a README for every new project**.

The 34 copies are byte-identical to `dev/fences/E22h/files/`. They are my texts, read line by line when I wrote and rehearsed them on `main` @ aa42106. The rest of the diff is the rebuilt manifest and the report.

Ledger: D1 — PASS — `# tests 257` / `# pass 257` / `# fail 0` (Linux), naming `chosen.test.mjs` (a) to (f). CI `test (windows-latest)` success; the report gives 11 skips there: (d), (e) and the nine existing ones.
Ledger: D2 — PASS — `manifest up to date (158 files)` · `0 0`
Ledger: D3 — PASS — `34 files, 0 differ`
Ledger: D4 — PASS — `devos 0.2.1` · `1` · `guard:manual    PASS  (106 names checked)`, guards exit 0
Ledger: D5 — PASS — `1` (the conditional Claude Code install) · `0`
Ledger: D6 — PASS — run `40134302912` on `315e886`, attempt 1: `checks`, `test (ubuntu-latest)` and `test (windows-latest)` success
Ledger: D7 — PASS — the 34 paths, `payload/manifest.json`, `dev/reports/E22h.md`, and the reviewer's `dev/LEDGER.md` and `dev/fences/E22h*` from 1bc4e58
Scope: in fence. The report's deviations are harmless: Git's `grep.exe` on PowerShell, and `README.md` staged by hand (D3 proves its bytes).
Method (payload changes only):
- **Rules checked.**
  - The human gates are unchanged: PR-08, the gate on a method fix, and a deep review for every method fix.
  - The role surfaces are unchanged. The new `cursor-planner` kit denies product code, method files, git writes, `gh` and the network. `guard-surfaces.mjs intake|revise` still reverts anything outside the intake or revise surface after a planning run.
  - The red check still overrides PASS.
  - Secrets go only through step env to `accounts.sh`. Nothing prints a key.
  - The runner still owns git.
- **Precedent PR-53** (live maximum PR-53). It amends PR-28's method-fix review model.
- **The manual** names `plan-agent.sh`, `cursor-planner`, the doctor and supervisor limit, and `loop.mjs`'s refusal.
Owner attention:
- **The builder committed and pushed at your request.** The method's rule is that the runner and the owner own git. Keep that for the next tasks.
- **A known limit:** the gate doctor's and supervisor's AI second opinion runs only when Claude Code is the reviewer agent. With Cursor they report from their fixed rules.
- **`loop.mjs`** (the local loop) refuses a project whose agents are not Cursor and Claude Code.
Commit message: E22h: only the agents, models and modules the project chose in every workflow — no Claude unless chosen, no fallback model, a limit switches to the same tool's other account then waits, intake and revisions on the reviewer agent (plan-agent.sh); a README for every new project; engine 0.2.1 (PR-53) — PASS a1
Next prompt: none — the owner starts a new project with `devos ui`. Its first run's findings become the next fence.
