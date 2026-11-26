import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LOCK,
  engineRoot,
  engineVersion,
  hashFile,
  normalizeLf,
  readManifest,
  safeRelative,
  writeLock,
} from "./engine.mjs";
import { compareVersions, isCandidate, isRelease } from "./version.mjs";
import { run } from "./which.mjs";
import { confirm, lineReader, select } from "./menu.mjs";
import { missingChoices } from "../payload/files/scripts/devos/agents.mjs";
import { effortsFor } from "../payload/files/scripts/devos/lib.mjs";

// E79 (PR-99): a pool builder's fixed effort, or `fence` when the reviewer chooses it in each fence.
const BUILDER_EFFORTS = ["low", "medium", "high", "xhigh"];

/**
 * E79 (PR-99): the choices a project made before 1.13.11 lacks (the efforts DEV_OS used to pick, and raise_on_retry),
 * asked once, with nothing chosen for the developer. The answers go into devos/project.json on the upgrade branch, so
 * the next upgrade asks nothing. Returns the agents with the answers, or null when the input ended or no answer held.
 */
export async function askMissingChoices(read, agents, out = process.stdout) {
  const missing = missingChoices(agents);
  if (missing.length === 0) return agents;
  out.write(`DEV_OS ${missing.length === 1 ? "needs one choice" : `needs ${missing.length} choices`} it no longer makes for you (PR-99): ${missing.map((entry) => entry.key).join(", ")}.\n`);
  const next = structuredClone(agents);
  const effort = async (title, tool) => select(read, out, { title, options: effortsFor(tool).map((level) => ({ value: level, label: level })), defaultIndex: null });
  for (const { key } of missing) {
    let value;
    if (key === "agents.reviewer.effort") value = await effort(`Reviewer effort (${next.reviewer.tool} · ${next.reviewer.model}) — deep reviews, method changes, intake, the supervisor and the doctor`, next.reviewer.tool);
    else if (key === "agents.reviewer.gate_effort") value = await effort("Reviewer effort on a gate — the tasks a human gate closes", next.reviewer.tool);
    else if (key === "agents.reviewer.light_effort") value = await effort("Effort of the reviewer's light reviews (risk 1–2)", next.reviewer.tool);
    else if (key === "agents.reviewer_light.effort") value = await effort(`Light reviewer effort (${next.reviewer_light.tool} · ${next.reviewer_light.model})`, next.reviewer_light.tool);
    else if (key === "agents.raise_on_retry") value = await confirm(read, out, "On a retry, raise the reviewer's effort one step (Claude Code and Codex reviewers)?", null);
    else {
      const id = /^agents\.pool\[(.+)\]\.effort$/.exec(key)?.[1];
      const item = (next.pool ?? []).find((entry) => entry.id === id);
      if (!item) return null;
      value = await select(read, out, {
        title: `Effort of ${item.id} (${item.tool} · ${item.model})`,
        options: [
          ...BUILDER_EFFORTS.map((level) => ({ value: level, label: `${level} for every task` })),
          { value: "fence", label: "fence — the reviewer chooses it in each fence" },
        ],
        defaultIndex: null,
      });
      if (value === null || value === undefined) return null;
      item.effort = value;
      continue;
    }
    if (value === null || value === undefined) return null;
    const [, role, field] = key.split(".");
    if (role === "raise_on_retry") next.raise_on_retry = value;
    else next[role][field] = value;
  }
  return missingChoices(next).length === 0 ? next : null;
}

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * E62, E85d (D-E19): devos upgrade runs between releases (X.Y.Z) and release candidates (X.Y.Z-rc.N); any other
 * version is named, never a stack trace. A candidate is for a test project and is taken only with --pre.
 */
export function upgradeVersion(version) {
  return isRelease(version) || isCandidate(version);
}

function hashAt(current, filePath) {
  if (current instanceof Map) {
    const value = current.get(filePath);
    return value === undefined ? null : value;
  }
  if (current && Object.hasOwn(current, filePath)) return current[filePath] ?? null;
  return null;
}

function indexFiles(files) {
  const indexed = new Map();
  for (const file of files ?? []) indexed.set(file.path, file.sha256);
  return indexed;
}

