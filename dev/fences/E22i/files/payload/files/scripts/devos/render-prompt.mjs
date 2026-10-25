#!/usr/bin/env node
// Render a prompt from devos/prompts/*.md.
// Usage: node scripts/devos/render-prompt.mjs builder|reviewer|revise Tnn attempt [--out file]
//        node scripts/devos/render-prompt.mjs intake - - [--out file]
// Environment it reads when set: DEVOS_BUILDER_MODEL, DEVOS_BUILDER_EFFORT, DEVOS_BUILDER_FAST,
// DEVOS_BUILDER_TOOL, DEVOS_PREVIEW_URL, DEVOS_ISSUE, DEVOS_INTAKE_RESUME, DEVOS_REVIEW_MODE, DEVOS_REVIEW_REASONS, DEVOS_REVIEW_CRITICAL.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { P, parsePhases, isHumanGate, taskAfter, config, fail } from "./lib.mjs";
import { poolText } from "./agents.mjs";
import { motionCounts } from "./screens.mjs";

function screensLine(screens) {
  const manifestPath = P(".devos/screens/motion.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const c = motionCounts(manifest);
    return `- \`.devos/screens/\`: ${c.states} states × ${c.widths} widths from ${manifest.states_from}: ${c.settled} settled, ${c.reduced} reduced-motion, ${c.frames} filmstrip frames, ${c.shifted} with layout shift above 0, ${c.errors} capture errors (\`.devos/screens/motion.json\`; \`SOURCE.txt\` says preview or local build). **Read them with the Read tool**, beside the evidence pack's motion table.\n`;
  }
  return screens.length
    ? `- \`.devos/screens/\`: ${screens.length} full-page screenshots (desktop 1280 and phone 390) of this branch (\`.devos/screens/SOURCE.txt\` says whether they come from the preview or the local build). **Look at them with the Read tool.**\n`
    : "";
}

function commonVars(cfg, rows) {
  const ids = rows.map((r) => Number(r.task.slice(1)));
  const screens = existsSync(P(".devos/screens")) ? readdirSync(P(".devos/screens")).filter((f) => f.endsWith(".png")) : [];
  const env = process.env;
  return {
    BASE: cfg.base_branch,
    MAX_ATTEMPTS: String(cfg.max_attempts),
    TODAY: new Date().toISOString().slice(0, 10),
    NEXT_ID: `T${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(2, "0")}`,
    ISSUE: env.DEVOS_ISSUE ?? "",
    RESUME_LINE: env.DEVOS_INTAKE_RESUME === "true"
      ? "\n**This run continues an earlier one that stopped (usage limit or no decision).** Its partial files are already in the tree on this branch (`git diff --stat origin/main...HEAD`). Read them, verify them against the repository, and complete them. Do not start over, renumber, or duplicate what is there: task ids already added on this branch stand, and the next free id below applies only to tasks you still add.\n"
      : "",
    // PR-54: the builder's tool by its name (the runner passes the pool pick's tool).
    BUILDER_TOOL: { cursor: "Cursor", claude: "Claude Code", codex: "Codex", gemini: "Gemini" }[env.DEVOS_BUILDER_TOOL] || env.DEVOS_BUILDER_TOOL || "the builder agent",
    BUILDER_MODEL: env.DEVOS_BUILDER_MODEL || cfg.builder.model,
    BUILDER_EFFORT: env.DEVOS_BUILDER_EFFORT || cfg.builder.default_effort || "high",
    BUILDER_FAST: env.DEVOS_BUILDER_FAST || "no",
    PROJECT_KEY: cfg.project ?? "",
    BUILDER_POOL: poolText(),
    PREVIEW_LINE: env.DEVOS_PREVIEW_URL
      ? `- Preview deployment of this branch: ${env.DEVOS_PREVIEW_URL} (check it with \`node scripts/devos/probe.mjs --base ${env.DEVOS_PREVIEW_URL} /\`; previews sit behind the Vercel login unless the project sets a protection bypass).\n`
      : "",
    SCREENS_LINE: screensLine(screens),
  };
}

export function renderPrompt(role, task, attempt) {
  const cfg = config();
  const { rows } = parsePhases();
  if (role === "intake" || role === "method") return fill(role, commonVars(cfg, rows));
  const row = rows.find((r) => r.task === task);
  if (!row) fail(`render-prompt: ${task} not in docs/PHASES.md`);
  const next = taskAfter(rows, task);
  const prevReview = `docs/reviews/${task}-a${attempt - 1}.md`;
  const hasPrev = attempt > 1 && existsSync(P(prevReview));

  const vars = {
    ...commonVars(cfg, rows),
    TASK: task,
    NAME: row.name,
    RISK: String(row.risk),
    GATE: row.gate,
    ATTEMPT: String(attempt),
    ATTEMPT_NEXT: String(attempt + 1),
    PREV_ATTEMPT: String(attempt - 1),
    BRANCH: `${cfg.branch_prefix}${task}`,
    NEXT_TASK: next ? next.task : "",
    NEXT_TASK_OR_NONE: next ? next.task : "none (last task)",
    HUMAN_GATE: isHumanGate(row) ? "yes — the PR waits for the human's merge" : "no — the runner merges a PASS",
    REISSUE_BLOCK: hasPrev
      ? `\nThis is a REISSUE. Read the previous verdict \`${prevReview}\` and the fence's "Attempt ${attempt} focus" section first. The earlier attempt's work is already in the tree on this branch: verify it against the Done-when list and change only what fails. Never redo or duplicate it.\n`
      : "",
    PREV_REVIEW_LINE: hasPrev ? `- \`${prevReview}\`: your previous verdict on this task.\n` : "",
    RISK3_LINE: row.risk >= 3
      ? "This is **risk 3**: you are the heavyweight review (Dev OS §11). Read every changed line of the critical paths, not a sample."
      : "",
    REVIEW_MODE_BLOCK: (process.env.DEVOS_REVIEW_MODE || "deep") === "light"
      ? `**This is a LIGHT review** (${process.env.DEVOS_REVIEW_REASONS || "risk 1–2, nothing critical touched"}). Work from the pack and the report; spot-check the diff where the fence is specific. Aim for about 20 tool calls.`
      : `**This is a DEEP review** (${process.env.DEVOS_REVIEW_REASONS || "risk 3, a gate, or a critical path"}). Still evidence first, but read every changed line of the critical paths${process.env.DEVOS_REVIEW_CRITICAL ? ` (${process.env.DEVOS_REVIEW_CRITICAL.split(",").map((p) => "`" + p + "`").join(", ")})` : ""}, and use a targeted probe where the pack cannot settle a security or data question.`,
  };

  return fill(role, vars);
}

function fill(role, vars) {
  const tpl = readFileSync(P(`devos/prompts/${role}.md`), "utf8");
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => {
    if (!(k in vars)) fail(`render-prompt: unknown placeholder {{${k}}} in devos/prompts/${role}.md`);
    return vars[k];
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("render-prompt.mjs")) {
  const [role, task, attemptRaw] = process.argv.slice(2);
  if (!["builder", "reviewer", "revise", "intake", "method"].includes(role) || (!["intake", "method"].includes(role) && !/^T\d{2}$/.test(task ?? ""))) {
    fail("usage: render-prompt.mjs builder|reviewer|revise Tnn attempt | intake|method - - [--out file]", 2);
  }
  const text = renderPrompt(role, task, Number(attemptRaw || "1"));
  const oi = process.argv.indexOf("--out");
  if (oi >= 0) writeFileSync(process.argv[oi + 1], text);
  else process.stdout.write(text);
}
