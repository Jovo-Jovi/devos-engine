// The project page (E26a): open a current DEV_OS project from this computer or from GitHub, and read its status.
// Reading changes nothing. Cloning needs a gh account that owns or administers the repository, and a repository
// that is a DEV_OS project. Names, versions and variable values only: no key is read or written.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resumePoint } from "./continue.mjs";
import { engineRoot, engineVersion, LOCK } from "./engine.mjs";
import { projectSlug, projectVariables } from "./models.mjs";
import { committed } from "./verify.mjs";
import { run } from "./which.mjs";

const CLONE_TIMEOUT = 300000;

/** Runs a command and returns { status, stdout }, or null when it is not installed (a clone may take minutes). */
export function hubExec(cmd, args, cwd, timeout = 120000) {
  const result = run(cmd, args, { cwd, timeout });
  if (!result) return null;
  return { status: result.status, stdout: String(result.stdout ?? "") };
}

/** owner/repo of the engine's own GitHub repository, from package.json `repository`. */
export function engineRepository(root = engineRoot()) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  const match = /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(String(url));
  return match ? `${match[1]}/${match[2]}` : "";
}

/** owner/repo from what a person pastes: a GitHub URL (https or ssh) or owner/repo; otherwise an error. */
export function parseRepositoryInput(text) {
  const value = String(text ?? "").trim();
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(value);
  if (!match || match[2] === "." || match[2] === "..") return { error: "Paste the repository's GitHub address, such as https://github.com/you/your-app, or you/your-app." };
  return { slug: `${match[1]}/${match[2]}`, name: match[2] };
}

/** -1, 0 or 1 for two x.y.z versions; null when either is not one. */
export function compareVersions(left, right) {
  const parse = (value) => (/^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split(".").map(Number) : null);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** The latest published DEV_OS release, from GitHub (gh api, read only). */
export function latestRelease(exec = hubExec, root = engineRoot()) {
  const repository = engineRepository(root);
  if (!repository) return { version: "", error: "package.json names no repository" };
  const result = exec("gh", ["api", `repos/${repository}/releases/latest`, "--jq", ".tag_name"], root);
  const tag = result && result.status === 0 ? result.stdout.trim() : "";
  const version = tag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { version: "", error: `gh could not read the latest release of ${repository}` };
  return { version, error: "" };
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Everything the project page shows about a started project. */
export function hubState(folder, exec = hubExec, root = engineRoot()) {
  const point = resumePoint(folder);
  if (!point.started) return { ok: false, error: "That folder holds no started DEV_OS project." };
  const lock = readJsonFile(path.join(folder, LOCK));
  const answers = readJsonFile(path.join(folder, "devos", "answers.json"));
  const latest = latestRelease(exec, root);
  const state = {
    ok: true,
    folder,
    name: path.basename(folder),
    approved: point.approved,
    committed: point.approved && committed(folder, exec),
    step: point.step,
    versions: { project: String(lock?.engine_version ?? ""), engine: engineVersion(root), latest: latest.version, latestError: latest.error },
    repository: projectSlug(folder, exec),
    reporting: "",
    reportingError: "",
    registryLink: typeof answers?.registry_link === "boolean" ? answers.registry_link : null,
  };
  if (state.repository) {
    const listed = projectVariables(folder, exec);
    if (listed.ok) state.reporting = String(listed.values.find((entry) => entry?.name === "DEVOS_REPORTING")?.value ?? "").trim() === "on" ? "on" : "off";
    else state.reportingError = listed.error;
  }
  return state;
}

/**
 * Clone a DEV_OS project from GitHub into `base`/<repo>, or reuse a clone of it already there. The gh account must
 * own or administer the repository (viewerPermission ADMIN), and its default branch must hold devos/engine.lock.json.
 */
export function cloneProject(input, base, exec = hubExec) {
  const parsed = parseRepositoryInput(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const { slug, name } = parsed;
  const viewed = exec("gh", ["repo", "view", slug, "--json", "nameWithOwner,viewerPermission"]);
  let repo = null;
  try {
    repo = viewed && viewed.status === 0 ? JSON.parse(viewed.stdout) : null;
  } catch {
    repo = null;
  }
  if (!repo) return { ok: false, error: `GitHub has no repository ${slug} that your gh account can see.` };
  if (repo.viewerPermission !== "ADMIN") {
    return { ok: false, error: `Your gh account must own or administer ${slug}; it has ${String(repo.viewerPermission || "no").toLowerCase()} access.` };
  }
  const lock = exec("gh", ["api", `repos/${slug}/contents/${LOCK}`, "--jq", ".path"]);
  if (!lock || lock.status !== 0) return { ok: false, error: `${slug} is not a DEV_OS project: its default branch has no ${LOCK}.` };
  const target = path.join(base, name);
  if (existsSync(target)) {
    if (projectSlug(target, exec).toLowerCase() !== slug.toLowerCase()) {
      return { ok: false, error: `${target} already exists and is not a clone of ${slug}. Move it, or open it as a folder.` };
    }
    return { ok: true, slug, folder: target, reused: true };
  }
  mkdirSync(base, { recursive: true });
  const cloned = exec("gh", ["repo", "clone", slug, target], base, CLONE_TIMEOUT);
  if (!cloned || cloned.status !== 0 || !resumePoint(target).started) {
    return { ok: false, error: `gh could not clone ${slug} into ${target}.` };
  }
  return { ok: true, slug, folder: target, reused: false };
}
