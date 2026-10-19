#!/usr/bin/env node
// The Firebase module (PR-26): Cloud Firestore as a read-mostly content store, seeded from the repo.
// Every run gets the Firestore emulator (demo project: no credentials, nothing hosted is touched);
// production changes only in devos-deploy, after the human's merge: rules first, then the seed.
//
//   node scripts/devos/firebase.mjs active               → true/false (is the module in this tree?)
//   node scripts/devos/firebase.mjs start                → starts the emulator if needed, writes .devos/firebase.env
//   node scripts/devos/firebase.mjs validate             → checks firebase/seed/*.json (shape, ids, synthetic)
//   node scripts/devos/firebase.mjs seed --local         → writes the seed into the emulator, then counts it
//   node scripts/devos/firebase.mjs seed --production    → the same against the hosted project (devos-deploy only)
//
// The seed is the source of truth for the collections it names: firebase/seed/<collection>.json is an
// array of documents, each with a string "id"; every other key becomes a field. With seed_prune, a
// document removed from the file is removed from Firestore. Collections without a seed file are untouched.
// Production credentials: FIREBASE_PROJECT_ID plus a service-account JSON in FIREBASE_SERVICE_ACCOUNT
// (or a file named by GOOGLE_APPLICATION_CREDENTIALS). Dependency-free: plain REST and a signed JWT.
import { spawn, spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, config, writeDevosEnv, waitForPort } from "./lib.mjs";

export const moduleConfig = () => config().modules?.firebase ?? null;
export const isActive = () => {
  const m = moduleConfig();
  return Boolean(m && existsSync(P(m.detect ?? "firebase.json")));
};
const cfg = () => ({ project_id_local: "demo-devos", seed_dir: "firebase/seed", seed_prune: true, ...(moduleConfig() ?? {}) });
const RESERVED_EMAIL = /@([a-z0-9-]+\.)*(example\.(com|org|net)|test|invalid|localhost)$/i;

function firebaseJson() {
  try { return JSON.parse(readFileSync(P("firebase.json"), "utf8")); } catch { return {}; }
}
export const emulatorPort = () => Number(firebaseJson().emulators?.firestore?.port ?? 8080);
/** The rules file(s) firebase.json deploys; a change to one is a human gate (verdict.mjs). */
export function rulesFiles() {
  const fs = firebaseJson().firestore;
  const list = (Array.isArray(fs) ? fs : fs ? [fs] : []).map((x) => x.rules).filter(Boolean);
  return list.length ? list : ["firestore.rules"];
}

const javaEnv = () => {
  const env = { ...process.env };
  // GitHub's ubuntu images ship Java 21 beside the default; the emulators need a recent one.
  if (process.env.JAVA_HOME_21_X64) { env.JAVA_HOME = process.env.JAVA_HOME_21_X64; env.PATH = `${process.env.JAVA_HOME_21_X64}/bin:${process.env.PATH}`; }
  return env;
};
export const cliPresent = () => spawnSync("firebase", ["--version"], { encoding: "utf8", env: javaEnv(), shell: process.platform === "win32" }).status === 0;

