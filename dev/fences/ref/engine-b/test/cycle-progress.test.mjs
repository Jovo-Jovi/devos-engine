// The field report, verbatim: "why 10% and time stops" — the terminal status
// line advanced a time-based estimate (+3%/min) that had nothing to do with the
// actual run, "last output" froze at 12m30s while the run was still working,
// and the watcher gave up at 20 minutes ("The cycle run is still going after 20
// minutes") with the run nowhere near done. These tests pin the new contract:
//   1. The percentage is the run's OWN step count from GitHub (cycle-progress),
//      and the active step's name travels with it.
//   2. The watcher keeps watching for 150 minutes — a cycle that builds, checks,
//      reviews and merges never fits in 20.
//   3. The heartbeat keeps "last output" honest during a long quiet step.
//   4. A repository still on the old single-step cycle workflow is upgraded to
//      the five-step v2 (with PR comments, statuses and heartbeats) before any
//      fresh dispatch, and the upgrade is verified like every repair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  return t;
}

function unstageAll() {
  for (const k of ['DEVOS_FAKE_GH_VIEW_BY_POLL', 'DEVOS_FAKE_GH_VIEW', 'DEVOS_FAKE_GH_LOG', 'DEVOS_FAKE_GH_LOG_FAILED',
    'DEVOS_FAKE_GH_RUNS', 'DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH', 'DEVOS_GH_STATE', 'DEVOS_FAKE_GH_SECRETS', 'DEVOS_GIT_FAKE_PUSH']) {
    delete process.env[k];
  }
}

const poll = (steps, done, status = 'in_progress', conclusion = null) => ({
  status, conclusion,
  url: 'https://github.com/octodev/order-desk/actions/runs/3000',
  jobs: [{ name: 'cycle', status, conclusion, steps }],
});

test('cycleJobProgress: the percentage is the run\'s own completed steps, and the active step travels with it', async () => {
  const { cycleJobProgress } = await import('../lib/watchcycle.mjs');
  const running = cycleJobProgress(poll([
    { name: 'Key presence (devos)', status: 'completed', conclusion: 'success' },
    { name: 'Install project dependencies', status: 'completed', conclusion: 'success' },
    { name: 'Builder — work the fence', status: 'in_progress' },
    { name: 'Checks — typecheck, lint, tests, build, guards', status: 'queued' },
    { name: 'Review — an independent verdict', status: 'queued' },
    { name: 'Verdict — merge, human gate, next attempt, or halt', status: 'queued' },
  ], 2));
  assert.equal(running.total, 6);
  assert.equal(running.done, 2);
  assert.equal(running.percent, 33);
  assert.equal(running.active, 'Builder — work the fence');
  assert.equal(running.job, 'cycle');
  // a queued run reports no steps yet: no fake number
  const queued = cycleJobProgress({ jobs: [] });
  assert.equal(queued.percent, null);
  assert.equal(queued.active, null);
  // a job without step detail still names itself while it runs
  const jobOnly = cycleJobProgress({ jobs: [{ name: 'cycle', status: 'in_progress' }] });
  assert.equal(jobOnly.active, 'cycle');
  // completed steps never read as 100 while the run is still going (cap 97)
  const nearly = cycleJobProgress(poll([
    { name: 'a', status: 'completed', conclusion: 'success' },
    { name: 'b', status: 'completed', conclusion: 'success' },
  ]));
  assert.equal(nearly.percent, 97);
});

test('watchCycleRun: emits cycle-progress on every step change, keeps the heartbeat honest, and watches past 20 minutes', async () => {
  const t = await fresh();
  const A = { name: 'Key presence (devos)', status: 'completed', conclusion: 'success' };
  const B = { name: 'Install the agent CLIs', status: 'completed', conclusion: 'success' };
  const C = { name: 'Builder — work the fence', status: 'in_progress' };
  const D = { name: 'Checks', status: 'queued' };
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_FAKE_GH_VIEW_BY_POLL = JSON.stringify([
    poll([A, B, C, D], 2),               // poll 1: builder running, 50%
    poll([A, B, C, D], 2),               // poll 2: no change (quiet — the heartbeat's domain)
    poll([A, B, C, D], 2, 'completed', 'success'), // poll 3: green
  ]);
  const events = [];
  const { watchCycleRun } = await import('../lib/watchcycle.mjs');
  try {
    const r = await watchCycleRun({
      repo: 'octodev/order-desk', runId: '3000', pollMs: 1, maxMs: 10_000,
      emit: (e) => events.push(e),
    });
    assert.equal(r.status, 'completed');
    assert.equal(r.conclusion, 'success');
    const progress = events.filter((e) => e.type === 'cycle-progress');
    assert.ok(progress.length >= 1, 'cycle-progress events are emitted');
    assert.equal(progress[0].percent, 50);
    assert.equal(progress[0].step, 'Builder — work the fence');
    const logs = events.filter((e) => e.type === 'log').map((e) => e.line);
    assert.ok(logs.some((l) => l.includes('50%') && l.includes('Builder — work the fence')), logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('Cycle run 3000: in_progress')), logs.join('\n'));
  } finally {
    unstageAll();
    cleanupTestEnv(t);
  }
});

