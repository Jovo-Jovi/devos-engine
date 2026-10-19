#!/usr/bin/env node
// Enforce who may change what (PR-07). Run right after an agent finishes, before the
// runner commits. Checks uncommitted changes (tracked and untracked; ignored files are skipped).
//
//   builder  → FAIL on any change to a denied path (the cycle halts; a human looks).
//   reviewer → the reviewer's own edit permissions already block code edits, so anything outside
//              docs/reviews/** and docs/fences/** can only be a tool byproduct (e.g. `next build`
//              rewriting next-env.d.ts while the reviewer re-ran the checks). Those paths are
//              reverted and listed in .devos/surface-warnings.txt; pass --strict to FAIL instead.
//
//   intake, revise → like reviewer, with their own allow lists.
//
// Usage: node scripts/devos/guard-surfaces.mjs builder|reviewer|intake|revise [--strict]
import { rmSync, mkdirSync, appendFileSync } from "node:fs";
import { changedPaths, config, matchesAny, fail, git, P, parsePhases, isMethodRow } from "./lib.mjs";

const role = process.argv[2];
const strict = process.argv.includes("--strict");
if (!["builder", "reviewer", "intake", "revise"].includes(role)) fail("usage: guard-surfaces.mjs builder|reviewer|intake|revise [--strict]", 2);

const cfg = config();
const ignore = cfg.surfaces.ignore ?? [];
const changed = changedPaths().filter((p) => !matchesAny(p, ignore));
// PR-28: a method fix (Phase PM) may change the method files; it may not touch the product, the
// reviewer's rules or the ledgers. The workflow itself (from main) forces its human gate.
let method = false;
try { method = isMethodRow(parsePhases().rows.find((r) => r.task === process.env.TASK)); } catch { /* no ledger */ }
const builderDeny = method ? (cfg.surfaces.builder_method?.deny ?? cfg.surfaces.builder.deny) : cfg.surfaces.builder.deny;
const offenders =
  role === "builder"
    ? changed.filter((p) => matchesAny(p, builderDeny))
    : changed.filter((p) => !matchesAny(p, cfg.surfaces[role].allow));
if (role === "builder" && method) console.log("guard:surfaces(builder): method fix (Phase PM): method files allowed, product paths denied");

console.log(`guard:surfaces(${role}): ${changed.length} changed path(s)`);
for (const p of changed) console.log(`  ${offenders.includes(p) ? "✗" : "·"} ${p}`);

if (!offenders.length) {
  console.log(`guard:surfaces(${role}): PASS`);
  process.exit(0);
}

if (role === "builder" || strict) {
  console.log(`guard:surfaces(${role}): FAIL — ${offenders.length} path(s) outside the ${role}'s surface`);
  process.exit(1);
}

mkdirSync(P(".devos"), { recursive: true });
for (const p of offenders) {
  let tracked = true;
  try { git(["ls-files", "--error-unmatch", "--", p]); } catch { tracked = false; }
  if (tracked) git(["checkout", "--", p]);
  else rmSync(P(p), { force: true, recursive: true });
  appendFileSync(P(".devos/surface-warnings.txt"), `${role} run changed ${p} (reverted)\n`);
}
console.log(`guard:surfaces(${role}): PASS after reverting ${offenders.length} byproduct path(s); see .devos/surface-warnings.txt`);
