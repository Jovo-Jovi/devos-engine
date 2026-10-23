import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft } from './helpers.mjs';

test('server: serves the UI, persists the draft, and binds to 127.0.0.1', async () => {
  const t = makeTestEnv({});
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');
  const { join } = await import('node:path');

  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7971 });
  try {
    assert.ok(url.startsWith('http://127.0.0.1:'), 'the UI binds to 127.0.0.1 only');

    const get = (path) => new Promise((resolve, reject) => {
      http.get(url + path, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] }));
      }).on('error', reject);
    });

    const html = await get('/');
    assert.equal(html.status, 200);
    assert.ok(html.body.includes('DEV_OS'));

    const css = await get('/app.css');
    assert.equal(css.status, 200);
    assert.ok(css.body.includes('#0c0f14'), 'the dark surface palette ships');

    const js = await get('/app.js');
    assert.equal(js.status, 200);

    const state = await get('/api/state');
    assert.equal(state.status, 200);
    const data = JSON.parse(state.body);
    assert.equal(data.types.length, 16, 'all 16 types in the UI');
    assert.equal(data.modules.length, 16, 'all 16 modules in the UI');
    assert.equal(data.stacks.length, 21, 'every framework card in the UI');
    assert.ok(data.agents.some((a) => a.toolId === 'cursor' && a.groups.length), 'agent groups with subgroups');

    // draft round-trip
    const post = await fetch(url + '/api/draft', { method: 'POST', body: JSON.stringify(saasDraft()), headers: { 'Content-Type': 'application/json' } });
    assert.equal(post.status, 200);
    const state2 = JSON.parse((await get('/api/state')).body);
    assert.equal(state2.draft.models.reviewer.model, 'claude-opus-5-5');
    const { readFileSync, existsSync } = await import('node:fs');
    assert.equal(existsSync(join(t.workspace, 'order-desk')), false, 'nothing created in the workspace yet');
  } finally {
    server.close();
    cleanupTestEnv(t);
  }
});

test('server: confirm runs the configuration model to a final card, replays events, and survives a re-tap', async () => {
  const t = makeTestEnv({});
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');

  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7972 });
  const get = (path) => new Promise((resolve, reject) => {
    http.get(url + path, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  try {
    await fetch(url + '/api/draft', { method: 'POST', body: JSON.stringify(saasDraft()), headers: { 'Content-Type': 'application/json' } });
    const confirm = await fetch(url + '/api/confirm', { method: 'POST' });
    assert.equal(confirm.status, 202, 'confirm accepts the run');

    // A re-tap while the run is alive must be refused, not crash or double-run.
    // (Only asserted while the run is observable in progress, so an unusually
    // fast machine cannot make this test flaky.)
    const soon = JSON.parse((await get('/api/result')).body);
    if (soon.run && !soon.run.done) {
      const retap = await fetch(url + '/api/confirm', { method: 'POST' });
      assert.equal(retap.status, 409, 'a second confirm during the run is refused');
    }

    // Poll /api/result the way the UI fallback does, until the run is done.
    const deadline = Date.now() + 60_000;
    let run = null;
    while (Date.now() < deadline) {
      const r = JSON.parse((await get('/api/result')).body);
      if (r.run && r.run.done) { run = r.run; break; }
      await new Promise((res) => setTimeout(res, 250));
    }
    assert.ok(run, 'the run finishes');
    assert.equal(run.result.ok, true, `the run succeeds (message: ${run.result.message || 'none'})`);
    assert.equal(run.result.slug, 'octodev/order-desk');
    assert.ok(run.result.finalLine, 'the final line travels in the flat result');
    assert.ok(run.result.projectDir, 'the project folder path is in the result');

    // The event stream replays the whole run for a late subscriber, ending with final.
    const replay = await new Promise((resolve, reject) => {
      let body = '';
      http.get(url + '/api/events', (res) => {
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const events = replay.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'writing-project'), 'writing-project phase replayed');
    assert.ok(events.some((e) => e.type === 'github'), 'github event replayed');
    const final = events.find((e) => e.type === 'final');
    assert.ok(final, 'final event replayed');
    assert.equal(final.ok, true, 'final event is flat and ok');
    assert.ok(final.finalLine, 'final event carries the final line for the final card');

    // /api/state exposes the finished run so a reload lands on the final card.
    const state = JSON.parse((await get('/api/state')).body);
    assert.equal(state.running, false);
    assert.ok(state.lastRun && state.lastRun.done && state.lastRun.result.ok, 'lastRun is exposed for reload-resume');
  } finally {
    server.close();
    cleanupTestEnv(t);
  }
});
