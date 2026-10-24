import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { engineRoot } from "../lib/engine.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, flow, init, processGone, stage } from "./harness.mjs";

const here = fileURLToPath(import.meta.url);
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'";

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
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function planFrom(staged) {
  const result = init(staged, flow());
  if (result.status !== 0) throw new Error(`terminal init failed ${result.status}`);
  const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
  const agents = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8")).agents;
  return {
    accepted: true,
    contract_version: CONTRACT_VERSION,
    agents,
    blueprint: answers.blueprint_agent,
    project: { type: answers.type, stack: answers.stack, modules: answers.modules, scope: answers.scope },
    fields: {
      name: answers.name,
      brief: answers.brief,
      users: answers.users,
      languages: answers.languages,
      visibility: answers.visibility,
    },
    attachments: [],
  };
}

async function readEvents(port, token, onAsk) {
  const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
    headers: { "X-DEVOS-Token": token },
    signal: AbortSignal.timeout(120000),
  });
  assertSecurity(response.headers);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const seen = [];
  while (seen.every((event) => event.type !== "done")) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    if (done && buf !== "") buf += "\n\n";
    const parts = buf.split("\n\n");
    buf = done ? "" : parts.pop();
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice("data: ".length));
      seen.push(event);
      if (event.type === "ask" && onAsk) {
        const stop = await onAsk(event);
        if (stop === "stop") {
          await reader.cancel();
          return seen;
        }
      }
      if (event.type === "done") {
        await reader.cancel();
        return seen;
      }
    }
    if (done) break;
  }
  throw new Error(`events ended early: ${seen.map((event) => event.type || event.kind || event.step).join(",")}`);
}

async function workerL() {
  const terminal = stage();
  const planned = stage();
  Object.assign(process.env, planned.env);
  const captured = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => {
    captured.push(String(chunk));
    return stdout(chunk, encoding, callback);
  };
  process.stderr.write = (chunk, encoding, callback) => {
    captured.push(String(chunk));
    return stderr(chunk, encoding, callback);
  };
  let server;
  try {
    const plan = planFrom(terminal);
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const events = await readEvents(server.port, server.token, async (event) => {
      let value = "";
      if (event.kind === "approve") value = "approve";
      else if (event.kind === "key") value = `kv-${event.name}-123`;
      else if (event.kind === "create") value = "yes";
      else return;
      const answer = await fetch(`${origin}/api/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: event.kind, value }),
      });
      value = "";
      if (answer.status !== 204) throw new Error(`${event.kind} was not accepted`);
    });
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 0) throw new Error(`run did not finish ${done ? done.code : "none"}`);
    if (!events.some((event) => event.type === "ask" && event.kind === "approve")) throw new Error("approve was not asked");
    if (JSON.stringify(events).includes("kv-") || captured.join("").includes("kv-")) throw new Error("a key value was written");
    const lengths = readFileSync(planned.env.DEVOS_GH_LOG, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("secret-stdin "))
      .map((line) => Number(line.slice("secret-stdin ".length)));
    const expected = events
      .filter((event) => event.type === "ask" && event.kind === "key")
      .map((event) => Buffer.byteLength(`kv-${event.name}-123`));
    if (expected.length === 0 || lengths.length !== expected.length || lengths.some((length, index) => length !== expected[index])) {
      throw new Error("secret length mismatch");
    }
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
}

async function workerN() {
  const staged = stage();
  Object.assign(process.env, staged.env);
  const folder = path.join(staged.parent, "ui");
  let server;
  try {
    const plan = planFrom(staged);
    server = await startUiServer({ folder, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    let status = 0;
    await readEvents(server.port, server.token, async (event) => {
      if (event.kind !== "approve" || status !== 0) return;
      const answer = await fetch(`${origin}/api/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "create", value: "yes" }),
      });
      status = answer.status;
      return "stop";
    });
    if (status !== 409) throw new Error("create was not refused");
  } finally {
    if (server) await server.close();
    cleanup(staged.parent);
  }
}

