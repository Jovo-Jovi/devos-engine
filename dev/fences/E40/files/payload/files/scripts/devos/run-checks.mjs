#!/usr/bin/env node
// Run the project's checks deterministically and record evidence for the reviewer (PR-08).
// Writes .devos/ci-results.json and .devos/logs/<check>.log.
// Usage: node scripts/devos/run-checks.mjs [--strict]
//   --strict  exit 1 if a required check fails (used by ci.yml). Without it, always exit 0.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { P, config, changedPaths, git } from "./lib.mjs";
import * as supa from "./supabase.mjs";
import * as r2 from "./r2.mjs";
import * as fb from "./firebase.mjs";

const strict = process.argv.includes("--strict");
const cfg = config();
const stack = cfg.stack ?? {};
const toolchain = stack.toolchain || "node";
const stackCommands = stack.commands ?? {};
mkdirSync(P(".devos/logs"), { recursive: true });

const hasPkg = existsSync(P("package.json"));
const scripts = hasPkg ? JSON.parse(readFileSync(P("package.json"), "utf8")).scripts ?? {} : {};
const before = new Set(changedPaths());

// PR-70: every check has a time limit, and all of them a shared budget, so a check that hangs fails with its log
// instead of holding the run until GitHub stops it. devos.config.json `check_timeout_minutes` and
// `checks_budget_minutes`; a fraction of a minute is allowed, a day at most.
const minutesOf = (value, fallback) => (Number(value) > 0 ? Math.min(Number(value), 24 * 60) : fallback);
const LIMIT_MINUTES = minutesOf(cfg.check_timeout_minutes, 30);
const BUDGET_MINUTES = minutesOf(cfg.checks_budget_minutes, 60);
const BUDGET_END = Date.now() + BUDGET_MINUTES * 60000;
// Playwright's browser install (for e2e) has a limit of its own.
const BROWSER_MINUTES = Math.min(10, LIMIT_MINUTES);
const MAX_OUTPUT = 64 * 1024 * 1024;
const posix = process.platform !== "win32";

/** What is left of a limit of `minutes` within the budget, in milliseconds (0 when the budget is used up). */
const allowance = (minutes) => Math.max(0, Math.min(minutes * 60000, BUDGET_END - Date.now()));

// The checks running now. On POSIX each runs in a process group of its own, so its pid names the group.
const running = new Set();
let stopping = false;
function signalGroup(pid, signal) {
  if (!pid) return;
  if (!posix) {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-pid, signal); } catch { /* already ended */ }
}
// Ctrl-C, a stop or a closed terminal ends the running checks too: they get the signal, then SIGKILL after 3 s.
// A stopped run writes no results and exits with the signal's code (`untilStopped`).
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.on(signal, () => {
    stopping = true;
    for (const pid of running) signalGroup(pid, "SIGTERM");
    setTimeout(() => process.exit(code), posix && running.size > 0 ? 3000 : 0);
  });
}
/** Before results are written: a run that was stopped waits here for its signal's exit. */
const untilStopped = () => (stopping ? new Promise(() => {}) : Promise.resolve());
process.on("exit", () => {
  if (posix) for (const pid of running) signalGroup(pid, "SIGKILL");
});

/**
 * Runs a command within `minutes` and what is left of the budget: { status, out, timedOut, budget, started,
 * error }. stdin is closed. At the limit, the command and everything it started are ended. When the command ends,
 * what it left running is ended too (POSIX), and the result comes even if that still held its output.
 */
