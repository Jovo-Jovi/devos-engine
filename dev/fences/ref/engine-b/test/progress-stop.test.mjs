import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft } from './helpers.mjs';
import { join } from 'node:path';

// ---------- the progress reducer (pure, injected clock) ----------

test('progress: file/module/phase events drive percent, counters, and the todo list', async () => {
  const { createProgressState, applyEvent, progressSnapshot } = await import('../lib/progress.mjs');
  let t = 1_000_000;
  const state = createProgressState({ now: () => t });
  applyEvent(state, { type: 'phase', name: 'writing-project' });
  let snap = progressSnapshot(state);
  assert.equal(state.phase, 'writing');
  assert.ok(snap.percent >= 6, 'writing starts above the idle floor');
  assert.equal(snap.steps[0].state, 'done', 'answers step is done from the first event');
  assert.equal(snap.steps[1].state, 'active', 'the write step is active');

  applyEvent(state, { type: 'log', line: 'Connection lost, reconnecting (attempt 1)...' });
  snap = progressSnapshot(state);
  assert.equal(snap.counters.reconnects, 1, 'reconnect attempts are counted, not hidden');
  assert.equal(snap.counters.lines, 1);
  assert.ok(snap.lastOutputAgoMs != null, 'last-output age is tracked');

  applyEvent(state, { type: 'file', path: 'src/app.tsx' });
  applyEvent(state, { type: 'module', id: 'auth' });
  snap = progressSnapshot(state);
  assert.equal(snap.counters.files, 1);
  assert.equal(snap.counters.modules, 1);
  assert.ok(snap.percent >= 9, 'files and modules push the percent up');
  assert.ok(snap.steps[1].detail.includes('1 files') || snap.steps[1].detail.includes('files · 1 modules'), 'the active step shows its counters');

  t += 65_000; // a silent minute must still move the time floor
  applyEvent(state, { type: 'log', line: 'still working' });
  snap = progressSnapshot(state);
  assert.ok(snap.percent >= 9, 'the time floor advances the percent during silence');
  assert.ok(snap.lastOutputAgoMs < 2_000, 'fresh output resets the age');

  applyEvent(state, { type: 'phase', name: 'creating-github' });
  snap = progressSnapshot(state);
  assert.equal(snap.steps[1].state, 'done', 'write step completes when GitHub starts');
  assert.equal(snap.steps[2].state, 'active');
  assert.ok(snap.percent >= 88);

  applyEvent(state, { type: 'github' });
  applyEvent(state, { type: 'final', ok: true, finalLine: 'done' });
  snap = progressSnapshot(state);
  assert.equal(snap.percent, 100, 'a successful final is 100%');
  assert.equal(snap.phase, 'done');
  assert.ok(snap.steps.every((s) => s.state === 'done'), 'every todo line is checked');
});

test('progress: percent never goes backwards and freezes on failure', async () => {
  const { createProgressState, applyEvent, progressSnapshot } = await import('../lib/progress.mjs');
  let t = 5_000_000;
  const state = createProgressState({ now: () => t });
  const seen = [];
  applyEvent(state, { type: 'phase', name: 'writing-project' });
  for (let i = 0; i < 12; i++) {
    applyEvent(state, { type: 'file', path: `f${i}.ts` });
    seen.push(progressSnapshot(state).percent);
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `percent is monotonic (${seen[i - 1]} -> ${seen[i]})`);
  assert.ok(seen[11] <= 84, 'writing caps below the GitHub milestone');

  applyEvent(state, { type: 'phase', name: 'usage-limit' });
  const frozen = progressSnapshot(state).percent;
  t += 10 * 60_000; // ten more minutes must not fake progress after the wall
  applyEvent(state, { type: 'log', line: 'waiting' });
  assert.equal(progressSnapshot(state).percent, frozen, 'a failed phase freezes the percent');
  applyEvent(state, { type: 'final', ok: false, message: 'usage limit' });
  assert.equal(progressSnapshot(state).percent, frozen, 'a failed final keeps the honest number');
  assert.equal(progressSnapshot(state).failKind, 'usage-limit');
});

test('progress: terminal renders — status line and one-line todo checklist', async () => {
  const { createProgressState, applyEvent, progressSnapshot, renderStatusLine, renderChecklist } = await import('../lib/progress.mjs');
  const state = createProgressState({ now: () => Date.now() });
  applyEvent(state, { type: 'phase', name: 'writing-project' });
  applyEvent(state, { type: 'file', path: 'package.json' });
  applyEvent(state, { type: 'log', line: 'Connection lost, reconnecting (attempt 2)...' });
  const snap = progressSnapshot(state);
  const status = renderStatusLine(snap);
  assert.ok(status.includes('▸ '), status);
  assert.ok(/▸ \d+%/.test(status), status);
  assert.ok(status.includes('1 files'), status);
  assert.ok(status.includes('last output'), status);
  assert.ok(status.includes('reconnecting ×1'), status);
  const list = renderChecklist(snap);
  assert.ok(list.startsWith('todo: '), list);
  assert.ok(list.includes('[x] answers saved'), list);
  assert.ok(list.includes('[·] model writes the project'), list);
  assert.ok(list.includes('[ ] create the GitHub repository + first cycle'), list);
  assert.ok(list.includes('[ ] bootstrap guards & verify'), list);
});

