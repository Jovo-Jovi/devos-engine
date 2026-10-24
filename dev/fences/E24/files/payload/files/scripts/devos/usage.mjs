#!/usr/bin/env node
// The usage record (PR-52): every agent run's tokens, as its tool reports them, and the project's totals.
//   node scripts/devos/usage.mjs record --stage S --command C --model M --out F [--task X] [--attempt N] [--seconds S] [--code C] [--summary]
//       reads the run's output file (F, or F.stream.jsonl when the watchdog kept the stream) and adds one line to
//       .devos/usage/pending.jsonl; --summary also writes the line to the run's summary page
//   node scripts/devos/usage.mjs flush --task X     moves the pending lines to docs/usage/X.jsonl
//   node scripts/devos/usage.mjs report [--write]   prints the totals; --write rebuilds docs/USAGE.md
// A record never fails a run: an output with no usage in it is recorded as "not reported".
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PENDING = path.join(ROOT, ".devos", "usage", "pending.jsonl");
const DIR = path.join(ROOT, "docs", "usage");
const SUMMARY = path.join(ROOT, "docs", "USAGE.md");
const PRICES = path.join(ROOT, "devos", "prices.json");
export const STAGES = ["blueprint", "intake", "revise", "builder", "reviewer", "doctor", "supervisor"];
const TOOLS = { claude: "claude", agent: "cursor", "cursor-agent": "cursor", cursor: "cursor", codex: "codex", gemini: "gemini" };

function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const first = (...values) => values.map(num).find((value) => value !== null) ?? null;

/** Every JSON object in a tool's output: the whole text, or one per line. */
function objects(text) {
  const whole = String(text ?? "").trim();
  if (whole === "") return [];
  try {
    const parsed = JSON.parse(whole);
    if (parsed && typeof parsed === "object") return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    /* one object per line */
  }
  const found = [];
  for (const line of whole.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) found.push(parsed);
    } catch {
      /* not JSON */
    }
  }
  return found;
}

const EMPTY = { input: null, output: null, cache_read: null, cache_write: null, cost_usd: null, seconds: null };

function lastResult(list) {
  return [...list].reverse().find((item) => item.type === "result") ?? (list.length === 1 ? list[0] : null);
}

function claude(list) {
  const r = lastResult(list);
  if (!r) return EMPTY;
  const seconds = num(r.duration_ms) === null ? null : Math.round(r.duration_ms / 1000);
  const cost = num(r.total_cost_usd);
  const models = r.modelUsage && typeof r.modelUsage === "object" ? Object.values(r.modelUsage) : [];
  if (models.length > 0) {
    const sum = (key) => models.reduce((total, item) => total + (num(item?.[key]) ?? 0), 0);
    return { input: sum("inputTokens"), output: sum("outputTokens"), cache_read: sum("cacheReadInputTokens"), cache_write: sum("cacheCreationInputTokens"), cost_usd: cost, seconds };
  }
  const u = r.usage ?? {};
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cache_read: num(u.cache_read_input_tokens),
    cache_write: num(u.cache_creation_input_tokens),
    cost_usd: cost,
    seconds,
  };
}

function cursor(list) {
  const r = lastResult(list);
  if (!r) return EMPTY;
  const u = r.usage && typeof r.usage === "object" ? r.usage : r;
  return {
    input: first(u.inputTokens, u.input_tokens),
    output: first(u.outputTokens, u.output_tokens),
    cache_read: first(u.cacheReadTokens, u.cache_read_tokens, u.cachedInputTokens),
    cache_write: first(u.cacheWriteTokens, u.cache_write_tokens),
    cost_usd: null,
    seconds: num(r.duration_ms) === null ? null : Math.round(r.duration_ms / 1000),
  };
}

function codex(list) {
  const turns = list.filter((item) => item.type === "turn.completed" && item.usage && typeof item.usage === "object");
  if (turns.length === 0) {
    const r = lastResult(list);
    const u = r?.usage ?? {};
    return { ...EMPTY, input: num(u.input_tokens), output: num(u.output_tokens) };
  }
  let input = 0;
  let cached = 0;
  let output = 0;
  for (const turn of turns) {
    input += num(turn.usage.input_tokens) ?? 0;
    cached += num(turn.usage.cached_input_tokens) ?? 0;
    output += num(turn.usage.output_tokens) ?? 0;
  }
  // Codex counts cached tokens inside input_tokens: the record keeps them apart.
  return { ...EMPTY, input: Math.max(0, input - cached), output, cache_read: cached, cache_write: 0 };
}

