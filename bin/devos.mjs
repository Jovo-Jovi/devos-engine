#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
const arg = process.argv[2];

if (arg === "--version" || arg === "-v") {
  console.log(`devos ${pkg.version}`);
  process.exit(0);
}

console.log(`devos ${pkg.version} — commands arrive in E04`);
process.exit(2);
