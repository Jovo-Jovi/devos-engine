// The user's field report, closed two ways:
//   1. The report must judge ONLY the keys of the tools the user selected — an
//      unselected tool's empty key is noise, never this project's problem.
//   2. The user must have the option to put the real missing values in right in
//      the failure flow — the engine uploads them (a value never reaches the
//      model) — and when the values ARE on GitHub but the run still saw them
//      EMPTY, the workflow's own secret mapping is the suspect: the engine
//      reads the repository's workflow, repairs the mapping deterministically
//      (a top-level env block every step inherits), pushes it, and starts the
//      next fresh round itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

// The echo group of a real failing run: the workflow printed every known key,
// the selected ones came up EMPTY, and the agent CLI died on its own auth wall.
const FIELD_LOG = [
  '##[group]One attempt of one task',
  '  CLAUDE_CODE_OAUTH_TOKEN: ',
  '  CURSOR_API_KEY: ',
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

// ---------------------------------------------------------------- unit: the
// selected-keys filter in the report — the exact complaint: "check the selected
// user keys, not keys not selected by user".
test('report: only the selected keys are judged; unselected tools are named once as irrelevant', async () => {
  const { buildCycleReport, diagnoseCycleLog, runKeyPresence } = await import('../lib/watchcycle.mjs');
  const selected = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY'];
  const presence = runKeyPresence(FIELD_LOG.split('\n'));
  assert.ok(presence.length >= 5, 'the echo group lists every known key');

  const report = buildCycleReport({
    repo: 'jovo-jovi/tinytasks', runId: '39769948125', conclusion: 'failure',
    jobs: [{ name: 'cycle', conclusion: 'failure' }], logLines: FIELD_LOG.split('\n'),
    projectDir: 'C:\\proj', selectedNames: selected,
  });
  const text = report.join('\n');
  // selected keys, and only they, carry the verdict
  assert.ok(text.includes('Keys the run actually saw — the ones this project selected:'), text);
  assert.ok(text.includes('CLAUDE_CODE_OAUTH_TOKEN — EMPTY'), text);
  assert.ok(text.includes('CURSOR_API_KEY — EMPTY'), text);
  assert.ok(!text.includes('ANTHROPIC_API_KEY'), 'a selected key absent from the log is not invented');
  // unselected keys are never a problem — one line, no verdict
  assert.ok(text.includes('Not selected for this project (keys of tools you did not pick): OPENAI_API_KEY, GEMINI_API_KEY, ZAI_API_KEY — they do not matter here.'), text);
  assert.ok(!text.includes('OPENAI_API_KEY — EMPTY'), 'an unselected key never gets a verdict');
  // the cause is the builder's OWN auth wall, named to the key: the log shows
  // CURSOR empty, the builder died asking for CURSOR_API_KEY.
  assert.ok(text.includes('Likely cause: the builder needs CURSOR_API_KEY, and the run saw it EMPTY'), text);
  assert.ok(text.includes('the intake opens with devos continue'), text);
  assert.ok(text.includes('the workflow mapping is broken (devos continue repairs the mapping itself)'), text);
  // the Next line offers the intake with both private doors
  assert.ok(text.includes('Next: put the real value(s) in — run devos continue C:\\proj'), text);
  assert.ok(text.includes('the Missing keys card opens in the browser window'), text);
  assert.ok(text.includes('until the FIRST cycle run is green'), text);

  // without selectedNames (a caller that does not know the selections) the
  // report stays honest but unfiltered — every found key is listed plainly.
  const plain = buildCycleReport({
    repo: 'o/r', runId: '1', conclusion: 'failure', jobs: [], logLines: FIELD_LOG.split('\n'),
  });
  assert.ok(plain.join('\n').includes('Keys the run actually saw:'), 'unfiltered callers keep the plain line');

  // diagnoseCycleLog: the same filter on the "code null" cause
  const nullLog = ['[cycle] builder exited with code null', '  CURSOR_API_KEY: ', '  OPENAI_API_KEY: '];
  const cause = diagnoseCycleLog(nullLog, null, selected);
  assert.ok(cause.includes('saw these selected keys as EMPTY: CURSOR_API_KEY'), cause);
  assert.ok(!cause.includes('OPENAI_API_KEY'), cause);
  // all selected present + an auth mention -> the agent's own words stand
  const masked = ['  CURSOR_API_KEY: ***', 'Error: Authentication required'];
  const cause2 = diagnoseCycleLog(masked, null, selected);
  assert.ok(cause2.includes('every key this project selected was present'), cause2);
});

// ------------------------------------------------ unit: the diagnosis tells
// the truth in every branch — the old report claimed "every key present
// (masked)" in one line and "none appeared" in the next. These pin the fixes.
test('diagnose: the auth wall names the key — missing on GitHub, never echoed, or present', async () => {
  const { diagnoseCycleLog } = await import('../lib/watchcycle.mjs');
  const selected = ['CURSOR_API_KEY'];
  const AUTH_LOG = [
    '  ANTHROPIC_API_KEY: ',
    '  OPENAI_API_KEY: ',
    '[cycle] builder: cursor grok-4.7-high',
    '[cycle] builder exited with code 1',
    "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.",
  ];
  // 1) The key is not on GitHub (GitHub's own list says so) — say THAT.
  const c1 = diagnoseCycleLog(AUTH_LOG, null, selected, { missingOnGithub: ['CURSOR_API_KEY'] });
  assert.ok(c1.includes('the builder needs CURSOR_API_KEY, and CURSOR_API_KEY is not on GitHub yet'), c1);
  assert.ok(c1.includes('Missing keys card in the browser window'), c1);
  assert.ok(c1.includes('A value never reaches the model'), c1);
  // 2) The log never echoed it — the mapping/echo gap, no false "present".
  const c2 = diagnoseCycleLog(AUTH_LOG, null, selected);
  assert.ok(c2.includes("the builder needs CURSOR_API_KEY, but the run's log never echoed it"), c2);
  assert.ok(c2.includes('repairs BOTH itself'), c2);
  // 3) The generic key-ish fallback no longer lies: no echo at all -> the
  //    never-echoed truth, not "every key present (masked)".
  const c3 = diagnoseCycleLog(['Error: bad api key'], null, selected);
  assert.ok(c3.includes("never echoed any key this project selected (CURSOR_API_KEY)"), c3);
  assert.ok(!c3.includes('was present in the run'), c3);
  // 4) But when the log DOES prove presence, the old truth stands.
  const c4 = diagnoseCycleLog(['  CURSOR_API_KEY: ***', 'Error: bad api key'], null, selected);
  assert.ok(c4.includes('was present in the run (masked)'), c4);
});

// ---------------------------------------------------------------- unit: the
// workflow mapping repair — deterministic, additive, idempotent, names only.
test('wfsecrets: top-level env patch and secrets: inherit are additive and idempotent', async () => {
  const { ensureTopLevelEnvMappings, ensureSecretsInherit, topLevelEnvMappings } = await import('../lib/wfsecrets.mjs');
  const stale = [
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
    '      - name: One attempt of one task',
    '        run: node scripts/devos/cycle.mjs',
    '        env:',
    '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '',
  ].join('\n');
  const r1 = ensureTopLevelEnvMappings(stale, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY']);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.added, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY']);
  const t1 = topLevelEnvMappings(r1.text).map((m) => m.name);
  assert.deepEqual(t1, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY'], 'exactly the selected keys, top level');
  assert.ok(r1.text.includes('env:\n  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}'), r1.text);
  assert.ok(r1.text.indexOf('env:') < r1.text.indexOf('jobs:'), 'the block lands before jobs');
  assert.ok(r1.text.includes('          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'), 'the step-scoped token stays step-scoped');
  const r2 = ensureTopLevelEnvMappings(r1.text, ['CURSOR_API_KEY']);
  assert.equal(r2.changed, false, 'idempotent');
  const r3 = ensureTopLevelEnvMappings(r1.text, ['OPENAI_API_KEY']);
  assert.deepEqual(r3.added, ['OPENAI_API_KEY'], 'extends an existing top-level block in place');
  assert.equal(topLevelEnvMappings(r3.text).length, 4);

  const caller = [
    'jobs:',
    '  resume:',
    '    steps:',
    '      - uses: ./.github/workflows/devos-cycle.yml',
    '        with:',
    '          wait: true',
    '      - uses: ./.github/workflows/devos-cycle.yml',
    '        secrets: inherit',
    '',
  ].join('\n');
  const i1 = ensureSecretsInherit(caller);
  assert.equal(i1.changed, true);
  assert.equal(i1.fixed, 1, 'only the step without secrets is patched');
  assert.ok(i1.text.includes('        secrets: inherit\n        with:'), i1.text);
  const i2 = ensureSecretsInherit(i1.text);
  assert.equal(i2.changed, false, 'inherit is idempotent');
});

// ---------------------------------------------------------------- e2e: the
// user's exact field state — every selected key IS on GitHub, yet the fresh run
// saw them all EMPTY, because the repository's workflow never mapped them (or
// mapped them on one step only). The engine proves the mapping gap, repairs it
// deterministically, pushes, and the fresh round goes green.
test('continue: keys on GitHub but the run saw them EMPTY -> the workflow mapping is repaired, pushed, and the fresh round goes green', async () => {
  const { t, runInit, runContinue, keyCatalog, selectedToolSecrets } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  // init_github had really run once: the project is a git repo with a commit.
  execFileSync('/usr/bin/git', ['init', '-b', 'main'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.email', 'test@devos.local'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.name', 'DEVOS Test'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['add', '-A'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['commit', '-m', 'bootstrap'], { cwd: projectDir });
  // THE STALE WORKFLOW the user's repository actually had: the CLI install step
  // is there, but the agent credentials are mapped NOWHERE (the echo prints
  // names, nothing maps them) — exactly why the runner saw UNDEFINED env vars
  // and the CLIs died on their own auth wall. Plus a caller that would strip
  // the secrets on the way in.
  const wfDir = join(projectDir, '.github', 'workflows');
  writeFileSync(join(wfDir, 'devos-cycle.yml'), [
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
    '      - name: Install the agent CLIs the cycle runs (reviewer + builders)',
    '        run: node scripts/devos/install-clis.mjs',
    '      - name: One attempt of one task',
    '        run: node scripts/devos/cycle.mjs',
    '        env:',
    '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '',
  ].join('\n'));
  writeFileSync(join(wfDir, 'devos-resume.yml'), [
    'name: devos-resume',
    'on:',
    '  issue_comment:',
    'jobs:',
    '  resume:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: ./.github/workflows/devos-cycle.yml',
    '        with:',
    '          wait: true',
    '',
  ].join('\n'));
  const ghState = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_STATE = ghState;
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(draft).map((k) => k.name).join(' ');
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
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    // the engine named the real suspect before touching anything
    assert.ok(say.includes('The values are on GitHub, yet the run saw them EMPTY — the workflow\'s secret mapping is the suspect'), say);
    assert.ok(say.includes('Not selected for this project'), say);
    // the repair, in the engine's own words: the stale single-step workflow is
    // FIRST upgraded to the five-step v2 (whose top-level env block maps every
    // key), then the echo is narrowed to exactly the selected keys, and the
    // caller that would strip the secrets gets "secrets: inherit".
    assert.ok(say.includes('one opaque step'), say);
    assert.ok(say.includes('The workflow\'s run log now echoes every selected key (CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, CURSOR_API_KEY)'), say);
    assert.ok(say.includes('devos-resume.yml calls devos-cycle without passing secrets'), say);
    assert.ok(say.includes('The repaired workflow was pushed'), say);
    assert.ok(result.resumed.includes('workflow-secrets-fix'), `resumed: ${JSON.stringify(result.resumed)}`);
    // and the fresh round went green — the job is done
    assert.ok(result.resumed.includes('cycle-dispatch'), say);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '1002');
    assert.equal(result.firstRunGreen, true);
    assert.ok((result.cycleReport || []).join('\n').includes('GREEN'));

    // the files on disk carry the proof: the v2 five-step workflow, every
    // selected key mapped at top level, the echo narrowed to the selection
    const fixed = readFileSync(join(wfDir, 'devos-cycle.yml'), 'utf8');
    for (const n of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY']) {
      assert.ok(fixed.includes(`${n}: \${{ secrets.${n} }}`), `${n} mapped at top level\n${fixed}`);
    }
    assert.ok(fixed.includes('Builder — work the fence'), 'the workflow is the five-step v2');
    const echoIdx = fixed.indexOf('devos:key-echo');
    const echoBlock = fixed.slice(echoIdx, fixed.indexOf('- uses:', echoIdx) === -1 ? echoIdx + 700 : fixed.indexOf('- uses:', echoIdx));
    for (const n of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY']) {
      assert.ok(echoBlock.includes(`echo "${n}: `), `the echo names ${n}`);
    }
    assert.ok(!echoBlock.includes('OPENAI_API_KEY') && !echoBlock.includes('GEMINI_API_KEY') && !echoBlock.includes('ZAI_API_KEY'), 'the echo never names unselected keys');
    assert.ok(!/^  GH_TOKEN:/m.test(fixed.split('jobs:')[0]), 'GH_TOKEN never leaks to the top-level block');
    const caller = readFileSync(join(wfDir, 'devos-resume.yml'), 'utf8');
    assert.ok(caller.includes('        secrets: inherit'), caller);
    // the repair rode the sync push
    const gitLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'git');
    assert.ok(gitLog.some((e) => e.argv[0] === 'commit' && JSON.stringify(e.argv).includes('sync the repaired bootstrap')), 'the repaired workflow was committed');
    assert.ok(gitLog.some((e) => e.argv[0] === 'push'), 'the repaired workflow was pushed');

    // no value was ever read or written: the repair moved mapping LINES only
    const raw = fakeLogEntries(t.fakeLog).map((e) => JSON.stringify(e)).join('\n');
    assert.ok(!raw.includes('secrets.'), 'the fake log carries command names, not mapping values');
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_GIT_FAKE_PUSH;
    delete process.env.DEVOS_FAKE_GH_SECRETS;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- e2e: the
// intake in the failure flow — the report named the selected keys EMPTY, the
// developer pasted the real values into the gitignored local file (or typed
// them into gh's hidden prompt via the walkthrough — same intake, other door),
// and the next devos continue APPLIES them (gh secret set, value on stdin —
// the model never sees a value) and starts the fresh round that finally has
// them. No value reaches any log, any event, or any argv.
test('continue: the failed run named the selected keys EMPTY; the pasted values are applied and the fresh round goes green', async () => {
  const { t, runInit, runContinue, keyCatalog, selectedToolSecrets } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  const ghState = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_STATE = ghState;
  // GitHub holds NOTHING yet — the failed run 981 saw every key EMPTY, which is
  // exactly what its own log says. The developer answered the report by pasting
  // every value into devos/secrets.local.json (the gitignored intake file).
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
  const VALUES = {};
  for (const k of keyCatalog(draft)) VALUES[k.name] = `real-value-for-${k.name.toLowerCase()}`;
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'secrets.local.json'), JSON.stringify({ _read_me: 'local values only', ...VALUES }, null, 2) + '\n');
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    // the engine applied every pasted value, then said what the fresh round is
    for (const name of Object.keys(VALUES)) {
      assert.ok(say.includes(`uploaded ${name} to GitHub from devos/secrets.local.json`), `${name}: ${say}`);
    }
    assert.ok(say.includes('the fresh run below is the first one that has them.'), say);
    // the failed run was judged through the selected keys only
    assert.ok(say.includes('Keys the run actually saw — the ones this project selected:'), say);
    assert.ok(say.includes('CURSOR_API_KEY — EMPTY'), say);
    assert.ok(say.includes('Not selected for this project'), say);
    // the fresh round went green — the job is done
    assert.ok(result.resumed.includes('cycle-dispatch'), say);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '1002');
    assert.equal(result.firstRunGreen, true);
    assert.ok((result.cycleReport || []).join('\n').includes('GREEN'));

    // every value traveled stdin-only: no value in any log, event, or argv
    const raw = fakeLogEntries(t.fakeLog).map((e) => JSON.stringify(e)).join('\n') + '\n' + events.map((e) => JSON.stringify(e)).join('\n');
    for (const v of Object.values(VALUES)) assert.ok(!raw.includes(v), 'a key value reached a log or event');
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    for (const name of Object.keys(VALUES)) {
      assert.ok(ghLog.some((e) => e.argv[0] === 'secret' && e.argv[1] === 'set' && e.argv[2] === name), `${name} was uploaded`);
    }
    assert.ok(!ghLog.some((e) => e.argv.includes('--body')), 'no value ever rides argv');
    // exactly one fresh dispatch, no invisible reruns
    assert.equal(ghLog.filter((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run').length, 1);
    assert.equal(ghLog.filter((e) => e.argv[0] === 'run' && e.argv[1] === 'rerun').length, 0);
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- unit: the
// key-echo repair — the field gap: the model-written workflow echoed only the
// keys it knew, CURSOR_API_KEY was never in the run log, so no diagnosis could
// ever prove what the run saw. The engine inserts its OWN echo step, marked
// and idempotent, listing exactly the selected keys.
test('wfsecrets: the engine-managed key-echo step is inserted after checkout, rewritten by name, and idempotent', async () => {
  const { ensureKeyEchoStep, repairWorkflowSecrets } = await import('../lib/wfsecrets.mjs');
  const stale = [
    'name: devos-cycle',
    'on:',
    '  workflow_dispatch:',
    'permissions:',
    '  contents: write',
    'jobs:',
    '  cycle:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '      - name: One attempt of one task',
    '        run: node scripts/devos/cycle.mjs',
    '',
  ].join('\n');
  const r1 = ensureKeyEchoStep(stale, ['CURSOR_API_KEY']);
  assert.equal(r1.changed, true);
  assert.ok(r1.text.includes('- name: Key presence (devos)'), r1.text);
  assert.ok(r1.text.includes('devos:key-echo'), r1.text);
  assert.ok(r1.text.includes('echo "CURSOR_API_KEY: $CURSOR_API_KEY"'), r1.text);
  // the echo lands between checkout and the cycle step; nothing was eaten
  const ci = r1.text.indexOf('actions/checkout');
  const ei = r1.text.indexOf('Key presence');
  const si = r1.text.indexOf('scripts/devos/cycle.mjs');
  assert.ok(ci < ei && ei < si, 'checkout < echo < cycle step');
  // idempotent: same names -> no change
  const r2 = ensureKeyEchoStep(r1.text, ['CURSOR_API_KEY']);
  assert.equal(r2.changed, false, 'idempotent');
  // a NEW selection rewrites the step in place — and never eats the siblings
  const r3 = ensureKeyEchoStep(r1.text, ['OPENAI_API_KEY', 'CURSOR_API_KEY']);
  assert.equal(r3.changed, true);
  assert.ok(r3.text.includes('echo "OPENAI_API_KEY: $OPENAI_API_KEY"'), r3.text);
  assert.ok(r3.text.includes('scripts/devos/cycle.mjs'), 'the cycle step survives the rewrite');
  assert.equal((r3.text.match(/Key presence \(devos\)/g) || []).length, 1, 'exactly one echo step');
});

// ---------------------------------------------------------------- e2e: THE
// FIELD GAP, exactly as the user hit it — the failed run's log echoed only the
// five UNSELECTED keys (CURSOR_API_KEY was never printed), GitHub held nothing,
// and the old engine dispatched anyway because its intake waited for log
// evidence that could never arrive. NOW: the intake opens from GitHub's own
// secret list, the values go in through the browser door, and the fresh round
// (the first with the keys) goes green.
test('continue: the log never echoed the selected key, GitHub holds nothing -> the intake opens anyway, the fresh round goes green', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const draft = saasDraft();
  // The user's real shape: everything agent-side is Cursor — the ONLY selected
  // key is CURSOR_API_KEY, and the failed run's log echoed five OTHER tools'
  // keys, all EMPTY, while CURSOR appeared nowhere.
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  draft.models.reviewer = { cli: 'cursor', model: 'grok-4.7-high' };
  draft.models.builder = { cli: 'cursor', model: 'grok-4.7-high' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  // The user's REAL field log: five keys, all of tools they did not pick, all
  // EMPTY — the selected builder's key (CURSOR_API_KEY) appears NOWHERE.
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 39844116233, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/39844116233',
  }]);
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 39850000001, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/39850000001',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/order-desk/actions/runs/39850000001',
    jobs: [{ name: 'build', conclusion: 'success' }],
  });
  process.env.DEVOS_FAKE_GH_LOG_FAILED = [
    '##[group]One attempt of one task',
    '  ANTHROPIC_API_KEY: ',
    '  CLAUDE_CODE_OAUTH_TOKEN: ',
    '  OPENAI_API_KEY: ',
    '  GEMINI_API_KEY: ',
    '  ZAI_API_KEY: ',
    '##[endgroup]',
    '[cycle] task T01: First vertical slice',
    '[cycle] builder: cursor grok-4.7-high',
    '[cycle] builder exited with code 1',
    "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.",
    '##[error]Process completed with exit code 1.',
  ].join('\n');
  const VALUES = {};
  for (const k of keyCatalog(draft)) VALUES[k.name] = `browser-value-${k.name.toLowerCase()}-7d1`;
  const asks = [];
  const events = [];
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json'); // the fake gh's secret-set is stateful through it
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false,
      requestValues: async (ask) => { asks.push(ask); return { ...VALUES }; },
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    // THE FIX: the intake opened FROM GITHUB'S TRUTH even though the log
    // proved nothing about the selected key.
    assert.equal(asks.length, 1, `the card opened once with every needed key (${asks.length} asks)`);
    assert.ok(asks[0].missing.includes('CURSOR_API_KEY'), 'the selected builder key is on the card');
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes('None of the keys this project selected'), say);
    assert.ok(say.includes("the builder needs CURSOR_API_KEY, but the run's log never echoed it"), say);
    // the values landed through the browser door, and the fresh round (the
    // first with them) went green
    assert.ok(say.includes('uploaded CURSOR_API_KEY to GitHub — the value went straight into the secret'), say);
    assert.ok(result.resumed.includes('cycle-dispatch'), `resumed: ${JSON.stringify(result.resumed)}`);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '39850000001');
    assert.equal(result.firstRunGreen, true);
    // privacy: no value in any event or argv
    const raw = fakeLogEntries(t.fakeLog).map((e) => JSON.stringify(e)).join('\n') + '\n' + events.map((e) => JSON.stringify(e)).join('\n');
    for (const v of Object.values(VALUES)) assert.ok(!raw.includes(v), 'a key value reached a log or event');
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
  }
  cleanupTestEnv(t);
});

