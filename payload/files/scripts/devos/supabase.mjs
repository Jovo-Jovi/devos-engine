#!/usr/bin/env node
// The Supabase module's local stack (PR-17). A throwaway Supabase in Docker gives every run a real
// database built from the migrations alone: no run ever touches a hosted project.
//
//   node scripts/devos/supabase.mjs active   → prints true/false (is the module in this tree?)
//   node scripts/devos/supabase.mjs start    → starts the stack if needed, writes .devos/supabase.env
//   node scripts/devos/supabase.mjs env      → (re)writes .devos/supabase.env from `supabase status`
//
// .devos/supabase.env holds the names the app reads (devos.config.json modules.supabase.env), as
// shell-sourceable KEY='value' lines. Its keys are the CLI's local demo keys, never real ones, and
// .devos/ is never committed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, config, writeDevosEnv, readDevosEnv } from "./lib.mjs";

export const moduleConfig = () => config().modules?.supabase ?? null;
export const isActive = () => {
  const m = moduleConfig();
  return Boolean(m && existsSync(P(m.detect ?? "supabase/config.toml")));
};

export function sb(args, opts = {}) {
  const r = spawnSync("supabase", args, {
    cwd: P(), encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" }, ...opts,
  });
  return { status: r.status ?? (r.error ? 127 : 1), out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? "\n" + r.error.message : ""}`, stdout: r.stdout ?? "" };
}

export const cliPresent = () => sb(["--version"]).status === 0;

/** Parse `supabase status -o env` (KEY="value" lines). */
export function statusEnv() {
  const r = sb(["status", "-o", "env"]);
  if (r.status !== 0) return null;
  const vars = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) vars[m[1]] = m[2] ?? m[3] ?? "";
  }
  return Object.keys(vars).length ? vars : null;
}

/** Map the CLI's names to the app's names and write .devos/supabase.env. Returns the mapped env. */
export function writeEnv(vars) {
  const map = moduleConfig()?.env ?? {};
  const env = {};
  for (const [name, sources] of Object.entries(map)) {
    const v = sources.map((s) => vars[s]).find((x) => x);
    if (v) env[name] = v;
  }
  writeDevosEnv("supabase", env);
  return env;
}

/** Read the names of every active module (.devos/*.env: supabase, r2, firebase) into one object.
 *  Used by screens.mjs, probe.mjs, evidence.mjs and the app's Playwright config, so a page served for
 *  e2e or screenshots sees every module's local services, not only the database (PR-26). */
export function readEnvFile() {
  return readDevosEnv();
}

/** Start the stack unless it already runs. Returns { ok, log, env }. */
export function start() {
  let vars = statusEnv();
  let log = "";
  if (!vars) {
    const exclude = (moduleConfig()?.start_exclude ?? []).join(",");
    const r = sb(["start", ...(exclude ? ["-x", exclude] : [])]);
    log += `$ supabase start${exclude ? " -x " + exclude : ""}\n${r.out}`;
    if (r.status !== 0) return { ok: false, log, env: {} };
    vars = statusEnv();
  }
  if (!vars) return { ok: false, log: log + "\nsupabase status gave no environment", env: {} };
  return { ok: true, log, env: writeEnv(vars) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  if (cmd === "active") { console.log(isActive() ? "true" : "false"); process.exit(0); }
  if (!isActive()) { console.log("supabase module: not active in this tree (no supabase/config.toml)"); process.exit(0); }
  if (!cliPresent()) { console.error("supabase module: the Supabase CLI is not installed"); process.exit(1); }
  if (cmd === "start") {
    const r = start();
    console.log(r.log.trim() ? r.log.split(/\r?\n/).slice(-15).join("\n") : "supabase: stack already running");
    if (!r.ok) process.exit(1);
    console.log(`supabase: local stack up; wrote .devos/supabase.env (${Object.keys(r.env).join(", ")})`);
  } else if (cmd === "env") {
    const vars = statusEnv();
    if (!vars) { console.error("supabase: stack is not running"); process.exit(1); }
    console.log(`wrote .devos/supabase.env (${Object.keys(writeEnv(vars)).join(", ")})`);
  } else {
    console.error("usage: supabase.mjs active | start | env");
    process.exit(2);
  }
}