test('progress: a cycle-progress event replaces the fake time percent and keeps "last output" fresh', async () => {
  const t = await fresh();
  try {
    const { createProgressState, applyEvent, progressSnapshot, renderStatusLine } = await import('../lib/progress.mjs');
    const state = createProgressState({ now: () => 1_000_000 });
    applyEvent(state, { type: 'phase', name: 'watching-cycle' });
    applyEvent(state, { type: 'cycle-progress', percent: 33, step: 'Builder — work the fence' });
    const snap = progressSnapshot(state);
    assert.equal(snap.percent, 33, 'the REAL step percentage, not +3%/min');
    assert.equal(snap.lastLine, 'cycle step: Builder — work the fence');
    assert.ok(snap.lastOutputAgoMs != null && snap.lastOutputAgoMs < 5_000, '"last output" is fresh, not frozen');
    const line = renderStatusLine(snap);
    assert.ok(line.includes('33%'), line);
    assert.ok(line.includes('cycle step: Builder'), line);
    // progress only moves forward: an older lower number never pulls it back
    applyEvent(state, { type: 'cycle-progress', percent: 10, step: 'Checks' });
    assert.equal(progressSnapshot(state).percent, 33);
    // the real number climbs when GitHub says so
    applyEvent(state, { type: 'cycle-progress', percent: 58, step: 'Review — an independent verdict' });
    assert.equal(progressSnapshot(state).percent, 58);
  } finally {
    cleanupTestEnv(t);
  }
});

// ---------- the cycle-v2 upgrade: the old single-step workflow becomes the ----------
// ---------- five-step structure before any fresh dispatch ---------------------------

const OLD_WORKFLOW = [
  'name: devos-cycle',
  'on:',
  '  workflow_dispatch:',
  '  workflow_call:',
  'permissions:',
  '  contents: write',
  'jobs:',
  '  cycle:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          fetch-depth: 0',
  '      - name: Install the agent CLIs the cycle runs (reviewer + builders)',
  '        run: node scripts/devos/install-clis.mjs',
  '      - name: One attempt of one task',
  '        run: node scripts/devos/cycle.mjs',
  '        env:',
  '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
  '',
].join('\n');

