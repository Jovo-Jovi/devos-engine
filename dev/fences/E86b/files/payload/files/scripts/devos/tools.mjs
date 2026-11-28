#!/usr/bin/env node
// E86 (PR-106): the registry of agent tools, one file each in devos/agents/<id>.json: what the cycle needs to install,
// run and read each tool (its install, its command line for each role, its effort, its output format, its role files,
// its key names and its local sign-in check). The runners (run-agent.sh, plan-agent.sh, install-agent.sh, accounts.sh,
// role-env.mjs, pins.mjs) read it, so no script names a tool, and a tool that writes one of the known output formats is
// added by adding its file. It reads the devos/agents/ at the root its own scripts/ folder is in: a trusted job's copy
// ($T) reads main's. It prints names, never a credential's value.
//   node scripts/devos/tools.mjs ids                                   the tools, one line
//   node scripts/devos/tools.mjs check                                 every file against the rules below
//   node scripts/devos/tools.mjs args --tool T --role builder|reviewer|planner|models [--model M] [--effort E]
//        [--turns N] [--schema <file>] [--last <file>] [--prompt <file>]   the command line, NUL-separated
//   node scripts/devos/tools.mjs shell --tool T                        the tool's names, as shell assignments
//   node scripts/devos/tools.mjs setup --tool T                        its files in $HOME; its env, NAME=value lines
//   node scripts/devos/tools.mjs install --tool T                      npm <package> | checked-package <url> <entry> <bin>…
//   node scripts/devos/tools.mjs get --tool T <field>                  one field: name, label, command, effort, parser…
//   node scripts/devos/tools.mjs missing-key --tool T                  the error a run without its key prints
//   node scripts/devos/tools.mjs of <command>                          the tool a command belongs to (agent → cursor)
//   node scripts/devos/tools.mjs slots                                 every tool's account slots (CURSOR_KEY_1 …)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AGENTS_DIR = path.join(ROOT, "devos", "agents");
export const ROLES = ["builder", "reviewer", "planner"];
export const PARSERS = ["claude", "cursor", "codex", "gemini"];
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const NAME = /^[A-Z][A-Z0-9_]{0,60}$/;
const COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;
const PLACEHOLDERS = ["model", "effort", "turns", "schema", "last", "prompt"];

let cache = null;

/** Every tool file, checked; a file with a problem is left out, and `check` names it. */
function load() {
  if (cache) return cache;
  cache = new Map();
  let names = [];
  try { names = readdirSync(AGENTS_DIR).filter((name) => name.endsWith(".json")).sort(); } catch { names = []; }
  for (const name of names) {
    let value;
    try { value = JSON.parse(readFileSync(path.join(AGENTS_DIR, name), "utf8")); } catch { continue; }
    if (problems(value, name).length === 0) cache.set(value.id, value);
  }
  return cache;
}

/** What is wrong with one tool file, as sentences; none when it is right. */
export function problems(t, file = "") {
  const out = [];
  const bad = (text) => out.push(`${file || t?.id || "a tool"}: ${text}`);
  if (!t || typeof t !== "object") return [`${file}: not a JSON object`];
  if (!ID.test(String(t.id ?? ""))) bad("id must be lower-case letters, digits and hyphens");
  if (file && `${t.id}.json` !== file) bad(`its file must be named ${t.id}.json`);
  for (const key of ["name", "label"]) if (typeof t[key] !== "string" || !t[key].trim()) bad(`${key} must be a name`);
  if (t.provider != null && typeof t.provider !== "string") bad("provider must be a name or null");
  if (!COMMAND.test(String(t.command ?? ""))) bad("command must be the CLI's command name");
  if (!Array.isArray(t.commands) || !t.commands.includes(t.command) || !t.commands.every((c) => COMMAND.test(String(c)))) bad("commands must list the command and any other name the CLI goes by");
  const inst = t.install ?? {};
  if (inst.kind === "npm") {
    if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(String(inst.package ?? ""))) bad("install.package must be an npm package name");
  } else if (inst.kind === "checked-package") {
    if (!/^https:\/\/[^\s]+\{version\}[^\s]*$/.test(String(inst.url ?? ""))) bad("install.url must be an https URL with {version}");
    if (!COMMAND.test(String(inst.entry ?? "")) || !Array.isArray(inst.bins) || !inst.bins.length || !inst.bins.every((b) => COMMAND.test(String(b)))) bad("install.entry and install.bins must be command names");
  } else bad("install.kind must be npm or checked-package (a download checked by its SHA-256)");
  if (!["flag", "model", "none"].includes(t.effort)) bad("effort must be flag, model or none");
  if (!Array.isArray(t.efforts) || (t.effort === "flag") !== t.efforts.length > 0) bad("efforts must list the levels a flag takes, and be empty otherwise");
  if (typeof t.fast !== "boolean") bad("fast must be true or false");
  if (!PARSERS.includes(t.parser)) bad(`parser must be one of ${PARSERS.join(", ")}`);
  if (!["schema", "file"].includes(t.answer)) bad("answer must be schema (the CLI takes the schema) or file (the answer is written to a file)");
  if (typeof t.stdin !== "boolean") bad("stdin must be true or false");
  const k = t.keys ?? {};
  for (const key of ["secret", "env", "cli", "account"]) if (!NAME.test(String(k[key] ?? ""))) bad(`keys.${key} must be an upper-case name`);
  if (k.alt != null) for (const key of ["secret", "env", "cli"]) if (!NAME.test(String(k.alt[key] ?? ""))) bad(`keys.alt.${key} must be an upper-case name`);
  if (!Array.isArray(k.unset) || !k.unset.every((n) => NAME.test(String(n)))) bad("keys.unset must list upper-case names");
  const s = t.setup ?? {};
  if (!s.env || typeof s.env !== "object" || !Object.entries(s.env).every(([n, v]) => NAME.test(n) && /^[A-Za-z0-9._-]*$/.test(String(v)))) bad("setup.env must map upper-case names to plain values");
  const rel = (p) => typeof p === "string" && p !== "" && !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..");
  if (!Array.isArray(s.home) || !s.home.every((h) => rel(h?.from) && rel(h?.to))) bad("setup.home must list {from, to} relative paths");
  for (const [role, kit] of Object.entries(t.kits ?? {})) {
    if (!ROLES.includes(role)) bad(`kits.${role}: a kit is for builder, reviewer or planner`);
    if (!Array.isArray(kit?.move) || !kit.move.every(rel) || !Array.isArray(kit?.install) || !kit.install.every((i) => rel(i?.from) && rel(i?.to))) bad(`kits.${role} must have move and install lists of relative paths`);
  }
  for (const role of ROLES) {
    const args = t.run?.[role];
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) { bad(`run.${role} must be a list of arguments`); continue; }
    for (const a of args) for (const m of a.matchAll(/\{([a-z]+)\}/g)) if (!PLACEHOLDERS.includes(m[1])) bad(`run.${role}: {${m[1]}} is not one of ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`);
  }
  if (typeof t.login !== "string" || !t.login) bad("login must name the local sign-in check");
  return out;
}

