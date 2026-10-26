import { readFileSync } from "node:fs";
import path from "node:path";
import { engineRoot } from "./engine.mjs";

export const CONTRACT_VERSION = "0-draft-3";

export function contractText() {
  return readFileSync(path.join(engineRoot(), "payload", "contract", "CONTRACT.md"), "utf8");
}
