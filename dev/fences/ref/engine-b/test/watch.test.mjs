import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';
import { printWatchPass } from '../lib/watch.mjs';

// runWatch takes injectable audit/readAnswers/sleepFn, so these tests run instantly
// without spawning a single probe. One e2e test uses the real auditSetup.
async function fresh() {
  const t = makeTestEnv({});
  const { runWatch, printWatchPass } = await import('../lib/watch.mjs');
  const { auditSetup } = await import('../lib/verify.mjs');
  return { t, runWatch, printWatchPass, auditSetup };
}

const row = (section, label, state, detail = '', fix = null, who = null) => ({ section, label, state, detail, fix, who });

function fakeAudit(rows) {
  return async () => ({
    ready: !rows.some((r) => r.state === 'block'),
    rows,
    youSteps: rows.filter((r) => r.state !== 'ok' && r.who === 'you'),
    modelSteps: rows.filter((r) => r.state !== 'ok' && r.who === 'model'),
  });
}

test('watch: one pass runs every section at once and an all-green audit stops the watch immediately', async () => {
  const { t, runWatch, auditSetup } = await fresh();
  const lines = [];
  const result = await runWatch({
    maxPasses: 5,
    audit: (answers) => auditSetup({ answers }), // the REAL audit against the healthy fake machine
    out: (l) => lines.push(l),
  });
  assert.equal(result.ready, true, JSON.stringify(result.audit?.rows?.filter((r) => r.state === 'block')));
  assert.equal(result.passes, 1);
  assert.equal(result.slept, 0, 'an all-green first pass must not wait');
  const text = lines.join('\n');
  assert.ok(text.includes('MACHINE'), text);
  assert.ok(text.includes('GITHUB'), text);
  assert.ok(text.includes('AGENTS'), text);
  assert.ok(text.includes('ALL GREEN'), text);
  assert.ok(text.includes('pass 1'), text);
  cleanupTestEnv(t);
});

test('watch: fixes applied between passes are picked up — the changed row is starred and the watch ends green', async () => {
  const { t, runWatch } = await fresh();
  const pass1 = [
    row('github', 'gh login', 'block', 'not signed in', 'Run: gh auth login', 'you'),
    row('project', 'Bootstrap guards', 'block', '2 problems', 'devos fix <folder>', 'model'),
  ];
  const pass2 = [
    row('github', 'gh login', 'ok', 'signed in as octodev'),
    row('project', 'Bootstrap guards', 'ok', 'the written tree passes every check'),
  ];
  let n = 0;
  const sleeps = [];
  const lines = [];
  const result = await runWatch({
    intervalMs: 8000,
    maxPasses: 5,
    audit: async () => (n++ === 0 ? await fakeAudit(pass1)() : await fakeAudit(pass2)()),
    sleepFn: async (ms) => { sleeps.push(ms); },
    out: (l) => lines.push(l),
  });
  assert.equal(result.ready, true);
  assert.equal(result.passes, 2);
  assert.deepEqual(sleeps, [8000], 'exactly one wait between pass 1 and pass 2');
  const text = lines.join('\n');
  assert.ok(/\*\[ ok \] gh login/.test(text), 'the login row turned ok on pass 2 and must be starred:\n' + text);
  assert.ok(text.includes('2 changed'), text);
  assert.ok(text.includes('ALL GREEN'), text);
  // the starred row also still carries its fix on the pass where it failed
  assert.ok(text.includes('fix: Run: gh auth login'), text);
  cleanupTestEnv(t);
});

test('watch: a row that stays broken is not starred; max-passes stops with a clear still-not-ready line', async () => {
  const { t, runWatch } = await fresh();
  const rows = [
    row('github', 'gh login', 'block', 'not signed in', 'Run: gh auth login', 'you'),
    row('agents', 'Cursor CLI', 'warn', 'installed but signed out', null, 'you'),
  ];
  let sleeps = 0;
  const lines = [];
  const result = await runWatch({
    intervalMs: 1000,
    maxPasses: 3,
    audit: fakeAudit(rows),
    sleepFn: async () => { sleeps++; },
    out: (l) => lines.push(l),
  });
  assert.equal(result.ready, false);
  assert.equal(result.passes, 3);
  assert.equal(sleeps, 2, 'wait happens between passes, not after the last one');
  const text = lines.join('\n');
  assert.ok(!text.includes('*['), 'nothing changes between passes, so nothing is starred:\n' + text);
  assert.ok(text.includes('Still not ready after 3 passes'), text);
  assert.ok(text.includes('next pass in 1s'), text);
  cleanupTestEnv(t);
});

