// The UI keys intake — the user's ask, verbatim: "make user enter missed keys in
// the ui and then the model takes them without seeing them and then it submit and
// check again for any miss and if okay its done and if not make this steps again
// until all done and cycle workflow is okay."
//
// What each test proves:
//   1. The intake is a LOOP: ask (names only) → upload (gh secret set, stdin) →
//      re-check GitHub's own list → still missing? ask again with ONLY the names
//      still open → ... until GitHub confirms every key — then the run continues
//      on its own into the fresh cycle round.
//   2. PRIVACY: a value travels browser → engine → gh over stdin and nowhere
//      else. No event, no log line, no reply, no argv, no file ever carries one.
//   3. Skip is honest (instructions, resume path), stop closes the intake, and
//      __keep__ keeps a key that is already on GitHub.
//   4. The real HTTP door: POST /api/keys answers the waiting run; /api/state
//      re-exposes the open intake for a reload; the SSE stream carries names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

const noInstall = async () => ({ code: 0, lines: ['fake install ok'] });

// The echo group of the user's real failing run (run 39837200348): the workflow
// printed every known key, the selected ones came up EMPTY, the builder died on
// its own auth wall.
const FIELD_LOG = [
  '##[group]One attempt of one task',
  '  ANTHROPIC_API_KEY: ',
  '  CLAUDE_CODE_OAUTH_TOKEN: ',
  '  OPENAI_API_KEY: ',
  '  GEMINI_API_KEY: ',
  '  ZAI_API_KEY: ',
  '  CURSOR_API_KEY: ',
  '##[endgroup]',
  '[cycle] task T01: First vertical slice',
  '[cycle] attempt 1 of 3',
  '[cycle] builder: cursor grok-4.7-high',
  '[cycle] builder exited with code 1',
  "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.",
  '##[error]Process completed with exit code 1.',
].join('\n');

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { runContinue } = await import('../lib/continue.mjs');
  const { keyCatalog } = await import('../lib/keys.mjs');
  return { t, runInit, runContinue, keyCatalog };
}

// A project whose repository is done and whose keys are missing — the exact
// state the user's tinytasks run ended in.
async function readyProjectWithMissingKeys(t, runInit) {
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  writeFileSync(join(first.projectDir, 'devos', 'state', 'init.json'),
    JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  return { projectDir: first.projectDir, draft };
}

const engineLines = (events) => events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line);
const assertNoValues = (events, values, where) => {
  const all = JSON.stringify(events);
  for (const [name, value] of Object.entries(values)) {
    assert.ok(!all.includes(value), `${where}: the value of ${name} must never appear in any event`);
  }
};

