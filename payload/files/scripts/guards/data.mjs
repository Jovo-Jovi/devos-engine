// guard:data — the data layer's rules (PR-17). N/A until the tree has supabase/.
//
//   1. Migration files are named <14-digit timestamp>_<snake_name>.sql.
//   2. A migration that exists on main is never edited, renamed or deleted (forward-only).
//   3. Every table a migration creates in the public schema has row level security enabled, and
//      no migration disables it.
//   4. A SECURITY DEFINER function sets its search_path.
//   5. The anon role is never granted insert, update, delete, truncate or all.
//   6. The secret (service-role) key is read only in server-only modules, and never through a
//      NEXT_PUBLIC_ name.
//   7. Seeds are synthetic: every email address in supabase/seed.sql uses a reserved domain.
//   8. Migrations come with pgTAP tests in supabase/tests/.
import { execFileSync } from "node:child_process";
import { exists, read, walk, repoFiles, result, P } from "./lib.mjs";

const MIGRATIONS = "supabase/migrations";
const NAME_RE = /^\d{14}_[a-z0-9_]+\.sql$/;
const RESERVED_EMAIL = /@([a-z0-9-]+\.)*(example\.(com|org|net)|test|invalid|localhost)$/i;

const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const tableName = (raw) => raw.replace(/"/g, "").toLowerCase().replace(/^public\./, "");

function git(args) {
  return execFileSync("git", args, { cwd: P(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** Migrations on the base branch, as { path: content }; null when the base is not available. */
function baseMigrations() {
  for (const ref of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref]);
      const files = git(["ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS]).split("\n").filter(Boolean);
      const out = {};
      for (const f of files) out[f] = git(["show", `${ref}:${f}`]);
      return { ref, files: out };
    } catch { /* try the next ref */ }
  }
  return null;
}

export default function data() {
  if (!exists("supabase")) return result("N/A", [], "no supabase/ in the tree (module not active)");
  const findings = [];
  const notes = [];
  const migrations = walk(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  // 1. Names.
  for (const f of migrations) {
    const name = f.slice(MIGRATIONS.length + 1);
    if (!NAME_RE.test(name)) findings.push(`${f} — migration name must be <YYYYMMDDHHMMSS>_<snake_name>.sql`);
  }

  // 2. Forward-only.
  const base = baseMigrations();
  if (!base) notes.push("base branch not available: immutability not checked");
  else {
    for (const [f, content] of Object.entries(base.files)) {
      if (!exists(f)) findings.push(`${f} — a migration on ${base.ref} was deleted or renamed; write a new migration instead`);
      else if (read(f).replace(/\r\n/g, "\n") !== content.replace(/\r\n/g, "\n")) findings.push(`${f} — a migration on ${base.ref} was edited; applied migrations are never changed (write a new one)`);
    }
  }

  // 3–5. Statements across all migrations.
  const all = migrations.map((f) => ({ f, sql: stripSqlComments(read(f)) }));
  const created = new Map();
  const rls = new Set();
  for (const { f, sql } of all) {
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)) {
      const raw = m[1];
      if (/^"?(auth|storage|extensions|realtime|supabase_\w+|private|internal)"?\./i.test(raw)) continue;
      created.set(tableName(raw), f);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+enable\s+row\s+level\s+security/gi)) rls.add(tableName(m[1]));
    if (/disable\s+row\s+level\s+security/i.test(sql)) findings.push(`${f} — disables row level security`);
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function[\s\S]*?(?:\$\$|\$[a-z_]*\$)[\s\S]*?(?:\$\$|\$[a-z_]*\$)[^;]*;/gi)) {
      const fn = m[0];
      if (/security\s+definer/i.test(fn) && !/set\s+search_path/i.test(fn)) {
        const name = /function\s+([\w."]+)/i.exec(fn)?.[1] ?? "?";
        findings.push(`${f} — SECURITY DEFINER function ${name} does not set search_path`);
      }
    }
    for (const m of sql.matchAll(/grant\s+([^;]*?)\s+on\s+[^;]*?\s+to\s+([^;]*);/gi)) {
      if (/\banon\b/i.test(m[2]) && /\b(all|insert|update|delete|truncate)\b/i.test(m[1])) findings.push(`${f} — grants ${m[1].trim()} to anon`);
    }
  }
  for (const [t, f] of created) if (!rls.has(t)) findings.push(`${f} — table ${t} is created without "alter table ${t} enable row level security"`);

  // 6. The secret key stays on the server.
  const src = repoFiles().filter((f) => /^src\/.*\.(t|j)sx?$/.test(f));
  for (const f of src) {
    const text = read(f);
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE)/.test(text)) findings.push(`${f} — a secret key under a NEXT_PUBLIC_ name reaches the browser`);
    if (/SUPABASE_(SECRET_KEY|SERVICE_ROLE_KEY)|service_role/.test(text)) {
      if (/^\s*["']use client["']/m.test(text)) findings.push(`${f} — a client component reads the secret key`);
      else if (!/import\s+["']server-only["']/.test(text)) findings.push(`${f} — reads the secret key without import "server-only"`);
    }
  }

  // 7. Synthetic seeds.
  if (exists("supabase/seed.sql")) {
    const emails = read("supabase/seed.sql").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    for (const e of new Set(emails)) if (!RESERVED_EMAIL.test(e)) findings.push(`supabase/seed.sql — ${e} is not on a reserved domain (example.com/.org/.net, .test); seeds are synthetic`);
  }

  // 8. Tests exist once there is a schema.
  if (migrations.length && !walk("supabase/tests").some((f) => f.endsWith(".sql"))) {
    findings.push("supabase/tests/ — migrations exist but there are no pgTAP tests (RLS must be proven by `supabase test db`)");
  }

  const note = [`${migrations.length} migration(s), ${created.size} table(s), ${rls.size} with RLS`, ...notes].join("; ");
  return result(findings.length ? "FAIL" : "PASS", findings, note);
}
