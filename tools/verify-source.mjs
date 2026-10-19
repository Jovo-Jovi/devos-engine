import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOWER, engineRoot, listMethodFiles, normalizeLf, sha256Hex } from "./sources.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

const towerDir = option(process.argv, "--tower");
if (!towerDir) {
  console.error("usage: node tools/verify-source.mjs --tower <dir>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(path.join(engineRoot(), "payload", "manifest.json"), "utf8"));
const listed = new Set(listMethodFiles(towerDir));
const problems = [];

for (const entry of manifest.files) {
  if (!listed.has(entry.path)) problems.push(`missing ${entry.path}`);
  const abs = path.join(towerDir, entry.path);
  if (!existsSync(abs)) {
    if (listed.has(entry.path)) problems.push(`missing ${entry.path}`);
    continue;
  }
  const hash = sha256Hex(normalizeLf(readFileSync(abs)));
  if (hash !== entry.sha256) problems.push(`mismatch ${entry.path}`);
}

const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
for (const filePath of listed) {
  if (!manifestPaths.has(filePath)) problems.push(`extra ${filePath}`);
}

if (problems.length > 0) {
  for (const problem of problems.sort()) console.log(problem);
  process.exit(1);
}

console.log(`${manifest.files.length} files identical to ${TOWER.repo}@${TOWER.commit.slice(0, 7)}`);
