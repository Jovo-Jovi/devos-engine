#!/usr/bin/env node
// Stack modules (PR-17, PR-26): one entry point that starts the local services of every module the
// task needs, before the builder works and before the checks run.
//
//   node scripts/devos/modules.mjs list              → the modules this tree uses, one per line
//   node scripts/devos/modules.mjs start [--task T]  → starts each needed module, writes .devos/<module>.env
//
// A module is needed when it is active (its detect path exists) or, with --task, when the task's fence
// names it (modules.<name>.fence_hint): the task that introduces a module gets its emulator from the start.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, config, parsePhases } from "./lib.mjs";
import * as supabase from "./supabase.mjs";
import * as r2 from "./r2.mjs";
import * as firebase from "./firebase.mjs";

export const MODULES = { supabase, r2, firebase };

// PR-53: the module each provider of `devos init` brings (database, storage and hosting choices).
const PROVIDER_MODULE = { supabase: "supabase", "supabase-storage": "supabase", firebase: "firebase", "firebase-storage": "firebase", r2: "r2", vercel: "vercel" };

/** The modules the project chose at `devos init` (devos/answers.json), or null when the project does not say. */
export function chosenModules() {
  try {
    const answers = JSON.parse(readFileSync(P("devos/answers.json"), "utf8"));
    if (!answers?.modules || typeof answers.modules !== "object") return null;
    const chosen = new Set(Object.values(answers.modules).map((id) => PROVIDER_MODULE[id]).filter(Boolean));
    if (answers.deploy === "vercel") chosen.add("vercel");
    return chosen;
  } catch {
    return null;
  }
}

/** Modules active in this tree, plus those the task's fence names. */
export function neededModules(task = "") {
  const mods = config().modules ?? {};
  const fence = task && existsSync(P(`docs/fences/${task}.md`)) ? readFileSync(P(`docs/fences/${task}.md`), "utf8") : "";
  return Object.keys(MODULES).filter((name) => {
    if (!mods[name]) return false;
    if (MODULES[name].isActive()) return true;
    // A fence that only mentions a module the project did not choose ("do not add Firebase") does not start it.
    const chosen = chosenModules();
    if (chosen && !chosen.has(name)) return false;
    return Boolean(fence && mods[name].fence_hint && new RegExp(mods[name].fence_hint).test(fence));
  });
}

export const activeModules = () => Object.keys(MODULES).filter((n) => config().modules?.[n] && MODULES[n].isActive());

/** PR-27: modules the project uses or is about to use: active, or named by the fence of any open task
 *  (so the setup list appears as soon as the intake that introduces a module is merged). */
export function plannedModules() {
  const open = parsePhases().rows.filter((r) => !r.done).map((r) => r.task);
  return [...new Set([...activeModules(), ...open.flatMap((t) => neededModules(t))])];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  const ti = process.argv.indexOf("--task");
  const task = ti >= 0 ? process.argv[ti + 1] ?? "" : "";
  if (cmd === "list") { console.log(activeModules().join("\n") || "(none)"); process.exit(0); }
  if (cmd !== "start") { console.error("usage: modules.mjs list | start [--task Tnn]"); process.exit(2); }
  let failed = 0;
  const needed = neededModules(task);
  if (!needed.length) console.log("modules: none needed");
  for (const name of needed) {
    const m = MODULES[name];
    if (!m.cliPresent()) { console.log(`${name}: its tool is not installed on this machine; not started`); failed++; continue; }
    const r = await m.start();
    if (r.log?.trim()) console.log(r.log.trim().split(/\r?\n/).slice(-10).join("\n"));
    if (r.ok) console.log(`${name}: up; wrote .devos/${name}.env (${Object.keys(r.env).join(", ")})`);
    else { console.log(`${name}: failed to start`); failed++; }
    if (name === "firebase" && r.ok) {
      const s = await firebase.seed("local");
      console.log(`firebase seed: ${s.out.split(/\r?\n/).slice(-3).join(" | ")}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
