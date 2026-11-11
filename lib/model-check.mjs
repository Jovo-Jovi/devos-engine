// E75: is each role's model still offered, and is there a newer one of its line? `devos models check` and the guided
// page's Models panel ask each tool what it offers now:
// - the tool's own list, for a tool that lists its models (Cursor `agent models`, GLM, Muse);
// - else the provider's models API, when its key is already in the environment (Anthropic for Claude Code, OpenAI for
//   Codex, Google for Gemini). The key is sent only to that provider's own address, and is never printed or kept;
// - else the engine's own list (lib/data/tools.json), which `node tools/models-refresh.mjs` keeps current.
// Only a newer model of the same line is suggested (claude-fable-5-1 → claude-fable-5-2, never Opus → Fable), and
// nothing changes until the owner confirms: `devos models check --apply`, or Use on the page. Model ids only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_ID, modelIdsFrom } from "./probes.mjs";
import { runToolSync } from "./spawn.mjs";
import { which } from "./which.mjs";

const TOOLS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "tools.json");

/** The providers whose models API lists what a key may use. Each is called only at its own fixed address. */
export const PROVIDERS = {
  anthropic: {
    label: "Anthropic's models API",
    keys: ["ANTHROPIC_API_KEY"],
    url: "https://api.anthropic.com/v1/models?limit=1000",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    ids: (body) => (Array.isArray(body?.data) ? body.data.map((model) => model?.id) : null),
    keep: (id) => id.startsWith("claude-"),
  },
  openai: {
    label: "OpenAI's models API",
    keys: ["OPENAI_API_KEY"],
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    ids: (body) => (Array.isArray(body?.data) ? body.data.map((model) => model?.id) : null),
    // Codex takes the chat and code models; image, audio, embedding and moderation models are left out.
    keep: (id) => /^(gpt-|o\d|codex)/.test(id) && !/(image|audio|realtime|tts|transcribe|search|embedding|moderation|dall-e|whisper)/.test(id),
  },
  gemini: {
    label: "Google's Gemini models API",
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    headers: (key) => ({ "x-goog-api-key": key }),
    ids: (body) => (Array.isArray(body?.models)
      ? body.models.filter((model) => (model?.supportedGenerationMethods ?? []).includes("generateContent")).map((model) => String(model?.name ?? "").replace(/^models\//, ""))
      : null),
    keep: (id) => id.startsWith("gemini-") && !/(embedding|image|tts|audio|live)/.test(id),
  },
};

/** The provider that lists a cycle tool's models, for a tool that cannot list them itself. */
export const TOOL_PROVIDER = { claude: "anthropic", codex: "openai", gemini: "gemini" };

export function loadTools(file = TOOLS_FILE) {
  return JSON.parse(readFileSync(file, "utf8")).tools ?? [];
}

const DATE = /^\d{6,8}$/;
const NUMBER = /^\d+(?:\.\d+)*$/;
// The effort and speed ending Cursor names its variants with: `agent models` lists efforts from none to max, with or
// without -fast. The cycle runs a model with the fence's effort appended (scripts/devos/builder-model.mjs), so a listed
// `grok-4.7-high` offers `grok-4.7` too.
const EFFORT_ENDING = /-(none|low|medium|high|xhigh|max)(?:-fast)?$|-fast(?:-(none|low|medium|high|xhigh|max))?$/;

/** Each id without its effort or speed ending, once (grok-4.7-high and grok-4.7-xhigh-fast are both grok-4.7). */
export function baseIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((id) => String(id).replace(EFFORT_ENDING, "")).filter(Boolean))];
}

/** The models a list offers: each id, and each id without its effort or speed ending (grok-4.7-xhigh-fast → grok-4.7). */
export function offeredIds(list) {
  const ids = [];
  for (const id of Array.isArray(list) ? list : []) {
    for (const each of [id, String(id).replace(EFFORT_ENDING, "")]) if (each && !ids.includes(each)) ids.push(each);
  }
  return ids;
}

/**
 * A model id as its line and version: `claude-fable-5-1` → line `claude-fable`, version [5, 1];
 * `gpt-5.6-sol` → line `gpt|sol`, [5, 6]; `grok-4.7-high` → `grok|high`, [4, 7]. A dated snapshot's date is left out
 * of the line (`claude-sonnet-4-5-20250929` is the `claude-sonnet` line at [4, 5], dated). null for an id with no
 * version (`auto`, `o3`).
 */
