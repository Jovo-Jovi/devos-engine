#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCommand } from "../lib/detect.mjs";
import { doctorCommand, statusCommand } from "../lib/doctor.mjs";
import { initCommand } from "../lib/init.mjs";
import { installCommand } from "../lib/install.mjs";
import { profileCommand } from "../lib/profile.mjs";
import { rosterCommand } from "../lib/roster.mjs";
import { upgradeCommand } from "../lib/upgrade.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
const args = process.argv.slice(2);

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
`);
  process.exit(2);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(`devos ${pkg.version}`);
  process.exit(0);
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
else {
  console.log(`devos: unknown command ${args[0]}`);
  code = 2;
}

process.exit(code);
