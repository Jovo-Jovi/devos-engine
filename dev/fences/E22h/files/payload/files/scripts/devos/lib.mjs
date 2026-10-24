// Shared helpers for the Dev OS runner. Dependency-free on purpose: it must run before T01
// creates package.json, on Linux CI and on a developer machine.
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = (...p) => join(ROOT, ...p);

export function readJson(rel) {
  return JSON.parse(readFileSync(P(rel), "utf8"));
}

export function config() {
  return readJson("devos.config.json");
}

// ---------- PHASES.md ----------------------------------------------------------------------

const HEADER = ["Task", "Phase", "Station", "Name", "Risk", "Gate", "Done", "Verdict"];

function splitRow(line) {
  // "| a | b |" -> ["a", "b"]
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parsePhases(text = readFileSync(P("docs/PHASES.md"), "utf8")) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const cells = l.trim().startsWith("|") ? splitRow(l) : [];
    return cells.length === HEADER.length && cells.every((c, i) => c === HEADER[i]);
  });
  if (start < 0) throw new Error("PHASES.md: task table header not found: | " + HEADER.join(" | ") + " |");
  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim().startsWith("|")) break;
    const c = splitRow(l);
    if (c.length !== HEADER.length) throw new Error(`PHASES.md line ${i + 1}: expected ${HEADER.length} cells, got ${c.length}`);
    rows.push({
      line: i,
      task: c[0], phase: c[1], station: c[2], name: c[3],
      risk: Number(c[4]), gate: c[5], done: c[6] === "[x]", doneRaw: c[6], verdict: c[7],
    });
  }
  return { lines, rows, start };
}

export function isHumanGate(row) {
  return row.risk >= 3 || (row.gate && row.gate !== "—" && row.gate !== "-");
}

export function reviewerModel(row, cfg = config()) {
  // PR-53: a project with agents is reviewed only by the agent the developer chose; the Claude ids are the old default.
  if (cfg.agents?.reviewer) {
    const deep = row.risk >= 3 || (row.gate && row.gate !== "—" && row.gate !== "-");
    return (!deep && cfg.agents.reviewer_light ? cfg.agents.reviewer_light : cfg.agents.reviewer).model;
  }
  if (row.gate && row.gate !== "—" && row.gate !== "-") return cfg.reviewer.gate_model;
  return cfg.reviewer.model_by_risk[String(row.risk)] ?? cfg.reviewer.gate_model;
}

/** Claude Code effort for the reviewer (Opus/Sonnet 5.5 default to medium, so it is always set). */
export function reviewerEffort(row, cfg = config()) {
  if (row.gate && row.gate !== "—" && row.gate !== "-") return cfg.reviewer.gate_effort ?? "xhigh";
  return cfg.reviewer.effort_by_risk?.[String(row.risk)] ?? "high";
}

/** PR-28: a method fix (Phase PM) repairs the automation itself. It runs on its own track: before
 *  any open product task, and outside the product order, so a broken flow can be fixed while a
 *  product task is stuck. It always ends at the human gate. */
export const METHOD_PHASE = "PM";
export const isMethodRow = (row) => row?.phase === METHOD_PHASE;

export function nextOpenTask(rows) {
  return rows.find((r) => !r.done && isMethodRow(r)) ?? rows.find((r) => !r.done) ?? null;
}

/** The task whose fence the reviewer writes after this one: product tasks chain to the next product
 *  task; a method fix chains to nothing (its PASS always waits for the human). */
export function taskAfter(rows, task) {
  const i = rows.findIndex((r) => r.task === task);
  if (i < 0 || isMethodRow(rows[i])) return null;
  return rows.slice(i + 1).find((r) => !isMethodRow(r)) ?? null;
}

export function updatePhasesRow(task, { done, verdict }) {
  const file = P("docs/PHASES.md");
  const text = readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const { lines, rows } = parsePhases(text);
  const row = rows.find((r) => r.task === task);
  if (!row) throw new Error(`PHASES.md: no row for ${task}`);
  const c = splitRow(lines[row.line]);
  if (done !== undefined) c[6] = done ? "[x]" : "[ ]";
  if (verdict !== undefined) c[7] = verdict;
  lines[row.line] = "| " + c.join(" | ") + " |";
  writeFileSync(file, lines.join(eol));
}

// ---------- git ----------------------------------------------------------------------------

export function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

/** Paths changed in the working tree relative to HEAD, including untracked, excluding ignored. */
export function changedPaths() {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" });
  const paths = [];
  const parts = out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status[0] === "R" || status[0] === "C") paths.push(parts[++i]); // rename source
  }
  return [...new Set(paths)];
}

// ---------- globs --------------------------------------------------------------------------

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export const matchesAny = (path, globs) => globs.some((g) => globToRegExp(g).test(path));

// ---------- outputs ------------------------------------------------------------------------

/** Emit key=value for GitHub Actions ($GITHUB_OUTPUT) and also print it for local runs. */
export function emit(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${String(v ?? "").replace(/\r?\n/g, " ")}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

export function fail(msg, code = 1) {
  console.error(`DEVOS: ${msg}`);
  process.exit(code);
}

// ---------- module environments (PR-17, PR-26) ----------------------------------------------
// Each active stack module writes the names the app reads to .devos/<module>.env as shell-sourceable
// KEY='value' lines. Values are local throwaway ones (emulators, demo keys); .devos/ is never committed.

/** Write .devos/<name>.env from an object. */
export function writeDevosEnv(name, env) {
  mkdirSync(P(".devos"), { recursive: true });
  writeFileSync(P(`.devos/${name}.env`), Object.entries(env).map(([k, v]) => `${k}='${String(v).replace(/'/g, "")}'`).join("\n") + "\n");
}

/** Read every .devos/*.env (all active modules) into one object. */
export function readDevosEnv() {
  const env = {};
  if (!existsSync(P(".devos"))) return env;
  for (const f of readdirSync(P(".devos")).filter((n) => n.endsWith(".env")).sort()) {
    for (const line of readFileSync(P(".devos", f), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z][A-Z0-9_]*)='(.*)'$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

/** Wait until something accepts TCP connections on host:port (emulators). */
export async function waitForPort(port, host = "127.0.0.1", seconds = 90) {
  const { connect } = await import("node:net");
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const ok = await new Promise((res) => {
      const s = connect({ port, host }, () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
      s.setTimeout(2000, () => { s.destroy(); res(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export { existsSync, readFileSync, writeFileSync };
