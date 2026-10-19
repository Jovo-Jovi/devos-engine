#!/usr/bin/env node
// Reachability evidence (Dev OS §7: "a reachability check proves a surface still renders").
// Starts the production server from an existing build, requests each path WITHOUT following
// redirects, and prints status, location, the <html> tag's lang/dir and the security headers.
// Usage: node scripts/devos/probe.mjs [--port 3100] [--no-server] /path ...
//        node scripts/devos/probe.mjs --base https://<preview>.vercel.app /path ...   (a deployment;
//        sends VERCEL_AUTOMATION_BYPASS_SECRET as x-vercel-protection-bypass when it is set)
//        --strict  exit 1 if a path is unreachable, answers 401/403/5xx, or redirects to the Vercel login
//        (a 404 is evidence, not a failure). A --base that is not an https:// URL is an error (PR-16).
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P } from "./lib.mjs";
import { readEnvFile } from "./supabase.mjs";

export function smokeTarget({ probe, target, productionUrl, fallback, deploymentUrl }) {
  if (probe === "production" && target === "production") return productionUrl || fallback || "";
  return deploymentUrl || "";
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (!direct) {
  // imported for smokeTarget; the probe runs only as a script
} else {
const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const portIdx = argv.indexOf("--port");
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 3100;
const baseIdx = argv.indexOf("--base");
const base = baseIdx >= 0 ? String(argv[baseIdx + 1] ?? "").replace(/\/$/, "") : "";
if (baseIdx >= 0 && !/^https?:\/\/\S+$/.test(base)) {
  console.error(`probe: --base needs a deployment URL, got "${base}"; refusing to probe a local server instead`);
  process.exit(2);
}
const noServer = argv.includes("--no-server") || Boolean(base);
const paths = argv.filter((a, i) => a.startsWith("/") && i !== portIdx + 1 && i !== baseIdx + 1);
if (!paths.length) paths.push("/");

const HEADERS = ["location", "strict-transport-security", "x-content-type-options", "referrer-policy",
  "permissions-policy", "x-frame-options", "content-security-policy"];

async function getRemote(path) {
  const headers = { "accept-language": "en-US" };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const r = await fetch(base + path, { redirect: "manual", headers, signal: AbortSignal.timeout(20000) });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: (await r.text()).slice(0, 200000) };
  } catch (e) {
    return { status: 0, headers: {}, body: "", error: e.message };
  }
}

function get(path) {
  if (base) return getRemote(path);
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path, headers: { "accept-language": "en-US" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (body.length < 200_000) body += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", (e) => resolve({ status: 0, headers: {}, body: "", error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  });
}

async function waitUp(ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await get("/__devos_probe_ready");
    if (r.status) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let server;
if (!noServer) {
  if (!existsSync(P(".next"))) { console.error("probe: no .next build found — run `pnpm build` first"); process.exit(2); }
  server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
    cwd: P(), env: { ...process.env, ...readEnvFile() }, stdio: "ignore", shell: process.platform === "win32", detached: process.platform !== "win32",
  });
}

let exit = 0;
try {
  if (!base && !(await waitUp())) { console.error(`probe: server did not answer on port ${port}`); exit = 2; }
  else {
    for (const path of paths) {
      const r = await get(path);
      const html = /<html\b[^>]*>/i.exec(r.body)?.[0] ?? "";
      const lang = /\blang="([^"]*)"/.exec(html)?.[1] ?? "";
      const dir = /\bdir="([^"]*)"/.exec(html)?.[1] ?? "";
      console.log(`${path} → ${r.status}${r.error ? " (" + r.error + ")" : ""}`);
      if (html) console.log(`  html lang="${lang}" dir="${dir}"`);
      for (const h of HEADERS) if (r.headers[h]) console.log(`  ${h}: ${r.headers[h]}`);
      const login = /vercel\.com\/(sso|login)/.test(String(r.headers.location ?? ""));
      if (strict && (r.status === 0 || r.status === 401 || r.status === 403 || r.status >= 500 || login)) {
        console.error(`probe: FAIL ${path} → ${r.status}${login ? " (Vercel login)" : ""}`);
        exit = 1;
      }
    }
  }
} finally {
  if (server) {
    try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"]) : process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  }
}
process.exit(exit);
}
