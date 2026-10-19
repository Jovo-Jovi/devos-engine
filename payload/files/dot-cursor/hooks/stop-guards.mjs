#!/usr/bin/env node
// Cursor stop hook: when the agent finishes, run the guards. If any FAIL, hand the findings back
// as a follow-up message (at most twice: loop_limit in hooks.json), so the builder fixes them
// inside the fence's scope or HALTs.
import { spawnSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { /* none */ }
  if (input.status && input.status !== "completed") { process.stdout.write("{}"); return; }
  const r = spawnSync(process.execPath, ["scripts/guards/run-all.mjs"], { encoding: "utf8" });
  if (r.status === 0) { process.stdout.write("{}"); return; }
  const failing = (r.stdout || "").split(/\r?\n/).filter((l) => /FAIL|^\s{4}/.test(l)).slice(0, 40).join("\n");
  process.stdout.write(JSON.stringify({
    followup_message: `Dev OS guards failed:\n${failing}\n\nFix these inside the fence's scope and re-run \`pnpm guards\`. If a fix needs a path the fence protects, HALT per the STOP block and say so in the report.`,
  }));
});