// ---------------------------------------------------------------- 1+2: the
// loop and the privacy, end to end through the UI-shaped continue (waitKeys
// false — the wizard server's shape — with a requestValues door in place of the
// browser): submit 1 covers only SOME keys, so the stage must re-open the
// intake with only the names still missing, and finish when GitHub confirms all.
test('keys intake: partial submit re-opens the card with only the still-missing names, then the run goes on to the fresh cycle round', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const { projectDir, draft } = await readyProjectWithMissingKeys(t, runInit);
  const answers = readAnswers(projectDir);
  const names = keyCatalog(answers).map((k) => k.name);
  const VALUES = {};
  for (const n of names) VALUES[n] = `ui-secret-value-${n.toLowerCase()}-9f3a`;
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');

  // The failed last cycle (run 981) saw every selected key EMPTY — GitHub holds
  // nothing yet. The engine must diagnose, open the intake, apply the values,
  // dispatch the FRESH run, and watch it green.
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 981, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/981',
  }]);
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 1002, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
    jobs: [{ name: 'build', conclusion: 'success' }],
  });
  process.env.DEVOS_FAKE_GH_LOG_FAILED = FIELD_LOG;

  // The browser, stubbed: the first submit fills only the FIRST key; the rest
  // arrive on the second card (the loop must re-ask with the remaining names).
  const asks = [];
  const requestValues = async (ask) => {
    asks.push(ask);
    if (asks.length === 1) {
      const first = ask.missing[0] || ask.unconfirmed[0];
      return { [first]: VALUES[first] };
    }
    return { ...VALUES };
  };

  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false, requestValues,
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    assert.equal(result.firstRunGreen, true, 'the fresh round (the first with the values) is green');

    // THE LOOP: two cards — the second carries ONLY the names still missing.
    assert.equal(asks.length, 2, `the intake re-opened after the partial submit (${asks.length} asks)`);
    assert.equal(asks[0].missing.length + asks[0].unconfirmed.length, names.length, 'the first card lists every needed key');
    const firstKey = asks[0].missing[0] || asks[0].unconfirmed[0];
    const secondOpen = [...asks[1].missing, ...asks[1].unconfirmed];
    assert.ok(!secondOpen.includes(firstKey), 'the second card drops the key GitHub already confirmed');
    assert.equal(secondOpen.length, names.length - 1, 'the second card carries exactly the still-missing names');
    assert.ok(asks[1].sources && Object.keys(asks[1].sources).length, 'each ask carries where-to-get hints');
    assert.ok(asks[0].repo === 'octodev/order-desk', 'the ask names the repository');

    // The card rounds are a visible phase, and the story is in the log.
    const phases = events.filter((e) => e.type === 'phase' && e.name === 'keys-intake');
    assert.equal(phases.length, 2, 'each round is a visible keys-intake phase');
    const say = engineLines(events).join('\n');
    assert.ok(say.includes(`uploaded ${firstKey} to GitHub — the value went straight into the secret`), say);
    assert.ok(say.includes(`All ${names.length} key(s) are on GitHub now`), say);

    // The cycle loop ran: the fresh run was dispatched and watched to green.
    assert.ok(result.resumed.includes('cycle-dispatch'), `resumed: ${JSON.stringify(result.resumed)}`);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '1002');
    assert.ok((result.cycleReport || []).join('\n').includes('GREEN'));

    // PRIVACY, everywhere: no event, no engine line, no reply, no file.
    assertNoValues(events, VALUES, 'events');
    assertNoValues(engineLines(events).map((line) => ({ line })), VALUES, 'engine lines');
    const ghLog = fakeLogEntries(t.fakeLog).map((e) => JSON.stringify(e)).join('\n');
    for (const [, v] of Object.entries(VALUES)) assert.ok(!ghLog.includes(v), 'the fake gh log (argv + cwd) never carries a value');
    const setCalls = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'secret' && e.argv[1] === 'set');
    assert.equal(setCalls.length, names.length, 'one gh secret set per key');
    for (const call of setCalls) assert.ok(!call.argv.includes('--body'), 'the value never travels as an argument');

    // The engine's records say WHO set each key: the UI intake.
    const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
    for (const n of names) {
      assert.equal(st.entries[n]?.status, 'set', `${n} recorded set`);
      assert.equal(st.entries[n]?.via, 'ui-intake', `${n} recorded via the UI intake`);
    }
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
  }
  cleanupTestEnv(t);
});

function readAnswers(projectDir) {
  return JSON.parse(readFileSync(join(projectDir, 'devos', 'answers.json'), 'utf8'));
}

