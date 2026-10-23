// The keys stage — devos owns the WHOLE keys moment now. Why: `devos continue`
// used to print the missing secret names and declare the setup finished, so the
// developer was left alone with a list of tokens and no next step (the exact
// report: "the configuration model has stopped. It is never called again.").
//
// The stage, in order:
//   1. Guard the gitignore — devos/secrets.local.json must never leave the folder.
//   2. Compute the truth from GitHub (gh secret list) + the engine's own records.
//      A model claiming "the keys are set" matches no record and changes nothing.
//   3. Write devos/secrets.local.json — the ONE file where values are pasted.
//      Gitignored, never pushed, never read by the model.
//   4. Produce the organized where-to-get guide: the configuration model writes
//      devos/SECRETS_GUIDE.md when this is an interactive terminal; the engine's
//      built-in catalog is the fallback (and the only writer in scripts/UI runs).
//   5. Upload whatever is already filled: `gh secret set NAME --repo X` with the
//      value piped on stdin — never argv, never chat, never the model.
//   6. In an interactive terminal, WAIT: poll the file, upload each key the
//      moment it is filled, and finish when GitHub confirms every key. Ctrl+C is
//      a safe pause; `devos continue` picks the rest up.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnTool } from './spawn.mjs';
import { readSecretsState, recordSecretStatus } from './secret.mjs';
import { keyCatalog, keySource, listGithubSecrets } from './keys.mjs';
import { runRepairModel } from './configmodel.mjs';

export const KEEP_VALUE = '__keep__';
export const LOCAL_SECRETS_REL = 'devos/secrets.local.json';
export const GUIDE_REL = 'devos/SECRETS_GUIDE.md';
const GITIGNORE_MARK = 'devos/secrets.local.json';
const READ_ME = [
  'Paste each key value between the quotes and save the file.',
  'The engine uploads the values to GitHub (gh secret set) and finishes the setup.',
  'This file is gitignored — it never leaves this folder. The model never sees it.',
  'Set a value to __keep__ ONLY to keep a key that already exists on GitHub.',
].join(' ');

export function localSecretsFile(projectDir) {
  return join(projectDir, ...LOCAL_SECRETS_REL.split('/'));
}

export function guideFile(projectDir) {
  return join(projectDir, ...GUIDE_REL.split('/'));
}

// Values only, names validated, whitespace trimmed, empties skipped. A broken
// JSON file is reported — never silently ignored, the developer must know.
export function readLocalSecrets(projectDir) {
  const f = localSecretsFile(projectDir);
  if (!existsSync(f)) return { ok: true, values: {} };
  let raw;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    return { ok: false, error: `${LOCAL_SECRETS_REL} is not valid JSON (${String(e.message).split('\n')[0]}) — fix it so the engine can read your values.` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${LOCAL_SECRETS_REL} must hold a JSON object of "NAME": "value" pairs.` };
  }
  const values = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue; // _read_me and friends are skipped
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t) values[k] = t;
  }
  return { ok: true, values };
}

// Create or merge the fill-in file. Existing values are preserved; every needed
// name gets an empty entry. Returns the parsed values so callers can push at once.
export function ensureLocalSecretsFile(projectDir, names) {
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  const f = localSecretsFile(projectDir);
  let doc = {};
  if (existsSync(f)) {
    try { doc = JSON.parse(readFileSync(f, 'utf8')) || {}; } catch { doc = {}; }
    if (typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  }
  const created = !existsSync(f);
  const before = JSON.stringify(doc);
  if (!doc._read_me) doc._read_me = READ_ME;
  for (const n of names) {
    if (typeof doc[n] !== 'string') doc[n] = '';
  }
  if (JSON.stringify(doc) !== before || created) {
    writeFileSync(f, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { file: f, created, doc };
}

// The local values file must never enter a commit. Idempotent patch of the
// project .gitignore; runs before EVERY `git add -A` the engine performs
// (init_github and the repair sync) and at the start of the keys stage.
export function ensureGitignored(projectDir) {
  const f = join(projectDir, '.gitignore');
  let text = '';
  if (existsSync(f)) {
    text = readFileSync(f, 'utf8');
    if (/(^|\r?\n)\s*devos\/secrets\.local\.json\s*(\r?\n|$)/.test(text)) return { changed: false, file: f };
  }
  const nl = text.endsWith('\n') || !text ? '' : '\n';
  const block = `${nl}# DEV_OS: local key values — never commit, never push.\n${GITIGNORE_MARK}\n`;
  writeFileSync(f, text + block);
  return { changed: true, file: f };
}

// The upload: the value travels from the local file to gh over stdin only —
// never argv, never a log line, never a chat. The developer's gh login does it.
export function pushSecret({ name, value, repo, projectDir }) {
  return new Promise((resolve) => {
    const child = spawnTool('gh', ['secret', 'set', name, '--repo', repo], {
      cwd: projectDir,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr?.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ ok: false, error: String(e.message) }));
    child.on('close', (code) => {
      resolve(code === 0
        ? { ok: true }
        : { ok: false, error: (err || `gh secret set ${name} exited with code ${code}`).trim() });
    });
    // The writer may fail (fake gh exits before reading) — that is fine, the
    // value dies with the pipe and nothing is logged anywhere.
    child.stdin?.on?.('error', () => {});
    child.stdin?.end?.(String(value));
  });
}

