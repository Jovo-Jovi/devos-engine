// The project page (E26a): open a current DEV_OS project from this computer or from GitHub, and read its status.
// Reading changes nothing. Cloning needs a gh account that owns or administers the repository, and a repository
// that is a DEV_OS project. Names, versions and variable values only: no key is read or written.
// E26b: from the page, upgrade the project by pull request, bring its folder up to date with GitHub, and connect it
// to the Control Tower by pull request. Each is offered only when the page's facts allow it, and checked again here.
// E28 (PR-65): with DEVOS_REPORTING on, ask the Control Tower now: a devos-cycle link run (task=link, no task), whose
// report job asks for the link, when no devos-cycle run is queued or going.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resumePoint } from "./continue.mjs";
import { CONTRACT_VERSION } from "./contract.mjs";
import { engineRoot, engineVersion, LOCK } from "./engine.mjs";
import { projectSlug, projectVariables } from "./models.mjs";
import { committed } from "./verify.mjs";
import { run } from "./which.mjs";

const CLONE_TIMEOUT = 300000;
const UPGRADE_TIMEOUT = 300000;
export const CONNECT_BRANCH = "devos/connect";
const CONNECT_TITLE = "DEV_OS: link this project to the Control Tower";
const CONNECT_BODY = [
  "This pull request records your answer to the Control Tower link question: `devos/answers.json` gets `registry_link: true`",
  `and contract version ${CONTRACT_VERSION}, the contract you read on the project's page.`,
  "",
  "The repository variable `DEVOS_REPORTING` is on from now. When this pull request is merged, a devos-cycle link run",
  "(no task) asks the Control Tower to link this repository, or the devos-cycle run already going does.",
  "After its operator approves, each step sends one event (the contract lists every field). Nothing else is sent.",
  "To stop, set `DEVOS_REPORTING` to `off`.",
  "",
].join("\n");

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
    paused: false,
  };
  if (state.repository) {
    const listed = projectVariables(folder, exec);
    if (listed.ok) {
      state.reporting = String(listed.values.find((entry) => entry?.name === "DEVOS_REPORTING")?.value ?? "").trim() === "on" ? "on" : "off";
      // The workflows skip every run while DEVOS_PAUSED is exactly "true".
      state.paused = listed.values.find((entry) => entry?.name === "DEVOS_PAUSED")?.value === "true";
    } else state.reportingError = listed.error;
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

// ---------- E26b: upgrade, bring up to date, and connect ----------

/** A file on a branch of the project's GitHub repository: its text and its blob sha, or null. */
export function remoteFile(slug, file, ref, exec = hubExec) {
  const got = exec("gh", ["api", `repos/${slug}/contents/${file}?ref=${encodeURIComponent(ref)}`]);
  if (!got || got.status !== 0) return null;
  try {
    const value = JSON.parse(got.stdout);
    if (typeof value?.content !== "string" || typeof value?.sha !== "string") return null;
    return { text: Buffer.from(value.content, "base64").toString("utf8"), sha: value.sha };
  } catch {
    return null;
  }
}

/** The url of an open pull request from `head` in the project's repository, or "". */
function openPull(slug, head, exec) {
  const listed = exec("gh", ["pr", "list", "--repo", slug, "--head", head, "--state", "open", "--json", "url", "--jq", ".[].url"]);
  if (!listed || listed.status !== 0) return "";
  return listed.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https:\/\/github\.com\//.test(line)) ?? "";
}

/** What the page's actions depend on beyond hubState: branches, the version on GitHub, and open pull requests. */
export function actionFacts(state, exec = hubExec) {
  const facts = { branch: "", defaultBranch: "", github: "", pulls: { upgrade: "", connect: "" } };
  if (!state?.ok || !state.repository) return facts;
  const slug = state.repository;
  const branch = exec("git", ["branch", "--show-current"], state.folder);
  facts.branch = branch && branch.status === 0 ? branch.stdout.trim() : "";
  const repo = exec("gh", ["api", `repos/${slug}`, "--jq", ".default_branch"]);
  facts.defaultBranch = repo && repo.status === 0 ? repo.stdout.trim() : "";
  if (facts.defaultBranch) {
    const lock = remoteFile(slug, LOCK, facts.defaultBranch, exec);
    try {
      const version = String(JSON.parse(lock?.text ?? "null")?.engine_version ?? "");
      facts.github = /^\d+\.\d+\.\d+$/.test(version) ? version : "";
    } catch {
      facts.github = "";
    }
  }
  facts.pulls.upgrade = openPull(slug, `devos/upgrade-${state.versions.engine}`, exec);
  facts.pulls.connect = openPull(slug, CONNECT_BRANCH, exec);
  return facts;
}

/** Whether each action may run now, and why not: { upgrade, pull, connect }, each { can, why }. Reads nothing. */
export function decideActions(state, facts) {
  const no = (why) => ({ can: false, why });
  const yes = { can: true, why: "" };
  const v = state.versions;
  let common = "";
  if (!state.committed || !state.repository) common = "Finish the setup first: the project is not on GitHub yet.";
  else if (!v.latest) common = "The latest release could not be read from GitHub, so nothing can be compared.";
  else if (compareVersions(v.engine, v.latest) < 0) common = `Update DEV_OS first: this engine is ${v.engine} and the latest release is ${v.latest}.`;
  else if (!facts.defaultBranch || !facts.github) common = "The project's version on GitHub could not be read.";
  if (common) return { upgrade: no(common), pull: no(common), connect: no(common) };

  const local = compareVersions(v.project, facts.github);
  const onDefault = facts.branch !== "" && facts.branch === facts.defaultBranch;
  const switchFirst = `Switch this folder to ${facts.defaultBranch} first; it is on ${facts.branch || "no branch"}.`;
  const differ = `This folder has ${v.project || "no version"} and GitHub has ${facts.github}`;

  let pull;
  if (local === 0) pull = no("This folder has the same version as GitHub.");
  else if (local === null || local > 0) pull = no(`${differ}: commit and push this folder's changes, or open it in a terminal.`);
  else if (!onDefault) pull = no(switchFirst);
  else pull = yes;

  let upgrade;
  if (compareVersions(facts.github, v.engine) >= 0) upgrade = no(`The project already has ${facts.github}.`);
  else if (facts.pulls.upgrade) upgrade = no("An upgrade pull request is open: merge it on GitHub, then bring this folder up to date.");
  else if (local !== 0) upgrade = no(`${differ}: bring this folder up to date first.`);
  else if (!onDefault) upgrade = no(switchFirst);
  else upgrade = yes;

  let connect;
  if (state.reportingError) connect = no(state.reportingError);
  else if (state.reporting === "on") connect = no("The link is on: DEVOS_REPORTING is on.");
  else if (facts.pulls.connect) connect = no(`A link pull request is open: merge it on GitHub. If DEVOS_REPORTING is still off, set it: gh variable set DEVOS_REPORTING --body on --repo ${state.repository}`);
  else if (compareVersions(v.engine, v.latest) !== 0 || compareVersions(facts.github, v.latest) !== 0) {
    connect = no(`Connecting needs the latest release, ${v.latest}, in this engine and in the project on GitHub. This engine is ${v.engine} and the project is ${facts.github}.`);
  } else connect = yes;
  return { upgrade, pull, connect };
}

/** The first engine release whose devos-cycle has the link run, task=link (PR-65). */
export const ASK_SINCE = "1.2.1";

/**
 * What asking the Control Tower now depends on, read only when DEVOS_REPORTING is on: the number of devos-cycle runs
 * queued or going, or null when gh could not list them.
 */
export function askFacts(state, exec = hubExec) {
  const facts = { cycleRuns: null };
  if (!state?.ok || !state.repository || state.reporting !== "on") return facts;
  const runs = exec("gh", ["run", "list", "--repo", state.repository, "--workflow", "devos-cycle.yml", "--limit", "30", "--json", "status"]);
  try {
    const list = runs && runs.status === 0 ? JSON.parse(runs.stdout) : null;
    facts.cycleRuns = Array.isArray(list) ? list.filter((entry) => entry?.status !== "completed").length : null;
  } catch {
    facts.cycleRuns = null;
  }
  return facts;
}

/** Whether the page may ask the Control Tower now, and why not: { can, why }. Reads nothing. */
export function decideAsk(state, facts) {
  const no = (why) => ({ can: false, why });
  if (!state?.committed || !state.repository) return no("Finish the setup first: the project is not on GitHub yet.");
  if (state.reportingError) return no(state.reportingError);
  if (state.reporting !== "on") return no("Connect first: DEVOS_REPORTING is off.");
  if (state.paused) return no("DEVOS_PAUSED is true, so no devos-cycle run starts. Remove it or set it to false first.");
  if (facts.pulls?.connect) return no("Merge the link pull request on GitHub first: its merge asks the Control Tower.");
  const since = compareVersions(facts.github, ASK_SINCE);
  if (since === null || since < 0) {
    return no(`Asking needs DEV_OS ${ASK_SINCE} or later in the project on GitHub, which has ${facts.github || "an unknown version"}. Upgrade it first.`);
  }
  if (facts.cycleRuns === null || facts.cycleRuns === undefined) return no("gh could not list the project's devos-cycle runs.");
  if (facts.cycleRuns > 0) return no("A devos-cycle run is queued or going: it asks the Control Tower when it ends.");
  return { can: true, why: "" };
}

/** The facts and the decisions the page shows for a started project. */
export function hubActions(state, exec = hubExec) {
  const facts = actionFacts(state, exec);
  const ask = decideAsk(state, { ...facts, ...askFacts(state, exec) });
  return { ...facts, ...decideActions(state, facts), ask };
}

function runNode(args, cwd, timeout) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

/** devos upgrade in the project's folder: a branch, a commit and a pull request (lib/upgrade.mjs). */
export function upgradeProject(state, actions, root = engineRoot(), node = runNode) {
  if (!actions?.upgrade?.can) return { ok: false, error: actions?.upgrade?.why || "The upgrade is not possible now." };
  const result = node([path.join(root, "bin", "devos.mjs"), "upgrade"], state.folder, UPGRADE_TIMEOUT);
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-20);
  if (!result || result.status !== 0) return { ok: false, error: output.at(-1) ?? "devos upgrade did not finish.", output };
  return { ok: true, message: `The pull request that upgrades the project to ${state.versions.engine} is open on GitHub. Merge it there, then bring this folder up to date.`, output };
}

