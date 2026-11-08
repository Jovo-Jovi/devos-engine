# Production readiness — the launch task's gates (PR-88)

The last task before launch (`scope` `full`) proves the product is ready for production. Its fence has a
`- Launch:` line naming the main pages (`- Launch: / · /pricing · /sign-in`), or `- Launch: none` for a product
without pages. That line makes it **the launch task**: risk 3, a deep review, the owner's gate.

Two kinds of gate decide it.
- **Mechanical checks.** The runner runs them on the build: `scripts/devos/readiness.mjs` turns them into the
  required check `readiness`, so a red check overrides PASS. They are marked **[tool]** below.
- **The reviewer's checklist.** The launch review goes through this checklist per layer, with the ASVS at the
  project's level. These items are marked **[review]**.

A failed item blocks the launch task. The only exception is the owner's waiver in writing: a line in
`docs/DECISIONS.md`, a file no agent may change.
- A mechanical check: `Readiness waiver: <headers|audit|accessibility|speed> — <reason>`.
- An ASVS requirement: `Readiness waiver: asvs <id> — <reason>`.
- Any other item on this list: `Readiness waiver: <layer> <item> — <reason>`.

The verdict names every waiver it relied on.

## The ASVS level

Verify **level 1**, and **level 2** when the project stores personal data (`docs/PROTECTION_MODEL.md`) or takes
payments. `.devos/readiness.md` states the level and why. Read the chapters your prompt lists
(`devos/skills/owasp-asvs/`). Mark each requirement at that level or below as met, not met, or not applicable,
with a reason. Then take the second look with Trail of Bits' sharp edges (`devos/skills/trailofbits-sharp-edges/`).

## The checklist, per layer

Check every layer the product has. A layer the product does not have is not applicable; say so in one line.

### Security
- **[tool] headers.** Every main page sends:
  - `Strict-Transport-Security` (a year at least);
  - a `Content-Security-Policy`;
  - `X-Content-Type-Options: nosniff`;
  - a `Referrer-Policy`;
  - frame protection (`frame-ancestors` or `X-Frame-Options`);
  - and no `X-Powered-By` (ASVS V3.4, V13.4).
- **[tool] audit.** `pnpm audit` finds no high or critical advisory (PR-85), whatever the task changed.
- **[review]** Sign-in, sessions and tokens meet V6, V7 and V9 (V10 with OAuth) at the level.
- **[review]** Every object and field a user reaches is checked for that user (V8): per route, per query, per row rule.
- **[review]** No secret is in the code, the build output, a log or the client bundle (V13.3). Keys are the
  platform's secrets.
- **[review]** Input is validated at the boundary, and output is encoded for where it goes (V1, V2). File uploads are
  limited by type, size and place (V5).

### Frontend, design, motion and accessibility
- **[tool] accessibility.** axe (WCAG 2.2 AA) finds no violation on any main page.
- **[review]** The main flows work by keyboard alone, with visible focus. Text and controls meet contrast, and
  reduced motion is honoured (`DESIGN_METHOD.md`).
- **[review]** Every page has its title, description and share image. A missing page gives a 404 page, and an
  error gives an error page that says what to do.

### Speed
- **[tool] speed.** Every main page's largest contentful paint is at most 2.5 s and its layout shift at most 0.1,
  at 390 px, on the production build.
- **[review]** Images are sized and in a modern format. The pages load no script they do not use. A list of
  growing length is paginated.

### Backend and API
- **[review]** Every route has its timeout. A call to another service has a timeout and a bounded retry, and fails
  gracefully (reliability).
- **[review]** Errors follow one format and leak no stack trace or internal detail (V16.5, OWASP API Top 10).
- **[review]** Anything a user can trigger at volume is rate limited: sign-in, sign-up, password reset, contact and
  every write.

### Database
- **[review]** Every table a user reaches has its access rules (row rules where the stack has them), and a test
  proves a second user cannot read the first user's rows.
- **[review]** Migrations replay from empty to the current schema. Backups are on, with a stated retention and one
  restore tried (when data is stored).
- **[review]** Personal fields have their purpose, retention and deletion (`PROTECTION_MODEL.md`, V14).

### Architecture and ops
- **[review]** The production settings come from the platform's environment, and the production values differ from
  every preview or development value.
- **[review]** The deploy is reproducible from the repository: `README.md` and `docs/STACK.md` give the steps, and
  a rollback is one step.
- **[review]** Logging is structured, and error tracking is on (`modules.observability`, unless it is `none`).
  Neither holds personal data or a secret (V16).
- **[review]** A health check answers without touching more than it must.

### Testing
- **[review]** The stack's `test` command passes, with the core flow's end-to-end test.
- **[review]** Every flow added since that test has its own test, or a line in the verdict saying why it has none.

## What the launch task's fence carries

- `- Launch: <pages>` or `- Launch: none`.
- Its `- Layers:` line names every layer the product has, so the reviewer's skills cover them.
- The Done-when items fix what this checklist found missing: headers in the framework's configuration, error
  tracking, backups, rate limits and the tests.
- No new feature: a launch task hardens what exists (handbook §J9).
