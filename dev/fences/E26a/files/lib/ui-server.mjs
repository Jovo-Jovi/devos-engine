import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { loadCatalogue } from "./catalogue.mjs";
import { resumePoint, startedProject } from "./continue.mjs";
import { CONTRACT_VERSION, contractText } from "./contract.mjs";
import { doctorCommand } from "./doctor.mjs";
import { engineRoot, insideEngine } from "./engine.mjs";
import { cloneProject, hubState } from "./hub.mjs";
import { refuseInsideEngine, summaryLines } from "./init.mjs";
import { neededKeys } from "./keys.mjs";
import { changeMessage, modelsState, resetModel, setModel } from "./models.mjs";
import { ATTACH_MAX, attachmentAllowed, LIMITS, MIB, validatePlan } from "./plan.mjs";
import { detectAgents, MODEL_ID } from "./probes.mjs";
import { devosHome } from "./profile.mjs";
import { killPidTree } from "./spawn.mjs";

const BODY_LIMIT = 24 * 1024 * 1024;
// PR-60: one attachment per request (POST /api/file), so many full-quality images never share one body.
const FILE_LIMIT = Math.max(...Object.values(LIMITS));
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

const choicesFile = () => path.join(devosHome(), ".devos", "choices.json");
const text = (value) => (typeof value === "string" ? value : "");
const pickAgent = (item) => (item && typeof item === "object" ? { tool: text(item.tool), model: text(item.model) } : null);
const stringMap = (value) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
  .filter(([, item]) => typeof item === "string"));

/**
 * The page's choices for the next project, kept in ~/.devos/choices.json when a plan is accepted: the agents, the
 * blueprint agent, the type, stack, modules and scope, the languages, the visibility and the folder that holds
 * the projects. Never a key, and never the project's own text (name, brief, users).
 */
