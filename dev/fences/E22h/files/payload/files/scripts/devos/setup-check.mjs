#!/usr/bin/env node
// What does the project still need from the human outside the repository? (PR-27)
//
// Reads devos/setup.json (method items) and docs/setup-items.json (product items, written by intake),
// keeps the items the project needs now (modules in use or planned, variables turned on, an open
// method fix), and checks each by NAME: GitHub secrets and variables from the workflow's
// toJSON(secrets) / toJSON(vars), the app's Vercel Production variables through Vercel's API.
// Values are never printed, written or compared.
//
//   node scripts/devos/setup-check.mjs             → .devos/setup.md (the issue body) and .devos/setup-result.json
//   node scripts/devos/setup-check.mjs --for deploy → also exits 1 when something the deploy needs is missing
//   node scripts/devos/setup-check.mjs --for cycle  → also exits 1 when the build-and-review cycle cannot run
//
// Environment: SECRETS_JSON, VARS_JSON (from the workflow). Missing ones are treated as empty.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { P, parsePhases, isMethodRow, emit, config } from "./lib.mjs";
import { plannedModules, activeModules, chosenModules } from "./modules.mjs";

const mode = process.argv.includes("--for") ? process.argv[process.argv.indexOf("--for") + 1] : "all";
const forDeploy = mode === "deploy";
const parse = (s) => { try { return JSON.parse(s || "{}") ?? {}; } catch { return {}; } };
const secrets = parse(process.env.SECRETS_JSON);
const vars = parse(process.env.VARS_JSON);
const hasSecret = (n) => typeof secrets[n] === "string" && secrets[n].length > 0;

const load = (rel) => (existsSync(P(rel)) ? JSON.parse(readFileSync(P(rel), "utf8")).items ?? [] : []);
const items = [...load("devos/setup.json"), ...load("docs/setup-items.json").map((i) => ({ ...i, product: true }))];

// The deploy only cares about modules that are on main now; the issue also lists what is coming.
const modules = new Set(forDeploy ? activeModules() : plannedModules());
const methodOpen = parsePhases().rows.some((r) => !r.done && isMethodRow(r));
// PR-44, PR-53: an agent tool's credentials are needed only when an agent the developer chose uses that tool,
// a method fix included (it runs on the project's own agents).
const agents = config().agents ?? {};
const toolsInUse = new Set([agents.reviewer, agents.reviewer_light, ...(agents.pool ?? [])].filter(Boolean).map((a) => a.tool));
const holds = (cond) => {
  if (cond === "always") return true;
  if (cond === "method") return methodOpen;
  if (cond.startsWith("module:")) return modules.has(cond.slice(7));
  if (cond.startsWith("var:")) return String(vars[cond.slice(4)] ?? "") === "true";
  if (cond.startsWith("tool:")) return toolsInUse.has(cond.slice(5));
  // PR-53: an item for a module the project did not choose at devos init (hosting on Vercel, say) does not apply.
  if (cond.startsWith("chosen:")) {
    const chosen = chosenModules();
    return chosen === null || chosen.has(cond.slice(7));
  }
  return false;
};
const needed = items.filter((i) => (i.when ?? ["always"]).every(holds));

// Vercel Production variable names, once, if Vercel access exists.
async function vercelNames() {
  // The job's own Vercel variables first (devos-deploy passes presence flags only, PR-32); else the bundle.
  const real = (v) => (v && v !== "1" ? v : "");
  const token = real(process.env.VERCEL_TOKEN) || real(secrets.VERCEL_TOKEN);
  const project = real(process.env.VERCEL_PROJECT_ID) || real(secrets.VERCEL_PROJECT_ID);
  const org = real(process.env.VERCEL_ORG_ID) || real(secrets.VERCEL_ORG_ID);
  if (!token || !project) return { error: "Vercel access is not set up (VERCEL_TOKEN, VERCEL_PROJECT_ID), so the site's variables cannot be checked" };
  const team = org && org.startsWith("team_") ? `&teamId=${encodeURIComponent(org)}` : "";
  try {
    const r = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env?decrypt=false${team}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: `Vercel answered ${r.status} when listing the project's variables (token, team or project id wrong?)` };
    const j = await r.json();
    const names = new Set();
    for (const e of j.envs ?? []) {
      const targets = Array.isArray(e.target) ? e.target : [e.target];
      if (targets.includes("production")) names.add(e.key);
    }
    return { names };
  } catch (err) {
    return { error: `could not reach Vercel (${err.message})` };
  }
}
const vercel = needed.some((i) => i.kind === "vercel") ? await vercelNames() : { names: new Set() };

