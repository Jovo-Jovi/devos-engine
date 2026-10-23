// The field round that never opened the card, verbatim: the failed run's log
// echoed five UNSELECTED keys and the builder died on its auth wall for
// CURSOR_API_KEY; GitHub's secret list CLAIMED the key was set; the old engine
// skipped the card ("nothing is missing"), dispatched blind, and the window
// finished with a report that told the user to type into a card that did not
// exist. These tests pin the new contract:
//   1. The card opens on EVERY key-shaped failure — including when GitHub's
//      list says the key is set (a stale value fails exactly like a missing
//      one). The ask carries the key as "suspected", not "missing".
//   2. A submitted value overwrites the GitHub secret; no value ever reaches
//      any log, event, or argv.
//   3. The workflow repair is VERIFIED on GitHub's own copy before any fresh
//      dispatch; a push that did not land blocks the dispatch instead of lying.
//   4. The fix loop holds: fail on keys again -> the card re-opens (round 2),
//      until the first run is green, the user skips, or the cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { runContinue } = await import('../lib/continue.mjs');
  const { keyCatalog, selectedToolSecrets } = await import('../lib/keys.mjs');
  return { t, runInit, runContinue, keyCatalog, selectedToolSecrets };
}

const noInstall = async () => ({ code: 0, lines: ['fake install ok'] });

// The user's exact field log (runs 39844116233 / 39854768901): five keys of
// tools they did not pick, all EMPTY; the selected builder's key appears
// NOWHERE; the builder dies on its own auth wall naming it.
const FIELD_LOG = [
  '##[group]One attempt of one task',
  '  ANTHROPIC_API_KEY: ',
  '  CLAUDE_CODE_OAUTH_TOKEN: ',
  '  OPENAI_API_KEY: ',
  '  GEMINI_API_KEY: ',
  '  ZAI_API_KEY: ',
  '##[endgroup]',
  '[cycle] task T01: First vertical slice',
  '[cycle] attempt 1 of 3',
  '[cycle] builder: cursor grok-4.7-high',
  '[cycle] builder exited with code 1',
  "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.",
  '##[error]Process completed with exit code 1.',
].join('\n');

// The stale model-written workflow the user's repository actually had: the
// five stale keys mapped at top level, the checkout written the CONVENTIONAL
// way (dash and uses: on separate lines), no engine-managed echo step.
const STALE_WORKFLOW = [
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
  '      - name: Checkout repository',
  '        uses: actions/checkout@v4',
  '        with:',
  '          fetch-depth: 0',
  '      - name: Install the agent CLIs the cycle runs (reviewer + builders)',
  '        run: node scripts/devos/install-clis.mjs',
  '      - name: One attempt of one task',
  '        run: node scripts/devos/cycle.mjs',
  '        env:',
  '          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
  '          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}',
  '          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}',
  '          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
  '          ZAI_API_KEY: ${{ secrets.ZAI_API_KEY }}',
  '',
].join('\n');

async function setupProject({ t, runInit, keyCatalog, secrets }) {
  const { selectedToolSecrets } = await import('../lib/keys.mjs');
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  draft.models.reviewer = { cli: 'cursor', model: 'grok-4.7-high' };
  draft.models.builder = { cli: 'cursor', model: 'grok-4.7-high' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '-b', 'main'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.email', 'test@devos.local'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.name', 'DEVOS Test'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['add', '-A'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['commit', '-m', 'bootstrap'], { cwd: projectDir });
  writeFileSync(join(projectDir, '.github', 'workflows', 'devos-cycle.yml'), STALE_WORKFLOW);
  // The engine's own records: every catalog key was confirmed set earlier (the
  // field user had typed them long ago) — section 4's keys stage must find
  // nothing to ask, so the ONLY card under test is the suspected-value one.
  const entries = {};
  for (const k of keyCatalog(draft)) entries[k.name] = { status: 'set', via: 'field-test', at: new Date().toISOString() };
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), JSON.stringify({ schema: 'devos/secrets@1', entries }, null, 2));
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  if (secrets) process.env.DEVOS_FAKE_GH_SECRETS = secrets;
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 39854768901, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/39854768901',
  }]);
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 39860000001, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/39860000001',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/order-desk/actions/runs/39860000001',
    jobs: [{ name: 'cycle', conclusion: 'success' }],
  });
  process.env.DEVOS_FAKE_GH_LOG_FAILED = FIELD_LOG;
  process.env.DEVOS_FAKE_GH_LOG = FIELD_LOG;
  return { draft, projectDir, selected: selectedToolSecrets(draft) };
}

