#!/usr/bin/env node
// Generated media (PR-80): makes the items of docs/design/media.json (PR-79) that are still to make, within a budget.
//   node scripts/devos/media.mjs [--budget <usd>] [--only <id,id> | --fence docs/fences/Tnn.md]
// With --fence, the items are the ones the fence's `- Media:` line names (PR-81); a fence with none makes nothing.
// The budget is the authorization: --budget, else DEVOS_MEDIA_BUDGET, else 0. At 0 nothing is generated: each item
// still to make is listed with its estimate. The key is DEVOS_MEDIA_<PROVIDER>_KEY in the environment, read here and
// passed to the provider only, never printed or written. An item is made once: a generated item whose file exists and
// whose request is unchanged is kept. Each made item is written through a .part file, checked, moved into place and
// recorded in the plan at once, so a stopped run loses nothing it finished. A started video's request id is recorded
// before it is polled, so the next run resumes it instead of paying again.
// Exit: 0 (nothing failed), 1 (an item failed), 2 (a bad call: no plan, a broken plan, no key with a budget).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fenceMedia } from "./fence-check.mjs";
import { keyName, provider as providerOf } from "./media-providers/index.mjs";
import { makeRecord } from "./usage.mjs";

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAN = "docs/design/media.json";
const ANSWERS = "devos/answers.json";
const REPORT = ".devos/media-report.md";
const CHANGED = ".devos/media-files.txt";
const LEDGER = "docs/usage/media.jsonl";
const RETRIES = 3;
const RESUME_HOURS = 24;

const SIGNATURES = {
  ".png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  ".jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  ".webp": (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
  ".mp4": (b) => b.length > 12 && b.toString("latin1", 4, 8) === "ftyp",
  ".mp3": (b) => b.length > 3 && (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)),
  ".wav": (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE",
};

const usd = (value) => `$${value.toFixed(2)}`;
const extension = (file) => path.extname(String(file)).toLowerCase();

/** What an item asks the provider for; a change here makes the item again. */
export function requestSha(item) {
  const fields = item.kind === "voice"
    ? { text: item.text, language: item.language, voice: item.voice }
    : { prompt: item.prompt, aspect_ratio: item.aspect_ratio, resolution: item.resolution, quality: item.quality ?? null, duration: item.duration ?? null, audio: item.audio ?? null };
  return createHash("sha256").update(JSON.stringify({ kind: item.kind, ...fields })).digest("hex").slice(0, 16);
}

/** The bytes are the kind of file the name says. */
export function verifyBytes(file, bytes) {
  const check = SIGNATURES[extension(file)];
  return Boolean(bytes && bytes.length > 0 && check && check(bytes));
}

/** A fetch that tries again on 429, a 5xx or a network error: 3 tries, 2, 4 and 8 seconds apart (xAI's advice). */
export function retrying(fetchImpl, sleep) {
  return async (url, init) => {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        if (attempt >= RETRIES) throw new Error(`network: ${error.message}`);
        await sleep(2 ** (attempt + 1) * 1000);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
        await sleep(2 ** (attempt + 1) * 1000);
        continue;
      }
      return response;
    }
  };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

function writePlan(root, plan, changed) {
  const file = path.join(root, PLAN);
  writeFileSync(`${file}.part`, `${JSON.stringify(plan, null, 2)}\n`);
  renameSync(`${file}.part`, file);
  changed?.add(PLAN);
}

/** Whether an item is made already: generated, its file present, and its request unchanged. */
function made(root, item) {
  if (item.status !== "generated") return false;
  if (!existsSync(path.join(root, item.file)) || statSync(path.join(root, item.file)).size === 0) return false;
  return typeof item.prompt_sha !== "string" || item.prompt_sha === requestSha(item);
}

function recentRequest(item, now) {
  if (typeof item.request_id !== "string" || item.request_id === "") return false;
  const at = Date.parse(item.requested_on ?? "");
  return Number.isFinite(at) && now() - at < RESUME_HOURS * 3600 * 1000;
}

/**
 * Make what the plan still needs. Returns { code, lines, spent, results }.
 * options: { root, budget, only, env, fetch, sleep, now }
 */