const results = needed.map((i) => {
  let missing = [];
  let note = "";
  // PR-32: workflows pass presence flags for known names only; a secret this run was not told about
  // (a product setting) cannot be checked here, so the human confirms it instead.
  const known = i.names.filter((n) => Object.prototype.hasOwnProperty.call(secrets, n));
  if (i.kind === "secret" && !known.length) return { ...i, level: i.level ?? "required", missing: [], note: "", ok: false, unchecked: true };
  if (i.kind === "secret") missing = i.any ? (i.names.some(hasSecret) ? [] : [i.names.join(" or ")]) : i.names.filter((n) => !hasSecret(n));
  else if (i.kind === "variable") missing = i.names.filter((n) => String(vars[n] ?? "") !== String(i.value ?? "true")).map((n) => `${n}=${i.value ?? "true"}`);
  else if (i.kind === "vercel") {
    if (vercel.error) { missing = [...i.names]; note = vercel.error; }
    else missing = i.names.filter((n) => !vercel.names.has(n));
  }
  return { ...i, level: i.level ?? "required", missing, note, ok: missing.length === 0 };
});

const unchecked = results.filter((r) => r.unchecked);
const required = results.filter((r) => r.level === "required" && !r.unchecked);
const blocking = mode === "deploy" || mode === "cycle" ? required.filter((r) => r.blocks === mode) : required;
const missingRequired = blocking.filter((r) => !r.ok);
const missingRecommended = results.filter((r) => r.level !== "required" && !r.ok && !r.unchecked);
const where = { secret: "GitHub → this repository → Settings → Secrets and variables → Actions → **Secrets**", variable: "GitHub → Settings → Secrets and variables → Actions → **Variables**", vercel: "Vercel → the project → Settings → Environment Variables → **Production**" };
const blocksText = { cycle: "the build-and-review cycle", deploy: "production deploys", none: "nothing yet" };

const entry = (r) => [
  `- [ ] **${r.title}**${r.product ? " (this product)" : ""} — missing: ${r.missing.map((m) => `\`${m}\``).join(", ")} · blocks ${blocksText[r.blocks] ?? r.blocks}`,
  `  - Where: ${where[r.kind] ?? r.kind}`,
  ...(r.note ? [`  - Note: ${r.note}`] : []),
  ...(r.steps ?? []).map((s, n) => `  ${n + 1}. ${s}`),
].join("\n");

const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : "local";
const md = [
  missingRequired.length ? `**${missingRequired.length} setting${missingRequired.length > 1 ? "s" : ""} outside the repository ${missingRequired.length > 1 ? "are" : "is"} missing.** Only you can add ${missingRequired.length > 1 ? "them" : "it"}: the agents never hold account access or keys.` : "**Everything the project needs outside the repository is in place.**",
  "",
  `<sub>Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on \`${sha}\`. Names only: values are never read. Modules in use or planned: ${[...modules].join(", ") || "none"}.</sub>`,
  "",
  ...(missingRequired.length ? ["## Needed", "", ...missingRequired.map(entry), ""] : []),
  ...(missingRecommended.length ? ["## Recommended", "", ...missingRecommended.map(entry), ""] : []),
  ...(unchecked.length ? ["## Please confirm (product settings the runner cannot see)", "",
    ...unchecked.map((r) => [`- [ ] **${r.title}** — \`${r.names.join("`, `")}\` · blocks ${blocksText[r.blocks] ?? r.blocks}`, `  - Where: ${where[r.kind] ?? r.kind}`, ...(r.steps ?? []).map((x, n) => `  ${n + 1}. ${x}`)].join("\n")), ""] : []),
  "## How it continues",
  "",
  "When you have added them, nothing else is needed: the runner checks again every two hours and on every push to main, closes this issue, re-runs a production deploy that failed for lack of them, and resumes any task waiting on setup (label `devos:setup-wait`). To check right away, comment `/devos setup` here.",
  "",
  "Problems **inside** the repository (a missing package script, config file or environment name in the code) are not listed here: the reviewer sends them back to Grok as a failed attempt with the fix to make.",
  "",
  `<details><summary>Already in place (${results.filter((r) => r.ok).length})</summary>`,
  "",
  ...results.filter((r) => r.ok).map((r) => `- ✓ ${r.title}`),
  "",
  "</details>",
  "",
  "<!-- devos-setup -->",
].join("\n");

mkdirSync(P(".devos"), { recursive: true });
writeFileSync(P(".devos/setup.md"), md + "\n");
const summary = { complete: missingRequired.length === 0, for: mode, missing_required: missingRequired.map((r) => r.id), missing_recommended: missingRecommended.map((r) => r.id), modules: [...modules] };
writeFileSync(P(".devos/setup-result.json"), JSON.stringify(summary, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dev OS setup check${mode !== "all" ? ` (${mode})` : ""}\n\n${md}\n`);
for (const r of results) console.log(`${r.unchecked ? "CONFIRM" : r.ok ? "OK     " : r.level === "required" ? "MISSING" : "ADVISED"} ${r.id}${r.ok || r.unchecked ? "" : `: ${r.missing.join(", ")}`}`);
emit({ complete: summary.complete ? "true" : "false", missing: String(missingRequired.length) });
if (mode !== "all" && missingRequired.length) {
  console.log(`::error title=Dev OS::the ${mode === "deploy" ? "deploy" : "cycle"} needs settings that are missing (${missingRequired.map((r) => r.id).join(", ")}); nothing was touched. See the job summary or the 'Dev OS: setup needed' issue.`);
  process.exit(1);
}
