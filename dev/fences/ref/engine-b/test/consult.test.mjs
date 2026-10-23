// Task 20: two fixes from the user's real continue run.
// (1) init_github must never dead-end on GraphQL "Could not resolve to a
//     Repository": when gh cannot see the repo under the slug's exact name, the
//     engine looks under the signed-in login, matches a listing, or creates the
//     repository for real — and only after every built-in attempt does it
//     escalate. (2) When a step still fails, the configuration model is
//     consulted for a fix proposal and the USER approves it before anything
//     runs ("the config model should continue and tell user for any approve of
//     certain solution or fix").
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

const noInstall = async () => ({ code: 0, lines: ['fake install ok'] });

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { runContinue } = await import('../lib/continue.mjs');
  const { runInitGithub } = await import('../lib/initgithub.mjs');
  return { t, runInit, runContinue, runInitGithub };
}

// A project in the exact middle state of the user's run: the tree is written,
// no repository exists, no init state.
async function middleState({ runInit, t, cli = 'cursor', model = 'grok-4.7' }) {
  const draft = saasDraft();
  draft.models.configurationModel = { cli, model };
  process.env.DEVOS_FAKE_MODE = 'no-github-reject';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  return first.projectDir;
}

const modelRuns = (log) => fakeLogEntries(log).filter((e) => e.cmd && e.argv.includes('-p')).length;

// ---------- parseProposal (unit) ----------

test('parseProposal: the last fenced JSON block wins and shapes are normalized', async () => {
  const { parseProposal } = await import('../lib/consult.mjs');
  const lines = [
    'Analyzing the failure…',
    '```json',
    '{"diagnosis":"first guess","commands":[{"run":"a --b","why":"w"}],"userSteps":[]}',
    '```',
    'Wait — better proposal:',
    '```json',
    JSON.stringify({ diagnosis: 'the real cause', commands: ['plain string cmd'], userSteps: ['type a key'] }),
    '```',
  ];
  const p = parseProposal(lines);
  assert.equal(p.diagnosis, 'the real cause');
  assert.deepEqual(p.commands, [{ run: 'plain string cmd', why: '' }]);
  assert.deepEqual(p.userSteps, ['type a key']);
  assert.equal(parseProposal(['no json here at all']), null);
  assert.equal(parseProposal([]), null);
  assert.equal(parseProposal(['```json', '{broken', '```']), null);
});

test("parseProposal: a proposal inside Cursor stream-json events is unwrapped and parsed (the user's exact failure)", async () => {
  const { parseProposal } = await import('../lib/consult.mjs');
  const proposal = {
    diagnosis: 'gh 2.96.0 rejected `gh repo create` because this build has no `--visibility` flag and only accepts `--public`, `--private`, or `--internal`.',
    commands: [{ run: 'gh repo create tinytasks --public --source=. --remote=origin --push', why: 'Creates the missing public repository with flags this gh version accepts.' }],
    userSteps: [],
  };
  // The real shape: the reply lives INSIDE the assistant event's text field, so
  // every quote is backslash-escaped and every newline is the two characters
  // backslash-n. The fence regex alone sees mangled text — the user's run died
  // here ("no JSON block") even though the model answered perfectly.
  const inner = 'Create failed because GitHub CLI 2.96.0 has no `--visibility` flag.\n```json\n' + JSON.stringify(proposal) + '\n```';
  const ndjson = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'Grok 4.7 256K High', permissionMode: 'default' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: inner }] } }),
    JSON.stringify({ type: 'result', duration_ms: 39000 }),
  ];
  const p = parseProposal(ndjson);
  assert.ok(p, 'the wrapped proposal must parse');
  assert.equal(p.diagnosis, proposal.diagnosis);
  assert.equal(p.commands[0].run, proposal.commands[0].run);
  // A model that drops the fences entirely still gets through.
  const bare = parseProposal(['My proposal:', JSON.stringify(proposal)]);
  assert.ok(bare, 'a bare object without fences parses too');
  assert.equal(bare.commands[0].run, proposal.commands[0].run);
});

// ---------- init_github: "Could not resolve" never dead-ends ----------

