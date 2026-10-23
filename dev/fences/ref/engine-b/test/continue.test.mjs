// Task 19: devos continue — the smart resume. A project that already started (after
// an error, a usage limit, or a mistaken Stop) is picked up where it stopped:
// the engine prints what is done and what is missing, installs the dependencies
// itself, runs init_github itself (a repository that already exists is ADOPTED,
// never recreated), and only wakes the configuration model when the tree still
// fails the guards. Secrets stay names-only, typed by the developer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { runContinue, assessProject } = await import('../lib/continue.mjs');
  const { auditSetup } = await import('../lib/verify.mjs');
  const { finalizeAnswers } = await import('../lib/answers.mjs');
  const { keyCatalog } = await import('../lib/keys.mjs');
  return { t, runInit, runContinue, assessProject, auditSetup, finalizeAnswers, keyCatalog };
}

const noInstall = async () => ({ code: 0, lines: ['fake install ok'] });

// The exact scenario from the first real run: the model wrote the whole tree but
// its commands (npm install, init_github) were rejected, so no repository exists.
// devos continue must finish EVERYTHING without waking the model again.
test('continue e2e: tree done + init_github never called + repo already created -> the engine finishes alone', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(first.result.ok, false);
  assert.equal(first.result.permissionIssue, true);
  const projectDir = first.projectDir;
  const modelRunsBefore = fakeLogEntries(t.fakeLog).filter((e) => e.argv.includes('-p')).length;

  // The user created the repository by hand in the meantime ("now repo is created").
  process.env.DEVOS_GH_REPO_EXISTS = '1';   // gh repo create refuses: it already exists
  process.env.DEVOS_GIT_FAKE_PUSH = '1';    // push/fetch/rebase are virtualized
  const installs = [];
  const events = [];
  const result = await runContinue({
    projectDir, home: t.home,
    installFn: async (arg) => { installs.push(arg.install); mkdirSync(join(projectDir, 'node_modules'), { recursive: true }); return { code: 0, lines: ['added 312 packages'] }; },
    emit: (e) => events.push(e),
  });
  delete process.env.DEVOS_GH_REPO_EXISTS;
  delete process.env.DEVOS_GIT_FAKE_PUSH;

  assert.equal(result.ok, true, `continue failed: ${result.message || ''}`);
  assert.equal(result.finalLine.includes('devos continue: octodev/order-desk is set up'), true, result.finalLine);
  // the model was NOT woken again
  const modelRunsAfter = fakeLogEntries(t.fakeLog).filter((e) => e.argv.includes('-p')).length;
  assert.equal(modelRunsAfter, modelRunsBefore, 'a tree that passes the guards never wakes the model');
  // the engine installed the dependencies itself
  assert.deepEqual(installs, ['npm install'], `install steps: ${JSON.stringify(installs)}`);
  // the engine adopted the existing repository: create refused -> view + remote + push
  const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
  assert.ok(ghLog.some((e) => e.argv[0] === 'repo' && e.argv[1] === 'create'), 'repo create attempted once');
  assert.ok(ghLog.some((e) => e.argv[0] === 'repo' && e.argv[1] === 'view'), 'the existing repo is verified, not recreated');
  const gitLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'git');
  assert.ok(gitLog.some((e) => e.argv[0] === 'remote' && e.argv[1] === 'add'), 'the remote is aimed at the existing repo');
  assert.ok(gitLog.some((e) => e.argv[0] === 'push'), 'main is pushed');
  // the init state is done and the first cycle was dispatched
  const state = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'init.json'), 'utf8'));
  assert.equal(state.status, 'done');
  assert.equal(state.repo, 'octodev/order-desk');
  // the engine remembered the project as last-project for later commands
  const lp = JSON.parse(readFileSync(join(t.home, 'last-project.json'), 'utf8'));
  assert.equal(lp.path, projectDir);
  // the story is visible in the event stream: assessing phase + checklist lines
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'assessing'));
  const engineLines = events.filter((e) => e.type === 'log' && e.stream === 'engine').map((e) => e.line);
  assert.ok(engineLines.some((l) => l.startsWith('done : answers')), engineLines.slice(0, 8).join(' | '));
  assert.ok(engineLines.some((l) => l.startsWith('todo: GitHub repository')));
  cleanupTestEnv(t);
});

