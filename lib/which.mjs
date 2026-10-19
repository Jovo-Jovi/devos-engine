import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

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

export function run(cmd, args) {
  const found = which(cmd);
  if (!found) return null;
  return spawnSync(found.path, args, {
    shell: found.viaShell,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
}