function unstageAll() {
  for (const k of ['DEVOS_GH_STATE', 'DEVOS_FAKE_GH_SECRETS', 'DEVOS_GIT_FAKE_PUSH', 'DEVOS_FAKE_GH_RUNS',
    'DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH', 'DEVOS_FAKE_GH_VIEW', 'DEVOS_FAKE_GH_LOG', 'DEVOS_FAKE_GH_LOG_FAILED',
    'DEVOS_GH_API_STALE_ALWAYS', 'DEVOS_GH_API_STALE_TEXT', 'DEVOS_FAKE_GH_VIEW_BY_DISPATCH']) {
    delete process.env[k];
  }
}

test('wfsecrets: the echo step is inserted after a CONVENTIONAL checkout block and stays idempotent', async () => {
  const { ensureKeyEchoStep } = await import('../lib/wfsecrets.mjs');
  const r1 = ensureKeyEchoStep(STALE_WORKFLOW, ['CURSOR_API_KEY']);
  assert.equal(r1.changed, true, 'the conventional checkout (- name / uses on separate lines) must be found');
  assert.ok(r1.text.includes('devos:key-echo'), r1.text);
  assert.ok(r1.text.includes('echo "CURSOR_API_KEY: $CURSOR_API_KEY"'), r1.text);
  const ci = r1.text.indexOf('actions/checkout');
  const ei = r1.text.indexOf('Key presence');
  const si = r1.text.indexOf('scripts/devos/cycle.mjs');
  assert.ok(ci < ei && ei < si, 'checkout < echo < cycle step — nothing was eaten');
  const r2 = ensureKeyEchoStep(r1.text, ['CURSOR_API_KEY']);
  assert.equal(r2.changed, false, 'idempotent');
});

