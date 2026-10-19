import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LOCAL, TOWER, engineRoot, listMethodFiles, normalizeLf, sha256Hex } from "./sources.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

function taskLabel(entries) {
  return [...new Set(entries.map((filePath) => LOCAL.changed[filePath] ?? LOCAL.added[filePath]))].join(", ");
}

const towerDir = option(process.argv, "--tower");
if (!towerDir) {
  console.error("usage: node tools/verify-source.mjs --tower <dir>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(path.join(engineRoot(), "payload", "manifest.json"), "utf8"));
const listed = new Set(listMethodFiles(towerDir));
const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
const problems = [];
let identical = 0;
const changed = [];
const added = [];

for (const entry of manifest.files) {
  const rel = entry.path;
  const abs = path.join(towerDir, rel);
  const onDisk = existsSync(abs);
  const inTower = listed.has(rel);
  if (LOCAL.added[rel]) {
    if (inTower || onDisk) problems.push(`added file exists in source: ${rel}`);
    else added.push(rel);
    continue;
  }
  if (LOCAL.changed[rel]) {
    if (!inTower || !onDisk) {
      problems.push(`missing ${rel}`);
      continue;
    }
    const hash = sha256Hex(normalizeLf(readFileSync(abs)));
    if (hash === entry.sha256) problems.push(`changed file matches source: ${rel}`);
    else changed.push(rel);
    continue;
  }
  if (!inTower) problems.push(`extra ${rel}`);
  if (!onDisk) {
    if (inTower) problems.push(`missing ${rel}`);
    continue;
  }
  const hash = sha256Hex(normalizeLf(readFileSync(abs)));
  if (hash !== entry.sha256) problems.push(`mismatch ${rel}`);
  else identical += 1;
}

for (const filePath of listed) {
  if (!manifestPaths.has(filePath)) problems.push(`extra ${filePath}`);
}
for (const filePath of Object.keys(LOCAL.changed)) {
  if (!manifestPaths.has(filePath)) problems.push(`missing ${filePath}`);
}
for (const filePath of Object.keys(LOCAL.added)) {
  if (!manifestPaths.has(filePath)) problems.push(`missing ${filePath}`);
}

if (problems.length > 0) {
  for (const problem of problems.sort()) console.log(problem);
  process.exit(1);
}

const short = TOWER.commit.slice(0, 7);
console.log(`${identical} identical, ${changed.length} changed (${taskLabel(changed)}), ${added.length} added (${taskLabel(added)}) — ${TOWER.repo}@${short}`);
