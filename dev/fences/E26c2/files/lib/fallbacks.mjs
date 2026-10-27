// Several models per role, edited by pull request (E26c2, PR-64). A role's fallback_models change in devos/project.json
// and in the generated devos.config.json on a branch of the project's GitHub repository, through the GitHub API, and a
// pull request carries them: they apply from the next cycle run after you merge it. The folder on this computer is not
// touched, and nothing is merged here. Model ids only: no key is read or written.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { jsonText, merge } from "../payload/files/scripts/devos/config.mjs";
import { hubExec, remoteFile } from "./hub.mjs";
import { configuredRoles, isModelId, projectSlug, ROLES } from "./models.mjs";

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
  const slug = projectSlug(folder, exec);
  if (!slug) return { ok: false, error: "this project has no GitHub repository yet (git remote origin); finish devos continue first" };
  const repo = exec("gh", ["api", `repos/${slug}`, "--jq", ".default_branch"]);
  const base = repo && repo.status === 0 ? repo.stdout.trim() : "";
  if (!base) return { ok: false, error: `gh could not read the default branch of ${slug}` };
  const projectFile = remoteFile(slug, "devos/project.json", base, exec);
  const configFile = remoteFile(slug, "devos.config.json", base, exec);
  const project = readJson(projectFile);
  const defaults = readJson(remoteFile(slug, "devos/engine.defaults.json", base, exec));
  if (!plain(project) || !plain(defaults) || !configFile) {
    return { ok: false, error: `gh could not read devos/project.json, devos/engine.defaults.json and devos.config.json on ${base} in ${slug}` };
  }
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

  const head = exec("gh", ["api", `repos/${slug}/git/ref/heads/${base}`, "--jq", ".object.sha"]);
  const sha = head && head.status === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: `gh could not read the last commit of ${base} in ${slug}` };
  const branch = fallbackBranch(role);
  const created = exec("gh", ["api", `repos/${slug}/git/refs`, "-X", "POST", "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
  if (!created || created.status !== 0) {
    return { ok: false, error: `GitHub did not create the branch ${branch} in ${slug}. A pull request for ${ROLE_NAMES[role]}'s models may be open: merge or close it and delete the branch, then try again.` };
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
  const dir = mkdtempSync(path.join(tmpdir(), "devos-models-"));
  let pull = "";
  try {
    for (const [file, text, remote] of [["devos/project.json", jsonText(project), projectFile], ["devos.config.json", jsonText(config), configFile]]) {
      const put = path.join(dir, "put.json");
      writeFileSync(put, JSON.stringify({ message: title, content: Buffer.from(text, "utf8").toString("base64"), sha: remote.sha, branch }));
      const changed = exec("gh", ["api", `repos/${slug}/contents/${file}`, "-X", "PUT", "--input", put]);
      if (!changed || changed.status !== 0) {
        return { ok: false, error: `GitHub did not take the change to ${file}. Delete the branch ${branch} in ${slug}, then try again.` };
      }
    }
    const bodyFile = path.join(dir, "body.md");
    writeFileSync(bodyFile, body);
    const opened = exec("gh", ["pr", "create", "--repo", slug, "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile]);
    pull = opened && opened.status === 0 ? opened.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https:\/\/github\.com\//.test(line)) ?? "" : "";
    if (!pull) return { ok: false, error: `The branch ${branch} holds the change, but gh could not open its pull request. Open it on GitHub, or delete the branch and try again.` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok: true, slug, role, models, pull, unchanged: false };
}

/** What a change did, in one sentence (the command and the guided page say the same; the page links the pull request). */
export function fallbackMessage(result, { link = true } = {}) {
  const who = ROLE_NAMES[result.role];
  if (result.unchanged) return `${who} already has ${result.models.length ? `the next models ${result.models.join(", ")}` : "no next models"} on ${result.slug}; nothing to change`;
  const what = result.models.length ? `the next models ${result.models.join(", ")}` : "no next models";
  return `${link ? `the pull request ${result.pull}` : "a pull request"} gives ${who} ${what}; merge it on GitHub to use them from the next cycle run, then pull this folder`;
}
