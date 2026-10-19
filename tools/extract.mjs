import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toStored } from "../lib/paths.mjs";
import { PILOT, REFERENCE, TOWER, engineRoot, gitHead, listMethodFiles, normalizeLf } from "./sources.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return undefined;
  return argv[index + 1];
}

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

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function removeEmptyDirs(dir, stopAt) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), stopAt);
  }
  if (path.resolve(dir) !== path.resolve(stopAt) && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: false });
  }
}

function readNormalized(abs) {
  let bytes;
  try {
    bytes = normalizeLf(readFileSync(abs));
  } catch (error) {
    throw new Error(`${error.message}: ${abs}`);
  }
  return bytes;
}

function writeBytes(abs, bytes) {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
}

const towerDir = option(process.argv, "--tower");
const pilotDir = option(process.argv, "--pilot");
if (!towerDir || !pilotDir) {
  console.error("usage: node tools/extract.mjs --tower <dir> --pilot <dir>");
  process.exit(2);
}

const towerHead = gitHead(towerDir);
const pilotHead = gitHead(pilotDir);
if (towerHead !== TOWER.commit || pilotHead !== PILOT.commit) {
  console.error(`HEAD does not match the pinned source: tower ${towerHead} (want ${TOWER.commit}), pilot ${pilotHead} (want ${PILOT.commit})`);
  process.exit(2);
}

const methodFiles = listMethodFiles(towerDir);
const payloadDir = path.join(engineRoot(), "payload", "files");
const storedByInstalled = new Map();
for (const installed of methodFiles) {
  const bytes = readNormalized(path.join(towerDir, installed));
  const stored = toStored(installed);
  storedByInstalled.set(stored, bytes);
}

for (const item of REFERENCE) {
  const sourceDir = item.root === "tower" ? towerDir : pilotDir;
  readNormalized(path.join(sourceDir, item.from));
}

for (const [stored, bytes] of storedByInstalled) {
  writeBytes(path.join(payloadDir, ...stored.split("/")), bytes);
}

const expected = new Set(storedByInstalled.keys());
for (const abs of walkFiles(payloadDir)) {
  const stored = posixRelative(payloadDir, abs);
  if (!expected.has(stored)) rmSync(abs);
}
removeEmptyDirs(payloadDir, payloadDir);

for (const item of REFERENCE) {
  const sourceDir = item.root === "tower" ? towerDir : pilotDir;
  const bytes = readNormalized(path.join(sourceDir, item.from));
  writeBytes(path.join(engineRoot(), ...item.to.split("/")), bytes);
}

console.log(`copied ${methodFiles.length} method files, ${REFERENCE.length} reference files`);
