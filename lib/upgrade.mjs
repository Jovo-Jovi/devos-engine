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
import { run } from "./which.mjs";

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function semverParts(version) {
  return String(version).split(".").map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`devos: bad version ${version}`);
    return Number(part);
  });
}

function compareSemver(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  const count = Math.max(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

function lockEntries(plan) {
  const entries = [];
  for (const item of plan) {
    if (item.outcome === "remove" || item.outcome === "drop") continue;
    if (item.outcome === "add" || item.outcome === "update" || item.outcome === "adopt") {
      entries.push({ path: item.path, sha256: item.next });
    } else if (item.installed) {
      entries.push({ path: item.path, sha256: item.installed });
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

export function upgradeCommand(args) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--local"))) {
    console.log("devos upgrade [--local]");
    return 2;
  }
  return runUpgrade(process.cwd(), args[0] === "--local");
}

function runUpgrade(project, local) {
  const lockPath = path.join(project, ...LOCK.split("/"));
  if (!existsSync(lockPath)) {
    console.log("devos: not installed here; run devos install");
    return 1;
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const root = engineRoot();
  const to = engineVersion(root);
  const from = lock.engine_version;
  if (compareSemver(from, to) > 0) {
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
    current.set(filePath, hashFile(path.join(project, ...filePath.split("/"))));
  }
  const plan = planUpgrade(lock, manifest, current);
  const conflicts = plan.filter((item) => item.outcome === "conflict");
  const actionable = plan.some((item) => ["add", "update", "remove", "drop", "adopt"].includes(item.outcome));
  if (!actionable && compareSemver(from, to) === 0) {
    console.log(`devos: up to date (${to})`);
    for (const item of conflicts) console.log(`- ${item.path} — ${item.reason}`);
    return 0;
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

  const rollback = () => {
    const restore = [
      ...plan.filter((item) => item.outcome === "update" || item.outcome === "remove").map((item) => item.path),
      LOCK,
    ];
    if (existsSync(path.join(project, "devos.config.json"))) restore.push("devos.config.json");
    const restored = git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...restore], project);
    if (restored.status !== 0) process.stderr.write(restored.stderr ?? "");
    for (const item of plan) {
      if (item.outcome !== "add") continue;
      // A staged add stays in the index after the worktree file is deleted.
      git(["reset", "-q", "HEAD", "--", item.path], project);
      const abs = path.join(project, ...item.path.split("/"));
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
      const dest = path.join(project, ...item.path.split("/"));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, payloadBytes(root, entry.stored));
    }
    for (const item of plan) {
      if (item.outcome !== "remove") continue;
      unlinkSync(path.join(project, ...item.path.split("/")));
    }
    writeLock(project, to, lockEntries(plan));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    rollback();
    return 1;
  }

  const defaultsWritten = plan.some((item) => item.path === "devos/engine.defaults.json" && (item.outcome === "add" || item.outcome === "update"));
  let regenerated = false;
  if (defaultsWritten && existsSync(path.join(project, "devos", "project.json"))) {
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

  const addPaths = [
    ...plan.filter((item) => item.outcome === "add" || item.outcome === "update" || item.outcome === "remove").map((item) => item.path),
    LOCK,
  ];
  if (regenerated) addPaths.push("devos.config.json");
  const added = git(["add", "--", ...addPaths], project);
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