test('init_github: repo not under the slug owner -> found under the real login and adopted', async () => {
  const { t, runInit, runInitGithub } = await fresh();
  const projectDir = await middleState({ runInit, t });
  // gh is signed in as jovo-jovi; the slug says octodev — and octodev/order-desk
  // is not visible ("Could not resolve"), exactly the user's failure. The repo
  // lives at jovo-jovi/order-desk.
  process.env.DEVOS_GH_REPO_EXISTS = '1';
  process.env.DEVOS_GH_VIEW_MISS = 'octodev/order-desk';
  process.env.DEVOS_GH_LOGIN = 'jovo-jovi';
  process.env.DEVOS_GH_REPO_LIST = '[]';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  let state;
  try {
    state = runInitGithub({ projectDir });
  } finally {
    for (const k of ['DEVOS_GH_REPO_EXISTS', 'DEVOS_GH_VIEW_MISS', 'DEVOS_GH_LOGIN', 'DEVOS_GH_REPO_LIST', 'DEVOS_GIT_FAKE_PUSH']) delete process.env[k];
  }
  assert.equal(state.status, 'done');
  assert.equal(state.repo, 'jovo-jovi/order-desk');
  assert.equal(state.adoptedFrom, 'octodev/order-desk');
  const gitLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'git');
  // The first create attempt already added origin (pointing at the slug), so the
  // adoption re-aims it with set-url — either way the URL is the real login repo.
  assert.ok(
    gitLog.some((e) => e.argv[0] === 'remote' && ['add', 'set-url'].includes(e.argv[1]) && JSON.stringify(e.argv).includes('jovo-jovi/order-desk')),
    'the remote is aimed at the real login repo',
  );
  assert.ok(gitLog.some((e) => e.argv[0] === 'push'), 'main is pushed');
  cleanupTestEnv(t);
});

test('init_github: repo exists nowhere -> the create is retried and succeeds', async () => {
  const { t, runInit, runInitGithub } = await fresh();
  const projectDir = await middleState({ runInit, t });
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_CREATE_FAIL_FIRST = '1';
  process.env.DEVOS_GH_VIEW_MISS = 'octodev/order-desk';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  let state;
  try {
    state = runInitGithub({ projectDir });
  } finally {
    for (const k of ['DEVOS_GH_STATE', 'DEVOS_GH_CREATE_FAIL_FIRST', 'DEVOS_GH_VIEW_MISS', 'DEVOS_GIT_FAKE_PUSH']) delete process.env[k];
  }
  assert.equal(state.status, 'done');
  assert.equal(state.repo, 'octodev/order-desk');
  const creates = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'repo' && e.argv[1] === 'create');
  assert.equal(creates.length, 2, 'create ran twice: the failed first attempt and the successful retry');
  // The user's machine died on "unknown flag: --visibility" — gh repo create has
  // never had that flag. The engine must pass --public/--private only.
  assert.ok(creates.every((e) => !e.argv.includes('--visibility')), 'no create is given --visibility');
  assert.ok(creates.some((e) => e.argv.includes('--private')), 'the create uses --private, accepted by every gh build');
  const stateFile = JSON.parse(readFileSync(join(t.home, 'gh-state.json'), 'utf8'));
  assert.equal(stateFile.create, 1, 'the counter proves only the first create failed');
  cleanupTestEnv(t);
});

// ---------- continue: consult -> approve -> retry (the user's scenario) ----------