test('watch: the answer file is re-read before every pass, so devos fix results flow in', async () => {
  const { t, runWatch } = await fresh();
  const reads = [];
  const answersVersions = [{ slug: 'a/one' }, { slug: 'a/two' }, { slug: 'a/three' }];
  const seen = [];
  const result = await runWatch({
    projectDir: '/tmp/some-project',
    maxPasses: 3,
    readAnswers: () => { const v = answersVersions[Math.min(reads.length, 2)]; reads.push(v); return v; },
    audit: async (answers) => { seen.push(answers); return (await fakeAudit([row('project', 'Bootstrap guards', answers.slug === 'a/three' ? 'ok' : 'block', '')])()); },
    sleepFn: async () => {},
    out: () => {},
  });
  assert.equal(result.ready, true);
  assert.equal(result.passes, 3);
  assert.equal(reads.length, 3, 'one re-read per pass');
  assert.deepEqual(seen.map((a) => a.slug), ['a/one', 'a/two', 'a/three']);
  cleanupTestEnv(t);
});

test('watch: --once contract via maxPasses=1 — single pass, no sleep, exit-code input ready=false', async () => {
  const { t, runWatch } = await fresh();
  const rows = [row('github', 'gh token scopes', 'block', 'missing: workflow', 'Run: gh auth refresh -h github.com -s workflow', 'you')];
  const lines = [];
  const result = await runWatch({
    intervalMs: 99999,
    maxPasses: 1,
    audit: fakeAudit(rows),
    sleepFn: async () => { throw new Error('must not sleep on a single pass'); },
    out: (l) => lines.push(l),
  });
  assert.equal(result.ready, false);
  assert.equal(result.passes, 1);
  const text = lines.join('\n');
  assert.ok(text.includes('Still not ready after 1 pass'), text);
  assert.ok(text.includes('fix: Run: gh auth refresh'), text);
  cleanupTestEnv(t);
});

test('watch: a flag value (--max-passes 2) is never mistaken for the project folder', async () => {
  const { t } = await fresh();
  const { resolveProjectFolder } = await import('../lib/verify.mjs');
  const { join } = await import('node:path');
  assert.equal(resolveProjectFolder(['--max-passes', '2'], t.home, '/tmp'), null);
  assert.equal(resolveProjectFolder(['--interval', '5'], t.home, '/tmp'), null);
  assert.equal(resolveProjectFolder(['--interval', '5', 'myproj'], t.home, '/tmp'), join('/tmp', 'myproj'));
  assert.equal(resolveProjectFolder(['myproj', '--interval', '5'], t.home, '/tmp'), join('/tmp', 'myproj'));
  assert.equal(resolveProjectFolder([], t.home, '/tmp'), null, 'no last-project file in a fresh home');
  cleanupTestEnv(t);
});

test('watch: printWatchPass keeps every fix and the model-fix pointer visible on non-final passes', () => {
  const audit = {
    ready: false,
    rows: [
      row('github', 'gh login', 'block', 'not signed in', 'Run: gh auth login', 'you'),
      row('project', 'Bootstrap guards', 'block', '1 problem', 'devos fix <folder>', 'model'),
      row('machine', 'Node.js', 'ok', 'v22.10.0'),
    ],
    youSteps: [row('github', 'gh login', 'block', 'not signed in', 'Run: gh auth login', 'you')],
    modelSteps: [row('project', 'Bootstrap guards', 'block', '1 problem', 'devos fix <folder>', 'model')],
  };
  const text = printWatchPass({ pass: 2, audit, changed: [], intervalMs: 15000, final: false });
  assert.ok(text.includes('pass 2'), text);
  assert.ok(text.includes('[STOP] gh login'), text);
  assert.ok(text.includes('[STOP] Bootstrap guards'), text);
  assert.ok(text.includes('fix: Run: gh auth login'), text);
  assert.ok(text.includes('fix: devos fix <folder>'), text);
  assert.ok(text.includes('devos fix <folder> — the watch picks the result up on its own'), text);
  assert.ok(text.includes('next pass in 15s'), text);
  assert.ok(!text.includes('ALL GREEN'), 'a non-final pass never claims all green');
});
