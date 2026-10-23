import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requiredSecretNames } from './wizard.mjs';
import { loadCatalogue } from './catalogue.mjs';

// The keys-and-tokens onboarding. One rule above all: a key value is typed only
// into the terminal prompt gh opens (it hides what you type). It never appears in
// a chat, an email, an issue, or this file. This module deals in NAMES only.

// Where each known secret comes from. Anything unknown falls back to SETUP.md
// and the provider's own dashboard.
const KEY_SOURCES = {
  CURSOR_API_KEY: 'Cursor dashboard → https://cursor.com/dashboard → API keys → Create key.',
  CLAUDE_CODE_OAUTH_TOKEN: 'Claude Code long-lived token: run `claude setup-token` in a terminal (Claude Pro/Max), or use an API key from https://console.anthropic.com/settings/keys.',
  ANTHROPIC_API_KEY: 'Anthropic Console → https://console.anthropic.com/settings/keys → Create key.',
  OPENAI_API_KEY: 'OpenAI platform → https://platform.openai.com/api-keys → Create new secret key.',
  GEMINI_API_KEY: 'Google AI Studio → https://aistudio.google.com/apikey → Create API key.',
  ZAI_API_KEY: 'Z.ai console → https://z.ai/manage-apikey/apikey-list → Create API key.',
  VERCEL_TOKEN: 'Vercel → https://vercel.com/account/settings/tokens → Create token (scope it to the team).',
  VERCEL_ORG_ID: 'Vercel → your team Settings → General → Vercel ID.',
  VERCEL_PROJECT_ID: 'Vercel → the project Settings → General → Project ID.',
  CLOUDFLARE_API_TOKEN: 'Cloudflare → https://dash.cloudflare.com/profile/api-tokens → Create token (Workers template).',
  FLY_API_TOKEN: 'Fly.io → run `flyctl tokens create deploy` or create a token at https://fly.io/user/personal-access-tokens.',
  RAILWAY_TOKEN: 'Railway → https://railway.com/account → Tokens → Create.',
  DOCKER_REGISTRY_TOKEN: 'Docker Hub → https://app.docker.com/settings/personal-access-tokens → Create token.',
  SUPABASE_ACCESS_TOKEN: 'Supabase → https://supabase.com/dashboard/account/tokens → Generate new token.',
  SUPABASE_DB_URL: 'Supabase → your project → Settings → Database → Connection string (session pooler).',
  FIREBASE_PROJECT_ID: 'Firebase console → https://console.firebase.google.com → your project → Settings → Project ID.',
  FIREBASE_SERVICE_ACCOUNT: 'Firebase console → Project settings → Service accounts → Generate new private key (a JSON file — paste the whole JSON content at the gh prompt).',
  NEON_DATABASE_URL: 'Neon → https://console.neon.tech → your project → Connection string.',
  DATABASE_URL: 'Your own Postgres host → the full postgres:// connection string.',
  MONGODB_URI: 'MongoDB Atlas → https://cloud.mongodb.com → Connect → Drivers → the connection string.',
  R2_ACCOUNT_ID: 'Cloudflare → https://dash.cloudflare.com → R2 → Account details → Account ID.',
  R2_ACCESS_KEY_ID: 'Cloudflare → R2 → Manage R2 API tokens → Create API token (Object Read & Write).',
  R2_SECRET_ACCESS_KEY: 'Shown once when the R2 token is created.',
  S3_BUCKET: 'Your S3 bucket name (AWS console → S3).',
  S3_ACCESS_KEY_ID: 'AWS IAM → https://console.aws.amazon.com/iam → Users → Security credentials → Create access key.',
  S3_SECRET_ACCESS_KEY: 'Shown once when the AWS access key is created.',
  BETTER_AUTH_SECRET: 'Generate it locally, never online: PowerShell `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))` or bash `openssl rand -base64 32`.',
  CLERK_SECRET_KEY: 'Clerk dashboard → https://dashboard.clerk.com → API Keys → Secret key.',
  STRIPE_SECRET_KEY: 'Stripe → https://dashboard.stripe.com/apikeys → Secret key (live or test).',
  STRIPE_WEBHOOK_SECRET: 'Stripe → Developers → Webhooks → your endpoint → Signing secret.',
  PADDLE_API_KEY: 'Paddle → https://vendors.paddle.com/authentication → Create API key.',
  LEMONSQUEEZY_API_KEY: 'Lemon Squeezy → https://app.lemonsqueezy.com/settings/api → Create API key.',
  PAYPAL_CLIENT_ID: 'PayPal developer → https://developer.paypal.com/dashboard/applications → your app → Client ID.',
  PAYPAL_CLIENT_SECRET: 'PayPal developer → your app → Secret (shown once per view).',
  REVENUECAT_API_KEY: 'RevenueCat → https://app.revenuecat.com → Project settings → API keys.',
  RESEND_API_KEY: 'Resend → https://resend.com/api-keys → Create API key.',
  POSTMARK_API_KEY: 'Postmark → https://account.postmarkapp.com → Servers → your server → API tokens.',
  AWS_ACCESS_KEY_ID: 'AWS IAM → Users → Security credentials → Create access key.',
  AWS_SECRET_ACCESS_KEY: 'Shown once when the AWS access key is created.',
  AWS_REGION: 'The AWS region your SES identity lives in, for example us-east-1.',
  UPSTASH_REDIS_URL: 'Upstash → https://console.upstash.com → your database → REST API.',
  UPSTASH_REDIS_TOKEN: 'Upstash → your database → REST API → token.',
  REDIS_URL: 'Your Redis provider → the redis:// connection string.',
  MEILISEARCH_HOST: 'Your Meilisearch instance → the public URL.',
  MEILISEARCH_API_KEY: 'Your Meilisearch instance → Settings → API keys.',
  BLOB_READ_WRITE_TOKEN: 'Vercel → your project → Storage → Blob store → `.env.local` tab.',
  SENTRY_DSN: 'Sentry → https://sentry.io → your project → Client Keys (DSN).',
  SENTRY_AUTH_TOKEN: 'Sentry → Settings → Auth tokens → Create new token.',
  PRODUCT_AI_API_KEY: 'Your product-AI provider → the API key for the account the product uses.',
  PRODUCT_AI_BASE_URL: 'Your product-AI provider → the base URL of its API.',
};

