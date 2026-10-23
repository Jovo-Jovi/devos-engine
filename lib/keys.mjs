import { readFileSync } from "node:fs";
import { appKeys, methodModules } from "./catalogue.mjs";

const FILE_KEYS = new Set(["FIREBASE_DEPLOY_SERVICE_ACCOUNT", "FIREBASE_SERVICE_ACCOUNT"]);

export const KEY_SOURCES = {
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
  SUPABASE_PROJECT_REF: 'Supabase dashboard → your project → Project Settings → General → Project ID (the reference).',
  SUPABASE_DB_PASSWORD: 'The database password you set when you created the Supabase project (Project Settings → Database → Reset database password if you no longer have it).',
  DEVOS_BACKUP_PASSPHRASE: 'Any long passphrase you choose; the deploy encrypts database backups with it. Keep a copy in your password manager.',
  SUPABASE_DB_URL: 'Supabase → your project → Settings → Database → Connection string (session pooler).',
  FIREBASE_PROJECT_ID: 'Firebase console → https://console.firebase.google.com → your project → Settings → Project ID.',
  FIREBASE_SERVICE_ACCOUNT: 'Firebase console → Project settings → Service accounts → Generate new private key (a JSON file — paste the whole JSON content at the gh prompt).',
  FIREBASE_DEPLOY_SERVICE_ACCOUNT: 'Firebase console → Project settings → Service accounts → Generate new private key; give the path of the downloaded JSON file.',
  NEON_DATABASE_URL: 'Neon → https://console.neon.tech → your project → Connection string.',
  DATABASE_URL: 'Your own Postgres host → the full postgres:// connection string.',
  MONGODB_URI: 'MongoDB Atlas → https://cloud.mongodb.com → Connect → Drivers → the connection string.',
  R2_ENDPOINT: 'Cloudflare dashboard → R2 → your bucket → Settings → S3 API (https://<account id>.r2.cloudflarestorage.com).',
  R2_BUCKET: 'The name of your R2 bucket (Cloudflare dashboard → R2).',
  R2_PUBLIC_BASE_URL: 'Cloudflare dashboard → R2 → your bucket → Settings → Public access: the public URL (r2.dev or your custom domain).',
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
  return KEY_SOURCES[name] || "See SETUP.md in the project and the provider dashboard for this key.";
}

function holds(cond, answers, tools, item) {
  if (cond === "always") return true;
  if (cond === "method") return false;
  if (cond === "var:DEVOS_VERCEL") return answers?.deploy === "vercel";
  if (cond.startsWith("module:")) {
    if (!item || item.kind !== "secret") return false;
    return methodModules(answers?.modules ?? {}).includes(cond.slice(7));
  }
  if (cond.startsWith("tool:")) return tools.has(cond.slice(5));
  return false;
}

function addKey(keys, seen, name, optional) {
  if (!name || seen.has(name)) return;
  seen.add(name);
  const key = { name, optional, where: keySource(name) };
  if (FILE_KEYS.has(name)) key.file = true;
  keys.push(key);
}

export function neededKeys(setup, answers, agents) {
  const tools = new Set(
    [agents?.reviewer, agents?.reviewer_light, ...(agents?.pool ?? [])].filter(Boolean).map((agent) => agent.tool),
  );
  const items = setup?.items ?? [];
  const keys = [];
  const seen = new Set();
  for (const item of items) {
    if (item.kind !== "secret" || item.blocks !== "cycle" || !item.names?.[0]) continue;
    if (!(item.when ?? ["always"]).every((cond) => holds(cond, answers, tools, item))) continue;
    addKey(keys, seen, item.names[0], false);
  }
  for (const item of items) {
    if (item.kind !== "secret" || item.blocks !== "deploy") continue;
    if (!(item.when ?? ["always"]).every((cond) => holds(cond, answers, tools, item))) continue;
    const names = item.any ? [item.names?.[0]] : (item.names ?? []);
    for (const name of names) addKey(keys, seen, name, true);
  }
  for (const name of appKeys(answers?.modules ?? {})) addKey(keys, seen, name, true);
  return keys;
}

export async function readFileKey(key, read, stdout) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    stdout.write(`${key} — path to the JSON file (Enter to skip)\n`);
    const line = await read();
    if (line === null) return null;
    const filePath = String(line).trim();
    if (filePath === "") return "";
    try {
      const text = readFileSync(filePath, "utf8");
      JSON.parse(text);
      return text;
    } catch {
      stdout.write(`devos: ${key}: ${filePath} is not a readable JSON file\n`);
    }
  }
  return "";
}