function gemini(list) {
  const r = list.find((item) => item.stats && typeof item.stats === "object");
  const value = r?.stats?.models;
  const models = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
  if (models.length === 0) return EMPTY;
  let prompt = 0;
  let cached = 0;
  let output = 0;
  for (const model of models) {
    const t = model?.tokens ?? {};
    prompt += num(t.prompt) ?? 0;
    cached += num(t.cached) ?? 0;
    output += (num(t.candidates) ?? 0) + (num(t.thoughts) ?? 0);
  }
  // Gemini counts cached tokens inside the prompt, and its thinking is billed as output.
  return { ...EMPTY, input: Math.max(0, prompt - cached), output, cache_read: cached, cache_write: 0 };
}

const PARSERS = { claude, cursor, codex, gemini };

/** The usage in one run's output text, for a tool id (claude, cursor, codex, gemini). */
export function parseUsage(tool, text) {
  const parse = PARSERS[tool];
  if (!parse) return { ...EMPTY };
  try {
    return parse(objects(text));
  } catch {
    return { ...EMPTY };
  }
}

export function toolOf(command) {
  const base = path.basename(String(command ?? "")).replace(/\.(cmd|exe)$/i, "");
  return TOOLS[base] ?? base;
}

function readOutput(out) {
  if (!out) return "";
  const file = path.resolve(out);
  for (const candidate of [`${file}.stream.jsonl`, file]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      /* next */
    }
  }
  return "";
}

/** One record, the shape every line of docs/usage/*.jsonl has. */
export function makeRecord({ stage, tool, model, task, attempt, code, seconds, usage, env = process.env, at = new Date().toISOString() }) {
  const reported = usage.input !== null || usage.output !== null;
  const run = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : "";
  return {
    v: 1,
    id: `${env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}.${env.GITHUB_RUN_ATTEMPT || 1}` : "local"}.${stage}.${at}`,
    at,
    stage,
    task: task || "",
    attempt: Number(attempt) || null,
    tool,
    model: model || "auto",
    input: usage.input,
    output: usage.output,
    cache_read: usage.cache_read,
    cache_write: usage.cache_write,
    cost_usd: usage.cost_usd,
    seconds: usage.seconds ?? (Number.isFinite(Number(seconds)) && seconds !== "" ? Number(seconds) : null),
    exit: code === "" || code === undefined || code === null ? null : Number(code),
    reported,
    run,
  };
}

const fmt = (value) => (value === null ? "—" : Math.round(value).toLocaleString("en-US"));

export function oneLine(record) {
  const cost = record.cost_usd === null ? "" : ` · $${record.cost_usd.toFixed(4)}`;
  if (!record.reported) return `usage: ${record.stage} ${record.tool} ${record.model} · not reported`;
  return `usage: ${record.stage} ${record.tool} ${record.model} · in ${fmt(record.input)} · out ${fmt(record.output)} · cache ${fmt(record.cache_read)}/${fmt(record.cache_write)}${cost}`;
}

function pendingLines() {
  if (!existsSync(PENDING)) return [];
  return readFileSync(PENDING, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
}

function record() {
  const stage = flag("stage");
  if (!STAGES.includes(stage)) {
    console.log(`usage: --stage must be one of ${STAGES.join(", ")}; nothing recorded`);
    return;
  }
  const tool = toolOf(flag("command"));
  const usage = parseUsage(tool, readOutput(flag("out")));
  const entry = makeRecord({
    stage,
    tool,
    model: flag("model"),
    task: flag("task", process.env.TASK ?? ""),
    attempt: flag("attempt", process.env.ATTEMPT ?? ""),
    code: flag("code"),
    seconds: flag("seconds"),
    usage,
  });
  mkdirSync(path.dirname(PENDING), { recursive: true });
  appendFileSync(PENDING, `${JSON.stringify(entry)}\n`);
  const line = oneLine(entry);
  console.log(line);
  if (process.argv.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${line}\n`);
  }
}

const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function flush() {
  const task = flag("task", process.env.TASK ?? "");
  if (!FILE.test(task)) {
    console.log(`usage: --task must match ${FILE}; nothing moved`);
    return;
  }
  const lines = pendingLines();
  if (lines.length === 0) {
    console.log("usage: no new run to record");
    return;
  }
  mkdirSync(DIR, { recursive: true });
  appendFileSync(path.join(DIR, `${task}.jsonl`), `${lines.join("\n")}\n`);
  rmSync(PENDING, { force: true });
  console.log(`usage: ${lines.length} run(s) recorded in docs/usage/${task}.jsonl`);
}

