REMOTE: FAIL confirmed — FIX (fence v4)
Fetched: origin/task/E12 @ 2b561c2 (base main @ 7869ec7). Attempt 1's code is uncommitted on the owner's machine, so this check covers the local verdict and the reissued fence, not the code. Read: `dev/reviews/E12-a1.md`, `dev/fences/E12.md` v3, `payload/files/scripts/devos/review-mode.mjs` lines 30–44 on main.

The local deep review is sound. Defect 1 (a reviewer limit walking the builder pool can hand the review to the attempt's own builder) breaks the role separation; defect 2 (`changed` counted before the kit is restored) would keep a stuck Claude slice alive up to `max_time_slices`; defect 3 is the fence's: `review-mode.mjs` line 38 returns `gate_model` for every gated or method row, so a Cursor reviewer of a risk-3 task would get a Claude id. The v3 attempt-2 items 1–6 fix all three without touching `review-mode.mjs`.

Owner attention resolved in v4:
- (a) PR-28 stays: a method fix is always reviewed by Claude Code with the gate model, whatever the project reviewer is; without a Claude credential the method fix stops with a clear error (item 7). Method fixes change the automation itself and always wait for the owner's merge, so the strongest review stays mandatory there.
- (d) The Claude builder's `CLAUDE.md` names the report skill by path (item 8).
- (b) Claude builder progress is judged by the tree and CPU only (json output) — accepted for v1; ledger follow-up: `--output-format stream-json --verbose` with the usage parser adjusted, in a later task.
- (c) The Cursor reviewer kit is a deny-list under `--force`; `guard-surfaces.mjs reviewer` stays the backstop, as for the native Cursor builder — accepted.
- (e) Next-agent Cursor run with the family id — accepted (the CLI takes the family id).
- (f) Delete the staged folder in your temp directory.

Next prompt: dev/fences/E12.md (v4, Attempt 2 focus items 1–8).
