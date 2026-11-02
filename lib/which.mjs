import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { runToolSync, searchPathWin } from "./spawn.mjs";

const WINDOWS = process.platform === "win32";

function statFile(candidate) {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return null;
    return stat;
  } catch {
    return null;
  }
}

export function which(cmd) {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  if (WINDOWS) {
    return searchPathWin(cmd, pathEnv, process.env.PATHEXT, (p) => statFile(p) !== null);
  }
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, cmd);
    const stat = statFile(candidate);
    if (!stat) continue;
    if ((stat.mode & 0o111) === 0) continue;
    return { path: candidate, viaShell: false };
  }
  return null;
}

export function run(cmd, args, options = {}) {
  const found = which(cmd);
  if (!found) return null;
  if (found.viaShell && args.some((arg) => String(arg).includes("\""))) {
    throw new Error("which: refusing a double quote in a shell argument");
  }
  const spawnOptions = {
    timeout: options.timeout ?? 15000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  };
  if (options.stdio !== undefined) spawnOptions.stdio = options.stdio;
  else spawnOptions.encoding = "utf8";
  if (options.cwd) spawnOptions.cwd = options.cwd;
  if (options.input !== undefined) spawnOptions.input = options.input;
  if (found.viaShell) return runToolSync(found.path, args, spawnOptions);
  return spawnSync(found.path, args, spawnOptions);
}
