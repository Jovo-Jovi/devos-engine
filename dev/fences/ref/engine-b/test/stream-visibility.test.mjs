// Task 18: nothing blind, nothing unchosen. The stream-json interpreter makes the
// model's conversation visible live; --force lets Cursor's print mode actually run
// commands; the progress percent moves even when no event arrives; and verify only
// audits the configuration model the developer actually chose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { getAdapter, looksLikeCommandRejection } = await import('../lib/adapters.mjs');
  const { createStreamJsonInterpreter } = await import('../lib/streamjson.mjs');
  const { auditSetup } = await import('../lib/verify.mjs');
  const { finalizeAnswers } = await import('../lib/answers.mjs');
  return { t, runInit, getAdapter, looksLikeCommandRejection, createStreamJsonInterpreter, auditSetup, finalizeAnswers };
}

// ---------------------------------------------------------------- adapters
test('cursor adapter: --force and stream-json ride along; auto still sends no --model', async () => {
  const { t, getAdapter } = await fresh();
  const cursor = getAdapter({ toolId: 'cursor' });
  assert.equal(cursor.streamJson, true, 'the cursor adapter declares stream-json');
  assert.deepEqual(cursor.buildArgs('auto'), ['--trust', '--force', '-p', '--output-format', 'stream-json']);
  assert.deepEqual(cursor.buildArgs('grok-4.7'), ['--trust', '--force', '-p', '--model', 'grok-4.7', '--output-format', 'stream-json']);
  cleanupTestEnv(t);
});

