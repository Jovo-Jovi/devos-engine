#!/usr/bin/env node
// The project's agents (PR-41). The runner reads devos.config.json; it does not read the developer's home.
// Usage: node scripts/devos/agents.mjs pick --task Tnn
//        node scripts/devos/agents.mjs reviewer --mode light|deep
//        node scripts/devos/agents.mjs pool
//        node scripts/devos/agents.mjs tools
import { existsSync, readFileSync } from "node:fs";
import { P, config, emit, fail } from "./lib.mjs";

const TOOLS = new Set(["cursor", "claude", "codex", "gemini"]);
const POLICIES = new Set(["reviewer-picks", "always-default"]);

function bad(reason) {
  throw new Error(`agents: ${reason}`);
}

function isAgent(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${label} must be an object`;
  if (typeof value.id !== "string" || typeof value.tool !== "string" || typeof value.model !== "string") {
    return `${label} must have id, tool and model`;
  }
  if (!TOOLS.has(value.tool)) return `${label}.tool must be cursor, claude, codex or gemini`;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes("id") || !keys.includes("tool") || !keys.includes("model")) {
    return `${label} must have id, tool and model`;
  }
  return "";
}

export function validate(agents) {
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) bad("missing");
  // PR-53: reviewer_light may be absent (the generated config drops a null): the reviewer then reviews every task.
  const allowed = ["reviewer", "reviewer_light", "pool", "policy"];
  const rootKeys = Object.keys(agents);
  if (rootKeys.some((key) => !allowed.includes(key)) || ["reviewer", "pool", "policy"].some((key) => !rootKeys.includes(key))) {
    bad("must have reviewer, pool and policy, and may have reviewer_light");
  }
  const reviewerError = isAgent(agents.reviewer, "reviewer");
  if (reviewerError) bad(reviewerError);
  if (agents.reviewer_light != null) {
    const lightError = isAgent(agents.reviewer_light, "reviewer_light");
    if (lightError) bad(lightError);
  }
  if (!Array.isArray(agents.pool)) bad("pool must be an array");
  let defaults = 0;
  for (const item of agents.pool) {
    if (!item || typeof item !== "object" || Array.isArray(item)) bad("pool item must be an object");
    const names = ["id", "tool", "model", "default", "note"];
    const keys = Object.keys(item);
    if (keys.length !== names.length || names.some((key) => !keys.includes(key))) {
      bad("pool item must have id, tool, model, default and note");
    }
    if (typeof item.id !== "string" || typeof item.model !== "string" || typeof item.note !== "string") {
      bad("pool item must have id, tool, model, default and note");
    }
    if (!TOOLS.has(item.tool)) bad("pool item tool must be cursor, claude, codex or gemini");
    if (typeof item.default !== "boolean") bad("pool item default must be boolean");
    if (item.default) defaults += 1;
  }
  if (defaults !== 1) bad("pool must have exactly one default");
  if (!POLICIES.has(agents.policy)) bad("policy must be reviewer-picks or always-default");
  return agents;
}

export function pool(agents = config().agents) {
  return validate(agents).pool;
}

export function byId(id, agents = config().agents) {
  return pool(agents).find((item) => item.id === id) ?? null;
}

export function defaultItem(agents = config().agents) {
  return pool(agents).find((item) => item.default);
}

export function reviewerFor(mode, agents = config().agents) {
  const value = validate(agents);
  if (mode === "deep") return value.reviewer;
  if (mode === "light") return value.reviewer_light ?? value.reviewer;
  bad(`mode ${mode}`);
}

export function poolText(agents = config().agents) {
  return pool(agents).map((item) => {
    let line = `- ${item.id} — ${item.tool} · ${item.model}`;
    if (item.default) line += " · default";
    if (item.note) line += ` — ${item.note}`;
    return line;
  }).join("\n");
}

export function nextAfter(id, agents = config().agents) {
  const items = pool(agents);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0 || items.length < 2) return null;
  for (let step = 1; step < items.length; step += 1) {
    const item = items[(index + step) % items.length];
    if (item.id !== id) return item;
  }
  return null;
}

export function toolList(agents = config().agents) {
  const value = validate(agents);
  const names = new Set([value.reviewer.tool]);
  if (value.reviewer_light) names.add(value.reviewer_light.tool);
  for (const item of value.pool) names.add(item.tool);
  return [...names].sort().join(" ");
}

export function pick(task, agents = config().agents) {
  const value = validate(agents);
  const chosen = defaultItem(value);
  if (value.policy === "always-default") return { item: chosen, note: "" };
  const file = P(`docs/fences/${task}.md`);
  let token = "";
  if (existsSync(file)) {
    const head = readFileSync(file, "utf8").split(/\r?\n/).slice(0, 30).join("\n");
    token = /^[ \t]*- Builder:\s*(\S+)\s*·/m.exec(head)?.[1] ?? "";
  }
  if (!token) return { item: chosen, note: `no Builder line; using ${chosen.id}` };
  const found = byId(token, value);
  if (found) return { item: found, note: "" };
  return { item: chosen, note: `builder ${token} is not in the pool; using ${chosen.id}` };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

if (process.argv[1]?.endsWith("agents.mjs")) {
  try {
    const command = process.argv[2];
    if (command === "pick") {
      const { item, note } = pick(arg("task"));
      emit({ builder_id: item.id, builder_tool: item.tool, builder_model: item.model, builder_note: note });
    } else if (command === "reviewer") {
      const item = reviewerFor(arg("mode"));
      emit({ reviewer_id: item.id, reviewer_tool: item.tool, reviewer_model: item.model });
    } else if (command === "pool") {
      console.log(poolText());
    } else if (command === "next") {
      const item = nextAfter(arg("after"));
      emit({ next_id: item?.id ?? "", next_tool: item?.tool ?? "", next_model: item?.model ?? "" });
    } else if (command === "tools") {
      console.log(`tools=${toolList()}`);
    } else {
      fail("usage: agents.mjs pick --task Tnn | reviewer --mode light|deep | pool | next --after <id> | tools", 2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
