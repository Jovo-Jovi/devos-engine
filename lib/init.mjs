import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { looksLikeCommandRejection, looksLikeModelRejection, looksLikePlanRestriction, looksLikeTrustGate, looksLikeUsageLimit } from "./adapters.mjs";
import { loadCatalogue, modulesFor, prepareFor, stacksFor, typeById } from "./catalogue.mjs";
import { CONTRACT_VERSION, contractText } from "./contract.mjs";
import { doctorCommand } from "./doctor.mjs";
import { engineRoot, insideEngine, normalizeLf, readManifest } from "./engine.mjs";
import { installInto, KEY_RE, keyFromName } from "./install.mjs";
import { confirm, lineReader, multiSelect, select, text } from "./menu.mjs";
import { streamEvent } from "./agent-stream.mjs";
import { cleanModelId, detectAgents } from "./probes.mjs";
import { devosHome } from "./profile.mjs";
import { ATTACH_MAX, attachmentAllowed, attachmentKind, buildAnswers, LIMITS, MIB, TOTAL_LIMIT, validatePlan } from "./plan.mjs";
import { checkRoster, loadRoster } from "./roster.mjs";
import { continueCommand } from "./continue.mjs";
import { heartbeat } from "./progress.mjs";
import { finishSetup } from "./setup.mjs";
import { killPidTree, spawnTool } from "./spawn.mjs";
import { run } from "./which.mjs";

const REQUIRED_DOCS = ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md"];
const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;
const BLUEPRINT_TOOLS = new Set(["claude", "cursor", "codex", "gemini"]);
const BLUEPRINT_INPUT = ".devos/blueprint-input.md";
export const BLUEPRINT_POINTER = "Read the file .devos/blueprint-input.md in this folder and do exactly what it says.";
const HELD = [".claude/settings.json", ".cursor/cli.json", ".cursor/hooks.json"];

function isEmptyFolder(folder) {
  if (!existsSync(folder)) return true;
  if (!statSync(folder).isDirectory()) return false;
  return readdirSync(folder).length === 0;
}

function profileVisibility() {
  try {
    const file = path.join(devosHome(), ".devos", "profile.json");
    if (!existsSync(file)) return "private";
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data && (data.visibility === "private" || data.visibility === "public")) return data.visibility;
  } catch {
    /* a missing or unreadable profile uses private */
  }
  return "private";
}

async function ask(read, prompt, question, accept) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    process.stdout.write(prompt);
    const line = await read();
    if (line === null) {
      console.log("devos: input ended before setup finished");
      return null;
    }
    const value = accept(line);
    if (value !== undefined) return value;
  }
  console.log(`devos: no valid answer for ${question}`);
  return undefined;
}

function failed(value) {
  return value === null || value === undefined;
}

function docsUnder(folder) {
  const docs = path.join(folder, "docs");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(folder, abs).split(path.sep).join("/");
      // The usage record (PR-52) is the runner's, not a document to approve.
      if (rel === "docs/usage" || rel === "docs/USAGE.md") continue;
      if (entry.isDirectory()) walk(abs);
      else found.push(rel);
    }
  };
  if (existsSync(docs)) walk(docs);
  found.sort();
  return found;
}

function projectHasUi(folder) {
  try {
    const data = JSON.parse(readFileSync(path.join(folder, "devos", "project.json"), "utf8"));
    return data?.ui === true;
  } catch {
    return false;
  }
}

function checkBlueprint(folder) {
  const required = [...REQUIRED_DOCS];
  if (existsSync(path.join(folder, "devos", "intake-docs"))) required.push("docs/OPEN_QUESTIONS.md");
  if (projectHasUi(folder)) required.push("docs/DESIGN_SYSTEM.md", "docs/design/UI_ACCEPTANCE.md", "docs/design/REFERENCES.md");
  const missing = required.filter((rel) => !existsSync(path.join(folder, ...rel.split("/"))));
  // PR-59: every screenshot the developer gave is a row of docs/design/REFERENCES.md.
  const refsDir = path.join(folder, "docs", "design", "references");
  const refsFile = path.join(folder, "docs", "design", "REFERENCES.md");
  if (existsSync(refsDir) && existsSync(refsFile)) {
    const listed = readFileSync(refsFile, "utf8");
    for (const name of readdirSync(refsDir).sort()) {
      if (!listed.includes(name)) missing.push(`docs/design/REFERENCES.md does not name docs/design/references/${name}`);
    }
  }
  const guard = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "phases,naming,design-spec"], {
    cwd: folder,
    encoding: "utf8",
    windowsHide: true,
  });
  // PR-58: fence T01 passes fence-check before the developer approves the blueprint.
  const fence = existsSync(path.join(folder, "docs", "fences", "T01.md"))
    ? spawnSync(process.execPath, ["scripts/devos/fence-check.mjs", "docs/fences/T01.md"], { cwd: folder, encoding: "utf8", windowsHide: true })
    : { status: 0, stdout: "", stderr: "" };
  const output = `${guard.stdout ?? ""}${guard.stderr ?? ""}`;
  const fenceOutput = fence.status === 0 ? "" : `${fence.stdout ?? ""}${fence.stderr ?? ""}`;
  const detail = [...missing.map((rel) => (rel.startsWith("docs/design/REFERENCES.md does not") ? rel : `missing ${rel}`)), output, fenceOutput].filter((part) => part !== "").join("\n");
  return { ok: missing.length === 0 && guard.status === 0 && fence.status === 0, detail };
}