function limited(cmd, args, { shell = false, env = {}, minutes = LIMIT_MINUTES } = {}) {
  const ms = allowance(minutes);
  if (ms <= 0 || stopping) return Promise.resolve({ status: null, out: "", timedOut: true, budget: true, started: false, error: null });
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let done = false;
    let timer = null;
    let hard = null;
    let child = null;
    const finish = (status, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hard);
      // What the check left running in its group ends with it (POSIX).
      if (posix && child?.pid) signalGroup(child.pid, "SIGKILL");
      if (child?.pid) running.delete(child.pid);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({ status, out, timedOut, budget: timedOut && ms < minutes * 60000, started: true, error });
    };
    try {
      child = spawn(cmd, args, { cwd: P(), shell, detached: posix, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env, CI: "true", FORCE_COLOR: "0" } });
    } catch (error) {
      finish(null, error);
      return;
    }
    if (child.pid) running.add(child.pid);
    const take = (chunk) => {
      if (out.length < MAX_OUTPUT) out += chunk;
    };
    child.stdout?.setEncoding("utf8").on("data", take);
    child.stderr?.setEncoding("utf8").on("data", take);
    timer = setTimeout(() => {
      timedOut = true;
      signalGroup(child.pid, "SIGTERM");
      if (posix) hard = setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5000);
    }, ms);
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(timedOut ? null : code, null));
    child.on("exit", (code) => {
      // From here no timer may signal its pid (Windows reuses pids quickly).
      clearTimeout(timer);
      clearTimeout(hard);
      if (!posix) running.delete(child.pid);
      setTimeout(() => {
        if (done) return;
        // POSIX: the group outlives its leader. Windows: the tree is gone, and its pid may already be another's.
        if (posix) signalGroup(child.pid, "SIGKILL");
        finish(timedOut ? null : code, null);
      }, 2000);
    });
  });
}

/** The line a check's log ends with when its limit or the budget stopped it. */
function stopNote(name, r, minutes = LIMIT_MINUTES) {
  if (!r.timedOut) return "";
  if (!r.started) return `\ndevos: ${name} was not started: the checks' budget of ${BUDGET_MINUTES} minutes (checks_budget_minutes) was used up (PR-70)`;
  if (r.budget) return `\ndevos: ${name} was stopped when the checks' budget of ${BUDGET_MINUTES} minutes (checks_budget_minutes) ran out (PR-70)`;
  return `\ndevos: ${name} passed its time limit of ${minutes} minutes (check_timeout_minutes) and was stopped (PR-70)`;
}

function result(name, command, r, t0) {
  const log = `$ ${command}\n${r.out}${r.error ? "\n" + r.error.message : ""}${stopNote(name, r)}`;
  writeFileSync(P(`.devos/logs/${name}.log`), log);
  const tail = log.split(/\r?\n/).slice(-60).join("\n");
  return { name, command, status: r.timedOut ? "timeout" : r.status === 0 ? "pass" : "fail", exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail };
}

async function run(name, cmd, args) {
  const t0 = Date.now();
  return result(name, `${cmd} ${args.join(" ")}`, await limited(cmd, args, { shell: process.platform === "win32" }), t0);
}

async function shell(name, command) {
  const t0 = Date.now();
  return result(name, command, await limited(command, [], { shell: true }), t0);
}

/** A Supabase CLI check (`supabase.mjs` sb) within the same limit and budget: { status, out, timedOut }. */
function sbLimited(name, args) {
  const ms = allowance(LIMIT_MINUTES);
  const r = ms > 0 ? supa.sb(args, { timeout: ms, killSignal: "SIGKILL" }) : { status: 1, out: "" };
  // Only spawnSync's own timeout counts (sb appends its error message last), not the word in the CLI's output.
  const timedOut = ms <= 0 || (r.status === 127 && /\nspawnSync \S+ ETIMEDOUT$/.test(r.out));
  const stopped = { timedOut, started: ms > 0, budget: ms > 0 && ms < LIMIT_MINUTES * 60000 };
  return { ...r, timedOut, out: `${r.out}${stopNote(name, stopped)}` };
}

if (process.argv.includes("--install-only")) {
  const manifestReady = Boolean(stack.manifest) && existsSync(P(stack.manifest));
  if (toolchain === "node" || !manifestReady || !stackCommands.install) process.exit(0);
  const installed = await shell("install", stackCommands.install);
  await untilStopped();
  const text = readFileSync(P(".devos/logs/install.log"), "utf8");
  console.log(text.split(/\r?\n/).slice(-20).join("\n"));
  process.exit(installed.status === "pass" ? 0 : 1);
}

