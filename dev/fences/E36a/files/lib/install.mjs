import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LOCK,
  engineRoot,
  engineVersion,
  hashFile,
  normalizeLf,
  readManifest,
  safeRelative,
  sha256Hex,
  writeLock,
} from "./engine.mjs";
import { toInstalled } from "./paths.mjs";

export const KEY_RE = /^[A-Z][A-Z0-9-]{1,31}$/;
const KEY_MESSAGE = "devos: --key must match ^[A-Z][A-Z0-9-]{1,31}$";

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function walkFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(abs));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

function parseInstallArgs(args) {
  let folder;
  let key;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--key") {
      key = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--") || folder !== undefined) return null;
    folder = arg;
  }
  return { folder, key };
}

export function templateWrites(root, key) {
  const base = path.join(root, "payload", "templates");
  return walkFiles(base).map((abs) => {
    const stored = path.relative(base, abs).split(path.sep).join("/");
    safeRelative(stored);
    const installed = toInstalled(stored);
    safeRelative(installed);
    let bytes = normalizeLf(readFileSync(abs));
    if (installed === "devos/project.json") {
      bytes = Buffer.from(bytes.toString("utf8").replaceAll("__PROJECT_KEY__", key), "utf8");
    }
    return { path: installed, bytes, template: true };
  });
}

export function keyFromName(name) {
  let key = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[A-Z]/.test(key)) key = `P-${key}`;
  return key.slice(0, 32).replace(/-+$/g, "");
}

export function installInto(folder, key, options = {}) {
  const hold = new Set(options.hold ?? []);
  const root = engineRoot();
  const version = engineVersion(root);
  const lockPath = path.join(folder, ...LOCK.split("/"));
  if (existsSync(lockPath)) {
    let installed = "unknown";
    try {
      installed = JSON.parse(readFileSync(lockPath, "utf8")).engine_version ?? installed;
    } catch {
      /* a broken lock still means install already ran */
    }
    console.log(`devos: already installed (engine ${installed}); run devos upgrade`);
    return { code: 1, held: {} };
  }

  const writes = [];
  for (const entry of readManifest(root).files) {
    safeRelative(entry.path);
    safeRelative(entry.stored);
    const bytes = normalizeLf(readFileSync(path.join(root, "payload", "files", ...entry.stored.split("/"))));
    writes.push({ path: entry.path, bytes, sha256: entry.sha256, template: false });
  }
  writes.push(...templateWrites(root, key));

  const differs = [];
  const seen = new Set();
  for (const item of writes) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    const have = hashFile(path.join(folder, ...item.path.split("/")));
    if (have !== null && have !== sha256Hex(item.bytes)) differs.push(item.path);
  }
  if (differs.length > 0) {
    differs.sort(comparePath);
    for (const filePath of differs.slice(0, 20)) console.log(`devos: exists: ${filePath}`);
    console.log(`devos: install refused (${differs.length} existing files differ)`);
    return { code: 1, held: {} };
  }

  const held = {};
  mkdirSync(folder, { recursive: true });
  for (const item of writes) {
    if (hold.has(item.path)) {
      held[item.path] = item.bytes;
      continue;
    }
    const dest = path.join(folder, ...item.path.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, item.bytes);
  }
  const engineFiles = writes.filter((item) => !item.template);
  writeLock(folder, version, engineFiles.map((item) => ({ path: item.path, sha256: item.sha256 })));

  const config = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
    cwd: folder,
    encoding: "utf8",
    windowsHide: true,
  });
  if (config.status !== 0) {
    if (config.stdout) process.stdout.write(config.stdout);
    if (config.stderr) process.stderr.write(config.stderr);
    return { code: 1, held };
  }

  const templates = writes.length - engineFiles.length;
  console.log(`devos install ${version}: ${engineFiles.length} engine files, ${templates} templates, devos.config.json written`);
  console.log("devos: next — devos init writes the project documents (docs/PHASES.md, docs/GLOSSARY.md, …)");
  return { code: 0, held };
}

export function installCommand(args) {
  const parsed = parseInstallArgs(args);
  if (!parsed || !KEY_RE.test(parsed.key ?? "")) {
    console.log(KEY_MESSAGE);
    return 2;
  }
  return installInto(path.resolve(parsed.folder ?? process.cwd()), parsed.key).code;
}
