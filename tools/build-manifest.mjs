import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toInstalled } from "../lib/paths.mjs";
import { TOWER, engineRoot, normalizeLf, sha256Hex } from "./sources.mjs";

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(abs));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function buildManifest(root = engineRoot()) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const filesDir = path.join(root, "payload", "files");
  const files = walkFiles(filesDir).map((abs) => {
    const stored = path.relative(filesDir, abs).split(path.sep).join("/");
    const bytes = normalizeLf(readFileSync(abs));
    return {
      path: toInstalled(stored),
      stored,
      sha256: sha256Hex(bytes),
      owner: "engine",
    };
  });
  files.sort((a, b) => comparePath(a.path, b.path));
  return {
    engine_version: pkg.version,
    source: { repo: TOWER.repo, commit: TOWER.commit },
    files,
  };
}

function firstDifferingPath(diskText, built) {
  let disk;
  try {
    disk = JSON.parse(diskText);
  } catch {
    return built.files[0]?.path ?? "payload/manifest.json";
  }
  const diskFiles = new Map((disk.files ?? []).map((file) => [file.path, file]));
  const builtFiles = new Map(built.files.map((file) => [file.path, file]));
  const paths = [...new Set([...diskFiles.keys(), ...builtFiles.keys()])].sort(comparePath);
  for (const filePath of paths) {
    if (JSON.stringify(diskFiles.get(filePath)) !== JSON.stringify(builtFiles.get(filePath))) {
      return filePath;
    }
  }
  return built.files[0]?.path ?? "payload/manifest.json";
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const root = engineRoot();
  const built = buildManifest(root);
  const text = manifestText(built);
  const manifestPath = path.join(root, "payload", "manifest.json");
  if (process.argv.includes("--check")) {
    if (!existsSync(manifestPath)) {
      console.log(built.files[0]?.path ?? "payload/manifest.json");
      process.exit(1);
    }
    const disk = readFileSync(manifestPath, "utf8");
    if (disk === text) {
      console.log(`manifest up to date (${built.files.length} files)`);
      process.exit(0);
    }
    console.log(firstDifferingPath(disk, built));
    process.exit(1);
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, text);
  console.log(`manifest written (${built.files.length} files)`);
}