/** The agent's closing message: Claude's and Cursor's `result`, Gemini's `response`, Codex's last message. */
export function agentText(stdout, final = null) {
  if (final && typeof final.result === "string") return final.result;
  const text = stdout ?? "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.result === "string") return parsed.result;
      if (typeof parsed.response === "string") return parsed.response;
    }
  } catch {
    /* not one JSON object */
  }
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") last = event.item.text;
    } catch {
      /* not an event */
    }
  }
  return last ?? text;
}

function printClaude(stdout, final = null) {
  const text = agentText(stdout, final);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

/** One line of the project's usage record per blueprint round (PR-52), by the project's own usage.mjs. */
function recordUsage(folder, agent, result, round, seconds) {
  const script = path.join(folder, "scripts", "devos", "usage.mjs");
  if (!existsSync(script)) return;
  const out = path.join(folder, ".devos", "blueprint-round.out");
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, result?.stdout ?? "");
  } catch {
    return;
  }
  const env = { ...process.env };
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_STEP_SUMMARY"]) delete env[name];
  const call = (args) => spawnSync(process.execPath, [script, ...args], { cwd: folder, env, encoding: "utf8", windowsHide: true, timeout: 60000 });
  const recorded = call(["record", "--stage", "blueprint", "--task", "blueprint", "--attempt", String(round), "--command", agent.tool, "--model", agent.model, "--out", out, "--code", String(result?.status ?? ""), "--seconds", String(seconds)]);
  const line = (recorded.stdout ?? "").trim().split("\n").pop();
  if (line && line.startsWith("usage: ")) console.log(`devos: ${line}`);
  call(["flush", "--task", "blueprint"]);
  call(["report", "--write"]);
}

function payloadBytes(rel) {
  const root = engineRoot();
  const entry = readManifest(root).files.find((item) => item.path === rel);
  return normalizeLf(readFileSync(path.join(root, "payload", "files", ...entry.stored.split("/"))));
}

function heldPayload() {
  const held = {};
  for (const rel of HELD) held[rel] = payloadBytes(rel);
  return held;
}

function writeChunk(stream, text) {
  if (!text) return;
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

function claudeOutput(stdout) {
  const text = stdout ?? "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.result === "string") return parsed.result;
  } catch {
    /* not JSON: the caller prints the tail of stdout */
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-20).join("\n");
}

function showArg(arg) {
  const text = String(arg);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function explainBlueprintFailure(folder, result, command, args) {
  const seen = [];
  if (result.error) {
    const line = `devos: ${command} could not run: ${result.error.message}`;
    console.log(line);
    seen.push(line);
  } else {
    if (result.stderr) {
      writeChunk(process.stderr, result.stderr);
      seen.push(result.stderr);
    }
    const body = claudeOutput(result.stdout);
    if (body) {
      writeChunk(process.stdout, body);
      seen.push(body);
    }
    const statusLine = `devos: ${command} exited with ${result.status}`;
    console.log(statusLine);
    seen.push(statusLine);
    if ((result.stdout ?? "").trim() === "" && (result.stderr ?? "").trim() === "") {
      const hand = `devos: ${command} printed nothing. To see why, run the same call by hand in ${folder}:`;
      console.log(hand);
      seen.push(hand);
      const call = `  ${[command, ...args.map(showArg)].join(" ")}`;
      console.log(call);
      seen.push(call);
    }
  }
  const text = seen.join("\n");
  if (looksLikeUsageLimit(text)) console.log(`devos: ${command} reports a usage limit; wait until it resets`);
  if (looksLikeTrustGate(text)) console.log(`devos: ${command} is waiting on the directory trust gate`);
  if (looksLikePlanRestriction(text)) console.log(`devos: ${command} refused the model because of this account's plan`);
  if (looksLikeCommandRejection(text)) console.log(`devos: ${command} rejected a command`);
  if (looksLikeModelRejection(text) && !looksLikePlanRestriction(text)) {
    const at = args.indexOf("--model");
    console.log(`devos: ${command} cannot use the model ${at >= 0 ? args[at + 1] : "auto"}; choose another model it lists`);
  }
  console.log(`devos: the blueprint failed; fix the cause, then run: devos continue ${folder}`);
}

function claudeArgs(follow) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    "200",
    "--allowedTools",
    "Read,Glob,Grep,Write,Edit,WebFetch,WebSearch,Bash(node scripts/devos/config.mjs --write),Bash(node scripts/devos/fence-check.mjs docs/fences/T01.md)",
    "--disallowedTools",
    "Bash(git *),Bash(gh *),Bash(curl *),Bash(wget *),Bash(rm *)",
  ];
  if (follow) args.push("--continue");
  return args;
}

function toolCommand(toolId) {
  const file = path.join(engineRoot(), "lib", "data", "tools.json");
  const tools = JSON.parse(readFileSync(file, "utf8")).tools;
  return tools.find((tool) => tool.id === toolId)?.command ?? toolId;
}

// Cursor and Claude Code stream their steps (stream-json): the page shows them live, and the round ends on the
// agent's own result event even if the process lingers (a CLI that updates itself can start the run again).
const STREAMING = new Set(["claude", "cursor"]);

