// devos remove (E57): takes DEV_OS out of a project, in two runs.
//
// 1. With an engine lock, it removes on a new branch `devos/remove` every file DEV_OS installed and still owns (its
//    hash is the lock's), with the engine lock and the generated devos.config.json, and opens a pull request
//    (`--local`: one commit, nothing pushed). It pauses the cycle (DEVOS_PAUSED true) so it starts no new task.
//    It keeps the project's own files (its documents, fences, reviews, devos/answers.json and the settings DEV_OS
//    wrote for it at setup), every DEV_OS file the developer edited (listed), docs/method/ (the fences and reviews
//    cite it), and .gitignore and .gitattributes (the project still uses them).
// 2. Without a lock (after that merge, or after an adoption that was never merged), it lists what is left: the branch
//    `devos/adopt` on this computer and on GitHub, and DEV_OS's secrets, `DEVOS_*` variables and `devos:` labels on
//    GitHub. It deletes the branch on this computer after yes, and anything on GitHub only after a typed yes. The
//    keys of the project's services (hosting, database, storage) are asked apart, and a secret DEV_OS does not know is
//    never touched.
import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ADOPT_BRANCH } from "./adopt.mjs";
import { LOCK, engineRoot, hashFile, safeRelative } from "./engine.mjs";
import { lineReader } from "./menu.mjs";
import { slugFromRemote } from "./models.mjs";
import { run } from "./which.mjs";

