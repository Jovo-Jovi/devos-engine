// guard:secrets — no credential, key, token or project ref in any committable file (Dev OS §7).
import { repoFiles, scan, result, read } from "./lib.mjs";

const RULES = [
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/, label: "Anthropic key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, label: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}/, label: "GitHub fine-grained token" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key" },
  { re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, label: "JWT / service key" },
  { re: /\b(CURSOR_API_KEY|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|DEVOS_PAT|SUPABASE_SERVICE_ROLE_KEY)\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}/, label: "secret assignment" },
  { re: /\b[a-z]{20}\.supabase\.co\b/, label: "Supabase project ref" },
  { re: /\bsb_secret_[A-Za-z0-9_-]{16,}/, label: "Supabase secret key" },
  { re: /\bsbp_[a-f0-9]{32,}/, label: "Supabase access token" },
  { re: /\b(SUPABASE_SECRET_KEY|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|DEVOS_BACKUP_PASSPHRASE|VERCEL_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}/, label: "secret assignment" },
  { re: /postgres(ql)?:\/\/[^\s:]+:[^\s@]+@/, label: "connection string with password" },
  // PR-26: storage and Firebase credentials.
  { re: /\b(R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|CLOUDFLARE_API_TOKEN|FIREBASE_SERVICE_ACCOUNT|FIREBASE_DEPLOY_SERVICE_ACCOUNT)\s*[=:]\s*["']?[A-Za-z0-9_\-{]{16,}/, label: "secret assignment" },
  { re: /"type"\s*:\s*"service_account"/, label: "Google service-account key file" },
  { re: /\b[a-f0-9]{32}\.r2\.cloudflarestorage\.com\b/, label: "R2 account endpoint (keep it in secrets)" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
];
const SKIP = [/^pnpm-lock\.yaml$/, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i, /^scripts\/guards\/secrets\.mjs$/];

export default function secrets() {
  const files = repoFiles().filter((f) => !SKIP.some((s) => s.test(f)));
  const findings = scan(files, RULES, { skipComments: false });
  // PR-32: no workflow hands every secret to a step (GitHub holds such workflows as possibly malicious).
  for (const f of files.filter((x) => /^\.github\/workflows\/.+\.ya?ml$/.test(x))) {
    read(f).split(/\r?\n/).forEach((line, i) => {
      if (/toJSON\(\s*secrets\s*\)/.test(line) && !/^\s*#/.test(line)) findings.push(`${f}:${i + 1} — passes every secret to a step (toJSON(secrets)); pass presence flags for the names it needs`);
    });
  }
  // ...and each setup check is told about every secret it must check (devos/setup.json).
  if (files.includes("devos/setup.json")) {
    const items = JSON.parse(read("devos/setup.json")).items ?? [];
    const want = { "devos-setup.yml": () => true, "devos-cycle.yml": (it) => it.blocks === "cycle", "devos-deploy.yml": (it) => it.blocks === "deploy" };
    for (const [wf, pick] of Object.entries(want)) {
      const f = `.github/workflows/${wf}`;
      if (!files.includes(f)) continue;
      const text = read(f);
      for (const it of items.filter((x) => x.kind === "secret" && pick(x))) for (const n of it.names) {
        if (!text.includes(`"${n}":"\${{ secrets.${n} != ''`)) findings.push(`${f} — its SECRETS_JSON presence list lacks ${n} (devos/setup.json item ${it.id})`);
      }
    }
  }
  return result(findings.length ? "FAIL" : "PASS", findings, `${files.length} files scanned`);
}
