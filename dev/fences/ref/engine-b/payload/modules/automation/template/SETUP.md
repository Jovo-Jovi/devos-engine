# SETUP — what you type, and where it goes

Secret values are typed only into gh's own prompt, on your computer:

    gh secret set NAME --repo OWNER/SLUG

The DEV_OS engine never sees the value, and no model ever does. The configuration
model does not get an Actions secret: it runs once, at init, on your computer.

## Agent secrets

- CLAUDE_CODE_OAUTH_TOKEN
- ANTHROPIC_API_KEY
- CURSOR_API_KEY
- OPENAI_API_KEY
- GEMINI_API_KEY
- ZAI_API_KEY

Only the secrets for the GitHub reviewer tool, the GitHub builder tool, and the
modules that are on are required. A Cursor-only reviewer and builder do not ask for
a Claude token. A Claude-only pair does not ask for CURSOR_API_KEY.

## Module secrets (only for modules that are on)

- SUPABASE_ACCESS_TOKEN
- SUPABASE_DB_URL
- NEON_DATABASE_URL
- BETTER_AUTH_SECRET
- CLERK_SECRET_KEY
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- RESEND_API_KEY
- POSTMARK_API_KEY
- UPSTASH_REDIS_URL
- UPSTASH_REDIS_TOKEN
- SENTRY_DSN
- SENTRY_AUTH_TOKEN
- VERCEL_TOKEN
- FLY_API_TOKEN
- CLOUDFLARE_API_TOKEN

Where to get them: the provider's dashboard for each service named in
docs/DECISIONS.md. Names only live in .env.example; values never do.

## The agent CLIs

The devos-cycle workflow installs the agent CLIs itself, with
`scripts/devos/install-clis.mjs` (run before every cycle). You never install a
CLI on the runner by hand; locally, run the same script after a fresh clone.

## After typing secrets

Re-run the devos-cycle workflow from the Actions tab, or push any commit to main.
The setup issue closes itself when every required name is set.
