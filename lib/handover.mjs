// E58 (PR-83): local mode is a handover. Once the developer approves the blueprint, DEV_OS's automation leaves the
// project and its plan stays: the developer builds the rest their own way, and `devos adopt` can bring DEV_OS back.
// Removed: every file of the engine lock but `docs/method/` (the fences cite it), `.gitignore` and `.gitattributes`;
// the lock; `devos.config.json`; the reviewer's `CLAUDE.md`; `devos/ci/` and DEV_OS's scratch folder `.devos/`.
// Kept: the documents, README.md, SETUP.md, devos/answers.json and the settings written for the project at setup.
// devos/answers.json records the handover (`handover: { engine, on }`), so a later run knows the project.
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LOCK, safeRelative } from "./engine.mjs";

const KEPT = new Set([".gitignore", ".gitattributes"]);
const METHOD = "docs/method/";
const EXTRA_FILES = [LOCK, "devos.config.json", "CLAUDE.md"];
const EXTRA_FOLDERS = ["devos/ci", ".devos"];

/** True when the project's answers record a handover. */
export function handedOver(answers) {
  return Boolean(answers && typeof answers.handover === "object" && answers.handover !== null && !Array.isArray(answers.handover));
}

export function readAnswers(folder) {
  try {
    return JSON.parse(readFileSync(path.join(folder, "devos", "answers.json"), "utf8"));
  } catch {
    return null;
  }
}

function pruneEmpty(folder, dir) {
  let at = dir;
  while (path.relative(folder, at) !== "" && !path.relative(folder, at).startsWith("..")) {
    if (!existsSync(at) || readdirSync(at).length > 0) return;
    rmdirSync(at);
    at = path.dirname(at);
  }
}

/**
 * Hands the project over: records it in devos/answers.json, then removes DEV_OS's automation. A second run removes
 * what is left and changes nothing else. Returns the files removed, in order, as project paths.
 */
export function handOver(folder, version, on = new Date().toISOString().slice(0, 10)) {
  const answersFile = path.join(folder, "devos", "answers.json");
  const answers = JSON.parse(readFileSync(answersFile, "utf8"));
  if (!handedOver(answers)) {
    answers.handover = { engine: version, on };
    writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
  }
  const removed = [];
  const remove = (rel) => {
    safeRelative(rel);
    const abs = path.join(folder, ...rel.split("/"));
    if (!existsSync(abs)) return;
    unlinkSync(abs);
    removed.push(rel);
    pruneEmpty(folder, path.dirname(abs));
  };
  const lockFile = path.join(folder, ...LOCK.split("/"));
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    for (const entry of Array.isArray(lock.files) ? lock.files : []) {
      if (KEPT.has(entry.path) || String(entry.path).startsWith(METHOD)) continue;
      remove(typeof entry.at === "string" ? entry.at : entry.path);
    }
  }
  for (const rel of EXTRA_FILES) remove(rel);
  for (const rel of EXTRA_FOLDERS) {
    const abs = path.join(folder, ...rel.split("/"));
    if (!existsSync(abs)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(`${rel}/`);
    pruneEmpty(folder, path.dirname(abs));
  }
  return removed;
}
