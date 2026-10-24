#!/usr/bin/env node
// Visual evidence for the reviewer (PR-35): per state and width, a settled screenshot
// in normal motion, a filmstrip picked from a CDP screencast, a reduced-motion screenshot and the
// layout-shift value. Written to .devos/screens/ and summarised in motion.json. PR-51: each capture
// also records the console errors and failed requests seen while it ran, and the axe result of the
// settled state (@axe-core/playwright, WCAG 2.2 AA tags); ui-evidence.mjs turns them into checks.
// Importing this module launches nothing. The run starts only when the file is executed.
// Usage: node scripts/devos/screens.mjs [--base https://preview.vercel.app] [--port 3200] [--task Tnn] [/path ...]
// States, in order: page arguments → the fence's `- Screens:` line → devos.config.json screens.pages.
// A --base that answers with the Vercel login (401, or a redirect to vercel.com/sso) is not used:
// the screenshots come from the local build instead, and .devos/screens/SOURCE.txt says which (PR-15).
// The local build is served by devos.config.json stack.preview ({port} is replaced, PORT is set), or by
// next start when the stack names no preview command.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { P, config } from "./lib.mjs";
import { readEnvFile } from "./supabase.mjs";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const ACTIONS = new Set(["click", "hover", "focus"]);
const WIDTHS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nameFromPath(path) {
  const bare = String(path).split("?")[0].replace(/^\//, "").replace(/\//g, "-");
  return bare || "root";
}

function actionText(action) {
  return action ? `${action.type} ${action.selector}` : null;
}

function parseEntry(raw) {
  const text = String(raw).trim();
  const m = /^(\S+)\s+(\S+)(?:\s+(\S+)(?:\s+([\s\S]+))?)?$/.exec(text);
  if (!m) return { error: `bad path "${text}"` };
  const name = m[1];
  const path = m[2];
  const type = m[3];
  const selector = (m[4] ?? "").trim();
  if (!NAME_RE.test(name)) return { error: `bad name "${name}"` };
  if (!path.startsWith("/")) return { error: `bad path "${path}"` };
  if (type === undefined) return { state: { name, path, action: null } };
  if (!ACTIONS.has(type)) return { error: `unknown action "${type}"` };
  if (!selector) return { error: `empty selector for ${name}` };
  return { state: { name, path, action: { type, selector } } };
}

/** First `- Screens:` line before `### Prompt`. Backticked entries, separated by ` · `. */
export function parseScreensLine(fenceText) {
  const head = String(fenceText).split(/^### Prompt\b/m)[0];
  const line = head.split(/\r?\n/).find((l) => /^- Screens:/.test(l));
  if (!line) return { found: false, states: [], errors: [] };
  const states = [];
  const errors = [];
  const seen = new Set();
  for (const entry of [...line.matchAll(/`([^`]*)`/g)].map((hit) => hit[1])) {
    const parsed = parseEntry(entry);
    if (parsed.error) { errors.push(parsed.error); continue; }
    if (seen.has(parsed.state.name)) { errors.push(`duplicate name "${parsed.state.name}"`); continue; }
    seen.add(parsed.state.name);
    states.push(parsed.state);
  }
  return { found: true, states, errors };
}

/**
 * One frame per target. `frames` are `{ ts }` in epoch ms, ascending.
 * Target 0: first frame at or after t0, else the latest frame before t0.
 * A later target: the latest frame at or before t0 + target, never earlier than target 0's frame.
 */
export function pickFrames(frames, t0, targets) {
  if (!frames.length) return targets.map((target_ms) => ({ target_ms, frame_ms: null, index: -1 }));
  let floor = 0;
  let haveFloor = false;
  return targets.map((target_ms) => {
    let index;
    if (target_ms === 0) {
      index = frames.findIndex((f) => f.ts >= t0);
      if (index < 0) {
        index = frames.length - 1;
        for (let i = frames.length - 1; i >= 0; i--) if (frames[i].ts < t0) { index = i; break; }
      }
      floor = index;
      haveFloor = true;
    } else {
      const min = haveFloor ? floor : 0;
      const limit = t0 + target_ms;
      index = min;
      for (let i = min; i < frames.length; i++) {
        if (frames[i].ts <= limit) index = i;
        else break;
      }
    }
    return { target_ms, frame_ms: index < 0 ? null : Math.round(frames[index].ts - t0), index };
  });
}

function normalizeWidths(widths) {
  return widths.map((w) => {
    if (typeof w === "number") return { width: w, height: w === 390 ? 844 : 900 };
    return { width: w.width, height: w.height };
  });
}

function round4(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

function shiftInit() {
  window.__layoutShift = 0;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__layoutShift += entry.value;
      }
    });
    obs.observe({ type: "layout-shift", buffered: true });
  } catch { /* the sum stays 0 when the page has no observer */ }
}

async function readShift(page) {
  return round4(await page.evaluate(() => (typeof window.__layoutShift === "number" ? window.__layoutShift : 0)));
}

async function readPrefersReduced(page) {
  return page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
}

async function settle(page, settleMaxMs) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  const start = Date.now();
  for (;;) {
    const running = await page.evaluate(() => (document.getAnimations?.() ?? []).some((anim) => {
      const iterations = anim.effect?.getTiming?.().iterations;
      return iterations !== Infinity && anim.playState === "running";
    }));
    if (!running) return false;
    if (Date.now() - start >= settleMaxMs) return true;
    await sleep(50);
  }
}

async function pollPaint(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const t0 = await page.evaluate(() => {
      const paint = performance.getEntriesByName("first-contentful-paint")[0]
        || performance.getEntriesByName("first-paint")[0];
      return paint ? performance.timeOrigin + paint.startTime : null;
    });
    if (t0 != null) return t0;
    await sleep(50);
  }
  return null;
}

async function perform(page, action) {
  if (action.type === "click") await page.click(action.selector);
  else if (action.type === "hover") await page.hover(action.selector);
  else if (action.type === "focus") await page.focus(action.selector);
  else throw new Error(`unknown action "${action.type}"`);
}

function blankCapture(state, width) {
  return {
    state: state.name,
    path: state.path,
    action: actionText(state.action),
    width,
    trigger: state.action ? actionText(state.action) : "first paint",
    clock: null,
    film: [],
    settled: null,
    reduced: null,
    prefers_reduced_motion: { normal: null, reduced: null },
    layout_shift: null,
    layout_shift_reduced: null,
    settle_capped: false,
    console_errors: [],
    failed_requests: [],
    a11y: { ran: false, reason: "not run", violations: [] },
    error: null,
  };
}

/** Records console errors, page errors and failed requests on `capture` until the returned stop() is called. */
function watch(page, capture) {
  let on = true;
  const add = (list, text) => {
    const line = String(text).slice(0, 300);
    if (on && list.length < 20 && !list.includes(line)) list.push(line);
  };
  page.on("console", (msg) => { if (msg.type() === "error") add(capture.console_errors, msg.text()); });
  page.on("pageerror", (error) => add(capture.console_errors, error instanceof Error ? error.message : error));
  page.on("requestfailed", (request) => add(capture.failed_requests, `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`));
  page.on("response", (response) => {
    if (response.status() >= 400) add(capture.failed_requests, `${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return () => { on = false; };
}

/** The axe result of the page as it is now, or why there is none. */
async function checkA11y(page, AxeBuilder) {
  if (!AxeBuilder) return { ran: false, reason: "@axe-core/playwright is not installed in this project", violations: [] };
  const found = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return {
    ran: true,
    reason: "",
    violations: found.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).map((node) => [].concat(node.target).join(" ")),
    })),
  };
}