export const REMOVE_BRANCH = "devos/remove";
const CONFIG = "devos.config.json";
const USAGE = "devos remove [folder] [--local]";
const METHOD = "docs/method/";
const NEEDED = new Map([
  [".gitignore", "the project still uses it"],
  [".gitattributes", "the project still uses it"],
]);
// The registry link's two switches, named when they are listed.
const LINK = ["DEVOS_REPORTING", "DEVOS_STATE"];

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function git(args, cwd, timeout = 30000) {
  const result = run("git", args, { cwd, timeout });
  if (!result) return { status: 1, stdout: "", stderr: "devos: git is not installed\n" };
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function hostGh(args, cwd) {
  const result = run("gh", args, { cwd, timeout: 120000 });
  if (!result) return null;
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function parseArgs(args) {
  let folder;
  let local = false;
  for (const arg of args) {
    if (arg === "--local") local = true;
    else if (arg.startsWith("--") || folder !== undefined) return null;
    else folder = arg;
  }
  return { folder, local };
}

/**
 * What happens to each file of the engine lock. `current` maps a lock path to the hash of the file where the project
 * keeps it (its `at`), or null when it is missing. Outcomes: remove (DEV_OS's, unchanged), edited (kept and listed),
 * keep (the project needs it), gone (already deleted).
 */
export function planRemove(files, current) {
  const plan = [];
  for (const entry of files ?? []) {
    const at = typeof entry.at === "string" ? entry.at : entry.path;
    const have = current.get(entry.path) ?? null;
    let item;
    if (NEEDED.has(entry.path)) item = { outcome: "keep", reason: NEEDED.get(entry.path) };
    else if (entry.path.startsWith(METHOD)) item = { outcome: "keep", reason: "your fences and reviews cite it" };
    else if (have === null) item = { outcome: "gone" };
    else if (have === entry.sha256) item = { outcome: "remove" };
    else item = { outcome: "edited" };
    plan.push({ path: entry.path, at, ...item });
  }
  return plan.sort((a, b) => comparePath(a.path, b.path));
}

function setupFiles(folder) {
  const files = [path.join(engineRoot(), "payload", "files", "devos", "setup.json"), path.join(folder, "devos", "setup.json")];
  const items = [];
  for (const file of files) {
    try {
      items.push(...(JSON.parse(readFileSync(file, "utf8")).items ?? []));
    } catch {
      /* a project without its own setup.json uses the engine's */
    }
  }
  return items;
}

/**
 * DEV_OS's settings among a repository's: its secrets (the agents' keys and its own), the keys of the project's
 * services it set up (asked apart), every `DEVOS_` variable and every `devos:` label. A secret it does not know is
 * the project's.
 */
export function settingGroups(items, listed) {
  const own = new Set();
  const services = new Set();
  for (const item of items ?? []) {
    if (item?.kind !== "secret" || !Array.isArray(item.names)) continue;
    const service = (item.when ?? []).some((when) => /^(module|var|chosen):/.test(String(when)));
    for (const name of item.names) (service ? services : own).add(name);
  }
  const sorted = (names) => [...new Set(names)].sort(comparePath);
  return {
    secrets: sorted(listed.secrets.filter((name) => !services.has(name) && (own.has(name) || name.startsWith("DEVOS_")))),
    services: sorted(listed.secrets.filter((name) => services.has(name))),
    variables: sorted(listed.variables.filter((name) => name.startsWith("DEVOS_"))),
    labels: sorted(listed.labels.filter((name) => name.startsWith("devos:"))),
  };
}

function listNames(gh, folder, args) {
  const listed = gh(args, folder);
  if (!listed || listed.status !== 0) return null;
  try {
    const rows = JSON.parse(listed.stdout);
    return Array.isArray(rows) ? rows.map((row) => row?.name).filter((name) => typeof name === "string") : null;
  } catch {
    return null;
  }
}

async function ask(read, prompt) {
  process.stdout.write(prompt);
  const line = await read();
  return line === null ? null : String(line).trim().toLowerCase();
}

// The repository the developer named for origin (its configured URL, before any insteadOf rewrite).
function slugOf(folder) {
  const remote = git(["config", "--get", "remote.origin.url"], folder);
  return remote.status === 0 ? slugFromRemote(remote.stdout) : "";
}

/** Folders left empty by a removal, from `dir` up to the project's own folder. */
function pruneEmpty(folder, dir) {
  let at = dir;
  while (path.relative(folder, at) !== "" && !path.relative(folder, at).startsWith("..")) {
    if (!existsSync(at) || readdirSync(at).length > 0) return;
    rmdirSync(at);
    at = path.dirname(at);
  }
}

function folderCounts(paths) {
  const counts = new Map();
  for (const filePath of paths) {
    const top = filePath.includes("/") ? `${filePath.split("/")[0]}/` : filePath;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => comparePath(a, b)).map(([top, count]) => `${top} (${count})`).join(", ");
}

function prBody(version, plan) {
  const list = (lines) => (lines.length === 0 ? "- none" : lines.map((line) => `- ${line}`).join("\n"));
  const of = (outcome) => plan.filter((item) => item.outcome === outcome);
  return [
    `Remove DEV_OS (engine ${version})`,
    "",
    "removed (DEV_OS installed them and still owns them):",
    list([...of("remove").map((item) => item.at), LOCK, CONFIG]),
    "",
    "kept, edited in this project:",
    list(of("edited").map((item) => item.at)),
    "",
    "kept on purpose:",
    list(of("keep").map((item) => `${item.at} — ${item.reason}`)),
    "",
    "Your documents, fences, reviews and devos/answers.json stay as they are.",
    "",
    "After you merge, run `devos remove` again in the project folder: it lists DEV_OS's settings on GitHub (its secrets, `DEVOS_*` variables and `devos:` labels) and deletes them only after you type yes.",
    "",
  ].join("\n");
}

async function removeFiles(folder, local, read, gh) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(path.join(folder, ...LOCK.split("/")), "utf8"));
  } catch {
    console.log(`devos: ${LOCK} is not valid JSON; nothing was changed`);
    return 1;
  }
  const version = String(lock.engine_version ?? "unknown");
  const files = Array.isArray(lock.files) ? lock.files : [];
  const current = new Map();
  for (const entry of files) {
    safeRelative(entry.path);
    const at = typeof entry.at === "string" ? entry.at : entry.path;
    safeRelative(at);
    current.set(entry.path, hashFile(path.join(folder, ...at.split("/"))));
  }
  const status = git(["status", "--porcelain"], folder);
  if (status.status !== 0) {
    process.stderr.write(status.stderr);
    return 1;
  }
  if (status.stdout.trim() !== "") {
    console.log("devos: the working tree is not clean; commit or stash first");
    return 1;
  }
  const base = git(["branch", "--show-current"], folder).stdout.trim();
  if (!base) {
    console.log("devos: check out a branch first");
    return 1;
  }
  if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${REMOVE_BRANCH}`], folder).status === 0) {
    console.log(`devos: branch ${REMOVE_BRANCH} already exists. If its pull request is merged, pull, delete the branch (git branch -D ${REMOVE_BRANCH}) and run devos remove again; if not, merge or delete it first`);
    return 1;
  }
  // Only a file git tracks is removed, so a failed run can put every one back.
  const tracked = new Set(git(["ls-files", "-z"], folder).stdout.split("\0").filter(Boolean));
  const plan = planRemove(files, current).map((item) => (item.outcome === "remove" && !tracked.has(item.at) ? { ...item, outcome: "edited" } : item));
  const removing = plan.filter((item) => item.outcome === "remove");
  const edited = plan.filter((item) => item.outcome === "edited");
  const kept = plan.filter((item) => item.outcome === "keep");
  const extras = [LOCK, CONFIG].filter((rel) => tracked.has(rel));
  const slug = local ? "" : slugOf(folder);

  console.log(`devos remove: DEV_OS ${version} in ${folder}`);
  console.log(`- removes ${removing.length} files DEV_OS installed and still owns${removing.length > 0 ? `: ${folderCounts(removing.map((item) => item.at))}` : ""}${extras.length > 0 ? `; and ${extras.join(" and ")}` : ""}`);
  console.log(`- keeps ${edited.length} DEV_OS ${edited.length === 1 ? "file" : "files"} you edited${edited.length > 0 ? `: ${edited.map((item) => item.at).join(", ")}` : ""}`);
  const needed = kept.filter((item) => NEEDED.has(item.path)).map((item) => item.at);
  const method = kept.filter((item) => item.path.startsWith(METHOD));
  if (needed.length > 0) console.log(`- keeps ${needed.join(" and ")}: the project still uses them`);
  if (method.length > 0) console.log(`- keeps ${METHOD} (${method.length} files): your fences and reviews cite it`);
  console.log("- keeps your documents, fences, reviews, devos/answers.json and the settings DEV_OS wrote at setup");
  console.log(local
    ? `It commits this on a new branch ${REMOVE_BRANCH} (--local: nothing is pushed).`
    : `It commits this on a new branch ${REMOVE_BRANCH}, opens a pull request${slug ? ` on ${slug}, and pauses the cycle (DEVOS_PAUSED true) so it starts no new task` : ""}.`);
  const go = await ask(read, "Go on? (yes/no) [no]: ");
  if (go !== "yes") {
    console.log("devos remove: nothing was changed");
    return go === null ? 1 : 0;
  }

  const created = git(["switch", "-c", REMOVE_BRANCH], folder);
  if (created.status !== 0) {
    process.stderr.write(created.stderr);
    return 1;
  }
  const rollback = () => {
    git(["reset", "-q", "--hard"], folder);
    git(["switch", base], folder);
    git(["branch", "-D", REMOVE_BRANCH], folder);
    console.log("devos: remove failed; rolled back, nothing changed");
  };
  try {
    for (const rel of [...removing.map((item) => item.at), ...extras]) {
      const abs = path.join(folder, ...rel.split("/"));
      unlinkSync(abs);
      pruneEmpty(folder, path.dirname(abs));
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    rollback();
    return 1;
  }
  const added = git(["add", "-A"], folder);
  const committed = added.status === 0 ? git(["commit", "-q", "-m", `DEV_OS remove (engine ${version})`], folder) : added;
  if (committed.status !== 0) {
    process.stderr.write(committed.stderr);
    rollback();
    return 1;
  }

  const back = () => {
    const switched = git(["switch", base], folder);
    if (switched.status !== 0) process.stderr.write(switched.stderr);
    return switched.status === 0;
  };
  let paused = false;
  if (!local) {
    const gitDir = git(["rev-parse", "--absolute-git-dir"], folder).stdout.trim();
    const bodyPath = path.join(gitDir, "devos-remove-body.md");
    writeFileSync(bodyPath, prBody(version, plan));
    const pushed = git(["push", "-u", "origin", REMOVE_BRANCH], folder, 120000);
    const pull = pushed.status === 0
      ? gh(["pr", "create", "--base", base, "--head", REMOVE_BRANCH, "--title", "Remove DEV_OS", "--body-file", bodyPath], folder)
      : pushed;
    if (!pull || pull.status !== 0) {
      process.stderr.write(pull?.stderr ?? "devos: gh is not installed\n");
      back();
      console.log(`devos: branch ${REMOVE_BRANCH} is committed; push it and open the pull request by hand, or delete it to retry`);
      return 1;
    }
    if (slug) {
      const pause = gh(["variable", "set", "DEVOS_PAUSED", "--body", "true", "--repo", slug], folder);
      paused = Boolean(pause && pause.status === 0);
      if (!paused) console.log(`devos: gh could not set DEVOS_PAUSED on ${slug}; the cycle may start a task before you merge`);
    }
  }
  if (!back()) return 1;
  console.log(`devos remove: ${removing.length + extras.length} removed, ${edited.length} kept (edited), ${kept.length} kept (the project needs them)`);
  console.log(local
    ? `devos: branch ${REMOVE_BRANCH} committed locally (--local). Merge it, then run devos remove again to clear what is left.`
    : `devos: pull request opened${paused ? "; the cycle is paused" : ""}. After you merge it, run devos remove again: it deletes DEV_OS's settings on GitHub after you type yes.`);
  return 0;
}