// ---------------------------------------------------------------- e2e: gh
// refuses the secret list — a run would be blind and the intake could not
// upload either (gh secret set needs the same rights). The engine names the
// fix and does NOT spend the round.
test('continue: gh secret list fails -> no dispatch, the fix is named, nothing is spent', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  const ghState = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_STATE = ghState;
  process.env.DEVOS_GH_SECRET_LIST_FAIL_ALL = '1'; // gh refuses every list call
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 981, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/981',
  }]);
  const events = [];
  try {
    const result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), waitKeys: false, requestValues: async () => null,
      watchPollMs: 10, watchMaxMs: 5000,
    });
    assert.equal(result.ok, true, result.message || '');
    assert.ok(!result.resumed.includes('cycle-dispatch'), 'no run was started blind');
    assert.ok(!result.firstRunGreen);
    const say = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line).join('\n');
    assert.ok(say.includes("The keys could not be checked on GitHub"), say);
    assert.ok(say.includes("gh auth refresh -h github.com -s repo"), say);
    assert.ok(result.finalLine.includes('could not be checked on GitHub'), result.finalLine);
    const dispatches = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'workflow' && e.argv[1] === 'run');
    assert.equal(dispatches.length, 0, 'the round was not spent');
  } finally {
    delete process.env.DEVOS_GH_STATE;
    delete process.env.DEVOS_GH_SECRET_LIST_FAIL_ALL;
    delete process.env.DEVOS_FAKE_GH_RUNS;
  }
  cleanupTestEnv(t);
});

// The selected set itself: reviewer + builder + extra builders — never the
// configuration model, never a module key, when judging the cycle.
test('selectedToolSecrets: exactly the selected tools\' credentials', async () => {
  const { t, selectedToolSecrets } = await fresh();
  const draft = saasDraft();
  const names = selectedToolSecrets(draft);
  assert.deepEqual(names, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY']);
  const draft2 = saasDraft();
  draft2.models.builder = { cli: 'cursor', model: 'auto' };
  draft2.models.reviewer = { cli: 'codex', model: 'gpt-5.1-codex' };
  draft2.models.extraBuilders = [{ cli: 'glm', model: 'glm-4.6', strength: 'ui' }];
  assert.deepEqual(selectedToolSecrets(draft2), ['OPENAI_API_KEY', 'CURSOR_API_KEY', 'ZAI_API_KEY']);
  cleanupTestEnv(t);
});
