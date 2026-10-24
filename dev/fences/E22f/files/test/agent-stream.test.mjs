import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { streamEvent } from "../lib/agent-stream.mjs";
import { cleanModelId, groupModels, modelIdsFrom } from "../lib/probes.mjs";
import { heartbeat } from "../lib/progress.mjs";

const folder = path.join(tmpdir(), "devos-stream-project");
const line = (event) => JSON.stringify(event);

test("agent-stream.test.mjs (a) Cursor events become steps, the session and the result", () => {
  const call = (name, args) => line({ type: "tool_call", subtype: "started", call_id: "c", tool_call: { [name]: { args } } });
  assert.deepEqual(streamEvent(line({ type: "system", subtype: "init", session_id: "s-1", model: "Grok" }), folder), { session: "s-1" });
  assert.deepEqual(streamEvent(call("readToolCall", { path: path.join(folder, "docs", "method", "DEV_OS_V2_REVIEWER.md") }), folder), { step: { kind: "read", text: "Reading docs/method/DEV_OS_V2_REVIEWER.md" } });
  assert.deepEqual(streamEvent(call("editToolCall", { path: path.join(folder, "docs", "PHASES.md") }), folder), { step: { kind: "write", text: "Writing docs/PHASES.md" } });
  assert.deepEqual(streamEvent(call("shellToolCall", { command: "npm view vite version" }), folder), { step: { kind: "run", text: "Running npm view vite version" } });
  assert.deepEqual(streamEvent(call("grepToolCall", { pattern: "guard:" }), folder), { step: { kind: "search", text: "Searching guard:" } });
  assert.deepEqual(streamEvent(call("updateTodosToolCall", { todos: [] }), folder), { step: { kind: "plan", text: "Updating its plan" } });
  assert.deepEqual(streamEvent(line({ type: "tool_call", subtype: "completed", call_id: "c", tool_call: { readToolCall: { args: {} } } }), folder), null);
  const result = { type: "result", subtype: "success", is_error: false, result: "done", session_id: "s-1" };
  assert.deepEqual(streamEvent(line(result), folder), { result });
  assert.equal(streamEvent("not json", folder), null);
});

test("agent-stream.test.mjs (b) Claude Code events become steps and notes", () => {
  const event = line({
    type: "assistant",
    message: { content: [
      { type: "text", text: "Reading the handbook first.\nThen the stack." },
      { type: "tool_use", name: "Read", input: { file_path: path.join(folder, "docs", "method", "AUTOMATION.md") } },
      { type: "tool_use", name: "Bash", input: { command: "node scripts/devos/config.mjs --write" } },
      { type: "tool_use", name: "TodoWrite", input: { todos: [] } },
    ] },
  });
  assert.deepEqual(streamEvent(event, folder), { steps: [
    { kind: "note", text: "Reading the handbook first. Then the stack." },
    { kind: "read", text: "Reading docs/method/AUTOMATION.md" },
    { kind: "run", text: "Running node scripts/devos/config.mjs --write" },
    { kind: "plan", text: "Updating its plan" },
  ] });
});

test("agent-stream.test.mjs (c) a model listing gives bare ids", () => {
  const listing = [
    "Available models",
    "",
    "\u001b[1mauto\u001b[0m - Auto",
    "grok-4.7-xhigh-fast - Grok 4.7  Extra High Fast​​",
    "claude-opus-5-5-high - Claude Opus 5.5 High",
    "grok-4.7-xhigh-fast - Grok 4.7 Extra High Fast",
    "",
    "Tip: use --model <id> to switch.",
  ].join("\n");
  assert.deepEqual(modelIdsFrom(listing), ["auto", "grok-4.7-xhigh-fast", "claude-opus-5-5-high"]);
  assert.equal(cleanModelId("grok-4.7-xhigh-fast - Grok 4.7  Extra High Fast​​"), "grok-4.7-xhigh-fast");
  assert.equal(cleanModelId("gpt-5.5-high"), "gpt-5.5-high");
});

test("agent-stream.test.mjs (d) a tool that lists its models offers only those", () => {
  const seeds = [
    { id: "auto", label: "Auto", models: ["auto"] },
    { id: "grok", label: "Grok", models: ["grok-4.7", "grok-4.7-high"] },
  ];
  const listed = groupModels(seeds, ["auto", "grok-4.7-high", "grok-4.7-xhigh-fast"]);
  assert.deepEqual(listed.map((group) => [group.id, group.models.map((model) => model.id)]), [
    ["auto", ["auto"]],
    ["grok", ["grok-4.7-high", "grok-4.7-xhigh-fast"]],
  ]);
  const unlisted = groupModels(seeds, []);
  assert.deepEqual(unlisted.map((group) => group.models.map((model) => model.id)), [["auto"], ["grok-4.7", "grok-4.7-high"]]);
});

test("agent-stream.test.mjs (e) the heartbeat names the agent's last step", () => {
  const lines = [];
  const original = console.log;
  console.log = (text) => lines.push(text);
  let clock = 0;
  const beat = heartbeat({ label: "blueprint running on cursor · auto", folder, everyMs: 5, now: () => clock, detail: () => "Writing docs/PHASES.md" });
  try {
    beat.start();
    clock = 120000;
    return new Promise((resolve) => setTimeout(() => {
      beat.stop();
      console.log = original;
      assert.equal(lines[0], "devos: blueprint running on cursor · auto · 2 min · 0 files under docs/ · Writing docs/PHASES.md");
      resolve();
    }, 30));
  } catch (error) {
    console.log = original;
    throw error;
  }
});
