// devos models (E25a, PR-63) and the guided page's Models panel (E25b): the model of each role in a project, and the
// repository variables that change it without a commit. The configured agents stay in devos.config.json; a variable replaces one role's model and keeps
// its tool, from the next cycle run on. Model ids and variable names only: no key is read or written.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MODEL_ID } from "./probes.mjs";
import { hostExec } from "./verify.mjs";

export const MODEL_VARIABLES = { reviewer: "DEVOS_REVIEWER_MODEL", light: "DEVOS_REVIEWER_LIGHT_MODEL", builder: "DEVOS_BUILDER_MODEL" };
export const ROLES = ["reviewer", "light", "builder"];
const USAGE = "devos: usage: devos models [folder] | devos models set <reviewer|light|builder> <model> [folder] | devos models reset <reviewer|light|builder> [folder]";

export function isModelId(value) {
  return typeof value === "string" && value.length <= 100 && MODEL_ID.test(value);
}

/** owner/repo from a GitHub remote URL (https, ssh or scp form), or "" for anything else. */
export function slugFromRemote(url) {
  const text = String(url ?? "").trim();
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(text);
  return match ? `${match[1]}/${match[2]}` : "";
}

/** The configured agent of each role, from the project's generated devos.config.json. */
export function configuredRoles(folder) {
  const file = path.join(folder, "devos.config.json");
  if (!existsSync(file)) return { ok: false, error: "this folder has no devos.config.json; run it in a DEV_OS project folder" };
  let agents;
  try {
    agents = JSON.parse(readFileSync(file, "utf8")).agents;
  } catch {
    return { ok: false, error: "devos.config.json is not valid JSON" };
  }
  const builder = Array.isArray(agents?.pool) ? agents.pool.find((item) => item?.default === true) : null;
  if (!agents?.reviewer?.tool || !agents?.reviewer?.model || !builder) {
    return { ok: false, error: "devos.config.json has no agents (reviewer and a default builder)" };
  }
  const light = agents.reviewer_light ?? null;
  return {
    ok: true,
    roles: {
      reviewer: { tool: agents.reviewer.tool, model: agents.reviewer.model, id: agents.reviewer.id, inherited: false },
      light: light
        ? { tool: light.tool, model: light.model, id: light.id, inherited: false }
        : { tool: agents.reviewer.tool, model: agents.reviewer.model, id: agents.reviewer.id, inherited: true },
      builder: { tool: builder.tool, model: builder.model, id: builder.id, inherited: false },
    },
  };
}

export function projectSlug(folder, exec = hostExec) {
  const remote = exec("git", ["remote", "get-url", "origin"], folder);
  if (!remote || remote.status !== 0) return "";
  return slugFromRemote(remote.stdout);
}

/** The project's GitHub repository and its repository variables (names and values; GitHub never lists secrets). */
export function projectVariables(folder, exec = hostExec) {
  const slug = projectSlug(folder, exec);
  if (!slug) return { ok: false, error: "this project has no GitHub repository yet (git remote origin); finish devos continue first" };
  const listed = exec("gh", ["variable", "list", "--repo", slug, "--json", "name,value"], folder);
  let values = null;
  try {
    values = listed && listed.status === 0 ? JSON.parse(listed.stdout) : null;
  } catch {
    values = null;
  }
  if (!Array.isArray(values)) return { ok: false, slug, error: `gh could not list the repository's variables (gh variable list --repo ${slug})` };
  return { ok: true, slug, values };
}

/** Each role: its tool, configured model, the variable's value (or ""), and the model the next run uses. */
export function modelsState(folder, exec = hostExec) {
  const configured = configuredRoles(folder);
  if (!configured.ok) return { ok: false, error: configured.error };
  const listed = projectVariables(folder, exec);
  if (!listed.ok) return { ok: false, error: listed.error };
  const { slug, values } = listed;
  const value = (name) => String(values.find((entry) => entry?.name === name)?.value ?? "").trim();
  const roles = ROLES.map((role) => {
    const item = configured.roles[role];
    const name = MODEL_VARIABLES[role];
    const override = value(name);
    const usable = isModelId(override) ? override : "";
    return { role, name, tool: item.tool, id: item.id, configured: item.model, inherited: item.inherited, override, effective: usable || item.model };
  });
  // The light reviewer follows the reviewer's variable when the project has no light reviewer of its own.
  const light = roles[1];
  if (light.inherited && !light.override && roles[0].effective !== roles[0].configured) light.effective = roles[0].effective;
  return { ok: true, slug, roles };
}