export function keySource(name) {
  return KEY_SOURCES[name] || 'See SETUP.md in the project and the provider dashboard for this key.';
}

// Every secret the project needs, as {name, what, where}.
// Answers carry the models and modules; no secret value ever appears here.
export function keyCatalog(answers) {
  const names = requiredSecretNames(answers);
  const seen = new Set();
  const out = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, where: keySource(name) });
  }
  return out;
}

// The keys the CYCLE actually authenticates with: the agent credentials of the
// tools the user SELECTED (reviewer, builder, extra builders). Module keys
// (Supabase, Resend, Vercel, …) belong to the app, not to the cycle run — a
// report that blames an unselected tool's key is noise, and this helper is the
// filter every cycle-side check reports through.
export function selectedToolSecrets(answers) {
  const catalogue = loadCatalogue();
  const names = [];
  const toolSecrets = (cli) => {
    const tool = catalogue.tools.find((t) => t.id === cli || t.command === cli || (t.altCommands || []).includes(cli));
    return tool?.githubSecrets || [];
  };
  const rows = [
    answers.models?.reviewer?.cli,
    answers.models?.builder?.cli,
    ...(answers.models?.extraBuilders || []).map((b) => b?.cli),
  ];
  for (const cli of rows) {
    if (!cli) continue;
    for (const n of toolSecrets(cli)) if (!names.includes(n)) names.push(n);
  }
  return names;
}

// gh secret list is the only way to see what is set; values are unreadable, ever.
export function listGithubSecrets(repo, { run } = {}) {
  const exec = run || ((cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
  });
  const r = exec('gh', ['secret', 'list', '--repo', repo, '--json', 'name']);
  if (r.code !== 0) return { ok: false, error: (r.err || 'gh secret list failed').trim() };
  try {
    const parsed = JSON.parse(r.out || '[]');
    return { ok: true, names: parsed.map((x) => String(x.name || '')) };
  } catch {
    return { ok: false, error: 'gh secret list returned something unexpected.' };
  }
}

export function checkKeys({ repo, answers, run }) {
  const needed = keyCatalog(answers);
  const listed = listGithubSecrets(repo, { run });
  if (!listed.ok) return { ok: false, error: listed.error, needed: needed.map((k) => k.name) };
  const set = new Set(listed.names);
  const keys = needed.map((k) => ({ ...k, set: set.has(k.name) }));
  return {
    ok: true,
    repo,
    keys,
    missing: keys.filter((k) => !k.set).map((k) => k.name),
    setCount: keys.filter((k) => k.set).length,
  };
}

function commandFor(name, repo) {
  return `gh secret set ${name} --repo ${repo}`;
}

