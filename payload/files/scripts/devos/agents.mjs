#!/usr/bin/env node
// The project's agents (PR-41). The runner reads devos.config.json; it does not read the developer's home.
// A repository variable may replace a role's model (PR-63, lib.mjs withModelOverrides); config() applies it, and
// pick and reviewer say so in their note. PR-64: an agent may list `fallback_models`, more models of its own tool tried
// in order after its model (accounts.sh devos_slots); pick and reviewer give them as builder_fallbacks and
// reviewer_fallbacks.
// PR-99: the efforts are the developer's too: the reviewer's (`effort`, `gate_effort`, and `light_effort` when no light
// reviewer has its own), the light reviewer's, each builder's (`effort`: fixed, or `fence` when the reviewer chooses
// it in each fence) and `raise_on_retry`. validate() refuses agents that lack one, so the run stops and says so.
// Usage: node scripts/devos/agents.mjs pick --task Tnn
//        node scripts/devos/agents.mjs reviewer --mode light|deep
//        node scripts/devos/agents.mjs effort --kind light|deep|gate|method|intake|revise|supervisor|doctor
//        node scripts/devos/agents.mjs pool
//        node scripts/devos/agents.mjs tools
import { existsSync, readFileSync } from "node:fs";
import { MODEL_ID, MODEL_VARIABLES, P, config, effortsFor, emit, fail, missingChoice, readJson, runChoice, takesEffort, withModelOverrides } from "./lib.mjs";

const TOOLS = new Set(["cursor", "claude", "codex", "gemini"]);
const POLICIES = new Set(["reviewer-picks", "always-default"]);
const EFFORTS = ["low", "medium", "high", "xhigh"];
// PR-99: a Cursor model id that names its effort (grok-4.7-high, grok-4.7-fast) needs no effort beside it; `auto` is
// Cursor's own choice of model.
const PINNED = /-(low|medium|high|xhigh)(?:-fast)?$|-fast(?:-(low|medium|high|xhigh))?$/;

/** PR-99: whether a pool builder needs an effort chosen: one fixed for every task, or `fence`. */
export function builderNeedsEffort(item) {
  if (takesEffort(item.tool)) return true;
  return item.tool === "cursor" && item.model !== "auto" && !PINNED.test(item.model);
}

/** PR-99: the choices the agents lack, each `{ key, what }`; none when every model and effort is chosen. */
export function missingChoices(agents) {
  const out = [];
  const reviewer = agents.reviewer;
  const need = (agent, key, value, what) => {
    if (takesEffort(agent.tool) && !effortsFor(agent.tool).includes(value)) out.push({ key, what: `${what}: ${effortsFor(agent.tool).join(", ")}` });
  };
  need(reviewer, "agents.reviewer.effort", reviewer.effort, "the reviewer's effort");
  need(reviewer, "agents.reviewer.gate_effort", reviewer.gate_effort, "the reviewer's effort on a gate");
  if (agents.reviewer_light) need(agents.reviewer_light, "agents.reviewer_light.effort", agents.reviewer_light.effort, "the light reviewer's effort");
  else need(reviewer, "agents.reviewer.light_effort", reviewer.light_effort, "the effort of the reviewer's light reviews");
  for (const item of agents.pool ?? []) {
    if (builderNeedsEffort(item) && !Object.hasOwn(item, "effort")) {
      out.push({ key: `agents.pool[${item.id}].effort`, what: "the builder's effort: low, medium, high or xhigh for every task, or fence when the reviewer chooses it in each fence" });
    }
  }
  if (typeof agents.raise_on_retry !== "boolean") out.push({ key: "agents.raise_on_retry", what: "whether a retry raises the reviewer's effort one step: true or false" });
  return out;
}
// PR-64: at most this many models after an agent's own.
export const MAX_FALLBACKS = 4;

function bad(reason) {
  throw new Error(`agents: ${reason}`);
}

