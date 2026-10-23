// Consultation: when a built-in continue step (dependencies, init_github) fails
// even after the engine's own attempts, the configuration model is woken ONCE
// with the failure context and answers with a proposal — a diagnosis, a short
// list of non-interactive commands the ENGINE may run, and steps only the
// developer can do (logins, plans, key values). The proposal is always shown to
// the user for approval before anything runs (terminal: y/N; browser: an
// Approve/Decline card). This is the built-in answer to "the config model
// should continue and tell user for any approve of certain solution or fix":
// the model is never called silently, and the engine never applies a fix the
// user has not seen.
import { spawnTool } from './spawn.mjs';
import { runRepairModel } from './configmodel.mjs';

// Stream-json CLIs (Cursor) deliver the reply as NDJSON events — the fenced
// block lives INSIDE a JSON string field, with escaped quotes and "\n" as two
// literal characters. The fence regex alone sees mangled text there. Unwrapping
// every parsed event line's string values restores the real newlines and quotes
// so the block becomes parseable. This was the exact failure on the user's run:
// the model answered perfectly, the parser saw nothing.
function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); }
  else if (value && typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); }
  return out;
}

// Char-scan for balanced {...} objects in free text (string-aware), each yielded
// only when it parses as JSON. Catches models that drop the fences entirely.
function* scanBalancedObjects(text) {
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { yield JSON.parse(text.slice(start, i + 1)); } catch { /* prose, not JSON */ }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
}

function shapeProposal(obj) {
  if (!obj || typeof obj !== 'object' || !(obj.diagnosis || obj.commands || obj.userSteps)) return null;
  return {
    diagnosis: String(obj.diagnosis || '').trim(),
    commands: (Array.isArray(obj.commands) ? obj.commands : [])
      .map((c) => {
        if (typeof c === 'string') return { run: c.trim(), why: '' };
        if (c && typeof c === 'object' && c.run) return { run: String(c.run).trim(), why: String(c.why || '').trim() };
        return null;
      })
      .filter((c) => c && c.run)
      .slice(0, 5),
    userSteps: (Array.isArray(obj.userSteps) ? obj.userSteps : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5),
  };
}

// Find the LAST usable proposal in the model's output and normalize it into
// { diagnosis, commands: [{run, why}], userSteps: [..] }. Returns null when no
// usable block exists (the caller then reports the raw tail instead).
export function parseProposal(lines) {
  const input = (lines || []).map(String);
  // Search order: the raw text first, then every JSON line unwrapped to its
  // string values (stream-json), so "the last proposal wins" survives both.
  const parts = [input.join('\n')];
  for (const line of input) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const strs = collectStrings(JSON.parse(t));
      if (strs.length) parts.push(strs.join('\n'));
    } catch { /* a prose line, not an event */ }
  }
  const text = parts.join('\n');

  const proposals = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    try {
      const shaped = shapeProposal(JSON.parse(m[1]));
      if (shaped) proposals.push(shaped);
    } catch { /* try the next fence up */ }
  }
  if (!proposals.length) {
    // No fences anywhere: a line that is itself the proposal object …
    for (const line of input) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const shaped = shapeProposal(JSON.parse(t));
        if (shaped) proposals.push(shaped);
      } catch { /* not it */ }
    }
  }
  if (!proposals.length) {
    // … or a bare object embedded in prose.
    for (const obj of scanBalancedObjects(text)) {
      const shaped = shapeProposal(obj);
      if (shaped) proposals.push(shaped);
    }
  }
  return proposals.length ? proposals[proposals.length - 1] : null;
}

export function buildConsultPrompt({ stepLabel, errorLines = [], tried = [], projectDir }) {
  return [
    'You are the DEV_OS configuration model. A setup step failed and the engine could not finish it with its own built-in steps. Analyze the failure and propose ONE concrete solution.',
    '',
    `Failed step: ${stepLabel}`,
    `Project folder: ${projectDir}`,
    errorLines.length ? `Exact error output:\n${errorLines.map((l) => `- ${String(l).slice(0, 240)}`).join('\n')}` : 'No error output was captured.',
    tried.length ? `The engine already tried, in order:\n${tried.map((l) => `- ${l}`).join('\n')}` : '',
    '',
    'Reply with one short analysis sentence and then EXACTLY ONE fenced JSON block with this shape:',
    '```json',
    '{"diagnosis":"why this failed, one or two sentences","commands":[{"run":"a single local non-interactive shell command","why":"what it fixes"}],"userSteps":["only steps that need the developer: logins, plans, key values"]}',
    '```',
    'Rules: at most 5 commands. Commands run locally in the project folder with the developer\'s approval; they must be non-interactive and safe (no deletions, no secret values, no prompts that wait for input). If the real fix needs a login, a plan change, or a key value, put it in userSteps instead. Do not modify project files in this consultation — analysis and proposal only.',
  ].filter(Boolean).join('\n');
}