// The truth about keys: needed (the catalog) × GitHub (gh secret list) × the
// engine's records. missing = not on GitHub at all. unconfirmed = on GitHub but
// no engine record of a human-sanctioned set (a model's own `gh secret set`
// lands here — paste the real value or mark __keep__ to keep it).
export function keyStatus({ repo, answers, projectDir, run } = {}) {
  const needed = keyCatalog(answers);
  const listed = listGithubSecrets(repo, { run });
  if (!listed.ok) return { ok: false, error: listed.error };
  const onGithub = new Set(listed.names);
  const entries = readSecretsState(projectDir).entries || {};
  const keys = needed.map((k) => {
    const set = onGithub.has(k.name);
    return { ...k, onGithub: set, confirmed: set && entries[k.name]?.status === 'set' };
  });
  return {
    ok: true,
    keys,
    missing: keys.filter((k) => !k.onGithub).map((k) => k.name),
    unconfirmed: keys.filter((k) => k.onGithub && !k.confirmed).map((k) => k.name),
    confirmedCount: keys.filter((k) => k.confirmed).length,
  };
}

// Upload everything the developer already filled. Shared by the wait loop, the
// non-interactive pass, and `devos keys --push`. `__keep__` is honored only for
// keys that already exist on GitHub — for a truly missing key it would upload
// the literal marker as the value.
export async function pushFilledSecrets({ projectDir, answers, repo, say = () => {}, handled = new Set(), pushed = [] }) {
  const status = keyStatus({ repo, answers, projectDir });
  if (!status.ok) return { ok: false, error: status.error };
  const missing = status.missing;
  const unconfirmed = status.unconfirmed;
  const wanted = [...missing, ...unconfirmed];
  const read = readLocalSecrets(projectDir);
  if (!read.ok) { say(read.error); return { ok: false, error: read.error }; }
  for (const name of wanted) {
    if (handled.has(name)) continue;
    const v = read.values[name];
    if (!v) continue;
    if (v === KEEP_VALUE) {
      if (unconfirmed.includes(name)) {
        recordSecretStatus(projectDir, name, 'set', { via: 'keep' });
        say(`kept ${name} as it is on GitHub (marked ${KEEP_VALUE})`);
        handled.add(name);
        if (!pushed.includes(name)) pushed.push(name);
      } else {
        say(`${name}: ${KEEP_VALUE} only keeps a key that already exists on GitHub — ${name} is not there yet, paste the real value.`);
      }
      continue;
    }
    const up = await pushSecret({ name, value: v, repo, projectDir });
    if (!up.ok) {
      say(`could not upload ${name}: ${up.error}`);
      continue; // stays unhandled; `devos continue` / --push retries later
    }
    recordSecretStatus(projectDir, name, 'set', { via: 'local-file' });
    say(`uploaded ${name} to GitHub from ${LOCAL_SECRETS_REL}`);
    handled.add(name);
    if (!pushed.includes(name)) pushed.push(name);
  }
  return { ok: true, pushed, missing, unconfirmed };
}

