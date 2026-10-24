// The live events of an agent CLI that streams one JSON object per line: Cursor (`--output-format stream-json`) and
// Claude Code (`--output-format stream-json --verbose`). Each line becomes a step the developer can read, the session
// id, or the agent's own final result.
import path from "node:path";

const KINDS = [
  [/todo/i, "plan"],
  [/read|view|cat/i, "read"],
  [/write|edit|patch|create|delete|move|replace/i, "write"],
  [/shell|bash|command|terminal|exec/i, "run"],
  [/grep|glob|search|find|^ls|list/i, "search"],
  [/web|fetch|url|browse/i, "web"],
  [/task|agent/i, "helper"],
];
const VERBS = {
  plan: "Updating its plan",
  read: "Reading",
  write: "Writing",
  run: "Running",
  search: "Searching",
  web: "Looking up",
  helper: "Starting a helper:",
};

function kindOf(name) {
  for (const [pattern, kind] of KINDS) if (pattern.test(name)) return kind;
  return "tool";
}

function oneLine(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** A path inside the project folder is shown relative to it, with forward slashes. */
export function shortPath(value, folder) {
  const text = String(value ?? "");
  if (!folder || !path.isAbsolute(text)) return text;
  const rel = path.relative(folder, text);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return text;
  return rel.split(path.sep).join("/");
}

function target(args, folder) {
  if (!args || typeof args !== "object") return "";
  const value = args.path ?? args.file_path ?? args.filePath ?? args.command ?? args.pattern ?? args.globPattern
    ?? args.query ?? args.url ?? args.description ?? "";
  return oneLine(shortPath(value, folder), 120);
}

function step(name, args, folder) {
  const kind = kindOf(name);
  if (kind === "plan") return { kind, text: VERBS.plan };
  const what = target(args, folder);
  const verb = VERBS[kind] ?? `Using ${name.replace(/ToolCall$/, "")}`;
  return { kind, text: what ? `${verb} ${what}` : verb };
}

/**
 * One stdout line → null (not an event), or `{ session }`, `{ step: { kind, text } }`, `{ steps: [...] }`, or
 * `{ result }` (the agent's terminal result event: its turn is over).
 */
export function streamEvent(line, folder) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;
  if (event.type === "result") return { result: event };
  if (event.type === "system" && event.subtype === "init") return typeof event.session_id === "string" ? { session: event.session_id } : null;
  if (event.type === "tool_call" && event.subtype === "started" && event.tool_call && typeof event.tool_call === "object") {
    const name = Object.keys(event.tool_call)[0] ?? "tool";
    const body = event.tool_call[name] ?? {};
    return { step: step(name, body.args ?? body.arguments ?? {}, folder) };
  }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const steps = [];
    for (const part of event.message.content) {
      if (part?.type === "tool_use") steps.push(step(String(part.name ?? "tool"), part.input ?? {}, folder));
      else if (part?.type === "text" && String(part.text ?? "").trim() !== "") steps.push({ kind: "note", text: oneLine(part.text, 140) });
    }
    return steps.length > 0 ? { steps } : null;
  }
  return null;
}
