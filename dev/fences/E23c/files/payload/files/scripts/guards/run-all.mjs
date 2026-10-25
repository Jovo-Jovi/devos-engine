#!/usr/bin/env node
// Run every guard (Dev OS v2 §8). Exit 1 if any guard FAILs. N/A is not PASS: a src-based guard
// reports N/A only while src/ does not exist (before T01).
// Usage: node scripts/guards/run-all.mjs [--json] [--only name,name]
import secrets from "./secrets.mjs";
import phases from "./phases.mjs";
import naming from "./naming.mjs";
import design from "./design.mjs";
import i18n from "./i18n.mjs";
import boundary from "./boundary.mjs";
import literals from "./literals.mjs";
import data from "./data.mjs";
import services from "./services.mjs";
import manual from "./manual.mjs";
import config from "./config.mjs";
import designSpec from "./design-spec.mjs";
import skills from "./skills.mjs";
import fences from "./fences.mjs";
import imports from "./imports.mjs";
import scope from "./scope.mjs";

const GUARDS = { secrets, phases, naming, design, i18n, boundary, literals, data, services, manual };
GUARDS.config = config;
GUARDS["design-spec"] = designSpec;
GUARDS.skills = skills;
GUARDS.fences = fences;
GUARDS.imports = imports;
GUARDS.scope = scope;
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(",") : Object.keys(GUARDS);

const results = {};
for (const name of only) {
  if (!GUARDS[name]) { console.error(`unknown guard: ${name}`); process.exit(2); }
  try { results[name] = GUARDS[name](); }
  catch (e) { results[name] = { status: "FAIL", findings: [`guard crashed: ${e.message}`], note: "" }; }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const [name, r] of Object.entries(results)) {
    console.log(`guard:${name.padEnd(9)} ${r.status}${r.note ? `  (${r.note})` : ""}`);
    for (const f of r.findings.slice(0, 50)) console.log(`    ${f}`);
    if (r.findings.length > 50) console.log(`    … ${r.findings.length - 50} more`);
  }
}
process.exit(Object.values(results).some((r) => r.status === "FAIL") ? 1 : 0);
