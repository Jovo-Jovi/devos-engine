# Before you start a project

This page covers everything DEV_OS asks for while it sets up a project, in the order it asks:
- the decisions;
- the information;
- the files;
- the accounts and keys.

Prepare them first and the setup takes minutes. Keep this page open next to the guided setup, or copy the
[worksheet](#10-the-worksheet) at the end and fill it in.

Nothing on this page is sent anywhere. Keys are typed only at the setup's **Keys** step, where the input is hidden, and
any key can be skipped and set later.

1. [This computer](#1-this-computer)
2. [Accounts and keys for the agents](#2-accounts-and-keys-for-the-agents)
3. [The contract and the agents](#3-the-contract-and-the-agents)
4. [Project type, stack, modules and scope](#4-project-type-stack-modules-and-scope)
5. [Project details](#5-project-details)
6. [Documents and design references](#6-documents-and-design-references)
7. [Services and their keys](#7-services-and-their-keys)
8. [GitHub](#8-github)
9. [What comes after setup](#9-what-comes-after-setup)
10. [The worksheet](#10-the-worksheet)

## 1. This computer

The first screen of the setup checks these. `devos doctor` checks the GitHub CLI, and `devos agents detect` checks
which AI tools are installed and signed in.

- [ ] **Node.js 22 or newer** (`node --version`). It runs the engine, which has no other dependency.
- [ ] **git** (`git --version`). It makes the project's first commit.
- [ ] **The GitHub CLI, signed in** (`gh auth status`), with the `repo` and `workflow` scopes. When a scope is missing,
  `devos doctor` prints the command that adds it.
- [ ] **One AI coding CLI, signed in on this computer.** It writes the blueprint. Any one of these works:
  - Claude Code (`claude`);
  - the Cursor CLI (`agent`);
  - the Codex CLI (`codex`);
  - the Gemini CLI (`gemini`).
- [ ] **The engine,** cloned or unzipped anywhere (see *Install* in the README).
- [ ] **A projects folder** outside the engine's folder. The setup suggests `devos-projects` in your home folder, and
  each project gets a new folder inside it.

## 2. Accounts and keys for the agents

The reviewer and the builders run on GitHub Actions, so each tool they use needs a key there. The blueprint agent runs
on this computer with your signed-in CLI and needs no key.

| Tool | Key | Where to get it |
|---|---|---|
| Cursor | `CURSOR_API_KEY` | cursor.com/dashboard → API keys → Create key |
| Claude Code | `CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_API_KEY` | run `claude setup-token` (Claude Pro or Max), or console.anthropic.com/settings/keys |
| Codex | `OPENAI_API_KEY` | platform.openai.com/api-keys |
| Gemini | `GEMINI_API_KEY` | aistudio.google.com/apikey |

- [ ] A key for every tool you will choose for the reviewer, the light reviewer or a builder.
- [ ] **Optional: a second account per tool.** Its key has the same name with `_2` (`CURSOR_API_KEY_2`,
  `CLAUDE_CODE_OAUTH_TOKEN_2` or `ANTHROPIC_API_KEY_2`, `OPENAI_API_KEY_2`, `GEMINI_API_KEY_2`).
  - When one account reaches its usage limit, the run continues on the other.
  - When both have reached it, the run moves to the role's next model, if it has one (section 9), or waits for the
    earliest reset.

## 3. The contract and the agents

- [ ] **The contract.** Read it and accept it; without that, setup stops and nothing is written or sent. It says:
  - what the engine is;
  - what the private DEV_OS Control Tower is;
  - what an optional link sends, and what is never sent.
- [ ] **The Control Tower link: yes or no.**
  - It is optional, and no answer is chosen for you.
  - No: nothing is ever sent, and the engine works the same.
  - Yes: once its operator approves, each step of the cycle sends one event.
  - The repository variable `DEVOS_REPORTING` keeps your answer, and you can change it later.
- [ ] **The reviewer:** a tool and a model. It reviews every task, plans change requests and method fixes, and writes
  revisions. Give it your strongest model.
- [ ] **The light reviewer:** a tool and a model for low-risk tasks, or the same as the reviewer.
- [ ] **The builders:** one or more tool and model pairs, each with a short note on what it is good at, and the
  **default builder**.
- [ ] **Who picks the builder for each task:**
  - **the reviewer picks** the builder whose strengths fit;
  - or **always the default builder**.
- [ ] **The blueprint agent:** any AI tool signed in on this computer. It writes the project's documents and its first
  task.

When a tool can list the models of your account, only those are offered.

## 4. Project type, stack, modules and scope

### The project type

The type sets the default stack and the modules it starts with. You can change both.

| Type | What it is | Default stack | Modules it starts with |
|---|---|---|---|
| SaaS application | Multi-user product with accounts, data, and paid plans. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Auth: Email and password · Email: Resend · Hosting: Vercel · Observability: Structured logs |
| Web app | A browser application with its own screens and data. | Vite + React | Database: Postgres on Supabase · Auth: Email and password · Hosting: Vercel · Observability: Structured logs |
| Marketing or content site | Public pages, posts, and SEO. No accounts. | Astro | Hosting: Vercel |
| Dashboard or internal tool | Signed-in views over your own data. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Auth: Email and password · Hosting: Vercel · Observability: Structured logs |
| Marketplace | Two kinds of user meet and transact. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Storage: Supabase Storage · Auth: Email and password · Payments: Stripe · Email: Resend · Hosting: Vercel · Observability: Structured logs |
| Store | Catalog, cart, checkout, orders. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Storage: Supabase Storage · Auth: Email and password · Payments: Stripe · Email: Resend · Hosting: Vercel · Observability: Structured logs |
| API only | HTTP service, no styling and no ui-kit. | Hono | Database: Postgres on Supabase · Observability: Structured logs |
| Mobile application | iOS and Android from one codebase. | Expo | Database: Postgres on Supabase · Auth: Email and password |
| AI product | Chat, tools, or retrieval is the product itself. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Auth: Email and password · Product AI: Chat · Hosting: Vercel · Observability: Structured logs |
| Realtime app | Live updates are the core behavior. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Auth: Email and password · Hosting: Vercel · Observability: Structured logs |
| Documentation site | Reference and guides. No auth, no database. | Astro Starlight (docs) | Hosting: Vercel |
| CLI or developer tool | A command people run in a terminal. | Node TypeScript bin | none |
| Library or SDK | Code other projects import. | Node TypeScript package | none |
| Worker | Scheduled or queued jobs. | Hono | Jobs: Upstash Redis · Observability: Structured logs |
| Browser extension | Vite plus an extension manifest. | Vite + React | none |
| Full product | Web plus API plus data. | Next.js (App Router, TypeScript) | Database: Postgres on Supabase · Storage: Supabase Storage · Auth: Email and password · Email: Resend · Hosting: Vercel · Observability: Structured logs |

### The stack

| Stack | For these types |
|---|---|
| Next.js (App Router, TypeScript) | SaaS application, Web app, Dashboard or internal tool, Marketplace, Store, AI product, Realtime app, Full product |
| Nuxt · SvelteKit · Remix | SaaS application, Web app, Dashboard or internal tool, Full product |
| Astro | Marketing or content site, Full product, Web app |
| Astro Starlight (docs) | Documentation site |
| Vite + React · Vite + Vue | Marketing or content site, Browser extension, Web app |
| SolidStart | Marketing or content site, Dashboard or internal tool, Web app |
| Hono · Go + chi | API only, Worker |
| Fastify · NestJS · FastAPI · Django | API only |
| Expo · Flutter | Mobile application |
| Node TypeScript bin | CLI or developer tool |
| Node TypeScript package · Python package | Library or SDK |

### The modules

Pick one provider for each module the product needs. **None** is always offered. A provider listed with keys needs
those keys at the **Keys** step; section 7 says where to get them.

- **Database.** Every migration waits for your merge.
  - Postgres on Supabase · Firestore on Firebase.
- **Storage.**
  - Supabase Storage · Cloudflare R2 · Firebase Storage;
  - S3: `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
  - Vercel Blob: `BLOB_READ_WRITE_TOKEN`.
- **Auth.** Accounts can hold personal data, so the boundary guard watches it.
  - Email and password · OAuth · Email and OAuth.
- **Payments.** Money flows need your review before launch.
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`;
  - Paddle: `PADDLE_API_KEY`;
  - Lemon Squeezy: `LEMONSQUEEZY_API_KEY`;
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`;
  - RevenueCat: `REVENUECAT_API_KEY`.
- **Email** (transactional).
  - Resend: `RESEND_API_KEY`;
  - Postmark: `POSTMARK_API_KEY`;
  - Amazon SES: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Jobs** (background jobs and queues).
  - Upstash Redis: `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`;
  - BullMQ: `REDIS_URL`.
- **Search.**
  - Postgres full text;
  - Meilisearch: `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`.
- **Product AI.** The product's own AI feature, not the reviewer or a builder.
  - Chat, Tools and agents, or Retrieval: `PRODUCT_AI_API_KEY`.
- **Hosting.** None means no deploy step.
  - Vercel.
- **Observability.** How failures become visible to you.
  - Structured logs, from the first task;
  - Sentry (structured logs plus error tracking): `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.

### The scope

- [ ] **MVP.** The core flow first. Every other feature waits on a "Later" list until you ask for it.
- [ ] **Full product for production.** Every feature in your brief, built in phases, then a production-readiness phase.

## 5. Project details

| Question | What to prepare |
|---|---|
| Project name | A short name. It names the project's folder and repository, and gives the project's key: capitals, digits and hyphens, up to 32 characters (`My Shop` becomes `MY-SHOP`). |
| Brief | One paragraph: the problem, who it is for, and what it must do. |
| Who uses it | The kinds of user, such as "shop owners and their customers". |
| Languages | Language codes separated by commas, such as `en` or `en, ar`, or a regional code such as `en-GB`. The default is `en`. |
| Repository visibility | `private` (the default) or `public`. |

Whether the product stores data, how users sign in and where it deploys follow from the modules.

## 6. Documents and design references

These are optional, and they make the blueprint better. The blueprint does three things with them:
- it reads them;
- it writes every document that is still missing;
- it lists what is left open in `docs/OPEN_QUESTIONS.md`.

| Document | What to give | Worth preparing for |
|---|---|---|
| Product brief or PRD | The problem, the users and the must-have features, in your words. | every type |
| Design references | Images and links of screens, sites or apps you like, and what you like about each. | every type with screens: all but API only, CLI, Library and Worker |
| Wireframes or user flows | Sketches, wireframes or diagrams of the main screens and the steps a user takes. | SaaS, Web app, Dashboard, Marketplace, Store, Mobile, AI product, Realtime app, Browser extension, Full product |
| Brand assets | A logo, colours and fonts, or a brand guide, if you have them. | SaaS, Web app, Marketing site, Marketplace, Store, Mobile, AI product, Documentation site, Browser extension, Full product |
| Content | Page copy, product data or sample records. | SaaS, Marketing site, Marketplace, Store, Documentation site, Full product |
| Data and API notes | Existing schemas, APIs the product must call, sample payloads. | every type but Marketing site, Documentation site and Browser extension |
| Business rules | Roles and permissions, pricing, and any legal requirement you know of. | every type but Marketing site, Documentation site, CLI and Library |
| Similar products | Products like yours: what they do well, and what yours must do better or differently. | every type but Worker |

- **Files.**
  - Documents can be Markdown, text, CSV, JSON or YAML, up to 1 MB each, or PDF, up to 20 MB.
  - Images of designs can be PNG, JPEG, WebP or GIF at full quality: up to 20 MB each, up to 30 files and 200 MB in
    all.
- **Names.**
  - Name each file for what it holds (`brief.md`, `brand-guide.pdf`).
  - Name each image for the reference it shows (`ref-checkout-stripe.png`, `logo.png`, `flow-sign-up.png`).

  The agents cite them by name.
- **Where they go.**
  - Documents are copied to `devos/intake-docs/`.
  - Images go to `docs/design/references/`, and each is listed in `docs/design/REFERENCES.md`. The blueprint takes a
    direction of the project's own from them, never a copy.
- **What not to attach.** A key, a password, or real personal data. Use sample records.

## 7. Services and their keys

Create the services the chosen modules use before the **Keys** step, or skip their keys there and add them later. The
project's `SETUP.md` lists every setting it uses, with the steps. When something is missing, the setup check opens the
issue "Dev OS: setup needed" and names it.

**Services DEV_OS deploys to or checks** (repository secrets and variables):

- **Supabase** (Database or Storage on Supabase). Create the production project first.
  - `SUPABASE_ACCESS_TOKEN`: supabase.com/dashboard/account/tokens.
  - `SUPABASE_PROJECT_REF`: Project Settings → General → Project ID.
  - `SUPABASE_DB_PASSWORD`: the database password you set at creation.
  - `DEVOS_BACKUP_PASSPHRASE`: a long passphrase of your own that encrypts the database backups. Keep a copy in your
    password manager.
  - With Vercel hosting, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the Vercel
    project's Production environment.
- **Firebase** (Firestore or Firebase Storage). Create the project with Analytics off, its Firestore database, and a
  service account with its JSON key.
  - `FIREBASE_PROJECT_ID`: Project settings → Project ID.
  - `FIREBASE_DEPLOY_SERVICE_ACCOUNT`: the path of the downloaded JSON key. The setup reads the file; delete it once
    the key is set.
- **Cloudflare R2** (Storage on R2). Create a bucket, its public access, and an API token for that bucket only.
  - `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`: all from the R2
    dashboard.
- **Vercel** (Hosting). Create the Vercel project first.
  - `VERCEL_TOKEN`: Account Settings → Tokens, scoped to your team.
  - `VERCEL_ORG_ID`: the team's Settings → General → Vercel ID.
  - `VERCEL_PROJECT_ID`: the project's Settings → General → Project ID.
  - `VERCEL_AUTOMATION_BYPASS_SECRET`: the project's Deployment Protection → Protection Bypass for Automation.
  - `DEVOS_PRODUCTION_URL`: in the Vercel project's Production environment, the production address with no trailing
    slash.

**Keys the product itself reads** (the providers of section 4):

- Stripe: dashboard.stripe.com/apikeys (`STRIPE_SECRET_KEY`), and Developers → Webhooks → your endpoint → Signing
  secret (`STRIPE_WEBHOOK_SECRET`).
- Paddle: vendors.paddle.com/authentication.
- Lemon Squeezy: app.lemonsqueezy.com/settings/api.
- PayPal: developer.paypal.com/dashboard/applications → your app (client id and secret).
- RevenueCat: app.revenuecat.com → Project settings → API keys.
- Resend: resend.com/api-keys.
- Postmark: account.postmarkapp.com → Servers → your server → API tokens.
- Amazon SES and S3: an access key from AWS IAM (Users → Security credentials → Create access key), the region of
  your SES identity, and the bucket name in S3.
- Upstash: console.upstash.com → your database → REST API (URL and token).
- Redis for BullMQ: your provider's `redis://` connection string.
- Meilisearch: your instance's public URL, and Settings → API keys.
- Vercel Blob: the project's Storage → Blob store → `.env.local`.
- Sentry: your project's Client Keys (DSN), and Settings → Auth tokens.
- Product AI: the API key of the provider's account the product uses.

## 8. GitHub

- [ ] **The account that owns the project.** The setup creates the repository under the account the GitHub CLI is
  signed in to, or under the owner set with `devos profile set github_owner <owner>`. The repository is named after
  the project's key in lower case (`MY-SHOP` becomes `my-shop`). If a repository of that name already exists, it must
  have no commits.
- [ ] **Visibility,** as in section 5. In a private repository, the cycle's GitHub Actions minutes and artifact
  storage count against your GitHub plan; the README's
  [GitHub minutes and storage](../README.md#github-minutes-and-storage) says how to keep them low.
- [ ] **Optional: `DEVOS_PAT`**, for method fixes that change a workflow. GitHub's own runner token cannot push a
  change to `.github/workflows/`.
  - Create a fine-grained personal access token with access to this repository only.
  - Give it Read and write on Contents, Pull requests, Issues, Actions, Commit statuses and Workflows.
  - Add it as the repository secret `DEVOS_PAT`.

At the **GitHub** step, the setup shows the plan and acts only when you confirm. It then:
- commits the folder;
- creates the repository and pushes it;
- sets the workflow permissions, the labels, the variables and the secrets;
- runs the setup check;
- starts the first cycle.

## 9. What comes after setup

These need no answer now, but they shape the work.

- **The blueprint.** The blueprint agent writes the project's documents and its first task, and you approve them or
  describe the changes you want, for up to five rounds. Set aside time to read them.
- **You merge at the gates.** A task that passes review still waits for your merge in these cases:
  - it is high risk (risk 3), or it is a gate task;
  - it changes the database schema: every migration waits for your merge;
  - it touches money flows, which need your review before launch.
- **Personal data.** Decide whether the product keeps personal data, and say so in your brief or business rules, so
  the blueprint plans for it.
- **Usage.** Every agent run's tokens are recorded in `docs/usage/` and summed in `docs/USAGE.md`.
- **Settings you can change later:**
  - the account each tool starts with, and the switch at a usage limit (`DEVOS_ACCOUNT_SWITCH`);
  - each role's model (`DEVOS_REVIEWER_MODEL`, `DEVOS_REVIEWER_LIGHT_MODEL`, `DEVOS_BUILDER_MODEL`, or `devos models`);
  - each role's next models at a usage limit: up to 4 more models of its tool (`devos models fallback`, or **Next
    models** in the project's Models panel, by pull request);
  - the Control Tower link (`DEVOS_REPORTING`, or **Connect** on the project's page; the project asks the Control
    Tower when the link's pull request is merged, or with **Ask the Control Tower now**);
  - pausing the project while you are not working on it (`DEVOS_PAUSED`);
  - how many days a cycle run's screenshots are kept (`DEVOS_SCREENS_RETENTION_DAYS`, 3).

  The README's [Settings you can change on GitHub](../README.md#settings-you-can-change-on-github) has the everyday
  ones, and the project's `docs/method/AUTOMATION.md` lists every setting.

## 10. The worksheet

Copy this into a file of your own and fill it in. Never write a key in it.

```
DEV_OS project worksheet

This computer:   Node 22+ [ ]  git [ ]  gh signed in, repo + workflow [ ]  AI CLI signed in: ____________
Projects folder: ______________________________

Agents
  Reviewer:        tool ________  model ________________
  Light reviewer:  tool ________  model ________________  (or the same as the reviewer)
  Builders:        tool ________  model ________________  good at: ____________________  default [ ]
                   tool ________  model ________________  good at: ____________________  default [ ]
  Who picks:       the reviewer [ ]  always the default [ ]
  Blueprint agent: ________
  Keys ready:      Cursor [ ]  Claude [ ]  Codex [ ]  Gemini [ ]   second accounts: ____________
  Control Tower link: yes [ ]  no [ ]

Project
  Type:   ______________________   Stack: ______________________
  Scope:  MVP [ ]  Full product for production [ ]
  Modules (provider or None):
    Database ________  Storage ________  Auth ________  Payments ________  Email ________
    Jobs ________  Search ________  Product AI ________  Hosting ________  Observability ________

Details
  Name:        ______________________   (key: ____________)
  Brief:       __________________________________________________________________
  Who uses it: __________________________________________________________________
  Languages:   ________   Visibility: private [ ]  public [ ]

Files to attach
  Brief / PRD [ ]  Design references [ ]  Flows [ ]  Brand [ ]  Content [ ]
  Data and API notes [ ]  Business rules [ ]  Similar products [ ]

Services created and keys ready (names only)
  ______________________________________________________________________________

GitHub
  Owner account: ____________   DEVOS_PAT for method fixes: yes [ ]  later [ ]
  Personal data kept: yes [ ]  no [ ]   Notes: ______________________________
```