test('command rejection patterns: model words and CLI errors are both caught', async () => {
  const { t, looksLikeCommandRejection } = await fresh();
  assert.equal(looksLikeCommandRejection('Command execution was rejected on every attempt, including `npm install` and `init_github`.'), true);
  assert.equal(looksLikeCommandRejection('the command was rejected by the user'), true);
  assert.equal(looksLikeCommandRejection('All checks passed; the tree is green.'), false);
  assert.equal(looksLikeCommandRejection('Do you trust the contents of this directory?'), false, 'trust gate is a different wall');
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- interpreter
test('interpreter: system, assistant, tool calls, contract lines, and the result dedupe', async () => {
  const { t, createStreamJsonInterpreter } = await fresh();
  const it = createStreamJsonInterpreter();
  const feed = (l) => it.feed(l).map((e) => ({ type: e.type, line: e.line, stream: e.stream, path: e.path, id: e.id }));

  // system init -> one engine sentence, never noise
  assert.deepEqual(feed('{"type":"system","subtype":"init","model":"Grok 4.7","permissionMode":"default"}'), [
    { type: 'log', line: 'session started · model Grok 4.7 · permission mode default', stream: 'engine', path: undefined, id: undefined },
  ]);

  // assistant message: multi-line text becomes say lines
  const says = feed('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Scaffolding now.\\nSecond line."}]}}');
  assert.deepEqual(says, [
    { type: 'log', line: 'Scaffolding now.', stream: 'agent-say', path: undefined, id: undefined },
    { type: 'log', line: 'Second line.', stream: 'agent-say', path: undefined, id: undefined },
  ]);

  // a completed write is a log line AND a real file event with the absolute path
  const writes = feed('{"type":"tool_call","subtype":"completed","call_id":"w1","tool_call":{"writeToolCall":{"args":{"path":"package.json"},"result":{"success":{"path":"/proj/package.json","linesCreated":9}}}}}');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].type, 'log');
  assert.equal(writes[1].type, 'file');
  assert.equal(writes[1].path, '/proj/package.json');

  // reads and shell commands describe what is happening right now
  assert.equal(feed('{"type":"tool_call","subtype":"started","tool_call":{"readToolCall":{"args":{"path":"devos/answers.json"}}}}')[0].line, 'reads devos/answers.json');
  assert.equal(feed('{"type":"tool_call","subtype":"started","tool_call":{"function":{"name":"bash","arguments":"npm install"}}}')[0].line, 'runs bash npm install');

  // the engine's contract lines pass through untouched
  assert.deepEqual(feed('{"event":"file","path":"src/app/page.tsx"}'), [{ type: 'file', path: 'src/app/page.tsx', line: undefined, stream: undefined, id: undefined }]);
  assert.deepEqual(feed('{"event":"module","id":"database"}'), [{ type: 'module', id: 'database', line: undefined, stream: undefined, path: undefined }]);

  // the result event does NOT repeat text that was already streamed live
  const res = feed('{"type":"result","subtype":"success","duration_ms":1200,"result":"Scaffolding now. Second line."}');
  assert.equal(res.length, 1);
  assert.equal(res[0].line, 'run finished in 1s');

  // a silent CLI (no assistant events) still gets its result text shown
  const it2 = createStreamJsonInterpreter();
  it2.feed('{"type":"system","subtype":"init"}');
  const res2 = it2.feed('{"type":"result","subtype":"success","result":"All done."}');
  assert.deepEqual(res2.map((e) => e.line), ['All done.']);

  // plain and malformed lines pass through raw; user and unknown events are ignored
  assert.deepEqual(it2.feed('Connection lost, reconnecting…'), [{ type: 'log', line: 'Connection lost, reconnecting…', stream: 'agent' }]);
  assert.deepEqual(it2.feed('{oops not json'), [{ type: 'log', line: '{oops not json', stream: 'agent' }]);
  assert.deepEqual(it2.feed('{"type":"user","message":{"role":"user"}}'), []);
  assert.deepEqual(it2.feed('{"type":"something-new","x":1}'), []);
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- e2e: stream
test('e2e: a stream-json cursor run completes, streams conversation live, and counts each file once', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'stream';
  const events = [];
  const { result } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: (e) => events.push(e) });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, true, `run failed: ${result.message || ''}`);

  // both cursor flags reached the CLI
  const runs = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'agent' && e.argv.includes('-p'));
  assert.ok(runs.length > 0);
  for (const c of runs) {
    assert.ok(c.argv.includes('--force'), `--force missing: ${c.argv.join(' ')}`);
    assert.ok(c.argv.includes('stream-json'), `stream-json missing: ${c.argv.join(' ')}`);
    assert.ok(c.argv.includes('--trust'), `--trust missing: ${c.argv.join(' ')}`);
  }

  // the conversation streamed while working: session line + say lines
  const logs = events.filter((e) => e.type === 'log').map((e) => e.line);
  assert.ok(logs.some((l) => l.includes('session started · model')), logs.slice(0, 6).join(' | '));
  assert.ok(logs.includes('Reading the answers and scaffolding the project now.'), 'assistant text streams live');
  assert.ok(logs.includes('This sentence streams live, not at the end.'), 'multi-line assistant text splits');
  assert.ok(logs.some((l) => l.startsWith('writes ')), 'write tool calls are described');
  assert.ok(logs.includes('run finished in 1s'), 'the result event does not repeat the whole conversation');

  // file dedupe: the contract line and the write tool call are the same file
  const pkg = events.filter((e) => e.type === 'file' && String(e.path).endsWith('package.json'));
  assert.equal(pkg.length, 1, `package.json reported ${pkg.length} times`);
  const modules = events.filter((e) => e.type === 'module').map((e) => e.id);
  assert.equal(new Set(modules).size, modules.length, 'module events are deduped too');
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- e2e: --force wall
test('e2e: the engine passes --force, so a needs-force CLI runs; an older template without it is a permission wall', async () => {
  const { t, runInit } = await fresh();
  // 1. the engine's own cursor args satisfy the gate
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'needs-force';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(first.result.ok, true, `expected --force to open the gate, got: ${first.result.message || 'ok'}`);

  // 2. a pre-force template (what older engines sent) hits the wall and gets the real fix
  process.env.DEVOS_FAKE_MODE = 'needs-force';
  const legacy = saasDraft();
  legacy.models.configurationModel = {
    cli: 'legacy-cursor', model: 'grok-4.7',
    agent: { toolId: 'legacy-cursor', command: 'agent', promptTemplate: 'agent -p' },
  };
  const second = await runInit({ draft: legacy, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(second.result.ok, false);
  assert.equal(second.result.permissionIssue, true, `expected permissionIssue, got: ${second.result.message || 'ok'}`);
  assert.ok(second.result.message.includes('--force'), second.result.message);
  assert.ok(second.result.message.includes('devos continue'), second.result.message);
  cleanupTestEnv(t);
});

test('e2e: a finished tree with init_github refused in the model words names the permission fix', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const { result } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, false);
  assert.equal(result.permissionIssue, true, `expected the permission wall, got: ${result.message || 'ok'}`);
  assert.ok(result.message.includes('init_github was never called'), result.message);
  assert.ok(result.message.includes('devos continue'), result.message);
  assert.ok(result.message.includes('init_github itself'), result.message);
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- progress
test('progress: the percent advances during silence (the stale-6% fix) and still freezes on failure', async () => {
  const t = makeTestEnv({});
  const { createProgressState, applyEvent, progressSnapshot } = await import('../lib/progress.mjs');
  let now = 1_000_000;
  const state = createProgressState({ now: () => now });
  applyEvent(state, { type: 'phase', name: 'writing-project' }); // percent baseline 6
  assert.equal(progressSnapshot(state).percent, 6);
  now += 10 * 60_000; // ten minutes with NO events at all
  const snap = progressSnapshot(state);
  assert.equal(snap.percent, 36, `expected the slow floor at 36%, got ${snap.percent}`);
  assert.equal(snap.lastOutputAgoMs, null, 'a phase event is not output — the ticker says "no output yet" and that is honest');
  // a failure freezes the number: no fake motion after the run ends
  applyEvent(state, { type: 'phase', name: 'error' });
  now += 30 * 60_000;
  assert.equal(progressSnapshot(state).percent, 36, 'failed runs keep the honest number');
  // the status line names the last thing the model did
  applyEvent(state, { type: 'log', line: 'writes src/app/page.tsx', stream: 'agent-tool' });
  const { renderStatusLine } = await import('../lib/progress.mjs');
  const line = renderStatusLine(progressSnapshot(state));
  assert.ok(line.includes('writes src/app/page.tsx'), line);
  assert.ok(line.startsWith('▸ 36%'), line);
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- verify
test('verify: only the chosen configuration model is audited; unselected CLIs never become fixes', async () => {
  const { t, auditSetup, finalizeAnswers } = await fresh();
  const answers = finalizeAnswers(saasDraft());
  answers.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  const audit = auditSetup({ answers });
  const agentRows = audit.rows.filter((r) => r.section === 'agents');
  const labels = agentRows.map((r) => r.label).join(' | ');
  assert.ok(labels.includes('Cursor CLI'), labels);
  for (const unselected of ['Codex CLI', 'Gemini CLI', 'Muse', 'Z.ai / GLM']) {
    assert.equal(labels.includes(unselected), false, `${unselected} must not appear: ${labels}`);
  }
  assert.equal(audit.youSteps.some((r) => r.section === 'agents' && r.label !== 'Cursor CLI'), false);

  // no choice yet: every CLI is a quiet info row — never a fix, never an owner
  const bare = auditSetup({});
  for (const r of bare.rows.filter((x) => x.section === 'agents')) {
    assert.equal(r.state, 'ok', `${r.label} must be informational before a choice: ${r.detail}`);
    assert.equal(r.who, null);
    assert.equal(r.fix, null);
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- server/UI wiring
test('server: the hairline stage files are served and the run view mounts them', async () => {
  const t = makeTestEnv({});
  const { startServer } = await import('../lib/server.mjs');
  const { default: http } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { server, url } = await startServer({ home: t.home, workspace: t.workspace, port: 7991 });
  try {
    const get = (path) => new Promise((resolve, reject) => {
      http.get(url + path, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] }));
      }).on('error', reject);
    });
    for (const f of ['hairline.js', 'hairline-custom.js', 'hairline-stage.js']) {
      const r = await get(`/${f}`);
      assert.equal(r.status, 200, `${f} is served`);
      assert.ok(r.type.includes('javascript'), `${f} mime: ${r.type}`);
    }
    const stage = await get('/hairline-stage.js');
    assert.ok(stage.body.includes('firecrawlReader'), 'the stage rotates the custom figures');
    assert.ok(stage.body.includes('terminal'), 'the stage includes the Terminal figure');
    // the vendored package keeps its MIT banner and exports
    const vendored = readFileSync(join(import.meta.dirname, '..', 'ui', 'hairline.js'), 'utf8');
    assert.ok(vendored.startsWith('/*'), 'the vendor banner is present');
    assert.ok(vendored.includes('Lucas Marques'), 'the MIT attribution is kept');
    // the run view carries the stage and the sit-back line
    const appjs = readFileSync(join(import.meta.dirname, '..', 'ui', 'app.js'), 'utf8');
    assert.ok(appjs.includes('run-figure'), 'the run view mounts the figure stage');
    assert.ok(appjs.includes('Sit back'), 'the sit-back line is restored');
    assert.ok(appjs.includes('DEVOS_FIGURES.setPhase'), 'phase changes advance the figure');
  } finally {
    server.close();
    cleanupTestEnv(t);
  }
});