/** git pull --ff-only in the project's folder, on its default branch. */
export function pullProject(state, actions, exec = hubExec) {
  if (!actions?.pull?.can) return { ok: false, error: actions?.pull?.why || "Bringing this folder up to date is not possible now." };
  const pulled = exec("git", ["pull", "--ff-only"], state.folder);
  if (!pulled || pulled.status !== 0) return { ok: false, error: "git pull --ff-only did not finish. The folder may have changes of its own: open it in a terminal and run git status." };
  return { ok: true, message: "This folder is up to date with GitHub." };
}

/**
 * Connect to the Control Tower: a pull request on GitHub records registry_link and the contract version in
 * devos/answers.json (branch devos/connect, through the GitHub API; the folder is not touched), then the
 * repository variable DEVOS_REPORTING is on. When GitHub's answers already record the link, only the variable is set.
 */
export function connectProject(state, actions, exec = hubExec) {
  if (!actions?.connect?.can) return { ok: false, error: actions?.connect?.why || "Connecting is not possible now." };
  const slug = state.repository;
  const base = actions.defaultBranch;
  const answers = remoteFile(slug, "devos/answers.json", base, exec);
  let value = null;
  try {
    value = answers ? JSON.parse(answers.text) : null;
  } catch {
    value = null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: `gh could not read devos/answers.json on ${base} in ${slug}.` };
  let pull = "";
  if (!(value.registry_link === true && value.contract_version === CONTRACT_VERSION)) {
    const head = exec("gh", ["api", `repos/${slug}/git/ref/heads/${base}`, "--jq", ".object.sha"]);
    const sha = head && head.status === 0 ? head.stdout.trim() : "";
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: `gh could not read the last commit of ${base} in ${slug}.` };
    const branch = exec("gh", ["api", `repos/${slug}/git/refs`, "-X", "POST", "-f", `ref=refs/heads/${CONNECT_BRANCH}`, "-f", `sha=${sha}`]);
    if (!branch || branch.status !== 0) {
      return { ok: false, error: `GitHub did not create the branch ${CONNECT_BRANCH} in ${slug}. If it exists already, close its pull request and delete the branch, then try again.` };
    }
    const next = `${JSON.stringify({ ...value, registry_link: true, contract_version: CONTRACT_VERSION }, null, 2)}\n`;
    const dir = mkdtempSync(path.join(tmpdir(), "devos-connect-"));
    try {
      const put = path.join(dir, "answers.json");
      writeFileSync(put, JSON.stringify({ message: CONNECT_TITLE, content: Buffer.from(next, "utf8").toString("base64"), sha: answers.sha, branch: CONNECT_BRANCH }));
      const changed = exec("gh", ["api", `repos/${slug}/contents/devos/answers.json`, "-X", "PUT", "--input", put]);
      if (!changed || changed.status !== 0) {
        return { ok: false, error: `GitHub did not take the change to devos/answers.json. Delete the branch ${CONNECT_BRANCH} in ${slug}, then try again.` };
      }
      const body = path.join(dir, "body.md");
      writeFileSync(body, CONNECT_BODY);
      const opened = exec("gh", ["pr", "create", "--repo", slug, "--base", base, "--head", CONNECT_BRANCH, "--title", CONNECT_TITLE, "--body-file", body]);
      pull = opened && opened.status === 0 ? opened.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https:\/\/github\.com\//.test(line)) ?? "" : "";
      if (!pull) {
        return { ok: false, error: `The branch ${CONNECT_BRANCH} holds the change, but gh could not open its pull request. Open it on GitHub, or delete the branch and try again.` };
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const set = exec("gh", ["variable", "set", "DEVOS_REPORTING", "--body", "on", "--repo", slug]);
  if (!set || set.status !== 0) {
    return { ok: false, pull, error: `gh could not set DEVOS_REPORTING. Set it yourself: gh variable set DEVOS_REPORTING --body on --repo ${slug}` };
  }
  const message = pull
    ? "DEVOS_REPORTING is on, and the pull request that records your answer is open: merge it on GitHub. The merge starts a devos-cycle link run that asks the Control Tower to link this repository, and its operator approves it once."
    : "DEVOS_REPORTING is on. The project already records your answer, so no pull request was needed. Ask the Control Tower now on this page, or the next cycle run asks.";
  return { ok: true, pull, message };
}

/** Ask the Control Tower now (PR-65): start a devos-cycle link run (task=link, no task); its report job asks. */
export function askTower(state, actions, exec = hubExec) {
  if (!actions?.ask?.can) return { ok: false, error: actions?.ask?.why || "Asking the Control Tower is not possible now." };
  const slug = state.repository;
  const started = exec("gh", ["workflow", "run", "devos-cycle.yml", "--repo", slug, "--ref", actions.defaultBranch, "-f", "task=link"]);
  if (!started || started.status !== 0) {
    return { ok: false, error: `gh could not start the link run. Start it yourself: gh workflow run devos-cycle.yml --repo ${slug} -f task=link` };
  }
  return { ok: true, message: "A devos-cycle link run is starting on GitHub. It builds nothing: its report job asks the Control Tower to link this repository, and the Control Tower's operator approves it once." };
}
