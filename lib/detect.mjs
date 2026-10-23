import { detectAgents } from "./probes.mjs";

export function detectCommand() {
  console.log(JSON.stringify(detectAgents(), null, 2));
  return 0;
}
