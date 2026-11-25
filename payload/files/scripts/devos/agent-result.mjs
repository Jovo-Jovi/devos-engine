#!/usr/bin/env node
// E85 (PR-101): the output contract of every agent run, whatever ran it. The job that runs an agent turns the tool's
// own output into this one shape, and a job that decides reads only the shape, as data:
//
//   { "contract": 1, "type": "result", "role": "reviewer", "agent": "cursor", "tool": "cursor", "provider": null,
//     "model": "grok-4.7-high", "exit_code": 0, "is_error": false, "subtype": "success", "result": "<final text>",
//     "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0 },
//     "structured_output": { … } | null, "permission_denials": [ … ], "limited": false, "not_before": "<iso>" | null }
//
// `agent` is the execution interface (Cursor, Claude Code, Codex, Gemini CLI: `tool` is the same id, kept for every
// reader before the contract); `provider` is the AI service when the project names one (agents.*.provider), else null;
// `model` is the model id the run used, passed to the agent as it is. The four tools' own outputs are read by the
// parsers that already read them (usage.mjs, limits.mjs, agent-cli.mjs); any other agent's output is read as plain
// text, so an integration that writes this shape itself needs no parser at all.
//
//   node scripts/devos/agent-result.mjs --role <role> --tool <id> --model <id> [--provider <id>] --raw <file>
//        [--err <file>] [--last <file>] [--answer <file>] [--code <exit>] [--limited true] --out <file>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { normalize } from "./agent-cli.mjs";
import { earliestNotBefore, parseJsonLoose } from "./limits.mjs";
import { parseUsage } from "./usage.mjs";

export const CONTRACT = 1;
const RESULT_MAX = 8000;
const read = (file) => (file && existsSync(file) ? readFileSync(file, "utf8") : "");
const count = (value) => (Number.isFinite(value) ? value : 0);

/** The tool's final object, in the runner's result shape (PR-45), or null when it gave none. */
function finalObject(tool, rawText, lastText) {
  if (tool === "codex" || tool === "gemini") {
    try { return normalize({ tool, rawText, lastText }); } catch { return null; }
  }
  if (tool === "claude" || tool === "cursor") {
    const value = parseJsonLoose(String(rawText ?? ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  // An agent the engine has no parser for: a final object of the contract's own shape, or plain text.
  const value = parseJsonLoose(String(rawText ?? ""));
  return value && typeof value === "object" && value.type === "result" ? value : null;
}

/** One run's contract object. */
export function agentResult({ role, tool, model, provider = "", rawText = "", errText = "", lastText = "", answerText = null, code = "", limited = false, now = new Date() }) {
  const final = finalObject(tool, rawText, lastText);
  const exit = /^-?\d+$/.test(String(code)) ? Number(code) : null;
  let structured = final && typeof final.structured_output === "object" ? final.structured_output : null;
  if (!structured && answerText !== null && String(answerText).trim() !== "") {
    try { structured = JSON.parse(answerText); } catch { structured = null; }
  }
  const text = typeof final?.result === "string" ? final.result : (final ? "" : String(rawText ?? "").trim());
  const used = parseUsage(tool, rawText);
  const fromFinal = final?.usage && typeof final.usage === "object" ? final.usage : {};
  const isError = final ? final.is_error === true || /^error/.test(String(final.subtype ?? "")) : exit !== 0;
  const tail = `${String(rawText ?? "").slice(-4000)}\n${String(errText ?? "")}`;
  return {
    contract: CONTRACT,
    type: "result",
    role,
    agent: tool,
    tool,
    provider: provider || null,
    model,
    exit_code: exit,
    is_error: isError,
    subtype: final?.subtype ?? (isError ? "error" : "success"),
    result: text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n[cut at ${RESULT_MAX} characters]` : text,
    usage: {
      input_tokens: count(used.input ?? fromFinal.input_tokens),
      output_tokens: count(used.output ?? fromFinal.output_tokens),
      cache_read_tokens: count(used.cache_read),
      cache_write_tokens: count(used.cache_write),
    },
    structured_output: structured ?? null,
    permission_denials: Array.isArray(final?.permission_denials) ? final.permission_denials.slice(0, 20) : [],
    limited: limited === true,
    not_before: limited === true ? earliestNotBefore(tool, tail, 60, now) : null,
    // The run's own counts, when the tool gives them (verdict.mjs's one line on what a review cost, PR-20).
    ...(Number.isFinite(final?.duration_ms) ? { duration_ms: final.duration_ms } : {}),
    ...(Number.isFinite(final?.num_turns) ? { num_turns: final.num_turns } : {}),
  };
}

function main() {
  const flag = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] ?? "" : "";
  };
  const out = flag("out");
  if (!flag("role") || !flag("tool") || !out) {
    console.error("usage: agent-result.mjs --role <role> --tool <id> --model <id> [--provider <id>] --raw <file> [--err <file>] [--last <file>] [--answer <file>] [--code <exit>] [--limited true] --out <file>");
    process.exit(2);
  }
  const answer = flag("answer");
  const value = agentResult({
    role: flag("role"), tool: flag("tool"), model: flag("model"), provider: flag("provider"),
    rawText: read(flag("raw")), errText: read(flag("err")), lastText: read(flag("last")),
    answerText: answer && existsSync(answer) ? read(answer) : null,
    code: flag("code"), limited: flag("limited") === "true",
  });
  writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
