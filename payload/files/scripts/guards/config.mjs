import { exists, read, result } from "./lib.mjs";
import { firstDifference, merge } from "../devos/config.mjs";

const FINDING = (filePath) =>
  `devos.config.json is not devos/engine.defaults.json ← devos/project.json (first difference: ${filePath}) — run node scripts/devos/config.mjs --write`;

export default function config() {
  if (!exists("devos/project.json")) {
    return result("N/A", [], "no devos/project.json (configuration not split)");
  }
  if (!exists("devos/engine.defaults.json")) return result("FAIL", [FINDING("devos/engine.defaults.json")]);
  if (!exists("devos.config.json")) return result("FAIL", [FINDING("devos.config.json")]);
  let merged;
  try {
    merged = merge(JSON.parse(read("devos/engine.defaults.json")), JSON.parse(read("devos/project.json")));
  } catch (error) {
    return result("FAIL", [FINDING(error.message)]);
  }
  const diff = firstDifference(merged, JSON.parse(read("devos.config.json")));
  if (diff) return result("FAIL", [FINDING(diff)]);
  return result("PASS", [], "generated config is current");
}
