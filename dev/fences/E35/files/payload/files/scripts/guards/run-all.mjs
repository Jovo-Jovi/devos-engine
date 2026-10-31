#!/usr/bin/env node
// Run every guard (Dev OS v2 §8). Exit 1 if any guard FAILs. N/A is not PASS: a src-based guard
// reports N/A only while src/ does not exist (before T01).
// Usage: node scripts/guards/run-all.mjs [--json] [--only name,name] [--no-baseline]
//        node scripts/guards/run-all.mjs --write-baseline | --shrink-baseline
// PR-68: when devos/baseline.json exists, the findings it holds are known and pass (lib.mjs, applyBaseline);
// --no-baseline shows every finding. --write-baseline writes it once, for a project DEV_OS is added to;
// --shrink-baseline removes what is fixed and never adds.
import { writeFileSync } from "node:fs";
import { applyBaseline, BASELINE_FILE, baselineFrom, crashed, P, readBaseline, shrinkBaseline } from "./lib.mjs";
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
const flag = (name) => process.argv.includes(name);
const json = flag("--json");
const say = json ? console.error : console.log;
const writing = flag("--write-baseline");
const shrinking = flag("--shrink-baseline");
if (writing && shrinking) { console.error("use --write-baseline or --shrink-baseline, not both"); process.exit(2); }
if ((writing || shrinking) && onlyIdx >= 0) { console.error("--write-baseline and --shrink-baseline run every guard; drop --only"); process.exit(2); }

const results = {};
for (const name of only) {
  if (!GUARDS[name]) { console.error(`unknown guard: ${name}`); process.exit(2); }
  try { results[name] = GUARDS[name](); }
  catch (e) { results[name] = { status: "FAIL", findings: [`guard crashed: ${e.message}`], note: "" }; }
}

const total = (baseline) => Object.values(baseline.guards).reduce((sum, entries) => sum + Object.values(entries).reduce((a, b) => a + b, 0), 0);
let shown = results;
const baseline = readBaseline();
if (baseline?.error) {
  shown = { ...results, baseline: { status: "FAIL", findings: [baseline.error], note: "" } };
} else if (writing) {
  if (baseline) { console.error(`${BASELINE_FILE} exists; it only shrinks (--shrink-baseline)`); process.exit(2); }
  const fresh = baselineFrom(results, new Date().toISOString().slice(0, 10));
  writeFileSync(P(BASELINE_FILE), `${JSON.stringify(fresh, null, 2)}\n`);
  const names = Object.keys(fresh.guards);
  say(`${BASELINE_FILE} written: ${total(fresh)} known finding${total(fresh) === 1 ? "" : "s"}${names.length ? ` of ${names.join(", ")}` : ""}`);
  shown = applyBaseline(results, fresh);
} else if (shrinking) {
  if (!baseline) { console.error(`there is no ${BASELINE_FILE} to shrink`); process.exit(2); }
  const broken = Object.keys(baseline.guards).filter((name) => crashed(results[name]));
  if (broken.length) { console.error(`guard ${broken.join(", ")} crashed; fix it before shrinking ${BASELINE_FILE}`); process.exit(2); }
  const { baseline: smaller, removed } = shrinkBaseline(baseline, results);
  writeFileSync(P(BASELINE_FILE), `${JSON.stringify(smaller, null, 2)}\n`);
  say(`${BASELINE_FILE}: ${removed} fixed finding${removed === 1 ? "" : "s"} removed, ${total(smaller)} left`);
  shown = applyBaseline(results, smaller);
} else if (baseline && !flag("--no-baseline")) {
  shown = applyBaseline(results, baseline);
}

if (json) {
  console.log(JSON.stringify(shown, null, 2));
} else {
  for (const [name, r] of Object.entries(shown)) {
    console.log(`guard:${name.padEnd(9)} ${r.status}${r.note ? `  (${r.note})` : ""}`);
    for (const f of r.findings.slice(0, 50)) console.log(`    ${f}`);
    if (r.findings.length > 50) console.log(`    … ${r.findings.length - 50} more`);
  }
}
process.exit(Object.values(shown).some((r) => r.status === "FAIL") ? 1 : 0);