async function openPage(browser, { width, height, headers, reducedMotion }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: headers,
    reducedMotion,
  });
  await ctx.addInitScript(shiftInit);
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * One capture per state × width: normal-motion filmstrip and settled screenshot, then the
 * reduced-motion screenshot. A throw is recorded on that capture; the rest still run.
 */
export async function captureStates({ browser, url, states, widths, outDir, filmstripMs, settleMaxMs, headers = {}, AxeBuilder = null }) {
  mkdirSync(outDir, { recursive: true });
  const root = url.replace(/\/$/, "");
  const captures = [];
  for (const state of states) {
    for (const w of normalizeWidths(widths)) {
      const capture = blankCapture(state, w.width);
      captures.push(capture);
      let normal;
      try {
        normal = await openPage(browser, { ...w, headers, reducedMotion: "no-preference" });
        const { page } = normal;
        const stopWatch = watch(page, capture);
        const client = await page.context().newCDPSession(page);
        const frames = [];
        let usedReceipt = false;
        const onFrame = (ev) => {
          const stamp = ev.metadata?.timestamp;
          if (typeof stamp === "number") frames.push({ ts: stamp * 1000, data: Buffer.from(ev.data, "base64") });
          else { frames.push({ ts: Date.now(), data: Buffer.from(ev.data, "base64") }); usedReceipt = true; }
          void client.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
        };
        client.on("Page.screencastFrame", onFrame);
        await client.send("Page.startScreencast", {
          format: "png", everyNthFrame: 1, maxWidth: w.width, maxHeight: w.height,
        });
        try {
          await page.goto(`${root}${state.path}`, { waitUntil: "commit" });
          capture.prefers_reduced_motion.normal = await readPrefersReduced(page);
          let t0;
          if (state.action) {
            if (await settle(page, settleMaxMs)) capture.settle_capped = true;
            t0 = await page.evaluate(() => performance.timeOrigin + performance.now());
            await perform(page, state.action);
          } else {
            t0 = await pollPaint(page);
          }
          if (t0 == null) t0 = Date.now();
          const windowMs = (filmstripMs.length ? Math.max(...filmstripMs) : 0) + 100;
          const remain = t0 + windowMs - Date.now();
          if (remain > 0) await sleep(remain);
          await client.send("Page.stopScreencast").catch(() => {});
          await sleep(150);
          client.off("Page.screencastFrame", onFrame);
          const ordered = frames.slice().sort((a, b) => a.ts - b.ts);
          capture.clock = ordered.length === 0 ? null : (usedReceipt ? "receipt" : "frame");
          if (!ordered.length) throw new Error("screencast yielded no frame");
          capture.film = pickFrames(ordered, t0, filmstripMs).map((picked) => {
            const file = `${state.name}-${w.width}-film-${String(picked.target_ms).padStart(3, "0")}.png`;
            if (picked.index >= 0) writeFileSync(join(outDir, file), ordered[picked.index].data);
            return { target_ms: picked.target_ms, frame_ms: picked.frame_ms, file: picked.index >= 0 ? file : null };
          });
          if (await settle(page, settleMaxMs)) capture.settle_capped = true;
          const settled = `${state.name}-${w.width}.png`;
          await page.screenshot({ path: join(outDir, settled), fullPage: true });
          capture.settled = settled;
          capture.layout_shift = await readShift(page);
          stopWatch();
          capture.a11y = await checkA11y(page, AxeBuilder);
        } finally {
          stopWatch();
          await client.send("Page.stopScreencast").catch(() => {});
        }
      } catch (e) {
        capture.error = e instanceof Error ? e.message : String(e);
      } finally {
        await normal?.ctx.close().catch(() => {});
      }
      let reduced;
      try {
        reduced = await openPage(browser, { ...w, headers, reducedMotion: "reduce" });
        const { page } = reduced;
        const stopWatch = watch(page, capture);
        await page.goto(`${root}${state.path}`, { waitUntil: "commit" });
        capture.prefers_reduced_motion.reduced = await readPrefersReduced(page);
        if (state.action) {
          if (await settle(page, settleMaxMs)) capture.settle_capped = true;
          await perform(page, state.action);
        }
        if (await settle(page, settleMaxMs)) capture.settle_capped = true;
        const file = `${state.name}-${w.width}-reduced.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        capture.reduced = file;
        capture.layout_shift_reduced = await readShift(page);
        stopWatch();
      } catch (e) {
        if (!capture.error) capture.error = e instanceof Error ? e.message : String(e);
      } finally {
        await reduced?.ctx.close().catch(() => {});
      }
    }
  }
  return captures;
}

function cell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|");
}

function shiftCell(n) {
  if (typeof n !== "number") return "—";
  return n > 0 ? `**${n}**` : String(n);
}

function notesFor(capture) {
  const notes = [];
  if (capture.settle_capped) notes.push("settle capped");
  if (capture.error) notes.push(capture.error);
  const pref = capture.prefers_reduced_motion ?? {};
  if (pref.normal !== false || pref.reduced !== true) notes.push("prefers-reduced-motion not as expected");
  return notes.join("; ");
}

/** Markdown lines: the motion table, then one sentence per non-zero shift, capture error and parse error. */
export function motionSummary(manifest) {
  const header = "| State | Width | Trigger | Settled | Reduced | Frames | Layout shift | Reduced shift | Notes |";
  const lines = [header, "|---|---|---|---|---|---|---|---|---|"];
  for (const c of manifest.captures ?? []) {
    const n = (c.film ?? []).filter((f) => f.file).length;
    lines.push(`| ${cell(c.state)} | ${cell(c.width)} | ${cell(c.trigger)} | ${cell(c.settled)} | ${cell(c.reduced)} | ${n}/5 | ${shiftCell(c.layout_shift)} | ${shiftCell(c.layout_shift_reduced)} | ${cell(notesFor(c))} |`);
  }
  const sentences = [];
  for (const c of manifest.captures ?? []) {
    if ((c.layout_shift ?? 0) > 0) sentences.push(`Layout shift for ${c.state} at ${c.width} is ${c.layout_shift}.`);
    if ((c.layout_shift_reduced ?? 0) > 0) sentences.push(`Reduced-motion layout shift for ${c.state} at ${c.width} is ${c.layout_shift_reduced}.`);
    if (c.error) sentences.push(`Capture ${c.state} at ${c.width} failed: ${c.error}.`);
    if ((c.console_errors ?? []).length) sentences.push(`Console errors for ${c.state} at ${c.width}: ${c.console_errors.length} (first: ${c.console_errors[0]}).`);
    if ((c.failed_requests ?? []).length) sentences.push(`Failed requests for ${c.state} at ${c.width}: ${c.failed_requests.length} (first: ${c.failed_requests[0]}).`);
    if (c.a11y?.ran && c.a11y.violations.length) sentences.push(`Accessibility violations for ${c.state} at ${c.width}: ${c.a11y.violations.map((v) => v.id).join(", ")}.`);
  }
  for (const err of manifest.errors ?? []) sentences.push(`Screens line: ${err}.`);
  if (sentences.length) lines.push("", ...sentences);
  return lines;
}

export function motionCounts(manifest) {
  const captures = manifest.captures ?? [];
  const ok = (c) => !c.error;
  return {
    states: new Set(captures.map((c) => c.state)).size,
    widths: new Set(captures.map((c) => c.width)).size,
    captures: captures.length,
    settled: captures.filter((c) => ok(c) && c.settled).length,
    reduced: captures.filter((c) => ok(c) && c.reduced).length,
    frames: captures.reduce((n, c) => n + (c.film?.filter((f) => f.file).length ?? 0), 0),
    shifted: captures.filter((c) => (c.layout_shift ?? 0) > 0).length,
    errors: captures.filter((c) => c.error).length,
  };
}

function resolveStates(task, pageArgs) {
  if (pageArgs.length) {
    return {
      states: pageArgs.map((path) => ({ name: nameFromPath(path), path, action: null })),
      statesFrom: "command line",
      errors: [],
    };
  }
  if (task) {
    const rel = `docs/fences/${task}.md`;
    if (existsSync(P(rel))) {
      const parsed = parseScreensLine(readFileSync(P(rel), "utf8"));
      if (parsed.found) return { states: parsed.states, statesFrom: rel, errors: parsed.errors };
    }
  }
  const pages = config().screens?.pages ?? ["/"];
  return {
    states: pages.map((path) => ({ name: nameFromPath(path), path, action: null })),
    statesFrom: "devos.config.json screens.pages",
    errors: [],
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  let base = (opt("base", "") || "").replace(/\/$/, "");
  const port = Number(opt("port", "3200"));
  const task = opt("task", process.env.TASK ?? "");
  const pageArgs = argv.filter((a, i) => a.startsWith("/") && argv[i - 1] !== "--base");
  const { states, statesFrom, errors } = resolveStates(task, pageArgs);
  const screensCfg = config().screens ?? {};
  const filmstripMs = screensCfg.filmstrip_ms ?? [0, 80, 160, 320, 640];
  const settleMaxMs = screensCfg.settle_max_ms ?? 3000;

  let chromium;
  try {
    chromium = createRequire(P("package.json"))("@playwright/test").chromium;
  } catch {
    console.log("screens: @playwright/test is not installed in this project; skipped");
    process.exit(0);
  }

  let AxeBuilder = null;
  try {
    const axe = createRequire(P("package.json"))("@axe-core/playwright");
    AxeBuilder = axe.AxeBuilder ?? axe.default ?? axe;
  } catch {
    console.log("screens: @axe-core/playwright is not installed in this project; no accessibility check");
  }

  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET, "x-vercel-set-bypass-cookie": "true" } : {};
  mkdirSync(P(".devos/screens"), { recursive: true });
  const preview = String(config().stack?.preview ?? "").trim().replaceAll("{port}", String(port));
  const local = preview ? `local build (${preview})` : "local build (next start)";
  let source = base ? `preview ${base}` : local;
  if (base) {
    let status = 0, loc = "";
    try {
      const probePath = states[0]?.path ?? "/";
      const r = await fetch(`${base}${probePath}`, { redirect: "manual", headers, signal: AbortSignal.timeout(20000) });
      status = r.status; loc = r.headers.get("location") ?? "";
    } catch (e) { loc = e.message; }
    if (status === 401 || status === 403 || status === 0 || (status >= 300 && status < 400 && /vercel\.com\/(sso|login)/.test(loc))) {
      console.log(`screens: the preview answers ${status}${loc ? " → " + loc.slice(0, 80) : ""} (Vercel login or unreachable); using the local build instead`);
      source = `${local}, because the preview ${base} answered ${status}: set VERCEL_AUTOMATION_BYPASS_SECRET to screenshot the preview`;
      base = "";
    }
  }
  writeFileSync(P(".devos/screens/SOURCE.txt"), `Screenshots taken from: ${source}\n`);

  let server;
  const url = base || `http://127.0.0.1:${port}`;
  if (!base) {
    const env = { ...process.env, ...readEnvFile(), PORT: String(port), HOST: "127.0.0.1", NITRO_PORT: String(port), NITRO_HOST: "127.0.0.1" };
    if (preview) {
      server = spawn(preview, {
        cwd: P(), env, stdio: "ignore", shell: true, detached: process.platform !== "win32",
      });
    } else {
      if (!existsSync(P(".next"))) { console.log("screens: no .next build; skipped"); process.exit(0); }
      server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
        cwd: P(), env, stdio: "ignore", shell: process.platform === "win32", detached: process.platform !== "win32",
      });
    }
    for (let i = 0; i < 120; i++) {
      try { await fetch(`${url}/`, { redirect: "manual" }); break; } catch { await sleep(500); }
    }
  }

  const browser = await chromium.launch(process.env.DEVOS_CHROMIUM ? { executablePath: process.env.DEVOS_CHROMIUM } : {});
  try {
    const captures = await captureStates({
      browser, url, states, widths: WIDTHS, outDir: P(".devos/screens"), filmstripMs, settleMaxMs, headers, AxeBuilder,
    });
    const manifest = { source, task, states_from: statesFrom, filmstrip_ms: filmstripMs, errors, captures };
    writeFileSync(P(".devos/screens/motion.json"), JSON.stringify(manifest, null, 2) + "\n");
    for (const err of errors) console.log(`screens: ${err}`);
    for (const c of captures) {
      console.log(c.error
        ? `screens: ${c.state} ${c.width} error: ${c.error}`
        : `screens: ${c.state} ${c.width} ${c.settled} film ${c.film.filter((f) => f.file).length} shift ${c.layout_shift} console ${c.console_errors.length} failed ${c.failed_requests.length} a11y ${c.a11y.ran ? c.a11y.violations.length : "not run"}`);
    }
    console.log(`screens: ${captures.length} capture(s) in .devos/screens/`);
  } finally {
    await browser.close();
    if (server) {
      try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"]) : process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ }
    }
  }
}

if (process.argv[1]?.endsWith("screens.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