// The same run again: everything is done AND the latest cycle run is green —
// the first-run goal is already proven, so continue is a no-op that says so.
// The fake gh keeps answering the full secret list through runContinue — the
// keys stage re-checks GitHub's own truth before saying "fully set up".
test('continue: a finished project with a green first run reports the job done and touches nothing', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const draft = saasDraft();
  // The fake gh answers the FULL needed list — the keys stage re-checks
  // GitHub's own truth before it is allowed to say "fully set up".
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(draft).map((k) => k.name).join(' ');
  // The latest cycle run is green: the configuration model's goal is proven.
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 77, conclusion: 'success', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/77',
  }]);
  const { projectDir } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  // init_github dispatches the first cycle itself; continue must add nothing.
  const dispatchesAfterInit = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'workflow' && e.argv[1] === 'run').length;
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  const modelRunsBefore = fakeLogEntries(t.fakeLog).filter((e) => e.argv.includes('-p')).length;
  let installCalls = 0;
  const result = await runContinue({
    projectDir, home: t.home,
    installFn: async () => { installCalls += 1; return { code: 0, lines: [] }; },
    emit: () => {},
  });
  delete process.env.DEVOS_FAKE_GH_SECRETS;
  delete process.env.DEVOS_FAKE_GH_RUNS;
  assert.equal(result.ok, true, result.message || '');
  assert.ok(result.finalLine.includes('fully set up'), result.finalLine);
  assert.ok(result.finalLine.includes('first cycle run is green'), result.finalLine);
  assert.ok(result.finalLine.includes('job is done'), result.finalLine);
  assert.equal(result.firstRunGreen, true);
  assert.deepEqual(result.resumed, []);
  assert.equal(installCalls, 0, 'nothing is installed again');
  const modelRunsAfter = fakeLogEntries(t.fakeLog).filter((e) => e.argv.includes('-p')).length;
  assert.equal(modelRunsAfter, modelRunsBefore, 'the model stays asleep');
  const dispatches = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'workflow' && e.argv[1] === 'run').length;
  assert.equal(dispatches, dispatchesAfterInit, 'a green run means continue dispatches no new cycle');
  // the goal is remembered forever: the next continue never restarts anything
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'continue.json'), 'utf8'));
  assert.equal(st.steps['first-run-green'].runId, '77');
  cleanupTestEnv(t);
});

