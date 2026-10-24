import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "lib", "ui");
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'";

const FILES = [
  ["/app.css", "app.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
  ["/favicon.svg", "favicon.svg", "image/svg+xml"],
  ["/fonts/plex-sans-400.woff2", "fonts/plex-sans-400.woff2", "font/woff2"],
  ["/fonts/plex-sans-500.woff2", "fonts/plex-sans-500.woff2", "font/woff2"],
  ["/fonts/plex-sans-600.woff2", "fonts/plex-sans-600.woff2", "font/woff2"],
  ["/fonts/plex-serif-300.woff2", "fonts/plex-serif-300.woff2", "font/woff2"],
  ["/fonts/plex-mono-400.woff2", "fonts/plex-mono-400.woff2", "font/woff2"],
];

function assertSecurity(headers) {
  const get = (name) => (typeof headers.get === "function" ? headers.get(name) : headers[name.toLowerCase()]);
  assert.equal(get("cache-control"), "no-store");
  assert.equal(get("x-content-type-options"), "nosniff");
  assert.equal(get("referrer-policy"), "no-referrer");
  assert.equal(get("content-security-policy"), CSP);
  assert.equal(get("access-control-allow-origin") ?? null, null);
}

function httpCall({ port, method, path: requestPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("ui-page.test.mjs (a) the page needs no token", async () => {
  const staged = stage();
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.equals(readFileSync(path.join(ui, "index.html"))), true);
    assertSecurity(response.headers);
  } finally {
    await server.close();
    cleanup(staged.parent);
  }
});

test("ui-page.test.mjs (b) only the page paths are served", async () => {
  const staged = stage();
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    for (const [route, file, type] of FILES) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get("content-type"), type, route);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(body.equals(readFileSync(path.join(ui, file))), true, route);
      assertSecurity(response.headers);
    }
    const queried = await fetch(`${origin}/app.js?x=1`);
    assert.equal(queried.status, 200);
    assert.equal(Buffer.from(await queried.arrayBuffer()).equals(readFileSync(path.join(ui, "app.js"))), true);
    for (const route of ["/index.html", "/ui/app.js", "/lib/ui/app.js", "/fonts/OFL.txt"]) {
      const missing = await fetch(`${origin}${route}`);
      assert.equal(missing.status, 404, route);
      await missing.arrayBuffer();
    }
    const posted = await fetch(`${origin}/app.js`, {
      method: "POST",
      headers: { Origin: origin, "X-DEVOS-Token": server.token },
    });
    assert.equal(posted.status, 404);
    await posted.arrayBuffer();
  } finally {
    await server.close();
    cleanup(staged.parent);
  }
});

test("ui-page.test.mjs (c) a foreign host is refused", async () => {
  const staged = stage();
  const server = await startUiServer({ folder: staged.project, port: 0 });
  try {
    const response = await httpCall({
      port: server.port,
      method: "GET",
      path: "/app.js",
      headers: { Host: "evil.example" },
    });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body.toString("utf8")).error, "host");
    assertSecurity(response.headers);
  } finally {
    await server.close();
    cleanup(staged.parent);
  }
});

test("ui-page.test.mjs (d) the page texts stay inside the fence", () => {
  const html = readFileSync(path.join(ui, "index.html"), "utf8");
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert.ok(scripts.length > 0);
  for (const tag of scripts) assert.equal(tag.includes('src="/'), true);
  assert.equal(html.includes("style="), false);
  assert.equal(/ on[a-z]+=/.test(html), false);
  assert.equal(html.includes("http"), false);

  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "eval(", "new Function", "document.write", "localStorage", 'setAttribute("style"']) {
    assert.equal(js.includes(banned), false, banned);
  }
  for (const url of js.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
    assert.equal(url === "http://www.w3.org/2000/svg" || url.startsWith("https://github.com/"), true, url);
  }

  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  assert.equal(css.includes("@import"), false);
  let at = 0;
  while ((at = css.indexOf("url(", at)) !== -1) {
    const rest = css.slice(at + 4);
    assert.equal(rest.startsWith('"/fonts/') || rest.startsWith('"data:image/svg+xml') || rest.startsWith("#"), true);
    at += 4;
  }
});

test("ui-page.test.mjs (f) the page continues a started project", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  assert.equal(js.includes("async function resume(folder, blueprint = null) {"), true);
  assert.equal(js.includes('"/api/continue"'), true);
  assert.equal(js.includes("Continue this project"), true);
  assert.equal(css.includes(".project-row {"), true);
});

test("ui-page.test.mjs (e) the page has a theme toggle and a light theme", () => {
  const html = readFileSync(path.join(ui, "index.html"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  assert.equal(html.includes('id="theme"'), true);
  assert.equal(css.includes(':root[data-theme="light"] {'), true);
  assert.equal(css.includes("@media (prefers-color-scheme: light)"), true);
  assert.equal(js.includes('const THEME_KEY = "devos.theme";'), true);
});

test("ui-page.test.mjs (g) the page shows the agent at work and ends a run with somewhere to go", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  for (const text of ['event.step === "activity"', '`/api/project', '"/api/quit"', "Start a new project", "Close DEV_OS", "Try again with this model", "A project in another folder"]) {
    assert.equal(js.includes(text), true, text);
  }
  assert.equal(css.includes(".now-pulse {"), true);
  assert.equal(css.includes("@keyframes now-pulse"), true);
  assert.equal(css.includes(".agent-now, .now-pulse { animation: none; }"), true);
});

test("ui-page.test.mjs (h) a new start offers the last choices, and a continued project shows its own", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of ["return withRemembered(draft, st.choices);", "app.draft = withChoices(app.draft, found.choices, found.folder);", 'readiness(blueprint.tool) === "ready"']) {
    assert.equal(js.includes(text), true, text);
  }
});
