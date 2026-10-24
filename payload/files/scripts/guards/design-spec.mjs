// guard:design-spec — every open UI fence carries a design specification
// (docs/method/DESIGN_METHOD.md §3, PR-50).
import { read, exists, result } from "./lib.mjs";
import { parsePhases } from "../devos/lib.mjs";
import { parseScreensLine } from "../devos/screens.mjs";

const ACCEPTANCE = "docs/design/UI_ACCEPTANCE.md";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headOf(text) {
  return String(text).split(/^### Prompt\b/m)[0];
}

function designSection(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("### Design specification"));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("### ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function markedLine(section, label) {
  return section.split(/\r?\n/).find((line) => line.trimStart().startsWith(label)) ?? null;
}

function backticked(line) {
  return [...line.matchAll(/`([^`]*)`/g)].map((hit) => hit[1]);
}

export default function designSpec() {
  if (!exists("docs/PHASES.md")) return result("N/A", [], "no docs/PHASES.md");
  let rows;
  try {
    ({ rows } = parsePhases(read("docs/PHASES.md")));
  } catch (error) {
    return result("FAIL", [error.message]);
  }

  const findings = [];
  let checked = 0;
  let needsAcceptance = false;
  for (const row of rows) {
    if (row.done) continue;
    const fencePath = `docs/fences/${row.task}.md`;
    if (!exists(fencePath)) continue;
    const text = read(fencePath);
    const screens = parseScreensLine(text);
    const uiYes = headOf(text).split(/\r?\n/).some((line) => line.trim() === "- UI: yes");
    if (!screens.found && !uiYes) continue;
    checked += 1;
    if (uiYes && !screens.found) findings.push(`${fencePath}: - UI: yes without a - Screens: line`);
    for (const error of screens.errors) findings.push(`${fencePath}: Screens line: ${error}`);
    const section = designSection(text);
    if (section === null) {
      findings.push(`${fencePath}: UI fence without a ### Design specification`);
      continue;
    }
    const statesLine = markedLine(section, "- States:");
    const criteriaLine = markedLine(section, "- Criteria:");
    if (!statesLine) findings.push(`${fencePath}: no - States: line`);
    if (!criteriaLine) findings.push(`${fencePath}: no - Criteria: line`);
    if (statesLine) {
      const states = backticked(statesLine);
      const screenNames = screens.states.map((state) => state.name);
      const stateSet = new Set(states);
      const screenSet = new Set(screenNames);
      for (const name of screenNames) {
        if (!stateSet.has(name)) findings.push(`${fencePath}: ${name} is on the Screens line but not in States`);
      }
      for (const name of states) {
        if (!screenSet.has(name)) findings.push(`${fencePath}: state ${name} is not on the Screens line`);
      }
    }
    if (criteriaLine) {
      const criteria = backticked(criteriaLine);
      if (criteria.length > 0) {
        needsAcceptance = true;
        if (exists(ACCEPTANCE)) {
          const table = read(ACCEPTANCE);
          for (const id of criteria) {
            const rowRe = new RegExp(`^\\|\\s*${escapeRegExp(id)}\\s*\\|`, "m");
            if (!rowRe.test(table)) findings.push(`${fencePath}: criterion ${id} is not a row of ${ACCEPTANCE}`);
          }
        }
      }
    }
  }
  if (needsAcceptance && !exists(ACCEPTANCE)) findings.push(`${ACCEPTANCE} does not exist`);
  if (checked === 0) return result("N/A", [], "no open UI fence");
  if (findings.length > 0) return result("FAIL", findings);
  return result("PASS", [], `${checked} UI fences checked`);
}
