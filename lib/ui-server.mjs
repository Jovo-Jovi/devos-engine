import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCatalogue } from "./catalogue.mjs";
import { CONTRACT_VERSION, contractText } from "./contract.mjs";
import { doctorCommand } from "./doctor.mjs";
import { engineRoot } from "./engine.mjs";
import { summaryLines } from "./init.mjs";
import { neededKeys } from "./keys.mjs";
import { validatePlan } from "./plan.mjs";
import { detectAgents } from "./probes.mjs";
import { devosHome } from "./profile.mjs";
import { killPidTree } from "./spawn.mjs";

const BODY_LIMIT = 24 * 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024;
const PAGES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/fonts/plex-sans-400.woff2", ["fonts/plex-sans-400.woff2", "font/woff2"]],
  ["/fonts/plex-sans-500.woff2", ["fonts/plex-sans-500.woff2", "font/woff2"]],
  ["/fonts/plex-sans-600.woff2", ["fonts/plex-sans-600.woff2", "font/woff2"]],
  ["/fonts/plex-serif-300.woff2", ["fonts/plex-serif-300.woff2", "font/woff2"]],
  ["/fonts/plex-mono-400.woff2", ["fonts/plex-mono-400.woff2", "font/woff2"]],
]);
const SECURITY = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

function sameToken(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => withoutSecrets(item));
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|token|password|credential/i.test(key)) continue;
    copy[key] = withoutSecrets(item);
  }
  return copy;
}