test('continue e2e: hard GitHub failure -> the model proposes a fix -> approved -> the engine retries and finishes', async () => {
  const { t, runInit, runContinue } = await fresh();
  const projectDir = await middleState({ runInit, t });
  const modelBefore = modelRuns(t.fakeLog);
  // create always refuses (already exists), the FIRST view misses with the exact
  // GraphQL reply the user saw; after the consult, the retry's view resolves.
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_REPO_EXISTS = '1';
  process.env.DEVOS_GH_VIEW_MISS_FIRST = '1';
  process.env.DEVOS_GH_REPO_LIST = '[]';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_FAKE_MODE = 'consult';
  const events = [];
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      decide: async (proposal) => {
        // the decision sees a real proposal with a real command
        assert.equal(proposal.commands[0].run, 'git remote -v');
        assert.ok(proposal.diagnosis.length > 10);
        return true;
      },
      emit: (e) => events.push(e),
    });
  } finally {
    for (const k of ['DEVOS_GH_STATE', 'DEVOS_GH_REPO_EXISTS', 'DEVOS_GH_VIEW_MISS_FIRST', 'DEVOS_GH_REPO_LIST', 'DEVOS_GIT_FAKE_PUSH', 'DEVOS_FAKE_MODE']) delete process.env[k];
  }
  assert.equal(result.ok, true, `continue failed: ${result.message || ''}`);
  assert.ok(result.resumed.includes('github'), `resumed: ${JSON.stringify(result.resumed)}`);
  const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'init.json'), 'utf8'));
  assert.equal(st.status, 'done');
  assert.equal(st.repo, 'octodev/order-desk');
  // the model was consulted exactly once, and its proposal's command ran
  assert.equal(modelRuns(t.fakeLog) - modelBefore, 1, 'the consultation wakes the model exactly once');
  const gitLog = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'git');
  assert.ok(gitLog.some((e) => e.argv[0] === 'remote' && e.argv[1] === '-v'), 'the approved fix command ran');
  assert.ok(gitLog.some((e) => e.argv[0] === 'remote' && e.argv[1] === 'add'), 'the adoption still aimed the remote');
  // the story is visible in the event stream
  const phases = events.filter((e) => e.type === 'phase').map((e) => e.name);
  assert.ok(phases.includes('consulting'), phases.join(','));
  assert.ok(phases.includes('applying-fix'), phases.join(','));
  const proposalEvt = events.find((e) => e.type === 'proposal');
  assert.ok(proposalEvt, 'the proposal event was emitted');
  assert.equal(proposalEvt.proposal.commands[0].run, 'git remote -v');
  assert.ok(events.some((e) => e.type === 'proposal-decision' && e.approve === true));
  cleanupTestEnv(t);
});

test('continue: a declined proposal is a clean resumable failure with nothing applied', async () => {
  const { t, runInit, runContinue } = await fresh();
  const projectDir = await middleState({ runInit, t });
  const modelBefore = modelRuns(t.fakeLog); // the bootstrap write already used the model once
  process.env.DEVOS_GH_STATE = join(t.home, 'gh-state.json');
  process.env.DEVOS_GH_REPO_EXISTS = '1';
  process.env.DEVOS_GH_VIEW_MISS_FIRST = '1';
  process.env.DEVOS_GH_REPO_LIST = '[]';
  process.env.DEVOS_GIT_FAKE_PUSH = '1';
  process.env.DEVOS_FAKE_MODE = 'consult';
  const events = [];
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      decide: async () => false,
      emit: (e) => events.push(e),
    });
  } finally {
    for (const k of ['DEVOS_GH_STATE', 'DEVOS_GH_REPO_EXISTS', 'DEVOS_GH_VIEW_MISS_FIRST', 'DEVOS_GH_REPO_LIST', 'DEVOS_GIT_FAKE_PUSH', 'DEVOS_FAKE_MODE']) delete process.env[k];
  }
  assert.equal(result.ok, false);
  assert.equal(result.githubError, true);
  assert.ok(result.message.includes('init_github failed'), result.message);
  assert.equal(result.declined, true);
  assert.ok(result.proposal, 'the declined proposal is carried on the result');
  assert.ok(events.some((e) => e.type === 'proposal'), 'the user saw the proposal');
  assert.ok(events.some((e) => e.type === 'proposal-decision' && e.approve === false));
  const views = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh' && e.argv[0] === 'repo' && e.argv[1] === 'view');
  assert.equal(views.length, 1, 'nothing ran after the decline');
  assert.equal(modelRuns(t.fakeLog) - modelBefore, 1, 'the model was consulted once beyond the bootstrap write');
  cleanupTestEnv(t);
});

test('continue: without a consultable model the failure message stays plain and resumable', async () => {
  const { t, runInit, runContinue } = await fresh();
  const projectDir = await middleState({ runInit, t });
  // No agent CLI installed at all: the fixtures leave the PATH, so
  // detectAgents() finds nothing and the consultation is skipped, not crashed.
  const fixtures = join(new URL('.', import.meta.url).pathname, 'fixtures', 'bin');
  const widePath = process.env.PATH;
  process.env.PATH = widePath.split(':').filter((p) => p !== fixtures).join(':');
  const modelRunsBefore = modelRuns(t.fakeLog);
  process.env.DEVOS_GH_REPO_EXISTS = '1';
  process.env.DEVOS_GH_VIEW_MISS = 'octodev/order-desk';
  process.env.DEVOS_GH_REPO_LIST = '[]';
  const events = [];
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home, installFn: noInstall,
      decide: async () => true,
      emit: (e) => events.push(e),
    });
  } finally {
    process.env.PATH = widePath;
    for (const k of ['DEVOS_GH_REPO_EXISTS', 'DEVOS_GH_VIEW_MISS', 'DEVOS_GH_REPO_LIST']) delete process.env[k];
  }
  assert.equal(result.ok, false);
  assert.equal(result.githubError, true);
  assert.ok(result.message.includes('init_github failed'), result.message);
  assert.ok(!events.some((e) => e.type === 'proposal'), 'no proposal without a model to consult');
  assert.equal(modelRuns(t.fakeLog) - modelRunsBefore, 0, 'no model run beyond the bootstrap write');
  cleanupTestEnv(t);
});