if (toolchain !== "node") {
  const hasManifest = Boolean(stack.manifest) && existsSync(P(stack.manifest));
  const stackResults = [];
  if (hasManifest && stackCommands.install) stackResults.push({ ...(await shell("install", stackCommands.install)), required: false });
  for (const name of [...cfg.required_checks, ...cfg.optional_checks]) {
    const required = cfg.required_checks.includes(name);
    if (name === "guards") {
      stackResults.push({ ...(await run(name, "node", ["scripts/guards/run-all.mjs"])), required });
      continue;
    }
    if (!hasManifest) {
      stackResults.push({ name, required, status: "skipped-no-package", tail: `${stack.manifest} does not exist yet` });
      continue;
    }
    if (!stackCommands[name]) {
      stackResults.push({ name, required, status: required ? "missing" : "skipped", tail: `devos.config.json stack.commands has no "${name}"` });
      continue;
    }
    stackResults.push({ ...(await shell(name, stackCommands[name])), required });
  }
  await untilStopped();
  const failedRequired = stackResults.filter((r) => r.required && !["pass", "skipped-no-package"].includes(r.status));
  for (const name of cfg.required_checks) if (!stackResults.some((r) => r.name === name)) failedRequired.push({ name });
  const dirtied = changedPaths().filter((p) => !before.has(p) && !p.startsWith(".devos/"));
  if (dirtied.length) {
    for (const p of dirtied) {
      try { git(["checkout", "--", p]); } catch { /* untracked: leave for git clean */ }
    }
    try { git(["clean", "-fd", "--", ...dirtied]); } catch { /* nothing to clean */ }
  }
  const summary = {
    generated: new Date().toISOString(),
    head: (() => { try { return git(["rev-parse", "HEAD"]); } catch { return null; } })(),
    has_package_json: hasManifest,
    toolchain,
    all_required_passed: failedRequired.length === 0,
    modules: [],
    failed_required: failedRequired.map((r) => r.name),
    checks_modified_tracked_files: dirtied,
    results: stackResults,
  };
  writeFileSync(P(".devos/ci-results.json"), JSON.stringify(summary, null, 2));
  for (const r of stackResults) console.log(`${r.status.toUpperCase().padEnd(18)} ${r.name}${r.required ? "" : " (optional)"}`);
  if (dirtied.length) console.log(`WARN checks modified tracked files (restored): ${dirtied.join(", ")}`);
  console.log(failedRequired.length ? `required checks failed: ${failedRequired.map((r) => r.name).join(", ")}` : "all required checks passed");
  if (strict && failedRequired.length) process.exit(1);
  process.exit(0);
}

const results = [];