// The user's exact trap after the keys finally landed: the last devos-cycle run
// failed back when CURSOR_API_KEY was still empty (the cryptic "builder exited
// with code null"), the keys are on GitHub now. continue must start a FRESH,
// visible cycle run (an invisible rerun reads as "nothing happened"), WATCH it
// to the end, and hand over a plain-English report — and once a run finishes
// green, the configuration model's job is DONE: the next continue never
// restarts anything, because from there any issue continues on GitHub.
test('continue: a cycle run that failed while keys were missing is re-dispatched, watched, and reported green — then the job is done', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  // The repository is set up (init_github really ran once earlier) and every
  // key is on GitHub now; the last cycle run failed before that was true.
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json'); // makes the fake gh's dispatch counter stateful
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(draft).map((k) => k.name).join(' ');
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 981, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/981',
  }]);
  // After the engine dispatches, gh sees the fresh run the engine must discover.
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 1002, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
    jobs: [{ name: 'build', conclusion: 'success' }],
  });
  const events = [];
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e), watchPollMs: 10, watchMaxMs: 5000,
    });

    assert.equal(result.ok, true, `continue failed: ${result.message || ''}`);
    assert.ok(result.resumed.includes('cycle-dispatch'), `resumed: ${JSON.stringify(result.resumed)}`);
    assert.equal(result.cycleRestart && result.cycleRestart.runId, '1002', `cycleRestart: ${JSON.stringify(result.cycleRestart)}`);
    assert.equal(result.firstRunGreen, true);
    assert.ok(result.finalLine.includes('fully set up'), result.finalLine);
    assert.ok(result.finalLine.includes('first cycle run is green'), result.finalLine);
    assert.ok(result.finalLine.includes('1002'), result.finalLine);
    const report = (result.cycleReport || []).join('\n');
    assert.ok(report.includes('GREEN'), report);
    assert.ok(report.includes('1002'), report);
    assert.ok(report.includes('human-gate'), report);
    const ghLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
    assert.ok(ghLog.some((e) => e.argv[0] === 'workflow' && e.argv[1] === 'run' && e.argv[2] === 'devos-cycle.yml'),
      'a FRESH cycle run is dispatched (a new, visible run), not an invisible rerun');
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'restarting-cycle'), 'the restart is a visible phase');
    assert.ok(events.some((e) => e.type === 'phase' && e.name === 'watching-cycle'), 'the watch is a visible phase');
    const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'continue.json'), 'utf8'));
    assert.equal(st.steps['first-run-green'].runId, '1002', 'the green run is remembered as the proven goal');

    // The second continue: the goal is already proven — the engine's job is
    // DONE. It reports the standing fact and starts NOTHING new; from here any
    // issue continues on GitHub (human-gate PRs), not in this engine.
    const again = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {}, watchPollMs: 10, watchMaxMs: 5000 });
    assert.equal(again.ok, true, again.message || '');
    assert.equal(again.firstRunGreen, true);
    assert.deepEqual(again.resumed, [], 'a proven goal means continue picks up nothing');
    assert.ok(again.finalLine.includes('job is done'), again.finalLine);
    const againReport = (again.cycleReport || []).join('\n');
    assert.ok(againReport.includes('goal is proven'), againReport);
    assert.ok(againReport.includes('human-gate'), againReport);
  } finally {
    delete process.env.DEVOS_FAKE_GH_SECRETS;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_GH_STATE;
  }
  const reruns = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'run' && e.argv[1] === 'rerun');
  assert.equal(reruns.length, 0, 'no invisible rerun was needed — the fresh dispatch worked');
  const dispatches = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'workflow' && e.argv[1] === 'run');
  assert.equal(dispatches.length, 1, 'exactly one dispatch across both continues — after green the engine never restarts anything');
  cleanupTestEnv(t);
});

