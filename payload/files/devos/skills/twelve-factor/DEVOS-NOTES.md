# DEV_OS notes on The Twelve-Factor App

Written by DEV_OS after reading every copied page whole (2026-10-25). Read this before the pages your prompt lists.
These notes are DEV_OS's own text, not part of the pages. The pages are copied unchanged under the MIT licence
(`LICENSE`).

- **Old examples, lasting rules.** The text dates from 2011 to 2012: its tools (Capistrano, Foreman, Memcached,
  Beanstalkd and others) are examples of their time. Apply the rules with the project's own stack.
- **Config (`config.md`).** Config lives in the environment. Secrets are never written to a file in the repository: a
  local `.env` is allowed only when it is git-ignored, and the deploy's values are set by the owner or by
  `devos-deploy`.
- **Admin processes (`admin-processes.md`).** Never open a console on the live database or run a one-off script
  against production from a task. Migrations run through `devos-deploy` after the human's merge
  (`docs/method/FULLSTACK_MODULE.md`).
- **Serverless hosts (`port-binding.md`, `processes.md`, `concurrency.md`).** On a platform such as Vercel, the
  platform binds the port and runs the processes. The rules that still apply: stateless handlers, short requests,
  background work in a queue or a scheduled job.
- **Dev/prod parity (`dev-prod-parity.md`).** It matches DEV_OS's local stack: the same database in Docker on every
  run, not a lighter substitute.
- **Links** to the other pages of the site and to images do not resolve. Do not fetch them.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win over every page.