// The console rendering of the organized steps — the same content the guide
// file carries, compact for the terminal.
export function printKeySteps({ names, unconfirmed, say }) {
  const total = names.length;
  say(`Keys this project still needs — ${total} (full guide: ${GUIDE_REL})`);
  names.forEach((name, i) => {
    const where = keySource(name);
    const mark = unconfirmed.includes(name) ? ' (already on GitHub, but not set from this machine)' : '';
    say(`  ${i + 1}. ${name}${mark}`);
    say(`     where: ${where}`);
    say(`     then : paste the value into ${LOCAL_SECRETS_REL} -> "${name}" and save — the engine uploads it.`);
  });
  say('Values go ONLY into that file (gitignored, never pushed) — never into chat, an issue, or the model.');
  say('A key already on GitHub that you want to keep as is: set its value to __keep__ instead.');
}

// The built-in guide — the deterministic fallback that is ALWAYS available
// (no model, no network). The model-based guide starts from this text.
export function builtInGuideMarkdown({ names, unconfirmed, repo }) {
  const lines = [];
  lines.push('# Keys and tokens — where to get each one');
  lines.push('');
  lines.push(`Written by the DEV_OS engine. Repository: ${repo || 'owner/name'}.`);
  lines.push('');
  lines.push('## How the values travel (never through chat, never through the model)');
  lines.push('');
  lines.push(`1. Get each key where the steps below say.`);
  lines.push(`2. Paste the value into \`${LOCAL_SECRETS_REL}\` in this folder — the field named exactly like the key. The file is gitignored: it is never committed, never pushed.`);
  lines.push('3. Run `devos continue` — the engine uploads every filled key to GitHub (`gh secret set`) and finishes. `devos keys --push` uploads without waiting; `devos keys --check` verifies.');
  lines.push(`A key that already exists on GitHub and is correct: set its value to \`${KEEP_VALUE}\` to keep it.`);
  lines.push('');
  lines.push(`## The keys (${names.length})`);
  lines.push('');
  for (const name of names) {
    const mark = unconfirmed.includes(name)
      ? ' — already on GitHub, but it was not set from this machine; pasting the real value overwrites it safely (or use __keep__)'
      : '';
    lines.push(`### ${name}${mark}`);
    lines.push('');
    lines.push(`- Where to get it: ${keySource(name)}`);
    lines.push(`- Paste it into: \`${LOCAL_SECRETS_REL}\` -> "${name}"`);
    lines.push('');
  }
  lines.push('## Check');
  lines.push('');
  lines.push('```');
  lines.push('devos keys --check     # ready / MISSING per name, from GitHub\'s own list');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function writeBuiltInGuide(projectDir, { names, unconfirmed, repo }) {
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  const f = guideFile(projectDir);
  writeFileSync(f, builtInGuideMarkdown({ names, unconfirmed, repo }));
  return f;
}

// The configuration model's ONE small job: turn the built-in guide into a
// better organized, project-specific walkthrough. It writes exactly one file
// and never comes near a value.
export function buildGuidePrompt({ projectDir, names, unconfirmed, repo }) {
  const base = builtInGuideMarkdown({ names, unconfirmed, repo });
  return `You are the DEV_OS configuration model with ONE small job: write ${GUIDE_REL} — an organized, easy-to-follow guide for the keys this project still needs.

PROJECT DIRECTORY: ${projectDir}
Write ONLY that one file (${GUIDE_REL}). Change nothing else.

ABSOLUTE RULES:
- You never see, hold, invent, or move a key value. The developer pastes values into ${LOCAL_SECRETS_REL}; the ENGINE uploads them. You never run gh, git, or any command, and you never touch that file.
- The guide holds NAMES and INSTRUCTIONS only. Any placeholder looks like <paste-the-value-here>, never like a real token.
- Do not modify the workflows, the project files, or the answers.

WHAT TO WRITE — for EACH key listed below:
1. What it is for in THIS project: one concrete sentence naming the workflow or module that reads it.
2. Where exactly to get it: the URL, the menu path, what to click. Name the cost tier when it matters (free tier ok / paid required / which plan unlocks it).
3. The exact field to paste into: ${LOCAL_SECRETS_REL} -> "NAME".
4. For keys marked as already on GitHub: the value exists but was not set from this machine — pasting the real value overwrites it safely, or ${KEEP_VALUE} keeps it.

BASE FACTS (verified — keep every one of them, expand around them):
${base}

THE KEYS, one line each (cover every one, in this order):
${names.map((n) => `- ${n}: ${keySource(n)}${unconfirmed.includes(n) ? ' (already on GitHub — not set from this machine)' : ''}`).join('\n')}

Organize the guide in the order a developer should work through the keys (fastest first), and end with: save the file, then run \`devos continue\` in this folder — the engine uploads the filled keys and finishes the setup. Ctrl+C is a safe pause.

Write the file now, then end your run.`;
}

// Fold the keys whose confirmation landed during this stage — by the engine's
// upload, by the walkthrough, or by the developer at a request_secret prompt —
// into result.pushed ("set this run"), even when the confirmation happened
// inside a model child.
function foldConfirmed(projectDir, startedAt, result) {
  try {
    const entries = readSecretsState(projectDir).entries || {};
    for (const [name, e] of Object.entries(entries)) {
      if (e && e.status === 'set' && e.at && e.at >= startedAt && !result.pushed.includes(name)) {
        result.pushed.push(name);
      }
    }
  } catch { /* proof bookkeeping only — never fail the stage over it */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The keys-mode memory. The developer's choice between "I paste the values into
// the local file" (mode 'local') and "the model walks me through every key"
// (mode 'model') is remembered per project, so the next `devos continue` simply
// offers the previous choice as the default instead of asking cold.
export function keysModeFile(projectDir) {
  return join(projectDir, 'devos', 'state', 'keys-mode.json');
}

export function readKeysMode(projectDir) {
  try { return JSON.parse(readFileSync(keysModeFile(projectDir), 'utf8')); } catch { return null; }
}

export function recordKeysMode(projectDir, mode) {
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(keysModeFile(projectDir), JSON.stringify({ mode, at: new Date().toISOString() }, null, 2));
}

// The question, rendered. `choose` is an async callback the terminal caller
// provides (readline); EOF/piped stdin answers null and the default wins.
export function keysModeQuestion({ missing, unconfirmed, previous }) {
  const n = missing.length + unconfirmed.length;
  return [
    `Keys: how do you want to set the ${n} still needed?`,
    `  [1] You paste each value into ${LOCAL_SECRETS_REL} — the engine waits and uploads (recommended)`,
    `  [2] The configuration model walks you through every key — you type each value into gh's hidden prompt`,
    previous === 'model' ? 'Choice [1/2, Enter = 2]: ' : 'Choice [1/2, Enter = 1]: ',
  ].join('\n');
}

// The model-driven walkthrough. The configuration model's ONLY tool here is
// request_secret NAME: it asks for each missing key BY NAME, the developer
// types the value into gh's own hidden prompt (stdio inherit — the model never
// sees it, not even the engine sees it), and the model receives set/missing.
export function buildWalkthroughPrompt({ names, unconfirmed, repo }) {
  return `You are the DEV_OS configuration model. ONE job: walk the developer through setting every key below, one at a time.

YOUR ONLY TOOL: request_secret NAME — call it once per key, exactly one name at a time, in the order given. The developer types the value into gh's hidden prompt; you receive "set" or "missing".

ABSOLUTE RULES:
- You never see, hold, print, or invent a value. You never run gh, git, or any shell command. You write no files.
- If request_secret answers "missing", say so plainly (for example: the key was skipped — it can be filled later in devos/secrets.local.json) and move to the next key. Never retry a key more than once.
- If a key is marked "(already on GitHub — not set from this machine)", still request it: the developer either retypes the real value (it overwrites safely) or presses Ctrl+C on that one key to keep what is there.

THE KEYS, in order:
${names.map((n) => `- ${n}: ${keySource(n)}${unconfirmed.includes(n) ? ' (already on GitHub — not set from this machine)' : ''}`).join('\n')}

WHEN DONE, print exactly one line per key:
  set: NAME
  or:  missing: NAME
then end your run.`;
}

// Runs the walkthrough and re-checks the truth afterwards. Returns
// { ok, stopped, setNow, stillMissing, stillUnconfirmed }.
export async function runModelWalkthrough({ projectDir, answers, agent, names, unconfirmed, repo, emit = () => {}, shouldStop = null, env = process.env }) {
  const say = (line) => emit({ type: 'log', line, stream: 'engine' });
  emit({ type: 'phase', name: 'keys-walkthrough' });
  say(`The configuration model walks you through ${names.length} key(s) — each value is typed into gh's own hidden prompt.`);
  const r = await runRepairModel({
    projectDir, answers, agent,
    prompt: buildWalkthroughPrompt({ names, unconfirmed, repo }),
    emit, shouldStop, env,
  });
  if (r.stopped) {
    return { ok: false, stopped: true, message: `Paused during the keys walkthrough. Resume with: devos continue ${projectDir}` };
  }
  if (!r.ok) {
    say('The model could not run the walkthrough — you can still paste the values into devos/secrets.local.json (the engine uploads them).');
  }
  const after = keyStatus({ repo, answers, projectDir });
  const setNow = r.ok && after.ok ? names.filter((n) => !after.missing.includes(n) && !after.unconfirmed.includes(n)) : [];
  return {
    ok: true,
    stopped: false,
    setNow,
    stillMissing: after.ok ? after.missing : names,
    stillUnconfirmed: after.ok ? after.unconfirmed : [],
  };
}

// The orchestrator. waitKeys: true (always wait), false (never wait — UI/scripts),
// 'auto' (wait only in an interactive terminal). keysMode: 'local' | 'model' | null
// (null asks — or falls back to the remembered/default mode when no one can answer).
// choose: async (question) => '1'|'2'|null from the terminal caller.
// requestValues: the UI door — an async callback the wizard server provides. When
// set, the stage ASKS the browser for the missing values instead of ending with
// instructions: every submit is uploaded (gh secret set, value on stdin) and
// checked against GitHub's own list; anything still missing re-opens the intake,
// round after round, until GitHub confirms every key. A value travels
// browser → engine → gh over stdin only: it is never logged, never echoed, never
// sent to any model — only NAMES ever appear in events, messages, or this file.
export async function runSecretsStage({
  projectDir, answers, repo, emit = () => {}, shouldStop = null,
  agent = null, waitKeys = 'auto', pollMs = 2000, maxWaitMs = Infinity,
  env = process.env, choose = null, keysMode = null, requestValues = null,
}) {
  const say = (line) => emit({ type: 'log', line, stream: 'engine' });
  // Snapshot for "set this run": every key the stage confirms — by upload, by
  // the walkthrough, or by the developer at a request_secret prompt — is
  // reported back, even when the confirmation happens inside a model child.
  const startedAt = new Date().toISOString();
  const result = {
    ok: true, pushed: [], missing: [], unconfirmed: [], allSet: false,
    interactive: false, timedOut: false, stopped: false, guidePath: null,
    localFile: null, error: null, gitignoreChanged: false, guideBy: null,
  };
  try {
    // 1) The file with values in it must never be pushable.
    const ig = ensureGitignored(projectDir);
    result.gitignoreChanged = ig.changed;
    if (ig.changed) say(`${LOCAL_SECRETS_REL} is now in .gitignore — it never leaves this folder.`);

    // 2) The truth: GitHub's own list + the engine's records.
    const status = keyStatus({ repo, answers, projectDir });
    if (!status.ok) {
      result.ok = false;
      result.error = `Keys could not be checked: ${status.error}`;
      say(result.error);
      return result;
    }
    if (!status.missing.length && !status.unconfirmed.length) {
      result.allSet = true;
      return result;
    }
    result.missing = status.missing;
    result.unconfirmed = status.unconfirmed;

    // 3) The fill-in file (created/merged, existing values preserved).
    const names = [...status.missing, ...status.unconfirmed];
    const local = ensureLocalSecretsFile(projectDir, names);
    result.localFile = local.file;

    // 4) Wait only where a human is actually watching a terminal.
    const interactive = waitKeys === true
      || (waitKeys !== false && waitKeys !== 'no' && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));
    result.interactive = interactive;

    // 5) The organized guide. The model writes it only in an interactive
    // terminal (scripts and UI runs stay deterministic and model-silent); the
    // built-in catalog is always the fallback and the base material.
    const guidePath = guideFile(projectDir);
    result.guidePath = guidePath;
    let guideReady = false;
    if (interactive && agent) {
      say('The configuration model is writing the organized keys guide (devos/SECRETS_GUIDE.md)…');
      emit({ type: 'phase', name: 'keys-guide' });
      const r = await runRepairModel({
        projectDir, answers, agent,
        prompt: buildGuidePrompt({ projectDir, names, unconfirmed: status.unconfirmed, repo }),
        emit, shouldStop, env,
      });
      if (r.ok && existsSync(guidePath)) { guideReady = true; result.guideBy = 'model'; }
      else if (r.stopped) {
        result.stopped = true;
        result.message = 'Stopped while the configuration model wrote the keys guide. Resume with: devos continue ' + projectDir;
        return result;
      } else {
        say('The model could not write the guide — the built-in guide is used instead.');
      }
    }
    if (!guideReady) {
      writeBuiltInGuide(projectDir, { names, unconfirmed: status.unconfirmed, repo });
      result.guideBy = 'engine';
    }

    // 6) Push whatever is filled already (works in every mode).
    const handled = new Set();
    const first = await pushFilledSecrets({ projectDir, answers, repo, say, handled, pushed: result.pushed });
    if (!first.ok && !first.pushed?.length) {
      // keyStatus failing inside pushFilledSecrets — reported, not fatal.
      say('Nothing could be uploaded this pass.');
    }

    // Re-check the truth after the first upload pass.
    const after = keyStatus({ repo, answers, projectDir });
    const remaining = after.ok ? [...after.missing, ...after.unconfirmed] : names;
    if (after.ok && !after.missing.length && !after.unconfirmed.length) {
      result.allSet = true;
      result.missing = [];
      result.unconfirmed = [];
      foldConfirmed(projectDir, startedAt, result);
      return result;
    }
    result.missing = after.ok ? after.missing : result.missing;
    result.unconfirmed = after.ok ? after.unconfirmed : result.unconfirmed;

    // 7) The organized steps — printed in every mode.
    printKeySteps({ names: remaining, unconfirmed: result.unconfirmed, say });

    // 7b) THE UI INTAKE — the browser door. When the caller offers requestValues
    // (the wizard server does), the stage asks the BROWSER for the real values
    // instead of ending with instructions. Every round: ask (names + where-to-get
    // only) → upload each value over stdin (gh secret set) → re-check GitHub's
    // own list → anything still missing re-opens the intake. The loop runs until
    // GitHub confirms every key, the developer skips, or the run is stopped.
    // Only NAMES cross into events, logs, and messages — never a value.
    if (typeof requestValues === 'function') {
      const maxRounds = 8; // user-driven submits; the cap only guards a broken loop
      for (let round = 1; round <= maxRounds; round += 1) {
        if (shouldStop && shouldStop()) break;
        const cur = keyStatus({ repo, answers, projectDir });
        if (!cur.ok) { say(`Keys could not be re-checked: ${cur.error}`); break; }
        const want = [...cur.missing, ...cur.unconfirmed];
        if (!want.length) {
          result.allSet = true;
          result.missing = [];
          result.unconfirmed = [];
          foldConfirmed(projectDir, startedAt, result);
          say(`All ${names.length} key(s) are on GitHub now. The next devos-cycle run picks them up.`);
          return result;
        }
        emit({ type: 'phase', name: 'keys-intake' });
        const asked = {
          missing: cur.missing,
          unconfirmed: cur.unconfirmed,
          repo,
          round,
          total: names.length,
          sources: Object.fromEntries(want.map((n) => [n, keySource(n)])),
        };
        const values = await requestValues(asked);
        if (shouldStop && shouldStop()) break;
        if (!values || typeof values !== 'object' || Array.isArray(values)) break; // skip / closed window → honest finish below
        let got = 0;
        for (const [name, raw] of Object.entries(values)) {
          if (!want.includes(name)) continue; // only keys this project actually needs
          if (typeof raw !== 'string' || !raw.trim()) continue;
          const v = raw.trim();
          if (v === KEEP_VALUE) {
            if (cur.unconfirmed.includes(name)) {
              recordSecretStatus(projectDir, name, 'set', { via: 'keep' });
              say(`kept ${name} as it is on GitHub (marked ${KEEP_VALUE})`);
              handled.add(name);
              if (!result.pushed.includes(name)) result.pushed.push(name);
              got += 1;
            } else {
              say(`${name}: ${KEEP_VALUE} only keeps a key that already exists on GitHub — ${name} is not there yet, paste the real value.`);
            }
            continue;
          }
          const up = await pushSecret({ name, value: v, repo, projectDir });
          if (!up.ok) { say(`could not upload ${name}: ${up.error}`); continue; }
          recordSecretStatus(projectDir, name, 'set', { via: 'ui-intake' });
          say(`uploaded ${name} to GitHub — the value went straight into the secret; it is in no log, no chat, no model.`);
          handled.add(name);
          if (!result.pushed.includes(name)) result.pushed.push(name);
          got += 1;
        }
        const after = keyStatus({ repo, answers, projectDir });
        if (after.ok && !after.missing.length && !after.unconfirmed.length) {
          result.allSet = true;
          result.missing = [];
          result.unconfirmed = [];
          foldConfirmed(projectDir, startedAt, result);
          say(`All ${names.length} key(s) are on GitHub now. The next devos-cycle run picks them up.`);
          return result;
        }
        if (after.ok) { result.missing = after.missing; result.unconfirmed = after.unconfirmed; }
        if (!got) {
          say('No usable value arrived in that submit — nothing was uploaded. Fill devos/secrets.local.json and run devos continue.');
          break;
        }
        // still missing → the loop asks again, carrying ONLY the names still open
      }
    }

    // 8) Non-interactive: leave clear instructions and finish honestly.
    if (!interactive) {
      say(`Fill ${LOCAL_SECRETS_REL} and run: devos continue (uploads the rest) — or devos keys --push.`);
      return result;
    }

    // 8b) THE CHOICE — who sets the keys. [1] the developer pastes each value
    // into the fill-in file and the engine waits and uploads; [2] the
    // configuration model walks through every key with request_secret and the
    // developer types each value into gh's hidden prompt. The model never sees
    // a value in either path. The choice is remembered per project.
    let mode = keysMode || (readKeysMode(projectDir) || {}).mode || null;
    if (!mode) {
      const answer = choose
        ? await choose(keysModeQuestion({ missing: result.missing, unconfirmed: result.unconfirmed }))
        : null;
      mode = answer === '2' ? 'model' : 'local'; // EOF/closed input → the default
    }
    recordKeysMode(projectDir, mode);
    result.mode = mode;

    if (mode === 'model') {
      const walk = await runModelWalkthrough({
        projectDir, answers, agent,
        names: [...result.missing, ...result.unconfirmed],
        unconfirmed: result.unconfirmed, repo, emit, shouldStop, env,
      });
      if (walk.stopped) {
        result.stopped = true;
        result.message = walk.message;
        return result;
      }
      for (const n of walk.setNow || []) if (!result.pushed.includes(n)) result.pushed.push(n);
      result.walkthrough = true;
      if (!walk.stillMissing.length && !walk.stillUnconfirmed.length) {
        result.allSet = true;
        result.missing = [];
        result.unconfirmed = [];
        foldConfirmed(projectDir, startedAt, result);
        say('Every key is on GitHub now. The next devos-cycle run picks them up.');
        return result;
      }
      result.missing = walk.stillMissing;
      result.unconfirmed = walk.stillUnconfirmed;
      say(`${result.missing.length + result.unconfirmed.length} key(s) are still open — paste them into ${LOCAL_SECRETS_REL} and save; the engine waits and uploads.`);
      printKeySteps({ names: [...result.missing, ...result.unconfirmed], unconfirmed: result.unconfirmed, say });
    }

    // 9) The wait: poll the file, upload the moment a value lands, finish when
    // GitHub confirms every key. Ctrl+C is a safe pause, never a failure.
    // NOTE: this local MUST NOT be called `startedAt` — the stage-start timestamp
    // (line ~402) lives in the function scope, and a same-named const here would
    // shadow it across the WHOLE try block: every earlier foldConfirmed(...) call
    // would hit the temporal dead zone and crash the stage (a real, field-quiet
    // bug — the uploads survived in result.pushed, so continue looked fine while
    // the stage's own bookkeeping was silently lost). The wait clock is its own
    // name; foldConfirmed keeps folding against the stage start on purpose.
    emit({ type: 'phase', name: 'waiting-keys' });
    const waitStartedAt = Date.now();
    let beat = 0;
    while (true) {
      if (shouldStop && shouldStop()) {
        result.stopped = true;
        result.message = `Paused while waiting for keys. Fill ${LOCAL_SECRETS_REL}, then run: devos continue ${projectDir}`;
        return result;
      }
      await sleep(pollMs);
      beat += 1;
      if (shouldStop && shouldStop()) {
        result.stopped = true;
        result.message = `Paused while waiting for keys. Fill ${LOCAL_SECRETS_REL}, then run: devos continue ${projectDir}`;
        return result;
      }
      await pushFilledSecrets({ projectDir, answers, repo, say, handled, pushed: result.pushed });
      const now = keyStatus({ repo, answers, projectDir });
      if (now.ok && !now.missing.length && !now.unconfirmed.length) {
        result.allSet = true;
        result.missing = [];
        result.unconfirmed = [];
        foldConfirmed(projectDir, startedAt, result);
        say(`All ${names.length} key(s) are on GitHub now. The next devos-cycle run picks them up.`);
        return result;
      }
      if (now.ok) {
        result.missing = now.missing;
        result.unconfirmed = now.unconfirmed;
      }
      if (beat % 8 === 0) {
        const left = (now.ok ? now.missing.length + now.unconfirmed.length : names.length);
        say(`waiting — ${left} key(s) left · edit ${LOCAL_SECRETS_REL} and save · Ctrl+C pauses (devos continue resumes)`);
      }
      if (Date.now() - waitStartedAt > maxWaitMs) {
        result.timedOut = true;
        say(`Stopped waiting after ${Math.round((Date.now() - waitStartedAt) / 1000)}s — nothing is lost. Fill ${LOCAL_SECRETS_REL}, then run: devos continue`);
        return result;
      }
    }
  } catch (e) {
    return { ...result, ok: false, error: e.toolMessage || e.message };
  }
}

// `devos keys --push` — the no-wait upload: guard the gitignore, make sure the
// fill-in file exists, push everything filled, report the rest.
export async function pushFromLocalFile({ projectDir, answers, repo, say = () => {} }) {
  const ig = ensureGitignored(projectDir);
  if (ig.changed) say(`${LOCAL_SECRETS_REL} is now in .gitignore — it never leaves this folder.`);
  const status = keyStatus({ repo, answers, projectDir });
  if (!status.ok) return { ok: false, error: status.error, pushed: [], missing: [], unconfirmed: [] };
  const names = [...status.missing, ...status.unconfirmed];
  if (!names.length) return { ok: true, pushed: [], missing: [], unconfirmed: [], allSet: true };
  const local = ensureLocalSecretsFile(projectDir, names);
  const out = await pushFilledSecrets({ projectDir, answers, repo, say });
  const after = keyStatus({ repo, answers, projectDir });
  return {
    ok: true,
    pushed: out.pushed || [],
    missing: after.ok ? after.missing : status.missing,
    unconfirmed: after.ok ? after.unconfirmed : status.unconfirmed,
    allSet: after.ok && !after.missing.length && !after.unconfirmed.length,
    localFile: local.file,
  };
}
