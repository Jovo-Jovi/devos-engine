#!/usr/bin/env node
// The reviewer's one tool beyond reading and writing files (PR-90): `fence_check`, the checks of fence-check.mjs
// (PR-58) on a fence in the review workspace. The review runs with no shell, so this small MCP server over stdio is how
// it checks a fence before it is final. It reads files under DEVOS_ROOT only, runs no command and writes nothing.
//
// Usage (from an MCP configuration): node scripts/devos/mcp-devos.mjs   with DEVOS_ROOT=<the review workspace>
import { createInterface } from "node:readline";
import { checkFile } from "./fence-check.mjs";

const TOOL = {
  name: "fence_check",
  description: "Check a fence the way the runner will (scripts/devos/fence-check.mjs): pass the fence's path, e.g. docs/fences/T05.md. Returns each finding, or OK.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "docs/fences/Tnn.md" } }, required: ["path"], additionalProperties: false },
};

/** One JSON-RPC request in, its response out (null for a notification). */
export function answer(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return null;
  const reply = (result) => (msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, result });
  const error = (code, message) => (msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "devos", version: "1" } });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [TOOL] });
    case "tools/call": {
      if (msg.params?.name !== TOOL.name) return error(-32602, `unknown tool ${String(msg.params?.name).slice(0, 40)}`);
      const rel = String(msg.params?.arguments?.path ?? "");
      if (!/^docs\/fences\/T\d{2}\.md$/.test(rel)) {
        return reply({ content: [{ type: "text", text: "fence_check takes a fence path of the form docs/fences/Tnn.md" }], isError: true });
      }
      const findings = checkFile(rel);
      const text = findings.length ? `${findings.map((f) => `${rel}: ${f}`).join("\n")}\nfence-check: ${rel} ${findings.length} finding(s)` : `fence-check: ${rel} OK`;
      return reply({ content: [{ type: "text", text }], isError: false });
    }
    default:
      return msg.method?.startsWith("notifications/") ? null : error(-32601, "method not found");
  }
}

if (process.argv[1] && process.argv[1].endsWith("mcp-devos.mjs")) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`); return; }
    const out = answer(msg);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}