async function workerM() {
  const terminal = stage();
  const planned = stage({ mode: "hang" });
  Object.assign(process.env, planned.env);
  let server;
  try {
    const plan = planFrom(terminal);
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const pidFile = path.join(planned.parent, "model.pid");
    const startedAt = Date.now();
    let pid = 0;
    while (Date.now() - startedAt < 30000) {
      try {
        pid = Number(readFileSync(pidFile, "utf8"));
        if (pid > 0) break;
      } catch {
        /* the model has not written its pid yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!pid) throw new Error("the model did not start");
    const mark = Date.now();
    const stopped = await fetch(`${origin}/api/stop`, { method: "POST", headers });
    if (stopped.status !== 204) throw new Error("stop was not accepted");
    const events = await readEvents(server.port, server.token);
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 130) throw new Error("stop did not finish");
    if (!(await processGone(pid, 5000))) throw new Error("the model was still running");
    if (Date.now() - mark > 5000) throw new Error("stop took longer than 5s");
  } finally {
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
}

function treeHas(dir, marker) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (treeHas(abs, marker)) return true;
    } else {
      try {
        if (readFileSync(abs).includes(marker)) return true;
      } catch {
        /* an unreadable file holds no answer */
      }
    }
  }
  return false;
}

async function workerO() {
  const terminal = stage();
  const planned = stage({ mode: "omit-questions" });
  Object.assign(process.env, planned.env);
  let server;
  try {
    const plan = planFrom(terminal);
    const note = Buffer.from("A note.\n").toString("base64");
    const body = { ...plan, attachments: [{ name: "notes.md", base64: note }] };
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const early = await fetch(`${origin}/api/stop`, { method: "POST", headers });
    if (early.status !== 409 || (await early.json()).error !== "state") throw new Error("an idle stop was accepted");
    const empty = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: "null" });
    const emptyBody = await empty.json();
    if (empty.status !== 400 || !emptyBody.errors?.includes("The plan is not a JSON object.")) throw new Error("null was accepted");
    const state = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
    if (state.status !== 200) throw new Error("the server stopped");
    await state.arrayBuffer();
    const oversized = await fetch(`${origin}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: Buffer.alloc(24 * 1024 * 1024 + 1),
    });
    if (oversized.status !== 401) throw new Error("an unsigned body was not refused");
    await oversized.arrayBuffer();
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(body) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    await posted.arrayBuffer();
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const events = await readEvents(server.port, server.token, async (event) => {
      if (event.kind !== "approve") return;
      const stopped = await fetch(`${origin}/api/stop`, { method: "POST", headers });
      if (stopped.status !== 204) throw new Error("stop was not accepted");
    });
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 130) throw new Error("stop did not finish");
    const again = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(body) });
    if (again.status !== 200) throw new Error("the next plan was not accepted");
    await again.arrayBuffer();
    const replayControl = new AbortController();
    const replayTimer = setTimeout(() => replayControl.abort(), 1000);
    let text = "";
    try {
      const replay = await fetch(`${origin}/api/events`, {
        headers: { "X-DEVOS-Token": server.token },
        signal: replayControl.signal,
      });
      const reader = replay.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("utf8");
      }
    } catch (error) {
      if (!error || error.name !== "AbortError") throw error;
    }
    clearTimeout(replayTimer);
    if (text.includes("data:")) throw new Error("events were replayed");
    const late = await fetch(`${origin}/api/stop`, { method: "POST", headers });
    if (late.status !== 409) throw new Error("a second idle stop was accepted");
  } finally {
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
}

async function workerP() {
  const scan = mkdtempSync(path.join(tmpdir(), "devos-scan-"));
  process.env.TMPDIR = scan;
  process.env.TEMP = scan;
  process.env.TMP = scan;
  const terminal = stage();
  const planned = stage();
  Object.assign(process.env, planned.env);
  process.env.TMPDIR = scan;
  process.env.TEMP = scan;
  process.env.TMP = scan;
  const marker = `fv-${randomBytes(8).toString("hex")}`;
  const json = `{"type":"service_account","private_key":"${marker}"}`;
  const encoded = Buffer.from(json).toString("base64");
  const captured = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => {
    captured.push(String(chunk));
    return stdout(chunk, encoding, callback);
  };
  process.stderr.write = (chunk, encoding, callback) => {
    captured.push(String(chunk));
    return stderr(chunk, encoding, callback);
  };
  let server;
  try {
    const plan = planFrom(terminal);
    plan.project.modules = { ...plan.project.modules, database: "firebase" };
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    await posted.arrayBuffer();
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const events = await readEvents(server.port, server.token, async (event) => {
      let value = "";
      if (event.kind === "approve") value = "approve";
      else if (event.kind === "key" && event.name === "FIREBASE_PROJECT_ID") value = "";
      else if (event.kind === "key" && event.name === "FIREBASE_DEPLOY_SERVICE_ACCOUNT") value = encoded;
      else if (event.kind === "key") value = "";
      else if (event.kind === "create") {
        if (treeHas(scan, marker) || treeHas(planned.project, marker) || treeHas(planned.parent, marker)) {
          throw new Error("a key was written");
        }
        value = "yes";
      } else return;
      const answer = await fetch(`${origin}/api/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: event.kind, value }),
      });
      value = "";
      if (answer.status !== 204) throw new Error(`${event.kind} was not accepted`);
    });
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 0) throw new Error(`run did not finish ${done ? done.code : "none"}`);
    if (JSON.stringify(events).includes(marker) || captured.join("").includes(marker)) throw new Error("a key value was written");
    const lengths = readFileSync(planned.env.DEVOS_GH_LOG, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("secret-stdin "))
      .map((line) => Number(line.slice("secret-stdin ".length)));
    const size = Buffer.byteLength(json);
    if (!lengths.includes(size)) throw new Error("secret length mismatch");
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
    cleanup(scan);
  }
}

