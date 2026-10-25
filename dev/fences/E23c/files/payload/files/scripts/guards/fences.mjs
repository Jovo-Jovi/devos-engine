// guard:fences — the fence of the task this run builds passes fence-check (PR-58): its title, builder
// line, layers, paths, Done when, Do NOT and stages. A finding is the fence's defect (PR-09), so the
// reviewer reissues the fence. N/A outside a task run (no TASK), so `ci` on main never reads a fence.
import { exists, result } from "./lib.mjs";
import { checkFile } from "../devos/fence-check.mjs";

export default function fences() {
  const task = process.env.TASK ?? "";
  if (!/^T\d{2}$/.test(task)) return result("N/A", [], "no task in this run");
  const rel = `docs/fences/${task}.md`;
  if (!exists(rel)) return result("N/A", [], `no ${rel}`);
  const findings = checkFile(rel).map((finding) => `${rel}: ${finding}`);
  return result(findings.length ? "FAIL" : "PASS", findings, `${rel} checked`);
}
