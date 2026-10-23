# DECISIONS — DEV_OS Engine

Every detail the specification did not pin down, resolved with the simplest option
that still meets the done-when list. Newest decisions may reference earlier ones.

## Configuration stage

1. **Local server port.** The UI listens on 127.0.0.1 at port 7788 (override with
   `DEVOS_PORT`). If the port is taken the server walks up to twenty ports.
2. **Machine profile.** `~/.devos/defaults.json` is the machine profile: saved model
   ids, visibility, and languages from the last project that chose "save these
   models as the default". Visibility defaults from it, otherwise private.
3. **Answer file location.** Before confirm the draft lives at `~/.devos/draft.json`.
   At confirm the finalized answers are written to `~/.devos/answers/<slug>-<ts>.json`
   and copied into the project as `devos/answers.json`. Neither contains secrets; a
   structural assert rejects any field that looks like a secret value.
4. **Configuration-model default.** The configuration model defaults to the reviewer,
   per the model questions. Sharing a tool and model id with the reviewer is fine:
   the *role* is what the automation locks, not the id.
5. **Repair rounds.** Up to 5 repair rounds; round 1 is automatic and its prompt
   includes the full guard report line by line. The round count and report are
   visible in the UI stream.
6. **Usage limits.** A usage limit is detected by adapter patterns (usage limit, rate
   limit, quota, 429, credit balance, out of credits). The tool's own message is
   shown, the phase says so, and `devos init --continue <folder>` resumes at the
   configuration model without re-asking questions.
7. **Prompt delivery.** Claude Code gets `claude -p --model <id>` with a permission
   kit (`--permission-mode acceptEdits` plus `--allowedTools` limited to file tools
   and `Bash(init_github:*)` / `Bash(request_secret:*)`). Cursor gets `agent -p
   --model <id>`; its sandbox confines it to the working directory. Codex gets
   `codex exec --model <id>`; Gemini, Muse, and GLM get `-p --model <id>`. The prompt
   is passed on stdin, except Codex, which takes it as an argument. Vendor flags may
   drift; `-p`/`--model` is the stable contract, and tests assert those.
8. **Restricted tools as PATH shims.** `init_github` and `request_secret` are the
   configuration model's only engine tools, provided as executable shims on a
   prepended PATH (`.cmd` twins written for Windows). No raw shell, git, gh, curl,
   wget, or rm is provided, and `GH_TOKEN`/`GITHUB_TOKEN` are stripped from the
   model's environment.
9. **Windows empty-line guard.** `request_secret` always inherits the real TTY and
   never passes `--body`, so no leftover empty line can become the secret; a piped
   stdin path does not exist in the code.
10. **Secret names recorded.** The engine records secret *names* with `set`/`missing`
    in `devos/state/secrets.json` — never values. The setup issue lists names only.
11. **Setup issue timing.** `init_github` creates the "Dev OS: setup needed" issue
    when required secret names are still missing, so the final screen can link it.
12. **init_github once.** State lives in `devos/state/init.json`; a second call is
    refused with "init_github has already run for this project. It runs once."
13. **YAML lint, not a YAML parser.** The guard uses a dependency-free structural
    lint: block scalars must indent, tabs fail, and a step body at column 0 inside a
    `run: |` block fails. A full parser was not needed for the done-when list.

## Models and tools

14. **Subgroups.** Cursor's screen shows Grok, Claude on Cursor, GPT on Cursor,
    Gemini on Cursor, Composer, plus an "Other families reported by the CLI" group.
    Prefix rules classify ids the CLI reports. Reported ids keep a
    "reported by the CLI" label; nothing is invented.
15. **Sign-in heuristic.** Tools with an auth probe run it (`claude auth status`,
    `codex login status`); others treat their credential env var (CURSOR_API_KEY,
    GEMINI_API_KEY, ZAI_API_KEY) as the sign-in signal. Only Node, git, and gh block.
16. **Primary secrets.** Claude exposes `CLAUDE_CODE_OAUTH_TOKEN` or
    `ANTHROPIC_API_KEY`; the Keys moment lists both names, the cycle workflow exports
    both, and whichever is set works. Cursor asks for `CURSOR_API_KEY`, Codex for
    `OPENAI_API_KEY`, Gemini for `GEMINI_API_KEY`, GLM for `ZAI_API_KEY` (the env
    name the CLI documents, recorded in its adapter).
