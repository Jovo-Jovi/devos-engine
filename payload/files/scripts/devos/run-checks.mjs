#!/usr/bin/env node
// Run the project's checks deterministically and record evidence for the reviewer (PR-08).
// Writes .devos/ci-results.json and .devos/logs/<check>.log.
// Usage: node scripts/devos/run-checks.mjs [--strict]
//   --strict  exit 1 if a required check fails (used by ci.yml). Without it, always exit 0.
import { spawnSync } from "node:child_process";
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

function run(name, cmd, args) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: P(), encoding: "utf8", shell: process.platform === "win32",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" }, maxBuffer: 64 * 1024 * 1024,
  });
  const log = `$ ${cmd} ${args.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? "\n" + r.error.message : ""}`;
  writeFileSync(P(`.devos/logs/${name}.log`), log);
  const tail = log.split(/\r?\n/).slice(-60).join("\n");
  return { name, command: `${cmd} ${args.join(" ")}`, status: r.status === 0 ? "pass" : "fail", exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail };
}

function shell(name, command) {
  const t0 = Date.now();
  const r = spawnSync(command, {
    shell: true, cwd: P(), encoding: "utf8",
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" }, maxBuffer: 64 * 1024 * 1024,
  });
  const log = `$ ${command}\n${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? "\n" + r.error.message : ""}`;
  writeFileSync(P(`.devos/logs/${name}.log`), log);
  const tail = log.split(/\r?\n/).slice(-60).join("\n");
  return { name, command, status: r.status === 0 ? "pass" : "fail", exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail };
}

if (process.argv.includes("--install-only")) {
  const manifestReady = Boolean(stack.manifest) && existsSync(P(stack.manifest));
  if (toolchain === "node" || !manifestReady || !stackCommands.install) process.exit(0);
  const installed = shell("install", stackCommands.install);
  const text = readFileSync(P(".devos/logs/install.log"), "utf8");
  console.log(text.split(/\r?\n/).slice(-20).join("\n"));
  process.exit(installed.status === "pass" ? 0 : 1);
}

if (toolchain !== "node") {
  const hasManifest = Boolean(stack.manifest) && existsSync(P(stack.manifest));
  const stackResults = [];
  if (hasManifest && stackCommands.install) stackResults.push({ ...shell("install", stackCommands.install), required: false });
  for (const name of [...cfg.required_checks, ...cfg.optional_checks]) {
    const required = cfg.required_checks.includes(name);
    if (name === "guards") {
      stackResults.push({ ...run(name, "node", ["scripts/guards/run-all.mjs"]), required });
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
    stackResults.push({ ...shell(name, stackCommands[name]), required });
  }
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
  results.push({ name, required: requiredChecks.includes(name), command, status: r.status === 0 ? "pass" : "fail", exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail: r.out.split(/\r?\n/).slice(-60).join("\n") });
};
const pkgScript = (script, envExtra = {}) => {
  if (!scripts[script]) return { status: 1, out: `package.json has no "${script}" script; the module requires it (docs/method/FULLSTACK_MODULE.md)` };
  const r = spawnSync("pnpm", ["run", script], { cwd: P(), encoding: "utf8", shell: process.platform === "win32", env: { ...process.env, ...envExtra, CI: "true", FORCE_COLOR: "0" }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? "\n" + r.error.message : ""}` };
};
if (mod) {
  const t0 = Date.now();
  const sec = () => Math.round((Date.now() - t0) / 1000);
  const record = (name, r, command) => {
    writeFileSync(P(`.devos/logs/${name}.log`), `$ ${command}\n${r.out}`);
    results.push({ name, required: requiredChecks.includes(name), command, status: r.status === 0 ? "pass" : "fail", exit: r.status, seconds: sec(), tail: r.out.split(/\r?\n/).slice(-60).join("\n") });
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
      record("db", supa.sb(["db", "reset"]), "supabase db reset");
      Object.assign(process.env, supa.writeEnv(supa.statusEnv() ?? {}));
      // db-test: the pgTAP tests in supabase/tests (RLS proofs live here).
      record("db-test", supa.sb(["test", "db"]), "supabase test db");
      // types: the committed generated types match the schema the migrations produce.
      const gen = supa.sb(["gen", "types", "typescript", "--local"]);
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
      if ((mod.optional_checks ?? []).includes("db-lint")) record("db-lint", supa.sb(["db", "lint", "--fail-on", "error"]), "supabase db lint --fail-on error");
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
    const tests = rt.status === 0 ? pkgScript(r2Mod.test_script ?? "test:storage", st.env) : { status: 1, out: "skipped: the store round trip failed" };
    record("storage", { status: rt.status || tests.status, out: `${rt.out}\n\n$ pnpm run ${r2Mod.test_script ?? "test:storage"}\n${tests.out}` }, `r2.mjs check + pnpm run ${r2Mod.test_script ?? "test:storage"}`, t0);
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
      record("firestore-rules", pkgScript(fbMod.rules_test_script ?? "test:rules", st.env), `pnpm run ${fbMod.rules_test_script ?? "test:rules"}`, t0);
    }
  }
}

for (const name of [...cfg.required_checks, ...cfg.optional_checks]) {
  const required = requiredChecks.includes(name);
  if (!hasPkg) {
    if (name === "guards") results.push({ ...run(name, "node", ["scripts/guards/run-all.mjs"]), required });
    else results.push({ name, required, status: "skipped-no-package", tail: "package.json does not exist yet" });
    continue;
  }
  if (!scripts[name]) {
    results.push({ name, required, status: required ? "missing" : "skipped", tail: `package.json has no "${name}" script` });
    continue;
  }
  if (name === "e2e" && scripts.e2e) {
    // Playwright needs its browser; install quietly when the project uses it.
    spawnSync("pnpm", ["exec", "playwright", "install", "--with-deps", "chromium"], { cwd: P(), stdio: "ignore", shell: process.platform === "win32" });
  }
  let r = run(name, "pnpm", ["run", name]);
  // PR-24: a build that failed only because the Google Fonts download failed is retried (up to 3 tries).
  const fontRe = cfg.retry_build_on ? new RegExp(cfg.retry_build_on, "i") : null;
  for (let i = 2; name === "build" && r.status === "fail" && fontRe && i <= 3; i++) {
    const log = readFileSync(P(".devos/logs/build.log"), "utf8");
    if (!fontRe.test(log)) break;
    console.log(`build: the Google Fonts download failed; retry ${i} of 3`);
    spawnSync("sleep", ["20"]);
    r = { ...run(name, "pnpm", ["run", name]), retried: i - 1 };
  }
  results.push({ ...r, required });
}

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