/** `follow`: carry on the agent's earlier session (a later round, or a repair after `devos continue`). */
export function blueprintArgs(tool, model, round, session = "", follow = round > 1) {
  if (tool === "claude") {
    const args = claudeArgs(follow);
    args.splice(1, 0, "--model", model);
    return args;
  }
  if (tool === "cursor") {
    const args = ["--trust", "--force", "-p", "--output-format", "stream-json"];
    if (model !== "auto") args.splice(3, 0, "--model", model);
    if (follow) args.push(...(session ? ["--resume", session] : ["--continue"]));
    args.push(BLUEPRINT_POINTER);
    return args;
  }
  // JSON output: the closing message and the usage the record needs (PR-52).
  if (tool === "codex") return ["exec", "--model", model, "--sandbox", "workspace-write", "--json"];
  if (tool === "gemini") return ["--model", model, "--approval-mode", "yolo", "--output-format", "json", "-p", "Follow the instructions given on standard input exactly."];
  return ["-p", "--model", model];
}

export function blueprintEnv(tool, env) {
  if (tool !== "gemini") return env;
  return { ...env, GEMINI_CLI_TRUST_WORKSPACE: "true" };
}

function uiLine(tag, payload) {
  if (process.env.DEVOS_UI !== "1") return;
  process.stdout.write("\n");
  console.log(`${tag} ${JSON.stringify(payload)}`);
}

function uiStep(payload) {
  uiLine("::devos-step", payload);
}

function uiAsk(payload) {
  uiLine("::devos-ask", payload);
}

async function finish(folder, held, answers, read) {
  uiStep({ step: "approved" });
  for (const rel of HELD) {
    const dest = path.join(folder, ...rel.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, held[rel]);
  }
  console.log(`devos init: blueprint approved in ${folder}`);
  return finishSetup(folder, answers, read);
}