async function workerQ() {
  const terminal = stage();
  const planned = stage();
  Object.assign(process.env, planned.env);
  let server;
  try {
    const plan = planFrom(terminal);
    plan.project.modules = { ...plan.project.modules, database: "firebase" };
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (posted.status !== 200) throw new Error("plan was not accepted");
    await posted.arrayBuffer();
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const rounds = [];
    let firstKey = true;
    const answer = async (kind, value) => {
      const response = await fetch(`${origin}/api/answer`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind, value }),
      });
      const errors = response.status === 204 ? [] : (await response.json()).errors;
      return { status: response.status, errors };
    };
    const events = await readEvents(server.port, server.token, async (event) => {
      if (event.kind === "approve") {
        rounds.push(event.round);
        if (event.round === 1) {
          const blank = await answer("approve", "  \n ");
          if (blank.status !== 400 || !blank.errors?.includes("Type approve, or describe the changes.")) throw new Error("a blank approve was accepted");
          const change = await answer("approve", "split phase 2\n\ninto two");
          if (change.status !== 204) throw new Error("the change was not accepted");
        } else {
          const approved = await answer("approve", "approve");
          if (approved.status !== 204) throw new Error("approve was not accepted");
        }
      } else if (event.kind === "key") {
        if (firstKey) {
          firstKey = false;
          const broken = await answer("key", "kv-a\nkv-b");
          if (broken.status !== 400 || !broken.errors?.includes("An answer must be one line.")) throw new Error("a two-line key was accepted");
        }
        const skipped = await answer("key", "");
        if (skipped.status !== 204) throw new Error("a skipped key was not accepted");
      } else if (event.kind === "create") {
        const maybe = await answer("create", "maybe");
        if (maybe.status !== 400 || !maybe.errors?.includes("Answer yes or no.")) throw new Error("maybe was accepted");
        const declined = await answer("create", "no");
        if (declined.status !== 204) throw new Error("no was not accepted");
      }
    });
    if (rounds.length !== 2 || rounds[0] !== 1 || rounds[1] !== 2) throw new Error("the approve rounds were wrong");
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 0) throw new Error("run did not finish");
    if (!events.some((event) => event.type === "log" && String(event.text).includes("nothing was created"))) throw new Error("the stop line was missing");
    const mark = Date.now();
    const replay = await fetch(`${origin}/api/events`, { headers: { "X-DEVOS-Token": server.token } });
    const reader = replay.body.getReader();
    let text = "";
    while (true) {
      const next = await reader.read();
      if (next.value) text += Buffer.from(next.value).toString("utf8");
      if (next.done) break;
    }
    if (Date.now() - mark > 2000) throw new Error("the replay did not end");
    if (!text.includes("data:")) throw new Error("the replay was empty");
    const state = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
    const body = await state.json();
    if (state.status !== 200 || body.run !== "finished") throw new Error("the run was not finished");
  } finally {
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
}

