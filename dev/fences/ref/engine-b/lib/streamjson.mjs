// Interpreter for the stream-json output format (newline-delimited JSON events
// from an agent CLI in print mode; Cursor documents this as
// `--output-format stream-json`). Why this exists: in the plain text format the
// CLI buffers the whole conversation and prints it at exit, so a long writing
// phase looks dead — the developer sees "no output yet" for ten minutes and then
// everything at once. With stream-json the CLI emits one event per line AS it
// happens, and this module turns each event into the same live events the UI and
// terminal already speak:
//   assistant message  -> log lines ([agent] says …)
//   tool_call write    -> a `file` event the progress counter counts
//   tool_call read/shell -> log lines (what the model is doing right now)
//   system init        -> one log line (model + permission mode)
//   result             -> one log line; the full text is NOT repeated (it is the
//                         concatenation of messages already shown live)
// Plain (non-JSON) lines and the engine's own {"event":"file"|"module"} contract
// lines pass through untouched, so a CLI that ignores --output-format still
// behaves exactly like before.

// One interpreter per child process. feed(line) returns an array of events
// (possibly empty); the caller emits them. The raw line is always the caller's
// business — this module never needs it back.
export function createStreamJsonInterpreter() {
  let sawAssistantSay = false;

  const splitLines = (text) => String(text || '').split(/\r?\n/).map((s) => s.trimEnd());

  const describeTool = (tc) => {
    if (!tc || typeof tc !== 'object') return null;
    // Documented shapes: readToolCall / writeToolCall with {args}; "other tools"
    // may use {function:{name, arguments}}. Unknown shapes get a generic line.
    if (tc.readToolCall) {
      const p = tc.readToolCall.args?.path ?? tc.readToolCall.args?.file_path ?? '';
      return { kind: 'read', text: `reads ${p}` };
    }
    if (tc.writeToolCall) {
      const a = tc.writeToolCall.args || {};
      const p = a.path ?? a.file_path ?? '';
      return { kind: 'write', text: `writes ${p}`, path: p, started: tc.writeToolCall.result == null };
    }
    const fn = tc.function || tc.commandToolCall || tc.shellToolCall || null;
    if (fn) {
      const name = fn.name || 'command';
      const args = String(fn.arguments ?? fn.command ?? '').trim();
      const short = args.length > 120 ? `${args.slice(0, 120)}…` : args;
      return { kind: 'command', text: args ? `runs ${name} ${short}` : `runs ${name}` };
    }
    const key = Object.keys(tc)[0];
    return key ? { kind: 'tool', text: `tool: ${key}` } : null;
  };

  return {
    feed(line) {
      const raw = String(line || '');
      const trimmed = raw.trim();
      if (!trimmed) return [];
      if (!trimmed.startsWith('{')) return [{ type: 'log', line: raw, stream: 'agent' }];
      let evt;
      try { evt = JSON.parse(trimmed); } catch { return [{ type: 'log', line: raw, stream: 'agent' }]; }
      if (!evt || typeof evt !== 'object') return [{ type: 'log', line: raw, stream: 'agent' }];

      // The engine's own contract lines ({"event":"file"...}) are not stream-json
      // events; the configuration model prints them between tool calls.
      if (evt.event === 'file') return [{ type: 'file', path: evt.path }];
      if (evt.event === 'module') return [{ type: 'module', id: evt.id }];

      switch (evt.type) {
        case 'system':
          if (evt.subtype === 'init') {
            const bits = ['session started'];
            if (evt.model) bits.push(`model ${evt.model}`);
            if (evt.permissionMode) bits.push(`permission mode ${evt.permissionMode}`);
            return [{ type: 'log', line: bits.join(' · '), stream: 'engine' }];
          }
          return [];
        case 'user':
          return []; // our own prompt; echoing it back is noise
        case 'assistant': {
          const content = evt.message?.content;
          if (!Array.isArray(content)) return [];
          const out = [];
          for (const part of content) {
            if (part && part.type === 'text' && part.text && String(part.text).trim()) {
              sawAssistantSay = true;
              for (const l of splitLines(part.text)) {
                if (l.trim()) out.push({ type: 'log', line: l, stream: 'agent-say' });
              }
            }
          }
          return out;
        }
        case 'tool_call': {
          const d = describeTool(evt.tool_call);
          if (!d) return [];
          const out = [{ type: 'log', line: d.text, stream: 'agent-tool' }];
          // A completed write is a real file on disk: count it as one.
          if (d.kind === 'write' && !d.started) {
            const p = evt.tool_call?.writeToolCall?.result?.success?.path || d.path;
            if (p) out.push({ type: 'file', path: p });
          }
          return out;
        }
        case 'result': {
          // The result text is the concatenation of every assistant message —
          // already streamed live above. Only print it if nothing was said
          // (a CLI that skipped assistant events entirely).
          if (sawAssistantSay || !evt.result) {
            const ms = Number(evt.duration_ms);
            return [{ type: 'log', line: Number.isFinite(ms) && ms > 0 ? `run finished in ${Math.round(ms / 1000)}s` : 'run finished', stream: 'engine' }];
          }
          return splitLines(evt.result)
            .filter((l) => l.trim())
            .map((l) => ({ type: 'log', line: l, stream: 'agent-say' }));
        }
        default:
          return []; // unknown event types are added over time; ignore safely
      }
    },
  };
}
