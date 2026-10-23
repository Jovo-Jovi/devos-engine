#!/usr/bin/env node
// Entry file. Each command lives in src/commands/<name>.ts.
import { runCommand } from './commands/run.mjs';

const [, , cmd, ...args] = process.argv;
runCommand(cmd, args);