export function localEnv() {
  return { FIREBASE_PROJECT_ID: cfg().project_id_local, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${emulatorPort()}` };
}

/** Start the Firestore emulator unless it already answers. Returns { ok, log, env }. */
export async function start() {
  const port = emulatorPort();
  let log = "";
  if (!(await waitForPort(port, "127.0.0.1", 1))) {
    mkdirSync(P(".devos/logs"), { recursive: true });
    const out = openSync(P(".devos/logs/firebase-emulator.log"), "a");
    const args = ["emulators:start", "--only", "firestore", "--project", cfg().project_id_local];
    log += `$ firebase ${args.join(" ")} (background, log in .devos/logs/firebase-emulator.log)\n`;
    const child = spawn("firebase", args, { cwd: P(), env: javaEnv(), stdio: ["ignore", out, out], detached: true, shell: process.platform === "win32" });
    child.unref();
    if (!(await waitForPort(port, "127.0.0.1", 150))) {
      const tail = existsSync(P(".devos/logs/firebase-emulator.log")) ? readFileSync(P(".devos/logs/firebase-emulator.log"), "utf8").split(/\r?\n/).slice(-30).join("\n") : "";
      return { ok: false, log: `${log}${tail}\nthe Firestore emulator never opened port ${port}`, env: {} };
    }
  }
  const env = localEnv();
  writeDevosEnv("firebase", env);
  return { ok: true, log, env };
}

// ---------- the seed ----------------------------------------------------------------------------

/** Read and validate firebase/seed/*.json. Returns { errors, collections: [{ name, docs }] }. */
export function readSeed() {
  const dir = cfg().seed_dir;
  const errors = [];
  const collections = [];
  if (!existsSync(P(dir))) return { errors, collections };
  for (const file of readdirSync(P(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const name = file.replace(/\.json$/, "");
    const where = `${dir}/${file}`;
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) errors.push(`${where} — collection name must be lower-case letters, digits, - or _`);
    let docs;
    try { docs = JSON.parse(readFileSync(P(where), "utf8")); } catch (e) { errors.push(`${where} — not valid JSON (${e.message})`); continue; }
    if (!Array.isArray(docs)) { errors.push(`${where} — must be an array of documents`); continue; }
    const ids = new Set();
    docs.forEach((d, i) => {
      if (!d || typeof d !== "object" || Array.isArray(d)) { errors.push(`${where} [${i}] — each document is an object`); return; }
      if (typeof d.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(d.id)) errors.push(`${where} [${i}] — "id" must be a string of letters, digits, - or _`);
      else if (ids.has(d.id)) errors.push(`${where} [${i}] — duplicate id "${d.id}"`);
      else ids.add(d.id);
    });
    for (const e of new Set(JSON.stringify(docs).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])) {
      if (!RESERVED_EMAIL.test(e)) errors.push(`${where} — ${e} is not on a reserved domain; seeds are synthetic`);
    }
    collections.push({ name, docs });
  }
  return { errors, collections };
}

/** A JSON value in Firestore's REST encoding. */
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

const b64url = (s) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** An OAuth access token for a service account (JWT bearer grant). */
async function serviceToken() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw && process.env.GOOGLE_APPLICATION_CREDENTIALS) raw = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
  if (!raw) throw new Error("no service account: set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud, iat: now, exp: now + 3600 }))}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const r = await fetch(aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${sig}` });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token request failed (${r.status}): ${j.error ?? ""} ${j.error_description ?? ""}`.trim());
  return j.access_token;
}

/** Write the seed. target: "local" (emulator, owner access) or "production". Returns { status, out }. */
export async function seed(target) {
  const { errors, collections } = readSeed();
  if (errors.length) return { status: 1, out: errors.join("\n") };
  if (!collections.length) return { status: 0, out: `no seed files in ${cfg().seed_dir}: nothing to write` };
  const local = target === "local";
  const project = local ? cfg().project_id_local : process.env.FIREBASE_PROJECT_ID;
  if (!project) return { status: 1, out: "FIREBASE_PROJECT_ID is not set" };
  const host = local ? `http://${localEnv().FIRESTORE_EMULATOR_HOST}` : "https://firestore.googleapis.com";
  const base = `${host}/v1/projects/${project}/databases/(default)/documents`;
  let auth;
  try { auth = local ? "Bearer owner" : `Bearer ${await serviceToken()}`; } catch (e) { return { status: 1, out: e.message }; }
  const headers = { authorization: auth, "content-type": "application/json" };
  const out = [];
  for (const { name, docs } of collections) {
    let written = 0;
    for (const { id, ...fields } of docs) {
      const r = await fetch(`${base}/${name}/${encodeURIComponent(id)}`, { method: "PATCH", headers, body: JSON.stringify({ fields: toValue(fields).mapValue.fields }) });
      if (!r.ok) return { status: 1, out: [...out, `${name}/${id}: write failed (${r.status}) ${(await r.text()).slice(0, 300)}`].join("\n") };
      written++;
    }
    // List what is there now; prune what the seed no longer names; count.
    const present = [];
    let pageToken = "";
    do {
      const r = await fetch(`${base}/${name}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers });
      if (!r.ok) return { status: 1, out: [...out, `${name}: list failed (${r.status})`].join("\n") };
      const j = await r.json();
      for (const d of j.documents ?? []) present.push(d.name.split("/").pop());
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
    const keep = new Set(docs.map((d) => d.id));
    let pruned = 0;
    if (cfg().seed_prune) {
      for (const id of present.filter((x) => !keep.has(decodeURIComponent(x)))) {
        const r = await fetch(`${base}/${name}/${id}`, { method: "DELETE", headers });
        if (!r.ok) return { status: 1, out: [...out, `${name}/${id}: delete failed (${r.status})`].join("\n") };
        pruned++;
      }
    }
    const count = present.length - pruned;
    out.push(`${name}: ${written} written, ${pruned} removed, ${count} in Firestore (seed has ${docs.length})`);
    if (count !== docs.length && cfg().seed_prune) return { status: 1, out: [...out, `${name}: count ${count} does not match the seed's ${docs.length}`].join("\n") };
  }
  return { status: 0, out: `${local ? "emulator" : `project ${project}`}\n${out.join("\n")}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  if (cmd === "active") { console.log(isActive() ? "true" : "false"); process.exit(0); }
  if (cmd === "validate") {
    const { errors, collections } = readSeed();
    console.log(errors.length ? errors.join("\n") : `seed valid: ${collections.map((c) => `${c.name} (${c.docs.length})`).join(", ") || "no seed files"}`);
    process.exit(errors.length ? 1 : 0);
  }
  if (cmd === "seed") {
    const target = process.argv.includes("--production") ? "production" : "local";
    const r = await seed(target);
    console.log(r.out);
    process.exit(r.status);
  }
  if (cmd === "start") {
    if (!cliPresent()) { console.error("firebase module: the Firebase CLI is not installed (npm install -g firebase-tools) or Java is missing"); process.exit(1); }
    const r = await start();
    if (r.log.trim()) console.log(r.log.trim().split(/\r?\n/).slice(-15).join("\n"));
    if (!r.ok) process.exit(1);
    console.log(`firebase: Firestore emulator up; wrote .devos/firebase.env (${Object.keys(r.env).join(", ")})`);
    process.exit(0);
  }
  console.error("usage: firebase.mjs active | start | validate | seed --local|--production");
  process.exit(2);
}