// The loop the user asked for: EVERY devos continue is another round until the
// FIRST cycle run is green. A failed fresh run is not a dead end — the report
// names the fix (and proves which keys the run saw as EMPTY from GitHub's own
// masked log), and the next continue dispatches the next round. Nothing is
// ever "spent": the ledger remembers the story, it never blocks a retry.
test('continue: the first-run loop — red round reports the fix, the next continue starts the next round, green ends the job', async () => {
  const { t, runInit, runContinue, keyCatalog } = await fresh();
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
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(draft).map((k) => k.name).join(' ');
  // Round 1: the last run failed while the keys were missing; the fresh run
  // (1002) fails too — this time the report must prove WHICH key it never saw.
  process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
    databaseId: 981, conclusion: 'failure', status: 'completed',
    url: 'https://github.com/octodev/order-desk/actions/runs/981',
  }]);
  process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
    databaseId: 1002, status: 'in_progress',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
  }]);
  process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
    status: 'completed', conclusion: 'failure',
    url: 'https://github.com/octodev/order-desk/actions/runs/1002',
    jobs: [{ name: 'cycle', conclusion: 'failure' }],
  });
  process.env.DEVOS_FAKE_GH_LOG_FAILED = [
    '##[group]One attempt of one task',
    '  CLAUDE_CODE_OAUTH_TOKEN: ***',
    '  CURSOR_API_KEY: ',
    '  OPENAI_API_KEY: ***',
    '##[endgroup]',
    '[cycle] builder: cursor grok-4.7-high',
    '[cycle] builder exited with code null',
  ].join('\n');
  let result;
  try {
    result = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {}, watchPollMs: 10, watchMaxMs: 5000 });
    assert.equal(result.ok, true, result.message || '');
    assert.ok(result.resumed.includes('cycle-dispatch'), `resumed: ${JSON.stringify(result.resumed)}`);
    assert.equal(result.firstRunGreen, false, 'a red run is not the end of the job');
    const report = (result.cycleReport || []).join('\n');
    assert.ok(report.includes('FAILED'), report);
    assert.ok(report.includes('Failing step: cycle'), report);
    assert.ok(report.includes('Keys the run actually saw — the ones this project selected'), report);
    assert.ok(report.includes('CURSOR_API_KEY — EMPTY'), report);
    assert.ok(report.includes('CLAUDE_CODE_OAUTH_TOKEN — present'), report);
    // the unselected tools' keys are named once as irrelevant — never as a problem
    assert.ok(report.includes('Not selected for this project'), report);
    assert.ok(report.includes('OPENAI_API_KEY'), report);
    assert.ok(report.includes('Likely cause'), report);
    assert.ok(report.includes('saw these selected keys as EMPTY: CURSOR_API_KEY'), report);
    assert.ok(report.includes('until the FIRST cycle run is green'), report);
    assert.ok(result.finalLine.includes('failed again'), result.finalLine);
    assert.ok(result.finalLine.includes('the Missing keys card opens right in the flow'), result.finalLine);
    assert.ok(result.finalLine.includes('until the first cycle run is green'), result.finalLine);
    let st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'continue.json'), 'utf8'));
    assert.ok(!st.steps['first-run-green'], 'a red round never records the goal');
    assert.equal(st.steps['cycle-attempts'].attempts.length, 1, 'the round is in the ledger');

    // Round 2: the developer fixed what the report named; the next continue
    // starts the next round (nothing was "spent") and the fresh run goes green.
    writeFileSync(ghState, JSON.stringify({ dispatch: 0 })); // reset the world clock, not the story
    process.env.DEVOS_FAKE_GH_RUNS = JSON.stringify([{
      databaseId: 1002, conclusion: 'failure', status: 'completed',
      url: 'https://github.com/octodev/order-desk/actions/runs/1002',
    }]);
    process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH = JSON.stringify([{
      databaseId: 1003, status: 'in_progress',
      url: 'https://github.com/octodev/order-desk/actions/runs/1003',
    }]);
    process.env.DEVOS_FAKE_GH_VIEW = JSON.stringify({
      status: 'completed', conclusion: 'success',
      url: 'https://github.com/octodev/order-desk/actions/runs/1003',
      jobs: [{ name: 'build', conclusion: 'success' }],
    });
    const second = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {}, watchPollMs: 10, watchMaxMs: 5000 });
    assert.equal(second.ok, true, second.message || '');
    assert.ok(second.resumed.includes('cycle-dispatch'), `second resumed: ${JSON.stringify(second.resumed)}`);
    assert.equal(second.cycleRestart && second.cycleRestart.runId, '1003', `second cycleRestart: ${JSON.stringify(second.cycleRestart)}`);
    assert.equal(second.firstRunGreen, true);
    assert.ok(second.finalLine.includes('fully set up'), second.finalLine);
    assert.ok(second.finalLine.includes('job is done'), second.finalLine);
    st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'continue.json'), 'utf8'));
    assert.equal(st.steps['first-run-green'].runId, '1003');
    assert.equal(st.steps['cycle-attempts'].attempts.length, 2, 'both rounds are in the ledger');

    // Round 3: the goal is proven — continue is a no-op that says the job is
    // done and hands the developer over to GitHub.
    const third = await runContinue({ projectDir, home: t.home, installFn: noInstall, emit: () => {}, watchPollMs: 10, watchMaxMs: 5000 });
    assert.equal(third.ok, true, third.message || '');
    assert.equal(third.firstRunGreen, true);
    assert.deepEqual(third.resumed, []);
    assert.ok(third.finalLine.includes('job is done'), third.finalLine);
  } finally {
    delete process.env.DEVOS_FAKE_GH_SECRETS;
    delete process.env.DEVOS_FAKE_GH_RUNS;
    delete process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
    delete process.env.DEVOS_FAKE_GH_VIEW;
    delete process.env.DEVOS_FAKE_GH_LOG_FAILED;
    delete process.env.DEVOS_GH_STATE;
  }
  const reruns = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'run' && e.argv[1] === 'rerun');
  assert.equal(reruns.length, 0, 'both rounds went through visible fresh dispatches');
  const dispatches = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'workflow' && e.argv[1] === 'run');
  assert.equal(dispatches.length, 2, 'one fresh dispatch per round — red and green rounds alike');
  cleanupTestEnv(t);
});

