#!/usr/bin/env node
// The exact version of each tool the workflows install (PR-93, M3): `tool_versions` in devos.config.json, the engine's
// defaults or a project's own in devos/project.json. It prints what the install takes, and fails on anything that is
// not an exact version, so no workflow installs "latest" or a range.
// It reads the devos.config.json at the root its own scripts/ folder is in: a trusted job's copy ($T) reads main's.
// Usage: node scripts/devos/pins.mjs <claude|codex|gemini|firebase|vercel|pnpm>   → <npm package>@<version>
//        node scripts/devos/pins.mjs cursor                                     → <version> <SHA-256 of linux/x64>
//        node scripts/devos/pins.mjs <tool> --config <file>                     → the same, from that file
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  firebase: "firebase-tools",
  vercel: "vercel",
  pnpm: "pnpm",
};
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const CURSOR = /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** What the install of `tool` takes, from a devos.config.json object; throws on a missing or inexact pin. */
export function pin(config, tool) {
  const versions = config?.tool_versions ?? {};
  if (tool === "cursor") {
    const cursor = versions.cursor ?? {};
    if (!CURSOR.test(String(cursor.version ?? "")) || !SHA256.test(String(cursor.sha256_linux_x64 ?? ""))) {
      throw new Error("pins: tool_versions.cursor needs a version (YYYY.MM.DD-<commit>, as Cursor's installer names it) and the SHA-256 of its linux/x64 package (sha256_linux_x64)");
    }
    return `${cursor.version} ${cursor.sha256_linux_x64}`;
  }
  if (!Object.hasOwn(PACKAGES, tool)) throw new Error(`pins: no tool ${tool}; one of ${[...Object.keys(PACKAGES), "cursor"].join(", ")}`);
  const version = String(versions[tool] ?? "");
  if (!EXACT.test(version)) {
    throw new Error(`pins: tool_versions.${tool} must be an exact version such as 1.2.3, not ${version ? JSON.stringify(version) : "missing"} (devos/project.json, then node scripts/devos/config.mjs --write)`);
  }
  return `${PACKAGES[tool]}@${version}`;
}

function main(argv) {
  const [tool] = argv;
  const at = argv.indexOf("--config");
  const file = at >= 0 ? argv[at + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "devos.config.json");
  try {
    console.log(pin(JSON.parse(readFileSync(file, "utf8")), tool));
  } catch (error) {
    console.error(error.code === "ENOENT" ? `pins: ${file} does not exist` : error.message);
    process.exit(1);
  }
}

// Run as a script, by any path to it, a linked folder's included.
const self = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (self) main(process.argv.slice(2));