function adoptWorktrees(folder) {
  const listed = git(["worktree", "list", "--porcelain"], folder).stdout.split(/\r?\n\r?\n/);
  return listed
    .filter((block) => block.split(/\r?\n/).includes(`branch refs/heads/${ADOPT_BRANCH}`))
    .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("worktree "))?.slice("worktree ".length))
    .filter(Boolean);
}

async function removeLeftovers(folder, local, read, gh) {
  const localAdopt = git(["log", "-1", "--format=%h %s", `refs/heads/${ADOPT_BRANCH}`, "--"], folder);
  const adoptHere = localAdopt.status === 0 && localAdopt.stdout.trim() !== "" ? localAdopt.stdout.trim() : "";
  const handCopied = existsSync(path.join(folder, "scripts", "devos")) || existsSync(path.join(folder, CONFIG));
  const slug = local ? "" : slugOf(folder);
  let adoptThere = false;
  let groups = null;
  if (slug) {
    const heads = git(["ls-remote", "--heads", "origin", ADOPT_BRANCH], folder, 120000);
    adoptThere = heads.status === 0 && heads.stdout.includes(`refs/heads/${ADOPT_BRANCH}`);
    const secrets = listNames(gh, folder, ["secret", "list", "--repo", slug, "--json", "name"]);
    const variables = listNames(gh, folder, ["variable", "list", "--repo", slug, "--json", "name"]);
    const labels = listNames(gh, folder, ["label", "list", "--repo", slug, "--json", "name", "--limit", "500"]);
    if (secrets && variables && labels) groups = settingGroups(setupFiles(folder), { secrets, variables, labels });
    else console.log(`devos: gh could not list the settings of ${slug} (is gh installed and signed in?); nothing on GitHub is changed`);
  }
  const onGitHub = Boolean(adoptThere || (groups && (groups.secrets.length + groups.variables.length + groups.labels.length > 0)));
  const services = groups?.services ?? [];

  console.log(`devos remove: DEV_OS is not installed in ${folder} (no ${LOCK})`);
  if (handCopied) console.log(`- DEV_OS's files are here without an engine lock (a copy made by hand): devos remove deletes only the files a lock lists. Run devos adopt --check ${folder} to see them, or remove them by hand`);
  if (!adoptHere && !onGitHub && services.length === 0) {
    console.log(`devos remove: nothing of DEV_OS is left${slug && groups ? ` here or on ${slug}` : " here"}`);
    return handCopied ? 1 : 0;
  }
  let failed = 0;
  if (adoptHere) {
    console.log(`On this computer: the branch ${ADOPT_BRANCH} (${adoptHere}), from an adoption that was never merged`);
    const yes = await ask(read, `Delete the branch ${ADOPT_BRANCH} on this computer? (yes/no) [no]: `);
    if (yes === "yes") {
      for (const tree of adoptWorktrees(folder)) git(["worktree", "remove", "--force", "--force", tree], folder);
      git(["worktree", "prune"], folder);
      const deleted = git(["branch", "-D", ADOPT_BRANCH], folder);
      if (deleted.status === 0) console.log(`deleted the branch ${ADOPT_BRANCH} on this computer`);
      else {
        failed += 1;
        console.log(`devos: git could not delete the branch ${ADOPT_BRANCH}: ${deleted.stderr.trim()}`);
      }
    } else console.log(`kept the branch ${ADOPT_BRANCH} on this computer`);
  }
  if (onGitHub) {
    console.log(`On GitHub (${slug}), DEV_OS left:`);
    if (adoptThere) console.log(`- the branch ${ADOPT_BRANCH} (its pull request closes with it)`);
    if (groups.secrets.length > 0) console.log(`- secrets: ${groups.secrets.join(", ")}`);
    if (groups.variables.length > 0) {
      const link = groups.variables.filter((name) => LINK.includes(name));
      console.log(`- variables: ${groups.variables.join(", ")}${link.length > 0 ? ` (${link.join(" and ")}: the Control Tower link; deleting them ends it)` : ""}`);
    }
    if (groups.labels.length > 0) console.log(`- labels: ${groups.labels.join(", ")} (removed from issues and pull requests too)`);
    const yes = await ask(read, "Type yes to delete them on GitHub (anything else keeps them): ");
    if (yes === "yes") {
      const step = (label, result) => {
        if (result && result.status === 0) console.log(`deleted ${label}`);
        else {
          failed += 1;
          console.log(`devos: could not delete ${label}${result?.stderr ? `: ${result.stderr.trim()}` : ""}`);
        }
      };
      if (adoptThere) step(`the branch ${ADOPT_BRANCH} on GitHub`, git(["push", "origin", "--delete", ADOPT_BRANCH], folder, 120000));
      for (const name of groups.secrets) step(`secret ${name}`, gh(["secret", "delete", name, "--repo", slug], folder));
      for (const name of groups.variables) step(`variable ${name}`, gh(["variable", "delete", name, "--repo", slug], folder));
      for (const name of groups.labels) step(`label ${name}`, gh(["label", "delete", name, "--repo", slug, "--yes"], folder));
    } else console.log(`kept DEV_OS's settings on ${slug}`);
  }
  if (services.length > 0) {
    console.log(`Keys of your services that DEV_OS set up on ${slug}: ${services.join(", ")}. Your product may still use them.`);
    const yes = await ask(read, "Type yes to delete these too (anything else keeps them): ");
    if (yes === "yes") {
      for (const name of services) {
        const result = gh(["secret", "delete", name, "--repo", slug], folder);
        if (result && result.status === 0) console.log(`deleted secret ${name}`);
        else {
          failed += 1;
          console.log(`devos: could not delete secret ${name}${result?.stderr ? `: ${result.stderr.trim()}` : ""}`);
        }
      }
    } else console.log("kept your services' keys");
  }
  return failed > 0 ? 1 : 0;
}

export async function removeCommand(args, { read = null, gh = hostGh } = {}) {
  const parsed = parseArgs(args);
  if (!parsed) {
    console.log(USAGE);
    return 2;
  }
  const folder = path.resolve(parsed.folder ?? process.cwd());
  if (!existsSync(folder) || git(["rev-parse", "--git-dir"], folder).status !== 0) {
    console.log(`devos: ${folder} is not a git repository`);
    return 1;
  }
  const input = read ?? lineReader(process.stdin);
  if (existsSync(path.join(folder, ...LOCK.split("/")))) return removeFiles(folder, parsed.local, input, gh);
  return removeLeftovers(folder, parsed.local, input, gh);
}
