// One place for spawning external tools. Why this exists:
//  - `spawn(cmd, args, { shell: true })` on Windows is deprecated (DEP0190) and
//    concatenates the args WITHOUT escaping, so any path or token with a space or
//    a cmd metacharacter (the permission kit's `Bash(init_github:*)` has parens)
//    reaches the child broken. That was the source of the deprecation warning and
//    of silent misbehavior on Windows.
//  - npm-installed CLIs are .cmd/.bat shims on Windows, which Node refuses to exec
//    without a shell. Native installers ship .exe, which execs fine without one.
// Strategy: POSIX always spawns directly (argv is safe there, prompt text included).
// On Windows we resolve the real path once through PATHEXT, then either exec the .exe
// directly or run the .cmd/.bat through cmd with an explicitly quoted command LINE
// (a single string + shell does not trigger DEP0190 — the deprecation fires only
// for an args array combined with shell: true).
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';
const resolveCache = new Map();
const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

function isFileSync(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Pure: the folders, the extensions and the file check all come from the arguments.
export function searchPathWin(cmd, pathValue, pathextValue, isFile) {
  const folders = String(pathValue ?? '').split(';').map((entry) => entry.trim()).filter(Boolean);
  let extensions = String(pathextValue ?? '').split(';').map((entry) => entry.trim()).filter(Boolean);
  if (extensions.length === 0) extensions = DEFAULT_PATHEXT;
  for (const folder of folders) {
    for (const ext of extensions) {
      const candidate = path.win32.join(folder, cmd + ext);
      if (!isFile(candidate)) continue;
      const lower = candidate.toLowerCase();
      return { path: candidate, viaShell: lower.endsWith('.cmd') || lower.endsWith('.bat') };
    }
  }
  return null;
}

// Returns { path, viaShell }. path may be the original cmd when nothing better exists.
export function resolveTool(cmd) {
  if (!WIN) return { path: cmd, viaShell: false };
  if (resolveCache.has(cmd)) return resolveCache.get(cmd);
  let resolved = { path: cmd, viaShell: false };
  if (!/[\\/]/.test(cmd)) {
    const found = searchPathWin(cmd, process.env.PATH, process.env.PATHEXT, isFileSync);
    if (found) resolved = found;
  } else if (/\.(cmd|bat)$/i.test(cmd)) {
    resolved = { path: cmd, viaShell: true };
  }
  resolveCache.set(cmd, resolved);
  return resolved;
}

// Quotes one argument for a cmd.exe command line. We only ever quote our own
// controlled tokens here (model ids, flags, paths); prompt text never travels
// through argv (stdin delivery), so the hard newline cases do not occur.
export function winQuote(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function toCommandLine(cmd, args) {
  const { path, viaShell } = resolveTool(cmd);
  if (!viaShell) return { file: path, args, shell: false };
  return { file: `${winQuote(path)} ${args.map(winQuote).join(' ')}`, args: [], shell: true };
}

// Async child for long-running tools (the configuration model).
export function spawnTool(cmd, args, opts = {}) {
  const { file, args: fileArgs, shell } = toCommandLine(cmd, args);
  return spawn(file, fileArgs, { ...opts, shell });
}

// Sync variant for quick tools (gh, git). Returns the spawnSync result as-is.
export function runToolSync(cmd, args, opts = {}) {
  const { file, args: fileArgs, shell } = toCommandLine(cmd, args);
  return spawnSync(file, fileArgs, { ...opts, shell });
}

// Kill a process and everything it spawned (the model CLI forks helpers of its
// own — killing only the direct child would leave the tree half alive). Windows:
// `taskkill /T /F` walks the tree. POSIX: SIGTERM first; a stubborn child gets
// SIGKILL after a short grace. Never throws — the target may already be gone.
export function killPidTree(pid, { waitMs = 3000 } = {}) {
  const id = Number(pid);
  if (!id || id <= 0) return false;
  if (WIN) {
    try {
      const t = spawn('taskkill', ['/pid', String(id), '/T', '/F'], { stdio: 'ignore' });
      t.on('error', () => {});
      t.unref?.();
    } catch { /* already gone */ }
    return true;
  }
  try { process.kill(id, 'SIGTERM'); } catch { /* already gone */ }
  const t = setTimeout(() => { try { process.kill(id, 'SIGKILL'); } catch { /* already gone */ } }, waitMs);
  t.unref?.();
  return true;
}