test('wfsecrets: verifyWorkflowOnGithub reads the workflow back from GitHub and names what is missing', async () => {
  const t = {};
  makeTestEnv(t);
  const dir = join(t.workspace, 'verify-proj');
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  const { verifyWorkflowOnGithub, repairWorkflowSecrets } = await import('../lib/wfsecrets.mjs');
  // The stale file on disk — the fake gh serves the local file for the
  // contents call, so "what GitHub has" equals "what was pushed".
  writeFileSync(join(dir, '.github', 'workflows', 'devos-cycle.yml'), STALE_WORKFLOW);
  const bad = verifyWorkflowOnGithub({ repo: 'octodev/order-desk', projectDir: dir, names: ['CURSOR_API_KEY'] });
  assert.equal(bad.checked, true);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missingMapped, ['CURSOR_API_KEY']);
  assert.deepEqual(bad.echoMissing, ['CURSOR_API_KEY']);
  // The real repair, then verify again: mapping + echo, every selected key.
  repairWorkflowSecrets(dir, ['CURSOR_API_KEY'], { say: () => {} });
  const good = verifyWorkflowOnGithub({ repo: 'octodev/order-desk', projectDir: dir, names: ['CURSOR_API_KEY'] });
  assert.equal(good.checked, true);
  assert.equal(good.ok, true, 'the repaired workflow verifies: mapping + echo, every selected key');
  // A GitHub copy that is NOT the repaired one (a push that landed elsewhere):
  process.env.DEVOS_GH_API_STALE_ALWAYS = '1';
  process.env.DEVOS_GH_API_STALE_TEXT = STALE_WORKFLOW;
  const stale = verifyWorkflowOnGithub({ repo: 'octodev/order-desk', projectDir: dir, names: ['CURSOR_API_KEY'] });
  assert.equal(stale.checked, true);
  assert.equal(stale.ok, false, 'GitHub still holds the stale workflow');
  delete process.env.DEVOS_GH_API_STALE_ALWAYS;
  delete process.env.DEVOS_GH_API_STALE_TEXT;
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- THE field
// case, end to end: GitHub's list CLAIMS the key is set, the log proves the
// run had no working value — the card OPENS (suspected), the submitted value
// overwrites the secret, the repair is verified on GitHub, and the fresh round
// goes green. The ask happens BEFORE any dispatch.
test('continue: GitHub says the key is set but the run proved otherwise -> the card opens, the value lands, the repair is verified, the round goes green', async () => {
  const { t, runContinue, keyCatalog } = await fresh();
  const env = await setupProject({ t, runInit: (await import('../lib/init.mjs')).runInit, keyCatalog, secrets: keyCatalog(saasDraft()).map((k) => k.name).join(' ') });
  const projectDir = env.projectDir;
  const VALUES = { CURSOR_API_KEY: 'fresh-cursor-value-9k2' };
  const asks = [];
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async (ask) => { asks.push(ask); return { ...VALUES }; },
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    // THE CARD OPENED — exactly once, with the selected key as SUSPECTED
    // (GitHub lists it; the run's own log proves it had no working value).
    assert.equal(asks.length, 1, `one ask (${asks.length})`);
    assert.deepEqual(asks[0].suspected, ['CURSOR_API_KEY']);
    assert.ok(!asks[0].missing.includes('CURSOR_API_KEY'), 'the key is on GitHub — it is suspected, not missing');
    assert.ok(asks[0].note.includes('stale'), 'the ask says why: a stale value fails like a missing one');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes('The Missing keys card is open in the browser window (CURSOR_API_KEY)'), say);
    assert.ok(say.includes('None of the keys this project selected'), say);
    assert.ok(say.includes("the builder needs CURSOR_API_KEY, but the run's log never echoed it"), say);
    // the value landed straight into the secret; names only everywhere
    assert.ok(say.includes('uploaded CURSOR_API_KEY to GitHub — the value went straight into the secret'), say);
    // the repair: the stale single-step workflow is upgraded to the five-step
    // v2 (its top-level env block maps every key from its own secret), the echo
    // is narrowed to the selected key, and both are pushed AND verified on
    // GitHub's own copy
    assert.ok(say.includes('one opaque step'), say);
    assert.ok(say.includes('run log now echoes every selected key (CURSOR_API_KEY)'), say);
    assert.ok(say.includes('The repaired workflow was pushed'), say);
    assert.ok(say.includes('Verified on GitHub'), say);
    const fixed = readFileSync(join(projectDir, '.github', 'workflows', 'devos-cycle.yml'), 'utf8');
    assert.ok(fixed.includes('CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}'), fixed);
    assert.ok(fixed.includes('devos:key-echo'), 'the engine-managed echo step is in the workflow');
    // the fresh round went green — the job is done
    assert.equal(result.firstRunGreen, true);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '39860000001');
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    assert.ok(ghLog.some((e) => e.argv[0] === 'secret' && e.argv[1] === 'set' && e.argv[2] === 'CURSOR_API_KEY'), 'the value was uploaded');
    assert.ok(!ghLog.some((e) => e.argv.includes('--body')), 'no value ever rides argv');
    assert.equal(ghLog.filter((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run').length, 1, 'exactly one dispatch');
    // privacy: the value is in no log line, no event, no argv
    const raw = fakeLogEntries(t.fakeLog).map((e) => JSON.stringify(e)).join('\n') + '\n' + events.map((e) => JSON.stringify(e)).join('\n');
    assert.ok(!raw.includes(VALUES.CURSOR_API_KEY), 'a key value reached a log or event');
    // the card was answered BEFORE the dispatch — the window held, it did not finish first
    const apiCalls = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    const setIdx = apiCalls.findIndex((e) => e.argv[0] === 'secret' && e.argv[1] === 'set');
    const dispatchIdx = apiCalls.findIndex((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run');
    assert.ok(setIdx >= 0 && dispatchIdx > setIdx, 'the upload happened before the fresh dispatch');
  } finally {
    unstageAll();
  }
  cleanupTestEnv(t);
});

// Skip = the user is sure the values are correct: no upload, the mapping
// repair still runs, and the fresh round starts (the mapping was the fix).
test('continue: skip on the suspected card -> no upload, the repair still runs, the fresh round starts', async () => {
  const { t, runContinue, keyCatalog } = await fresh();
  const env = await setupProject({ t, runInit: (await import('../lib/init.mjs')).runInit, keyCatalog, secrets: keyCatalog(saasDraft()).map((k) => k.name).join(' ') });
  const projectDir = env.projectDir;
  const asks = [];
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async (ask) => { asks.push(ask); return null; },
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    assert.equal(asks.length, 1, 'the card opened once, then the skip was honored');
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    assert.ok(!ghLog.some((e) => e.argv[0] === 'secret' && e.argv[1] === 'set'), 'skip uploads nothing');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes('The values stay as they are — repairing the workflow mapping and starting the fresh round anyway'), say);
    assert.ok(say.includes('Verified on GitHub'), say);
    assert.equal(result.firstRunGreen, true, 'the mapping repair was the fix; the fresh round went green');
    assert.equal(ghLog.filter((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run').length, 1, 'exactly one dispatch after the skip');
  } finally {
    unstageAll();
  }
  cleanupTestEnv(t);
});

// The hold-open loop: the fresh round fails on the SAME key again -> the card
// re-opens (round 2), the second submit lands, the second round goes green.
test('continue: the fresh round fails on keys again -> the card re-opens (round 2) and the loop ends green', async () => {
  const { t, runContinue, keyCatalog } = await fresh();
  const env = await setupProject({ t, runInit: (await import('../lib/init.mjs')).runInit, keyCatalog, secrets: keyCatalog(saasDraft()).map((k) => k.name).join(' ') });
  const projectDir = env.projectDir;
  // Dispatch 1 fails exactly like the field, dispatch 2 is green.
  process.env.DEVOS_FAKE_GH_VIEW_BY_DISPATCH = JSON.stringify([
    { status: 'completed', conclusion: 'failure', jobs: [{ name: 'cycle', conclusion: 'failure' }] },
    { status: 'completed', conclusion: 'success', jobs: [{ name: 'cycle', conclusion: 'success' }] },
  ]);
  const asks = [];
  const events = [];
  let submitCount = 0;
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async (ask) => { asks.push(ask); submitCount += 1; return { CURSOR_API_KEY: `fresh-value-${submitCount}` }; },
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    assert.equal(asks.length, 2, `the card opened twice (${asks.length})`);
    assert.equal(asks[1].round, 2, 'the second ask is round 2');
    assert.deepEqual(asks[0].suspected, ['CURSOR_API_KEY']);
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes('The fresh round failed on the keys again (CURSOR_API_KEY)'), say);
    assert.ok(say.includes('the window stays open until the first run is green or you press Stop'), say);
    assert.equal(result.firstRunGreen, true, 'the loop ended green');
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    assert.equal(ghLog.filter((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run').length, 2, 'two fresh dispatches — one per fix round');
    assert.equal(ghLog.filter((e) => e.argv[0] === 'secret' && e.argv[1] === 'set' && e.argv[2] === 'CURSOR_API_KEY').length, 2, 'the value was uploaded once per round');
  } finally {
    unstageAll();
  }
  cleanupTestEnv(t);
});

// The push that did not land: GitHub's own copy of the workflow is still the
// stale one -> the engine says so and does NOT dispatch a blind round.
test('continue: the repaired workflow is not on GitHub main -> no dispatch, the truth is named', async () => {
  const { t, runContinue, keyCatalog } = await fresh();
  const env = await setupProject({ t, runInit: (await import('../lib/init.mjs')).runInit, keyCatalog, secrets: keyCatalog(saasDraft()).map((k) => k.name).join(' ') });
  const projectDir = env.projectDir;
  process.env.DEVOS_GH_API_STALE_ALWAYS = '1';
  process.env.DEVOS_GH_API_STALE_TEXT = STALE_WORKFLOW;
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async () => null, // skip the card; the verification is what is under test
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes("GitHub's copy of devos-cycle.yml on main is NOT the repaired one yet"), say);
    assert.ok(say.includes('The fresh run would still execute the OLD workflow'), say);
    assert.ok(say.includes('no run starts on that'), say);
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    assert.equal(ghLog.filter((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run').length, 0, 'no blind dispatch');
    assert.equal(result.firstRunGreen, false);
    assert.equal(ghLog.filter((e) => e.argv[0] === 'api' && String(e.argv[1]).includes('contents/')).length >= 2, true, 'GitHub was read back at least twice (verify + re-verify)');
  } finally {
    unstageAll();
  }
  cleanupTestEnv(t);
});