17. **Custom tools.** "Add another tool" stores display name, command, model flag,
    version command, auth command, prompt template, secret name, and usage-limit
    pattern in the draft. No prompt template means "This computer only": allowed as
    the configuration model, never as the GitHub reviewer or builder.

## Automation

18. **Stage lock, not id lock.** `devos-cycle` refuses to run while
    `configurationModel.stage` is not `configuration-only`, and never runs a step in
    the configuration role. A reviewer that shares the configuration model's id is
    legitimate; the fence carries reviewer and builder roles only.
19. **Task branch.** One run is one attempt of one task on `task/Tnn`, recreated
    fresh from the base branch each attempt. Attempt numbering comes from the ledger
    row and the fence, whichever is higher, plus one.
20. **Verdict parsing.** `docs/reviews/Tnn-aN.md` must contain one `- [x] <row> —
    PASS|FAIL` line per done-when row and exactly one final `VERDICT:` line that
    agrees with the rows. An unparseable review fails the attempt; the runner never
    invents a verdict.
21. **Explicit dispatch.** Every next run is started with `gh workflow run ... --ref
    main`; nothing relies on GITHUB_TOKEN to chain workflows. Models never receive
    GITHUB_TOKEN.
22. **Human push deploys.** `devos-deploy` triggers on a push to main whose committer
    is not `github-actions[bot]` and whose message does not start with `devos:`.
    Supabase order: guards, backup, migrations, app, smoke. Inactive modules skip.
23. **Park and resume.** A usage limit parks the run in `devos/state/park.json`
    after one move to the next GitHub-capable builder in the pool. `devos-resume`
    (every 30 minutes) unparks and re-dispatches; `devos-supervisor` files an issue
    when a park ages past six hours.
24. **Gated flow.** Risk 3, a migration, a rules change, or a method change labels
    the passing pull request `devos:human-gate` and waits. `devos-wait` fires on the
    merged gated pull request, `devos-advance` moves the ledger and dispatches the
    next cycle. Three failed attempts label `devos:halted` and open an issue.
25. **Builder fallback.** A builder id outside the pool falls back to the default
    builder, and the run log prints exactly why.
26. **Guided UI stack.** One HTML file, one CSS file, one JS file, served by the
    devos process. No React, no build step, no CDN, no remote font. Palette, rail,
    summary column, 390 px stepper, 160 ms motion, and keyboard rules follow the
    specification exactly; the light toggle persists in the draft.

## Engine mechanics

27. **Testing without a network.** All tests run fake `gh`, `git`, `claude`, `agent`,
    `codex`, `gemini`, and `z` executables from `test/fixtures/bin` prepended to
    PATH. The fake git delegates to the real binary and can fail commits on demand.
    The fake model (`bootstrap-writer.mjs`) is the reference implementation of what a
    real configuration model must produce; tests treat it as the model, not the engine.
28. **Test runner scope.** `npm test` runs `node --test 'test/*.test.mjs'` so the
    fixture executables under `test/fixtures/` are not themselves executed as tests.
29. **Upgrade hashing.** Baseline hashes live in `devos/engine-hashes.json`. Both
    sides normalize CRLF to LF before hashing, so a Windows working copy never fails
    a hash check that should follow the LF form stored in git. A failed upgrade
    restores the tree, deletes added files, deletes the empty branch, and prints:
    `devos: upgrade failed; rolled back, nothing changed.`
30. **No dependencies.** The engine has zero runtime npm dependencies; the runner
    scripts inside bootstrapped projects likewise.
31. **License.** A short free-to-use, no-resale draft that the owner can replace.
32. **The keys stage belongs to the engine, and the developer picks the path.**
    `devos continue` never ends with a bare list of missing secrets. The stage
    gitignores `devos/secrets.local.json` before any `git add -A`, writes
    `devos/SECRETS_GUIDE.md` (the configuration model organizes the
    where-to-get steps in an interactive terminal; the built-in catalog is the
    deterministic fallback), creates the fill-in file, and asks once — the
    choice is remembered in `devos/state/keys-mode.json`. Path 1 (default): the
    developer pastes values into the file; the stage waits and uploads each one
    (`gh secret set NAME --repo X`, value piped on stdin, never argv). Path 2
    (`--keys-mode model`): the configuration model requests each key by NAME
    with `request_secret` and the developer types every value into gh's own
    hidden prompt — the model receives only set/missing. Both paths keep every
    value away from chat, issues, guides, answer files, and every model. Truth
    is `gh secret list` × the engine's proof records: a key set behind the
    engine's back is "unconfirmed" until the developer pastes the value or
    marks `__keep__`; "fully set up" is only ever claimed when GitHub itself
    confirms every needed key.
