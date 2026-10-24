import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { doctorCommand } from "./doctor.mjs";
import { neededKeys } from "./keys.mjs";
import { lineReader } from "./menu.mjs";
import { cleanModelId } from "./probes.mjs";
import { devosHome } from "./profile.mjs";
import { finishSetup, repoSlug } from "./setup.mjs";
import { run } from "./which.mjs";

const RUN = { timeout: 120000 };

function mark(ok) {
  return ok ? "✓" : "·";
}

function ownerOf(folder) {
  try {
    const file = path.join(devosHome(), ".devos", "profile.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data.github_owner === "string" && data.github_owner.length > 0) return data.github_owner;
  } catch {
    /* an unreadable profile falls through to gh */
  }
  const login = run("gh", ["api", "user", "--jq", ".login"], { cwd: folder, timeout: RUN.timeout });
  if (!login || login.status !== 0) return "";
  return String(login.stdout ?? "").trim();
}

function committed(folder) {
  const head = run("git", ["rev-parse", "HEAD"], { cwd: folder, timeout: RUN.timeout });
  return Boolean(head && head.status === 0);
}

function repoReady(folder, slug) {
  const remote = run("git", ["remote", "get-url", "origin"], { cwd: folder, timeout: RUN.timeout });
  if (!remote || remote.status !== 0 || !String(remote.stdout ?? "").trim()) return false;
  const view = run("gh", ["repo", "view", slug, "--json", "name"], { cwd: folder, timeout: RUN.timeout });
  return Boolean(view && view.status === 0);
}

function keysReady(folder, answers, slug) {
  let setup;
  try {
    setup = JSON.parse(readFileSync(path.join(folder, "devos", "setup.json"), "utf8"));
  } catch {
    return false;
  }
  let agents = {};
  try {
    agents = JSON.parse(readFileSync(path.join(folder, "devos.config.json"), "utf8")).agents ?? {};
  } catch {
    agents = {};
  }
  const names = neededKeys(setup, answers, agents).filter((key) => !key.optional).map((key) => key.name);
  const listed = run("gh", ["secret", "list", "--repo", slug, "--json", "name"], { cwd: folder, timeout: RUN.timeout });
  if (!listed || listed.status !== 0) return false;
  try {
    const have = new Set(JSON.parse(listed.stdout).map((row) => row.name));
    return names.every((name) => have.has(name));
  } catch {
    return false;
  }
}

function cycleReady(folder, slug) {
  const listed = run("gh", [
    "run", "list", "--repo", slug, "--workflow", "devos-cycle.yml", "--limit", "1", "--json", "databaseId",
  ], { cwd: folder, timeout: RUN.timeout });
  if (!listed || listed.status !== 0) return false;
  try {
    const rows = JSON.parse(listed.stdout);
    return Array.isArray(rows) && rows.some((row) => row && row.databaseId != null);
  } catch {
    return false;
  }
}

function checklist(folder) {
  const answersFile = path.join(folder, "devos", "answers.json");
  const hasAnswers = existsSync(answersFile);
  const hasLock = existsSync(path.join(folder, "devos", "engine.lock.json"));
  const approved = existsSync(path.join(folder, ".claude", "settings.json"));
  const hasCommit = hasAnswers && committed(folder);
  let answers = null;
  if (hasAnswers) {
    try {
      answers = JSON.parse(readFileSync(answersFile, "utf8"));
    } catch {
      answers = null;
    }
  }
  const slug = answers ? repoSlug(ownerOf(folder), answers) : "";
  const hasRepo = hasCommit && slug && repoReady(folder, slug);
  const hasKeys = hasCommit && slug && answers && keysReady(folder, answers, slug);
  const hasCycle = hasCommit && slug && cycleReady(folder, slug);
  const rows = [
    [hasAnswers, "answers", "devos"],
    [hasLock, "engine files", "devos"],
    [approved, "blueprint approved", "you"],
    [hasCommit, "local commit", "devos"],
    [hasRepo, "repository", "devos"],
    [hasKeys, "keys", "you"],
    [hasCycle, "first cycle", "devos"],
  ];
  for (const [ok, name, who] of rows) console.log(`${mark(ok)} ${name} (${who})`);
  return { rows, answers };
}

export function startedProject(folder) {
  const started = existsSync(path.join(folder, "devos", "answers.json"))
    && existsSync(path.join(folder, "devos", "engine.lock.json"));
  const approved = started && existsSync(path.join(folder, ".claude", "settings.json"));
  return { started, approved };
}

// Where `devos continue` picks up, from local files only (no gh call): the guided page shows it.
export function resumePoint(folder) {
  const { started, approved } = startedProject(folder);
  if (!started) return { started, approved, step: "" };
  if (!approved) {
    const written = existsSync(path.join(folder, "docs", "PHASES.md"));
    return { started, approved, step: written ? "approve the blueprint, or ask for changes" : "write the blueprint" };
  }
  if (!committed(folder)) return { started, approved, step: "the keys, then the repository on GitHub" };
  return { started, approved, step: "check the repository, the keys and the first cycle on GitHub" };
}

// A model saved before E22f may be a whole listing row (`grok-4.7-xhigh-fast - Grok 4.7 …`): keep only its id.
export function cleanSavedModels(folder) {
  const changed = [];
  const answersFile = path.join(folder, "devos", "answers.json");
  try {
    const answers = JSON.parse(readFileSync(answersFile, "utf8"));
    const model = answers?.blueprint_agent?.model;
    if (typeof model === "string" && cleanModelId(model) !== model) {
      answers.blueprint_agent.model = cleanModelId(model);
      writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
      changed.push("devos/answers.json");
    }
  } catch {
    /* no answers yet */
  }
  const projectFile = path.join(folder, "devos", "project.json");
  try {
    const project = JSON.parse(readFileSync(projectFile, "utf8"));
    const agents = project?.agents;
    let dirty = false;
    for (const agent of [agents?.reviewer, agents?.reviewer_light, ...(Array.isArray(agents?.pool) ? agents.pool : [])]) {
      if (agent && typeof agent.model === "string" && cleanModelId(agent.model) !== agent.model) {
        agent.model = cleanModelId(agent.model);
        dirty = true;
      }
    }
    if (dirty) {
      writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`);
      spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], { cwd: folder, encoding: "utf8", windowsHide: true });
      changed.push("devos/project.json");
    }
  } catch {
    /* no project file yet */
  }
  for (const file of changed) console.log(`devos: kept only the model id in ${file}`);
  return changed;
}

async function continueSteps(folder) {
  const answersFile = path.join(folder, "devos", "answers.json");
  const hasAnswers = existsSync(answersFile);
  const hasLock = existsSync(path.join(folder, "devos", "engine.lock.json"));
  if (!hasAnswers || !hasLock) {
    checklist(folder);
    console.log("devos: start with devos init in an empty folder");
    return 1;
  }
  cleanSavedModels(folder);
  if (doctorCommand() !== 0) return 1;
  const { rows, answers } = checklist(folder);
  const gap = rows.findIndex((row) => !row[0]);
  if (gap === -1) {
    console.log("devos: everything is done — the cycle runs on GitHub; merge its pull requests at the gates");
    return 0;
  }
  if (gap <= 1) {
    console.log("devos: start with devos init in an empty folder");
    return 1;
  }
  const read = lineReader(process.stdin);
  if (process.env.DEVOS_UI === "1") {
    read.isTTY = false;
    read.interactive = true;
  }
  if (gap === 2) {
    const { resumeBlueprint } = await import("./init.mjs");
    return resumeBlueprint(folder, answers, read);
  }
  return finishSetup(folder, answers, read);
}

export async function continueCommand(folder) {
  const code = await continueSteps(folder);
  if (process.env.DEVOS_UI === "1") {
    process.stdout.write("\n");
    console.log(`::devos-step ${JSON.stringify({ step: "done", code })}`);
  }
  return code;
}
