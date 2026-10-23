// The keys stage — the engine drives the WHOLE keys moment instead of printing
// names and stopping (the exact user report: "the configuration model has
// stopped. It is never called again."). Covered here:
//   - devos/secrets.local.json is created, gitignored, and NEVER pushed;
//   - values pasted into it are uploaded by the engine (gh secret set, value on
//     stdin), recorded with proof, and the run finishes honestly ("fully set up");
//   - an interactive wait picks up values written mid-wait, uploads, and finishes;
//   - Ctrl+C during the wait is a safe pause with a resume path;
//   - non-interactive runs print the organized steps and finish without blocking;
//   - the configuration model writes the organized guide in interactive runs
//     (fake CLI mode), with the built-in catalog as the fallback;
//   - a key pushed behind the engine's back is "unconfirmed" until the developer
//     pastes the value or marks __keep__;
//   - `devos keys --push` uploads without a continue run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { runContinue } = await import('../lib/continue.mjs');
  const { keyCatalog } = await import('../lib/keys.mjs');
  return { t, runInit, runContinue, keyCatalog };
}

const noInstall = async () => ({ code: 0, lines: ['fake install ok'] });

// A project whose repository is done and whose keys are missing — the exact
// state the user's tinytasks run ended in.
async function readyProjectWithMissingKeys(t, runInit) {
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  // The repository step is done (the bootstrap's init_github ran).
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'),
    JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  return { projectDir, draft };
}

function ghStateFile(t) { return join(t.home, 'gh-state.json'); }

test('keys stage: filled values are uploaded by the engine from the local file, and the finish says "fully set up"', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const { projectDir, draft } = await readyProjectWithMissingKeys(t, runInit);

  // The developer pasted every value into the ONE local file before continuing.
  const answers = draft; // runInit finalized into devos/answers.json; names match
  const values = {};
  for (const k of keyCatalog(answers)) values[k.name] = 'paste-the-real-value-here';
  writeFileSync(join(projectDir, 'devos', 'secrets.local.json'), JSON.stringify(values, null, 2));

  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const result = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  delete process.env.DEVOS_GH_STATE;

  assert.equal(result.ok, true, result.message || '');
  assert.equal(result.keysMissing.length, 0, `keys still missing: ${JSON.stringify(result.keysMissing)}`);
  assert.ok(result.keysPushed.length >= 1, `pushed: ${JSON.stringify(result.keysPushed)}`);
  assert.ok(result.finalLine.includes('fully set up'), result.finalLine);
  assert.ok(result.resumed.includes('secrets'), `resumed: ${JSON.stringify(result.resumed)}`);
  // the engine did the upload (gh secret set with the value on stdin — never --body)
  const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'secret' && e.argv[1] === 'set');
  assert.ok(ghLog.length >= 1, 'the engine ran gh secret set');
  for (const call of ghLog) assert.ok(!call.argv.includes('--body'), 'the value never travels as an argument');
  assert.ok(ghLog.some((c) => c.argv[2] === 'CURSOR_API_KEY'), `pushed names: ${JSON.stringify(ghLog.map((c) => c.argv[2]))}`);
  // the state records WHO set it — the engine, from the local file
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
  assert.equal(st.entries.CURSOR_API_KEY.status, 'set');
  assert.equal(st.entries.CURSOR_API_KEY.via, 'local-file');
  cleanupTestEnv(t);
});