export function modelLine(id) {
  const tokens = String(id ?? "").toLowerCase().split("-");
  const start = tokens.findIndex((token) => NUMBER.test(token) && !DATE.test(token));
  if (start <= 0) return null;
  const version = [];
  let at = start;
  while (at < tokens.length && NUMBER.test(tokens[at]) && !DATE.test(tokens[at])) {
    version.push(...tokens[at].split(".").map(Number));
    at += 1;
  }
  const rest = tokens.slice(at);
  const dated = rest.some((token) => DATE.test(token));
  const suffix = rest.filter((token) => !DATE.test(token));
  const family = tokens.slice(0, start).join("-");
  return { family, line: `${family}|${suffix.join("-")}`, version, dated };
}

/** Compares two versions part by part, a missing part being 0. */
export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The newest of `ids` on the given line, preferring an alias to a dated snapshot of the same version; "" if none. */
function newestOn(ids, line) {
  let best = "";
  let bestLine = null;
  for (const id of ids) {
    const parsed = modelLine(id);
    if (!parsed || parsed.line !== line) continue;
    const order = bestLine ? compareVersions(parsed.version, bestLine.version) : 1;
    if (order > 0 || (order === 0 && bestLine?.dated && !parsed.dated)) {
      best = id;
      bestLine = parsed;
    }
  }
  return best;
}

/**
 * How `model` stands against the list a tool offers now (`offered`, or null when nothing could be read):
 * - current: offered, and nothing newer on its line;
 * - newer: a newer model of its line is offered (`suggestion`);
 * - gone: a live list leaves it out (`suggestion`, the newest of its line, when there is one);
 * - unknown: no list, or the engine's list (which is not every model a tool takes) leaves it out.
 * A model the list names only with an effort or speed ending is offered (offeredIds).
 */
export function judgeModel(model, list, live = true) {
  if (!Array.isArray(list) || list.length === 0) return { status: "unknown", suggestion: "" };
  const offered = offeredIds(list);
  const parsed = modelLine(model);
  const newest = parsed ? newestOn(offered, parsed.line) : "";
  const newer = newest && compareVersions(modelLine(newest).version, parsed.version) > 0 ? newest : "";
  if (offered.includes(model)) return newer ? { status: "newer", suggestion: newer } : { status: "current", suggestion: "" };
  if (newer) return { status: "newer", suggestion: newer };
  if (!live) return { status: "unknown", suggestion: "" };
  return { status: "gone", suggestion: newest };
}

function runList(command, args) {
  try {
    const result = runToolSync(command, args, { encoding: "utf8", timeout: 20000 });
    return result.status === 0 ? modelIdsFrom(String(result.stdout ?? "")) : null;
  } catch {
    return null;
  }
}