export function rememberChoices(plan, folder) {
  const agents = plan?.agents ?? {};
  const project = plan?.project ?? {};
  const fields = plan?.fields ?? {};
  const value = {
    $comment: "The choices of the last project started from devos ui, offered first next time. No key and no project text is kept here.",
    version: 1,
    agents: {
      reviewer: pickAgent(agents.reviewer),
      reviewer_light: pickAgent(agents.reviewer_light),
      pool: (Array.isArray(agents.pool) ? agents.pool : []).map((item) => ({ ...pickAgent(item), default: item?.default === true, note: text(item?.note) })),
      policy: text(agents.policy),
    },
    blueprint: pickAgent(plan?.blueprint),
    project: { type: text(project.type), stack: text(project.stack), modules: stringMap(project.modules), scope: text(project.scope) },
    fields: { languages: (Array.isArray(fields.languages) ? fields.languages : []).filter((item) => typeof item === "string"), visibility: text(fields.visibility) },
    parent: folder ? path.dirname(folder) : "",
  };
  try {
    mkdirSync(path.dirname(choicesFile()), { recursive: true });
    writeFileSync(choicesFile(), `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    /* the page starts from the defaults next time */
  }
}

export function readChoices() {
  try {
    const value = JSON.parse(readFileSync(choicesFile(), "utf8"));
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

/** The choices a started project saved in devos/answers.json, for the page to show while it continues (no key). */
export function savedChoices(folder) {
  try {
    const answers = JSON.parse(readFileSync(path.join(folder, "devos", "answers.json"), "utf8"));
    const agent = answers?.blueprint_agent;
    return {
      name: text(answers?.name),
      type: text(answers?.type),
      stack: text(answers?.stack),
      modules: stringMap(answers?.modules),
      scope: text(answers?.scope),
      languages: Array.isArray(answers?.languages) ? answers.languages.filter((item) => typeof item === "string") : [],
      visibility: text(answers?.visibility),
      blueprint: agent && typeof agent.tool === "string" && typeof agent.model === "string" ? { tool: agent.tool, model: agent.model } : null,
    };
  } catch {
    return null;
  }
}

function startedProjects(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(dir, entry.name);
    try {
      const project = resumePoint(folder);
      if (!project.started) continue;
      const mtime = statSync(path.join(folder, "devos", "answers.json")).mtimeMs;
      found.push({ name: entry.name, folder, approved: project.approved, step: project.step, mtime });
    } catch {
      /* a folder that cannot be read is not listed */
    }
  }
  found.sort((left, right) => right.mtime - left.mtime);
  return found.slice(0, 20).map(({ name, folder, approved, step }) => ({ name, folder, approved, step }));
}

function refuseChosenFolder(value) {
  if (typeof value !== "string" || value === "") return "Choose a folder for the project.";
  if (!path.isAbsolute(value)) return "The project folder must be a full path.";
  const resolved = path.resolve(value);
  if (insideEngine(resolved)) return "The project folder cannot be inside the engine's folder.";
  if (existsSync(resolved)) {
    let emptyDir = false;
    try {
      emptyDir = statSync(resolved).isDirectory() && readdirSync(resolved).length === 0;
    } catch {
      emptyDir = false;
    }
    if (!emptyDir) return "That folder already has files. Choose a new folder.";
  }
  return null;
}

/** A message from lib/models.mjs as a sentence for the page. */
function sentence(text) {
  const value = String(text ?? "");
  const first = value.charAt(0).toUpperCase() + value.slice(1);
  return first.endsWith(".") ? first : `${first}.`;
}

// The agent's live steps are replayed to a page that connects late, up to this many.
const ACTIVITY_KEPT = 40;

export function startUiServer({ folder, port = 0, token = randomBytes(24).toString("base64url"), env, onQuit } = {}) {
  const chooseMode = !(typeof folder === "string" && folder !== "");
  let root = chooseMode ? null : path.resolve(folder);
  // E25b, E26a: the started project the page reads or changes (the same folder rules as GET /api/project).
  const projectTarget = (asked) => {
    let target = root;
    if (chooseMode) {
      if (!path.isAbsolute(asked)) return { error: "The project folder must be a full path." };
      target = path.resolve(asked);
      if (insideEngine(target)) return { error: "The project folder cannot be inside the engine's folder." };
    }
    if (target === null || !startedProject(target).started) return { error: "That folder holds no started DEV_OS project." };
    return { folder: target };
  };
  const events = [];
  const subscribers = new Set();
  let tempDir = null;
  let held = null;
  let child = null;
  let buffer = "";
  let stderrBuffer = "";
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
    if (event.type === "step" && event.step === "activity") {
      const kept = events.filter((item) => item.type === "step" && item.step === "activity");
      if (kept.length > ACTIVITY_KEPT) events.splice(events.indexOf(kept[0]), 1);
    }
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

  function onChildError(chunk) {
    stderrBuffer += chunk;
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop();
    for (const line of lines) {
      const text = line.replace(/\r$/, "");
      if (text !== "") emit({ type: "log", text });
    }
  }

  function runDevos(args) {
    stopping = false;
    finished = false;
    buffer = "";
    stderrBuffer = "";
    const proc = spawn(process.execPath, [path.join(engineRoot(), "bin", "devos.mjs"), ...args], {
      env: { ...(env ?? process.env), DEVOS_UI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child = proc;
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", onChildData);
    proc.stderr.on("data", onChildError);
    proc.on("close", () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (child === proc) {
        if (buffer !== "") takeLine(buffer.replace(/\r$/, ""));
        buffer = "";
        if (stderrBuffer !== "") {
          const text = stderrBuffer.replace(/\r$/, "");
          if (text !== "") emit({ type: "log", text });
        }
        stderrBuffer = "";
        child = null;
      }
      if (stopping) emit({ type: "done", code: 130 });
      else if (!finished) emit({ type: "done", code: 1 });
    });
  }

  // The plan's own copies; files sent with POST /api/file wait in uploads/ until a plan names them.
  function clearTempFiles() {
    const dir = ensureTemp();
    for (const entry of readdirSync(dir)) if (entry !== "uploads") rmSync(path.join(dir, entry), { recursive: true, force: true });
  }

  function uploadsDir() {
    const dir = path.join(ensureTemp(), "uploads");
    mkdirSync(dir, { recursive: true });
    return dir;
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
        empty: root === null ? true : folderEmpty(root),
        choose: chooseMode,
        suggest: chooseMode ? path.join(homedir(), "devos-projects") : null,
        started: root === null ? false : startedProject(root).started,
        projects: chooseMode ? startedProjects(path.join(homedir(), "devos-projects")) : [],
        choices: readChoices(),
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
    // A lookup, not a change: a folder that holds no project is an answer (ok: false), not an HTTP error.
    if (req.method === "GET" && url.pathname === "/api/project") {
      const asked = url.searchParams.get("folder") ?? "";
      let target = root;
      if (chooseMode) {
        if (!path.isAbsolute(asked)) {
          send(res, 200, { ok: false, errors: ["The project folder must be a full path."] }, "application/json; charset=utf-8");
          return;
        }
        target = path.resolve(asked);
        if (insideEngine(target)) {
          send(res, 200, { ok: false, errors: ["The project folder cannot be inside the engine's folder."] }, "application/json; charset=utf-8");
          return;
        }
      }
      const point = target ? resumePoint(target) : { started: false, approved: false, step: "" };
      if (!point.started) {
        send(res, 200, { ok: false, errors: ["That folder holds no started DEV_OS project."] }, "application/json; charset=utf-8");
        return;
      }
      send(res, 200, { ok: true, folder: target, name: path.basename(target), ...point, choices: savedChoices(target) }, "application/json; charset=utf-8");
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
    if (req.method === "POST" && url.pathname === "/api/file") {
      const name = String(req.headers["x-devos-name"] ?? "");
      if (!plainFileName(name)) {
        send(res, 400, { ok: false, errors: ["An attachment name must be a plain file name."] }, "application/json; charset=utf-8");
        return;
      }
      if (!attachmentAllowed(name, raw.length)) {
        send(res, 400, { ok: false, errors: [`${name} is not an attachment this engine accepts (type or size).`] }, "application/json; charset=utf-8");
        return;
      }
      writeFileSync(path.join(uploadsDir(), name), raw);
      send(res, 200, { ok: true, name, size: raw.length }, "application/json; charset=utf-8");
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
      let chosenFolder = null;
      if (chooseMode) {
        const sentence = refuseChosenFolder(payload.folder);
        if (sentence) {
          send(res, 400, { ok: false, errors: [sentence] }, "application/json; charset=utf-8");
          return;
        }
        chosenFolder = path.resolve(payload.folder);
      }
      delete payload.folder;
      const listed = Array.isArray(payload.attachments) ? payload.attachments : [];
      if (listed.length > ATTACH_MAX) {
        send(res, 400, { ok: false, errors: [`A plan can hold at most ${ATTACH_MAX} attachments.`] }, "application/json; charset=utf-8");
        return;
      }
      const errors = [];
      const files = [];
      const uploads = uploadsDir();
      for (const item of listed) {
        if (!plainFileName(item?.name)) {
          errors.push("An attachment name must be a plain file name.");
          continue;
        }
        if (typeof item.base64 !== "string") {
          // Sent before with POST /api/file.
          const sent = path.join(uploads, item.name);
          if (existsSync(sent)) files.push({ name: item.name, path: sent });
          else errors.push(`${item.name} was not uploaded; add it again.`);
          continue;
        }
        const bytes = Buffer.from(item.base64, "base64");
        if (bytes.length > FILE_LIMIT) errors.push(`${item.name} is larger than ${FILE_LIMIT / MIB} MiB.`);
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
        if (file.path) {
          paths.push(file.path);
          continue;
        }
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
      if (chosenFolder) root = chosenFolder;
      held = { plan, validated };
      rememberChoices(plan, root);
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
      const planFile = path.join(ensureTemp(), "plan.json");
      writeFileSync(planFile, `${JSON.stringify(held.plan)}\n`);
      runDevos(["init", "--plan", planFile, root]);
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
    if (req.method === "POST" && url.pathname === "/api/continue") {
      if (child) {
        send(res, 409, { error: "state" }, "application/json; charset=utf-8");
        return;
      }
      let payload = {};
      if (raw.length > 0) {
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          send(res, 400, { ok: false, errors: ["The request is not JSON."] }, "application/json; charset=utf-8");
          return;
        }
        if (!plainJson(payload)) {
          send(res, 400, { ok: false, errors: ["The request is not a JSON object."] }, "application/json; charset=utf-8");
          return;
        }
      }
      let target = root;
      if (chooseMode && typeof payload.folder === "string" && payload.folder !== "") {
        if (!path.isAbsolute(payload.folder)) {
          send(res, 400, { ok: false, errors: ["The project folder must be a full path."] }, "application/json; charset=utf-8");
          return;
        }
        const resolved = path.resolve(payload.folder);
        if (insideEngine(resolved)) {
          send(res, 400, { ok: false, errors: ["The project folder cannot be inside the engine's folder."] }, "application/json; charset=utf-8");
          return;
        }
        target = resolved;
      }
      if (target === null || !startedProject(target).started) {
        send(res, 400, { ok: false, errors: ["That folder holds no started DEV_OS project."] }, "application/json; charset=utf-8");
        return;
      }
      if (payload.blueprint !== undefined) {
        const chosen = plainJson(payload.blueprint) ? payload.blueprint : {};
        const agent = detectAgents().find((item) => item.toolId === chosen.tool);
        const errors = [];
        if (!agent || agent.status !== "installed" || agent.signedIn !== true) errors.push("The blueprint tool is not signed in on this computer.");
        if (typeof chosen.model !== "string" || !MODEL_ID.test(chosen.model)) {
          errors.push(`The blueprint agent model "${String(chosen.model ?? "")}" is not a model id. Pick one from the list the tool reports.`);
        }
        if (errors.length > 0) {
          send(res, 400, { ok: false, errors }, "application/json; charset=utf-8");
          return;
        }
        const answersFile = path.join(target, "devos", "answers.json");
        const answers = JSON.parse(readFileSync(answersFile, "utf8"));
        answers.blueprint_agent = { tool: chosen.tool, model: chosen.model };
        writeFileSync(answersFile, `${JSON.stringify(answers, null, 2)}\n`);
      }
      root = target;
      events.length = 0;
      unanswered = null;
      held = null;
      runDevos(["continue", target]);
      send(res, 202, undefined);
      return;
    }
    // E25b (PR-63): a started project's models, and the repository variable that changes each one. gh only: nothing is
    // committed and no key is read. Refused while a run is going, which may be using gh itself.
    if (url.pathname === "/api/models" && (req.method === "GET" || req.method === "POST")) {
      const json = "application/json; charset=utf-8";
      if (child) {
        send(res, 409, { ok: false, errors: ["A run is going. Change the models after it ends."] }, json);
        return;
      }
      let payload = {};
      if (req.method === "POST") {
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch {
          send(res, 400, { ok: false, errors: ["The request is not JSON."] }, json);
          return;
        }
        if (!plainJson(payload)) {
          send(res, 400, { ok: false, errors: ["The request is not a JSON object."] }, json);
          return;
        }
      }
      const asked = req.method === "GET" ? (url.searchParams.get("folder") ?? "") : (typeof payload.folder === "string" ? payload.folder : "");
      const target = projectTarget(asked);
      if (target.error) {
        send(res, req.method === "GET" ? 200 : 400, { ok: false, errors: [target.error] }, json);
        return;
      }
      if (req.method === "GET") {
        const state = modelsState(target.folder);
        send(res, 200, state.ok ? { ok: true, slug: state.slug, roles: state.roles } : { ok: false, errors: [sentence(state.error)] }, json);
        return;
      }
      let result;
      if (payload.model === null) result = resetModel(target.folder, payload.role);
      else if (typeof payload.model === "string") result = setModel(target.folder, payload.role, payload.model);
      else result = { ok: false, error: "send a model id, or null to go back to the configured model" };
      send(res, result.ok ? 200 : 400, result.ok ? { ok: true, message: sentence(changeMessage(result)) } : { ok: false, errors: [sentence(result.error)] }, json);
      return;
    }
    // E26a: a current project's page. GET /api/hub reads its status (its folder, git and gh, read only);
    // POST /api/clone brings a DEV_OS project from GitHub into ~/devos-projects. Both are refused while a run is going.
    if ((req.method === "GET" && url.pathname === "/api/hub") || (req.method === "POST" && url.pathname === "/api/clone")) {
      const json = "application/json; charset=utf-8";
      if (child) {
        send(res, 409, { ok: false, errors: ["A run is going. Open the project after it ends."] }, json);
        return;
      }
      if (req.method === "GET") {
        const target = projectTarget(url.searchParams.get("folder") ?? "");
        if (target.error) {
          send(res, 200, { ok: false, errors: [target.error] }, json);
          return;
        }
        const state = hubState(target.folder);
        send(res, 200, state.ok ? state : { ok: false, errors: [state.error] }, json);
        return;
      }
      if (!chooseMode) {
        send(res, 400, { ok: false, errors: ["This page was opened for one folder. Run devos ui without a folder to bring a project from GitHub."] }, json);
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        send(res, 400, { ok: false, errors: ["The request is not JSON."] }, json);
        return;
      }
      if (!plainJson(payload) || typeof payload.url !== "string") {
        send(res, 400, { ok: false, errors: ["Send the repository's GitHub address."] }, json);
        return;
      }
      const cloned = cloneProject(payload.url, path.join(homedir(), "devos-projects"));
      send(res, cloned.ok ? 200 : 400, cloned.ok ? { ok: true, slug: cloned.slug, folder: cloned.folder, reused: cloned.reused } : { ok: false, errors: [cloned.error] }, json);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/quit") {
      send(res, 204, undefined);
      setImmediate(() => {
        quit().catch(() => {});
      });
      return;
    }
    send(res, 404, { error: "not found" }, "application/json; charset=utf-8");
    } catch {
      if (!res.headersSent) send(res, 500, { error: "internal" }, "application/json; charset=utf-8");
      else res.destroy();
    }
  });

  let closing = null;
  // Stop the run, end every stream, close the server; then onQuit when the page asked for it.
  function quit(fromPage = true) {
    if (!closing) {
      closing = (async () => {
        const proc = child;
        if (proc) stopChild();
        if (proc) await waitClosed(proc);
        for (const subscriber of subscribers) subscriber.end();
        subscribers.clear();
        server.closeAllConnections?.();
        await new Promise((done) => server.close(done));
        removeTemp();
      })();
    }
    return closing.then(() => {
      if (fromPage && typeof onQuit === "function") onQuit();
    });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const bound = server.address().port;
      resolve({
        url: `http://127.0.0.1:${bound}/?t=${token}`,
        port: bound,
        token,
        close: () => quit(false),
      });
    });
  });
}

export async function uiCommand(args) {
  const noOpen = args.includes("--no-open");
  const named = args.find((arg) => arg !== "--no-open");
  const folder = named ? path.resolve(named) : null;
  if (folder && refuseInsideEngine(folder)) return 1;
  let finish = () => {};
  const started = await startUiServer({ folder, onQuit: () => finish() });
  console.log(`DEV_OS setup: ${started.url}`);
  console.log("Keep this window open until the setup is done. Ctrl+C stops it.");
  if (!noOpen) openUrl(started.url);
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      started.close().then(() => resolve(0));
    };
    finish = () => {
      process.off("SIGINT", stop);
      console.log("DEV_OS closed from the page.");
      resolve(0);
    };
    process.on("SIGINT", stop);
  });
}