function roundLimitMs() {
  const raw = Number(process.env.DEVOS_ROUND_LIMIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3600000;
}

function resultGraceMs() {
  const raw = Number(process.env.DEVOS_RESULT_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10000;
}

// A round with no output from the agent and no file changed in the project for this long is stopped: an agent
// waiting on a helper that never answers looks exactly like this.
export function idleLimitMs() {
  const raw = Number(process.env.DEVOS_IDLE_LIMIT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 900000;
}

const QUIET_SKIP = new Set([".git", "node_modules", ".devos", ".next", "dist", "build"]);

/** The newest modification time under the project folder (its own scratch and dependencies left out). */
function newestChange(folder) {
  let newest = 0;
  let seen = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen > 5000) return;
      seen += 1;
      if (QUIET_SKIP.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      try {
        newest = Math.max(newest, statSync(abs).mtimeMs);
      } catch {
        continue;
      }
      if (entry.isDirectory()) walk(abs);
    }
  };
  walk(folder);
  return newest;
}

const SESSION_FILE = ".devos/blueprint-session.json";

function savedSession(folder, tool) {
  try {
    const saved = JSON.parse(readFileSync(path.join(folder, ...SESSION_FILE.split("/")), "utf8"));
    return saved?.tool === tool && typeof saved.session === "string" ? saved.session : "";
  } catch {
    return "";
  }
}

function saveSession(folder, tool, session) {
  try {
    const file = path.join(folder, ...SESSION_FILE.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ tool, session })}\n`);
  } catch {
    /* the next round starts a new session */
  }
}

function repairText(detail) {
  return `Your documents and fence T01 are written, and these checks failed:\n${detail}\n\nFix only what the checks name, keeping every rule of devos/prompts/blueprint.md. Do not research again, and do not rewrite what passes.`;
}

function printFailedChecks(check, heading) {
  const failed = check.detail.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
  console.log(heading);
  for (const line of failed.slice(0, 20)) console.log(`  ${line.trim()}`);
}

function runToolRound(command, args, { cwd, input, folder, label, env, stream = false }) {
  let last = "";
  const beat = heartbeat({ label, folder, detail: () => last });
  return new Promise((resolve) => {
    let child = null;
    let timer = null;
    let endTimer = null;
    let stdout = "";
    let stderr = "";
    let pending = "";
    let session = "";
    let final = null;
    let settled = false;
    let timedOut = false;
    let idle = false;
    let sigCount = 0;
    let lastActivity = Date.now();
    let lastChange = newestChange(folder);
    let quietTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (endTimer) clearTimeout(endTimer);
      if (quietTimer) clearInterval(quietTimer);
      beat.stop();
      process.off("SIGINT", onSigint);
      resolve({ ...result, idle, lastStep: last, session, final });
    };
    const show = (item) => {
      last = item.text;
      uiStep({ step: "activity", kind: item.kind, text: item.text });
    };
    const take = (line) => {
      const event = streamEvent(line, folder);
      if (!event) return;
      if (event.session) session = event.session;
      if (event.step) show(event.step);
      for (const item of event.steps ?? []) show(item);
      if (event.result) {
        final = event.result;
        if (typeof final.session_id === "string") session = final.session_id;
        // The agent's turn is over. A process still running after the grace period is ended, so the round
        // finishes on the agent's own result.
        endTimer = setTimeout(() => {
          if (child?.pid) killPidTree(child.pid);
          finish({ status: final.is_error === true ? 1 : 0, stdout, stderr, timedOut, endedOnResult: true });
        }, resultGraceMs());
      }
    };
    const onSigint = () => {
      sigCount += 1;
      if (sigCount > 1) process.exit(130);
      if (child?.pid) killPidTree(child.pid);
      console.log(`devos: stopped — the folder keeps what was written; run devos continue ${folder}`);
      process.exit(130);
    };
    process.on("SIGINT", onSigint);
    beat.start();
    try {
      child = spawnTool(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env });
    } catch (error) {
      finish({ error });
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      lastActivity = Date.now();
      stdout += chunk;
      if (!stream) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) take(line.replace(/\r$/, ""));
    });
    child.stderr?.on("data", (chunk) => {
      lastActivity = Date.now();
      stderr += chunk;
    });
    child.on("error", (error) => finish({ error, stdout, stderr, timedOut }));
    child.on("close", (status) => {
      if (stream && pending !== "") take(pending.replace(/\r$/, ""));
      finish({ status: final && status === null ? (final.is_error === true ? 1 : 0) : status, stdout, stderr, timedOut });
    });
    timer = setTimeout(() => {
      timedOut = true;
      if (child?.pid) killPidTree(child.pid);
    }, roundLimitMs());
    const quiet = idleLimitMs();
    quietTimer = setInterval(() => {
      const changed = newestChange(folder);
      if (changed > lastChange) {
        lastChange = changed;
        lastActivity = Date.now();
      }
      if (!idle && !final && Date.now() - lastActivity >= quiet) {
        idle = true;
        if (child?.pid) killPidTree(child.pid);
      }
    }, Math.max(200, Math.min(30000, Math.floor(quiet / 3))));
    if (child.stdin) {
      child.stdin.on("error", () => {});
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function runBlueprint(folder, answers, read, held, start = { kind: "blueprint" }) {
  const saved = answers.blueprint_agent ?? engineDefaults().reviewer;
  const agent = { ...saved, model: cleanModelId(saved.model) };
  const command = toolCommand(agent.tool);
  const phases = path.join(folder, "docs", "PHASES.md");
  let next = start;
  let session = savedSession(folder, agent.tool);
  for (let round = 1; round <= 5; round += 1) {
    // "review": the documents are already written and pass their checks (devos continue), so the round goes
    // straight to the developer's review.
    if (next.kind !== "review") {
      uiStep({ step: "blueprint", round });
      let input;
      if (next.kind === "blueprint") input = readFileSync(path.join(folder, "devos", "prompts", "blueprint.md"), "utf8");
      else if (next.kind === "repair") input = next.text;
      else {
        input = `The developer asks for these changes:\n${next.text}\n\nApply them to the documents and fence T01, keeping every rule of devos/prompts/blueprint.md. Change only what the request needs; do not research again.`;
      }
      if (round === 1 && agent.tool === "cursor") {
        const kit = path.join(folder, ".cursor", "cli.json");
        mkdirSync(path.dirname(kit), { recursive: true });
        writeFileSync(kit, payloadBytes("devos/roles/cursor-blueprint/cli.json"));
      }
      const args = blueprintArgs(agent.tool, agent.model, round, session, round > 1 || next.kind !== "blueprint");
      let delivered = input;
      if (agent.tool === "cursor") {
        const blueprintFile = path.join(folder, ...BLUEPRINT_INPUT.split("/"));
        mkdirSync(path.dirname(blueprintFile), { recursive: true });
        writeFileSync(blueprintFile, input);
        delivered = null;
      }
      const roundStart = Date.now();
      const result = await runToolRound(command, args, {
        cwd: folder,
        input: delivered,
        folder,
        label: `blueprint running on ${agent.tool} · ${agent.model}${round > 1 ? ` · round ${round}` : ""}`,
        env: blueprintEnv(agent.tool, process.env),
        stream: STREAMING.has(agent.tool),
      });
      if (result?.session) {
        session = result.session;
        saveSession(folder, agent.tool, session);
      }
      if (result && !result.error) recordUsage(folder, agent, result, round, Math.round((Date.now() - roundStart) / 1000));
      if (!result || result.error?.code === "ENOENT") {
        console.log(`devos: the blueprint failed; delete ${folder} and run devos init again`);
        return 1;
      }
      if (result.timedOut) console.log(`devos: ${command} ran over an hour and was stopped`);
      if (result.idle) {
        const limit = idleLimitMs();
        const span = limit >= 60000 ? `${Math.round(limit / 60000)} minutes` : `${Math.round(limit / 1000)} seconds`;
        console.log(`devos: ${command} made no progress for ${span}${result.lastStep ? ` (last step: ${result.lastStep})` : ""}; the round was stopped`);
      }
      // A round stopped by the hour limit or for no progress keeps what it wrote: the checks decide what follows.
      const stopped = Boolean(result.timedOut || result.idle) && existsSync(phases);
      if (result.status !== 0 && !stopped) {
        explainBlueprintFailure(folder, result, command, args);
        return 1;
      }
      if (!stopped) printClaude(result.stdout, result.final);
      const check = checkBlueprint(folder);
      if (!check.ok) {
        printFailedChecks(check, `devos: the checks after round ${round} failed:`);
        if (round === 5) {
          console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
          return 1;
        }
        console.log(`devos: round ${round + 1}: ${command} fixes only what failed${STREAMING.has(agent.tool) ? ", in the same session" : ""}`);
        next = { kind: "repair", text: repairText(check.detail) };
        continue;
      }
      if (stopped) console.log("devos: the documents it wrote pass the checks; review them");
    }
    console.log("Blueprint written:");
    const files = docsUnder(folder);
    for (const file of files) console.log(file);
    uiAsk({ kind: "approve", round, files });
    process.stdout.write("Type approve, or describe the changes you want: ");
    const decision = await read();
    if (decision === null) {
      console.log("devos: input ended before setup finished");
      return 1;
    }
    if (decision.trim().toLowerCase() === "approve") return finish(folder, held, answers, read);
    if (round === 5) {
      console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
      return 1;
    }
    next = { kind: "changes", text: decision.trim() };
  }
  console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
  return 1;
}

function fileDefaults() {
  const file = path.join(engineRoot(), "payload", "files", "devos", "engine.defaults.json");
  return JSON.parse(readFileSync(file, "utf8")).agents;
}

function cycleIds() {
  return new Set(catalogue().tools.filter((tool) => tool.cycle === true).map((tool) => tool.id));
}

function runnableRole(agent, fallback, allowed) {
  if (agent && allowed.has(agent.tool)) return agent;
  return fallback;
}

function engineDefaults() {
  const base = fileDefaults();
  const roster = loadRoster();
  if (!roster || !roster.reviewer || !Array.isArray(roster.pool)) return base;
  const allowed = cycleIds();
  let pool = roster.pool.filter((item) => item && allowed.has(item.tool));
  if (pool.length === 0) pool = base.pool;
  else if (!pool.some((item) => item.default)) pool = pool.map((item, index) => ({ ...item, default: index === 0 }));
  return {
    reviewer: runnableRole(roster.reviewer, base.reviewer, allowed),
    reviewer_light: roster.reviewer_light == null ? null : runnableRole(roster.reviewer_light, base.reviewer_light, allowed),
    pool,
    policy: roster.policy || base.policy,
  };
}

function catalogue() {
  return JSON.parse(readFileSync(path.join(engineRoot(), "lib", "data", "tools.json"), "utf8"));
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function agentId(tool, model) {
  const prefix = `${tool}-`;
  const rest = String(model).toLowerCase().startsWith(prefix) ? String(model).slice(prefix.length) : model;
  return `${tool}-${slug(rest)}`;
}

function laterName(label) {
  const tail = label.includes("/") ? label.split("/").pop().trim() : label;
  return tail.split(/\s+/)[0];
}

function cycleLaterLine() {
  const names = catalogue().tools.filter((tool) => tool.cycle === false).map((tool) => laterName(tool.label));
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} join the GitHub roles in a later version.`;
}

