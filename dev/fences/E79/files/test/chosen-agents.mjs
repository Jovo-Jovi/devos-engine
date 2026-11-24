// E79 (PR-99): DEV_OS picks no model and no effort, so a test that stages a project gives it agents of its own, every
// model and effort chosen. These are the agents and efforts engines before 1.13.11 picked by themselves (their
// devos/engine.defaults.json), so the tests keep what they checked.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { builderNeedsEffort } from "../payload/files/scripts/devos/agents.mjs";

export const CHOSEN_AGENTS = Object.freeze({
  reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5", effort: "high", gate_effort: "high" },
  reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5", effort: "medium" },
  pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder", effort: "fence" }],
  policy: "reviewer-picks",
  raise_on_retry: true,
});

const EFFORT_TOOLS = new Set(["claude", "codex"]);

/**
 * Agents with every choice made: the given roles over CHOSEN_AGENTS, and each role a test gives without an effort its
 * tool needs gets the one engines before 1.13.11 used (the reviewer high, light reviews medium, a builder `fence`).
 */
export function chosenAgents(extra = {}) {
  const base = structuredClone(CHOSEN_AGENTS);
  const agents = { ...base, ...structuredClone(extra) };
  const reviewer = agents.reviewer;
  if (EFFORT_TOOLS.has(reviewer.tool)) {
    reviewer.effort ??= "high";
    reviewer.gate_effort ??= "high";
    if (agents.reviewer_light == null) reviewer.light_effort ??= "medium";
  } else {
    delete reviewer.effort;
    delete reviewer.gate_effort;
    delete reviewer.light_effort;
  }
  if (agents.reviewer_light) {
    if (EFFORT_TOOLS.has(agents.reviewer_light.tool)) agents.reviewer_light.effort ??= "medium";
    else delete agents.reviewer_light.effort;
  }
  for (const item of agents.pool ?? []) {
    if (builderNeedsEffort(item) && !Object.hasOwn(item, "effort")) item.effort = "fence";
  }
  return agents;
}

/** An installed project (devos install, which chooses no agents) given chosen agents in devos/project.json. */
export function giveAgents(dir, extra = {}) {
  const file = path.join(dir, "devos", "project.json");
  const project = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, `${JSON.stringify({ ...project, agents: chosenAgents(extra) }, null, 2)}\n`);
  const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: dir, encoding: "utf8", windowsHide: true });
  if (written.status !== 0) throw new Error(`config.mjs --write: ${written.stdout}${written.stderr}`);
}

/** devos/engine.defaults.json's text with chosen agents, for a test that writes devos.config.json from it. */
export function configWithAgents(defaultsText, extra = {}) {
  return `${JSON.stringify({ ...JSON.parse(defaultsText), agents: chosenAgents(extra) }, null, 2)}\n`;
}
