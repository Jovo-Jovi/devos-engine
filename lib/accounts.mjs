// Account, plan, and GitHub-credential probes. Answers three questions before any run:
//   1. WHO is signed in to each agent CLI (email) and on what plan.
//   2. WHICH models that account can actually run (the CLI's own model report).
//   3. Whether the gh login can really create the repository and push the workflows.
// Every probe degrades gracefully: an unreadable CLI reports "unknown", never a guess.
import { runToolSync } from './spawn.mjs';
import { which } from './which.mjs';

function run(cmd, args, timeoutMs = 8000) {
  try {
    const found = which(cmd);
    const file = found ? found.path : cmd;
    const r = runToolSync(file, args, { encoding: 'utf8', timeout: timeoutMs });
    return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
  } catch {
    return { code: -1, out: '', err: '' };
  }
}

export const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PLAN_WORD = String.raw`(?:free|hobby|pro\+|pro|ultra|team|business|enterprise|max|plus|premium)`;

// Generic parser for "account-ish" CLI output: an email plus a plan hint if one appears.
export function parseAccountText(text) {
  const t = String(text || '');
  const email = (t.match(EMAIL_RE) || [])[0] || null;
  let plan = null;
  const labeled = t.match(new RegExp(`plan[:\\s]+(${PLAN_WORD})`, 'i'));
  const paren = t.match(new RegExp(`\\((${PLAN_WORD})\\s*plan?\\)`, 'i'));
  const bare = t.match(new RegExp(`\\b(${PLAN_WORD})\\b`, 'i'));
  plan = (labeled || paren || bare)?.[1]?.toLowerCase() || null;
  return { email, plan };
}

// Per-tool commands that may print account information. Candidates are tried in order;
// a CLI that answers none is reported as unknown with guidance, never a guess.
const ACCOUNT_PROBES = {
  claude: { args: [['auth', 'status']] },
  cursor: { args: [['status'], ['whoami']] },
  codex: { args: [['login', 'status']] },
  glm: { args: [['auth', 'status'], ['whoami']] },
  muse: { args: [['auth', 'status']] },
  gemini: { args: [] }, // no known account command; the env-var fallback in probes covers sign-in
};

const cache = new Map(); // key -> { at, value }
const TTL = 60_000;
export function clearAccountCache() { cache.clear(); }

export function accountInfo(tool, cmd) {
  const candidates = (ACCOUNT_PROBES[tool.id] || {}).args || [];
  if (!cmd || !candidates.length) {
    return { signedIn: 'unknown', email: null, plan: null, detail: 'no account probe for this CLI' };
  }
  const key = `${tool.id}:${cmd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = null;
  for (const args of candidates) {
    const r = run(cmd, args);
    const text = `${r.out}\n${r.err}`.trim();
    if (r.code === 0 && text) {
      const { email, plan } = parseAccountText(text);
      value = { signedIn: true, email, plan, detail: text.split('\n')[0].slice(0, 120) };
      break;
    }
    if (/not logged in|logged out|unauthenticated|no api key/i.test(text)) {
      value = { signedIn: false, email: null, plan: null, detail: text.split('\n')[0].slice(0, 120) };
      break;
    }
  }
  if (!value) {
    value = { signedIn: 'unknown', email: null, plan: null, detail: 'the CLI did not answer its account probe; run it once interactively to confirm the account' };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Preflight for the only GitHub write the engine does: create the repository, push the
// bootstrap, set variables and secrets, dispatch the cycle. repo + workflow scopes are
// both required; the token itself is verified against the API, not assumed.
export function ghPreflight(env = process.env) {
  // gh presence is re-checked here so callers can use this standalone.
  const installed = which('gh') !== null;
  if (!installed) {
    return { installed: false, signedIn: false, login: null, tokenWorks: false, scopes: [], ok: false, problems: ['gh is not installed.'], fixes: ['Install the GitHub CLI, then run gh auth login.'] };
  }
  const st = run('gh', ['auth', 'status'], 10000);
  const text = `${st.out}\n${st.err}`;
  if (!(st.code === 0 || /logged in to/i.test(text))) {
    return { installed: true, signedIn: false, login: null, tokenWorks: false, scopes: [], ok: false, problems: ['gh is not signed in.'], fixes: ['Run: gh auth login'] };
  }
  const loginMatch = text.match(/Logged in to \S+ (?:account |as )([A-Za-z0-9-]+)/i);
  const login = loginMatch ? loginMatch[1] : null;
  const scopesLine = (text.match(/Token scopes?:\s*(.+)/i) || [])[1] || '';
  let scopes = [...scopesLine.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!scopes.length && scopesLine.trim()) {
    scopes = scopesLine.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  }
  const api = run('gh', ['api', 'user'], 10000);
  let tokenWorks = api.code === 0;
  let apiLogin = null;
  if (tokenWorks) {
    try { apiLogin = JSON.parse(api.out).login || null; } catch { /* non-JSON output: token still worked */ }
  }
  const problems = [];
  const fixes = [];
  if (!tokenWorks) {
    problems.push('gh accepted its login but the token was rejected by the GitHub API, so creating the repository would fail.');
    fixes.push('Run: gh auth login (sign in to the same account), then re-run devos init.');
  }
  const missing = ['repo', 'workflow'].filter((s) => !scopes.includes(s));
  if (missing.length) {
    problems.push(`The gh token is missing the ${missing.join(' and ')} scope${missing.length > 1 ? 's' : ''} — creating the repository or pushing the devos workflows will fail.`);
    fixes.push(`Run: gh auth refresh -h github.com -s ${missing.join(',')}`);
  }
  return { installed: true, signedIn: true, login: login || apiLogin, tokenWorks, scopes, ok: problems.length === 0, problems, fixes };
}
