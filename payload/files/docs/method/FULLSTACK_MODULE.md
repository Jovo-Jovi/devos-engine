# Dev OS — the backend module (Supabase)

Method document, not product scope. It adds a real data layer to the automated cycle without
weakening any gate, and it is what a new project copies when it needs a backend
(`/devos-new-project`, step 5). Precedents PR-17, PR-18 and PR-19 make it binding here.

## 1. When it applies

The module is **active** when `supabase/config.toml` exists in the tree
(`devos.config.json` → `modules.supabase.detect`). Until then every module step is skipped and the
project runs exactly as a frontend-only project. A project adopts it through a signed OD, normally
an intake PR from a change request; the first task of that OD creates `supabase/`.

The handbook's profiles decide what the data may be:

| Situation | Handbook | Gate | What this module adds |
|---|---|---|---|
| Public site, no stored data | Profile A | Boundary | nothing (module inactive) |
| Public site + staff dashboard (operators publish content) | Profile A, §9 reference architecture | Boundary, with an `operator` zone | RLS, staff claim + AAL2 on writes, invite-only accounts |
| Public site + member or visitor accounts | Profile A + a personal-data zone | Boundary outside the zone; **Personal-Data Protection** (§10.3) inside it | `docs/PROTECTION_MODEL.md`, deletion and export, retention job, private repository |
| Internal records system | Profile B | Personal-Data Protection | as above, for the whole product |

A profile or zone changes only by a signed OD (PR-19). The `devos:boundary` line in
`docs/BOUNDARY_MODEL.md` is where the OD writes it, and `guard:boundary` reads it.

## 2. Environments

| Environment | Database | Who touches it | Keys |
|---|---|---|---|
| Builder and reviewer runs, `ci` | A throwaway local Supabase in Docker on the runner, rebuilt from the migrations and the synthetic seed every run | the runner (`scripts/devos/supabase.mjs`) | the CLI's local demo keys, written to `.devos/supabase.env` (never committed) |
| A developer's machine | `supabase start` | the human | local demo keys |
| Preview deployments | none by default: the review uses the local build against the CI database. Optional: a separate preview project, then set `DEVOS_PREVIEW_DB=true` and its keys in Vercel's Preview environment | — | Vercel Preview env |
| Production | the hosted project | **only** `devos-deploy`, after the human's merge | Vercel Production env; GitHub secrets for the deploy |

No agent ever links to, pushes to or queries a hosted project. Previews never point at production.

## 3. What every run checks (PR-17)

With the module active, `scripts/devos/run-checks.mjs` starts the local stack before the app's
checks and adds three required checks and one optional one:

| Check | Command | Proves |
|---|---|---|
| `db` | `supabase db reset` | every migration applies from zero, then the seed |
| `db-test` | `supabase test db` | the pgTAP tests in `supabase/tests/` pass (RLS proofs) |
| `types` | `supabase gen types typescript --local` compared with `modules.supabase.types_file` | the committed types match the schema |
| `db-lint` (optional) | `supabase db lint --fail-on error` | no plpgsql errors |

The app's typecheck, tests, build and e2e then run against that database, with its names exported
(`modules.supabase.env`). Red overrides PASS (PR-08) applies to the new checks too.

`guard:data` adds, on every run: migration names; applied migrations never edited, renamed or
deleted; RLS enabled on every created table and never disabled; `security definer` functions set
`search_path`; no write grants to `anon`; the secret key only in `server-only` modules and never
under a `NEXT_PUBLIC_` name; reserved email domains in the seed; pgTAP tests exist.

## 4. Review and gates

- The reviewer reads every migration statement, states the policy per role for each table against
  `docs/DATA_MODEL.md`, re-runs `supabase test db` and `supabase db lint`, queries `pg_policies`,
  and proves a forbidden read is refused (reviewer prompt, "Data layer").
- **A schema change always stops at the human gate**, whatever the task's risk (`verdict.mjs`).
  Intake marks migration tasks Risk 3 anyway, so Opus reviews them line by line.
- Personal-data zones add the Protection gate checks (reviewer prompt, "Personal data").

