#!/usr/bin/env node
// start — the one-file launcher. Checks the computer, shows what is missing,
// and opens the guided setup after you approve.
import { runStart } from '../lib/start.mjs';

const code = await runStart({ argv: process.argv.slice(2) });
process.exitCode = code;