test('continue: a failed install consults too, and the approved fix lets the retry pass', async () => {
  const { t, runInit, runContinue } = await fresh();
  const projectDir = await middleState({ runInit, t });
  process.env.DEVOS_FAKE_MODE = 'consult';
  process.env.DEVOS_FAKE_CONSULT_CMD = 'git --version'; // runs fine outside a repo
  const events = [];
  let calls = 0;
  let result;
  try {
    result = await runContinue({
      projectDir, home: t.home,
      installFn: async () => {
        calls += 1;
        return calls === 1
          ? { code: 1, lines: ['npm ERR! network request failed'] }
          : { code: 0, lines: ['added 312 packages'] };
      },
      decide: async () => true,
      emit: (e) => events.push(e),
    });
  } finally {
    delete process.env.DEVOS_FAKE_MODE;
    delete process.env.DEVOS_FAKE_CONSULT_CMD;
  }
  assert.equal(result.ok, true, `continue failed: ${result.message || ''}`);
  assert.equal(calls, 2, 'the install ran twice: failed attempt + approved retry');
  assert.ok(result.resumed.includes('install'));
  assert.ok(events.some((e) => e.type === 'proposal'));
  cleanupTestEnv(t);
});

// ---------- the terminal decision: confirmProposal ----------

test('confirmProposal: y approves, n and closed stdin decline, and the text shows the commands', async () => {
  const { confirmProposal } = await import('../lib/cli.mjs');
  const proposal = { diagnosis: 'the cause', commands: [{ run: 'git remote -v', why: 'show the remote' }], userSteps: ['type a key'] };
  const ask = async (inputText) => {
    const input = new PassThrough();
    const outChunks = [];
    const output = new PassThrough();
    output.on('data', (d) => outChunks.push(String(d)));
    const p = confirmProposal(proposal, { input, output });
    if (inputText == null) input.end();
    else { input.write(inputText); input.end(); }
    return { answer: await p, text: outChunks.join('') };
  };
  const yes = await ask('y\n');
  assert.equal(yes.answer, true);
  assert.ok(yes.text.includes('git remote -v'), yes.text);
  assert.ok(yes.text.includes('Apply this fix? [y/N]'), yes.text);
  assert.equal((await ask('n\n')).answer, false);
  assert.equal((await ask(null)).answer, false, 'a closed stdin is a decline, never an approval');
  assert.equal((await ask('no way\n')).answer, false);
  // a proposal with no commands still asks (the user may want the userSteps listed)
  const { answer, text } = await (async () => {
    const input = new PassThrough();
    const outChunks = [];
    const output = new PassThrough();
    output.on('data', (d) => outChunks.push(String(d)));
    const pr = confirmProposal({ diagnosis: 'd', commands: [], userSteps: ['s'] }, { input, output });
    input.write('y\n'); input.end();
    return { answer: await pr, text: outChunks.join('') };
  })();
  assert.equal(answer, true);
  assert.ok(text.includes('no commands — the model only lists steps for you'), text);
});

// ---------- the server decision channel ----------

test('server: /api/proposal refuses when no proposal is waiting', async () => {
  const t = makeTestEnv({});
  const { startServer } = await import('../lib/server.mjs');
  const { url, server } = await startServer({ home: t.home, workspace: t.workspace, port: 7790 });
  try {
    const r = await fetch(`${url}/api/proposal`, { method: 'POST', body: JSON.stringify({ approve: true }) });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.ok(body.error.includes('No fix proposal'));
  } finally {
    server.close();
  }
  cleanupTestEnv(t);
});
