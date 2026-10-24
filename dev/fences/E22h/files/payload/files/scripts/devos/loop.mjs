#!/usr/bin/env node
// Local Dev OS cycle: the same steps as .github/workflows/devos-cycle.yml, on your machine, with
// your logged-in `agent` (Cursor CLI) and `claude` (Claude Code). Branches and merges stay local
// unless --push is given. Human gates stop the loop exactly as in CI.
//
// Usage: node scripts/devos/loop.mjs [--task T01] [--attempt 1] [--max-tasks 10] [--push] [--dry-run]
//   --dry-run  render prompts and print the commands without calling the agents
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { P, git, config, parsePhases, nextOpenTask, isHumanGate, reviewerModel, reviewerEffort, changedPaths } from "./lib.mjs";
import { renderPrompt } from "./render-prompt.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const WIN = process.platform === "win32";
const cfg = config();
const BASE = cfg.base_branch;
// PR-53: this loop runs Cursor as the builder and Claude Code as the reviewer. It never runs an agent the project did not choose.
const chosen = cfg.agents;
if (chosen && (chosen.reviewer?.tool !== "claude" || !(chosen.pool ?? []).some((a) => a.tool === "cursor" && a.default))) {
  console.error("loop.mjs runs Cursor as the builder and Claude Code as the reviewer; this project chose other agents. Use the devos-cycle workflow on GitHub.");
  process.exit(1);
}