// ---------- kill-tree ----------

test('spawn: killPidTree kills a live child and never throws on a dead pid', async () => {
  if (process.platform === 'win32') return; // covered on Windows by taskkill in the e2e path
  const { spawn } = await import('node:child_process');
  const { killPidTree } = await import('../lib/spawn.mjs');
  const child = spawn('sleep', ['30']);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(killPidTree(child.pid), true, 'reports the kill was issued');
  const code = await new Promise((r) => child.on('close', (c, sig) => r(c ?? sig)));
  assert.ok(code !== null, 'the child actually died');
  assert.equal(killPidTree(child.pid), true, 'a second kill on a dead pid is still safe');
  assert.equal(killPidTree(0), false, 'pid 0 is refused');
  assert.equal(killPidTree(null), false, 'no pid is a no-op');
});

// ---------- stop before a round starts (no child needed) ----------

test('configmodel: shouldStop winds the run down cleanly before any model spawn', async () => {
  const t = makeTestEnv({});
  try {
    const { runConfigurationModel } = await import('../lib/configmodel.mjs');
    const { finalizeAnswers } = await import('../lib/answers.mjs');
    const answers = finalizeAnswers(saasDraft());
    const projectDir = t.workspace;
    const events = [];
    const res = await runConfigurationModel({
      projectDir, answers, answersPath: join(projectDir, 'devos', 'answers.json'),
      agent: { toolId: 'claude', command: 'claude' },
      emit: (e) => events.push(e),
      shouldStop: () => true,
      env: { ...process.env },
    });
    assert.equal(res.ok, false);
    assert.equal(res.stopped, true, 'the run reports stopped, not failed');
    assert.ok(res.message.includes('devos continue'), 'the stopped message carries the resume command');
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'stopped'), 'a stopped phase is emitted for the UI');
    const fakeLogEntries = (await import('./helpers.mjs')).fakeLogEntries(t.fakeLog);
    assert.equal(fakeLogEntries.length, 0, 'no model process was ever spawned');
  } finally { cleanupTestEnv(t); }
});

// ---------- the full stop path: confirm -> hang -> Stop button -> stopped result ----------

test('server: the Stop button kills the hung model process and returns a stopped result', async () => {
  const t = makeTestEnv({});
  process.env.DEVOS_FAKE_MODE = 'hang';
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');
  const get = (url, path) => new Promise((resolve, reject) => {
    http.get(url + path, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7973 });
  try {
    await fetch(url + '/api/draft', { method: 'POST', body: JSON.stringify(saasDraft()), headers: { 'Content-Type': 'application/json' } });
    const confirm = await fetch(url + '/api/confirm', { method: 'POST' });
    assert.equal(confirm.status, 202);

    // Wait until the run is live and the hung model has actually produced output
    // (percent has a nonzero baseline, so line count is the honest live signal).
    const deadline = Date.now() + 20_000;
    let live = null;
    while (Date.now() < deadline) {
      live = JSON.parse((await get(url, '/api/state')).body);
      if (live.running && live.progress && (live.progress.counters?.lines || 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(live && live.running && live.progress, 'the run is live with a progress snapshot on /api/state');
    assert.ok(live.progress.percent >= 6, `percent is being reported (${live.progress.percent}%)`);
    assert.equal(live.progress.phase, 'writing', 'the run is in the writing phase');

    // Tapping Stop without a run is refused; with one it reports the kill.
    const stop = await fetch(url + '/api/stop', { method: 'POST' });
    assert.equal(stop.status, 200);
    const stopBody = await stop.json();
    assert.equal(stopBody.ok, true, 'the stop is accepted');
    assert.equal(stopBody.killed, true, 'the model process was actually killed');

    // The run winds down to a clean stopped result — fast, not after a timeout.
    let run = null;
    while (Date.now() < deadline) {
      const r = JSON.parse((await get(url, '/api/result')).body);
      if (r.run && r.run.done) { run = r.run; break; }
      await new Promise((res2) => setTimeout(res2, 200));
    }
    assert.ok(run, 'the run ends after the stop');
    assert.equal(run.result.ok, false);
    assert.equal(run.result.stopped, true, 'the result is a stop, not a model failure');
    assert.ok(run.result.message.includes('devos continue'), 'the final card knows the resume command');

    // The event replay carries the whole story for a late subscriber.
    const replay = await new Promise((resolve, reject) => {
      let body = '';
      http.get(url + '/api/events', (res) => {
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const events = replay.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'stopping'), 'stopping phase replayed');
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'stopped'), 'stopped phase replayed');
    assert.ok(events.some((e) => e.type === 'progress' && e.steps && e.steps.length >= 4), 'progress snapshots replayed with the todo list');
  } finally {
    server.close();
    delete process.env.DEVOS_FAKE_MODE;
    cleanupTestEnv(t);
  }
}, { timeout: 45_000 });

test('server: /api/stop without a run is a polite refusal, not a crash', async () => {
  const t = makeTestEnv({});
  const { startServer } = await import('../lib/server.mjs');
  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7974 });
  try {
    const res = await fetch(url + '/api/stop', { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false, 'no run to stop');
    assert.ok(body.error.includes('No init run'), 'the refusal says why');
  } finally { server.close(); cleanupTestEnv(t); }
});
