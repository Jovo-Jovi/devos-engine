// guard:scope — a task changes only what its fence's `- Paths:` line names (PR-58), plus its report,
// `docs/SESSION_CONTEXT.md`, `docs/DEVELOPMENT_JOURNAL.md` and a lockfile beside an allowed manifest.
// The change is the task branch against the base (`origin/<base>...HEAD`; the local loop sets
// DEVOS_SCOPE_BASE) plus the working tree, so every attempt and stage counts. Paths no builder may
// change are the surface guard's (guard-surfaces.mjs), and the runner's own files (docs/PHASES.md,
// reviews, fences, usage) are not the task's. N/A outside a task run (no TASK) and for a fence
// written before PR-58 (no Paths line).
import { execFileSync } from "node:child_process";
import { exists, read, result, ROOT } from "./lib.mjs";
import { changedPaths, config, matchesAny } from "../devos/lib.mjs";
import { fencePaths, inScope } from "../devos/fence-check.mjs";
import { isMethodFence } from "../devos/skills.mjs";

export default function scope() {
  const task = process.env.TASK ?? "";
  if (!/^T\d{2}$/.test(task)) return result("N/A", [], "no task in this run");
  const rel = `docs/fences/${task}.md`;
  if (!exists(rel)) return result("N/A", [], `no ${rel}`);
  const text = read(rel);
  const paths = fencePaths(text);
  if (paths === null) return result("N/A", [], `${rel} has no - Paths: line`);
  const cfg = config();
  // The local loop compares with its local base branch (DEVOS_SCOPE_BASE); the cycle with origin/<base>.
  const base = process.env.DEVOS_SCOPE_BASE || `origin/${cfg.base_branch ?? "main"}`;
  let committed;
  try {
    committed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(/\r?\n/).filter(Boolean);
  } catch {
    return result("FAIL", [`cannot compare the branch with ${base}: fetch it (git fetch origin ${cfg.base_branch ?? "main"})`]);
  }
  const surfaces = cfg.surfaces ?? {};
  const deny = (isMethodFence(text) ? surfaces.builder_method?.deny : surfaces.builder?.deny) ?? [];
  const skip = [...(surfaces.ignore ?? []), ...deny, "docs/PHASES.md"];
  const changed = [...new Set([...committed, ...changedPaths()])].filter((file) => !matchesAny(file, skip)).sort();
  const outside = changed.filter((file) => !inScope(file, paths, task));
  const note = `${changed.length} changed path(s), ${paths.length} Paths entr${paths.length === 1 ? "y" : "ies"} in ${rel}`;
  return result(outside.length ? "FAIL" : "PASS", outside.map((file) => `${file} — outside the Paths of ${rel}`), note);
}