function sh(cmd, args, { capture, allowFail, env } = {}) {
  console.log(`\n$ ${cmd} ${args.map((a) => (a.length > 80 ? a.slice(0, 77) + "..." : a)).join(" ")}`);
  if (flag("dry-run") && ["agent", "claude"].includes(cmd)) return { status: 0, stdout: "{}" };
  // On Windows the CLIs are .cmd/.ps1 shims and need a shell; quote their arguments for cmd.exe.
  const viaShell = WIN && ["agent", "claude", "pnpm"].includes(cmd);
  const finalArgs = viaShell ? args.map((a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const r = spawnSync(cmd, finalArgs, {
    cwd: P(), encoding: "utf8", shell: viaShell, env: { ...process.env, ...env },
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} exited ${r.status}`);
  return r;
}
const node = (script, ...args) => sh(process.execPath, [P(script), ...args], { allowFail: true });

function cycleOnce(task, attempt) {
  const { rows } = parsePhases();
  const row = rows.find((r) => r.task === task);
  const br = `${cfg.branch_prefix}${task}`;
  mkdirSync(P(".devos/logs"), { recursive: true });

  // Branch (PR-03): a reissue continues the same branch.
  const exists = spawnSync("git", ["rev-parse", "--verify", "--quiet", br], { cwd: P() }).status === 0;
  if (exists) { sh("git", ["checkout", br]); sh("git", ["merge", "--no-edit", BASE], { allowFail: true }); }
  else sh("git", ["checkout", "-b", br, BASE]);
  if (!existsSync(P(`docs/fences/${task}.md`))) throw new Error(`docs/fences/${task}.md does not exist`);
  if (!existsSync(P(".cursor/mcp.json"))) copyFileSync(P(".cursor/mcp.example.json"), P(".cursor/mcp.json"));

  // Builder. The prompt goes through a file so no shell ever has to quote it.
  writeFileSync(P(".devos/builder-prompt.md"), renderPrompt("builder", task, attempt));
  const b = sh("agent", ["-p", "--force", "--trust", "--model", cfg.builder.model, "--output-format", "json",
    "Follow the instructions in .devos/builder-prompt.md exactly."], { capture: true, allowFail: true, env: { DEVOS_AUTOMATED: "1" } });
  writeFileSync(P(".devos/builder.json"), b.stdout ?? "");
  writeFileSync(P(".devos/builder.err"), "");

  if (node("scripts/devos/guard-surfaces.mjs", "builder").status !== 0) throw new Error("builder surface guard failed: HALT");
  sh("git", ["add", "-A"]);
  sh("git", ["commit", "--allow-empty", "-m", `${task} a${attempt}: builder (${cfg.builder.model})`]);
  if (flag("push")) sh("git", ["push", "origin", `HEAD:refs/heads/${br}`]);
  writeFileSync(P(".devos/runner-evidence.md"),
    `# Runner evidence — ${task} attempt ${attempt} (local)\n\n- Branch: \`${br}\`\n- HEAD: \`${git(["rev-parse", "HEAD"])}\`\n- Remote comparison: ${flag("push") ? "pushed" : "local run, not pushed"}\n\n## Changed files vs ${BASE}\n\`\`\`\n${git(["diff", "--stat", `${BASE}...HEAD`])}\n\`\`\`\n`);

  // PR-12: do not spend a review on a builder that hit a usage limit or crashed.
  const bs = spawnSync(process.execPath, [P("scripts/devos/builder-status.mjs"), "--task", task, "--attempt", String(attempt), "--exit", String(b.status ?? "")], { cwd: P(), encoding: "utf8" });
  const state = /state=(\w+)/.exec(bs.stdout ?? "")?.[1] ?? "error";
  if (state !== "ok" && !flag("dry-run")) {
    console.log("\n" + readFileSync(P(".devos/builder-summary.md"), "utf8"));
    return { action: state === "quota" ? "quota_wait" : "halt", br, gate: isHumanGate(row) };
  }

  // Checks, then the reviewer.
  if (existsSync(P("package.json"))) sh("pnpm", ["install", "--frozen-lockfile"], { allowFail: true });
  node("scripts/devos/run-checks.mjs");
  let reviewerPrompt = renderPrompt("reviewer", task, attempt).replaceAll(`origin/${BASE}`, BASE);
  const schema = readFileSync(P("devos/schemas/verdict.schema.json"), "utf8");
  const args = ["-p", "Follow the instructions in .devos/reviewer-prompt.md exactly.", "--model", reviewerModel(row, cfg), "--effort", reviewerEffort(row, cfg),
    "--output-format", "json", "--permission-mode", "dontAsk", "--max-turns", String(cfg.reviewer.max_turns),
    "--allowedTools", "Read,Glob,Grep,Write,Edit,Bash",
    "--disallowedTools", "Bash(git push *),Bash(git commit *),Bash(git checkout *),Bash(git reset *),Bash(gh *),Bash(curl *),Bash(wget *)"];
  if (WIN) reviewerPrompt += `\n\nEnd your final answer with only a JSON object that satisfies devos/schemas/verdict.schema.json.\n`;
  else args.push("--json-schema", schema);
  writeFileSync(P(".devos/reviewer-prompt.md"), reviewerPrompt);
  const rv = sh("claude", args, { capture: true, allowFail: true });
  writeFileSync(P(".devos/reviewer.json"), rv.stdout ?? "");

  node("scripts/devos/guard-surfaces.mjs", "reviewer");
  const v = spawnSync(process.execPath, [P("scripts/devos/verdict.mjs"), "--task", task, "--attempt", String(attempt)], { cwd: P(), encoding: "utf8" });
  process.stdout.write(v.stdout);
  const out = Object.fromEntries(v.stdout.split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  sh("git", ["add", "-A"]);
  sh("git", ["commit", "-m", `${task} a${attempt}: review — ${out.verdict} (${out.action})`]);
  if (flag("push")) sh("git", ["push", "origin", `HEAD:refs/heads/${br}`]);
  console.log("\n" + readFileSync(P(".devos/verdict-summary.md"), "utf8"));
  return { action: out.action, br, gate: isHumanGate(row) };
}

// ---- main -----------------------------------------------------------------------------------
if (changedPaths().length) { console.error("loop: the working tree is not clean; commit or stash first."); process.exit(1); }
sh("git", ["checkout", BASE]);

let task = opt("task", "");
let attempt = Number(opt("attempt", "1"));
const maxTasks = Number(opt("max-tasks", "10"));

for (let done = 0; done < maxTasks; ) {
  if (!task) {
    const n = nextOpenTask(parsePhases().rows);
    if (!n) { console.log("\nEvery task is PASS."); break; }
    task = n.task; attempt = 1;
  }
  console.log(`\n=========== ${task} · attempt ${attempt} ===========`);
  const { action, br } = cycleOnce(task, attempt);

  if (action === "merge") {
    sh("git", ["checkout", BASE]);
    sh("git", ["merge", "--no-ff", "--no-edit", br]);
    if (flag("push")) sh("git", ["push", "origin", BASE]);
    task = ""; done++;
  } else if (action === "retry") {
    attempt++;
  } else if (action === "quota_wait") {
    console.log(`\nUSAGE LIMIT on ${task} attempt ${attempt}. Nothing was recorded. When the limit resets, run:\n  node scripts/devos/loop.mjs --task ${task} --attempt ${attempt}`);
    break;
  } else if (action === "human_gate") {
    console.log(`\nHUMAN GATE: ${task} passed. Review branch ${br}; to sign off, merge it into ${BASE} (git checkout ${BASE} && git merge --no-ff ${br}), then run the loop again.`);
    break;
  } else {
    console.log(`\nHALT on ${task}. Read the verdict and decide (see .devos/verdict-summary.md).`);
    process.exitCode = 1;
    break;
  }
}