test('keys stage: the fill-in file is created, gitignored, and the guide lands with every missing name', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const result = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_GIT_FAKE_PUSH;

  assert.equal(result.ok, true, result.message || '');
  assert.ok(result.keysMissing.includes('CURSOR_API_KEY'), `missing: ${JSON.stringify(result.keysMissing)}`);
  // the fill-in file exists with every needed name and a read-me, no values
  const localFile = join(projectDir, 'devos', 'secrets.local.json');
  assert.ok(existsSync(localFile), 'the fill-in file exists');
  const doc = JSON.parse(readFileSync(localFile, 'utf8'));
  assert.ok(typeof doc._read_me === 'string' && doc._read_me.includes('gitignored'));
  assert.equal(doc.CURSOR_API_KEY, '');
  // the engine itself made sure the file can never be pushed
  const gitignore = readFileSync(join(projectDir, '.gitignore'), 'utf8');
  assert.ok(/devos\/secrets\.local\.json/.test(gitignore), '.gitignore covers the values file');
  // the organized guide exists and lists the missing keys — with no fake values
  const guide = readFileSync(join(projectDir, 'devos', 'SECRETS_GUIDE.md'), 'utf8');
  assert.ok(guide.includes('### CURSOR_API_KEY'), 'the guide has a section per key');
  assert.ok(!/sk-[A-Za-z0-9]{8}|ghp_[A-Za-z0-9]{8}/.test(guide), 'the guide holds no token-looking values');
  // the final line does not claim a finished setup
  assert.ok(result.finalLine.includes('still need you'), result.finalLine);
  assert.ok(result.finalLine.includes('devos/secrets.local.json'), result.finalLine);
  cleanupTestEnv(t);
});

test('keys stage: an interactive wait picks up values written mid-wait, uploads, and finishes', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const { projectDir, draft } = await readyProjectWithMissingKeys(t, runInit);
  // The user fills the file 1.2s in — AFTER the wait phase has begun (the guide
  // run takes ~0.4s and the first upload pass lands before the wait loop).
  const localFile = join(projectDir, 'devos', 'secrets.local.json');
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  writeFileSync(localFile, JSON.stringify({ _read_me: 'x', CURSOR_API_KEY: '' }, null, 2));
  setTimeout(() => {
    const doc = JSON.parse(readFileSync(localFile, 'utf8'));
    for (const k of keyCatalog(draft)) if (k.name in doc || true) doc[k.name] = 'paste-the-real-value-here';
    writeFileSync(localFile, JSON.stringify(doc, null, 2));
  }, 1200);
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const events = [];
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e),
    waitKeys: true, pollMs: 50, maxWaitMs: 8000,
  });
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  delete process.env.DEVOS_GH_STATE;

  assert.equal(result.ok, true, result.message || '');
  assert.ok(result.keysPushed.includes('CURSOR_API_KEY'), `pushed: ${JSON.stringify(result.keysPushed)}`);
  assert.equal(result.keysMissing.length, 0, `still missing: ${JSON.stringify(result.keysMissing)}`);
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'waiting-keys'), 'the wait is a visible phase');
  const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'secret' && e.argv[1] === 'set' && e.argv[2] === 'CURSOR_API_KEY');
  assert.equal(ghLog.length, 1, 'the key was uploaded exactly once');
  cleanupTestEnv(t);
});

test('keys stage: Ctrl+C during the wait is a safe pause with a resume path', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  // Flip stop 1.5s in: after the guide step, squarely inside the wait loop.
  let stopped = false;
  setTimeout(() => { stopped = true; }, 1500);
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: () => {},
    waitKeys: true, pollMs: 50, maxWaitMs: 60_000,
    shouldStop: () => stopped,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stopped, true);
  assert.ok(result.message.includes('devos/secrets.local.json'), result.message);
  assert.ok(result.message.includes('devos continue'), result.message);
  cleanupTestEnv(t);
});

test('keys stage: non-interactive runs never block and print the organized steps', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  const events = [];
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const result = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e) });
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(result.ok, true, result.message || '');
  assert.ok(result.keysMissing.length > 0);
  const engineLines = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line);
  assert.ok(engineLines.some((l) => l.includes('Keys this project still needs')), engineLines.slice(-6).join(' | '));
  assert.ok(engineLines.some((l) => l.includes('where: ') && l.includes('https')), 'each step says where the key comes from');
  assert.ok(engineLines.some((l) => l.includes('paste the value into devos/secrets.local.json')), 'each step names the field to fill');
  assert.ok(engineLines.some((l) => l.includes('devos keys --push')), 'the no-wait upload command is named');
  cleanupTestEnv(t);
});

