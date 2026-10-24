import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivedAnswers, modulesFor, stacksFor, typeById } from "./catalogue.mjs";
import { CONTRACT_VERSION } from "./contract.mjs";
import { KEY_RE, keyFromName } from "./install.mjs";
import { checkRoster } from "./roster.mjs";

const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;
const ATTACH_EXT = new Set([".md", ".txt", ".csv", ".json", ".yaml", ".yml"]);
const ATTACH_LIMIT = 200 * 1024;

function toolsCatalogue() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "tools.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

function cycleTool(id) {
  return toolsCatalogue().tools.some((tool) => tool.id === id && tool.cycle === true);
}

function attachmentName(filePath) {
  const cleaned = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "attachment";
}

export function buildAnswers(fields, project, blueprintAgent, attachmentNames) {
  const derived = derivedAnswers(project.modules);
  return {
    $comment: "Your answers to devos init. The blueprint reads them; change them here and ask for changes.",
    name: fields.name,
    key: keyFromName(fields.name),
    brief: fields.brief,
    users: fields.users,
    stores_data: derived.stores_data,
    sign_in: derived.sign_in,
    languages: fields.languages,
    deploy: derived.deploy,
    visibility: fields.visibility,
    type: project.type,
    stack: project.stack,
    modules: project.modules,
    scope: project.scope,
    contract_version: CONTRACT_VERSION,
    blueprint_agent: { tool: blueprintAgent.tool, model: blueprintAgent.model },
    attachments: attachmentNames,
  };
}

export function validatePlan(plan, detected) {
  const errors = [];
  const value = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  if (value.accepted !== true) errors.push("The contract was not accepted.");
  if (value.contract_version !== CONTRACT_VERSION) errors.push("The contract version does not match this engine.");

  const fields = value.fields && typeof value.fields === "object" ? value.fields : {};
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name === "" || !KEY_RE.test(keyFromName(name))) errors.push("The project name does not make a valid key.");
  const brief = typeof fields.brief === "string" ? fields.brief.trim() : "";
  if (brief === "") errors.push("The brief is empty.");
  const users = typeof fields.users === "string" ? fields.users.trim() : "";
  if (users === "") errors.push("The users line is empty.");
  let languages = fields.languages;
  if (languages === undefined) languages = ["en"];
  if (!Array.isArray(languages) || languages.length === 0 || languages.some((part) => typeof part !== "string" || !LANGUAGE.test(part))) {
    errors.push("Languages must list at least one language code.");
    languages = ["en"];
  }
  const visibility = fields.visibility;
  if (visibility !== "private" && visibility !== "public") errors.push("Visibility must be private or public.");

  const project = value.project && typeof value.project === "object" ? value.project : {};
  const type = typeById(project.type);
  if (!type) errors.push("The project type is not in the catalogue.");
  const stacks = type ? stacksFor(project.type) : [];
  const stack = stacks.find((item) => item.id === project.stack);
  if (!stack) errors.push("The stack is not one this project type can run.");
  const scope = project.scope;
  if (scope !== "mvp" && scope !== "full") errors.push("Scope must be mvp or full.");
  const chosenModules = project.modules && typeof project.modules === "object" && !Array.isArray(project.modules) ? project.modules : {};
  const typeModules = type ? modulesFor(project.type) : [];
  for (const [moduleId, providerId] of Object.entries(chosenModules)) {
    const module = typeModules.find((item) => item.id === moduleId);
    if (!module) {
      errors.push(`${moduleId} is not a module of this project type.`);
      continue;
    }
    const provider = module.providers.find((item) => item.id === providerId);
    if (!provider) {
      errors.push(`${providerId} is not a provider of ${moduleId}.`);
      continue;
    }
    if (stack && stack.toolchain !== "node" && provider.method) {
      errors.push(`${provider.label} is not available on a ${stack.toolchain} stack.`);
    }
  }

  const agentsIn = value.agents;
  const roleTools = [];
  if (agentsIn && typeof agentsIn === "object") {
    if (agentsIn.reviewer) roleTools.push(["reviewer", agentsIn.reviewer.tool]);
    if (agentsIn.reviewer_light) roleTools.push(["light reviewer", agentsIn.reviewer_light.tool]);
    for (const item of agentsIn.pool ?? []) roleTools.push(["builder", item?.tool]);
  }
  let agents = null;
  const blocked = roleTools.find(([, tool]) => !cycleTool(tool));
  if (blocked) errors.push(`The ${blocked[0]} must be a tool that runs in the GitHub cycle.`);
  else {
    agents = checkRoster(agentsIn);
    if (!agents) errors.push("The agents do not match the roster shape.");
  }

  const blueprint = value.blueprint && typeof value.blueprint === "object" ? value.blueprint : {};
  const found = (detected ?? []).find((agent) => agent.toolId === blueprint.tool);
  if (!found || found.status !== "installed" || found.signedIn !== true) {
    errors.push("The blueprint tool is not signed in on this computer.");
  }

  const attachments = [];
  const paths = Array.isArray(value.attachments) ? value.attachments : [];
  for (const filePath of paths) {
    if (typeof filePath !== "string" || filePath.trim() === "") {
      errors.push("An attachment path is missing.");
      continue;
    }
    let info;
    try {
      info = statSync(filePath);
    } catch {
      info = null;
    }
    if (!info || !info.isFile()) {
      errors.push(`${filePath} is not a file.`);
      continue;
    }
    if (!ATTACH_EXT.has(path.extname(filePath).toLowerCase()) || info.size > ATTACH_LIMIT) {
      errors.push(`${filePath} is not an attachment this engine accepts.`);
      continue;
    }
    attachments.push({ filePath, name: attachmentName(filePath) });
  }
  if (new Set(attachments.map((item) => item.name)).size !== attachments.length) {
    errors.push("Two attachments would be saved under the same name.");
  }

  if (errors.length > 0) return { ok: false, errors };
  const answers = buildAnswers(
    { name, brief, users, languages, visibility },
    { type: project.type, stack: project.stack, modules: chosenModules, scope },
    blueprint,
    attachments.map((item) => item.name),
  );
  return { ok: true, agents, answers, attachments };
}
