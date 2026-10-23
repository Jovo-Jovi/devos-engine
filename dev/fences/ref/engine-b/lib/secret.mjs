import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runToolSync } from './spawn.mjs';

export function stateDir(projectDir) {
  return join(projectDir, 'devos', 'state');
}

export function secretsStateFile(projectDir) {
  return join(stateDir(projectDir), 'secrets.json');
}

export function readSecretsState(projectDir) {
  const f = secretsStateFile(projectDir);
  if (!existsSync(f)) return { schema: 'devos/secrets@1', entries: {} };
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { schema: 'devos/secrets@1', entries: {} }; }
}

function recordSecret(projectDir, name, status) {
  // Only names and set/missing are recorded. The value never reaches disk here.
  recordSecretStatus(projectDir, name, status);
}

// The one recorder for secret STATUS (never values). `extra` carries proof of WHO
// set it: via 'terminal' (the gh prompt), 'local-file' (the engine uploaded from
// devos/secrets.local.json), or 'keep' (the developer confirmed what is already
// on GitHub). The keys stage trusts only engine-recorded entries — a model's
// claim that a secret "is set" proves nothing and matches no record here.
export function recordSecretStatus(projectDir, name, status, extra = {}) {
  const st = readSecretsState(projectDir);
  st.entries = st.entries || {};
  st.entries[name] = { status, at: new Date().toISOString(), ...extra };
  mkdirSync(stateDir(projectDir), { recursive: true });
  writeFileSync(secretsStateFile(projectDir), JSON.stringify(st, null, 2));
}

export function initStateFile(projectDir) {
  return join(stateDir(projectDir), 'init.json');
}

export function readInitState(projectDir) {
  const f = initStateFile(projectDir);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

// Proof that the chosen configuration model actually RAN on this machine: the
// CLI exited 0 while driving this exact model name. The audit uses it so a CLI
// that never answers `agent models` (several Cursor builds) stops parking the
// chosen model at "unverified — you fix" after the model has demonstrably worked.
export function modelRunFile(projectDir) {
  return join(stateDir(projectDir), 'model-run.json');
}

export function recordModelRun({ projectDir, cli, model }) {
  if (!model) return;
  try {
    mkdirSync(stateDir(projectDir), { recursive: true });
    writeFileSync(modelRunFile(projectDir), JSON.stringify({ cli: cli || null, model, at: new Date().toISOString() }, null, 2));
  } catch { /* proof only — never fail a run over it */ }
}

export function readModelRun(projectDir) {
  const f = modelRunFile(projectDir);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

// request_secret NAME — runs `gh secret set NAME --repo owner/slug` with the developer's
// real TTY and with no --body. The model receives only "set" or "missing".
export function runRequestSecret({ projectDir, name, repo }) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    return { ok: false, result: 'missing', message: `Secret name "${name}" must be UPPER_SNAKE_CASE.` };
  }
  const init = readInitState(projectDir);
  if (!init || init.status !== 'done' || !init.repo) {
    return { ok: false, result: 'missing', message: 'Call init_github before request_secret; secrets need the repository.' };
  }
  const target = repo || init.repo;
  // stdio inherit keeps the developer's real TTY; gh prompts for the value itself.
  // On Windows a leftover empty line can only appear when stdin is piped, which this never does.
  const r = runToolSync('gh', ['secret', 'set', name, '--repo', target], {
    cwd: projectDir,
    stdio: 'inherit',
  });
  if (r.status === 0) {
    // via 'terminal': the human typed the value into gh's own hidden prompt —
    // a human-sanctioned set, even though the model asked for it by NAME.
    recordSecretStatus(projectDir, name, 'set', { via: 'terminal' });
    return { ok: true, result: 'set' };
  }
  recordSecretStatus(projectDir, name, 'missing', { via: 'terminal' });
  return { ok: true, result: 'missing', message: `gh secret set ${name} failed (exit ${r.status}).` };
}