/** Every recorded run, once each, oldest first. */
export function readRecords(dir = DIR) {
  if (!existsSync(dir)) return [];
  const seen = new Set();
  const all = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(path.join(dir, name), "utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      if (!item || typeof item !== "object" || seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
  }
  return all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function readPrices(file = PRICES) {
  try {
    const models = JSON.parse(readFileSync(file, "utf8")).models;
    return models && typeof models === "object" ? models : {};
  } catch {
    return null;
  }
}

/** The run's cost: the tool's own figure, else its tokens priced per million, else null. */
export function costOf(item, prices) {
  if (num(item.cost_usd) !== null) return item.cost_usd;
  const price = prices?.[item.model];
  if (!price || !item.reported) return null;
  const rate = (key) => num(price[key]) ?? 0;
  return ((item.input ?? 0) * rate("input") + (item.output ?? 0) * rate("output") + (item.cache_read ?? 0) * rate("cache_read") + (item.cache_write ?? 0) * rate("cache_write")) / 1e6;
}

function group(items, key, prices) {
  const groups = new Map();
  for (const item of items) {
    const name = key(item);
    const g = groups.get(name) ?? { name, runs: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0, priced: 0, unpriced: 0 };
    g.runs += 1;
    for (const field of ["input", "output", "cache_read", "cache_write"]) g[field] += num(item[field]) ?? 0;
    const cost = costOf(item, prices);
    if (cost === null) {
      if (item.reported) g.unpriced += 1;
    } else {
      g.cost += cost;
      g.priced += 1;
    }
    groups.set(name, g);
  }
  return [...groups.values()];
}

function money(g) {
  if (g.priced === 0) return "—";
  const text = `$${g.cost.toFixed(2)}`;
  return g.unpriced > 0 ? `${text} (${g.unpriced} without a price)` : text;
}

function table(head, rows) {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

const COLUMNS = ["Runs", "Input", "Output", "Cache read", "Cache write", "Cost (USD)"];
const cells = (g) => [String(g.runs), fmt(g.input), fmt(g.output), fmt(g.cache_read), fmt(g.cache_write), money(g)];

/** docs/USAGE.md: the totals, by model, by stage and by task. */
export function summary(items, prices) {
  const notReported = items.filter((item) => !item.reported).length;
  const last = items.length > 0 ? items[items.length - 1].at : "—";
  const total = group(items, () => "all", prices)[0] ?? { runs: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost: 0, priced: 0, unpriced: 0 };
  const byModel = group(items, (item) => `${item.tool}\u0000${item.model}`, prices).sort((a, b) => b.cost - a.cost || b.runs - a.runs || a.name.localeCompare(b.name));
  const byStage = group(items, (item) => item.stage, prices).sort((a, b) => STAGES.indexOf(a.name) - STAGES.indexOf(b.name));
  const byTask = group(items, (item) => item.task || "—", prices).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const lines = [
    "# Usage",
    "",
    "Every agent run of this project, totalled from the records in `docs/usage/`: one line per run, written by the runner",
    "(`scripts/devos/usage.mjs`). Never edit those records by hand.",
    "",
    "- **Tokens** are as each tool reported them. Cache read and cache write are kept apart from input.",
    "- **Cost** is the tool's own figure where it gives one (Claude Code). Otherwise it is the tokens priced by",
    "  `devos/prices.json`, which you fill in: US dollars per million tokens, per model. DEV_OS never looks prices up.",
    "  \"—\" means no price is set.",
    "- **Not in these totals:** runs that leave nothing in the repository. They are the gate doctor's and the",
    "  supervisor's second opinions, and a change request answered without a plan. Each shows its usage on its own run",
    "  page or comment.",
    "",
    `Runs: ${items.length} · Not reported: ${notReported} · Last run: ${last}${prices === null ? " · No `devos/prices.json` yet" : ""}`,
    "",
    "## Total",
    "",
    table(COLUMNS, [cells(total)]),
    "",
    "## By model",
    "",
    table(["Tool", "Model", ...COLUMNS], byModel.map((g) => [...g.name.split("\u0000"), ...cells(g)])),
    "",
    "## By stage",
    "",
    table(["Stage", ...COLUMNS], byStage.map((g) => [g.name, ...cells(g)])),
    "",
    "## By task",
    "",
    table(["Task", ...COLUMNS], byTask.map((g) => [g.name, ...cells(g)])),
    "",
  ];
  return lines.join("\n");
}

function report() {
  const text = summary(readRecords(), readPrices());
  if (process.argv.includes("--write")) {
    mkdirSync(path.dirname(SUMMARY), { recursive: true });
    writeFileSync(SUMMARY, text);
    console.log("usage: docs/USAGE.md written");
    return;
  }
  process.stdout.write(text);
}

function main() {
  const command = process.argv[2];
  try {
    if (command === "record") return record();
    if (command === "flush") return flush();
    if (command === "report") return report();
  } catch (error) {
    // The record is a ledger, never a gate: a failure here is printed and the run goes on.
    console.log(`usage: ${command} failed: ${error.message}`);
    return;
  }
  console.error("usage: usage.mjs record --stage S --command C --model M --out F | flush --task X | report [--write]");
  process.exitCode = 2;
}

if (process.argv[1]?.endsWith("usage.mjs")) main();