33. **The configuration model's job is the FIRST green run — and every
    `devos continue` is another round until it is proven.** A failed cycle run
    is never a dead end and nothing is ever "spent": each continue reads the
    latest `devos-cycle` run from GitHub and works the round — a run already
    going is watched to the end (never a duplicate dispatch); a green run
    records `first-run-green` in `devos/state/continue.json` and the job is
    DONE (from there any issue continues on GitHub — human-gate PRs — and the
    engine never restarts cycles again); a failed run is diagnosed from its own
    log — the failing step's words plus WHICH keys the run saw as EMPTY,
    parsed from GitHub's masked log (`***` = present, blank = empty), which
    proves "the run predates the key upload" versus "a value is still missing"
    without ever reading a value — and then a FRESH run is dispatched
    (dispatch, not rerun: a rerun replays an invisible entry) and watched to a
    plain-English report that names the exact fix. One dispatch per continue;
    the next continue is the next round. A grace poll after init/sync
    dispatches prevents a duplicate run while GitHub's index catches up. Every
    round lands in the `cycle-attempts` ledger — the story is readable, but it
    never blocks a retry. The final card says the truth in both directions:
    "the first cycle run is green — job done" or "still red — the report names
    the fix, run devos continue again".
34. **The cycle's keys are judged by selection, and the workflow mapping is the
    engine's to repair.** The field loop kept failing with every key EMPTY even
    though GitHub held the values: the model-written workflow mapped the agent
    credentials on one step (or nowhere), so the runner saw UNDEFINED env vars.
    Three rules follow. (1) Only the keys of the tools the user SELECTED
    (reviewer, builder, extra builders) are judged — an unselected tool's empty
    key is named once as irrelevant and never drives a cause. (2) The intake for
    real values opens right in the failure flow: values go into the gitignored
    `devos/secrets.local.json` (the engine uploads, stdin-only) or into gh's own
    hidden prompt via the model walkthrough — a value never reaches the model,
    the chat, a log, or argv. (3) When the values ARE on GitHub yet the run saw
    them EMPTY, the workflow's mapping is the proven suspect: the engine reads
    the repository's `devos-cycle.yml`, adds a top-level `env:` block mapping
    every selected key from its own secret (the one scope every step inherits),
    adds `secrets: inherit` to any caller that would strip secrets, pushes the
    repair, and dispatches the fresh round. Deterministic, additive, idempotent —
    names and mapping lines only; the bootstrapped template now maps the agent
    credentials at the top level from day one (GH_TOKEN stays step-scoped: the
    cycle runner needs it, the model processes must not).
35. **The keys intake is a card in the wizard window, and it loops until GitHub
    confirms everything.** The field flow asked the user to leave the window and
    edit a file — exactly what they refused: "make user enter missed keys in the
    ui and then the model takes them without seeing them, then submit and check
    again for any miss, and if not, make these steps again until all done and
    the cycle workflow is okay." The secrets stage gained a `requestValues`
    door: the wizard server broadcasts `keys-intake` (NAMES + where-to-get hints
    only), the browser renders the Missing keys card (one password field per
    key, autocomplete off), and `POST /api/keys` hands the values to the stage —
    which uploads each via `gh secret set` (stdin-only), re-checks GitHub's own
    list, and re-opens the card carrying ONLY the names still missing. The loop
    runs until GitHub confirms every key (then the fresh cycle round starts on
    its own), the user skips (honest finish + resume path), or the run is
    stopped (Stop resolves a waiting intake). Privacy shape: a value exists in
    the POST body and the gh pipe and nowhere else — no event, no log line, no
    echo, no /api/state payload, no argv, no file; only NAMES travel back.
    `__keep__` keeps an existing GitHub key without retyping it. A latent,
    field-quiet bug was fixed on the way: the wait-loop's `const startedAt`
    shadowed the stage-start timestamp across the whole try block, so every
    allSet path crashed on the temporal dead zone and the stage's own
    bookkeeping was silently lost (continue masked it because result.pushed
    survived). The wait clock is now `waitStartedAt`.