## 5. Production order (PR-18)

`devos-deploy`, on the human's merge, with `DEVOS_SUPABASE=true`:

1. guards on what ships;
2. `supabase link`, then a schema dump and a data dump; the data dump is encrypted with
   `DEVOS_BACKUP_PASSPHRASE` (AES-256, gpg) and the plain copy is shredded; both kept 30 days as a
   workflow artifact;
3. `supabase db push --dry-run`, then `supabase db push`;
4. only then the app: Vercel build and upload (PR-16);
5. the strict smoke test against Vercel's URL.

A failure at 2 or 3 stops the job before the app moves, so the running app never meets a schema
it was not built for. Fixes go forward as new migrations; a restore from the encrypted dump is a
human decision. Migrations must therefore be **expand-then-contract**: add first, switch the app,
remove in a later task, so the old app keeps working between steps 3 and 4.

## 6. Secrets and settings

| Where | Name | Holds |
|---|---|---|
| GitHub secret | `SUPABASE_ACCESS_TOKEN` | a personal access token for the CLI (deploy only) |
| GitHub secret | `SUPABASE_PROJECT_REF` | the production project's ref |
| GitHub secret | `SUPABASE_DB_PASSWORD` | the production database password |
| GitHub secret | `DEVOS_BACKUP_PASSPHRASE` | the backup encryption passphrase (also kept offline by the human) |
| GitHub variable | `DEVOS_SUPABASE=true` | turns on the database step in `devos-deploy` |
| GitHub variable | `DEVOS_PREVIEW_DB=true` | optional: previews have their own database |
| Vercel, Production | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public values |
| Vercel, Production (sensitive) | `SUPABASE_SECRET_KEY` | server-only key |

Auth settings that are not in migrations (sign-ups off for staff-only zones, site URL, redirect
URLs, SMTP, MFA) are set in the hosted project's dashboard by the human and listed in the OD.

## 7. Builder kit

`.cursor/rules/70-supabase.mdc` (conventions above), Context7 for library docs, and the local stack
already running in the cycle. Supabase's own agent skills may be added to `.cursor/skills/` by a
method patch after review; they never override a fence.

## 8. Known limits

- Free hosted projects pause after a week without activity; `devos-deploy` then fails at
  `supabase link` and says so. Restore the project in the dashboard and re-run.
- The local stack adds a few minutes to each run (image pulls). The gate doctor treats Docker
  start failures as environment failures and re-runs them once (PR-15).
- Branch databases per PR (Supabase branching) are not used: they are billed per hour and the
  throwaway CI database already gives each attempt a clean schema.

---

# Two more stack modules: object storage (R2) and Firestore (PR-26)

