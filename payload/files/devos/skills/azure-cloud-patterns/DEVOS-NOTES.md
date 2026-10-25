# DEV_OS notes on the cloud design patterns

Written by DEV_OS after reading every copied page whole (2026-10-25). Read this before the pages your prompt lists.
These notes are DEV_OS's own text, not part of the pages (`ATTRIBUTION.md`).

## How to use them

- **A pattern is an option, not a default.** DEV_OS builds lean (PR-47): add a queue, a circuit breaker, a bulkhead or
  a compensation flow only when the fence names the need it serves. Each page has a "might not be suitable when"
  list; read it before adopting the pattern.
- **One database, one transaction.** When every step of an operation writes to the same database, a database
  transaction is the answer. The Compensating Transaction pattern is for steps that span services or stores.
- **Retry only what is safe to repeat.** Retry an operation that is idempotent, or carries an idempotency key
  (`../google-aips/0155.md`, `idempotent-consumer.md`). Bound every retry and every call with a timeout.
- **The patterns are cloud-neutral; the examples are Azure's.** Azure services, the "Workload design" tables and the
  Well-Architected pillars are Microsoft's context. Build with the project's own platform (Vercel, Supabase, Firebase,
  R2 or another the fence names) and its documented features.

## Notes on the pages

- `retry-content.md` is the text of the Retry pattern. Links to `retry.yml`, `saga.yml` and other `.yml` pages, and to
  pages outside this folder, do not resolve. The images are not copied. Do not fetch any of them.
- `circuit-breaker.md` mentions thresholds adjusted by AI and machine learning. Use fixed, tested thresholds unless the
  fence asks otherwise. Its example trips on the first `429`, unlike the failure threshold the page describes: read the
  rule, not the example.
- `anti-corruption-layer.md`: in "might not be suitable when", the second sentence belongs to the solution. Keep the
  layer to translation, with no business rules or orchestration.
- `throttling.md` and `bulkhead.md` recommend limits that change at run time and the platform's built-in controls.
  In DEV_OS, a change of limits is a configuration change made in a fence. Never change production settings from a
  task.
- `health-endpoint-monitoring.md`: keep liveness shallow, give readiness checks timeouts, and do not expose detailed
  health data publicly. This agrees with the OWASP sheets.

## Who wins

The fence, `docs/DECISIONS.md` and the method win over every page. Where a page and another source disagree, follow the
project's documents and say so in your report or verdict.
