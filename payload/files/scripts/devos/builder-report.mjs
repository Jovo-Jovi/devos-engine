#!/usr/bin/env node
// The builder's report for the live progress comment (progress.sh), read from its stream-json output:
//   - its plan: the builder's own to-do list, with what is done, what it is on, and what is left;
//   - its latest note (the last message it wrote);
//   - a timeline, one line per DEVOS_TIMELINE_EVERY seconds (default 600): how many files it read,
//     searches and commands it ran, files it edited, and the commands themselves.
// The timeline is kept in .devos/builder-timeline.json between calls, so each line covers the
// minutes since the previous one. Prints markdown; prints nothing when there is no stream yet.
// Usage: node scripts/devos/builder-report.mjs <stream-file> [state-file]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.argv[2] || ".devos/builder.json";
const stateFile = process.argv[3] || ".devos/builder-timeline.json";
const every = Number(process.env.DEVOS_TIMELINE_EVERY || 600) * 1000;
const keep = 18;

let text = "";
try { text = readFileSync(file, "utf8"); } catch { process.exit(0); }
const events = [];
let ts = 0;
for (const line of text.split("\n")) {
  if (!line.startsWith("{")) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.timestamp_ms) ts = Number(e.timestamp_ms);
  events.push({ e, ts });
}
if (!events.length) process.exit(0);

const root = /^\/home\/runner\/work\/[^/]+\/[^/]+\//;
const short = (s, n = 70) => String(s ?? "").replace(/[\r\n`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const rel = (p) => short(String(p ?? "").replace(root, ""), 80);
const cmd = (c) => short(String(c ?? "").replace(/^(export PATH=\S+\s*(&&|;)\s*)+/, "").replace(/^cd \S+\s*&&\s*/, ""), 70);
const kindOf = (k) => (/read/i.test(k) ? "read" : /grep|glob|search|ls/i.test(k) ? "search" : /shell|terminal|bash/i.test(k) ? "command"
  : /edit|write|delete|patch/i.test(k) ? "edit" : /todo/i.test(k) ? "plan" : "other");

// Plan: the to-do list, merged by id (the CLI sends partial updates with merge: true).
const todos = new Map();
let note = "";
for (const { e } of events) {
  if (e.type === "tool_call" && e.subtype === "started" && e.tool_call?.updateTodosToolCall) {
    const a = e.tool_call.updateTodosToolCall.args || {};
    if (!a.merge) todos.clear();
    for (const t of a.todos || []) todos.set(t.id, { ...(todos.get(t.id) || {}), ...t });
  }
  if (e.type === "assistant") note = (e.message?.content || []).map((c) => c.text || "").join(" ");
}

// Timeline: one line per window.
let state = { last: 0, lines: [] };
try { if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
const first = events.find((x) => x.ts)?.ts || 0;
const now = Math.max(ts, first);
if (!state.last) state.last = first || now;
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
function windowLine(from, to) {
  const n = { read: 0, search: 0, command: 0, edit: 0 };
  const edited = new Set(); const ran = [];
  for (const { e, ts: t } of events) {
    if (!(t > from && t <= to) || e.type !== "tool_call" || e.subtype !== "started") continue;
    const k = Object.keys(e.tool_call || {})[0] || ""; const v = e.tool_call[k] || {}; const a = v.args || {};
    const kind = kindOf(v.name || k);
    if (kind in n) n[kind]++;
    if (kind === "edit" && a.path) edited.add(rel(a.path));
    if (kind === "command" && a.command) ran.push(cmd(a.command));
  }
  const parts = [`${n.read} read`, `${n.search} searches`, `${n.command} commands`, `${n.edit} edits`].join(" · ");
  const ed = edited.size ? ` — edited ${[...edited].slice(0, 4).map((f) => `\`${f}\``).join(", ")}${edited.size > 4 ? ` +${edited.size - 4}` : ""}` : "";
  const r = ran.length ? ` — ran ${ran.slice(-2).map((c) => `\`${c}\``).join(", ")}` : "";
  return `- ${hhmm(from)}–${hhmm(to)} UTC · ${parts}${ed}${r}`;
}
if (now - state.last >= every) {
  state.lines.push(windowLine(state.last, now));
  state.lines = state.lines.slice(-keep);
  state.last = now;
}
try { writeFileSync(stateFile, JSON.stringify(state)); } catch {}

const out = [];
if (todos.size) {
  const list = [...todos.values()];
  const done = list.filter((t) => /COMPLETED/.test(t.status)).length;
  const icon = (s) => (/COMPLETED/.test(s) ? "✅" : /IN_PROGRESS/.test(s) ? "🔄" : /CANCEL/.test(s) ? "✖️" : "⬜");
  out.push(`**Plan (the builder's own to-do list): ${done} of ${list.length} done**`);
  for (const t of list) out.push(`${icon(t.status)} ${short(t.content, 110)}`);
  out.push("");
}
if (note) out.push(`**Latest note:** ${short(note, 300)}`, "");
const current = windowLine(state.last, now + 1).replace(/^- \S+ UTC ·/, `- since ${hhmm(state.last)} UTC (so far) ·`);
out.push(`**Every ${Math.round(every / 60000)} minutes:**`, ...state.lines);
if (!/· 0 read · 0 searches · 0 commands · 0 edits$/.test(current)) out.push(current);
if (!state.lines.length && /· 0 read · 0 searches · 0 commands · 0 edits$/.test(current)) out.push("- (the first line appears after 10 minutes)");
process.stdout.write(out.join("\n") + "\n");