async function providerList(id, env, fetcher) {
  const provider = PROVIDERS[id];
  const name = provider.keys.find((keyName) => typeof env[keyName] === "string" && env[keyName].trim());
  if (!name) return { ids: null, note: `set ${provider.keys[0]} to check against ${provider.label}` };
  try {
    const response = await fetcher(provider.url, { headers: provider.headers(env[name].trim()), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { ids: null, note: `${provider.label} answered ${response.status}` };
    const ids = provider.ids(await response.json());
    if (!Array.isArray(ids)) return { ids: null, note: `${provider.label} sent no list` };
    return { ids: ids.filter((model) => typeof model === "string" && MODEL_ID.test(model) && provider.keep(model)), note: "" };
  } catch {
    return { ids: null, note: `${provider.label} could not be reached` };
  }
}

/**
 * The models a tool offers now: { source: "tool" | "api" | "engine", label, ids, live, note }. `deps` replaces the
 * environment, fetch and the command runner in tests.
 */
export async function offeredModels(toolId, { env = process.env, fetcher = globalThis.fetch, list = runList, find = which, tools = loadTools() } = {}) {
  const tool = tools.find((entry) => entry.id === toolId);
  const seeds = tool ? [...new Set((tool.seedGroups ?? []).flatMap((group) => group.models ?? []))] : [];
  const engine = (note) => ({ source: "engine", label: "the engine's list", ids: seeds, live: false, note });
  if (!tool) return { source: "engine", label: "the engine's list", ids: [], live: false, note: `${toolId} is not a tool DEV_OS knows` };
  let note = "";
  if (Array.isArray(tool.modelsArgs)) {
    const command = [tool.command, ...(tool.altCommands ?? [])].map((name) => find(name)).find(Boolean);
    const ids = command ? list(command.path ?? command, tool.modelsArgs) : null;
    if (Array.isArray(ids) && ids.length > 0) return { source: "tool", label: `${tool.label}'s own list`, ids, live: true, note: "" };
    note = command ? `${tool.label} did not list its models (signed in?)` : `${tool.label} is not installed here`;
  } else if (TOOL_PROVIDER[toolId]) {
    const read = await providerList(TOOL_PROVIDER[toolId], env, fetcher);
    if (Array.isArray(read.ids) && read.ids.length > 0) return { source: "api", label: PROVIDERS[TOOL_PROVIDER[toolId]].label, ids: read.ids, live: true, note: "" };
    note = read.note;
  }
  return engine(note);
}

/**
 * Each role of a project (from lib/models.mjs modelsState) against what its tool offers now. A light reviewer that is
 * the reviewer follows the reviewer, so it is judged once. Each tool is asked once.
 */
export async function checkRoles(roles, deps = {}) {
  const lists = new Map();
  const results = [];
  for (const role of roles) {
    if (role.role === "light" && role.inherited && !role.override) {
      results.push({ role: role.role, tool: role.tool, model: role.effective, status: "follows", suggestion: "", source: "", label: "", note: "" });
      continue;
    }
    if (!lists.has(role.tool)) lists.set(role.tool, await offeredModels(role.tool, deps));
    const offered = lists.get(role.tool);
    const judged = judgeModel(role.effective, offered.ids, offered.live);
    results.push({ role: role.role, tool: role.tool, model: role.effective, ...judged, source: offered.source, label: offered.label, note: offered.note });
  }
  return results;
}

/**
 * The models of a live list newer than the engine's `seeds` (tools/models-refresh.mjs), newest first: a higher version
 * on a line the seeds have, or a new line of a family they list, at no lower a version than its newest. Models are
 * compared without their effort or speed ending, and named without it: a listed grok-4.8-high and grok-4.8-max-fast
 * are one newer model, grok-4.8, and claude-opus-5-5-max is no new model beside claude-opus-5-5.
 */
export function newerModels(seeds, list) {
  const known = baseIds(seeds);
  const live = baseIds(list);
  const lines = new Map();
  const families = new Map();
  for (const id of known) {
    const parsed = modelLine(id);
    if (!parsed) continue;
    if (!lines.has(parsed.line) || compareVersions(parsed.version, lines.get(parsed.line)) > 0) lines.set(parsed.line, parsed.version);
    if (!families.has(parsed.family) || compareVersions(parsed.version, families.get(parsed.family)) > 0) families.set(parsed.family, parsed.version);
  }
  const found = [];
  for (const id of live) {
    const parsed = modelLine(id);
    if (!parsed || parsed.dated || known.includes(id)) continue;
    const top = lines.get(parsed.line);
    const newer = top ? compareVersions(parsed.version, top) > 0 : families.has(parsed.family) && compareVersions(parsed.version, families.get(parsed.family)) >= 0;
    if (newer) found.push({ id, parsed });
  }
  found.sort((a, b) => compareVersions(b.parsed.version, a.parsed.version) || a.id.localeCompare(b.id));
  return found.map((item) => item.id);
}

/** One line per role for the terminal. */
export function checkLine(item) {
  const head = `${item.role.padEnd(9)} ${item.tool} · ${item.model}`;
  const from = item.label ? ` (${item.label}${item.note ? `; ${item.note}` : ""})` : "";
  if (item.status === "follows") return `${head} — follows the reviewer`;
  if (item.status === "current") return `${head} — the newest of its line${from}`;
  if (item.status === "newer") return `${head} — newer: ${item.suggestion}${from}`;
  if (item.status === "gone") return `${head} — not offered any more${item.suggestion ? `; the newest of its line is ${item.suggestion}` : ""}${from}`;
  return `${head} — not in the list to check against${from}`;
}