// The other middle: the tree still fails the guards -> the model IS resumed.
test('continue e2e: a broken tree resumes the configuration model, which finishes GitHub', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  process.env.DEVOS_FAKE_MODE = 'guard-always';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(first.result.ok, false, 'guard-always fails the first run');
  process.env.DEVOS_FAKE_MODE = 'normal'; // the resumed model completes properly
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const result = await runContinue({ projectDir: first.projectDir, home: t.home, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(result.ok, true, result.message || '');
  assert.ok(result.resumed.includes('model'), `resumed steps: ${JSON.stringify(result.resumed)}`);
  const state = JSON.parse(readFileSync(join(first.projectDir, 'devos', 'state', 'init.json'), 'utf8'));
  assert.equal(state.status, 'done');
  cleanupTestEnv(t);
});

// The assessment itself: the checklist names every miss with its owner.
test('assess: a half-written project lists the guards as model work and GitHub as devos work', async () => {
  const { t, assessProject, finalizeAnswers } = await fresh();
  const projectDir = join(t.workspace, 'order-desk');
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify(finalizeAnswers(saasDraft()), null, 2));
  const a = assessProject({ projectDir });
  assert.equal(a.started, true);
  assert.equal(a.slug, 'octodev/order-desk');
  const byId = Object.fromEntries(a.steps.map((s) => [s.id, s]));
  assert.equal(byId.answers.state, 'done');
  assert.equal(byId.tree.state, 'todo');
  assert.equal(byId.tree.who, 'model');
  assert.equal(byId.deps.state, 'wait', 'installing waits until the tree passes the guards');
  assert.equal(byId.github.state, 'todo');
  assert.equal(byId.github.who, 'devos');
  assert.equal(byId.secrets.state, 'wait');
  // gh: false (the UI listing) keeps the same shape without spawning gh
  const cheap = assessProject({ projectDir, gh: false });
  assert.equal(cheap.steps.find((s) => s.id === 'secrets').state, 'wait');
  // a folder without answers is not startable
  const empty = assessProject({ projectDir: join(t.workspace, 'nothing-here') });
  assert.equal(empty.started, false);
  assert.equal(empty.steps[0].id, 'answers');
  cleanupTestEnv(t);
});

// A failed install is a clean, resumable stop — never a dead end.
test('continue: a failed install returns a readable error and the run stays resumable', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const result = await runContinue({
    projectDir: first.projectDir, home: t.home,
    installFn: async () => ({ code: 1, lines: ['npm ERR! network request failed'] }),
    emit: () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.installError, true);
  assert.ok(result.message.includes('npm install failed'), result.message);
  assert.ok(result.message.includes('network'), result.message);
  cleanupTestEnv(t);
});

// A push the engine cannot win (branch protection, remote state) is reported
// with the exact words, and everything before it is kept.
test('continue: a rejected push is a githubError with the adoption guidance', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  process.env.DEVOS_GH_REPO_EXISTS = '1';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_GIT_FAIL_PUSH = '1';
  const result = await runContinue({ projectDir: first.projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_GH_REPO_EXISTS;
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  delete process.env.DEVOS_GIT_FAIL_PUSH;
  assert.equal(result.ok, false);
  assert.equal(result.githubError, true);
  assert.ok(result.message.includes('init_github failed'), result.message);
  assert.ok(result.message.includes('rejected'), result.message);
  cleanupTestEnv(t);
});

// Missing secrets are names-only you-steps on an otherwise successful finish.
test('continue: missing secrets are listed by name with the gh command, never blocking', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const result = await runContinue({ projectDir: first.projectDir, home: t.home, installFn: noInstall, emit: () => {} });
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(result.ok, true, result.message || '');
  assert.ok(Array.isArray(result.keysMissing) && result.keysMissing.includes('CURSOR_API_KEY'), `keys: ${JSON.stringify(result.keysMissing)}`);
  assert.ok(result.keysMissing.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  cleanupTestEnv(t);
});

// The verify row for a missing repository now belongs to devos, not to the user.
test('verify: the init-not-done row points at devos continue with the devos owner', async () => {
  const { t, assessProject, auditSetup, finalizeAnswers } = await fresh();
  const projectDir = join(t.workspace, 'order-desk');
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  const answers = finalizeAnswers(saasDraft());
  writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify(answers, null, 2));
  const audit = auditSetup({ projectDir, answers });
  const repoRow = audit.rows.find((r) => r.label === 'GitHub repository');
  assert.equal(repoRow.who, 'devos');
  assert.ok(repoRow.fix.includes('devos continue'), repoRow.fix);
  assert.ok(repoRow.detail.includes('adopted'), repoRow.detail);
  cleanupTestEnv(t);
});