export const toolIds = () => [...load().keys()];
/** A tool's file, or null for an id the registry has no file for. */
export const tool = (id) => load().get(String(id ?? "")) ?? null;
export const takesEffort = (id) => tool(id)?.effort === "flag";
export const effortsFor = (id) => (takesEffort(id) ? [...tool(id).efforts] : []);
export const parserOf = (id) => tool(id)?.parser ?? "";

/** The tool a command name belongs to (agent → cursor), or the command's own name. */
export function toolOf(command) {
  const base = path.basename(String(command ?? "")).replace(/\.(cmd|exe)$/i, "");
  for (const t of load().values()) if (t.commands.includes(base)) return t.id;
  return base;
}

const list = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`);

/** A tool's command line for a role, as an argument list: its command first. */
export function render(id, role, vars = {}) {
  const t = tool(id);
  if (!t) throw new Error(`tools: no tool ${id}; one of ${toolIds().join(", ")} (devos/agents/)`);
  const args = t.run?.[role];
  if (!Array.isArray(args)) throw new Error(`tools: ${t.label} has no ${role} command line (devos/agents/${id}.json)`);
  // PR-99: a tool that takes an effort runs at the developer's; there is no effort of the engine's to fall back on.
  if (t.effort === "flag" && args.some((a) => a.includes("{effort}")) && !t.efforts.includes(vars.effort)) {
    throw new Error(`devos: ${t.label} ${vars.model ?? ""} runs at ${list(t.efforts)}, not ${vars.effort ? `"${vars.effort}"` : "no effort"}; choose its effort in devos/project.json (PR-99)`);
  }
  // The schema is passed as the shell's "$(cat file)" passed it: without its trailing newlines.
  const fill = { ...vars, schema: vars.schema ? readFileSync(vars.schema, "utf8").replace(/\n+$/, "") : "" };
  return [t.command, ...args.map((a) => a.replace(/\{([a-z]+)\}/g, (all, key) => (PLACEHOLDERS.includes(key) ? String(fill[key] ?? "") : all)))];
}

/** Every tool's account slots, the env names accounts.sh reads (CURSOR_KEY_1, CLAUDE_APIKEY_2, …): none reaches an agent. */
export function slotNames() {
  return [...load().values()].flatMap((t) => [t.keys.env, ...(t.keys.alt ? [t.keys.alt.env] : [])]).flatMap((n) => [`${n}_1`, `${n}_2`]);
}

/**
 * E86b (PR-107): the GitHub secrets each tool's first account is named by, and the alternatives' (Claude Code's API
 * key), each once. Every AI job's caller names exactly these, literally: `secrets.<name>` and `secrets.<name>_2`.
 */
export function secretNames() {
  const tools = [...load().values()];
  return { keys: [...new Set(tools.map((t) => t.keys.secret))].sort(), alts: [...new Set(tools.flatMap((t) => (t.keys.alt ? [t.keys.alt.secret] : [])))].sort() };
}

/** E86b (PR-107): the job outputs that name a role's secrets, `<as>_key` and `<as>_alt`; none for no tool. */
export function secretLines(id, as) {
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(String(as))) throw new Error("tools: --as names the role, such as builder");
  const t = id ? tool(id) : null;
  if (id && !t) throw new Error(`tools: no tool "${id}"; one of ${toolIds().join(", ")} (devos/agents/)`);
  return [`${as}_key=${t?.keys.secret ?? ""}`, `${as}_alt=${t?.keys.alt?.secret ?? ""}`];
}

/** The text a run without the tool's key stops with. */
export function missingKey(id) {
  const t = tool(id);
  if (!t) return `no tool ${id}`;
  const k = t.keys;
  return `no ${t.name} key: set secret ${k.secret}${k.alt ? ` or ${k.alt.secret}` : ""} (and optionally ${k.secret}_2${k.alt ? ` or ${k.alt.secret}_2` : ""})`;
}

function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? (argv[at + 1] ?? "") : "";
}

function main(argv) {
  const command = argv[0];
  const id = flag(argv, "tool");
  const need = () => {
    const t = tool(id);
    if (!t) throw new Error(`tools: no tool ${id ? `"${id}"` : ""}; one of ${toolIds().join(", ")} (devos/agents/)`);
    return t;
  };
  if (command === "ids") return console.log(toolIds().join(" "));
  if (command === "check") {
    let names = [];
    try { names = readdirSync(AGENTS_DIR).filter((name) => name.endsWith(".json")).sort(); } catch { names = []; }
    const found = [];
    for (const name of names) {
      let value = null;
      try { value = JSON.parse(readFileSync(path.join(AGENTS_DIR, name), "utf8")); } catch { found.push(`${name}: not valid JSON`); continue; }
      found.push(...problems(value, name));
    }
    if (found.length) throw new Error(found.join("\n"));
    return console.log(`tools: ${names.length} tools checked (${toolIds().join(", ")})`);
  }
  if (command === "args") {
    const role = flag(argv, "role");
    const t = need();
    if (role === "models") {
      if (!Array.isArray(t.run.models)) throw new Error(`tools: ${t.label} lists no models`);
      for (const a of [t.command, ...t.run.models]) process.stdout.write(`${a}\0`);
      return;
    }
    if (!ROLES.includes(role)) throw new Error(`tools: --role must be ${ROLES.join(", ")} or models`);
    const vars = Object.fromEntries(PLACEHOLDERS.map((key) => [key, flag(argv, key)]));
    for (const a of render(t.id, role, vars)) process.stdout.write(`${a}\0`);
    return;
  }
  if (command === "shell") {
    const t = need();
    const k = t.keys;
    const lines = {
      id: t.id, name: t.name, label: t.label, command: t.command, stdin: t.stdin ? "1" : "", answer: t.answer, effort: t.effort,
      env: k.env, cli: k.cli, alt_env: k.alt?.env ?? "", alt_cli: k.alt?.cli ?? "", unset: k.unset.join(" "), account: k.account,
    };
    for (const [key, value] of Object.entries(lines)) console.log(`devos_t_${key}='${String(value).replaceAll("'", "")}'`);
    return;
  }
  if (command === "setup") {
    const t = need();
    const home = process.env.HOME ?? "";
    for (const item of t.setup.home) {
      if (!home) throw new Error("tools: setup needs HOME");
      mkdirSync(path.dirname(path.join(home, item.to)), { recursive: true });
      copyFileSync(path.resolve(item.from), path.join(home, item.to));
    }
    for (const [name, value] of Object.entries(t.setup.env)) console.log(`${name}=${value}`);
    return;
  }
  if (command === "install") {
    const t = need();
    if (t.install.kind === "npm") return console.log(`npm ${t.install.package}`);
    return console.log(`checked-package ${t.install.url} ${t.install.entry} ${t.install.bins.join(" ")}`);
  }
  if (command === "get") {
    const t = need();
    const field = argv.find((a, i) => i > 0 && !a.startsWith("--") && argv[i - 1] !== "--tool");
    const value = t[field];
    if (value === undefined || (typeof value === "object" && value !== null)) throw new Error(`tools: get takes a plain field of devos/agents/${t.id}.json, not ${field}`);
    return console.log(value === true ? "true" : value === false ? "false" : String(value ?? ""));
  }
  if (command === "missing-key") { need(); return console.log(missingKey(id)); }
  if (command === "of") return console.log(toolOf(argv[1] ?? ""));
  if (command === "slots") return console.log(slotNames().join(" "));
  if (command === "secrets") return console.log(secretLines(flag(argv, "tool") ?? "", flag(argv, "as") ?? "").join("\n"));
  throw new Error("usage: tools.mjs ids | check | args --tool T --role R [--model --effort --turns --schema --last --prompt] | shell --tool T | setup --tool T | install --tool T | get --tool T <field> | missing-key --tool T | of <command> | slots | secrets --tool T --as ROLE");
}

const self = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (self) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(error.message.startsWith("usage:") ? 2 : 1);
  }
}