function checkedRole(role) {
  return ROLES.includes(role) ? "" : `"${role}" is not a role: use reviewer, light or builder`;
}

export function setModel(folder, role, model, exec = hostExec) {
  const bad = checkedRole(role) || (isModelId(model) ? "" : `"${model}" is not a model id`);
  if (bad) return { ok: false, usage: true, error: bad };
  const state = modelsState(folder, exec);
  if (!state.ok) return state;
  const name = MODEL_VARIABLES[role];
  const set = exec("gh", ["variable", "set", name, "--body", model, "--repo", state.slug], folder);
  if (!set || set.status !== 0) return { ok: false, error: `gh could not set ${name} on ${state.slug}` };
  const item = state.roles.find((entry) => entry.role === role);
  return { ok: true, slug: state.slug, name, tool: item.tool, model };
}

export function resetModel(folder, role, exec = hostExec) {
  const bad = checkedRole(role);
  if (bad) return { ok: false, usage: true, error: bad };
  const state = modelsState(folder, exec);
  if (!state.ok) return state;
  const name = MODEL_VARIABLES[role];
  const item = state.roles.find((entry) => entry.role === role);
  if (!item.override) return { ok: true, slug: state.slug, name, tool: item.tool, model: item.configured, removed: false };
  const removed = exec("gh", ["variable", "delete", name, "--repo", state.slug], folder);
  if (!removed || removed.status !== 0) return { ok: false, error: `gh could not remove ${name} on ${state.slug}` };
  return { ok: true, slug: state.slug, name, tool: item.tool, model: item.configured, removed: true };
}

/** What a set or a reset did, in one sentence (the command and the guided page say the same). */
export function changeMessage(result) {
  if (result.removed === undefined) return `${result.name} is ${result.model} on ${result.slug}; the next cycle run uses ${result.tool} · ${result.model}`;
  return result.removed
    ? `${result.name} removed on ${result.slug}; the next cycle run uses the configured ${result.tool} · ${result.model}`
    : `${result.name} is not set on ${result.slug}; the configured ${result.tool} · ${result.model} is in use`;
}

function stateLines(state) {
  const lines = [`Models of ${state.slug} (each cycle run reads them when it starts):`];
  for (const item of state.roles) {
    let line = `${item.role.padEnd(9)} ${item.tool} · ${item.effective}`;
    if (item.override && isModelId(item.override)) line += ` — ${item.name} (configured: ${item.configured})`;
    else if (item.override) line += ` — ${item.name} is not a model id and is ignored`;
    else if (item.inherited) line += " (the reviewer reviews light tasks too)";
    lines.push(line);
  }
  lines.push("Change one: devos models set <reviewer|light|builder> <model> · back to the configured model: devos models reset <role>");
  return lines;
}

export function modelsCommand(args, cwd = process.cwd(), exec = hostExec) {
  const [verb, ...rest] = args;
  const say = (line) => console.log(line);
  if (verb === undefined || (args.length === 1 && verb !== "set" && verb !== "reset")) {
    const folder = path.resolve(verb ?? cwd);
    const state = modelsState(folder, exec);
    if (!state.ok) {
      say(`devos: models: ${state.error}`);
      return 1;
    }
    for (const line of stateLines(state)) say(line);
    return 0;
  }
  if (verb === "set" && (rest.length === 2 || rest.length === 3)) {
    const result = setModel(path.resolve(rest[2] ?? cwd), rest[0], rest[1], exec);
    if (!result.ok) {
      say(`devos: models: ${result.error}`);
      return result.usage ? 2 : 1;
    }
    say(`devos: ${changeMessage(result)}`);
    return 0;
  }
  if (verb === "reset" && (rest.length === 1 || rest.length === 2)) {
    const result = resetModel(path.resolve(rest[1] ?? cwd), rest[0], exec);
    if (!result.ok) {
      say(`devos: models: ${result.error}`);
      return result.usage ? 2 : 1;
    }
    say(`devos: ${changeMessage(result)}`);
    return 0;
  }
  say(USAGE);
  return 2;
}