// PR-64: an agent's optional fallback_models: model ids of its own tool, none twice. Its own model is skipped where
// the list is used (fallbacks), so a variable that makes a fallback the agent's model (PR-63) is still valid.
function fallbackError(value, label) {
  if (!Object.hasOwn(value, "fallback_models")) return "";
  const list = value.fallback_models;
  const wrong = `${label}.fallback_models must be a list of up to ${MAX_FALLBACKS} model ids, none twice`;
  if (!Array.isArray(list) || list.length > MAX_FALLBACKS) return wrong;
  if (list.some((id) => typeof id !== "string" || !MODEL_ID.test(id))) return wrong;
  if (new Set(list).size !== list.length) return wrong;
  return "";
}

function hasKeys(value, names, optional = ["fallback_models"]) {
  const keys = Object.keys(value).filter((key) => !optional.includes(key));
  return keys.length === names.length && names.every((key) => keys.includes(key));
}

const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function isAgent(value, label, efforts = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${label} must be an object`;
  if (typeof value.id !== "string" || typeof value.tool !== "string" || typeof value.model !== "string") {
    return `${label} must have id, tool and model`;
  }
  if (!TOOLS.has(value.tool)) return `${label}.tool must be cursor, claude, codex or gemini`;
  if (!hasKeys(value, ["id", "tool", "model"], ["fallback_models", "provider", ...efforts])) {
    return `${label} must have id, tool and model, and may have fallback_models${efforts.length ? `, ${efforts.join(", ")}` : ""} and provider`;
  }
  // E85 (PR-101): the AI service the tool uses, when it serves several (a word: anthropic, openai, google, openrouter…).
  if (Object.hasOwn(value, "provider") && !PROVIDER.test(String(value.provider))) return `${label}.provider must be a provider id (letters, digits, - and _)`;
  // PR-99: an effort is one the agent's tool takes; a tool that takes none has none.
  for (const key of efforts) {
    if (Object.hasOwn(value, key) && !effortsFor(value.tool).includes(value[key])) {
      return takesEffort(value.tool) ? `${label}.${key} must be ${effortsFor(value.tool).join(", ")}` : `${label}.${key}: ${value.tool} takes no effort`;
    }
  }
  return fallbackError(value, label);
}

/** PR-64: the models an agent tries after its own, in order (none when it lists none). */
export function fallbacks(item) {
  return Array.isArray(item?.fallback_models) ? item.fallback_models.filter((id) => id !== item.model) : [];
}

export function validate(agents) {
  // PR-99: a project with no agents has no reviewer or builder of the engine's to fall back on.
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) throw missingChoice("agents", "the reviewer, the builders and their efforts");
  // PR-53: reviewer_light may be absent (the generated config drops a null): the reviewer then reviews every task.
  const allowed = ["reviewer", "reviewer_light", "pool", "policy", "fallback_builder", "raise_on_retry"];
  const rootKeys = Object.keys(agents);
  if (rootKeys.some((key) => !allowed.includes(key)) || ["reviewer", "pool", "policy"].some((key) => !rootKeys.includes(key))) {
    bad("must have reviewer, pool, policy and raise_on_retry, and may have reviewer_light and fallback_builder");
  }
  const reviewerError = isAgent(agents.reviewer, "reviewer", ["effort", "gate_effort", "light_effort"]);
  if (reviewerError) bad(reviewerError);
  if (agents.reviewer_light != null) {
    const lightError = isAgent(agents.reviewer_light, "reviewer_light", ["effort"]);
    if (lightError) bad(lightError);
  }
  if (!Array.isArray(agents.pool)) bad("pool must be an array");
  let defaults = 0;
  for (const item of agents.pool) {
    if (!item || typeof item !== "object" || Array.isArray(item)) bad("pool item must be an object");
    if (!hasKeys(item, ["id", "tool", "model", "default", "note"], ["fallback_models", "effort", "fast", "provider"])) {
      bad("pool item must have id, tool, model, default and note, and may have fallback_models");
    }
    if (typeof item.id !== "string" || typeof item.model !== "string" || typeof item.note !== "string") {
      bad("pool item must have id, tool, model, default and note");
    }
    if (!TOOLS.has(item.tool)) bad("pool item tool must be cursor, claude, codex or gemini");
    if (Object.hasOwn(item, "provider") && !PROVIDER.test(String(item.provider))) bad("pool item provider must be a provider id (letters, digits, - and _)");
    if (typeof item.default !== "boolean") bad("pool item default must be boolean");
    if (Object.hasOwn(item, "effort") && !EFFORTS.includes(item.effort) && item.effort !== "fence") bad("pool item effort must be low, medium, high, xhigh or fence");
    if (Object.hasOwn(item, "fast") && (item.fast !== true || !EFFORTS.includes(item.effort) || item.tool !== "cursor")) {
      bad("pool item fast is true, only with a fixed effort, and only for cursor");
    }
    const listError = fallbackError(item, `pool item ${item.id}`);
    if (listError) bad(listError);
    if (item.default) defaults += 1;
  }
  if (defaults !== 1) bad("pool must have exactly one default");
  if (!POLICIES.has(agents.policy)) bad("policy must be reviewer-picks or always-default");
  // PR-76: optional. A pool builder of another tool, used only when the run's tool is out past a run's wait.
  if (Object.hasOwn(agents, "fallback_builder")) {
    const id = agents.fallback_builder;
    const item = typeof id === "string" ? agents.pool.find((entry) => entry.id === id) : null;
    const usual = agents.pool.find((entry) => entry.default);
    if (!item || item.tool === usual.tool) bad("fallback_builder must name a pool builder whose tool is not the default builder's");
  }
  // PR-99: a choice the developer has not made stops the run here, before any agent runs.
  const missing = missingChoices(agents);
  if (missing.length > 0) throw missingChoice(missing.map((entry) => entry.key).join(", "), missing.map((entry) => entry.what).join("; "));
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
    if (fallbacks(item).length) line += ` (then ${fallbacks(item).join(", ")})`;
    if (item.effort === "fence") line += " · effort chosen in each fence";
    else if (item.effort) {
      line += ` · fixed effort ${item.effort}`;
      if (item.fast === true) line += ", fast";
    }
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

export function pick(task, agents = config().agents, env = process.env) {
  const value = validate(agents);
  // PR-76: before the policy. The cycle sets this when the task's PR carries devos:fallback-builder.
  if (env?.DEVOS_FALLBACK_BUILDER === "true" && value.fallback_builder) {
    const item = byId(value.fallback_builder, value);
    if (item) return { item, note: "the fallback builder (devos:fallback-builder, PR-76)" };
  }
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

function overrideNotes(role) {
  return withModelOverrides(readJson("devos.config.json")).notes.filter((line) => line.includes(MODEL_VARIABLES[role]));
}

if (process.argv[1]?.endsWith("agents.mjs")) {
  try {
    const command = process.argv[2];
    if (command === "pick") {
      const { item, note } = pick(arg("task"));
      const notes = [note, ...(item.default ? overrideNotes("builder") : [])].filter(Boolean);
      emit({ builder_id: item.id, builder_tool: item.tool, builder_model: item.model, builder_fallbacks: fallbacks(item).join(" "), builder_note: notes.join("; ") });
    } else if (command === "reviewer") {
      const item = reviewerFor(arg("mode"));
      const notes = overrideNotes(item.id === config().agents.reviewer.id ? "reviewer" : "light");
      // E85 (PR-101): the AI service, when the project names one apart from the tool (agents.*.provider).
      emit({ reviewer_id: item.id, reviewer_tool: item.tool, reviewer_model: item.model, reviewer_fallbacks: fallbacks(item).join(" "), reviewer_note: notes.join("; "), ...(item.provider ? { reviewer_provider: item.provider } : {}) });
    } else if (command === "effort") {
      // PR-99: the effort of a run of the reviewer agent ("" for a tool that takes none), checked with every choice.
      const cfg = config();
      validate(cfg.agents);
      const run = runChoice(arg("kind"), cfg);
      emit({ effort: run.effort, tool: run.tool, model: run.model });
    } else if (command === "pool") {
      console.log(poolText());
    } else if (command === "next") {
      const item = nextAfter(arg("after"));
      emit({ next_id: item?.id ?? "", next_tool: item?.tool ?? "", next_model: item?.model ?? "" });
    } else if (command === "tools") {
      console.log(`tools=${toolList()}`);
    } else {
      fail("usage: agents.mjs pick --task Tnn | reviewer --mode light|deep | effort --kind <run> | pool | next --after <id> | tools", 2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
