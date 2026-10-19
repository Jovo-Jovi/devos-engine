#!/usr/bin/env node
// The evidence pack (PR-22): everything the runner already knows about this attempt, in one file the
// reviewer reads instead of re-running it. Runner-generated and deterministic, so it is trusted
// evidence; the builder's report stays a claim.
//
// Usage: node scripts/devos/evidence.mjs --task T12 --attempt 1
// Writes .devos/evidence.md
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { P, config, parsePhases } from "./lib.mjs";
import { reviewPlan, branchChanges } from "./review-mode.mjs";
import { isActive, readEnvFile } from "./supabase.mjs";
import { motionSummary } from "./screens.mjs";
import * as r2 from "./r2.mjs";
import * as fb from "./firebase.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? "") : ""; };
const task = arg("task");
const attempt = arg("attempt") || "1";
const base = `origin/${config().base_branch ?? "main"}`;
const out = [];
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: P(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
  return { ok: r.status === 0, text: `${r.stdout ?? ""}${r.status === 0 ? "" : r.stderr ?? ""}`.trim() };
};
const tail = (text, n) => String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
const block = (text) => ["```", text || "(empty)", "```"];

out.push(`# Evidence pack — ${task} attempt ${attempt}`, "",
  "Runner-generated after the build and the checks (PR-22). Trust it as evidence; re-run something only where it is missing, contradicts the report, or sits in a critical path of a deep review.", "");

// Review plan (the same decision review-mode.mjs gives the workflow)
const row = parsePhases().rows.find((r) => r.task === task);
if (row) {
  const plan = reviewPlan(row, branchChanges(), Number(attempt));
  out.push("## Review plan", "", `- Mode: **${plan.mode}** (${plan.model}, effort ${plan.effort}, up to ${plan.max_turns} turns) — ${plan.reasons.join("; ")}`);
  if (plan.critical.length) out.push(`- Critical paths in this diff (read every changed line): ${plan.critical.map((p) => `\`${p}\``).join(", ")}`);
  out.push("");
}

// Commit and diff
out.push("## Commit", "", `- HEAD \`${sh("git", ["rev-parse", "HEAD"]).text}\` · base \`${base}\` \`${sh("git", ["rev-parse", base]).text}\``,
  `- Size: ${sh("git", ["diff", "--shortstat", `${base}...HEAD`]).text || "no change"}`, "", "Changed files:", ...block(sh("git", ["diff", "--name-status", `${base}...HEAD`]).text), "");

// Checks
let ci = null;
try { ci = JSON.parse(readFileSync(P(".devos/ci-results.json"), "utf8")); } catch { /* none */ }
out.push("## Checks (`.devos/ci-results.json`)", "");
if (!ci) out.push("No check results: treat every check as unproven.", "");
else {
  out.push(`All required passed: **${ci.all_required_passed ? "yes" : "NO"}**${ci.failed_required?.length ? ` (failed: ${ci.failed_required.join(", ")})` : ""}. Red overrides PASS (PR-08).`, "",
    "| Check | Required | Status | Seconds |", "|---|---|---|---|",
    ...(ci.results ?? []).map((r) => `| ${r.name} | ${r.required ? "yes" : "no"} | ${r.status} | ${r.seconds ?? ""} |`), "");
  for (const r of (ci.results ?? []).filter((x) => x.status !== "pass" && !String(x.status).startsWith("skipped"))) {
    out.push(`Tail of **${r.name}**:`, ...block(tail(r.tail, 25)), "");
  }
  const testLog = existsSync(P(".devos/logs/test.log")) ? readFileSync(P(".devos/logs/test.log"), "utf8") : "";
  const summary = testLog.split(/\r?\n/).filter((l) => /Test Files|Tests\s+\d/.test(l)).join("\n");
  if (summary) out.push("Unit tests:", ...block(tail(summary, 4)), "");
  const e2eLog = existsSync(P(".devos/logs/e2e.log")) ? readFileSync(P(".devos/logs/e2e.log"), "utf8") : "";
  const e2e = e2eLog.split(/\r?\n/).filter((l) => /\d+ (passed|failed|flaky|skipped)/.test(l)).join("\n");
  if (e2e) out.push("End-to-end:", ...block(tail(e2e, 4)), "");
}

// Guards
out.push("## Guards (run now)", "", ...block(sh("node", ["scripts/guards/run-all.mjs"]).text), "");
if (existsSync(P(".devos/surface-warnings.txt"))) out.push("Surface warnings:", ...block(readFileSync(P(".devos/surface-warnings.txt"), "utf8").trim()), "");