They follow the same contract as the database module: **a module is declared, never assumed; every
run proves it against a throwaway local copy; no agent touches a hosted service; production moves
only in `devos-deploy` after the human's merge, before the app.** Pick the modules a product needs;
a real product rarely needs two data stores (the method's first project ran both only to test the method).

| | Database (Supabase) | Object storage (R2) | Content store (Firestore) |
|---|---|---|---|
| Active when | `supabase/config.toml` | `src/lib/r2/` exists | `firebase.json` |
| Local copy each run | Supabase in Docker | SeaweedFS S3 store in Docker, bucket `devos-test` | Firestore emulator, project `demo-devos` |
| Script | `scripts/devos/supabase.mjs` | `scripts/devos/r2.mjs` | `scripts/devos/firebase.mjs` |
| Env file | `.devos/supabase.env` | `.devos/r2.env` | `.devos/firebase.env` |
| Required checks | `db`, `db-test`, `types` | `storage` | `firestore-seed`, `firestore-rules` |
| Guard | `guard:data` | `guard:services` | `guard:services` |
| Human gate | any migration | (risk 3 tasks: uploads are writes) | any rules file change |
| Production step | backup → migrations | preflight: write, public read, delete a probe | rules → seed |
| Builder rule | `70-supabase.mdc` | `71-r2.mdc` | `72-firebase.mdc` |

`scripts/devos/modules.mjs start --task Tnn` starts every module the tree uses **and** any module the
task's fence introduces (`modules.<name>.fence_hint`), so the task that adds a module already has its
emulator. Every `.devos/*.env` is loaded for the builder, the reviewer, e2e and screenshots
(`readEnvFile()` in `supabase.mjs` now merges them all).

## 9. Object storage (Cloudflare R2)

- **Shape.** Server-only S3 client in `src/lib/r2/` (`endpoint`, `region: "auto"`, path-style,
  checksums only when required). Uploads only from staff-zone server actions with the staff claim
  and AAL2; validated by magic bytes, size-limited, re-encoded with `sharp` with **all metadata
  stripped** (EXIF can hold GPS), stored under immutable keys; the old object is deleted after the
  database points at the new one. Images are served from the bucket's public URL
  (`R2_PUBLIC_BASE_URL`), which joins the CSP `img-src`.
- **Every run.** `storage` = the store's round trip (put, public read, delete) **and** the app's
  `test:storage` integration tests against it.
- **`guard:services`.** Keys and the S3 client only in `server-only` files, never in a client
  component or under a `NEXT_PUBLIC_` name; no service-account file in the tree.
- **Production (`DEVOS_R2=true`).** Before anything else moves, `devos-deploy` writes a probe object
  with the production keys, reads it from the public URL, and deletes it. A wrong key, bucket name or
  a bucket without public access stops the deploy with a plain message.
- **Limits.** `r2.dev` public URLs are rate-limited and meant for development; a real product
  connects a custom domain to the bucket. Uploaded images are content, not code: they have no
  backup in git, so a product that needs one adds R2 object versioning or a lifecycle copy (an OD).

## 10. Firestore (Firebase)

- **Shape.** Read on the server only with `firebase-admin` in `src/lib/firebase/`; the browser never
  talks to Firebase (`modules.firebase.client_sdk: false`), so there is no Firebase script, no
  analytics and no CSP change. Rules deny every client. Documents are validated with Zod on read.
- **The seed is the source of truth.** `firebase/seed/<collection>.json` (arrays of documents with an
  `id`) is reviewed in the PR like code; `devos-deploy` writes it and removes documents the file no
  longer has, so git history is the backup. Collections without a seed file are never touched.
- **Every run.** `firestore-seed` = the seed is valid and synthetic and loads into the emulator with
  the exact counts; `firestore-rules` = the app's `test:rules` tests prove the rules against the
  emulator.
- **`guard:services`.** No Firebase web SDK (with `client_sdk: false`); never analytics, performance
  or messaging; `firebase-admin` and the service account only in `server-only` files; rules files
  exist and never `allow … : if true` for writes (nor for reads with `client_sdk: false`); rules
  tests exist; the seed is valid.
- **Gate.** A change to a rules file stops at the human gate (`verdict.mjs`), like a migration.
- **Production (`DEVOS_FIREBASE=true`).** `firebase deploy --only firestore:rules`, then
  `firebase.mjs seed --production`, then the app. Two keys: the deploy key (Firebase Admin role,
  GitHub secret) and a read-only runtime key (Cloud Datastore Viewer, Vercel).
- **Limits.** The Spark plan has daily read and write quotas; a seed is small. The emulator needs
  Java 21 and adds about a minute per run.

## 11. Secrets and settings for the two modules

| Where | Name | Holds |
|---|---|---|
| GitHub variable | `DEVOS_R2=true` | turns on the storage preflight in `devos-deploy` |
| GitHub secrets | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | the production bucket, for the preflight |
| Vercel, Production | the same five (`R2_SECRET_ACCESS_KEY` and `R2_ACCESS_KEY_ID` sensitive) | what the app uses |
| GitHub variable | `DEVOS_FIREBASE=true` | turns on rules and seed in `devos-deploy` |
| GitHub secrets | `FIREBASE_PROJECT_ID`, `FIREBASE_DEPLOY_SERVICE_ACCOUNT` (whole JSON) | rules and seed |
| Vercel, Production | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` (read-only key, whole JSON, sensitive) | what the app uses |
