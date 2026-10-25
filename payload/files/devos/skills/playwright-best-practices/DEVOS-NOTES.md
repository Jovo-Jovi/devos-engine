# DEV_OS notes on Playwright's best practices

Written by DEV_OS after reading the file whole (2026-10-25). Read this before `best-practices-js.md`. These notes are
DEV_OS's own text, not part of the file. The file is copied unchanged under the Apache License 2.0 (`LICENSE`,
`NOTICE`).

- **Use it for the project's own end-to-end tests.** DEV_OS's screen captures and checks for a UI fence are the
  runner's (`scripts/devos/ui-evidence.mjs`); this file is about the tests the builder writes.
- **No real services.** The file suggests testing against a staging environment. In DEV_OS, tests never call a real
  service or the network: use the local stack the runner starts, and route third-party calls with `page.route`, as the
  file also shows.
- **No real credentials.** The sign-in sample types a username and a password into a real site. Tests use fixtures
  and test accounts of the local stack; a secret is never written into a file.
- **Do not upgrade from a task.** The file says to keep Playwright at `@latest`. A dependency change is a decision for
  the fence, and the project pins its versions.
- **People's tools.** `codegen`, the VS Code extension, UI Mode, `--debug` and the trace viewer's interface are for a
  person at a screen. An agent reads the failure from the test output and the runner's evidence.
- **Browsers.** Follow the project's Playwright configuration. Add a browser project only when the fence asks.
- **Images** in the file are remote links. Do not fetch them.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win over this file.