// Supabase module (PR-17): a throwaway local database built from the migrations alone, before the
// app's checks, so typecheck/test/build/e2e run against it. Its checks join the required set.
const mod = supa.isActive() ? supa.moduleConfig() : null;
// PR-26: the storage (R2) and Firebase modules, each with its own local emulator and checks.
const r2Mod = r2.isActive() ? r2.moduleConfig() : null;
const fbMod = fb.isActive() ? fb.moduleConfig() : null;
const active = [mod && "supabase", r2Mod && "r2", fbMod && "firebase"].filter(Boolean);
const requiredChecks = [...cfg.required_checks, ...[mod, r2Mod, fbMod].flatMap((m) => m?.required_checks ?? [])];
const optionalChecks = [...cfg.optional_checks, ...[mod, r2Mod, fbMod].flatMap((m) => m?.optional_checks ?? [])];
const record = (name, r, command, t0) => {
  writeFileSync(P(`.devos/logs/${name}.log`), `$ ${command}\n${r.out}`);
  results.push({ name, required: requiredChecks.includes(name), command, status: r.timedOut ? "timeout" : r.status === 0 ? "pass" : "fail", exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail: r.out.split(/\r?\n/).slice(-60).join("\n") });
};
const pkgScript = async (script, envExtra = {}) => {
  if (!scripts[script]) return { status: 1, out: `package.json has no "${script}" script; the module requires it (docs/method/FULLSTACK_MODULE.md)` };
  const r = await limited("pnpm", ["run", script], { shell: process.platform === "win32", env: envExtra });
  return { status: r.timedOut ? 1 : r.status ?? 1, timedOut: r.timedOut, out: `${r.out}${r.error ? "\n" + r.error.message : ""}${stopNote(script, r)}` };
};
if (mod) {
  const t0 = Date.now();
  const sec = () => Math.round((Date.now() - t0) / 1000);
  const record = (name, r, command) => {
    writeFileSync(P(`.devos/logs/${name}.log`), `$ ${command}\n${r.out}`);
    results.push({ name, required: requiredChecks.includes(name), command, status: r.timedOut ? "timeout" : r.status === 0 ? "pass" : "fail", exit: r.status, seconds: sec(), tail: r.out.split(/\r?\n/).slice(-60).join("\n") });
  };
  if (!supa.cliPresent()) {
    for (const name of [...(mod.required_checks ?? []), ...(mod.optional_checks ?? [])]) {
      results.push({ name, required: requiredChecks.includes(name), status: "missing", tail: "the Supabase CLI is not installed (supabase/setup-cli in CI)" });
    }
  } else {
    const st = supa.start();
    writeFileSync(P(".devos/logs/supabase-start.log"), st.log);
    if (!st.ok) {
      record("db", { status: 1, out: st.log }, "supabase start");
    } else {
      Object.assign(process.env, st.env);
      // db: every migration applies from zero, then the synthetic seed.
      record("db", sbLimited("db", ["db", "reset"]), "supabase db reset");
      Object.assign(process.env, supa.writeEnv(supa.statusEnv() ?? {}));
      // db-test: the pgTAP tests in supabase/tests (RLS proofs live here).
      record("db-test", sbLimited("db-test", ["test", "db"]), "supabase test db");
      // types: the committed generated types match the schema the migrations produce.
      const gen = sbLimited("types", ["gen", "types", "typescript", "--local"]);
      const file = mod.types_file;
      let typesResult;
      if (gen.status !== 0) typesResult = gen;
      else if (!existsSync(P(file))) typesResult = { status: 1, out: `${file} does not exist; generate it with: supabase gen types typescript --local > ${file}` };
      else {
        const norm = (s) => s.replace(/\r\n/g, "\n").trim();
        const same = norm(readFileSync(P(file), "utf8")) === norm(gen.stdout);
        typesResult = { status: same ? 0 : 1, out: same ? `${file} matches the schema` : `${file} is out of date with the migrations; regenerate it with: supabase gen types typescript --local > ${file}` };
      }
      record("types", typesResult, `supabase gen types typescript --local (compared with ${file})`);
      if ((mod.optional_checks ?? []).includes("db-lint")) record("db-lint", sbLimited("db-lint", ["db", "lint", "--fail-on", "error"]), "supabase db lint --fail-on error");
    }
  }
}

// Storage module (PR-26): a throwaway S3-compatible store; `storage` = the store works end to end
// (put, public read, delete) and the app's own storage tests pass against it.
if (r2Mod) {
  const t0 = Date.now();
  const st = await r2.start();
  if (!st.ok) record("storage", { status: 1, out: st.log }, "r2.mjs start", t0);
  else {
    Object.assign(process.env, st.env);
    const rt = await r2.roundTrip();
    const tests = rt.status === 0 ? await pkgScript(r2Mod.test_script ?? "test:storage", st.env) : { status: 1, out: "skipped: the store round trip failed" };
    record("storage", { status: rt.status || tests.status, timedOut: Boolean(tests.timedOut), out: `${rt.out}\n\n$ pnpm run ${r2Mod.test_script ?? "test:storage"}\n${tests.out}` }, `r2.mjs check + pnpm run ${r2Mod.test_script ?? "test:storage"}`, t0);
  }
}

// Firebase module (PR-26): the Firestore emulator; `firestore-seed` = the seed is valid and loads with
// the exact counts; `firestore-rules` = the app's rules tests (who may read and write what) pass.
if (fbMod) {
  const t0 = Date.now();
  if (!fb.cliPresent()) {
    for (const name of fbMod.required_checks ?? []) results.push({ name, required: true, status: "missing", tail: "the Firebase CLI (npm install -g firebase-tools) or Java 21 is not installed" });
  } else {
    const st = await fb.start();
    if (!st.ok) for (const name of fbMod.required_checks ?? []) record(name, { status: 1, out: st.log }, "firebase.mjs start", t0);
    else {
      Object.assign(process.env, st.env);
      record("firestore-seed", await fb.seed("local"), "firebase.mjs seed --local", t0);
      record("firestore-rules", await pkgScript(fbMod.rules_test_script ?? "test:rules", st.env), `pnpm run ${fbMod.rules_test_script ?? "test:rules"}`, t0);
    }
  }
}

