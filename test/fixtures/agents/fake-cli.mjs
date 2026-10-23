#!/usr/bin/env node
// One fake agent CLI for every tool (claude, agent, codex, gemini, z, muse).
// Behavior: --version, models, auth probes, and a non-interactive prompt mode that
// runs the bootstrap-writer fixture (roles: configuration, builder, reviewer).
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argvName = (process.argv[1] || '').split(/[/\\]/).pop().replace(/\.mjs$/i, '');
const self = argvName === 'fake-cli' ? (process.env.DEVOS_FAKE_SELF || argvName) : argvName;
const argv = process.argv.slice(2);
const logFile = process.env.DEVOS_FAKE_LOG || '/tmp/devos-fake-cli.log';
try { appendFileSync(logFile, JSON.stringify({ cmd: self, argv, env: { role: process.env.DEVOS_ROLE, model: process.env.DEVOS_MODEL, mode: process.env.DEVOS_FAKE_MODE }, at: Date.now() }) + '\n'); } catch {}

const say = (s) => process.stdout.write(`${s}\n`);
const die = (m, c = 1) => { process.stderr.write(`${m}\n`); process.exit(c); };

const VERSIONS = {
  claude: '2.0.14 (Claude Code, fake)',
  agent: '1.2.3 (Cursor CLI, fake)',
  codex: 'codex-cli 1.0.0 (fake)',
  gemini: 'gemini-cli 0.8.0 (fake)',
  z: 'z 1.4.0 (Z.ai GLM CLI, fake)',
  muse: 'muse 0.3.0 (fake)',
};

const MODELS = {
  agent: ['grok-4.7', 'grok-4.7-fast', 'grok-4.7-low', 'grok-4.7-medium', 'grok-4.7-high', 'grok-4.7-xhigh', 'claude-sonnet-5-5', 'gpt-5.1', 'gemini-2.5-pro', 'composer-1', 'weird-model-9'],
  z: ['glm-4.6', 'glm-5'],
  muse: ['muse-1'],
};

if (argv.includes('--version') || argv.includes('-v')) { say(VERSIONS[self] || 'fake 1.0'); process.exit(0); }
if (self === 'claude' && argv[0] === 'auth' && argv[1] === 'status') {
  if (process.env.DEVOS_CLAUDE_SIGNED_OUT === '1') die('claude: not logged in', 1);
  say('Logged in via fake claude account');
  process.exit(0);
}
if (self === 'codex' && argv[0] === 'login' && argv[1] === 'status') { say('Logged in using ChatGPT'); say('Account: marco@example.com (Pro)'); process.exit(0); }
// Account probe for the cursor CLI: `agent status` reports who is signed in and the plan.
if (self === 'agent' && argv[0] === 'status') {
  if (process.env.DEVOS_AGENT_STATUS_FAIL === '1') die('fake agent: status unavailable', 1);
  say(process.env.DEVOS_AGENT_ACCOUNT || 'Signed in as marco@example.com (Pro plan)');
  process.exit(0);
}
if (argv[0] === 'models') {
  // DEVOS_AGENT_MODELS_FAIL=1 mimics the user's real Cursor build: the models
  // probe errors out and answers nothing, so reportedIds stays empty.
  if (process.env.DEVOS_AGENT_MODELS_FAIL === '1') die('fake agent: models unavailable', 1);
  for (const m of process.env.DEVOS_FAKE_MODELS ? process.env.DEVOS_FAKE_MODELS.split('\n') : (MODELS[self] || [])) say(m);
  process.exit(0);
}

const promptMode =
  (self === 'codex' && argv[0] === 'exec') ||
  (self !== 'codex' && argv.includes('-p'));

// DEVOS_FAKE_MODE=untrusted: the fake cursor CLI mimics Cursor's directory-trust gate.
// Without --trust it refuses exactly like the real CLI; with --trust it runs normally,
// which proves the engine passes the flag.
if (process.env.DEVOS_FAKE_MODE === 'untrusted' && self === 'agent' && !argv.includes('--trust')) {
  die([
    'Cursor Agent can execute code and access files in this directory. Do you trust the contents of this directory?',
    'To proceed, you can either:',
    "- Run 'agent' interactively to decide",
    '- Pass --trust, --yolo, or -f if you trust this directory',
  ].join('\n'), 1);
}

