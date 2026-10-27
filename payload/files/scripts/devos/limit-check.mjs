#!/usr/bin/env node
// Did an agent run stop on a usage or rate limit? (PR-29, used by scripts/devos/accounts.sh)
// Exit 0 = limited (switch accounts or park), 1 = not limited.
//   node scripts/devos/limit-check.mjs --json .devos/reviewer.json --err .devos/reviewer.err [--exit 1]
// PR-64: with --unavailable, exit 0 = the account cannot use the model (move on to the next model), 1 = it can
// (limits.mjs modelUnavailable: the CLI's own error only, never a watchdog stop).
// A run that produced its structured answer, or exited 0 without an error flag, is never "limited":
// the limit patterns are broad, and a finished run's own text must not trigger a switch. Only the end of
// the output is read (PR-54).
import { readText, looksLikeLimit, modelUnavailable, parseJsonLoose } from "./limits.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "" : ""; };
const out = readText(arg("json"));
const err = readText(arg("err"));
const json = parseJsonLoose(out);
const exit = arg("exit");

if (process.argv.includes("--unavailable")) process.exit(modelUnavailable(out, err, exit) ? 0 : 1);
if (json?.structured_output) process.exit(1);
if (exit === "0" && json && json.is_error !== true) process.exit(1);
process.exit(looksLikeLimit(out, err) ? 0 : 1);