// ---------------------------------------------------------------- 3: skip is
// honest — no dead end, exact instructions, the resume path named.
test('keys intake: skip closes the card, the run finishes honestly, the next continue reopens it', async () => {
  const { t, runInit, runContinue } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  const asks = [];
  const events = [];
  const result = await runContinue({
    projectDir, home: t.home, installFn: noInstall,
    emit: (e) => events.push(e), waitKeys: false,
    requestValues: async (ask) => { asks.push(ask); return null; },
  });
  assert.equal(result.ok, true, result.message || '');
  assert.equal(asks.length, 1, 'one card, then the skip ends the loop');
  assert.ok(result.keysMissing.length > 0, `the missing keys are still named (${JSON.stringify(result.keysMissing)})`);
  assert.ok(result.keysMissing.includes('CURSOR_API_KEY'), 'CURSOR_API_KEY is among the still-missing names');
  const say = engineLines(events).join('\n');
  assert.ok(say.includes('devos/secrets.local.json'), say);
  assert.ok(result.finalLine.includes('still need you'), result.finalLine);
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- 4: __keep__
// keeps a key that already exists on GitHub without retyping it.
test('keys intake: __keep__ keeps an existing GitHub key; real values are uploaded for the rest', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  const answers = readAnswers(projectDir);
  const names = keyCatalog(answers).map((k) => k.name);
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_FAKE_GH_SECRETS = 'CURSOR_API_KEY'; // on GitHub, but never set from this machine
  const VALUES = {};
  for (const n of names) VALUES[n] = n === 'CURSOR_API_KEY' ? '__keep__' : `ui-secret-value-${n.toLowerCase()}`;
  // __keep__ is the public keep-marker the engine may print — it is not a value;
  // the privacy scan covers the REAL values only.
  const SECRET_VALUES = Object.fromEntries(Object.entries(VALUES).filter(([, v]) => v !== '__keep__'));
  try {
    const events = [];
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async () => ({ ...VALUES }),
    });
    assert.equal(result.ok, true, result.message || '');
    assert.equal(result.keysMissing.length, 0, `still missing: ${JSON.stringify(result.keysMissing)}`);
    const say = engineLines(events).join('\n');
    assert.ok(say.includes('kept CURSOR_API_KEY as it is on GitHub'), say);
    const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
    assert.equal(st.entries.CURSOR_API_KEY.via, 'keep');
    const setCalls = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'secret' && e.argv[1] === 'set');
    assert.ok(!setCalls.some((c) => c.argv[2] === 'CURSOR_API_KEY'), 'a kept key is never re-uploaded');
    assert.ok(setCalls.length >= names.length - 1, 'every other key was uploaded');
    assertNoValues(events, SECRET_VALUES, 'events');
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_FAKE_GH_SECRETS;
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- 5: the real
// HTTP door — POST /api/keys answers the waiting run; /api/state re-exposes the
// open card for a reload; the SSE stream carries names only; Stop closes it.
test('server: the UI door — keys-intake event, POST /api/keys applies the values, the run goes green', async () => {
  const { t, runInit } = await fresh();
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  const answers = readAnswers(projectDir);
  const { keyCatalog } = await import('../lib/keys.mjs');
  const keyNames = keyCatalog(answers).map((k) => k.name);
  const VALUES = {};
  for (const n of keyNames) VALUES[n] = `browser-secret-${n.toLowerCase()}-c4e2`;
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 981, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/981',
  }]);
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 1002, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
    jobs: [{ name: 'build', conclusion: 'success' }],
  });
  process.env.DEVOS_FAKE_GH_LOG_FAILED = FIELD_LOG;

  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7829 });
  try {
    const cont = await fetch(url + '/api/continue', { method: 'POST', body: JSON.stringify({ folder: projectDir }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(cont.status, 202);

    // The SSE collector attaches AFTER the run exists (an events GET before any
    // run is answered with an error and closed). The run blocks at the intake
    // until the submit below, so nothing is missed.
    let sseText = '';
    const sseDone = new Promise((resolve) => {
      http.get(url + '/api/events', (res) => {
        res.on('data', (c) => { sseText += String(c); });
        res.on('end', () => resolve(sseText));
      }).on('error', resolve);
    });

    // Poll /api/state until the intake card is open (the reload path reads the
    // same field), then check its shape: names + hints, never values.
    const deadline = Date.now() + 30_000;
    let intake = null;
    while (Date.now() < deadline) {
      const state = JSON.parse((await (await fetch(url + '/api/state')).text()));
      if (state.keysIntake) { intake = state.keysIntake; break; }
      if (state.lastRun && state.lastRun.done) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(intake, 'the run opens the keys intake and /api/state exposes it');
    const openNames = [...(intake.missing || []), ...(intake.unconfirmed || [])];
    assert.deepEqual([...openNames].sort(), [...keyNames].sort(), 'the card lists exactly the selected, missing keys');
    assert.ok(intake.sources && Object.values(intake.sources).every((s) => typeof s === 'string' && s.length > 0), 'the card carries where-to-get hints');
    for (const [, v] of Object.entries(VALUES)) assert.ok(!JSON.stringify(intake).includes(v), 'the state payload never carries a value');

    // The user types the values in the browser and submits.
    const submit = await fetch(url + '/api/keys', { method: 'POST', body: JSON.stringify({ values: VALUES }), headers: { 'Content-Type': 'application/json' } });
    const submitBody = await submit.json();
    assert.equal(submit.status, 200);
    assert.ok(submitBody.ok);
    assert.deepEqual([...(submitBody.names || [])].sort(), [...keyNames].sort(), 'the reply carries NAMES only');

    // The run continues on its own: fresh cycle round → watched → green.
    const deadline2 = Date.now() + 30_000;
    let run = null;
    while (Date.now() < deadline2) {
      const r = JSON.parse((await (await fetch(url + '/api/result')).text()));
      if (r.run && r.run.done) { run = r.run; break; }
      await new Promise((res) => setTimeout(res, 150));
    }
    assert.ok(run, 'the run finishes');
    assert.equal(run.result.ok, true, run.result.message || '');
    assert.equal(run.result.firstRunGreen, true, 'the fresh round is green');
    assert.ok(run.result.resumed && run.result.resumed.includes('cycle-dispatch'), 'the fresh round was dispatched');

    // A second submit with no card open is refused, not swallowed.
    const again = await fetch(url + '/api/keys', { method: 'POST', body: JSON.stringify({ values: VALUES }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(again.status, 409, 'no intake waiting → 409');

    // PRIVACY: the whole SSE stream never carries a value; it DOES carry the
    // names and the intake events.
    const full = await Promise.race([sseDone, new Promise((r) => setTimeout(() => r(sseText), 5000))]);
    for (const [, v] of Object.entries(VALUES)) {
      assert.ok(!full.includes(v), 'the SSE stream never carries a value');
      assert.ok(!JSON.stringify(run.result).includes(v), 'the final result never carries a value');
    }
    assert.ok(full.includes('"keys-intake"'), 'the intake event is on the stream');
    for (const n of keyNames) assert.ok(full.includes(n), `the stream names ${n}`);
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
    server.close();
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- 7: the
// TERMINAL door — `devos continue` runs in its own process, so the wizard UI
// must be hostable BY the CLI: attachRun gives it the same window (SSE mirror,
// Missing keys card, Stop). The card opens through attachRun's requestValues
// door and POST /api/keys answers it — the same HTTP contract the UI run uses.
test('server: attachRun hosts the terminal continue — the intake card opens and POST /api/keys resolves it', async () => {
  const { t } = await fresh();
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');
  const started = await startServer({ home: t.home, workspace: t.workspace, port: 7833 });
  const { server, url } = started;
  try {
    const win = started.attachRun({ onStop: () => {} });
    assert.equal(typeof win.emit, 'function');
    assert.equal(typeof win.requestValues, 'function');
    assert.equal(typeof win.finish, 'function');
    assert.equal(typeof win.stop, 'function');

    // The "run": wait for the card, resolve with the values that arrive.
    const ask = {
      missing: ['CURSOR_API_KEY'], unconfirmed: [], repo: 'octodev/order-desk',
      round: 1, total: 1, sources: { CURSOR_API_KEY: 'Cursor dashboard.' },
    };
    const valuesPromise = win.requestValues(ask);

    // /api/state exposes the open card (the reload path reads the same field).
    const deadline = Date.now() + 10_000;
    let intake = null;
    while (Date.now() < deadline) {
      const state = JSON.parse((await (await fetch(url + '/api/state')).text()));
      if (state.keysIntake) { intake = state.keysIntake; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(intake, 'the terminal-hosted run exposes the card on /api/state');
    assert.deepEqual(intake.missing, ['CURSOR_API_KEY']);
    assert.ok(intake.sources && intake.sources.CURSOR_API_KEY, 'the card carries the where-to-get hint');

    // The browser submits; the door resolves with the values.
    const submit = await fetch(url + '/api/keys', { method: 'POST', body: JSON.stringify({ values: { CURSOR_API_KEY: 'terminal-window-value' } }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(submit.status, 200);
    const got = await valuesPromise;
    assert.deepEqual(got, { CURSOR_API_KEY: 'terminal-window-value' });

    // POST /api/continue is refused while a run is attached (one run at a time).
    const cont = await fetch(url + '/api/continue', { method: 'POST', body: JSON.stringify({ folder: '/nonexistent' }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(cont.status, 409, 'no second run alongside the hosted one');

    // finish closes the run; a late submit is refused, /api/state goes quiet.
    win.finish({ ok: true, finalLine: 'devos continue: done' });
    const late = await fetch(url + '/api/keys', { method: 'POST', body: JSON.stringify({ values: { CURSOR_API_KEY: 'late' } }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(late.status, 409, 'a late submit is refused after finish');
    const after = JSON.parse((await (await fetch(url + '/api/result')).text()));
    assert.ok(after.run && after.run.done && after.run.result.ok === true, 'the final result is readable');
  } finally {
    server.close();
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- 6: Stop
// closes a waiting intake — the run winds down instead of hanging on the card.
test('server: Stop resolves a waiting keys intake; the run ends stopped and the card refuses late submits', async () => {
  const { t, runInit } = await fresh();
  const { startServer } = await import('../lib/server.mjs');
  const { projectDir } = await readyProjectWithMissingKeys(t, runInit);
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7831 });
  try {
    const cont = await fetch(url + '/api/continue', { method: 'POST', body: JSON.stringify({ folder: projectDir }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(cont.status, 202);
    const deadline = Date.now() + 30_000;
    let open = false;
    while (Date.now() < deadline) {
      const state = JSON.parse((await (await fetch(url + '/api/state')).text()));
      if (state.keysIntake) { open = true; break; }
      if (state.lastRun && state.lastRun.done) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(open, 'the intake card is open');
    const stop = await fetch(url + '/api/stop', { method: 'POST' });
    assert.equal(stop.status, 200);
    const deadline2 = Date.now() + 30_000;
    let run = null;
    while (Date.now() < deadline2) {
      const r = JSON.parse((await (await fetch(url + '/api/result')).text()));
      if (r.run && r.run.done) { run = r.run; break; }
      await new Promise((res) => setTimeout(res, 150));
    }
    assert.ok(run, 'the run winds down after the stop');
    assert.equal(run.result.ok, false);
    assert.ok(run.result.stopped, 'the result is a stop, not a failure');
    const late = await fetch(url + '/api/keys', { method: 'POST', body: JSON.stringify({ values: { CURSOR_API_KEY: 'late' } }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(late.status, 409, 'a late submit is refused');
  } finally {
    delete process.env.DEVOS_GH_STATE;
    server.close();
  }
  cleanupTestEnv(t);
});