function decide(filePath, installed, shipped, current) {
  if (installed === null) {
    if (current === null) return { path: filePath, outcome: "add", next: shipped };
    if (current === shipped) return { path: filePath, outcome: "adopt", next: shipped };
    return { path: filePath, outcome: "conflict", reason: "exists, not installed by devos" };
  }
  if (shipped === null) {
    if (current === null) return { path: filePath, outcome: "drop", installed };
    if (current === installed) return { path: filePath, outcome: "remove", installed };
    return { path: filePath, outcome: "conflict", reason: "edited locally, removed upstream", installed };
  }
  if (shipped === installed) {
    if (current === installed) return { path: filePath, outcome: "same", installed, next: shipped };
    return { path: filePath, outcome: "kept", installed };
  }
  if (current === installed) return { path: filePath, outcome: "update", installed, next: shipped };
  if (current === shipped) return { path: filePath, outcome: "adopt", installed, next: shipped };
  if (current === null) return { path: filePath, outcome: "conflict", reason: "deleted locally and changed upstream", installed };
  return { path: filePath, outcome: "conflict", reason: "edited locally and changed upstream", installed };
}

export function planUpgrade(lock, manifest, current) {
  const installed = indexFiles(lock.files);
  const shipped = indexFiles(manifest.files);
  const paths = [...new Set([...installed.keys(), ...shipped.keys()])].sort(comparePath);
  return paths.map((filePath) => decide(filePath, installed.get(filePath) ?? null, shipped.get(filePath) ?? null, hashAt(current, filePath)));
}

function git(args, cwd, timeout = 15000) {
  const result = run("git", args, { cwd, timeout });
  if (!result) return { status: 1, stdout: "", stderr: "devos: git is not installed\n" };
  return result;
}

function section(heading, lines) {
  const body = lines.length === 0 ? "- none" : lines.map((line) => `- ${line}`).join("\n");
  return `${heading}\n${body}`;
}

function releaseNotes(root, version) {
  const file = path.join(root, "CHANGELOG.md");
  if (!existsSync(file)) return "none in this release";
  const lines = readFileSync(file, "utf8").replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start < 0) return "none in this release";
  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  if (end < 0) end = lines.length;
  const sectionText = lines.slice(start, end).join("\n").trimEnd();
  return sectionText || "none in this release";
}

function prBody(from, to, plan, root) {
  const linesOf = (outcome) => plan.filter((item) => item.outcome === outcome).map((item) => item.path);
  const conflicts = plan.filter((item) => item.outcome === "conflict").map((item) => `${item.path} — ${item.reason}`);
  const removed = [...linesOf("remove"), ...linesOf("drop")].sort(comparePath);
  return [
    `DEV_OS upgrade ${from} to ${to}`,
    "",
    section("updated:", linesOf("update")),
    "",
    section("added:", linesOf("add")),
    "",
    section("removed:", removed),
    "",
    section("conflicts:", conflicts),
    "",
    section("kept (your edits, nothing changed upstream):", linesOf("kept")),
    "",
    "Release notes:",
    releaseNotes(root, to),
    "",
  ].join("\n");
}

function lockEntries(plan, located = new Map()) {
  const entries = [];
  const at = (filePath) => (located.has(filePath) ? { at: located.get(filePath) } : {});
  for (const item of plan) {
    if (item.outcome === "remove" || item.outcome === "drop") continue;
    if (item.outcome === "add" || item.outcome === "update" || item.outcome === "adopt") {
      entries.push({ path: item.path, sha256: item.next, ...at(item.path) });
    } else if (item.installed) {
      entries.push({ path: item.path, sha256: item.installed, ...at(item.path) });
    }
  }
  return entries;
}

function payloadBytes(root, stored) {
  safeRelative(stored);
  return normalizeLf(readFileSync(path.join(root, "payload", "files", ...stored.split("/"))));
}

function count(plan, outcome) {
  return plan.filter((item) => item.outcome === outcome).length;
}

export async function upgradeCommand(args, read = null) {
  const known = ["--local", "--pre"];
  if (args.some((arg) => !known.includes(arg)) || new Set(args).size !== args.length) {
    console.log("devos upgrade [--local] [--pre]");
    return 2;
  }
  return runUpgrade(process.cwd(), args.includes("--local"), read, args.includes("--pre"));
}