function modelOptions(detected, installedOnly, cycleOnly = false) {
  const options = [];
  for (const tool of catalogue().tools) {
    if (cycleOnly && tool.cycle !== true) continue;
    const found = detected.find((agent) => agent.toolId === tool.id);
    const ready = found && found.status === "installed" && found.signedIn;
    if (installedOnly && !ready) continue;
    const groups = found && found.groups && found.groups.length
      ? found.groups
      : (tool.seedGroups ?? []).map((group) => ({
        models: group.models.map((id) => ({ id, available: false, reported: false })),
      }));
    for (const group of groups) {
      for (const model of group.models) {
        const mark = model.available || model.reported ? " — on your account" : "";
        options.push({
          value: { tool: tool.id, model: model.id },
          label: `${tool.label} · ${model.id}${mark}`,
        });
      }
    }
  }
  return options;
}

function optionIndex(options, tool, model) {
  const index = options.findIndex((option) => option.value && option.value.tool === tool && option.value.model === model);
  return index >= 0 ? index : 0;
}

function asAgent(choice, fallback) {
  if (fallback && fallback.tool === choice.tool && fallback.model === choice.model) {
    return { id: fallback.id, tool: fallback.tool, model: fallback.model };
  }
  return { id: agentId(choice.tool, choice.model), tool: choice.tool, model: choice.model };
}

function githubNote(tool) {
  const entry = catalogue().tools.find((item) => item.id === tool);
  if (entry && entry.cycle === true) return;
  console.log(`note: ${tool} joins the GitHub roles in a later version; until then the cycle uses the default builder`);
}