// DEVOS_FAKE_MODE=plan-restricted: mimics Cursor's Free-plan wall — any named model
// (an invocation carrying --model) is refused; Auto (no --model flag) runs normally.
if (process.env.DEVOS_FAKE_MODE === 'plan-restricted' && self === 'agent' && argv.includes('--model')) {
  die([
    'ActionRequiredError: Named models unavailable',
    'Free plans can only use Auto. Switch to Auto or upgrade plans to continue.',
    'Error: command failed unexpectedly.',
  ].join('\n'), 1);
}

// DEVOS_FAKE_MODE=needs-force: mimics Cursor's permission wall — print mode only
// PROPOSES changes and rejects every command unless --force is passed. With --force
// the fake runs normally, which proves the engine sends the flag.
if (process.env.DEVOS_FAKE_MODE === 'needs-force' && self === 'agent' && promptMode && !argv.includes('--force')) {
  die([
    'Command execution was rejected on every attempt, including `npm install` and `init_github`.',
    'Pass --force (alias --yolo) to allow commands unless explicitly denied.',
  ].join('\n'), 1);
}

// DEVOS_FAKE_MODE=stream: the fake CLI speaks Cursor's stream-json format —
// NDJSON events (system init, assistant messages, completed write tool calls,
// result) wrapping the ordinary bootstrap-writer output. Proves the engine's
// interpreter: conversation streams live, file events dedupe against the raw
// contract lines, and the run still completes end to end. Also gated on --force
// and --output-format stream-json, proving both flags are sent.
if (process.env.DEVOS_FAKE_MODE === 'stream' && promptMode) {
  if (self === 'agent' && !argv.includes('--force')) die('Command execution was rejected on every attempt. Pass --force.', 1);
  if (self === 'agent' && !argv.includes('stream-json')) die('Expected --output-format stream-json.', 1);
  const writer = join(dirname(fileURLToPath(import.meta.url)), 'bootstrap-writer.mjs');
  const r = spawnSync(process.execPath, [writer], { encoding: 'utf8', env: process.env });
  const sayEvent = (o) => say(JSON.stringify(o));
  sayEvent({ type: 'system', subtype: 'init', apiKeySource: 'login', cwd: process.env.DEVOS_PROJECT_DIR || process.cwd(), session_id: 'fake-session', model: 'Grok 4.7 (fake stream)', permissionMode: 'default' });
  sayEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the answers and scaffolding the project now.\nThis sentence streams live, not at the end.' }] }, session_id: 'fake-session' });
  for (const line of String(r.stdout || '').split('\n').filter(Boolean)) {
    say(line); // the raw contract line passes through untouched
    try {
      const e = JSON.parse(line);
      if (e.event === 'file') {
        sayEvent({ type: 'tool_call', subtype: 'completed', call_id: `w${e.path}`, tool_call: { writeToolCall: { args: { path: e.path }, result: { success: { path: join(process.env.DEVOS_PROJECT_DIR || process.cwd(), e.path), linesCreated: 10, fileSize: 100 } } } }, session_id: 'fake-session' });
      }
    } catch { /* plain line */ }
  }
  if (r.stderr) process.stderr.write(r.stderr);
  sayEvent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The bootstrap is written and GitHub was requested.' }] }, session_id: 'fake-session' });
  sayEvent({ type: 'result', subtype: 'success', duration_ms: 1200, duration_api_ms: 1200, is_error: false, result: 'The bootstrap is written and GitHub was requested.', session_id: 'fake-session' });
  process.exit(r.status ?? 1);
}

// DEVOS_FAKE_MODE=consult: the fake CLI answers a failure consultation — plain
// analysis lines plus EXACTLY ONE fenced JSON proposal (the contract the engine's
// parseProposal expects). Exits 0; the user's approval decision is the engine's
// business, not the CLI's.
if (process.env.DEVOS_FAKE_MODE === 'consult' && promptMode) {
  say('Looking at the failure now.');
  say('The GraphQL reply means gh cannot see a repository under that exact name.');
  say('```json');
  say(JSON.stringify({
    diagnosis: 'gh is not looking at a repository under the exact name — it was created by hand under a different owner, or not created yet.',
    commands: [{ run: process.env.DEVOS_FAKE_CONSULT_CMD || 'git remote -v', why: 'show which remote the engine is aiming at' }],
    userSteps: ['Run gh auth status and confirm the signed-in account'],
  }));
  say('```');
  say('The JSON block above is the proposal.');
  process.exit(0);
}