test('keys stage: the configuration model writes the organized guide; the engine falls back when it cannot', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  process.env.DEVOS_FAKE_MODE = 'secrets-guide';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const events = [];
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e),
    waitKeys: true, pollMs: 20, maxWaitMs: 200, // no values arrive: the wait times out
  });
  delete process.env.DEVOS_FAKE_MODE;
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(result.ok, true, result.message || '');
  const guide = readFileSync(join(projectDir, 'devos', 'SECRETS_GUIDE.md'), 'utf8');
  assert.ok(guide.includes('fake configuration model'), 'the model wrote the guide');
  assert.ok(guide.includes('CURSOR_API_KEY'), 'the guide covers the missing keys');
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'keys-guide'), 'the guide phase is visible');
  cleanupTestEnv(t);
});

test('keys stage: a key pushed behind the engine\'s back is unconfirmed until the developer confirms it', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  // The model (or a human with gh) put a value on GitHub directly: it exists,
  // but no engine record says a human sanctioned it.
  process.env.DEVOS_FAKE_GH_SECRETS = 'CURSOR_API_KEY';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const result = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_FAKE_GH_SECRETS;
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(result.ok, true, result.message || '');
  // not "fully set up": the unconfirmed key still needs the developer
  assert.ok(!result.finalLine.includes('fully set up'), result.finalLine);
  // the fill-in file includes the unconfirmed name so the developer can confirm it
  const localFile = join(projectDir, 'devos', 'secrets.local.json');
  const doc = JSON.parse(readFileSync(localFile, 'utf8'));
  assert.ok('CURSOR_API_KEY' in doc, 'the unconfirmed key is in the fill-in file');
  // __keep__ confirms it without a value. GitHub must still LIST the key in the
  // second run, so the fake secrets env stays for it too.
  doc.CURSOR_API_KEY = '__keep__';
  writeFileSync(localFile, JSON.stringify(doc, null, 2));
  process.env.DEVOS_FAKE_GH_SECRETS = 'CURSOR_API_KEY';
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const second = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_FAKE_GH_SECRETS;
  delete process.env.DEVOS_GH_STATE;
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
  assert.equal(st.entries.CURSOR_API_KEY.via, 'keep', 'the keep marker is recorded');
  assert.ok(second.keysMissing.every((n) => n !== 'CURSOR_API_KEY'), 'the kept key counts as done');
  cleanupTestEnv(t);
});

test('devos keys --push uploads filled values without a continue run', async () => {
  const { t, runInit } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  const localFile = join(projectDir, 'devos', 'secrets.local.json');
  writeFileSync(localFile, JSON.stringify({ _read_me: 'x', CURSOR_API_KEY: 'paste-the-real-value-here' }, null, 2));
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, [join('bin', 'devos.mjs'), 'keys', '--project', projectDir, '--push'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DEVOS_HOME: t.home, DEVOS_FAKE_LOG: t.fakeLog },
    encoding: 'utf8', timeout: 120_000,
  });
  delete process.env.DEVOS_GH_STATE;
  assert.equal(res.status, 1, `stdout: ${res.stdout}\nstderr: ${res.stderr}`); // 1: keys are still missing
  assert.ok(res.stdout.includes('Uploaded 1 key(s): CURSOR_API_KEY'), res.stdout);
  assert.ok(res.stdout.includes('Still needed'), res.stdout);
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
  assert.equal(st.entries.CURSOR_API_KEY.via, 'local-file');
  cleanupTestEnv(t);
});

