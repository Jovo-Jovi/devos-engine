# DEV_OS notes on the Supabase skill

Written by DEV_OS after reading the skill whole (2026-10-25). Read this before `SKILL.md`. These notes are DEV_OS's
own text, not part of the skill. The skill is copied unchanged under its MIT licence (`LICENSE`).

## Read these parts

- **Core Principles 4 to 6:** exposing tables to the Data API, RLS on every table of an exposed schema, and the
  security checklist (user metadata in JWTs, deleted users' tokens, keys in public clients, views and RLS, `UPDATE`
  and `SELECT` policies, `USING` with `WITH CHECK`, `SECURITY DEFINER`, Storage upserts, pinned packages). These are the
  reason DEV_OS ships the skill.
- **Making and Committing Schema Changes**, for the choice between declarative schemas and migrations.

## Skip these parts

- **Fetching:** the changelog, the documentation, the product security index and the Monitoring and Debugging page.
  Nothing is fetched while a task runs. The fence and the project's documents are the source.
- **The MCP server and its troubleshooting.** The cycle does not use it.
- **Commands against a real project** (`supabase login`, `db push`, `db pull` against a remote, personal access tokens).
  The builder works on the local stack the runner starts. Migrations follow `docs/method/FULLSTACK_MODULE.md` and wait
  for the human gate.
- **`references/skill-feedback.md` and filing issues.** They are not copied, and DEV_OS never opens an issue on
  another project.

## Who wins

The fence, `docs/DECISIONS.md` and `docs/method/FULLSTACK_MODULE.md` win over the skill. Where the skill and another
source disagree on a security point, follow the stricter rule and name the conflict in your report or verdict.
