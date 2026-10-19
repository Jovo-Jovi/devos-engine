// guard:phases — the task ledger's structure holds, and no box is ticked without a PASS verdict file.
import { read, exists, result } from "./lib.mjs";
import { parsePhases } from "../devos/lib.mjs";

export default function phases() {
  const findings = [];
  let rows;
  try { ({ rows } = parsePhases(read("docs/PHASES.md"))); }
  catch (e) { return result("FAIL", [e.message]); }
  if (!rows.length) findings.push("docs/PHASES.md: no task rows");

  const seen = new Set();
  let openSeen = false;
  rows.forEach((r, i) => {
    if (!/^T\d{2}$/.test(r.task)) findings.push(`${r.task}: task id must be Tnn`);
    if (seen.has(r.task)) findings.push(`${r.task}: duplicate task id`);
    seen.add(r.task);
    if (i > 0 && r.task <= rows[i - 1].task) findings.push(`${r.task}: ids must ascend`);
    if (![1, 2, 3].includes(r.risk)) findings.push(`${r.task}: risk must be 1, 2 or 3`);
    if (!["[x]", "[ ]"].includes(r.doneRaw)) findings.push(`${r.task}: Done must be [x] or [ ]`);
    // Method fixes (Phase PM, PR-28) run on their own track, outside the product order.
    const method = r.phase === "PM";
    if (method && (r.risk !== 3 || !r.gate || r.gate === "—" || r.gate === "-")) findings.push(`${r.task}: a method fix (Phase PM) is risk 3 with a gate`);
    if (r.done) {
      if (openSeen && !method) findings.push(`${r.task}: ticked after an open task (tasks run in order)`);
      const m = /^PASS a(\d+) — (docs\/reviews\/T\d{2}-a\d+\.md)$/.exec(r.verdict);
      if (!m) findings.push(`${r.task}: ticked but Verdict is "${r.verdict}", expected "PASS aN — docs/reviews/${r.task}-aN.md"`);
      else if (!exists(m[2])) findings.push(`${r.task}: verdict file ${m[2]} does not exist`);
      else {
        const first = read(m[2]).split(/\r?\n/).find((l) => l.trim()) ?? "";
        if (first.trim() !== "VERDICT: PASS") findings.push(`${r.task}: ${m[2]} does not start with "VERDICT: PASS"`);
      }
    } else if (!method) openSeen = true;
  });
  return result(findings.length ? "FAIL" : "PASS", findings, `${rows.length} tasks, ${rows.filter((r) => r.done).length} PASS`);
}
