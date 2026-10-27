// Recognise "out of plan usage / rate limited / provider overloaded" in agent output (PR-12).
// These are waits, not failures: the task is parked with devos:quota-wait and devos-resume
// re-dispatches it hourly. Keep the patterns broad; a false positive only delays a retry by an hour.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { P } from "./lib.mjs";
import { parseUsage } from "./usage.mjs";

const LIMIT_RE = new RegExp(
  [
    "usage limit", "session limit", "weekly limit", "limit reached", "hit your (\\w+ )?limit", "rate[ _-]?limit", "too many requests", "\\b429\\b",
    "quota", "out of (credits|requests|usage)", "insufficient (credits|balance|quota)", "credit balance",
    "billing", "plan limit", "resets? (at |in )?\\d", "try again (later|in)", "overloaded", "\\b529\\b", "capacity",
  ].join("|"),
  "i",
);

export const readText = (rel) => (existsSync(P(rel)) ? readFileSync(P(rel), "utf8") : "");

/**
 * PR-54: only the end of each text is read. A streamed run (Cursor's stream-json) holds the whole transcript,
 * file contents included, and the patterns are broad: a word like "quota" in a file the agent read is not a limit.
 * A limit message is the last thing a stopped run prints.
 */
export const LIMIT_TAIL = 4000;
export function looksLikeLimit(...texts) {
  return LIMIT_RE.test(texts.filter(Boolean).map((text) => String(text).slice(-LIMIT_TAIL)).join("\n"));
}

// PR-64: a run that stopped because the account cannot use the model it was given: an unknown, retired or
// unlicensed model. The run moves on to the next model (accounts.sh devos_slots) at once; it is not a wait.
const UNAVAILABLE_RE = new RegExp(
  [
    "\\bmodels?\\b[^\\n]{0,80}\\b(not found|not available|unavailable|does not exist|is not supported|not supported|no longer available)",
    "(unknown|invalid|unsupported) model",
    "model_not_found",
    "not_found_error[^\\n]{0,80}\\bmodel",
    "(do not|don't|does not) have access to (the |this )?model",
    "no access to (the |this )?model",
    "cannot use (the |this )?model",
    "issue with the selected model",
    "may not exist or you may not have access",
  ].join("|"),
  "i",
);

/** PR-64: only the end of each text is read, as for a limit (PR-54). */
export function looksUnavailable(...texts) {
  return UNAVAILABLE_RE.test(texts.filter(Boolean).map((text) => String(text).slice(-LIMIT_TAIL)).join("\n"));
}

/**
 * PR-64: did a failed run stop because the account cannot use its model? Only the CLI's own error is read: its error
 * output and a final result or error object. The transcript is not read, so a tool's output (a compiler's "model does not
 * exist") never counts, and a watchdog stop (124 out of time, 125 lost connection, 126 stuck) never does either.
 */
export function modelUnavailable(out, err, exit = "") {
  if (["124", "125", "126"].includes(String(exit))) return false;
  const json = parseJsonLoose(String(out ?? ""));
  if (json?.structured_output) return false;
  if (String(exit) === "0" && json && json.is_error !== true) return false;
  const final = json && (json.type === "result" || json.type === "error" || json.is_error === true || json.error !== undefined)
    ? [json.result, json.message, json.error === undefined ? "" : JSON.stringify(json.error)].filter(Boolean).join("\n")
    : "";
  return looksUnavailable(String(err ?? ""), final);
}

/** True when a run's final result says it finished: a result object with no error flag and no error subtype. */
export function finishedRun(json) {
  if (!json || typeof json !== "object") return false;
  if (json.is_error === true) return false;
  if (/^error/.test(String(json.subtype ?? ""))) return false;
  return json.type === undefined || json.type === "result";
}

/** Marker the devos-resume workflow reads from the PR comments. */
export function resumeMarker(task, attempt, reviewOnly, notBeforeIso = "") {
  return `<!-- devos-resume task=${task} attempt=${attempt} review_only=${reviewOnly ? "true" : "false"}${notBeforeIso ? ` not_before=${notBeforeIso}` : ""} -->`;
}

export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const last = text.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
  try { return last ? JSON.parse(last) : null; } catch { return null; }
}

/**
 * Work out when a usage limit resets from the agent's own message. Understands
 * "resets 12:30pm (UTC)", "resets 3pm", "resets at 18:00", "resets in 2h 15m", "try again in 45
 * minutes" and Claude's "…limit reached|1760112000". Times without a zone are read as UTC, the
 * runner's zone. Returns a Date, or null when nothing parseable is found.
 */
export function parseResetTime(text, now = new Date()) {
  if (!text) return null;
  const epoch = /\|(\d{10})\b/.exec(text);
  if (epoch) return new Date(Number(epoch[1]) * 1000);

  const rel = /(?:resets?|try again)\s+in\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i.exec(text);
  if (rel && (rel[1] || rel[2])) return new Date(now.getTime() + ((Number(rel[1] || 0) * 60) + Number(rel[2] || 0)) * 60000);

  const abs = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (abs) {
    let h = Number(abs[1]);
    const m = Number(abs[2] || 0);
    const ap = abs[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  return null;
}

/** ISO time after which a parked task may be resumed: the parsed reset + 3 minutes, or a default wait. */
export function notBefore(text, defaultMinutes = 60, now = new Date()) {
  const reset = parseResetTime(text, now);
  const t = reset ? reset.getTime() + 3 * 60000 : now.getTime() + defaultMinutes * 60000;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** PR-29: with two accounts both out of usage, the run resumes when the FIRST of them resets.
 *  `tool` is the agent's tool; each account that hit a limit left .devos/limits/<tool>-<n>.txt, and each later model of
 *  the agent (PR-64) .devos/limits/<tool>-<n>-m<k>.txt, so the earliest reset of every slot is found here. */
export function earliestNotBefore(tool, currentText, defaultMinutes = 60, now = new Date()) {
  const dir = P(".devos/limits");
  const texts = [currentText];
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.startsWith(`${tool}-`))) texts.push(readFileSync(`${dir}/${f}`, "utf8"));
  // Only stated reset times compete; the default wait applies when no account stated one.
  const stated = texts.filter((t) => parseResetTime(t, now)).map((t) => notBefore(t, defaultMinutes, now)).sort();
  return stated[0] ?? notBefore("", defaultMinutes, now);
}

/**
 * One line on what an agent run cost (PR-20): minutes, turns, tokens read and written. A tool other than
 * Claude Code keeps its tokens in its own events, so they come from the usage parser (PR-52, PR-54).
 */
export function agentStats(rel, tool = "claude") {
  const text = readText(rel);
  const r = parseJsonLoose(text);
  if (!r || typeof r !== "object" || r.duration_ms == null) return "";
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round((n || 0) / 1000)}k`);
  let read;
  let cached;
  let written;
  if (tool === "claude" && r.usage) {
    const u = r.usage;
    read = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    cached = u.cache_read_input_tokens || 0;
    written = u.output_tokens || 0;
  } else {
    const u = parseUsage(tool, text);
    read = (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0);
    cached = u.cache_read || 0;
    written = u.output || 0;
  }
  return `${Math.round(r.duration_ms / 60000)} min, ${r.num_turns ?? "?"} turns, ${k(read)} tokens read (${k(cached)} from cache), ${k(written)} written`;
}