export async function runMedia(options = {}) {
  const root = options.root ?? HERE;
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const lines = [];
  const changed = new Set();
  const say = (line) => lines.push(line);
  const stop = (line) => ({ code: 2, lines: [...lines, line], spent: 0, results: [], changed: [] });

  if (!existsSync(path.join(root, PLAN))) return stop(`media: no ${PLAN}; generated media is planned by the blueprint (PR-79)`);
  let plan;
  let answers = {};
  try {
    plan = readJson(root, PLAN);
    if (existsSync(path.join(root, ANSWERS))) answers = readJson(root, ANSWERS);
  } catch (error) {
    return stop(`media: ${error.message}`);
  }
  const chosen = answers?.modules?.media;
  const providerId = typeof plan?.provider === "string" ? plan.provider : chosen;
  const provider = providerOf(providerId);
  if (!provider) return stop(`media: no provider "${providerId}"; this engine knows: xai`);
  if (typeof chosen === "string" && chosen !== providerId) return stop(`media: ${PLAN} says ${providerId}, ${ANSWERS} says ${chosen}`);
  const items = Array.isArray(plan?.items) ? plan.items : [];

  const budgetText = options.budget ?? env.DEVOS_MEDIA_BUDGET ?? "0";
  const budget = Number(budgetText === "" ? "0" : budgetText);
  if (!Number.isFinite(budget) || budget < 0) return stop(`media: the budget must be a number of US dollars, 0 or more (got "${budgetText}")`);

  let only = options.only ? String(options.only).split(",").map((id) => id.trim()).filter(Boolean) : null;
  if (options.fence) {
    let named = null;
    try {
      named = fenceMedia(readFileSync(path.join(root, options.fence), "utf8"));
    } catch (error) {
      return stop(`media: ${options.fence}: ${error.message}`);
    }
    if (!named || named.length === 0) return { code: 0, lines: [`media: ${options.fence} names no media`], spent: 0, results: [], changed: [] };
    only = named;
  }
  if (only) {
    const unknown = only.filter((id) => !items.some((item) => item?.id === id));
    if (unknown.length > 0) return stop(`media: not in ${PLAN}: ${unknown.join(", ")}`);
  }
  const wanted = items.filter((item) => item && (!only || only.includes(item.id)));
  const todo = wanted.filter((item) => !made(root, item));
  const kept = wanted.length - todo.length;
  const unmakeable = new Map();
  for (const item of todo) {
    if (!provider.kinds.includes(item.kind)) unmakeable.set(item.id, `${provider.id} makes no ${item.kind}`);
    else if (!(provider.formats[item.kind] ?? []).includes(extension(item.file))) {
      unmakeable.set(item.id, `${provider.id} makes ${item.kind} files ending ${provider.formats[item.kind].join(" or ")}; rename ${item.file} in the plan`);
    }
  }
  const total = todo.filter((item) => !unmakeable.has(item.id)).reduce((sum, item) => sum + (recentRequest(item, now) ? 0 : provider.estimate(item)), 0);
  say(`media: ${provider.id} · budget ${usd(budget)} · ${todo.length} to make, estimated ${usd(total)} · ${kept} already made`);

  if (budget === 0) {
    for (const item of todo) {
      say(unmakeable.has(item.id) ? `- ${item.id} (${item.kind}): cannot be made: ${unmakeable.get(item.id)}` : `- ${item.id} (${item.kind}): estimated ${usd(provider.estimate(item))}`);
    }
    if (todo.length > 0) say("media: the budget is $0, so nothing is generated; set a budget to make these items");
    return { code: 0, lines, spent: 0, results: [], changed: [] };
  }

  const key = env[keyName(provider.id)];
  if (todo.length > 0 && (typeof key !== "string" || key.trim() === "")) return stop(`media: ${keyName(provider.id)} is not set; it is read from the environment only`);
  const ctx = { key, fetch: retrying(options.fetch ?? globalThis.fetch, sleep), sleep, now };
  const scrub = (text) => (key ? String(text).split(key).join("[key]") : String(text));

  let spent = 0;
  const results = [];
  for (const item of todo) {
    if (unmakeable.has(item.id)) {
      results.push({ id: item.id, state: "failed" });
      say(`- ${item.id} (${item.kind}): cannot be made: ${unmakeable.get(item.id)}`);
      continue;
    }
    const resuming = recentRequest(item, now);
    const estimate = resuming ? 0 : provider.estimate(item);
    if (spent + estimate > budget + 1e-9) {
      results.push({ id: item.id, state: "over budget" });
      say(`- ${item.id} (${item.kind}): over budget (estimated ${usd(estimate)}, ${usd(budget - spent)} left)`);
      continue;
    }
    spent += estimate;
    const started = (requestId) => {
      item.request_id = requestId;
      item.requested_on = new Date(now()).toISOString();
      writePlan(root, plan, changed);
    };
    if (!resuming) {
      delete item.request_id;
      delete item.requested_on;
    }
    try {
      const out = await provider.generate(item, { ...ctx, started });
      if (!verifyBytes(item.file, out.bytes)) throw new Error(`the provider's file is not a ${extension(item.file)} file`);
      const target = path.join(root, item.file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(`${target}.part`, out.bytes);
      renameSync(`${target}.part`, target);
      changed.add(item.file);
      spent += out.cost_usd - estimate;
      Object.assign(item, {
        status: "generated",
        model: out.model,
        generated_on: new Date(now()).toISOString().slice(0, 10),
        terms_url: provider.terms_url,
        cost_usd: out.cost_usd,
        cost_source: out.cost_source,
        prompt_sha: requestSha(item),
      });
      delete item.request_id;
      delete item.requested_on;
      delete item.last_error;
      writePlan(root, plan, changed);
      const record = makeRecord({
        stage: "media",
        tool: provider.id,
        model: out.model,
        task: env.TASK ?? "",
        attempt: env.ATTEMPT ?? "",
        code: 0,
        seconds: "",
        usage: { input: null, output: null, cache_read: null, cache_write: null, cost_usd: out.cost_usd, seconds: null },
        env,
        at: new Date(now()).toISOString(),
      });
      mkdirSync(path.dirname(path.join(root, LEDGER)), { recursive: true });
      appendFileSync(path.join(root, LEDGER), `${JSON.stringify({ ...record, item: item.id })}\n`);
      changed.add(LEDGER);
      results.push({ id: item.id, state: "made", cost_usd: out.cost_usd });
      say(`- ${item.id} (${item.kind}): made ${item.file} · ${usd(out.cost_usd)} (${out.cost_source})`);
    } catch (error) {
      const target = path.join(root, item.file);
      rmSync(`${target}.part`, { force: true });
      if (error?.requestId) {
        results.push({ id: item.id, state: "pending" });
        say(`- ${item.id} (${item.kind}): still being made; the next run resumes request ${item.request_id}`);
        continue;
      }
      spent -= estimate;
      item.last_error = scrub(error.message).slice(0, 240);
      writePlan(root, plan, changed);
      results.push({ id: item.id, state: "failed" });
      say(`- ${item.id} (${item.kind}): failed: ${item.last_error}`);
    }
  }
  const count = (state) => results.filter((result) => result.state === state).length;
  say(`media: ${count("made")} made, ${count("failed")} failed, ${count("over budget")} over budget, ${count("pending")} pending · spent ${usd(Math.max(spent, 0))} of ${usd(budget)}`);
  return { code: count("failed") > 0 ? 1 : 0, lines: lines.map(scrub), spent: Math.max(spent, 0), results, changed: [...changed].sort() };
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const result = await runMedia({ budget: flag("budget"), only: flag("only"), fence: flag("fence") });
  const text = `${result.lines.join("\n")}\n`;
  process.stdout.write(text);
  try {
    mkdirSync(path.join(HERE, ".devos"), { recursive: true });
    writeFileSync(path.join(HERE, REPORT), `# Generated media\n\n${text}`);
    // The files this run changed, for the runner's commit (git add --pathspec-from-file).
    writeFileSync(path.join(HERE, CHANGED), result.changed.length > 0 ? `${result.changed.join("\n")}\n` : "");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Generated media\n\n${text}`);
  } catch {
    /* the report is evidence, never a gate */
  }
  process.exitCode = result.code;
}

if (process.argv[1]?.endsWith("media.mjs")) await main();
