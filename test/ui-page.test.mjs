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

test("ui-page.test.mjs (i) the page offers an existing project, the adoption screens and the pull request link", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of [
    "Existing project",
    "SCREENS.adopt = () => {",
    "SCREENS.adopting = () => {",
    "\"/api/adopt/check\"",
    "\"/api/adopt/start\"",
    "adopt: true",
    "https:\\/\\/github\\.com\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+\\/pull\\/[0-9]+$",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});

test("ui-page.test.mjs (j) the first screen offers automated or local development, and the local path has its own steps", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of [
    "Automated development (GitHub)",
    "Local development (this computer)",
    "cycle: \"local\"",
    "{ id: \"backup\", group: \"github\", label: \"Backup\" }",
    "answer(\"backup\", \"yes\")",
    "Run devos doctor --local in a terminal",
    "Your project is set up on this computer",
    "app.draft.modules.hosting = \"none\"",
    "turns an empty folder into a project that AI agents build and review",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
});

test("ui-page.test.mjs (h) a new start offers the last choices, and a continued project shows its own", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  for (const text of ["return withRemembered(draft, st.choices);", "app.draft = withChoices(app.draft, found.choices, found.folder);", 'readiness(blueprint.tool) === "ready"']) {
    assert.equal(js.includes(text), true, text);
  }
});

test("ui-page.test.mjs (k) E71: an adoption has its own steps, one screen per question with every option, a Keys step, a finish screen and its whole output", () => {
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  for (const text of [
    "const ADOPT_STEPS = [",
    "const ADOPT_GROUPS = [[\"project\", \"Your project\"], [\"devos\", \"DEV_OS\"], [\"github\", \"GitHub\"]];",
    "if (adoptMode()) return ADOPT_STEPS;",
    "rail.append(adopting ? adoptBlock() : titleBlock());",
    "if (event.type === \"step\" && event.step === \"adopt\") {",
    "if (run.logs.length > (run.mode === \"adopt\" ? 5000 : 500)) run.logs.shift();",
    "if (ask.form === \"choice\" || ask.form === \"choices\") return adoptPick(ask, at, log);",
    "if (ask.form === \"brief\") return adoptBriefScreen(ask, log);",
    "if (ask.form === \"contract\") return adoptContract(ask, log);",
    "if (ask.form === \"confirm\") return adoptConfirm(ask, at, log);",
    "return answer(\"line\", picked.length ? picked.join(\", \") : \",\");",
    "\"Set these in Vercel yourself\"",
    "\"How adding DEV_OS works\"",
    "\"DEV_OS is ready on your project\"",
    "\"Open the project's page\"",
    "function adoptWorking(at, log) {",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
  // The adoption's output is never cut to its last lines.
  const log = js.slice(js.indexOf("function adoptLog("), js.indexOf("// A brief or the contract as headings"));
  assert.equal(log.includes("slice(-"), false);
  for (const rule of [".pick-list {", ".pick-item:has(input:checked) {", ".facts {", ".keyrow.is-now {", ".pr-card {", ".step-para {"]) {
    assert.equal(css.includes(rule), true, rule);
  }
});

test("ui-page.test.mjs (l) E72: the audit's fixes: the current project's own steps, keys and settings at the end, guides, the project's page and motion with a direction", () => {
  const html = readFileSync(path.join(ui, "index.html"), "utf8");
  const js = readFileSync(path.join(ui, "app.js"), "utf8");
  const css = readFileSync(path.join(ui, "app.css"), "utf8");
  assert.equal(html.includes('<nav class="rail" id="rail" aria-label="Setup steps" tabindex="0"></nav>'), true);
  for (const text of [
    "const CURRENT_STEPS = [",
    "if (currentMode()) return choosing() ? CURRENT_STEPS : CURRENT_STEPS.filter((step) => step.id !== \"current\");",
    "text = plain(text);",
    "function keyOverview(keys, now = \"\", given = {}) {",
    "return keyOverview(app.run.adopt?.keys?.keys, app.run.ask?.kind === \"key\" ? app.run.ask.name : \"\");",
    "function hostList(host) {",
    "if (event.step === \"keys\" && Array.isArray(event.keys)) run.keyPlan = { keys: event.keys, host: Array.isArray(event.host) ? event.host : [] };",
    "run.logs.some((line) => line.startsWith(\"devos: the cycle still needs settings\"))",
    "\"On GitHub, but the cycle needs settings\"",
    "\"How it works\"",
    "planSummary({ editable: true })",
    "function helpBox(title, paragraphs) {",
    "const BLUEPRINT_DOCS = [",
    "rules: \"What files work\"",
    "function publishCard(sum) {",
    "function cycleRows(data) {",
    "function repoLinks(data) {",
    "screen.classList.add(moved ? (app.dir === \"back\" ? \"is-back\" : \"is-fwd\") : \"is-still\");",
  ]) {
    assert.equal(js.includes(text), true, text);
  }
  // Precedent ids are dropped from what the page shows.
  const plainText = js.slice(js.indexOf("function plain(text) {"), js.indexOf("// Text with URLs and `code` spans"));
  const plain = new Function(`${plainText}\nreturn plain;`)();
  assert.deepEqual([
    plain("Optional second account (PR-29): its key as `CURSOR_API_KEY_2`."),
    plain("Nothing is generated until the variable is above 0 (PR-81)."),
    plain("a production build ({port} is replaced, PR-51)"),
    plain("A pull request (PR) stays as it is."),
  ], [
    "Optional second account: its key as `CURSOR_API_KEY_2`.",
    "Nothing is generated until the variable is above 0.",
    "a production build ({port} is replaced)",
    "A pull request (PR) stays as it is.",
  ]);
  for (const rule of [
    ".step-wide > .step-foot { max-width: 720px; }",
    ".rail:focus-visible, .log:focus-visible {",
    ".step.is-still, .step.is-still .fact, .step.is-still .keyrow { animation: none; }",
    "@keyframes arrive-back {",
    ".rail-step.is-fresh .rail-num path {",
    ".step.final:not(.is-still) .final-mark :is(circle, path) {",
    "details.disclose summary { display: block; width: fit-content; min-height: 24px;",
    ".check { display: flex; gap: 12px; align-items: flex-start; min-height: 28px;",
  ]) {
    assert.equal(css.includes(rule), true, rule);
  }
});