export function keysNotesMarkdown(answers, { repo, now = new Date().toISOString() } = {}) {
  const keys = keyCatalog(answers);
  const name = answers.project?.name || 'the project';
  const slug = repo || answers.project?.slug || 'owner/name';
  const lines = [];
  lines.push(`# Keys and tokens — ${name}`);
  lines.push('');
  lines.push(`Written by \`devos keys\` on ${now}. This file holds NAMES and INSTRUCTIONS ONLY.`);
  lines.push('');
  lines.push('## The four rules');
  lines.push('');
  lines.push('1. **Nothing in chat.** The configuration model never sees a key value. You never paste a key into any conversation, email, or GitHub issue — not even to "check it".');
  lines.push('2. **Three places only.** A value is typed into the wizard window\'s Missing keys card (it travels browser → `gh secret set` and nowhere else), pasted into `devos/secrets.local.json` (gitignored — it never leaves this folder; the ENGINE uploads it), or typed into the hidden prompt `gh` opens. Nothing else, ever.');
  lines.push('3. **This file never holds values.** Tick the checkbox after a key is set. If you keep a private copy of values, keep it in your password manager — never in this folder, never committed.');
  lines.push('4. **Verify with the checker.** `devos keys --check` compares GitHub\'s own list with what this project needs.');
  lines.push('');
  lines.push('## Set one key (30 seconds)');
  lines.push('');
  lines.push('Preferred — the Missing keys card in the wizard window (UI runs open it automatically):');
  lines.push('');
  lines.push('```');
  lines.push('1. Type each value into the password field named like the key, press Submit.');
  lines.push('   The engine uploads every value to GitHub and re-checks its list;');
  lines.push('   the card re-opens carrying only the keys still missing, until all are set.');
  lines.push('```');
  lines.push('');
  lines.push('Terminal paths — the local file or gh\'s own hidden prompt:');
  lines.push('');
  lines.push('```');
  lines.push('1. Paste the value into devos/secrets.local.json -> "SECRET_NAME" and save.');
  lines.push('2. devos continue        # waits for the file and uploads each key as it lands');
  lines.push('   devos keys --push     # uploads what is filled, without waiting');
  lines.push('```');
  lines.push('');
  lines.push('Terminal habit — gh\'s own hidden prompt:');
  lines.push('');
  lines.push('Open PowerShell (Windows) or a terminal (macOS/Linux), then:');
  lines.push('');
  lines.push('```powershell');
  lines.push('# gh asks for the value; paste it and press Enter. Nothing is echoed.');
  lines.push(`gh secret set SECRET_NAME --repo ${slug}`);
  lines.push('');
  lines.push('# Prefer piping from a file instead of typing? The value still never touches chat:');
  lines.push(`Get-Content .\\cursor-key.txt | gh secret set CURSOR_API_KEY --repo ${slug}`);
  lines.push('```');
  lines.push('');
  lines.push('```bash');
  lines.push(`gh secret set SECRET_NAME --repo ${slug}`);
  lines.push('```');
  lines.push('');
  lines.push(`If you run the command from another folder, keep the \`--repo ${slug}\` part.`);
  lines.push('');
  lines.push(`## Keys this project needs (${keys.length})`);
  lines.push('');
  if (!keys.length) {
    lines.push('None. Your reviewer, builder, and modules carry no provider secrets.');
    lines.push('');
  }
  for (const k of keys) {
    lines.push(`### ${k.name}`);
    lines.push('');
    lines.push(`- Where to get it: ${k.where}`);
    lines.push(`- Set it: \`${commandFor(k.name, slug)}\``);
    lines.push('- [ ] set');
    lines.push('');
  }
  lines.push('## Where each key lands');
  lines.push('');
  lines.push(`- **GitHub (every key above)** — becomes an Actions secret on \`${slug}\`. The workflows read only these.`);
  lines.push('- **Vercel** — the deploy runs in GitHub Actions with VERCEL_TOKEN; you do not also need the Vercel dashboard. The same token can be added inside Vercel for local runs, by you, in the Vercel dashboard.');
  lines.push('- **Supabase** — create SUPABASE_ACCESS_TOKEN in the Supabase dashboard, then set it on GitHub with the command above. SUPABASE_DB_URL comes from Project Settings → Database.');
  lines.push('- **Firebase** — generate the service-account JSON, then pipe the whole JSON file into gh: `Get-Content .\\service-account.json | gh secret set FIREBASE_SERVICE_ACCOUNT --repo ' + slug + '`.');
  lines.push('- **Stripe, Resend, Upstash, …** — same pattern every time: create the key on the provider dashboard, then one `gh secret set` per name.');
  lines.push('');
  lines.push('## Verify');
  lines.push('');
  lines.push('```powershell');
  lines.push('devos keys --check          # from the project folder (or: devos keys --check --project <folder>)');
  lines.push(`gh secret list --repo ${slug}`);
  lines.push('```');
  lines.push('');
  lines.push('`devos keys --check` prints ready / MISSING per name and exits 1 while something is missing.');
  lines.push('');
  lines.push('## After every key is set');
  lines.push('');
  lines.push('- If `devos init` finished: nothing to do — the next cycle run picks the secrets up automatically.');
  lines.push('- If init stopped early: `devos init --continue <folder>` returns to the configuration model, which verifies and finishes.');
  lines.push('');
  return lines.join('\n');
}

// devos keys — write (or refresh) the guide next to the answers.
export function writeKeysNotes(projectDir, answers) {
  const dir = join(projectDir, 'devos');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'KEYS-NOTES.example.md');
  writeFileSync(file, keysNotesMarkdown(answers));
  return file;
}

export function readAnswersFromProject(projectDir) {
  const f = join(projectDir, 'devos', 'answers.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
