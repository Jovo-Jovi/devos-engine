import { which, run } from "./which.mjs";

const PROBES = [
  { tool: "claude", command: "claude", installed: ["--version"], signedIn: ["auth", "status"] },
  { tool: "cursor", command: "agent", installed: ["--version"], signedIn: ["models"] },
];

function line(probe) {
  if (which(probe.command) === null) return `${probe.tool} missing`;
  const version = run(probe.command, probe.installed);
  const signedIn = run(probe.command, probe.signedIn);
  const versionOk = version !== null && version.status === 0;
  const signedOk = signedIn !== null && signedIn.status === 0;
  if (versionOk && signedOk) return `${probe.tool} installed signed-in`;
  return `${probe.tool} installed signed-out`;
}

export function detectCommand() {
  for (const probe of PROBES) console.log(line(probe));
  return 0;
}
