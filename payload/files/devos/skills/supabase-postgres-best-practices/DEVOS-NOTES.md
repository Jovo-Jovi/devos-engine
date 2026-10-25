# DEV_OS notes on Supabase Postgres Best Practices

Written by DEV_OS after reading every copied file whole (2026-10-25). Read this before the rule files your prompt
lists. These notes are DEV_OS's own text, not part of the skill. The skill is copied unchanged under its MIT licence
(`LICENSE`).

## Who wins

- The fence, `docs/DECISIONS.md` and the method win over every rule, in particular `docs/method/FULLSTACK_MODULE.md`
  for migrations, RLS, grants and the human gate on a migration.
- Where a rule and another source disagree on a security point, follow the stricter rule and name the conflict in your
  report or verdict.

## Corrections (verified)

- **`references/security-rls-performance.md`, the `SECURITY DEFINER` helper.** The sample revokes `EXECUTE` on
  `private.is_team_member` from `PUBLIC, anon, authenticated, service_role` and then calls the function in a policy.
  Postgres checks `EXECUTE` for the role that runs the query, so the policy then fails for `authenticated` with
  `permission denied for function is_team_member`. DEV_OS ran the sample on PostgreSQL 16 on 2026-10-25: the query
  failed as printed, and returned only the member's rows once `EXECUTE` was granted to `authenticated` alone.
  Revoke `EXECUTE` from `PUBLIC` and `anon`, grant it to the roles the policy serves, and keep the function in a schema
  the Data API does not expose. Prove it with a policy test.

## Notes

- **`references/conn-idle-timeout.md` and `references/conn-limits.md`** use `alter system`. A managed Supabase
  project does not allow it. Change those settings in the provider's dashboard or configuration, and only when the
  fence asks.
- **`references/schema-primary-keys.md`** uses `uuid_generate_v7()`, which needs the `pg_uuidv7` extension. Add an
  extension only when the fence names it. Otherwise use `bigint generated always as identity`, or the rule's
  time-prefixed id that needs no extension. PostgreSQL 18 adds a built-in `uuidv7()`.
- **The `EXPLAIN` outputs and speed-ups** ("100x faster") are illustrations from the authors, not measurements of this
  project. Measure before claiming a gain.
- **The skill's links** to the Postgres and Supabase documentation are pointers for a person. Do not fetch them.
- **Not copied:** `references/_sections.md`, `references/_contributing.md` and `references/_template.md` (the authors'
  templates for writing rules) and `CHANGELOG.md`.