function stageOldProject(dir) {
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(dir, 'scripts', 'devos'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', 'devos-cycle.yml'), OLD_WORKFLOW);
  writeFileSync(join(dir, 'scripts', 'devos', 'cycle.mjs'), '// OLD single-step runner\nconsole.log("old");\n');
}

test('syncCycleV2: the old single-step workflow + runner are upgraded, the selected keys narrowed, and it is idempotent', async (t) => {
  const env = await fresh();
  const dir = join(env.workspace, 'proj');
  stageOldProject(dir);
  try {
    const { syncCycleV2, cycleWorkflowIsV2, repairWorkflowSecrets, verifyWorkflowOnGithub } = await import('../lib/wfsecrets.mjs');
    const said = [];
    const up = syncCycleV2(dir, { say: (l) => said.push(l) });
    assert.equal(up.changed, true);
    assert.equal(up.files.length, 3, 'workflow + cycle.mjs + common.mjs');
    const wf = readFileSync(join(dir, '.github', 'workflows', 'devos-cycle.yml'), 'utf8');
    assert.equal(cycleWorkflowIsV2(dir), true);
    assert.ok(wf.includes('Builder — work the fence'), 'the Builder step exists');
    assert.ok(wf.includes('Checks — typecheck, lint, tests, build, guards'), 'the Checks step exists');
    assert.ok(wf.includes('Review — an independent verdict on the built work'), 'the Review step exists');
    assert.ok(wf.includes('Verdict — merge, human gate, next attempt, or halt'), 'the Verdict step exists');
    const runner = readFileSync(join(dir, 'scripts', 'devos', 'cycle.mjs'), 'utf8');
    assert.ok(runner.includes('phaseBuild'), 'the phase runner landed');
    assert.ok(runner.includes("heartbeat"), 'the heartbeat is in the runner');
    assert.ok(said.join('\n').includes('one opaque step'), 'the upgrade says what it did');
    // the secret repair then narrows the v2 echo to the selected keys and verifies
    const rep = repairWorkflowSecrets(dir, ['CURSOR_API_KEY'], { say: () => {} });
    assert.equal(rep.changed, true);
    const wf2 = readFileSync(join(dir, '.github', 'workflows', 'devos-cycle.yml'), 'utf8');
    assert.ok(wf2.includes('echo "CURSOR_API_KEY: $CURSOR_API_KEY"'), 'the echo names the selected key');
    assert.ok(!wf2.includes('echo "OPENAI_API_KEY'), 'the unselected keys are gone from the echo');
    const v = verifyWorkflowOnGithub({ repo: 'octodev/order-desk', projectDir: dir, names: ['CURSOR_API_KEY'] });
    assert.equal(v.checked, true);
    assert.equal(v.ok, true, 'the upgraded workflow verifies on GitHub\'s own copy');
    // idempotent: a v2 project is left exactly as it is
    const again = syncCycleV2(dir, { say: () => {} });
    assert.equal(again.changed, false);
  } finally {
    cleanupTestEnv(env);
  }
});

test('continue: an old single-step repository is upgraded to the five-step cycle before the fresh round is dispatched', async () => {
  const env = await fresh();
  try {
    const { runInit } = await import('../lib/init.mjs');
    const { runContinue } = await import('../lib/continue.mjs');
    const { keyCatalog } = await import('../lib/keys.mjs');
    const { saasDraft } = await import('./helpers.mjs');
    const draft = saasDraft();
    draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
    process.env.DEVOS_FAKE_MODE = 'no-github-reject';
    const first = await runInit({ draft, home: env.home, workspace: env.workspace, emit: () => {} });
    delete process.env.DEVOS_FAKE_MODE;
    const projectDir = first.projectDir;
    writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
    // the tree is a git repository, like every bootstrapped project
    const { execFileSync } = await import('node:child_process');
    execFileSync('/usr/bin/git', ['init', '-b', 'main'], { cwd: projectDir });
    execFileSync('/usr/bin/git', ['config', 'user.email', 'test@devos.local'], { cwd: projectDir });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'DEVOS Test'], { cwd: projectDir });
    execFileSync('/usr/bin/git', ['add', '-A'], { cwd: projectDir });
    execFileSync('/usr/bin/git', ['commit', '-m', 'bootstrap'], { cwd: projectDir });
    // the stale single-step workflow, like the field repository had
    stageOldProject(projectDir);
    // every key already set on GitHub (the field user typed them long ago)
    const entries = {};
    for (const k of keyCatalog(draft)) entries[k.name] = { status: 'set', via: 'field-test', at: new Date().toISOString() };
    mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
    writeFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), JSON.stringify({ schema: 'devos/secrets@1', entries }, null, 2));
    process.env.DEVOS_GH_STATE = join(env.home, 'gh-state.json');
    process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(draft).map((k) => k.name).join(' ');
    process.env.DEVOS_GIT_FAKE_PUSH = '1';
    process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
      databaseId: 1001, conclusion: 'failure', status: 'completed',
      url: 'https://github.com/octodev/order-desk/actions/runs/1001',
    }]);
    process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
      databaseId: 2002, status: 'in_progress', url: 'https://github.com/octodev/order-desk/actions/runs/2002',
    }]);
    process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
      status: 'completed', conclusion: 'success',
      url: 'https://github.com/octodev/order-desk/actions/runs/2002',
      jobs: [{ name: 'cycle', conclusion: 'success' }],
    });
    const events = [];
    const result = await runContinue({
      projectDir, home: env.home, installFn: async () => ({ code: 0, lines: ['fake install ok'] }),
      emit: (e) => events.push(e), waitKeys: false, watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    assert.equal(result.firstRunGreen, true, 'the fresh round went green');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes('one opaque step'), 'the upgrade is announced in plain English', say);
    assert.ok(say.includes('pushed'), 'the upgraded workflow was pushed');
    // the repository now runs the five-step workflow — and the dispatch was verified against it
    const wf = readFileSync(join(projectDir, '.github', 'workflows', 'devos-cycle.yml'), 'utf8');
    assert.ok(wf.includes('devos:cycle-v2'), 'the v2 marker is in the repository workflow');
    assert.ok(wf.includes('Builder — work the fence'), 'the Builder step is in the repository workflow');
    assert.ok(wf.includes('Verdict — merge, human gate, next attempt, or halt'), 'the Verdict step is in the repository workflow');
    assert.ok(existsSync(join(projectDir, 'scripts', 'devos', 'cycle.mjs')), 'the phase runner is in place');
    const runner = readFileSync(join(projectDir, 'scripts', 'devos', 'cycle.mjs'), 'utf8');
    assert.ok(runner.includes('runModelStepLive'), 'the upgraded runner carries the heartbeat');
    const ghLog = (await import('./helpers.mjs')).fakeLogEntries(env.fakeLog).filter((e) => e.cmd === 'gh');
    assert.ok(ghLog.some((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run'), 'the fresh round was dispatched');
  } finally {
    unstageAll();
    cleanupTestEnv(env);
  }
});