async function askAgents(read, detected) {
  const defaults = engineDefaults();
  const github = modelOptions(detected, false, true);
  const local = modelOptions(detected, true);
  const later = cycleLaterLine();
  const reviewerChoice = await select(read, process.stdout, {
    title: "Reviewer — reviews every task on GitHub",
    options: github,
    defaultIndex: optionIndex(github, defaults.reviewer.tool, defaults.reviewer.model),
    note: later,
  });
  if (failed(reviewerChoice)) return reviewerChoice;
  githubNote(reviewerChoice.tool);
  const reviewer = asAgent(reviewerChoice, defaults.reviewer);
  const lightOptions = [{ value: "same", label: "Same as the reviewer" }, ...github];
  const lightDefault = defaults.reviewer_light
    ? optionIndex(lightOptions, defaults.reviewer_light.tool, defaults.reviewer_light.model)
    : 0;
  const lightChoice = await select(read, process.stdout, {
    title: "Light reviewer — risk 1–2 reviews",
    options: lightOptions,
    defaultIndex: lightDefault,
    note: later,
  });
  if (failed(lightChoice)) return lightChoice;
  let reviewerLight = null;
  if (lightChoice !== "same") {
    githubNote(lightChoice.tool);
    reviewerLight = asAgent(lightChoice, defaults.reviewer_light);
  }
  const poolChoices = await multiSelect(read, process.stdout, {
    title: "Builder pool — numbers separated by commas",
    options: github,
    defaultIndexes: (defaults.pool ?? []).map((item) => optionIndex(github, item.tool, item.model)),
    note: later,
  });
  if (failed(poolChoices)) return poolChoices;
  const strengthsOf = catalogue().builderStrengths.map((name) => ({ value: name, label: name }));
  const pool = [];
  for (const choice of poolChoices) {
    githubNote(choice.tool);
    const fallback = (defaults.pool ?? []).find((item) => item.tool === choice.tool && item.model === choice.model);
    const agent = asAgent(choice, fallback);
    const strengths = await multiSelect(read, process.stdout, {
      title: `Strengths of ${agent.id}`,
      options: strengthsOf,
      defaultIndexes: [],
      emptyAllowed: true,
    });
    if (failed(strengths)) return strengths;
    pool.push({
      ...agent,
      default: false,
      note: strengths.length > 0 ? `strengths: ${strengths.join(", ")}` : "default builder",
    });
  }
  if (pool.length === 0) return undefined;
  let defaultIndex = 0;
  if (pool.length > 1) {
    const current = (defaults.pool ?? []).find((item) => item.default);
    const picked = await select(read, process.stdout, {
      title: "Default builder",
      options: pool.map((item) => ({ value: item.id, label: `${item.tool} · ${item.model}` })),
      defaultIndex: Math.max(0, pool.findIndex((item) => current && item.tool === current.tool && item.model === current.model)),
    });
    if (failed(picked)) return picked;
    defaultIndex = Math.max(0, pool.findIndex((item) => item.id === picked));
  }
  pool.forEach((item, index) => {
    item.default = index === defaultIndex;
  });
  for (const item of pool) {
    if (item.model === reviewer.model) {
      console.log(`devos: warning: ${item.id} uses ${item.model}, the same model as the reviewer`);
    }
  }
  const policy = await select(read, process.stdout, {
    title: "Who picks the builder for each task",
    options: [
      { value: "reviewer-picks", label: "reviewer-picks" },
      { value: "always-default", label: "always-default" },
    ],
    defaultIndex: defaults.policy === "always-default" ? 1 : 0,
  });
  if (failed(policy)) return policy;
  let blueprintDefault = local.findIndex((option) => option.value.tool === reviewer.tool && option.value.model === reviewer.model);
  if (blueprintDefault < 0) blueprintDefault = local.findIndex((option) => option.value.tool === reviewer.tool);
  if (blueprintDefault < 0) blueprintDefault = 0;
  const blueprint = await select(read, process.stdout, {
    title: "Blueprint agent — writes the documents and fence T01 on this computer",
    options: local,
    defaultIndex: blueprintDefault,
  });
  if (failed(blueprint)) return blueprint;
  const save = await confirm(read, process.stdout, "Save these agents as your defaults?", true);
  if (failed(save)) return save;
  const agents = { reviewer, reviewer_light: reviewerLight, pool, policy };
  if (save) {
    const canonical = checkRoster(agents);
    if (canonical) {
      const file = path.join(devosHome(), ".devos", "roster.json");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(canonical, null, 2)}\n`);
    }
  }
  return { agents, blueprint };
}

function moduleRead(read, moduleId) {
  return async () => {
    const line = await read();
    if (typeof line !== "string") return line;
    const prefix = `${moduleId} `;
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return trimmed.slice(prefix.length);
    return line;
  };
}

async function askProject(read) {
  const types = loadCatalogue().types;
  const typeId = await select(read, process.stdout, {
    title: "Project type",
    options: types.map((type) => ({ label: `${type.label} — ${type.line}`, value: type.id })),
    defaultIndex: 0,
  });
  if (failed(typeId)) return typeId;
  const type = typeById(typeId);
  const stacks = stacksFor(typeId);
  const stackDefault = Math.max(0, stacks.findIndex((stack) => stack.id === type.stack));
  const stackId = await select(read, process.stdout, {
    title: "Stack",
    options: stacks.map((stack) => ({ label: stack.label, value: stack.id })),
    defaultIndex: stackDefault,
  });
  if (failed(stackId)) return stackId;
  const chosenStack = stacks.find((stack) => stack.id === stackId);
  const limited = chosenStack?.toolchain !== "node";
  if (limited) {
    console.log("Supabase, R2, Firebase and Vercel deploys work with JavaScript and TypeScript stacks for now.");
  }
  const modules = {};
  for (const module of modulesFor(typeId)) {
    const providers = limited ? module.providers.filter((provider) => !provider.method) : module.providers;
    const defaultProvider = module.providers.find((provider) => provider.id === module.default);
    const defaultId = limited && defaultProvider?.method ? "none" : module.default;
    const defaultIndex = Math.max(0, providers.findIndex((provider) => provider.id === defaultId));
    const chosen = await select(moduleRead(read, module.id), process.stdout, {
      title: `${module.label} — ${module.consequence}`,
      options: providers.map((provider) => ({ label: provider.label, value: provider.id })),
      defaultIndex,
    });
    if (failed(chosen)) return chosen;
    modules[module.id] = chosen;
  }
  const scope = await select(read, process.stdout, {
    title: "Scope",
    options: [
      { label: "MVP — the core flow first; every other feature waits until you ask for it", value: "mvp" },
      { label: "Full product for production — every feature in the brief, in phases, then a production-readiness phase", value: "full" },
    ],
    defaultIndex: 0,
  });
  if (failed(scope)) return scope;
  return { type: typeId, stack: stackId, modules, scope };
}

function printPrepare(typeId) {
  console.log("Have these ready (all optional; attach the ones you have):");
  for (const doc of prepareFor(typeId)) console.log(`- ${doc.label} — ${doc.why}`);
  console.log("Name each file for what it holds (brief.md, brand-guide.pdf), and each image for the reference it shows (ref-checkout-stripe.png, logo.png, flow-sign-up.png): the agents cite them by name.");
  console.log("Keys are typed later, hidden, and never attached.");
}

async function askAnswers(read) {
  const name = await ask(read, "Project name: ", "Project name", (line) => {
    const value = line.trim();
    if (value === "" || !KEY_RE.test(keyFromName(value))) return undefined;
    return value;
  });
  if (failed(name)) return name;
  const brief = await ask(read, "One-paragraph brief: ", "One-paragraph brief", (line) => {
    const value = line.trim();
    return value === "" ? undefined : value;
  });
  if (failed(brief)) return brief;
  const users = await ask(read, "Who uses it: ", "Who uses it", (line) => {
    const value = line.trim();
    return value === "" ? undefined : value;
  });
  if (failed(users)) return users;
  const languages = await ask(read, "Languages, comma-separated [en]: ", "Languages, comma-separated", (line) => {
    if (line.trim() === "") return ["en"];
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => !LANGUAGE.test(part))) return undefined;
    return parts;
  });
  if (failed(languages)) return languages;
  const visibilityDefault = profileVisibility();
  const visibility = await ask(
    read,
    `Repository visibility (private/public) [${visibilityDefault}]: `,
    "Repository visibility (private/public)",
    (line) => {
      const value = line.trim() === "" ? visibilityDefault : line.trim().toLowerCase();
      return value === "private" || value === "public" ? value : undefined;
    },
  );
  if (failed(visibility)) return visibility;
  return { name, brief, users, languages, visibility };
}

function attachmentName(filePath) {
  const cleaned = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "attachment";
}

async function askAttachments(read) {
  return text(read, process.stdout, {
    title: `Documents (Markdown, text, CSV, JSON, YAML up to ${LIMITS.text / MIB} MB; PDF up to ${LIMITS.pdf / MIB} MB) and design images (PNG, JPEG, WebP, GIF up to ${LIMITS.image / MIB} MB) to attach — up to ${ATTACH_MAX} paths separated by commas, or Enter for none`,
    accept: (line) => {
      if (line.trim() === "") return [];
      const paths = line.split(",").map((part) => part.trim()).filter(Boolean);
      if (paths.length > ATTACH_MAX) return undefined;
      let total = 0;
      const names = [];
      for (const filePath of paths) {
        if (attachmentKind(filePath) === null) return undefined;
        let info;
        try {
          info = statSync(filePath);
        } catch {
          return undefined;
        }
        if (!info.isFile() || !attachmentAllowed(filePath, info.size)) return undefined;
        total += info.size;
        names.push({ filePath, name: attachmentName(filePath) });
      }
      if (total > TOTAL_LIMIT) return undefined;
      if (new Set(names.map((item) => item.name)).size !== names.length) return undefined;
      return names;
    },
  });
}

export function summaryLines(agents, answers, attachments) {
  const type = typeById(answers.type);
  const stack = loadCatalogue().stacks.find((item) => item.id === answers.stack);
  return [
    `Reviewer: ${agents.reviewer.tool} · ${agents.reviewer.model}`,
    `Light reviewer: ${agents.reviewer_light ? `${agents.reviewer_light.tool} · ${agents.reviewer_light.model}` : "same as the reviewer"}`,
    ...agents.pool.map((item) => `Builder: ${item.tool} · ${item.model}${item.default ? " · default" : ""} · ${item.note}`),
    `Policy: ${agents.policy}`,
    `Blueprint: ${answers.blueprint_agent.tool} · ${answers.blueprint_agent.model}`,
    `Project: ${answers.name}`,
    `Brief: ${answers.brief}`,
    `Users: ${answers.users}`,
    `Stores data: ${answers.stores_data ? "yes" : "no"}`,
    `Sign-in: ${answers.sign_in}`,
    `Languages: ${answers.languages.join(", ")}`,
    `Deploy: ${answers.deploy}`,
    `Visibility: ${answers.visibility}`,
    `Type: ${type?.label ?? answers.type}`,
    `Stack: ${stack?.label ?? answers.stack}`,
    `Modules: ${Object.entries(answers.modules ?? {}).map(([id, provider]) => `${id} ${provider}`).join(" · ")}`,
    `Scope: ${answers.scope}`,
    `Attachments: ${attachments.length > 0 ? attachments.map((item) => item.name).join(", ") : "none"}`,
  ];
}

function printSummary(agents, answers, attachments) {
  for (const line of summaryLines(agents, answers, attachments)) console.log(line);
}

function signedInBlueprint(detected) {
  return detected.some((agent) => BLUEPRINT_TOOLS.has(agent.toolId) && agent.status === "installed" && agent.signedIn);
}

export async function resumeBlueprint(folder, answers, read) {
  if (!answers.blueprint_agent) {
    const reviewer = engineDefaults().reviewer;
    answers.blueprint_agent = { tool: reviewer.tool, model: reviewer.model };
  }
  // Documents already written are checked, not drafted again: they go to the developer's review when they pass,
  // and the agent repairs only what fails, in its saved session when there is one.
  let start = { kind: "blueprint" };
  if (existsSync(path.join(folder, "docs", "PHASES.md"))) {
    const check = checkBlueprint(folder);
    if (check.ok) {
      console.log("devos: the blueprint is written and passes its checks; review it");
      start = { kind: "review" };
    } else {
      const tool = answers.blueprint_agent.tool;
      printFailedChecks(check, "devos: the written blueprint fails these checks:");
      console.log(`devos: ${toolCommand(tool)} fixes only what failed${savedSession(folder, tool) ? ", in its earlier session" : ""}`);
      start = { kind: "repair", text: repairText(check.detail) };
    }
  }
  return runBlueprint(folder, answers, read, heldPayload(), start);
}

/** A new project never goes inside the engine's folder (a git clone that the engine updates). */
export function refuseInsideEngine(folder) {
  if (!insideEngine(folder)) return false;
  console.log(`devos: ${folder} is inside the engine's folder; create the project outside it, for example ${path.join(homedir(), "devos-projects", path.basename(folder))}`);
  return true;
}

export async function initCommand(args) {
  if (args.includes("--plan")) return runPlan(args);
  const cont = args.includes("--continue");
  const positional = args.filter((arg) => arg !== "--continue");
  const folder = path.resolve(positional[0] ?? process.cwd());
  if (cont) return continueCommand(folder);
  if (refuseInsideEngine(folder)) return 1;
  if (!isEmptyFolder(folder)) {
    console.log(`devos: ${folder} is not empty; devos init starts from an empty folder`);
    return 1;
  }
  if (doctorCommand() !== 0) return 1;
  const detected = detectAgents();
  if (!signedInBlueprint(detected)) {
    console.log("devos: no signed-in AI tool on this computer; install and sign in to Claude Code, Cursor, Codex or Gemini, then run devos init");
    return 1;
  }

  const read = lineReader(process.stdin);
  const shown = contractText();
  process.stdout.write(shown.endsWith("\n") ? shown : `${shown}\n`);
  process.stdout.write("Type accept to continue: ");
  const acceptLine = await read();
  if (acceptLine === null) {
    console.log("devos: input ended before setup finished");
    return 1;
  }
  if (acceptLine.trim().toLowerCase() !== "accept") {
    console.log("devos: contract declined — nothing was written or sent");
    return 1;
  }

  let chosen = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const picked = await askAgents(read, detected);
    if (failed(picked)) return 1;
    const project = await askProject(read);
    if (failed(project)) return 1;
    const fields = await askAnswers(read);
    if (failed(fields)) return 1;
    printPrepare(project.type);
    const attachments = await askAttachments(read);
    if (failed(attachments)) return 1;
    const answers = buildAnswers(fields, project, picked.blueprint, attachments.map((item) => item.name));
    printSummary(picked.agents, answers, attachments);
    const go = await confirm(read, process.stdout, "Continue with these answers?", true);
    if (failed(go)) return 1;
    if (go) {
      chosen = { agents: picked.agents, answers, attachments };
      break;
    }
  }
  if (!chosen) return 1;
  return startProject(folder, chosen, read);
}

