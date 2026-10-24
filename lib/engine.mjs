import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK = "devos/engine.lock.json";

const LOCK_COMMENT = "Written by devos install and devos upgrade. Never edit by hand.";

function comparePath(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function engineRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** True when `folder` is the engine's folder or inside it: a project never lives there. */
export function insideEngine(folder) {
  const rel = path.relative(engineRoot(), path.resolve(folder));
  return !(rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

export function engineVersion(root) {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

export function readManifest(root) {
  return JSON.parse(readFileSync(path.join(root, "payload", "manifest.json"), "utf8"));
}

export function normalizeLf(bytes) {
  if (bytes.includes(0)) {
    throw new Error("file contains a NUL byte");
  }
  return Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashFile(abs) {
  try {
    return sha256Hex(normalizeLf(readFileSync(abs)));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function safeRelative(value) {
  if (typeof value !== "string" || value === "" || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error(`engine: refusing path ${value}`);
  }
}

export function writeLock(project, version, entries) {
  const files = entries.map((entry) => ({ path: entry.path, sha256: entry.sha256 }));
  files.sort((a, b) => comparePath(a.path, b.path));
  const lock = {
    $comment: LOCK_COMMENT,
    engine_version: version,
    files,
  };
  const dest = path.join(project, ...LOCK.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(lock, null, 2)}\n`);
}