function profileVisibility() {
  try {
    const file = path.join(devosHome(), ".devos", "profile.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data && (data.visibility === "private" || data.visibility === "public")) return data.visibility;
  } catch {
    /* a missing or unreadable profile uses private */
  }
  return "private";
}

function folderEmpty(folder) {
  try {
    return readdirSync(folder).length === 0;
  } catch {
    return true;
  }
}

function plainFileName(name) {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 180
    && !name.includes("/")
    && !name.includes("\\")
    && !name.includes("..");
}

function send(res, status, body, type) {
  const headers = { ...SECURITY };
  if (type) headers["Content-Type"] = type;
  const payload = body === undefined ? null : (Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, headers);
  res.end(payload === null ? undefined : payload);
}

function openUrl(url) {
  const command = process.platform === "win32" ? "cmd" : (process.platform === "darwin" ? "open" : "xdg-open");
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function tempParent() {
  const named = process.env.TMPDIR || process.env.TEMP || process.env.TMP;
  if (typeof named === "string" && named !== "") return named;
  return tmpdir();
}

function plainJson(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function startUiServer({ folder, port = 0, token = randomBytes(24).toString("base64url"), env } = {}) {
  const root = path.resolve(folder);
  const events = [];
  const subscribers = new Set();
  let tempDir = null;
  let held = null;
  let child = null;
  let buffer = "";
  let unanswered = null;
  let finished = false;
  let stopping = false;
  let killTimer = null;

  function ensureTemp() {
    if (tempDir) {
      try {
        readdirSync(tempDir);
        return tempDir;
      } catch {
        tempDir = null;
      }
    }
    tempDir = mkdtempSync(path.join(tempParent(), "devos-ui-"));
    try { chmodSync(tempDir, 0o700); } catch { /* Windows ignores the mode */ }
    return tempDir;
  }

  function removeTemp() {
    if (!tempDir) return;
    const dir = tempDir;
    tempDir = null;
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      tempDir = dir;
    }
  }

  function emit(event) {
    if (event.type === "done") {
      if (finished) return;
      finished = true;
      unanswered = null;
      removeTemp();
    }
    events.push(event);
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const subscriber of subscribers) subscriber.write(data);
    if (event.type === "done") {
      for (const subscriber of subscribers) subscriber.end();
      subscribers.clear();
    }
  }

  function stopChild() {
    const proc = child;
    const pid = proc?.pid;
    if (!pid) return;
    stopping = true;
    if (process.platform === "win32") {
      killPidTree(pid);
      return;
    }
    try { process.kill(pid, "SIGINT"); } catch { /* already gone */ }
    if (killTimer) clearTimeout(killTimer);
    killTimer = setTimeout(() => {
      killTimer = null;
      if (child && child.pid === pid) killPidTree(pid);
    }, 2000);
    if (typeof killTimer.unref === "function") killTimer.unref();
  }

  function waitClosed(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      if (typeof timer.unref === "function") timer.unref();
      proc.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function takeLine(line) {
    if (line.startsWith("::devos-ask ")) {
      try {
        const body = JSON.parse(line.slice("::devos-ask ".length));
        const event = { ...body, type: "ask" };
        unanswered = event;
        emit(event);
        return;
      } catch {
        /* a broken marker is a log line */
      }
    }
    if (line.startsWith("::devos-step ")) {
      try {
        const body = JSON.parse(line.slice("::devos-step ".length));
        if (body.step === "done") emit({ type: "done", code: body.code });
        else emit({ ...body, type: "step" });
        return;
      } catch {
        /* a broken marker is a log line */
      }
    }
    if (line !== "") emit({ type: "log", text: line });
  }

  function onChildData(chunk) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) takeLine(line.replace(/\r$/, ""));
  }

  function clearTempFiles() {
    const dir = ensureTemp();
    for (const entry of readdirSync(dir)) rmSync(path.join(dir, entry), { recursive: true, force: true });
  }

  const server = createServer(async (req, res) => {
    try {
    const address = server.address();
    const bound = typeof address === "object" && address ? address.port : port;
    const origin = `http://127.0.0.1:${bound}`;
    const url = new URL(req.url ?? "/", origin);
    if (req.headers.host !== `127.0.0.1:${bound}`) {
      req.resume();
      send(res, 403, { error: "host" }, "application/json; charset=utf-8");
      return;
    }
    if (req.method !== "GET" && req.headers.origin !== origin) {
      req.resume();
      send(res, 403, { error: "origin" }, "application/json; charset=utf-8");
      return;
    }
    if (url.pathname.startsWith("/api/") && !sameToken(req.headers["x-devos-token"], token)) {
      req.resume();
      send(res, 401, { error: "token" }, "application/json; charset=utf-8");
      return;
    }
    let raw = Buffer.alloc(0);
    if (req.method !== "GET" && req.method !== "HEAD") {
      const declared = req.headers["content-length"];
      if (declared !== undefined && Number(declared) > BODY_LIMIT) {
        req.resume();
        send(res, 413, { error: "size" }, "application/json; charset=utf-8");
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_LIMIT) {
          send(res, 413, { error: "size" }, "application/json; charset=utf-8");
          return;
        }
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks);
    }
    const page = PAGES.get(url.pathname);
    if (req.method === "GET" && page) {
      const [file, type] = page;
      send(res, 200, readFileSync(path.join(engineRoot(), "lib", "ui", file)), type);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      const catalogue = loadCatalogue();
      const defaults = JSON.parse(readFileSync(path.join(engineRoot(), "payload", "files", "devos", "engine.defaults.json"), "utf8")).agents;
      const toolFile = JSON.parse(readFileSync(path.join(engineRoot(), "lib", "data", "tools.json"), "utf8"));
      send(res, 200, {
        contract: contractText(),
        contractVersion: CONTRACT_VERSION,
        folder: root,
        empty: folderEmpty(root),
        doctor: { ok: doctorCommand() === 0 },
        agents: withoutSecrets(detectAgents()),
        catalogue: {
          types: catalogue.types,
          stacks: catalogue.stacks,
          modules: catalogue.modules,
          documents: catalogue.documents,
        },
        defaults,
        visibility: profileVisibility(),
        tools: toolFile.tools.map((tool) => ({ id: tool.id, label: tool.label, cycle: tool.cycle === true })),
        strengths: toolFile.builderStrengths,
        run: finished ? "finished" : (child ? "running" : "idle"),
      }, "application/json; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { ...SECURITY, "Content-Type": "text/event-stream; charset=utf-8", "Connection": "keep-alive" });
      for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (finished) {
        res.end();
        return;
      }
      subscribers.add(res);
      req.on("close", () => subscribers.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/plan") {
      if (child) {
        send(res, 409, { error: "state" }, "application/json; charset=utf-8");
        return;
      }
      if (finished) {
        events.length = 0;
        finished = false;
        unanswered = null;
        held = null;
      }
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        send(res, 400, { ok: false, errors: ["The plan is not JSON."] }, "application/json; charset=utf-8");
        return;
      }
      if (!plainJson(payload)) {
        send(res, 400, { ok: false, errors: ["The plan is not a JSON object."] }, "application/json; charset=utf-8");
        return;
      }
      const listed = Array.isArray(payload.attachments) ? payload.attachments : [];
      if (listed.length > 8) {
        send(res, 400, { ok: false, errors: ["A plan can hold at most 8 attachments."] }, "application/json; charset=utf-8");
        return;
      }
      const errors = [];
      const files = [];
      for (const item of listed) {
        if (!plainFileName(item?.name)) {
          errors.push("An attachment name must be a plain file name.");
          continue;
        }
        const bytes = Buffer.from(typeof item.base64 === "string" ? item.base64 : "", "base64");
        if (bytes.length > FILE_LIMIT) errors.push(`${item.name} is larger than 2 MiB.`);
        else files.push({ name: item.name, bytes });
      }
      if (errors.length > 0) {
        send(res, 400, { ok: false, errors }, "application/json; charset=utf-8");
        return;
      }
      clearTempFiles();
      const dir = ensureTemp();
      const paths = [];
      for (const file of files) {
        const dest = path.join(dir, file.name);
        writeFileSync(dest, file.bytes);
        paths.push(dest);
      }
      const plan = { ...payload, attachments: paths };
      const validated = validatePlan(plan, detectAgents());
      if (!validated.ok) {
        send(res, 400, { ok: false, errors: validated.errors }, "application/json; charset=utf-8");
        return;
      }
      held = { plan, validated };
      const setup = JSON.parse(readFileSync(path.join(engineRoot(), "payload", "files", "devos", "setup.json"), "utf8"));
      const keys = neededKeys(setup, validated.answers, validated.agents).map((key) => ({
        name: key.name,
        where: key.where,
        optional: Boolean(key.optional),
        file: Boolean(key.file),
      }));
      send(res, 200, {
        ok: true,
        summary: summaryLines(validated.agents, validated.answers, validated.attachments),
        keys,
      }, "application/json; charset=utf-8");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      if (!held || child) {
        send(res, 409, { error: "state" }, "application/json; charset=utf-8");
        return;
      }
      stopping = false;
      const planFile = path.join(ensureTemp(), "plan.json");
      writeFileSync(planFile, `${JSON.stringify(held.plan)}\n`);
      finished = false;
      buffer = "";
      const proc = spawn(process.execPath, [path.join(engineRoot(), "bin", "devos.mjs"), "init", "--plan", planFile, root], {
        env: { ...(env ?? process.env), DEVOS_UI: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child = proc;
      proc.stdout.setEncoding("utf8");
      proc.stderr.resume();
      proc.stdout.on("data", onChildData);
      proc.on("close", () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
        if (child === proc) {
          if (buffer !== "") takeLine(buffer.replace(/\r$/, ""));
          buffer = "";
          child = null;
        }
        if (stopping) emit({ type: "done", code: 130 });
        else if (!finished) emit({ type: "done", code: 1 });
      });
      send(res, 202, undefined);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/answer") {
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        send(res, 400, { ok: false, errors: ["The answer is not JSON."] }, "application/json; charset=utf-8");
        return;
      }
      if (!plainJson(payload)) {
        send(res, 400, { ok: false, errors: ["The answer is not a JSON object."] }, "application/json; charset=utf-8");
        return;
      }
      if (!child || !unanswered || payload.kind !== unanswered.kind) {
        send(res, 409, { error: "state" }, "application/json; charset=utf-8");
        return;
      }
      let value = typeof payload.value === "string" ? payload.value : "";
      payload.value = "";
      const refuse = (message) => {
        value = "";
        send(res, 400, { ok: false, errors: [message] }, "application/json; charset=utf-8");
      };
      if (unanswered.kind === "approve") {
        value = value.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line !== "").join(" ");
        if (value === "") {
          refuse("Type approve, or describe the changes.");
          return;
        }
      } else if (unanswered.kind === "key" || unanswered.kind === "create") {
        if (value.includes("\r") || value.includes("\n")) {
          refuse("An answer must be one line.");
          return;
        }
        if (unanswered.kind === "create" && value !== "yes" && value !== "no") {
          refuse("Answer yes or no.");
          return;
        }
      }
      if (unanswered.kind === "key" && unanswered.file === true) {
        if (value !== "") {
          let text = "";
          try {
            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("shape");
            text = Buffer.from(value, "base64").toString("utf8");
            JSON.parse(text);
          } catch {
            value = "";
            text = "";
            refuse("The file key is not base64 JSON.");
            return;
          }
          text = "";
          child.stdin.write(`base64:${value}\n`);
          value = "";
        } else {
          child.stdin.write("\n");
        }
      } else {
        child.stdin.write(`${value}\n`);
        value = "";
      }
      unanswered = null;
      send(res, 204, undefined);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stop") {
      if (!child) {
        send(res, 409, { error: "state" }, "application/json; charset=utf-8");
        return;
      }
      stopChild();
      send(res, 204, undefined);
      return;
    }
    send(res, 404, { error: "not found" }, "application/json; charset=utf-8");
    } catch {
      if (!res.headersSent) send(res, 500, { error: "internal" }, "application/json; charset=utf-8");
      else res.destroy();
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const bound = server.address().port;
      resolve({
        url: `http://127.0.0.1:${bound}/?t=${token}`,
        port: bound,
        token,
        close: async () => {
          const proc = child;
          if (proc) stopChild();
          if (proc) await waitClosed(proc);
          for (const subscriber of subscribers) subscriber.end();
          subscribers.clear();
          await new Promise((done) => server.close(done));
          removeTemp();
        },
      });
    });
  });
}

export async function uiCommand(args) {
  const noOpen = args.includes("--no-open");
  const folder = path.resolve(args.find((arg) => arg !== "--no-open") ?? process.cwd());
  const started = await startUiServer({ folder });
  console.log(`DEV_OS setup: ${started.url}`);
  if (!noOpen) openUrl(started.url);
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      started.close().then(() => resolve(0));
    };
    process.on("SIGINT", stop);
  });
}
