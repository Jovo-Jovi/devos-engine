// Several models per role, edited by pull request (E26c2, PR-64). A role's fallback_models change in devos/project.json
// and in the generated devos.config.json on a branch of the project's GitHub repository, through the GitHub API, and a
// pull request carries them: they apply from the next cycle run after you merge it. The folder on this computer is not
// touched, and nothing is merged here. Model ids only: no key is read or written.
// E60 (PR-86): a role's tool and model change the same way (setAgent), once the repository has the new tool's key by
// name (GitHub lists secret names, never their values).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validate } from "../payload/files/scripts/devos/agents.mjs";
import { jsonText, merge } from "../payload/files/scripts/devos/config.mjs";
import { hubExec, remoteFile } from "./hub.mjs";
import { configuredRoles, isModelId, MODEL_VARIABLES, projectSlug, ROLES } from "./models.mjs";

// PR-64: at most this many models after a role's own (scripts/devos/agents.mjs MAX_FALLBACKS).
export const MAX_FALLBACKS = 4;
export const ROLE_NAMES = { reviewer: "the reviewer", light: "the light reviewer", builder: "the default builder" };

/** The branch that carries a role's change. One at a time per role. */
export function fallbackBranch(role) {
  return `devos/models-${role}`;
}

/** What is wrong with a list of next models for a role, or "". */
export function listProblem(role, models, own = "") {
  if (!ROLES.includes(role)) return `"${role}" is not a role: use reviewer, light or builder`;
  if (!Array.isArray(models) || models.length > MAX_FALLBACKS) return `give up to ${MAX_FALLBACKS} model ids, or none`;
  for (const id of models) if (!isModelId(id)) return `"${id}" is not a model id`;
  if (new Set(models).size !== models.length) return "a model is listed twice";
  if (own && models.includes(own)) return `${own} is ${ROLE_NAMES[role]}'s own model; list only the models to try after it`;
  return "";
}

