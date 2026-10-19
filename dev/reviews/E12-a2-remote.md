REMOTE: FAIL confirmed — FIX (fence v6)
Fetched: origin/task/E12 @ e184d2e (base main @ 7869ec7), attempt 2 code included · Commands run: a YAML parse (PyYAML `safe_load`) of every `payload/files/dot-github/workflows/*.yml` on the branch and of `devos-cycle.yml` on main; a scan for column-0 lines and heredocs in `devos-cycle.yml`; a parse of a scratch copy with lines 238–254 indented by 10 spaces.

Branch: every workflow parses except `devos-cycle.yml` — `line 239, column 1` (the node heredoc of step `bm` at column 0 ends the `run: |` block). Main's version parses. The heredoc is the only column-0 block in the file. With fence item 1 applied to a scratch copy the whole file parses (jobs `resolve`, `cycle`, `wait-and-resume`; 37 steps) and the block scalar hands bash the body and the `EOF` terminator at column 0 — the fix is right and complete.

Fence defect fixed in v6: B1 described attempt 2 as uncommitted, but in the branch flow the owner commits each attempt before the remote check. B1 now expects the two commits and a clean tree.

Process gap (ledger): nothing in the engine parsed a workflow before this check — the local review and the builder had no YAML parser (zero dependencies), and E03/E11 relied on reading the diff. Proposed task E13 (small, before E05, which rewrites install paths and touches workflows again): an engine-repo CI on every push of `main` and `task/*` that runs `node --test`, parses every payload workflow with a real YAML parser and runs actionlint. It lives in the engine's own root `.github/` (not the payload) and is removed from the release tree by D-E10.

Next prompt: dev/fences/E12.md (v6, Attempt 3 focus).
