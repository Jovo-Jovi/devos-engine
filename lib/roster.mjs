import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devosHome } from "./profile.mjs";

const TOOLS = new Set(["cursor", "claude", "codex", "gemini"]);
const POLICIES = new Set(["reviewer-picks", "always-default"]);

function rosterPath() {
  return path.join(devosHome(), ".devos", "roster.json");
}

function fail(reason) {
  console.log(`devos: roster ${reason}`);
  return null;
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

function canonicalAgent(value) {
  return { id: value.id, tool: value.tool, model: value.model };
}

export function checkRoster(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("not an object");
  const rootKeys = Object.keys(value);
  const allowed = ["reviewer", "reviewer_light", "pool", "policy"];
  if (rootKeys.length !== allowed.length || allowed.some((key) => !rootKeys.includes(key))) {
    return fail("must have reviewer, reviewer_light, pool and policy");
  }
  const reviewerError = isAgent(value.reviewer, "reviewer");
  if (reviewerError) return fail(reviewerError);
  if (value.reviewer_light !== null) {
    const lightError = isAgent(value.reviewer_light, "reviewer_light");
    if (lightError) return fail(lightError);
  }
  if (!Array.isArray(value.pool)) return fail("pool must be an array");
  let defaults = 0;
  for (const item of value.pool) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("pool item must be an object");
    const keys = Object.keys(item);
    const names = ["id", "tool", "model", "default", "note"];
    if (keys.length !== names.length || names.some((key) => !keys.includes(key))) {
      return fail("pool item must have id, tool, model, default and note");
    }
    if (typeof item.id !== "string" || typeof item.model !== "string" || typeof item.note !== "string") {
      return fail("pool item must have id, tool, model, default and note");
    }
    if (!TOOLS.has(item.tool)) return fail("pool item tool must be cursor, claude, codex or gemini");
    if (typeof item.default !== "boolean") return fail("pool item default must be boolean");
    if (item.default) defaults += 1;
  }
  if (defaults !== 1) return fail("pool must have exactly one default");
  if (!POLICIES.has(value.policy)) return fail("policy must be reviewer-picks or always-default");
  return {
    reviewer: canonicalAgent(value.reviewer),
    reviewer_light: value.reviewer_light === null ? null : canonicalAgent(value.reviewer_light),
    pool: value.pool.map((item) => ({
      id: item.id,
      tool: item.tool,
      model: item.model,
      default: item.default,
      note: item.note,
    })),
    policy: value.policy,
  };
}

export function loadRoster() {
  const file = rosterPath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
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
