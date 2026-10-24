#!/usr/bin/env node
// Missing evidence is a failed check (PR-51). For a UI fence (a `- Screens:` line), the runner's captures in
// .devos/screens/motion.json become two required checks in .devos/ci-results.json, so red overrides PASS (PR-08):
//   ui-evidence  every state on the Screens line has an error-free capture at 1280 and 390, both screenshots on
//                disk, no layout shift, no console error and no failed request while it was captured;
//   a11y         axe (WCAG 2.2 AA tags) ran on every capture and found no violation.
// A fence without a Screens line adds nothing. Without .devos/ci-results.json the findings are only printed.
// Usage: node scripts/devos/ui-evidence.mjs --task Tnn
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { P } from "./lib.mjs";
import { parseScreensLine } from "./screens.mjs";

export const WIDTHS = [1280, 390];
export const CHECKS = ["ui-evidence", "a11y"];

/**
 * The findings for one task. `manifest` is motion.json parsed, or null when there is none; `fileExists(name)`
 * says whether a capture file is in .devos/screens/.
 */
export function uiEvidence({ task, fenceText, manifest, fileExists }) {
  const screens = parseScreensLine(fenceText);
  if (!screens.found) return { applies: false, evidence: [], a11y: [], captures: 0 };
  const evidence = screens.errors.map((error) => `Screens line: ${error}`);
  const a11y = [];
  if (!manifest) {
    const why = "no .devos/screens/motion.json: the runner took no captures (a UI project needs @playwright/test and @axe-core/playwright, docs/method/DESIGN_METHOD.md §4)";
    return { applies: true, evidence: [...evidence, why], a11y: [why], captures: 0 };
  }
  if (manifest.task !== task) evidence.push(`motion.json is for ${manifest.task || "no task"}, not ${task}`);
  const captures = manifest.captures ?? [];
  for (const state of screens.states) {
    for (const width of WIDTHS) {
      const where = `${state.name} at ${width}`;
      const capture = captures.find((c) => c.state === state.name && c.width === width);
      if (!capture) {
        evidence.push(`${where}: no capture`);
        a11y.push(`${where}: no capture`);
        continue;
      }
      if (capture.error) evidence.push(`${where}: the capture failed: ${capture.error}`);
      for (const [key, label] of [["settled", "settled"], ["reduced", "reduced-motion"]]) {
        if (!capture[key] || !fileExists(capture[key])) evidence.push(`${where}: no ${label} screenshot`);
      }
      if ((capture.layout_shift ?? 0) > 0) evidence.push(`${where}: layout shift ${capture.layout_shift}`);
      if ((capture.layout_shift_reduced ?? 0) > 0) evidence.push(`${where}: reduced-motion layout shift ${capture.layout_shift_reduced}`);
      for (const text of capture.console_errors ?? []) evidence.push(`${where}: console error: ${text}`);
      for (const text of capture.failed_requests ?? []) evidence.push(`${where}: failed request: ${text}`);
      if (!capture.a11y?.ran) {
        a11y.push(`${where}: axe did not run: ${capture.a11y?.reason || "no result"}`);
        continue;
      }
      for (const v of capture.a11y.violations ?? []) {
        a11y.push(`${where}: ${v.id} (${v.impact ?? "no impact"}) on ${v.nodes} element(s): ${v.help}${v.targets?.length ? ` — ${v.targets.join(" · ")}` : ""}`);
      }
    }
  }
  return { applies: true, evidence, a11y, captures: screens.states.length * WIDTHS.length };
}

/** ci-results.json with this task's ui-evidence and a11y results in place of any earlier ones. */
export function withChecks(ci, found, task) {
  const command = `node scripts/devos/ui-evidence.mjs --task ${task}`;
  const result = (name, findings) => ({
    name,
    required: true,
    command,
    status: findings.length ? "fail" : "pass",
    exit: findings.length ? 1 : 0,
    seconds: 0,
    tail: findings.length ? findings.join("\n") : `${found.captures} captures checked`,
  });
  const results = [...(ci.results ?? []).filter((r) => !CHECKS.includes(r.name)), result("ui-evidence", found.evidence), result("a11y", found.a11y)];
  const failed = [...(ci.failed_required ?? []).filter((name) => !CHECKS.includes(name))];
  if (found.evidence.length) failed.push("ui-evidence");
  if (found.a11y.length) failed.push("a11y");
  return { ...ci, results, failed_required: failed, all_required_passed: failed.length === 0 };
}

function main() {
  const at = process.argv.indexOf("--task");
  const task = at >= 0 ? process.argv[at + 1] ?? "" : process.env.TASK ?? "";
  if (!/^T\d{2}$/.test(task)) {
    console.error("usage: node scripts/devos/ui-evidence.mjs --task Tnn");
    process.exit(2);
  }
  const fence = P(`docs/fences/${task}.md`);
  const fenceText = existsSync(fence) ? readFileSync(fence, "utf8") : "";
  const motion = P(".devos/screens/motion.json");
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(motion, "utf8")); } catch { manifest = null; }
  const found = uiEvidence({ task, fenceText, manifest, fileExists: (name) => existsSync(P(join(".devos/screens", name))) });
  if (!found.applies) {
    console.log(`ui-evidence: N/A (${task} has no - Screens: line)`);
    return;
  }
  mkdirSync(P(".devos/logs"), { recursive: true });
  writeFileSync(P(".devos/logs/ui-evidence.log"), `${found.evidence.join("\n") || "no finding"}\n`);
  writeFileSync(P(".devos/logs/a11y.log"), `${found.a11y.join("\n") || "no finding"}\n`);
  for (const [name, findings] of [["ui-evidence", found.evidence], ["a11y", found.a11y]]) {
    console.log(`${name}: ${findings.length ? `FAIL (${findings.length})` : "PASS"} — ${found.captures} captures`);
    for (const line of findings.slice(0, 30)) console.log(`  ${line}`);
  }
  const ciFile = P(".devos/ci-results.json");
  if (!existsSync(ciFile)) {
    console.log("ui-evidence: no .devos/ci-results.json; nothing recorded");
    return;
  }
  const ci = JSON.parse(readFileSync(ciFile, "utf8"));
  writeFileSync(ciFile, JSON.stringify(withChecks(ci, found, task), null, 2));
}

if (process.argv[1]?.endsWith("ui-evidence.mjs")) main();
