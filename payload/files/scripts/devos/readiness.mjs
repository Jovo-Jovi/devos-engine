#!/usr/bin/env node
// Production readiness (PR-88): the mechanical checks of the launch task, the task whose fence has a `- Launch:`
// line naming the product's main pages (`- Launch: / · /pricing · /sign-in`, or `- Launch: none` for a product
// without pages). They become one required check, `readiness`, in .devos/ci-results.json, so a red check overrides
// PASS (PR-08):
//   headers        every page sends Strict-Transport-Security (a year at least), a Content-Security-Policy,
//                  X-Content-Type-Options nosniff, a Referrer-Policy and frame protection, and no X-Powered-By;
//   audit          `pnpm audit` finds no high or critical advisory (Node first, PR-85), whatever the task changed;
//   accessibility  axe (WCAG 2.2 AA tags) finds no violation on any page, at 1280 px;
//   speed          every page's largest contentful paint is at most 2.5 s and its layout shift at most 0.1, at 390 px.
// A check that fails is waived only by the owner in writing: a line `Readiness waiver: <check> — <reason>` in
// docs/DECISIONS.md, which no agent may change. .devos/readiness.md also gives the ASVS level the reviewer verifies:
// 1, or 2 when the project stores personal data (docs/PROTECTION_MODEL.md) or takes payments.
// Pages are served from the local build (devos.config.json stack.preview, or next start), or --base.
// Usage: node scripts/devos/readiness.mjs --task Tnn [--port 3300] [--base https://…]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { launchLine } from "./fence-check.mjs";
import { P, config } from "./lib.mjs";
import { AXE_TAGS } from "./screens.mjs";
import { readEnvFile } from "./supabase.mjs";
import { audit } from "../guards/deps.mjs";

export const CHECKS = ["headers", "audit", "accessibility", "speed"];
export const SPEED = { lcp_ms: 2500, cls: 0.1 };
export const HSTS_MIN_SECONDS = 31536000;

/** The ASVS level the launch task verifies: 2 with personal data or payments, else 1. */
export function asvsLevel({ protection = false, payments = false } = {}) {
  if (protection && payments) return { level: 2, why: "the project stores personal data (docs/PROTECTION_MODEL.md) and takes payments" };
  if (protection) return { level: 2, why: "the project stores personal data (docs/PROTECTION_MODEL.md)" };
  if (payments) return { level: 2, why: "the project takes payments" };
  return { level: 1, why: "no personal data and no payments" };
}

/** The owner's written waivers in docs/DECISIONS.md: check name → reason. */
export function waivers(decisionsText) {
  const out = new Map();
  for (const line of String(decisionsText ?? "").split(/\r?\n/)) {
    const m = /Readiness waiver:\s*(headers|audit|accessibility|speed)\s*[—–-]\s*(\S.*)$/i.exec(line);
    if (m) out.set(m[1].toLowerCase(), m[2].trim());
  }
  return out;
}

/** What a page's response headers lack (PR-88). `headers` is a Headers object or a plain lower-case map. */
export function headerFindings(headers, page) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? "";
  const out = [];
  const hsts = /max-age\s*=\s*(\d+)/i.exec(get("strict-transport-security"));
  if (!hsts) out.push(`${page}: no Strict-Transport-Security`);
  else if (Number(hsts[1]) < HSTS_MIN_SECONDS) out.push(`${page}: Strict-Transport-Security max-age ${hsts[1]} is under a year (${HSTS_MIN_SECONDS})`);
  const csp = get("content-security-policy");
  if (!csp) out.push(`${page}: no Content-Security-Policy`);
  if (!/^\s*nosniff\s*$/i.test(get("x-content-type-options"))) out.push(`${page}: X-Content-Type-Options is not nosniff`);
  const referrer = get("referrer-policy");
  if (!referrer) out.push(`${page}: no Referrer-Policy`);
  else if (/unsafe-url/i.test(referrer)) out.push(`${page}: Referrer-Policy is unsafe-url`);
  if (!/frame-ancestors/i.test(csp) && !/^\s*(deny|sameorigin)\s*$/i.test(get("x-frame-options"))) out.push(`${page}: no frame protection (CSP frame-ancestors or X-Frame-Options)`);
  if (get("x-powered-by")) out.push(`${page}: X-Powered-By tells the framework (${get("x-powered-by")})`);
  return out;
}

