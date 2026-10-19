#!/usr/bin/env node
// The storage module (PR-26): Cloudflare R2 through its S3 API. Every run gets a throwaway
// S3-compatible store in Docker (SeaweedFS, "allow all" mode, one bucket), so uploads and public reads
// are tested for real without any run touching the hosted bucket.
//
//   node scripts/devos/r2.mjs active   → prints true/false (is the module in this tree?)
//   node scripts/devos/r2.mjs start    → starts the local store if needed, writes .devos/r2.env
//   node scripts/devos/r2.mjs check    → round trip: put an object, read it from the public URL, delete it
//   node scripts/devos/r2.mjs stop     → removes the container
//
// The app reads the names in devos.config.json modules.r2.env. Locally they point at the emulator with
// throwaway keys; in production they are set in Vercel (R2_ENDPOINT = https://<account>.r2.cloudflarestorage.com).
// The app uses path-style requests (forcePathStyle) and region "auto", which both R2 and the emulator accept.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, config, writeDevosEnv, waitForPort } from "./lib.mjs";

export const moduleConfig = () => config().modules?.r2 ?? null;
export const isActive = () => {
  const m = moduleConfig();
  return Boolean(m && existsSync(P(m.detect ?? "src/lib/r2")));
};

const emu = () => ({ image: "chrislusf/seaweedfs:latest", container: "devos-r2", port: 8333, bucket: "devos-test", args: [], ...(moduleConfig()?.emulator ?? {}) });
const docker = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status ?? 127, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
};
const dockerUp = () => docker(["version", "--format", "{{.Server.Version}}"]).status === 0;
/** start() checks Docker itself: a store already listening on the port (a developer's own) needs none. */
export const cliPresent = () => true;

export function localEnv() {
  const e = emu();
  const base = `http://127.0.0.1:${e.port}`;
  return {
    R2_ENDPOINT: base,
    // Throwaway values: the local store runs in "allow all" mode and ignores them.
    R2_ACCESS_KEY_ID: "devoslocal",
    R2_SECRET_ACCESS_KEY: "devoslocalkey",
    R2_BUCKET: e.bucket,
    R2_PUBLIC_BASE_URL: `${base}/${e.bucket}`,
  };
}

async function bucketReady(seconds = 60) {
  const { R2_PUBLIC_BASE_URL } = localEnv();
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${R2_PUBLIC_BASE_URL}/`, { method: "GET" });
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

/** Start the local store unless it already answers. Returns { ok, log, env }. */
export async function start() {
  const e = emu();
  let log = "";
  if (!(await waitForPort(e.port, "127.0.0.1", 1))) {
    if (!dockerUp()) return { ok: false, log: `nothing listens on port ${e.port} and Docker is not available to start the local S3 store`, env: {} };
    docker(["rm", "-f", e.container]);
    const args = ["run", "-d", "--name", e.container, "-p", `${e.port}:8333`, "-e", `S3_BUCKET=${e.bucket}`, e.image, ...e.args];
    const r = docker(args);
    log += `$ docker ${args.join(" ")}\n${r.out}\n`;
    if (r.status !== 0) return { ok: false, log, env: {} };
    if (!(await waitForPort(e.port, "127.0.0.1", 120))) {
      return { ok: false, log: log + docker(["logs", "--tail", "40", e.container]).out + "\nthe S3 port never opened", env: {} };
    }
  }
  if (!(await bucketReady(30))) {
    const mk = docker(["exec", e.container, "sh", "-c", `echo "s3.bucket.create -name ${e.bucket}" | weed shell`]);
    log += `bucket ${e.bucket} not listed yet; created it with weed shell\n${mk.out}\n`;
    if (!(await bucketReady(60))) return { ok: false, log: log + `bucket ${e.bucket} is not readable`, env: {} };
  }
  const env = localEnv();
  writeDevosEnv("r2", env);
  return { ok: true, log, env };
}

/** Put an object, read it back through the public base URL, delete it. Returns { status, out }. */
export async function roundTrip() {
  const { R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_BASE_URL } = localEnv();
  const key = `devos-check/${Date.now()}.txt`;
  const out = [];
  try {
    const put = await fetch(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`, { method: "PUT", body: "devos", headers: { "content-type": "text/plain" } });
    out.push(`PUT ${key} → ${put.status}`);
    const get = await fetch(`${R2_PUBLIC_BASE_URL}/${key}`);
    const body = await get.text();
    out.push(`GET public URL → ${get.status} ${JSON.stringify(body.slice(0, 20))}`);
    const del = await fetch(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`, { method: "DELETE" });
    out.push(`DELETE → ${del.status}`);
    const ok = put.ok && get.ok && body === "devos" && del.ok;
    return { status: ok ? 0 : 1, out: out.join("\n") };
  } catch (err) {
    return { status: 1, out: [...out, `round trip failed: ${err.message}`].join("\n") };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  if (cmd === "active") { console.log(isActive() ? "true" : "false"); process.exit(0); }
  if (cmd === "stop") { console.log(docker(["rm", "-f", emu().container]).out.trim()); process.exit(0); }
  if (!isActive() && cmd !== "start") { console.log(`r2 module: not active in this tree (no ${moduleConfig()?.detect ?? "src/lib/r2"})`); process.exit(0); }
  if (cmd === "start") {
    const r = await start();
    if (r.log.trim()) console.log(r.log.trim().split(/\r?\n/).slice(-15).join("\n"));
    if (!r.ok) process.exit(1);
    console.log(`r2: local S3 store up; wrote .devos/r2.env (${Object.keys(r.env).join(", ")})`);
  } else if (cmd === "check") {
    const r = await roundTrip();
    console.log(r.out);
    process.exit(r.status);
  } else {
    console.error("usage: r2.mjs active | start | check | stop");
    process.exit(2);
  }
}
