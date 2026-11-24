import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { missingChoices } from "../payload/files/scripts/devos/agents.mjs";
import { effortsFor } from "../payload/files/scripts/devos/lib.mjs";
import { cleanModelId } from "./probes.mjs";
import { devosHome } from "./profile.mjs";

const TOOLS = new Set(["cursor", "claude", "codex", "gemini"]);
const POLICIES = new Set(["reviewer-picks", "always-default"]);
const EFFORTS = ["low", "medium", "high", "xhigh"];
const POOL_OPTIONAL = new Set(["effort", "fast"]);
// E79 (PR-99): the efforts each role carries. The reviewer's `effort` covers deep, method, intake, supervisor and
// doctor runs; `gate_effort` its gate reviews; `light_effort` its light reviews when no light reviewer has its own.
const REVIEWER_EFFORTS = ["effort", "gate_effort", "light_effort"];
const LIGHT_EFFORTS = ["effort"];

function rosterPath() {
  return path.join(devosHome(), ".devos", "roster.json");
}

function fail(reason) {
  console.log(`devos: roster ${reason}`);
  return null;
}

function isAgent(value, label, efforts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${label} must be an object`;
  if (typeof value.id !== "string" || typeof value.tool !== "string" || typeof value.model !== "string") {
    return `${label} must have id, tool and model`;
  }
  if (!TOOLS.has(value.tool)) return `${label}.tool must be cursor, claude, codex or gemini`;
  const keys = Object.keys(value).filter((key) => !efforts.includes(key));
  if (keys.length !== 3 || !keys.includes("id") || !keys.includes("tool") || !keys.includes("model")) {
    return `${label} must have id, tool and model, and may have ${efforts.join(", ")}`;
  }
  for (const key of efforts) {
    if (Object.hasOwn(value, key) && !effortsFor(value.tool).includes(value[key])) {
      return effortsFor(value.tool).length ? `${label}.${key} must be ${effortsFor(value.tool).join(", ")}` : `${label}.${key}: ${value.tool} takes no effort`;
    }
  }
  return "";
}

function canonicalAgent(value, efforts) {
  const out = { id: value.id, tool: value.tool, model: cleanModelId(value.model) };
  for (const key of efforts) if (Object.hasOwn(value, key)) out[key] = value[key];
  return out;
}

export function checkRoster(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("not an object");
  const rootKeys = Object.keys(value);
  const allowed = ["reviewer", "reviewer_light", "pool", "policy", "raise_on_retry"];
  if (rootKeys.length !== allowed.length || allowed.some((key) => !rootKeys.includes(key))) {
    return fail("must have reviewer, reviewer_light, pool, policy and raise_on_retry");
  }
  const reviewerError = isAgent(value.reviewer, "reviewer", REVIEWER_EFFORTS);
  if (reviewerError) return fail(reviewerError);
  if (value.reviewer_light !== null) {
    const lightError = isAgent(value.reviewer_light, "reviewer_light", LIGHT_EFFORTS);
    if (lightError) return fail(lightError);
  }
  if (typeof value.raise_on_retry !== "boolean") return fail("raise_on_retry must be true or false");
  if (!Array.isArray(value.pool)) return fail("pool must be an array");
  let defaults = 0;
  for (const item of value.pool) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("pool item must be an object");
    const keys = Object.keys(item).filter((key) => !POOL_OPTIONAL.has(key));
    const names = ["id", "tool", "model", "default", "note"];
    if (keys.length !== names.length || names.some((key) => !keys.includes(key))) {
      return fail("pool item must have id, tool, model, default and note");
    }
    if (typeof item.id !== "string" || typeof item.model !== "string" || typeof item.note !== "string") {
      return fail("pool item must have id, tool, model, default and note");
    }
    if (!TOOLS.has(item.tool)) return fail("pool item tool must be cursor, claude, codex or gemini");
    if (typeof item.default !== "boolean") return fail("pool item default must be boolean");
    if (Object.hasOwn(item, "effort") && !EFFORTS.includes(item.effort) && item.effort !== "fence") {
      return fail("pool item effort must be low, medium, high, xhigh or fence");
    }
    if (Object.hasOwn(item, "fast") && (item.fast !== true || !EFFORTS.includes(item.effort) || item.tool !== "cursor")) {
      return fail("pool item fast is true, only with a fixed effort, and only for cursor");
    }
    if (item.default) defaults += 1;
  }
  if (defaults !== 1) return fail("pool must have exactly one default");
  if (!POLICIES.has(value.policy)) return fail("policy must be reviewer-picks or always-default");
  // E79 (PR-99): every effort the tools take is chosen; a missing one is named, never filled in.
  const missing = missingChoices(value);
  if (missing.length > 0) return fail(`has no ${missing.map((entry) => entry.key).join(", ")}`);
  return {
    reviewer: canonicalAgent(value.reviewer, REVIEWER_EFFORTS),
    reviewer_light: value.reviewer_light === null ? null : canonicalAgent(value.reviewer_light, LIGHT_EFFORTS),
    pool: value.pool.map((item) => {
      const canonical = {
        id: item.id,
        tool: item.tool,
        model: cleanModelId(item.model),
        default: item.default,
        note: item.note,
      };
      if (Object.hasOwn(item, "effort")) canonical.effort = item.effort;
      if (item.fast === true) canonical.fast = true;
      return canonical;
    }),
    policy: value.policy,
    raise_on_retry: value.raise_on_retry,
  };
}

export function loadRoster() {
  const file = rosterPath();
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    // A roster saved before E22f may hold a listing row as a model: keep only its id.
    for (const agent of [value?.reviewer, value?.reviewer_light, ...(Array.isArray(value?.pool) ? value.pool : [])]) {
      if (agent && typeof agent === "object" && typeof agent.model === "string") agent.model = cleanModelId(agent.model);
    }
    return value;
  } catch {
    return null;
  }
}

export function rosterCommand(args) {
  if (args[0] === "show" && args.length === 1) {
    const file = rosterPath();
    if (!existsSync(file)) {
      console.log("devos: no roster");
      return 1;
    }
    process.stdout.write(readFileSync(file, "utf8"));
    if (!readFileSync(file, "utf8").endsWith("\n")) process.stdout.write("\n");
    return 0;
  }
  if (args[0] === "import" && args.length === 2) {
    let value;
    try {
      value = JSON.parse(readFileSync(args[1], "utf8"));
    } catch {
      console.log("devos: roster invalid JSON");
      return 1;
    }
    const canonical = checkRoster(value);
    if (!canonical) return 1;
    const file = rosterPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(canonical, null, 2)}\n`);
    return 0;
  }
  console.log("devos: unknown command agents");
  return 2;
}