async function workerS() {
  const terminal = stage();
  const planned = stage();
  Object.assign(process.env, planned.env);
  let server;
  try {
    const plan = planFrom(terminal);
    server = await startUiServer({ folder: null, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const state = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
    const body = await state.json();
    if (state.status !== 200 || body.folder !== null || body.choose !== true) throw new Error("choose mode was not announced");
    if (typeof body.suggest !== "string" || !path.isAbsolute(body.suggest) || path.basename(body.suggest) !== "devos-projects") {
      throw new Error("suggest was wrong");
    }
    const refusals = [
      [plan, "Choose a folder for the project."],
      [{ ...plan, folder: "relative/app" }, "The project folder must be a full path."],
      [{ ...plan, folder: path.join(engineRoot(), "inside-app") }, "The project folder cannot be inside the engine's folder."],
      [{ ...plan, folder: terminal.project }, "That folder already has files. Choose a new folder."],
    ];
    for (const [payload, sentence] of refusals) {
      const response = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(payload) });
      const json = await response.json();
      if (response.status !== 400 || !json.errors?.includes(sentence)) throw new Error(`expected ${sentence}`);
    }
    const still = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
    const stillBody = await still.json();
    if (stillBody.folder !== null) throw new Error("a refused plan chose a folder");
    const chosen = path.resolve(planned.parent, "chosen", "my-app");
    const posted = await fetch(`${origin}/api/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...plan, folder: chosen }),
    });
    if (posted.status !== 200) throw new Error(`the chosen folder was not accepted ${posted.status}`);
    await posted.arrayBuffer();
    const next = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
    const nextBody = await next.json();
    if (next.status !== 200 || nextBody.folder !== chosen) throw new Error("the folder was not kept");
    const started = await fetch(`${origin}/api/start`, { method: "POST", headers });
    if (started.status !== 202) throw new Error("start was not accepted");
    const events = await readEvents(server.port, server.token, async (event) => {
      if (event.kind !== "approve") return;
      if (!existsSync(path.join(chosen, "devos", "project.json"))) throw new Error("project.json was not written");
      const stopped = await fetch(`${origin}/api/stop`, { method: "POST", headers });
      if (stopped.status !== 204) throw new Error("stop was not accepted");
    });
    const done = events.find((event) => event.type === "done");
    if (!done || done.code !== 130) throw new Error("stop did not finish");
  } finally {
    if (server) await server.close();
    cleanup(terminal.parent);
    cleanup(planned.parent);
  }
}

const workers = { l: workerL, n: workerN, m: workerM, o: workerO, p: workerP, q: workerQ, s: workerS };
const workerName = process.env.DEVOS_UI_WORKER;
if (workers[workerName]) {
  workers[workerName]().then(() => process.exit(0)).catch((error) => {
    console.error(error && error.message ? error.message : "worker failed");
    process.exit(1);
  });
} else {
  test("ui-server.test.mjs (g) state requires the token", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const denied = await fetch(`${origin}/api/state`);
      assert.equal(denied.status, 401);
      assert.equal((await denied.json()).error, "token");
      assertSecurity(denied.headers);
      const allowed = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
      assert.equal(allowed.status, 200);
      assert.equal((await allowed.json()).contractVersion, CONTRACT_VERSION);
      assertSecurity(allowed.headers);
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });

  test("ui-server.test.mjs (h) a foreign host is refused", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const response = await httpCall({
        port: server.port,
        method: "GET",
        path: "/api/state",
        headers: { Host: "evil.example", "X-DEVOS-Token": server.token },
      });
      assert.equal(response.status, 403);
      assert.equal(JSON.parse(response.body).error, "host");
      assertSecurity(response.headers);
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });

  test("ui-server.test.mjs (i) a foreign origin is refused", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://evil.example",
          "X-DEVOS-Token": server.token,
        },
        body: "{}",
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, "origin");
      assertSecurity(response.headers);
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });

  test("ui-server.test.mjs (j) an oversized body and a path name are refused", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const headers = {
        "Content-Type": "application/json",
        Origin: origin,
        "X-DEVOS-Token": server.token,
      };
      const oversized = await fetch(`${origin}/api/plan`, {
        method: "POST",
        headers,
        body: Buffer.alloc(24 * 1024 * 1024 + 1),
      });
      assert.equal(oversized.status, 413);
      assertSecurity(oversized.headers);
      const named = await fetch(`${origin}/api/plan`, {
        method: "POST",
        headers,
        body: JSON.stringify({ attachments: [{ name: "../x", base64: "" }] }),
      });
      assert.equal(named.status, 400);
      assertSecurity(named.headers);
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });

  test("ui-server.test.mjs (k) responses carry the security headers", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const denied = await fetch(`${origin}/api/state`);
      const allowed = await fetch(`${origin}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
      const foreign = await httpCall({
        port: server.port,
        method: "GET",
        path: "/api/state",
        headers: { Host: "evil.example", "X-DEVOS-Token": server.token },
      });
      const originDenied = await fetch(`${origin}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.example", "X-DEVOS-Token": server.token },
        body: "{}",
      });
      const named = await fetch(`${origin}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token },
        body: JSON.stringify({ attachments: [{ name: "../x", base64: "" }] }),
      });
      assertSecurity(denied.headers);
      assertSecurity(allowed.headers);
      assertSecurity(foreign.headers);
      assertSecurity(originDenied.headers);
      assertSecurity(named.headers);
      await denied.arrayBuffer();
      await allowed.arrayBuffer();
      await originDenied.arrayBuffer();
      await named.arrayBuffer();
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });

  function runWorker(name) {
    return spawnSync(process.execPath, [here], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      env: { ...process.env, DEVOS_UI_WORKER: name },
    });
  }

  test("ui-server.test.mjs (l) a full run uploads keys without echoing them", { timeout: 180000 }, () => {
    const result = runWorker("l");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(`${result.stdout}${result.stderr}`.includes("kv-"), false);
  });

  test("ui-server.test.mjs (m) stop ends a hung model", { timeout: 180000, skip: process.platform === "win32" ? "process signals differ on Windows" : false }, () => {
    const result = runWorker("m");
    assert.equal(result.status, 0, result.stderr);
  });

  test("ui-server.test.mjs (n) an answer for the wrong ask is refused", { timeout: 180000 }, () => {
    const result = runWorker("n");
    assert.equal(result.status, 0, result.stderr);
  });

  test("ui-server.test.mjs (o) a finished run can take another plan", { timeout: 180000 }, () => {
    const result = runWorker("o");
    assert.equal(result.status, 0, result.stderr);
  });

  test("ui-server.test.mjs (p) a file key is not written to disk", { timeout: 180000 }, () => {
    const result = runWorker("p");
    const leaked = `${result.stdout}${result.stderr}`.includes("fv-");
    assert.equal(result.status, 0, leaked ? "a key value was written" : result.stderr);
    assert.equal(leaked, false);
  });

  test("ui-server.test.mjs (q) an answer is one line and a finished stream ends", { timeout: 180000 }, () => {
    const result = runWorker("q");
    assert.equal(result.status, 0, result.stderr);
  });

  test("ui-server.test.mjs (s) a plan names the project folder", { timeout: 180000 }, () => {
    const result = runWorker("s");
    assert.equal(result.status, 0, result.stderr);
  });

  test("ui-server.test.mjs (r) state lists the tools before a plan", async () => {
    const staged = stage();
    const server = await startUiServer({ folder: staged.project, port: 0 });
    try {
      const toolFile = JSON.parse(readFileSync(path.join(path.dirname(here), "..", "lib", "data", "tools.json"), "utf8"));
      const response = await fetch(`http://127.0.0.1:${server.port}/api/state`, { headers: { "X-DEVOS-Token": server.token } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.run, "idle");
      assert.deepEqual(body.tools, toolFile.tools.map((tool) => ({ id: tool.id, label: tool.label, cycle: tool.cycle === true })));
      assert.equal(body.tools.length, 6);
      assert.deepEqual(body.strengths, toolFile.builderStrengths);
      assertSecurity(response.headers);
    } finally {
      await server.close();
      cleanup(staged.parent);
    }
  });
}
