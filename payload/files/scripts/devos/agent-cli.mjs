#!/usr/bin/env node
// Codex and Gemini command lines, and their output in the runner's result shape (PR-45).
// The prompt is not an argument: run-agent.sh appends it.
//   node scripts/devos/agent-cli.mjs args --tool T --role builder|reviewer --model M --effort E --last <file>
//   node scripts/devos/agent-cli.mjs normalize --tool T --raw <f> --last <f> --out <f>
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

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

export function cliArgs({ tool, role, model, effort, last }) {
  const E = EFFORTS.has(effort) ? effort : "high";
  if (tool === "codex") {
    const args = ["codex", "exec", "--model", model, "--sandbox", "workspace-write"];
    if (role === "builder") args.push("-c", "sandbox_workspace_write.network_access=true");
    args.push("-c", `model_reasoning_effort="${E}"`, "-c", "mcp_servers.context7.url=\"https://mcp.context7.com/mcp\"", "--json", "-o", last);
    return args;
  }
  if (tool === "gemini") {
    return ["gemini", "--model", model, "--approval-mode", "yolo", "--output-format", "json", "-p"];
  }
  throw new Error(`agent-cli: unknown tool ${tool}`);
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

export function normalize({ tool, rawText, lastText }) {
  if (tool === "codex") return normalizeCodex(rawText, lastText);
  if (tool === "gemini") return normalizeGemini(rawText);
  throw new Error(`agent-cli: unknown tool ${tool}`);
}

function main() {
  const command = process.argv[2];
  if (command === "args") {
    const args = cliArgs({
      tool: flag("tool"),
      role: flag("role"),
      model: flag("model"),
      effort: flag("effort"),
      last: flag("last"),
    });
    for (const item of args) process.stdout.write(`${item}\0`);
    return;
  }
  if (command === "normalize") {
    const raw = flag("raw");
    const stream = `${raw}.stream.jsonl`;
    const rawText = existsSync(stream) ? readFileSync(stream, "utf8") : readFileSync(raw, "utf8");
    const lastPath = flag("last");
    const lastText = lastPath && existsSync(lastPath) ? readFileSync(lastPath, "utf8") : "";
    const out = normalize({ tool: flag("tool"), rawText, lastText });
    writeFileSync(flag("out"), `${JSON.stringify(out)}\n`);
    return;
  }
  console.error("usage: agent-cli.mjs args --tool --role --model --effort --last | normalize --tool --raw <f> --last <f> --out <f>");
  process.exit(2);
}

if (process.argv[1]?.endsWith("agent-cli.mjs")) main();
