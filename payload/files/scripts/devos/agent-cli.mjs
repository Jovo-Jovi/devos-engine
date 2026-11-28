#!/usr/bin/env node
// The output of a tool whose format is not the runner's result shape (PR-45: Codex's events, Gemini's JSON), turned
// into it. E86 (PR-106): which format a tool writes is its devos/agents/<id>.json `parser`; its command line is there
// too (tools.mjs args). A tool whose output is already the result shape (Claude Code, Cursor) is left as it is.
//   node scripts/devos/agent-cli.mjs normalize --tool T --raw <f> --last <f> --out <f>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parserOf } from "./tools.mjs";

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

function resultObject(isError, result, input, output) {
  return {
    type: "result",
    subtype: isError ? "error" : "success",
    is_error: isError,
    result,
    usage: { input_tokens: input, output_tokens: output },
  };
}

function normalizeCodex(rawText, lastText) {
  let input = 0;
  let output = 0;
  let isError = false;
  let agentText = "";
  let errorText = "";
  for (const line of String(rawText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") {
      input += Number(event.usage.input_tokens) || 0;
      output += Number(event.usage.output_tokens) || 0;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      isError = true;
      const message = event.error && typeof event.error === "object" ? event.error.message : event.message;
      if (typeof message === "string") errorText = message;
    }
    if (event.type === "item.completed" && event.item && event.item.type === "agent_message" && typeof event.item.text === "string") {
      agentText = event.item.text;
    }
  }
  const last = String(lastText ?? "").trim();
  return resultObject(isError, last || agentText || errorText || "", input, output);
}

function normalizeGemini(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const trimmed = String(rawText).trim();
    return resultObject(true, trimmed.slice(-2000), 0, 0);
  }
  const response = parsed && typeof parsed === "object" ? parsed.response : undefined;
  const error = parsed && typeof parsed === "object" ? parsed.error : undefined;
  const isError = Boolean(error) || typeof response !== "string";
  const message = error && typeof error === "object" ? error.message : undefined;
  const result = response ?? message ?? "";
  let input = 0;
  let output = 0;
  const modelsValue = parsed && parsed.stats ? parsed.stats.models : undefined;
  const models = Array.isArray(modelsValue)
    ? modelsValue
    : modelsValue && typeof modelsValue === "object"
      ? Object.values(modelsValue)
      : [];
  for (const model of models) {
    input += Number(model && model.tokens && model.tokens.prompt) || 0;
    output += Number(model && model.tokens && model.tokens.candidates) || 0;
  }
  return resultObject(isError, result, input, output);
}

/** The formats this file turns into the result shape. */
export const NORMALIZED = { codex: normalizeCodex, gemini: normalizeGemini };

/** A run's output in the result shape, by the format the tool writes. */
export function normalize({ tool, rawText, lastText }) {
  const parse = NORMALIZED[parserOf(tool)];
  if (!parse) throw new Error(`agent-cli: ${tool} writes no format this file reads`);
  return parse(rawText, lastText);
}

function main() {
  const command = process.argv[2];
  if (command === "normalize") {
    // A tool whose output is the result shape already is left as it is.
    if (!NORMALIZED[parserOf(flag("tool"))]) return;
    const raw = flag("raw");
    const stream = `${raw}.stream.jsonl`;
    const rawText = existsSync(stream) ? readFileSync(stream, "utf8") : readFileSync(raw, "utf8");
    const lastPath = flag("last");
    const lastText = lastPath && existsSync(lastPath) ? readFileSync(lastPath, "utf8") : "";
    const out = normalize({ tool: flag("tool"), rawText, lastText });
    writeFileSync(flag("out"), `${JSON.stringify(out)}\n`);
    return;
  }
  console.error("usage: agent-cli.mjs normalize --tool T --raw <f> --last <f> --out <f>");
  process.exit(2);
}

if (process.argv[1]?.endsWith("agent-cli.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
