REMOTE: MERGE
Fetched: origin/task/E04 @ 71d5fab (base main @ 474036c) · Node v22.22.0 · Commands run: node --test "test/*.test.mjs"; node bin/devos.mjs; DEVOS_HOME=<empty> PATH=<empty> node bin/devos.mjs doctor; node --check on bin/devos.mjs, lib/*.mjs, test/command.test.mjs; git status --porcelain; git diff --stat main...HEAD -- payload lib/paths.mjs test/version.test.mjs; every line of bin/devos.mjs, lib/which.mjs, lib/detect.mjs, lib/doctor.mjs, lib/profile.mjs, lib/roster.mjs.

D1 `# pass 31 / # fail 0`, names `command.test.mjs` and `devos --version prints devos 0.1.0`; D2 the eight usage lines, exit 2; D3 `devos: gh is not installed. Install the GitHub CLI, then run: gh auth login`, exit 1; D4 all `--check` exit 0; D5 nothing under `payload/`, `lib/paths.mjs` or `test/version.test.mjs`; D6 the owner's output: Claude probes exist and exit 0, `cursor missing` is correct (no Cursor CLI on that machine). Code reads correctly: commands resolve without a shell except Windows `.cmd`/`.bat`; the value-like pattern is anchored (`task-runner-app` accepted); the roster shape is strict and canonical; doctor warns on a same-model reviewer and fails only on `gh`.

Follow-up (ledger): `run()` hands a `.cmd` path to the shell unquoted, so a path containing a space would break on Windows; E12 quotes it, since the runner relies on `run()` there.

E11 fence v1 (written by the local review on this branch) is replaced by v2 in this commit — see the fence header for the four defects. Cross-role use is split into a new task E12 (ledger and PLAN §7a/§12 updated here); E05 now follows E12.

Merge: squash into `main` with `E04: devos command: doctor, status, developer profile, version, agent roster (PLAN §7a) — PASS a1`.
Next prompt: dev/fences/E11.md (v2) on a new branch `task/E11`.