// DEVOS_FAKE_MODE=hang: the fake CLI starts writing, prints liveness lines, and
// never exits on its own — it exists so the Stop button / Ctrl+C / kill-tree path
// can be tested end to end (the engine must kill it and return a stopped result).
if (process.env.DEVOS_FAKE_MODE === 'hang' && promptMode) {
  say('The model is writing the project…');
  let attempt = 0;
  const beat = setInterval(() => { attempt += 1; say(`Connection lost, reconnecting (attempt ${attempt})...`); }, 250); // live timer: keeps the process alive
  process.stdin.resume(); // ignore the prompt entirely
  await new Promise(() => {}); // never falls through to die(); only the engine's kill ends it
}

// DEVOS_FAKE_MODE=secrets-guide: the fake CLI plays the keys-guide job — reads the
// prompt on stdin, extracts the listed key names (- NAME: lines), and writes
// devos/SECRETS_GUIDE.md into DEVOS_PROJECT_DIR. Proves the stage hands the model
// the right names and accepts its file; a missing file falls back to the built-in.
if (process.env.DEVOS_FAKE_MODE === 'secrets-guide' && promptMode) {
  let prompt = '';
  await new Promise((res) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { prompt += d; });
    process.stdin.on('end', res);
    process.stdin.on('error', res);
  });
  const names = [...prompt.matchAll(/^- ([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
  const dir = process.env.DEVOS_PROJECT_DIR || process.cwd();
  const lines = ['# Keys guide (written by the fake configuration model)', '', 'Paste each value into devos/secrets.local.json; the engine uploads it.', ''];
  for (const n of names) lines.push(`## ${n}`, '', `Where to get ${n}: the provider dashboard (fake steps). Paste into "${n}".`, '');
  writeFileSync(join(dir, 'devos', 'SECRETS_GUIDE.md'), lines.join('\n'));
  say(`Keys guide written for ${names.length} key(s).`);
  process.exit(0);
}

// DEVOS_FAKE_MODE=secrets-walkthrough: the fake CLI plays BOTH model jobs this
// stage can hand it. If the prompt is the GUIDE prompt it writes
// devos/SECRETS_GUIDE.md from the - NAME: lines. If it is the WALKTHROUGH prompt
// (it names request_secret) it calls the request_secret shim once per key — the
// shim runs the engine's internal:request-secret (gh secret set, value on the
// developer's hidden TTY) — and reports set/missing from the shim's answer.
if (process.env.DEVOS_FAKE_MODE === 'secrets-walkthrough' && promptMode) {
  let prompt = '';
  await new Promise((res) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { prompt += d; });
    process.stdin.on('end', res);
    process.stdin.on('error', res);
  });
  const names = [...prompt.matchAll(/^- ([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
  const dir = process.env.DEVOS_PROJECT_DIR || process.cwd();
  if (prompt.includes('request_secret')) {
    for (const n of names) {
      const r = spawnSync('request_secret', [n], { encoding: 'utf8' });
      const missing = /missing/.test(String(r.stdout || ''));
      say(`${missing ? 'missing' : 'set'}: ${n}`);
    }
  } else {
    const lines = ['# Keys guide (written by the fake configuration model)', '', 'Paste each value into devos/secrets.local.json; the engine uploads it.', ''];
    for (const n of names) lines.push(`## ${n}`, '', `Where to get ${n}: the provider dashboard (fake steps). Paste into "${n}".`, '');
    writeFileSync(join(dir, 'devos', 'SECRETS_GUIDE.md'), lines.join('\n'));
    say(`Keys guide written for ${names.length} key(s).`);
  }
  process.exit(0);
}

if (promptMode) {
  const writer = join(dirname(fileURLToPath(import.meta.url)), 'bootstrap-writer.mjs');
  const r = spawnSync(process.execPath, [writer], { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}

die(`fake ${self}: unhandled invocation: ${argv.join(' ')}`);
