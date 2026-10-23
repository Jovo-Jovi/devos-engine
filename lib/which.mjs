import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { runToolSync } from "./spawn.mjs";

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
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  if (WINDOWS) {
    const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    for (const dir of dirs) {
      for (const ext of pathext) {
        const candidate = path.join(dir, cmd + ext);
        if (!statFile(candidate)) continue;
        const lower = candidate.toLowerCase();
        const viaShell = lower.endsWith(".bat") || lower.endsWith(".cmd");
        return { path: candidate, viaShell };
      }
    }
    return null;
  }
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
