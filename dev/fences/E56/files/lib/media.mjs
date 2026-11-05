// devos media (E53c1, PR-80): makes a project's planned media on this computer by running the project's own
// scripts/devos/media.mjs, with the provider's key from your shell (DEVOS_MEDIA_XAI_KEY for xAI). Without --budget it
// only estimates. With one, it lists what it will make and asks for yes first (--yes answers it). It never commits: you
// review the files and docs/design/media.json, then commit them. Images you own (PR-82) are placed by the first,
// estimating run: they cost nothing.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { lineReader } from "./menu.mjs";

const USAGE = "devos: usage: devos media [folder] [--budget <usd>] [--only <id,id>] [--yes]";

function parse(args) {
  const out = { folder: null, budget: undefined, only: undefined, yes: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--yes") out.yes = true;
    else if (arg === "--budget" || arg === "--only") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return null;
      out[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith("--") || out.folder !== null) return null;
    else out.folder = arg;
  }
  return out;
}

export async function mediaCommand(args, { read = null, env = process.env } = {}) {
  const options = parse(args);
  if (!options) {
    console.log(USAGE);
    return 2;
  }
  const folder = path.resolve(options.folder ?? process.cwd());
  const script = path.join(folder, "scripts", "devos", "media.mjs");
  if (!existsSync(script)) {
    console.log("devos media: this folder has no scripts/devos/media.mjs; run it in a DEV_OS project folder (devos upgrade brings it)");
    return 2;
  }
  if (options.budget !== undefined && !(Number(options.budget) >= 0)) {
    console.log(`devos media: the budget must be a number of US dollars, 0 or more (got "${options.budget}")`);
    return 2;
  }
  const only = options.only ? ["--only", options.only] : [];
  const estimate = spawnSync(process.execPath, [script, "--budget", "0", ...only], { cwd: folder, encoding: "utf8", env, windowsHide: true });
  process.stdout.write(estimate.stdout ?? "");
  process.stderr.write(estimate.stderr ?? "");
  if (estimate.status !== 0) return estimate.status ?? 1;
  // E56 (PR-82): a plan of images you own only has nothing to generate; the estimate run placed them.
  const left = /(\d+) to make\b/.exec(estimate.stdout ?? "");
  if (!left) {
    console.log("devos media: nothing to generate. Review the files placed from docs/design/own/ and docs/design/media.json, then commit them.");
    return 0;
  }
  if (options.budget === undefined || Number(options.budget) === 0) {
    console.log("devos media: nothing was generated. Add --budget <usd> to make these items; it is the most this run may spend.");
    return 0;
  }
  if (left[1] === "0") return 0;
  if (!options.yes) {
    const ask = read ?? lineReader(process.stdin);
    process.stdout.write(`Generate within a budget of $${Number(options.budget).toFixed(2)}? This is paid by your provider account. Type yes to go on: `);
    const answer = await ask();
    if (String(answer ?? "").trim().toLowerCase() !== "yes") {
      console.log("devos media: nothing was generated");
      return 1;
    }
  }
  const run = spawnSync(process.execPath, [script, "--budget", String(options.budget), ...only], { cwd: folder, encoding: "utf8", env, windowsHide: true });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  if (run.status === 0) console.log("devos media: review the files and docs/design/media.json, then commit them; docs/usage/media.jsonl records what each item cost.");
  return run.status ?? 1;
}