async function runUpgrade(project, local, reader, pre = false) {
  const lockPath = path.join(project, ...LOCK.split("/"));
  if (!existsSync(lockPath)) {
    console.log("devos: not installed here; run devos install");
    return 1;
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  // E36a: an engine file the project keeps elsewhere (its lock entry's `at`) is read and written there.
  const located = new Map();
  for (const entry of lock.files ?? []) {
    if (typeof entry.at !== "string") continue;
    safeRelative(entry.at);
    located.set(entry.path, entry.at);
  }
  const where = (filePath) => located.get(filePath) ?? filePath;
  const root = engineRoot();
  const to = engineVersion(root);
  const from = lock.engine_version;
  for (const [version, where] of [[from, `${LOCK} in this project`], [to, "this engine's package.json"]]) {
    if (!upgradeVersion(version)) {
      console.log(`devos: ${where} names engine "${version}", which is neither a release (X.Y.Z) nor a release candidate (X.Y.Z-rc.N); devos upgrade runs between those`);
      return 1;
    }
  }
  // E85d (D-E19): a release candidate goes only to a test project, and only when asked for.
  if (isCandidate(to) && !pre) {
    console.log(`devos: this engine is ${to}, a release candidate; a test project takes it with devos upgrade --pre, and a project for real work stays on releases`);
    return 1;
  }
  if (compareVersions(from, to) > 0) {
    console.log(`devos: this project has engine ${from}; this engine is ${to}`);
    return 1;
  }

  const status = git(["status", "--porcelain"], project);
  if (status.status !== 0) {
    process.stderr.write(status.stderr ?? "");
    return 1;
  }
  if (status.stdout.trim() !== "") {
    console.log("devos: the working tree is not clean; commit or stash first");
    return 1;
  }

  const currentBranch = git(["branch", "--show-current"], project);
  if (currentBranch.status !== 0) {
    process.stderr.write(currentBranch.stderr ?? "");
    return 1;
  }
  const base = currentBranch.stdout.trim();
  if (!base) {
    console.log("devos: check out a branch first");
    return 1;
  }

  const branch = `devos/upgrade-${to}`;
  const existing = git(["branch", "--list", branch], project);
  if (existing.status !== 0) {
    process.stderr.write(existing.stderr ?? "");
    return 1;
  }
  if (existing.stdout.trim() !== "") {
    console.log(`devos: branch ${branch} already exists`);
    return 1;
  }

  const manifest = readManifest(root);
  const shipped = new Map(manifest.files.map((file) => [file.path, file]));
  const paths = [...new Set([...lock.files.map((file) => file.path), ...shipped.keys()])];
  const current = new Map();
  for (const filePath of paths) {
    safeRelative(filePath);
    current.set(filePath, hashFile(path.join(project, ...where(filePath).split("/"))));
  }
  const plan = planUpgrade(lock, manifest, current);
  const conflicts = plan.filter((item) => item.outcome === "conflict");
  const actionable = plan.some((item) => ["add", "update", "remove", "drop", "adopt"].includes(item.outcome));
  if (!actionable && compareVersions(from, to) === 0) {
    console.log(`devos: up to date (${to})`);
    for (const item of conflicts) console.log(`- ${item.path} — ${item.reason}`);
    return 0;
  }

  // E79 (PR-99): a project whose agents lack a choice DEV_OS used to make is asked for it once, before anything changes.
  const projectFile = path.join(project, "devos", "project.json");
  let chosenAgents = null;
  if (existsSync(projectFile)) {
    let own;
    try {
      own = JSON.parse(readFileSync(projectFile, "utf8"));
    } catch {
      console.log("devos: devos/project.json is not valid JSON; fix it, commit, then run devos upgrade again");
      return 1;
    }
    const agents = own?.agents;
    if (agents && typeof agents === "object" && !Array.isArray(agents) && agents.reviewer && Array.isArray(agents.pool)) {
      const missing = missingChoices(agents);
      if (missing.length > 0) {
        const answered = await askMissingChoices(reader ?? lineReader(process.stdin), agents);
        if (!answered) {
          console.log(`devos: nothing changed. devos upgrade asks for ${missing.map((entry) => entry.key).join(", ")} in a terminal in this folder; or set ${missing.length === 1 ? "it" : "them"} in devos/project.json, commit, and run devos upgrade again (PR-99)`);
          return 1;
        }
        chosenAgents = { project: own, agents: answered };
      }
    } else if (agents === undefined) {
      console.log("devos: note: devos/project.json has no agents; the cycle stops until its reviewer, builders and efforts are set there (PR-99)");
    }
  }

  const gitDir = git(["rev-parse", "--absolute-git-dir"], project);
  if (gitDir.status !== 0) {
    process.stderr.write(gitDir.stderr ?? "");
    return 1;
  }
  const bodyPath = path.join(gitDir.stdout.trim(), "devos-upgrade-body.md");

  const created = git(["switch", "-c", branch], project);
  if (created.status !== 0) {
    process.stderr.write(created.stderr ?? "");
    return 1;
  }

  const switchBack = () => {
    const back = git(["switch", base], project);
    if (back.status !== 0) {
      process.stderr.write(back.stderr ?? "");
      return false;
    }
    return true;
  };

  // E62: a path HEAD does not track (an engine file the project's .gitignore hides) has no copy in git. Its bytes are
  // kept here before the upgrade writes, and the rollback puts them back, so git restore gets only what HEAD has.
  const listed = git(["ls-tree", "-r", "--name-only", "-z", "HEAD"], project);
  const tracked = new Set(listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : []);
  const saved = new Map();
  const touched = [
    ...plan.filter((item) => item.outcome === "update" || item.outcome === "remove").map((item) => where(item.path)),
    LOCK,
    "devos.config.json",
    ...(chosenAgents ? ["devos/project.json"] : []),
  ];
  for (const rel of touched) {
    const abs = path.join(project, ...rel.split("/"));
    if (!tracked.has(rel) && existsSync(abs)) saved.set(rel, readFileSync(abs));
  }

  const rollback = () => {
    const restore = touched.filter((rel) => tracked.has(rel));
    if (restore.length > 0) {
      const restored = git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...restore], project);
      if (restored.status !== 0) process.stderr.write(restored.stderr ?? "");
    }
    for (const [rel, bytes] of saved) {
      const abs = path.join(project, ...rel.split("/"));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
      git(["reset", "-q", "HEAD", "--", rel], project);
    }
    for (const item of plan) {
      if (item.outcome !== "add") continue;
      // A staged add stays in the index after the worktree file is deleted.
      git(["reset", "-q", "HEAD", "--", where(item.path)], project);
      const abs = path.join(project, ...where(item.path).split("/"));
      if (existsSync(abs)) unlinkSync(abs);
    }
    const back = git(["switch", base], project);
    if (back.status !== 0) process.stderr.write(back.stderr ?? "");
    const deleted = git(["branch", "-D", branch], project);
    if (deleted.status !== 0) process.stderr.write(deleted.stderr ?? "");
    console.log("devos: upgrade failed; rolled back, nothing changed");
  };

  try {
    for (const item of plan) {
      if (item.outcome !== "add" && item.outcome !== "update") continue;
      const entry = shipped.get(item.path);
      const dest = path.join(project, ...where(item.path).split("/"));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, payloadBytes(root, entry.stored));
    }
    for (const item of plan) {
      if (item.outcome !== "remove") continue;
      unlinkSync(path.join(project, ...where(item.path).split("/")));
    }
    writeLock(project, to, lockEntries(plan, located));
    if (chosenAgents) writeFileSync(projectFile, `${JSON.stringify({ ...chosenAgents.project, agents: chosenAgents.agents }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    rollback();
    return 1;
  }

  const defaultsWritten = plan.some((item) => item.path === "devos/engine.defaults.json" && (item.outcome === "add" || item.outcome === "update"));
  let regenerated = false;
  if ((defaultsWritten || chosenAgents) && existsSync(path.join(project, "devos", "project.json"))) {
    const config = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
    });
    if (config.status !== 0) {
      if (config.stdout) process.stdout.write(config.stdout);
      if (config.stderr) process.stderr.write(config.stderr);
      rollback();
      return 1;
    }
    regenerated = true;
  }

  try {
    writeFileSync(bodyPath, prBody(from, to, plan, root));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    rollback();
    return 1;
  }

  // E62: a removed file HEAD never tracked has nothing to stage; naming it would fail git add.
  const addPaths = [
    ...plan.filter((item) => item.outcome === "add" || item.outcome === "update").map((item) => where(item.path)),
    ...plan.filter((item) => item.outcome === "remove" && tracked.has(where(item.path))).map((item) => where(item.path)),
    LOCK,
  ];
  if (regenerated) addPaths.push("devos.config.json");
  if (chosenAgents) addPaths.push("devos/project.json");
  const added = git(["add", "-f", "--", ...addPaths], project);
  if (added.status !== 0) {
    process.stderr.write(added.stderr ?? "");
    rollback();
    return 1;
  }
  const committed = git(["commit", "-m", `DEV_OS upgrade ${from} to ${to}`], project);
  if (committed.status !== 0) {
    process.stderr.write(committed.stderr ?? "");
    rollback();
    return 1;
  }

  const publishFailed = (result) => {
    process.stderr.write(result?.stderr ?? "devos: gh is not installed\n");
    switchBack();
    console.log(`devos: branch ${branch} is committed; push it and open the pull request by hand, or delete it to retry`);
    return 1;
  };

  if (!local) {
    const pushed = git(["push", "-u", "origin", branch], project, 120000);
    if (pushed.status !== 0) return publishFailed(pushed);
    const title = `DEV_OS upgrade ${from} to ${to}`;
    const pull = run("gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body-file", bodyPath], {
      cwd: project,
      timeout: 120000,
    });
    if (!pull || pull.status !== 0) return publishFailed(pull);
  }

  if (!switchBack()) return 1;
  const removed = count(plan, "remove") + count(plan, "drop");
  console.log(`devos upgrade ${from} to ${to}: ${count(plan, "update")} updated, ${count(plan, "add")} added, ${removed} removed, ${conflicts.length} conflicts`);
  for (const item of conflicts) console.log(`- ${item.path} — ${item.reason}`);
  console.log(local ? `devos: branch ${branch} committed locally (--local)` : "devos: pull request opened");
  return 0;
}