function startProject(folder, chosen, read) {
  uiStep({ step: "install" });
  mkdirSync(folder, { recursive: true });
  const installed = installInto(folder, chosen.answers.key, { hold: HELD });
  if (installed.code !== 0) return 1;
  const projectFile = path.join(folder, "devos", "project.json");
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  project.agents = chosen.agents;
  project.ui = typeById(chosen.answers.type)?.ui === true;
  const stackEntry = loadCatalogue().stacks.find((stack) => stack.id === chosen.answers.stack);
  project.stack = {
    id: stackEntry.id,
    toolchain: stackEntry.toolchain,
    manifest: stackEntry.manifest,
    commands: { ...stackEntry.commands },
    preview: stackEntry.preview ?? "",
    scaffold: { ...stackEntry.scaffold, create: [...stackEntry.scaffold.create] },
  };
  writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`);
  const config = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
    cwd: folder,
    encoding: "utf8",
    windowsHide: true,
  });
  if (config.status !== 0) return 1;
  // PR-59: documents go to devos/intake-docs/ for the blueprint; screenshots are design references the
  // project keeps, in docs/design/references/.
  const intake = path.join(folder, "devos", "intake-docs");
  const references = path.join(folder, "docs", "design", "references");
  for (const item of chosen.attachments) {
    const dir = attachmentKind(item.name) === "image" ? references : intake;
    mkdirSync(dir, { recursive: true });
    copyFileSync(item.filePath, path.join(dir, item.name));
  }
  writeFileSync(path.join(folder, "devos", "answers.json"), `${JSON.stringify(chosen.answers, null, 2)}\n`);
  return runBlueprint(folder, chosen.answers, read, installed.held);
}

async function runPlan(args) {
  const index = args.indexOf("--plan");
  const file = args[index + 1];
  const folderArg = args.find((arg, at) => at !== index && at !== index + 1 && arg !== "--continue");
  const folder = path.resolve(folderArg ?? process.cwd());
  if (refuseInsideEngine(folder)) return 1;
  let plan;
  try {
    plan = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log("devos: plan: the plan file is not readable JSON");
    return 2;
  }
  if (doctorCommand() !== 0) return 1;
  const detected = detectAgents();
  const validated = validatePlan(plan, detected);
  if (!validated.ok) {
    for (const error of validated.errors) console.log(`devos: plan: ${error}`);
    return 2;
  }
  if (!isEmptyFolder(folder)) {
    console.log(`devos: ${folder} is not empty; devos init starts from an empty folder`);
    return 1;
  }
  const read = lineReader(process.stdin);
  read.isTTY = false;
  read.interactive = true;
  const code = await startProject(folder, validated, read);
  uiStep({ step: "done", code });
  return code;
}