/** "a,b" or "a, b" or "none" → a list of ids. */
export function parseList(text) {
  const value = String(text ?? "").trim();
  if (value === "" || value.toLowerCase() === "none") return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function agentOf(agents, role) {
  if (role === "reviewer") return agents?.reviewer ?? null;
  if (role === "light") return agents?.reviewer_light ?? null;
  return Array.isArray(agents?.pool) ? agents.pool.find((item) => item?.default === true) ?? null : null;
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file) {
  try {
    return file ? JSON.parse(file.text) : null;
  } catch {
    return null;
  }
}

/** The project's three files on its default branch: { slug, base, project, defaults, projectFile, configFile } or { error }. */
function remoteProject(folder, exec) {
  const slug = projectSlug(folder, exec);
  if (!slug) return { error: "this project has no GitHub repository yet (git remote origin); finish devos continue first" };
  const repo = exec("gh", ["api", `repos/${slug}`, "--jq", ".default_branch"]);
  const base = repo && repo.status === 0 ? repo.stdout.trim() : "";
  if (!base) return { error: `gh could not read the default branch of ${slug}` };
  const projectFile = remoteFile(slug, "devos/project.json", base, exec);
  const configFile = remoteFile(slug, "devos.config.json", base, exec);
  const project = readJson(projectFile);
  const defaults = readJson(remoteFile(slug, "devos/engine.defaults.json", base, exec));
  if (!plain(project) || !plain(defaults) || !configFile) {
    return { error: `gh could not read devos/project.json, devos/engine.defaults.json and devos.config.json on ${base} in ${slug}` };
  }
  return { slug, base, project, defaults, projectFile, configFile };
}

/** devos/project.json and the config made from it, committed on devos/models-<role>, and their pull request: { pull } or { error }. */
function openChange(remote, role, config, title, body, exec) {
  const { slug, base, project, projectFile, configFile } = remote;
  const head = exec("gh", ["api", `repos/${slug}/git/ref/heads/${base}`, "--jq", ".object.sha"]);
  const sha = head && head.status === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) return { error: `gh could not read the last commit of ${base} in ${slug}` };
  const branch = fallbackBranch(role);
  const created = exec("gh", ["api", `repos/${slug}/git/refs`, "-X", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
  if (!created || created.status !== 0) {
    return { error: `GitHub did not create the branch ${branch} in ${slug}. A pull request for ${ROLE_NAMES[role]}'s models may be open: merge or close it and delete the branch, then try again.` };
  }
  const dir = mkdtempSync(path.join(tmpdir(), "devos-models-"));
  try {
    for (const [file, text, remoteText] of [["devos/project.json", jsonText(project), projectFile], ["devos.config.json", jsonText(config), configFile]]) {
      const put = path.join(dir, "put.json");
      writeFileSync(put, JSON.stringify({ message: title, content: Buffer.from(text, "utf8").toString("base64"), sha: remoteText.sha, branch }));
      const changed = exec("gh", ["api", `repos/${slug}/contents/${file}`, "-X", "PUT", "--input", put]);
      if (!changed || changed.status !== 0) {
        return { error: `GitHub did not take the change to ${file}. Delete the branch ${branch} in ${slug}, then try again.` };
      }
    }
    const bodyFile = path.join(dir, "body.md");
    writeFileSync(bodyFile, body);
    const opened = exec("gh", ["pr", "create", "--repo", slug, "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile]);
    const pull = opened && opened.status === 0 ? opened.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https:\/\/github\.com\//.test(line)) ?? "" : "";
    if (!pull) return { error: `The branch ${branch} holds the change, but gh could not open its pull request. Open it on GitHub, or delete the branch and try again.` };
    return { pull };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Open a pull request that gives a role these next models (an empty list removes them). It reads devos/project.json,
 * devos/engine.defaults.json and devos.config.json on the default branch, changes the role's fallback_models, makes the
 * generated config again (config.mjs merge), and commits both files on devos/models-<role>.
 */
export function setFallbacks(folder, role, models, exec = hubExec) {
  const local = configuredRoles(folder);
  if (!local.ok) return { ok: false, error: local.error };
  const problem = listProblem(role, models, local.roles[role]?.model ?? "");
  if (problem) return { ok: false, usage: true, error: problem };
  if (role === "light" && local.roles.light.inherited) {
    return { ok: false, error: "this project has no light reviewer of its own: light reviews use the reviewer's models, so change the reviewer's" };
  }
  const remote = remoteProject(folder, exec);
  if (remote.error) return { ok: false, error: remote.error };
  const { slug, base, project, defaults } = remote;
  const agent = agentOf(project.agents, role);
  if (!plain(agent)) return { ok: false, error: `devos/project.json on ${base} in ${slug} gives no agent for ${ROLE_NAMES[role]}` };
  const before = Array.isArray(agent.fallback_models) ? agent.fallback_models : [];
  if (before.length === models.length && before.every((id, index) => id === models[index])) {
    return { ok: true, slug, role, models, pull: "", unchanged: true };
  }
  if (models.length) agent.fallback_models = [...models];
  else delete agent.fallback_models;
  let config;
  try {
    config = merge(defaults, project);
  } catch (error) {
    return { ok: false, error: `the generated config could not be made: ${error instanceof Error ? error.message : String(error)}` };
  }
  const title = models.length
    ? `DEV_OS models: ${ROLE_NAMES[role]} tries ${models.join(", ")} after ${agent.model}`
    : `DEV_OS models: ${ROLE_NAMES[role]} has no next models`;
  const body = [
    `This pull request changes ${ROLE_NAMES[role]}'s \`fallback_models\` in \`devos/project.json\`, and \`devos.config.json\`, which is made from it (PR-64).`,
    "",
    models.length
      ? `At a usage limit, a run of ${ROLE_NAMES[role]} moves to its other account, then to ${models.join(", then ")}. It waits for the earliest reset only when no model can run.`
      : `${ROLE_NAMES[role]} runs ${agent.model} only. At a usage limit it moves to its other account, then waits for the earliest reset.`,
    "",
    "It applies from the next cycle run after you merge it. Then bring your project folder up to date (`git pull`).",
    "",
  ].join("\n");
  const opened = openChange(remote, role, config, title, body, exec);
  if (opened.error) return { ok: false, error: opened.error };
  return { ok: true, slug, role, models, pull: opened.pull, unchanged: false };
}

// E60 (PR-86): the cycle's tools, and the repository secrets that hold each one's key (devos/setup.json, any one of them).
export const AGENT_TOOLS = ["cursor", "claude", "codex", "gemini"];
export const TOOL_NAMES = { cursor: "Cursor", claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" };

/** The repository secret names, any one of which gives a tool its key, from the engine's devos/setup.json. */
export function toolSecrets(tool) {
  const setup = JSON.parse(readFileSync(new URL("../payload/files/devos/setup.json", import.meta.url), "utf8"));
  const item = setup.items.find((entry) => entry.kind === "secret" && Array.isArray(entry.when) && entry.when.includes(`tool:${tool}`));
  return item ? [...item.names] : [];
}

/**
 * A role's reviewer settings at effort max (Claude Code's alone, PR-86). The reviewer has the deep and gate efforts, and
 * the light one too when it reviews light tasks itself; the light reviewer has the light effort.
 */
function maxEfforts(config, role, sharedLight) {
  const r = config?.reviewer ?? {};
  const keys = role === "reviewer"
    ? [["reviewer.modes.deep.effort", r.modes?.deep?.effort], ["reviewer.gate_effort", r.gate_effort], ...(sharedLight ? [["reviewer.modes.light.effort", r.modes?.light?.effort]] : [])]
    : role === "light" ? [["reviewer.modes.light.effort", r.modes?.light?.effort]] : [];
  return keys.filter(([, value]) => value === "max").map(([key]) => key);
}

/**
 * Open a pull request that moves a role to another tool and model (or another model of its tool). Before it, the
 * repository must have the new tool's key by name, and the role's model variable must be unset: it would replace the
 * new model (PR-63). A new tool drops the role's next models (they are the old tool's) and a builder's Fast (Cursor's
 * alone); the agent keeps its id, which the fences name. The agents are checked as the runner checks them.
 */
export function setAgent(folder, role, tool, model, exec = hubExec) {
  if (!ROLES.includes(role)) return { ok: false, usage: true, error: `"${role}" is not a role: use reviewer, light or builder` };
  if (!AGENT_TOOLS.includes(tool)) return { ok: false, usage: true, error: `"${tool}" is not a cycle tool: use cursor, claude, codex or gemini` };
  if (!isModelId(model)) return { ok: false, usage: true, error: `"${model}" is not a model id` };
  const local = configuredRoles(folder);
  if (!local.ok) return { ok: false, error: local.error };
  if (role === "light" && local.roles.light.inherited) {
    return { ok: false, error: "this project has no light reviewer of its own: light reviews use the reviewer's agent, so change the reviewer's" };
  }
  const remote = remoteProject(folder, exec);
  if (remote.error) return { ok: false, error: remote.error };
  const { slug, base, project, defaults } = remote;
  const agent = agentOf(project.agents, role);
  if (!plain(agent)) return { ok: false, error: `devos/project.json on ${base} in ${slug} gives no agent for ${ROLE_NAMES[role]}` };
  const previous = { tool: agent.tool, model: agent.model };
  if (agent.tool === tool && agent.model === model) return { ok: true, slug, role, tool, model, previous, dropped: [], pull: "", unchanged: true };

  // PR-63: a role variable replaces the configured model, so it would run in place of the new one.
  const name = MODEL_VARIABLES[role];
  const listed = exec("gh", ["variable", "list", "--repo", slug, "--json", "name,value"]);
  let variables = null;
  try {
    variables = listed && listed.status === 0 ? JSON.parse(listed.stdout) : null;
  } catch {
    variables = null;
  }
  if (!Array.isArray(variables)) return { ok: false, error: `gh could not list the repository's variables (gh variable list --repo ${slug})` };
  const set = String(variables.find((entry) => entry?.name === name)?.value ?? "").trim();
  if (set) return { ok: false, error: `${name} is ${set} on ${slug}, and it would replace ${model}: remove it first (devos models reset ${role}), then try again` };

  if (tool !== agent.tool) {
    const names = toolSecrets(tool);
    const secrets = exec("gh", ["secret", "list", "--repo", slug, "--json", "name"]);
    let present = null;
    try {
      present = secrets && secrets.status === 0 ? new Set(JSON.parse(secrets.stdout).map((row) => row?.name)) : null;
    } catch {
      present = null;
    }
    if (!present) return { ok: false, error: `gh could not list the repository's secrets (gh secret list --repo ${slug})` };
    if (!names.some((secret) => present.has(secret))) {
      return { ok: false, error: `${slug} has no key for ${TOOL_NAMES[tool]}: add the repository secret ${names[0]}${names.length > 1 ? ` (or ${names.slice(1).join(", ")})` : ""} on GitHub (Settings → Secrets and variables → Actions), then try again` };
    }
    if (tool !== "claude") {
      const at = maxEfforts(merge(defaults, project), role, local.roles.light.inherited);
      if (at.length) return { ok: false, error: `${ROLE_NAMES[role]} reviews at effort max, which only Claude Code takes: set ${at.join(" and ")} to xhigh or lower in devos/project.json first` };
    }
  }

  const dropped = tool !== agent.tool && Array.isArray(agent.fallback_models) ? [...agent.fallback_models] : [];
  agent.tool = tool;
  agent.model = model;
  if (dropped.length) delete agent.fallback_models;
  else if (Array.isArray(agent.fallback_models)) agent.fallback_models = agent.fallback_models.filter((id) => id !== model);
  if (Array.isArray(agent.fallback_models) && agent.fallback_models.length === 0) delete agent.fallback_models;
  if (tool !== "cursor") delete agent.fast;
  let config;
  try {
    config = merge(defaults, project);
    validate(config.agents);
  } catch (error) {
    return { ok: false, error: `the change would leave agents the runner refuses: ${error instanceof Error ? error.message : String(error)}` };
  }
  const who = ROLE_NAMES[role];
  const title = `DEV_OS models: ${who} runs ${tool} · ${model}`;
  const body = [
    `This pull request moves ${who} from ${previous.tool} · ${previous.model} to ${tool} · ${model} in \`devos/project.json\`, and \`devos.config.json\`, which is made from it (PR-86).`,
    "",
    tool !== previous.tool ? `The repository has a key for ${TOOL_NAMES[tool]}. The agent keeps its id, \`${agent.id}\`${role === "builder" ? ", which the fences name" : ""}.` : `The agent keeps its tool and its id, \`${agent.id}\`.`,
    ...(dropped.length ? ["", `Its next models (${dropped.join(", ")}) were ${previous.tool}'s, so they are removed: add ${tool}'s with \`devos models fallback ${role}\` after the merge.`] : []),
    "",
    "It applies from the next cycle run after you merge it. Then bring your project folder up to date (`git pull`).",
    "",
  ].join("\n");
  const opened = openChange(remote, role, config, title, body, exec);
  if (opened.error) return { ok: false, error: opened.error };
  return { ok: true, slug, role, tool, model, previous, dropped, pull: opened.pull, unchanged: false };
}

/** What a tool change did, in one sentence (the command and the guided page say the same; the page links the pull request). */
export function agentMessage(result, { link = true } = {}) {
  const who = ROLE_NAMES[result.role];
  if (result.unchanged) return `${who} already runs ${result.tool} · ${result.model} on ${result.slug}; nothing to change`;
  const dropped = result.dropped.length ? `, without its next models (${result.dropped.join(", ")}: ${result.previous.tool}'s)` : "";
  return `${link ? `the pull request ${result.pull}` : "a pull request"} moves ${who} from ${result.previous.tool} · ${result.previous.model} to ${result.tool} · ${result.model}${dropped}; merge it on GitHub to use it from the next cycle run, then pull this folder`;
}

/** What a change did, in one sentence (the command and the guided page say the same; the page links the pull request). */
export function fallbackMessage(result, { link = true } = {}) {
  const who = ROLE_NAMES[result.role];
  if (result.unchanged) return `${who} already has ${result.models.length ? `the next models ${result.models.join(", ")}` : "no next models"} on ${result.slug}; nothing to change`;
  const what = result.models.length ? `the next models ${result.models.join(", ")}` : "no next models";
  return `${link ? `the pull request ${result.pull}` : "a pull request"} gives ${who} ${what}; merge it on GitHub to use them from the next cycle run, then pull this folder`;
}