// The CLI surface: devos continue resolves the last project; without one it says so.
test('cli: devos continue without a project prints the pointer and exits 1', async () => {
  const t = makeTestEnv({});
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, [join('bin', 'devos.mjs'), 'continue'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: process.env, encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes('No DEV_OS project found'), res.stderr);
  cleanupTestEnv(t);
});

test('cli: findStartedProjects finds the last project and workspace neighbours', async () => {
  const { t } = await fresh();
  const { findStartedProjects } = await import('../lib/cli.mjs');
  // empty workspace: nothing to offer
  assert.deepEqual(findStartedProjects({ home: t.home, workspace: t.workspace }), []);
  const projectDir = join(t.workspace, 'order-desk');
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify({ project: { slug: 'octodev/order-desk' } }, null, 2));
  writeFileSync(join(t.home, 'last-project.json'), JSON.stringify({ path: projectDir, slug: 'octodev/order-desk' }, null, 2));
  const found = findStartedProjects({ home: t.home, workspace: t.workspace });
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].path, projectDir);
  assert.equal(found[0].slug, 'octodev/order-desk');
  cleanupTestEnv(t);
});

// The full journey through the actual CLI binary: init --continue now routes
// through the same smart resume (the tree is already complete in this fixture,
// so the model is skipped and the engine finishes GitHub itself).
test('cli e2e: devos init --continue finishes the job through the smart resume', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(first.result.ok, false);
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, [join('bin', 'devos.mjs'), 'continue', first.projectDir], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DEVOS_HOME: t.home, DEVOS_FAKE_LOG: t.fakeLog },
    encoding: 'utf8', timeout: 120_000,
  });
  delete process.env.DEVOS_GIT_FAKE_PUSH;
  assert.equal(res.status, 0, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  assert.ok(res.stdout.includes('devos continue: octodev/order-desk is set up'), res.stdout.slice(-600));
  const state = JSON.parse(readFileSync(join(first.projectDir, 'devos', 'state', 'init.json'), 'utf8'));
  assert.equal(state.status, 'done');
  cleanupTestEnv(t);
});

// The user's exact trap after the first successful init: the engine repaired the
// tree (README, ADRs, the workflow's CLI install step), but init_github runs once,
// so nothing pushed the repaired files — the GitHub-side cycle kept running
// against the stale tree. continue must sync the repaired tree to the repository.
test('continue: a repaired tree after the repository exists is pushed to GitHub (github-sync)', async () => {
  const { t, runInit, runContinue } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  const projectDir = first.projectDir;
  // The repository is already done (the user's current state) — and the tree
  // loses a guard-required file, so the model must repair it.
  writeFileSync(join(projectDir, 'devos', 'state', 'init.json'), JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
  // init_github had really run once: the project is a git repo with a commit.
  const { execFileSync } = await import('node:child_process');
  execFileSync('/usr/bin/git', ['init', '-b', 'main'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.email', 'test@devos.local'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['config', 'user.name', 'DEVOS Test'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['add', '-A'], { cwd: projectDir });
  execFileSync('/usr/bin/git', ['commit', '-m', 'bootstrap'], { cwd: projectDir });
  rmSync(join(projectDir, 'docs', 'GLOSSARY.md'));
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  const events = [];
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      emit: (e) => events.push(e),
    });
  } finally {
    delete process.env.DEVOS_GIT_FAKE_PUSH;
  }
  assert.equal(result.ok, true, `continue failed: ${result.message || ''}`);
  assert.ok(result.resumed.includes('github-sync'), `resumed: ${JSON.stringify(result.resumed)}`);
  const gitLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'git');
  assert.ok(gitLog.some((e) => e.argv[0] === 'commit' && JSON.stringify(e.argv).includes('sync the repaired bootstrap')), 'the sync commit was made');
  assert.ok(gitLog.some((e) => e.argv[0] === 'push'), 'the repaired tree was pushed');
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'syncing-repo'), 'the sync phase is visible');
  cleanupTestEnv(t);
});
