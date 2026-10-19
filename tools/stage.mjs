import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { engineRoot } from "./sources.mjs";

function assertRelative(rel) {
  if (!rel || rel.startsWith("/") || rel.split("/").includes("..")) {
    throw new Error(`refusing path ${rel}`);
  }
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/stage.mjs <dir>");
  process.exit(2);
}

if (existsSync(dir)) {
  if (!statSync(dir).isDirectory() || readdirSync(dir).length > 0) {
    console.error(`refusing to stage into non-empty directory ${dir}`);
    process.exit(2);
  }
} else {
  mkdirSync(dir, { recursive: true });
}

const root = engineRoot();
const manifest = JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8"));
for (const entry of manifest.files) {
  assertRelative(entry.stored);
  assertRelative(entry.path);
  const bytes = readFileSync(path.join(root, "payload", "files", ...entry.stored.split("/")));
  const dest = path.join(dir, ...entry.path.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
}

console.log(`staged ${manifest.files.length} files into ${dir}`);