// One streamed approved command. Lines go out as stream:'repair' ([fix] prefix)
// so they read differently from model conversation and engine sentences.
function runProposalCommand({ command, projectDir, env, emit }) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return Promise.resolve({ code: -1 });
  return new Promise((resolve) => {
    const feed = (buf) => {
      for (const line of String(buf).split('\n')) {
        if (line.trim()) emit({ type: 'log', line, stream: 'repair' });
      }
    };
    let child;
    try {
      child = spawnTool(parts[0], parts.slice(1), { cwd: projectDir, env });
    } catch {
      return resolve({ code: -1 });
    }
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', () => resolve({ code: -1 }));
    child.on('close', (code) => resolve({ code: code ?? -1 }));
  });
}

// The whole consultation. Returns one of:
//   { consulted:false, reason }                  — nothing to consult (no CLI / no decide)
//   { consulted:true, approved:false, ... }      — model ran but the user declined / unusable / stopped
//   { consulted:true, approved:true, commandsOk, results, proposal }
export async function consultModel({
  projectDir, answers, agent, stepLabel, errorLines = [], tried = [],
  emit = () => {}, shouldStop = null, env = process.env, decide = null,
}) {
  if (!agent) return { consulted: false, reason: 'no configuration-model CLI available to consult' };
  if (typeof decide !== 'function') return { consulted: false, reason: 'no decision channel for the proposal' };
  emit({ type: 'phase', name: 'consulting', step: stepLabel });
  emit({ type: 'log', line: `Asking the configuration model to propose a fix for: ${stepLabel}`, stream: 'engine' });
  const prompt = buildConsultPrompt({ stepLabel, errorLines, tried, projectDir });
  const r = await runRepairModel({ projectDir, answers, agent, prompt, emit, shouldStop, env });
  if (shouldStop && shouldStop()) {
    emit({ type: 'proposal-decision', approve: false, stopped: true });
    return { consulted: true, approved: false, reason: 'stopped by you' };
  }
  if (!r.ok) {
    emit({ type: 'log', line: `The consultation could not run: ${r.message}`, stream: 'engine' });
    return { consulted: true, approved: false, reason: r.message, usageLimit: Boolean(r.usageLimit), trustIssue: Boolean(r.trustIssue), planIssue: Boolean(r.planIssue), permissionIssue: Boolean(r.permissionIssue) };
  }
  const proposal = parseProposal(r.lines);
  if (!proposal) {
    const rawTail = r.lines.map((l) => l.trim()).filter(Boolean).slice(-8);
    emit({ type: 'log', line: 'The model did not return a usable proposal (no JSON block) — nothing was applied.', stream: 'engine' });
    return { consulted: true, approved: false, reason: 'the model returned no parseable proposal', rawTail };
  }
  emit({ type: 'proposal', proposal, step: stepLabel });
  let approved = false;
  try { approved = Boolean(await decide(proposal)); } catch { approved = false; }
  if (shouldStop && shouldStop()) {
    emit({ type: 'proposal-decision', approve: false, stopped: true });
    return { consulted: true, approved: false, proposal, reason: 'stopped by you' };
  }
  emit({ type: 'proposal-decision', approve: approved });
  if (!approved) return { consulted: true, approved: false, proposal };
  emit({ type: 'phase', name: 'applying-fix' });
  const results = [];
  for (const c of proposal.commands) {
    emit({ type: 'log', line: `Running the approved fix: ${c.run}${c.why ? ` — ${c.why}` : ''}`, stream: 'engine' });
    const run = await runProposalCommand({ command: c.run, projectDir, env, emit });
    results.push({ run: c.run, code: run.code });
    if (run.code !== 0) {
      return { consulted: true, approved: true, proposal, commandsOk: false, commandError: `${c.run} exited with code ${run.code}`, results };
    }
  }
  return { consulted: true, approved: true, proposal, commandsOk: true, results };
}