/** What a page's speed lacks: { lcp } in milliseconds (0 when the page had no paint entry) and { cls }. */
export function speedFindings({ lcp, cls }, page) {
  const out = [];
  if (lcp > SPEED.lcp_ms) out.push(`${page}: largest contentful paint ${Math.round(lcp)} ms, over ${SPEED.lcp_ms} ms`);
  if (cls > SPEED.cls) out.push(`${page}: layout shift ${cls.toFixed(3)}, over ${SPEED.cls}`);
  return out;
}

/** One check's record: a failed check with the owner's waiver is waived, not failed. */
export function checkRecord(name, { findings = [], note = "", na = false }, waived) {
  if (na) return { name, status: "n/a", findings: [], note };
  if (findings.length === 0) return { name, status: "pass", findings: [], note };
  if (waived.has(name)) return { name, status: "waived", findings, note, waiver: waived.get(name) };
  return { name, status: "fail", findings, note };
}

/** The report's text for the reviewer (.devos/readiness.md). */
export function reportText(report) {
  const lines = [
    `# Production readiness — ${report.task} (PR-88)`,
    "",
    `ASVS level ${report.level}: ${report.level_why}. Verify every requirement at this level or below in the chapters your prompt lists (devos/skills/owasp-asvs/DEVOS-NOTES.md).`,
    "",
    `Pages: ${report.pages.length ? report.pages.join(" · ") : "none"}${report.source ? ` (${report.source})` : ""}.`,
    "",
    "| Check | Result | Findings |",
    "|---|---|---|",
    ...report.checks.map((c) => `| ${c.name} | ${c.status}${c.waiver ? ` (owner's waiver: ${c.waiver})` : ""} | ${[...c.findings.slice(0, 12), ...(c.findings.length > 12 ? [`and ${c.findings.length - 12} more`] : []), c.note].filter(Boolean).join("; ").replaceAll("|", "\\|") || "—"} |`),
    "",
    report.passed ? "The readiness check passes." : "The readiness check fails: the launch task cannot pass until each failed check is fixed or the owner waives it in docs/DECISIONS.md.",
    "",
  ];
  return lines.join("\n");
}

/** ci-results.json with the readiness check in place of an earlier one. */
export function withReadiness(ci, report) {
  const failed = report.checks.filter((c) => c.status === "fail");
  const result = {
    name: "readiness",
    required: true,
    command: `node scripts/devos/readiness.mjs --task ${report.task}`,
    status: failed.length ? "fail" : "pass",
    exit: failed.length ? 1 : 0,
    seconds: 0,
    tail: report.checks.map((c) => `${c.name}: ${c.status}${c.findings.length ? ` — ${c.findings.slice(0, 5).join("; ")}` : ""}`).join("\n"),
  };
  const results = [...(ci.results ?? []).filter((r) => r.name !== "readiness"), result];
  const failedRequired = [...(ci.failed_required ?? []).filter((name) => name !== "readiness"), ...(failed.length ? ["readiness"] : [])];
  return { ...ci, results, failed_required: failedRequired, all_required_passed: failedRequired.length === 0 };
}

const readText = (rel) => (existsSync(P(rel)) ? readFileSync(P(rel), "utf8") : "");

function paymentsChosen() {
  try {
    const value = JSON.parse(readText("devos/answers.json") || "{}")?.modules?.payments;
    return typeof value === "string" && value !== "" && value !== "none";
  } catch {
    return false;
  }
}

function auditCheck() {
  const toolchain = config().stack?.toolchain || "node";
  if (toolchain !== "node" || !existsSync(P("package.json"))) return { na: true, note: `the audit covers Node first (PR-85); check this ${toolchain} project's dependencies by hand` };
  if (!existsSync(P("pnpm-lock.yaml"))) return { findings: ["pnpm-lock.yaml is missing, and the audit reads it: run pnpm install"] };
  const report = audit();
  if (report.error) return { findings: [`pnpm audit did not run (${report.error})`] };
  return {
    findings: report.advisories.map((item) => `${item.name} — ${item.severity}: ${item.title || "an advisory"}${item.id ? ` (${item.id})` : ""}`),
    note: `${report.advisories.length} high or critical`,
  };
}

async function serve(port, base) {
  if (base) return { url: base.replace(/\/+$/, ""), source: `preview ${base}`, stop: () => {} };
  const preview = String(config().stack?.preview ?? "").trim().replaceAll("{port}", String(port));
  const env = { ...process.env, ...readEnvFile(), PORT: String(port), HOST: "127.0.0.1", NITRO_PORT: String(port), NITRO_HOST: "127.0.0.1" };
  let server;
  if (preview) server = spawn(preview, { cwd: P(), env, stdio: "ignore", shell: true, detached: process.platform !== "win32" });
  else if (existsSync(P(".next"))) server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], { cwd: P(), env, stdio: "ignore", shell: process.platform === "win32", detached: process.platform !== "win32" });
  else return { error: "no local build to serve: devos.config.json names no stack.preview and there is no .next build" };
  const url = `http://127.0.0.1:${port}`;
  const stop = () => {
    try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"]) : process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ }
  };
  for (let i = 0; i < 120; i += 1) {
    try {
      await fetch(`${url}/`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      return { url, source: preview ? `local build (${preview})` : "local build (next start)", stop };
    } catch {
      await sleep(500);
    }
  }
  stop();
  return { error: `the local build did not answer on port ${port} within a minute` };
}

async function browserChecks(url, pages) {
  const req = createRequire(P("package.json"));
  let chromium;
  try {
    chromium = req("@playwright/test").chromium;
  } catch {
    const why = "no @playwright/test in the project: add it (docs/method/DESIGN_METHOD.md §4) or waive the check";
    return { accessibility: { findings: [why] }, speed: { findings: [why] } };
  }
  let AxeBuilder = null;
  try {
    const axe = req("@axe-core/playwright");
    AxeBuilder = axe.AxeBuilder ?? axe.default ?? axe;
  } catch { /* reported below */ }
  const a11y = AxeBuilder ? [] : ["no @axe-core/playwright in the project: add it or waive the check"];
  const speed = [];
  const measured = [];
  const browser = await chromium.launch(process.env.DEVOS_CHROMIUM ? { executablePath: process.env.DEVOS_CHROMIUM } : {});
  try {
    for (const page of pages) {
      if (AxeBuilder) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        try {
          const tab = await ctx.newPage();
          await tab.goto(`${url}${page}`, { waitUntil: "load", timeout: 30000 });
          const found = await new AxeBuilder({ page: tab }).withTags(AXE_TAGS).analyze();
          for (const v of found.violations ?? []) a11y.push(`${page}: ${v.id} (${v.impact ?? "unrated"}, ${v.nodes?.length ?? 0} element(s)) — ${v.help}`);
        } catch (error) {
          a11y.push(`${page}: did not load (${String(error?.message ?? error).split("\n")[0]})`);
        } finally {
          await ctx.close();
        }
      }
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        const tab = await ctx.newPage();
        await tab.goto(`${url}${page}`, { waitUntil: "load", timeout: 30000 });
        const metrics = await tab.evaluate(() => new Promise((resolve) => {
          let lcp = 0;
          let cls = 0;
          try {
            new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = Math.max(lcp, e.renderTime || e.loadTime || e.startTime || 0); }).observe({ type: "largest-contentful-paint", buffered: true });
          } catch { /* no paint entries in this browser */ }
          try {
            new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true });
          } catch { /* no layout-shift entries */ }
          // Watch 1.5 s more, and until 4 s after the navigation began: a paint after 2.5 s is over the line.
          setTimeout(() => resolve({ lcp, cls }), Math.max(1500, 4000 - performance.now()));
        }));
        measured.push(`${page} ${Math.round(metrics.lcp)} ms, ${metrics.cls.toFixed(3)}`);
        speed.push(...speedFindings(metrics, page));
      } catch (error) {
        speed.push(`${page}: did not load (${String(error?.message ?? error).split("\n")[0]})`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  return {
    accessibility: { findings: a11y, note: AxeBuilder ? `axe at 1280 px on ${pages.length} page(s)` : "" },
    speed: { findings: speed, note: measured.length ? `at 390 px: ${measured.join("; ")}` : "" },
  };
}

async function main() {
  const arg = (name, fallback = "") => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback; };
  const task = arg("task", process.env.TASK ?? "");
  if (!/^T\d{2}$/.test(task)) {
    console.error("usage: node scripts/devos/readiness.mjs --task Tnn [--port 3300] [--base https://…]");
    process.exit(2);
  }
  const line = launchLine(readText(`docs/fences/${task}.md`));
  rmSync(P(".devos/readiness.json"), { force: true });
  rmSync(P(".devos/readiness.md"), { force: true });
  if (!line.found) {
    console.log(`readiness: N/A (${task} has no - Launch: line, so it is not the launch task)`);
    return;
  }
  const waived = waivers(readText("docs/DECISIONS.md"));
  const { level, why } = asvsLevel({ protection: existsSync(P("docs/PROTECTION_MODEL.md")), payments: paymentsChosen() });
  const results = { audit: auditCheck() };
  let source = "";
  if (line.errors.length) {
    for (const name of ["headers", "accessibility", "speed"]) results[name] = { findings: line.errors.map((e) => `the - Launch: line ${e}`) };
  } else if (line.none) {
    for (const name of ["headers", "accessibility", "speed"]) results[name] = { na: true, note: "no pages (- Launch: none)" };
  } else {
    const served = await serve(Number(arg("port", "3300")) || 3300, arg("base"));
    if (served.error) {
      for (const name of ["headers", "accessibility", "speed"]) results[name] = { findings: [served.error] };
    } else {
      source = served.source;
      try {
        const found = [];
        for (const page of line.paths) {
          try {
            const res = await fetch(`${served.url}${page}`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
            if (res.status >= 400) found.push(`${page}: answered ${res.status}`);
            found.push(...headerFindings(res.headers, page));
          } catch (error) {
            found.push(`${page}: no answer (${error?.message ?? error})`);
          }
        }
        results.headers = { findings: found, note: `${line.paths.length} page(s)` };
        Object.assign(results, await browserChecks(served.url, line.paths));
      } finally {
        served.stop();
      }
    }
  }
  const checks = CHECKS.map((name) => checkRecord(name, results[name], waived));
  const report = { task, level, level_why: why, pages: line.paths, source, checks, passed: checks.every((c) => c.status !== "fail") };
  mkdirSync(P(".devos/logs"), { recursive: true });
  writeFileSync(P(".devos/readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(P(".devos/readiness.md"), reportText(report));
  writeFileSync(P(".devos/logs/readiness.log"), `${checks.map((c) => `${c.name}: ${c.status}\n${c.findings.map((f) => `  ${f}`).join("\n")}`).join("\n")}\n`);
  for (const c of checks) {
    console.log(`readiness ${c.name}: ${c.status}${c.note ? ` (${c.note})` : ""}`);
    for (const f of c.findings.slice(0, 20)) console.log(`  ${f}`);
  }
  console.log(`readiness: ${report.passed ? "PASS" : "FAIL"} · ASVS level ${level}`);
  const ciFile = P(".devos/ci-results.json");
  if (!existsSync(ciFile)) {
    console.log("readiness: no .devos/ci-results.json; nothing recorded");
    return;
  }
  writeFileSync(ciFile, JSON.stringify(withReadiness(JSON.parse(readFileSync(ciFile, "utf8")), report), null, 2));
}

if (process.argv[1]?.endsWith("readiness.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