for (const name of [...cfg.required_checks, ...cfg.optional_checks]) {
  const required = requiredChecks.includes(name);
  if (!hasPkg) {
    if (name === "guards") results.push({ ...(await run(name, "node", ["scripts/guards/run-all.mjs"])), required });
    else results.push({ name, required, status: "skipped-no-package", tail: "package.json does not exist yet" });
    continue;
  }
  if (!scripts[name]) {
    results.push({ name, required, status: required ? "missing" : "skipped", tail: `package.json has no "${name}" script` });
    continue;
  }
  if (name === "e2e" && scripts.e2e) {
    // Playwright needs its browser. The install has a limit of its own, and its output is kept (PR-70).
    const browser = await limited("pnpm", ["exec", "playwright", "install", "--with-deps", "chromium"], { shell: process.platform === "win32", minutes: BROWSER_MINUTES });
    writeFileSync(P(".devos/logs/e2e-install.log"), `$ pnpm exec playwright install --with-deps chromium\n${browser.out}${browser.error ? "\n" + browser.error.message : ""}${stopNote("the browser install", browser, BROWSER_MINUTES)}`);
  }
  let r = await run(name, "pnpm", ["run", name]);
  // PR-24: a build that failed only because the Google Fonts download failed is retried (up to 3 tries).
  const fontRe = cfg.retry_build_on ? new RegExp(cfg.retry_build_on, "i") : null;
  for (let i = 2; name === "build" && r.status === "fail" && fontRe && i <= 3; i++) {
    const log = readFileSync(P(".devos/logs/build.log"), "utf8");
    if (!fontRe.test(log)) break;
    console.log(`build: the Google Fonts download failed; retry ${i} of 3`);
    spawnSync("sleep", ["20"]);
    r = { ...(await run(name, "pnpm", ["run", name])), retried: i - 1 };
  }
  results.push({ ...r, required });
}

await untilStopped();
// Checks must not change tracked files. If they did (e.g. next build rewrote next-env.d.ts), record
// it as evidence for the reviewer and restore the tree so later guards see only agent changes.
const dirtied = changedPaths().filter((p) => !before.has(p) && !p.startsWith(".devos/"));
if (dirtied.length) {
  for (const p of dirtied) {
    try { git(["checkout", "--", p]); } catch { /* untracked: leave for git clean */ }
  }
  try { git(["clean", "-fd", "--", ...dirtied]); } catch { /* nothing to clean */ }
}

const failedRequired = results.filter((r) => r.required && !["pass", "skipped-no-package"].includes(r.status));
for (const name of requiredChecks) if (!results.some((r) => r.name === name)) failedRequired.push({ name });
const summary = {
  generated: new Date().toISOString(),
  head: (() => { try { return git(["rev-parse", "HEAD"]); } catch { return null; } })(),
  has_package_json: hasPkg,
  all_required_passed: failedRequired.length === 0,
  modules: active,
  failed_required: failedRequired.map((r) => r.name),
  checks_modified_tracked_files: dirtied,
  results,
};
writeFileSync(P(".devos/ci-results.json"), JSON.stringify(summary, null, 2));

for (const r of results) console.log(`${r.status.toUpperCase().padEnd(18)} ${r.name}${r.required ? "" : " (optional)"}`);
if (dirtied.length) console.log(`WARN checks modified tracked files (restored): ${dirtied.join(", ")}`);
console.log(failedRequired.length ? `required checks failed: ${failedRequired.map((r) => r.name).join(", ")}` : "all required checks passed");
if (strict && failedRequired.length) process.exit(1);
// Exit now: nothing a check left behind may hold the runner open (PR-70).
process.exit(0);
