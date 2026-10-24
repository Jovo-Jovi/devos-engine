// Self-test for screens.mjs (PR-35, PR-51). No app build and no .devos file: a synthetic server and Chromium.
// The accessibility test needs @axe-core/playwright in the project, as every UI project has from T01.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseScreensLine, pickFrames, captureStates, motionSummary, motionCounts } from "./screens.mjs";

const PAGES = {
  "/still": `<!doctype html><meta charset="utf-8"><title>still</title><h1>Still</h1>`,
  "/fade": `<!doctype html><meta charset="utf-8"><title>fade</title>
<style>
  body { margin: 0; background: #111; }
  h1 { margin: 0; color: #eee; font: 32px sans-serif; }
  .block { width: 280px; height: 280px; background: #e11; animation: fade 640ms linear both; }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
</style>
<h1>Fade</h1><div class="block"></div>`,
  "/shift": `<!doctype html><meta charset="utf-8"><title>shift</title>
<style>body { margin: 0; font: 32px sans-serif; } h1 { margin: 0; }</style>
<h1 id="h">Shift</h1>
<script>
  setTimeout(() => {
    const block = document.createElement("div");
    block.style.height = "200px";
    block.style.background = "#0a0";
    block.textContent = "inserted";
    document.body.insertBefore(block, document.getElementById("h"));
  }, 200);
</script>`,
  "/press": `<!doctype html><meta charset="utf-8"><title>press</title>
<style>
  body { margin: 0; font: 32px sans-serif; }
  #box { width: 160px; height: 160px; background: #28e; transition: transform 400ms linear; }
  #box.on { transform: translateX(120px); }
</style>
<button id="go">Go</button><div id="box"></div>
<script>
  document.getElementById("go").addEventListener("click", () => document.getElementById("box").classList.add("on"));
</script>`,
  "/clean": `<!doctype html><html lang="en"><meta charset="utf-8"><title>clean</title><main><h1>Clean</h1><p>Plain text.</p></main></html>`,
  "/broken": `<!doctype html><html lang="en"><meta charset="utf-8"><title>broken</title>
<main><h1>Broken</h1><img src="/pixel.svg"><button></button></main>
<script>console.error("boom"); fetch("/nowhere");</script></html>`,
};

const FILM = [0, 80, 160, 320, 640];
let server;
let browser;
let dir;
let manifest;
let axeCaptures = null;
let bareCaptures;

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.statusCode = PAGES[path] ? 200 : 404;
    res.end(PAGES[path] ?? "missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const require = createRequire(join(process.cwd(), "package.json"));
  const { chromium } = require("@playwright/test");
  browser = await chromium.launch(process.env.DEVOS_CHROMIUM ? { executablePath: process.env.DEVOS_CHROMIUM } : {});
  dir = await mkdtemp(join(tmpdir(), "devos-screens-"));
  const shared = { browser, url: `http://127.0.0.1:${port}`, outDir: dir, filmstripMs: FILM, settleMaxMs: 3000, headers: {} };
  const pages = await captureStates({
    ...shared,
    states: [
      { name: "still", path: "/still", action: null },
      { name: "fade", path: "/fade", action: null },
      { name: "shift", path: "/shift", action: null },
    ],
    widths: [1280, 390],
  });
  const press = await captureStates({
    ...shared,
    states: [{ name: "press", path: "/press", action: { type: "click", selector: "#go" } }],
    widths: [390],
  });
  const checked = [
    { name: "clean", path: "/clean", action: null },
    { name: "broken", path: "/broken", action: null },
  ];
  bareCaptures = await captureStates({ ...shared, states: checked, widths: [390] });
  let AxeBuilder = null;
  try {
    const axe = require("@axe-core/playwright");
    AxeBuilder = axe.AxeBuilder ?? axe.default ?? axe;
  } catch { /* the accessibility test is skipped */ }
  if (AxeBuilder) axeCaptures = await captureStates({ ...shared, states: checked, widths: [390], AxeBuilder });
  manifest = {
    source: "synthetic",
    task: "T08",
    states_from: "test",
    filmstrip_ms: FILM,
    errors: [],
    captures: [...pages, ...press],
  };
}, { timeout: 180000 });