test('keys stage: the values file is never committed by the repair sync either', async () => {
  const { ensureGitignored } = await import('../lib/secretsflow.mjs');
  const t = makeTestEnv({});
  try {
    const dir = join(t.workspace, 'proj');
    mkdirSync(join(dir, 'devos'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    const a = ensureGitignored(dir);
    assert.equal(a.changed, true);
    const b = ensureGitignored(dir);
    assert.equal(b.changed, false, 'the patch is idempotent');
    const text = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.ok(text.startsWith('node_modules\n'), 'existing entries are preserved');
    assert.ok(/devos\/secrets\.local\.json/.test(text));
    // CRLF files are honored too (the user is on Windows): one that already
    // covers the values file, with CRLF line endings, is left alone.
    const dir2 = join(t.workspace, 'proj2');
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, '.gitignore'), 'node_modules\r\ndevos/secrets.local.json\r\n');
    const c = ensureGitignored(dir2);
    assert.equal(c.changed, false, 'a CRLF .gitignore that already covers the file is left alone');
  } finally { cleanupTestEnv(t); }
});

// The choice: the model can walk the developer through each key (request_secret,
// value typed into gh's hidden prompt), or the developer pastes values into the
// local fill-in file and the engine uploads. Either way the model never sees a value.
test('keys stage: keys-mode "model" — the configuration model walks through each key and every value stays in gh', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  process.env.DEVOS_FAKE_MODE = 'secrets-walkthrough';
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const events = [];
  let chose = 0;
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e),
    waitKeys: true, pollMs: 50, maxWaitMs: 8000,
    keysMode: 'model',
    choose: async () => { chose += 1; return '1'; },
  });
  delete process.env.DEVOS_FAKE_MODE;
  delete process.env.DEVOS_GH_STATE;

  assert.equal(result.ok, true, result.message || '');
  assert.equal(result.keysMissing.length, 0, `keys still missing: ${JSON.stringify(result.keysMissing)}`);
  assert.ok(result.finalLine.includes('fully set up'), result.finalLine);
  assert.equal(chose, 0, 'the flag skips the question');
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'keys-walkthrough'), 'the walkthrough is a visible phase');
  // the engine recorded each key as set by the TERMINAL (gh's own prompt)
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
  assert.equal(st.entries.CURSOR_API_KEY.via, 'terminal');
  assert.equal(st.entries.CURSOR_API_KEY.status, 'set');
  // the choice is remembered for the next run
  const mode = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'keys-mode.json'), 'utf8'));
  assert.equal(mode.mode, 'model');
  cleanupTestEnv(t);
});

test('keys stage: the choice is asked in an interactive terminal and remembered; the default is the local file', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const events = [];
  const questions = [];
  let choice = null; // EOF / no answer → the default wins
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e),
    waitKeys: true, pollMs: 20, maxWaitMs: 200, // nothing is filled: the wait times out
    choose: async (question) => { questions.push(question); return choice; },
  });
  delete process.env.DEVOS_GH_STATE;

  assert.equal(result.ok, true, result.message || '');
  assert.equal(questions.length, 1, 'the question is asked once');
  assert.ok(questions[0].includes('devos/secrets.local.json'), 'the question names the local file');
  assert.ok(questions[0].includes('[2]'), 'the question offers the model walkthrough');
  const mode = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'keys-mode.json'), 'utf8'));
  assert.equal(mode.mode, 'local', 'no answer falls back to the local-file mode');
  cleanupTestEnv(t);
});

test('keys stage: choosing the walkthrough at the question runs the model path', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  process.env.DEVOS_FAKE_MODE = 'secrets-walkthrough';
  process.env.DEVOS_GH_STATE = ghStateFile(t);
  const events = [];
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall, emit: (e) => events.push(e),
    waitKeys: true, pollMs: 50, maxWaitMs: 8000,
    choose: async () => '2',
  });
  delete process.env.DEVOS_FAKE_MODE;
  delete process.env.DEVOS_GH_STATE;
  assert.equal(result.ok, true, result.message || '');
  assert.equal(result.keysMissing.length, 0, `keys still missing: ${JSON.stringify(result.keysMissing)}`);
  assert.ok(result.keysPushed.includes('CURSOR_API_KEY'), `set this run: ${JSON.stringify(result.keysPushed)}`);
  const mode = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'keys-mode.json'), 'utf8'));
  assert.equal(mode.mode, 'model');
  cleanupTestEnv(t);
});
