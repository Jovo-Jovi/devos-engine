#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCommand } from "../lib/detect.mjs";
import { doctorCommand, statusCommand } from "../lib/doctor.mjs";
import { continueCommand } from "../lib/continue.mjs";
import { initCommand } from "../lib/init.mjs";
import { installCommand } from "../lib/install.mjs";
import { modelsCommand } from "../lib/models.mjs";
import { profileCommand } from "../lib/profile.mjs";
import { rosterCommand } from "../lib/roster.mjs";
import { upgradeCommand } from "../lib/upgrade.mjs";
import { uiCommand } from "../lib/ui-server.mjs";
import { verifyCommand, watchCommand } from "../lib/verify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
const args = process.argv.slice(2);

// The command ends only after stdout and stderr have flushed. On a busy pipe, such as the guided page reading devos
// init, process.exit() dropped the writes still queued, and the last line, often the one that explains the stop, was
// lost (E32). The timer ends a process whose reader never reads.
function exitFlushed(code) {
  let open = 2;
  const flushed = () => {
    open -= 1;
    if (open === 0) process.exit(code);
  };
  setTimeout(() => process.exit(code), 10000);
  process.stdout.write("", flushed);
  process.stderr.write("", flushed);
  return new Promise(() => {});
}

if (args.length === 0) {
  process.stdout.write(`devos ${pkg.version}
devos doctor
devos status
devos profile show
devos profile set <key> <value>
devos agents detect
devos agents show
devos agents import <file>
devos install [folder] --key <KEY>
devos upgrade [--local]
devos init [--continue] [folder]
devos init --plan <file> [folder]
devos ui [folder] [--no-open]
devos continue [folder]
devos verify [folder]
devos watch [folder] [--interval <seconds>] [--once]
devos models [folder]
devos models set <reviewer|light|builder> <model> [folder]
devos models reset <reviewer|light|builder> [folder]
`);
  await exitFlushed(2);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(`devos ${pkg.version}`);
  await exitFlushed(0);
}

let code = 2;
if (args[0] === "doctor" && args.length === 1) code = doctorCommand();
else if (args[0] === "status" && args.length === 1) code = statusCommand();
else if (args[0] === "profile") code = profileCommand(args.slice(1));
else if (args[0] === "agents" && args[1] === "detect" && args.length === 2) code = detectCommand();
else if (args[0] === "agents") code = rosterCommand(args.slice(1));
else if (args[0] === "install") code = installCommand(args.slice(1));
else if (args[0] === "upgrade") code = upgradeCommand(args.slice(1));
else if (args[0] === "init") code = await initCommand(args.slice(1));
else if (args[0] === "ui") code = await uiCommand(args.slice(1));
else if (args[0] === "continue") code = await continueCommand(path.resolve(args[1] ?? process.cwd()));
else if (args[0] === "verify") code = verifyCommand(args.slice(1));
else if (args[0] === "watch") code = await watchCommand(args.slice(1));
else if (args[0] === "models") code = modelsCommand(args.slice(1));
else {
  console.log(`devos: unknown command ${args[0]}`);
  code = 2;
}

await exitFlushed(code);
