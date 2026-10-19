// guard:manual — docs/method/AUTOMATION.md names every part of the automation (PR-30), so the manual
// the reviewer and Grok work from never falls behind the repository. N/A before the cycle exists.
//
// Names checked: each workflow file, runner script, guard, prompt, repository variable used by a
// workflow, `devos:` label and `/devos` command.
import { readdirSync } from "node:fs";
import { exists, read, P, result } from "./lib.mjs";

const MANUAL = "docs/method/AUTOMATION.md";
const list = (dir, re) => (exists(dir) ? readdirSync(P(dir)).filter((f) => re.test(f)) : []);

export default function manual() {
  if (!exists(".github/workflows/devos-cycle.yml")) return result("N/A", [], "no automated cycle in this repository");
  if (!exists(MANUAL)) return result("FAIL", [`${MANUAL} does not exist: the automation has no operating manual`]);
  const text = read(MANUAL);
  const workflows = list(".github/workflows", /\.ya?ml$/);
  const scripts = list("scripts/devos", /\.(mjs|sh)$/);
  const guards = list("scripts/guards", /\.mjs$/).filter((f) => !["lib.mjs", "run-all.mjs"].includes(f)).map((f) => f.replace(/\.mjs$/, ""));
  const prompts = list("devos/prompts", /\.md$/);
  const sources = [...workflows.map((f) => `.github/workflows/${f}`), ...scripts.map((f) => `scripts/devos/${f}`)].map(read).join("\n");
  const vars = [...new Set(sources.match(/vars\.[A-Z0-9_]+/g) ?? [])].map((v) => v.slice(5));
  const labels = [...new Set(sources.match(/devos:[a-z][a-z0-9-]*[a-z0-9]/g) ?? [])];
  const commands = [...new Set((sources.match(/['"`]\/devos [a-z]+/g) ?? []).map((c) => c.slice(1)))];

  const findings = [];
  const need = (names, what) => { for (const n of names) if (!text.includes(n)) findings.push(`${MANUAL} does not mention the ${what} \`${n}\``); };
  need(workflows, "workflow");
  need(scripts, "runner script");
  need(guards.map((g) => `\`${g}\``), "guard");
  need(prompts, "prompt");
  need(vars, "repository variable");
  need(labels, "label");
  need(commands, "command");
  const n = workflows.length + scripts.length + guards.length + prompts.length + vars.length + labels.length + commands.length;
  return result(findings.length ? "FAIL" : "PASS", findings, `${n} names checked`);
}