after(async () => {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("parseScreensLine reads the header and drops bad entries", () => {
  const entries = [
    "signed-out /sign-in",
    "denied /sign-in?reason=not_owner",
    'press /sign-in click role=button[name="Continue with GitHub"]',
    "Bad_Name /x",
    "drag /y drag #z",
    "denied /other",
  ];
  const text = `- Screens: ${entries.map((e) => "`" + e + "`").join(" · ")}\n### Prompt\n- Screens: \`hidden /no\`\n`;
  const parsed = parseScreensLine(text);
  assert.equal(parsed.found, true);
  assert.equal(parsed.states.length, 3);
  assert.equal(parsed.errors.length, 3);
  assert.deepEqual(parsed.states.map((s) => s.name), ["signed-out", "denied", "press"]);
  assert.equal(parsed.states[1].path, "/sign-in?reason=not_owner");
  assert.equal(parsed.states[1].action, null);
  assert.deepEqual(parsed.states[2].action, { type: "click", selector: 'role=button[name="Continue with GitHub"]' });
  const missing = parseScreensLine("no screens line here\n### Prompt\n");
  assert.equal(missing.found, false);
  assert.deepEqual(missing.states, []);
});

test("pickFrames selects the frame on screen at each target", () => {
  const picked = pickFrames([{ ts: 970 }, { ts: 1005 }, { ts: 1070 }, { ts: 1090 }, { ts: 1400 }], 1000, FILM);
  assert.deepEqual(picked.map((p) => p.index), [1, 2, 3, 3, 4]);
  assert.deepEqual(picked.map((p) => p.frame_ms), [5, 70, 90, 90, 400]);
  const early = pickFrames([{ ts: 990 }], 1000, [0, 80]);
  assert.deepEqual(early.map((p) => p.index), [0, 0]);
  assert.deepEqual(early.map((p) => p.frame_ms), [-10, -10]);
  const none = pickFrames([], 1000, FILM);
  assert.equal(none.length, 5);
  assert.deepEqual(none.map((p) => p.index), [-1, -1, -1, -1, -1]);
  assert.deepEqual(none.map((p) => p.frame_ms), [null, null, null, null, null]);
});

test("normal motion is not reduced, and the reduced capture is", () => {
  assert.equal(manifest.captures.length, 7);
  for (const c of manifest.captures) {
    assert.deepEqual(c.prefers_reduced_motion, { normal: false, reduced: true }, `${c.state} ${c.width} ${c.error ?? ""}`);
  }
  for (const file of ["still-1280.png", "still-1280-reduced.png", "fade-390-film-640.png"]) {
    assert.equal(existsSync(join(dir, file)), true, file);
  }
});

test("fade and press filmstrips span the motion", () => {
  const sha = (file) => createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
  const wanted = [
    ...manifest.captures.filter((c) => c.state === "fade"),
    ...manifest.captures.filter((c) => c.state === "press" && c.trigger === "click #go"),
  ];
  assert.equal(wanted.length, 3);
  for (const c of wanted) {
    assert.equal(c.error, null, c.error ?? "");
    assert.deepEqual(c.film.map((f) => f.target_ms), FILM);
    let prev = -Infinity;
    for (const frame of c.film) {
      assert.equal(typeof frame.frame_ms, "number");
      assert.ok(frame.frame_ms >= prev, `${c.state} ${c.width} ${frame.frame_ms} < ${prev}`);
      prev = frame.frame_ms;
      assert.equal(existsSync(join(dir, frame.file)), true, frame.file);
    }
    assert.notEqual(sha(c.film[0].file), sha(c.film[4].file), JSON.stringify(c.film.map((f) => f.frame_ms)));
  }
});

test("layout shift is zero on a still page and above zero when content is inserted", () => {
  for (const width of [1280, 390]) {
    const still = manifest.captures.find((c) => c.state === "still" && c.width === width);
    const shift = manifest.captures.find((c) => c.state === "shift" && c.width === width);
    assert.equal(still.layout_shift, 0, `still ${width}`);
    assert.ok(shift.layout_shift > 0, `shift ${width} ${shift.layout_shift}`);
  }
});

test("motionSummary and motionCounts describe the seven captures", () => {
  const lines = motionSummary(manifest);
  const header = "| State | Width | Trigger | Settled | Reduced | Frames | Layout shift | Reduced shift | Notes |";
  assert.ok(lines.includes(header));
  const data = lines.filter((l) => l.startsWith("| ") && !l.startsWith("| State ") && !l.includes("---"));
  assert.equal(data.length, 7);
  const shiftRows = data.filter((l) => l.startsWith("| shift |"));
  assert.equal(shiftRows.length, 2);
  for (const row of shiftRows) assert.match(row, /\*\*\d/);
  const counts = motionCounts(manifest);
  assert.equal(counts.captures, 7);
  assert.equal(counts.frames, 35);
  assert.equal(counts.shifted, 2);
});

test("console errors and failed requests are recorded, and axe is reported as not run without its package", () => {
  const clean = bareCaptures.find((c) => c.state === "clean");
  const broken = bareCaptures.find((c) => c.state === "broken");
  assert.deepEqual(clean.console_errors, [], clean.console_errors.join("; "));
  assert.deepEqual(clean.failed_requests, [], clean.failed_requests.join("; "));
  assert.ok(broken.console_errors.some((text) => text.includes("boom")), broken.console_errors.join("; "));
  assert.ok(broken.failed_requests.some((text) => text.startsWith("404 GET") && text.endsWith("/nowhere")), broken.failed_requests.join("; "));
  assert.ok(broken.failed_requests.some((text) => text.endsWith("/pixel.svg")), broken.failed_requests.join("; "));
  assert.equal(broken.a11y.ran, false);
  assert.match(broken.a11y.reason, /@axe-core\/playwright/);
});

test("axe finds no violation on a clean page and names them on a broken one", (t) => {
  if (!axeCaptures) {
    t.skip("@axe-core/playwright is not installed in this project");
    return;
  }
  const clean = axeCaptures.find((c) => c.state === "clean");
  const broken = axeCaptures.find((c) => c.state === "broken");
  assert.equal(clean.a11y.ran, true);
  assert.deepEqual(clean.a11y.violations, []);
  const ids = broken.a11y.violations.map((v) => v.id);
  assert.ok(ids.includes("image-alt"), ids.join(", "));
  assert.ok(ids.includes("button-name"), ids.join(", "));
});