// Builder report
const report = P(`docs/reports/${task}.md`);
if (existsSync(report)) {
  const text = readFileSync(report, "utf8");
  const sec = text.split(/^## Attempt /m).pop() ?? "";
  const status = /STATUS:\s*(DONE|HALT)/.exec(sec)?.[1] ?? "not stated";
  out.push("## Builder report", "", `- \`docs/reports/${task}.md\`, attempt section: STATUS **${status}**, ${sec.split(/\r?\n/).length} lines. It is a claim: accept its pasted outputs where they agree with this pack.`, "");
} else out.push("## Builder report", "", `- **Missing**: \`docs/reports/${task}.md\` does not exist.`, "");

// Data layer
if (isActive()) {
  out.push("## Data layer (local Supabase of this run)", "");
  const mig = sh("git", ["diff", "--name-status", `${base}...HEAD`, "--", "supabase/migrations"]).text;
  out.push("Migrations in this diff:", ...block(mig || "none"), "");
  const dbt = existsSync(P(".devos/logs/db-test.log")) ? readFileSync(P(".devos/logs/db-test.log"), "utf8") : "";
  out.push("`supabase test db` (tail):", ...block(tail(dbt, 8)), "");
  const env = { ...process.env, ...readEnvFile() };
  if (env.SUPABASE_DB_URL) {
    const q = (sql) => sh("psql", [env.SUPABASE_DB_URL, "-X", "-A", "-F", " | ", "-P", "footer=off", "-c", sql], { env });
    out.push("Row level security per public table:", ...block(q("select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1").text), "");
    out.push("Policies:", ...block(q("select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2").text), "");
    out.push("Table grants to anon and authenticated:", ...block(q("select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1, 2 order by 1, 2").text), "");
  } else out.push("No local database URL: policies not dumped.", "");
}

// Storage and Firebase modules (PR-26)
if (r2.isActive()) {
  const log = existsSync(P(".devos/logs/storage.log")) ? readFileSync(P(".devos/logs/storage.log"), "utf8") : "";
  out.push("## Storage module (local S3 store of this run)", "",
    "Store round trip and the app's storage tests (tail):", ...block(tail(log, 12)), "",
    "Server-only storage code in this diff:", ...block(sh("git", ["diff", "--name-status", `${base}...HEAD`, "--", "src/lib/r2"]).text || "none"), "");
}
if (fb.isActive()) {
  const seedLog = existsSync(P(".devos/logs/firestore-seed.log")) ? readFileSync(P(".devos/logs/firestore-seed.log"), "utf8") : "";
  const rulesLog = existsSync(P(".devos/logs/firestore-rules.log")) ? readFileSync(P(".devos/logs/firestore-rules.log"), "utf8") : "";
  out.push("## Firebase module (Firestore emulator of this run)", "",
    `Rules files: ${fb.rulesFiles().map((f) => `\`${f}\``).join(", ")}. A change to one stops at the human gate.`, "",
    "Rules changes in this diff:", ...block(sh("git", ["diff", `${base}...HEAD`, "--", ...fb.rulesFiles()]).text || "none"), "",
    "Seed loaded into the emulator:", ...block(tail(seedLog, 10)), "",
    "Rules tests (tail):", ...block(tail(rulesLog, 10)), "");
}

// Secrets in the browser bundle
const hits = [];
const SECRET_NAMES = /SUPABASE_SECRET_KEY|service_role|sb_secret_|SUPABASE_DB_URL|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|FIREBASE_SERVICE_ACCOUNT|"private_key"/;
const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); statSync(f).isDirectory() ? walk(f) : /\.(js|html|json|map)$/.test(n) && SECRET_NAMES.test(readFileSync(f, "utf8")) && hits.push(f.slice(P().length + 1)); } };
if (existsSync(P(".next/static"))) { walk(P(".next/static")); out.push("## Browser bundle", "", hits.length ? `**Secret names found in .next/static:** ${hits.join(", ")}` : "No secret key names in `.next/static` (searched the Supabase, R2 and Firebase key names and private_key).", ""); }

// Screens and motion (PR-35)
if (existsSync(P(".devos/screens"))) {
  const shots = readdirSync(P(".devos/screens")).filter((f) => f.endsWith(".png"));
  const src = existsSync(P(".devos/screens/SOURCE.txt")) ? readFileSync(P(".devos/screens/SOURCE.txt"), "utf8").trim() : "";
  const manifestPath = P(".devos/screens/motion.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    out.push("## Screenshots and motion", "",
      `- Source: ${manifest.source}`,
      `- States from: \`${manifest.states_from}\``,
      "",
      ...motionSummary(manifest),
      "");
  } else {
    out.push("## Screenshots and motion", "",
      `${shots.length} in \`.devos/screens/\`. ${src}`,
      "No motion manifest: motion is unproven.", "");
  }
}

writeFileSync(P(".devos/evidence.md"), out.join("\n") + "\n");
console.log(`evidence: wrote .devos/evidence.md (${out.length} lines)`);
