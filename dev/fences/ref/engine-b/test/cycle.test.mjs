import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, fakeLogEntries } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

const ENGINE = new URL('..', import.meta.url).pathname;
const TPL = join(ENGINE, 'payload', 'modules', 'automation', 'template');

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
}

// Builds a minimal bootstrapped repo: automation scripts, ledger, fence, prompts, config.
function makeRepo(t, overrides = {}) {
  const repo = join(t.workspace, 'app');
  mkdirSync(join(repo, 'devos', 'fences'), { recursive: true });
  mkdirSync(join(repo, 'devos', 'prompts'), { recursive: true });
  cpSync(join(TPL, 'scripts'), join(repo, 'scripts'), { recursive: true });
  cpSync(join(TPL, 'devos', 'prompts'), join(repo, 'devos', 'prompts'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'method'), { recursive: true });
  cpSync(join(TPL, 'docs', 'method', 'AUTOMATION.md'), join(repo, 'docs', 'method', 'AUTOMATION.md'));

  const W = (rel, content) => {
    const p = join(repo, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };

  W('package.json', JSON.stringify({
    name: 'app', version: '0.1.0', private: true, type: 'module',
    scripts: {
      typecheck: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
    },
  }, null, 2));

  W('devos/project.json', JSON.stringify({
    base: 'main',
    maxAttempts: 3,
    repo: 'octodev/app',
    reviewer: { cli: 'claude', command: 'claude', model: 'claude-opus-5-5' },
    lightReviewer: { same: true, cli: 'claude', model: 'claude-opus-5-5' },
    builder: overrides.builder || { cli: 'cursor', command: 'agent', model: 'grok-4.7' },
    builderPool: overrides.pool || [overrides.builder || { cli: 'cursor', command: 'agent', model: 'grok-4.7' }],
    pickPolicy: 'reviewer-picks',
    requiredChecks: { typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
    modules: { automation: { on: true }, database: { on: false, provider: 'none' } },
    languages: ['en'],
    hosting: 'none',
    type: 'saas',
    framework: 'next',
    usageLimitPattern: overrides.usageLimitPattern || null,
    configurationModel: { cli: 'claude', model: 'claude-opus-5-5', stage: overrides.stage || 'configuration-only' },
  }, null, 2));

  W('docs/PHASES.md', `| id | title | status | attempt | risk | gate |
|----|-------|--------|---------|------|------|
| T01 | First vertical slice | ${overrides.status || 'not-done'} | ${overrides.attempt ?? 0} | ${overrides.risk ?? 1} | ${overrides.gate || 'none'} |
`);

  W('devos/fences/T01.md', `# T01 — First vertical slice
Reviewer: claude claude-opus-5-5
Builder: ${(overrides.builder || { cli: 'cursor', model: 'grok-4.7' }).cli} ${(overrides.builder || { cli: 'cursor', model: 'grok-4.7' }).model}
Risk: ${overrides.risk ?? 1}
Attempt: ${overrides.attempt ?? 0}
Gate: ${overrides.gate || 'none'}

## Context
The architecture exists. Implement the first slice.

## Done when
- [ ] The orders screen lists one order. 
- [ ] The health route returns 200.

## Notes
`);
  W('docs/GLOSSARY.md', '# Glossary\n\n- **order**: a phone order.\n- **queue**: the live list of orders.\n- **desk**: the operator screen.\n');
  W('docs/PRODUCT_BRIEF.md', '# Brief\n\nThe desk shows the queue of every order.\n');
  W('docs/SCOPE.md', '# Scope\n\nIn: the desk queue of orders. Out: payments.\n');
  W('docs/BOUNDARY_MODEL.md', '# Boundary model\n\n- zone: src/server\n- zone: supabase\n');
  W('.env.example', 'EMPTY_NAME=\n');

  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@devos.local');
  git(repo, 'config', 'user.name', 'DEVOS Test');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'bootstrap');
  return repo;
}

function runCycle(repo, env = {}) {
  const r = spawnSync('node', ['scripts/devos/cycle.mjs'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'octodev/app',
      GH_TOKEN: 'fake-runner-token',
      ...env,
    },
  });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

test('cycle: PASS with no human gate merges and dispatches the next cycle with the chosen ids', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const { code, out, err } = runCycle(repo);
  assert.equal(code, 0, `${out}\n${err}`);
  assert.ok(out.includes('builder: cursor grok-4.7'), out);
  assert.ok(out.includes('reviewer: claude claude-opus-5-5'), out);
  assert.ok(out.includes('PASS with no human gate'));

  const verdict = readFileSync(join(repo, 'docs', 'reviews', 'T01-a1.md'), 'utf8');
  assert.ok(verdict.includes('VERDICT: PASS'));

  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /\|\s*T01\s*\|[^|]*\|\s*done\s*\|/);

  const calls = fakeLogEntries(t.fakeLog);
  assert.ok(calls.some((c) => c.cmd === 'gh' && c.argv[0] === 'workflow' && c.argv[1] === 'run' && c.argv[2] === 'devos-cycle.yml'), 'next cycle dispatched explicitly');
  assert.ok(calls.some((c) => c.cmd === 'claude' && JSON.stringify(c.argv).includes('claude-opus-5-5')), 'reviewer CLI got its model id');
  assert.ok(calls.some((c) => c.cmd === 'agent' && JSON.stringify(c.argv).includes('grok-4.7')), 'builder CLI got its model id');
  cleanupTestEnv(t);
});

test('cycle: PASS at risk 3 labels devos:human-gate and waits', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { risk: 3 });
  const { code, out } = runCycle(repo);
  assert.equal(code, 0, out);
  assert.ok(out.includes('human gate'));
  const calls = fakeLogEntries(t.fakeLog);
  assert.ok(calls.some((c) => c.cmd === 'gh' && JSON.stringify(c.argv).includes('devos:human-gate')));
  assert.ok(!calls.some((c) => c.cmd === 'gh' && c.argv[0] === 'workflow' && c.argv[1] === 'run'), 'no auto-dispatch while waiting');
  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /in-progress/);
  cleanupTestEnv(t);
});

test('cycle: FAIL rewrites and dispatches; after maxAttempts it halts (exit 1)', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { attempt: 2 });
  const { code, out } = runCycle(repo, { DEVOS_FAKE_VERDICT: 'FAIL' });
  assert.equal(code, 1, out);
  assert.ok(out.includes('Halting task T01'), out);
  const calls = fakeLogEntries(t.fakeLog);
  assert.ok(calls.some((c) => c.cmd === 'gh' && JSON.stringify(c.argv).includes('devos:halted')));
  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /halted/);
  cleanupTestEnv(t);
});

test('cycle: FAIL under the attempt budget commits the rewrite and dispatches again', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, {});
  const { code, out } = runCycle(repo, { DEVOS_FAKE_VERDICT: 'FAIL' });
  assert.equal(code, 0, out);
  assert.ok(out.includes('fence rewritten') || out.includes('dispatching the next attempt'), out);
  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /\|\s*T01\s*\|[^|]*\|\s*in-progress\s*\|\s*1\s*\|/);
  cleanupTestEnv(t);
});

test('cycle: refuses to run when the configuration model is not locked to configuration-only', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { stage: 'every-cycle' });
  const { code, out } = runCycle(repo);
  assert.equal(code, 1);
  assert.ok(out.includes('refuses to run'), out);
  cleanupTestEnv(t);
});

test('cycle: a missing secret opens the setup issue and waits (exit 1 — never a green run that did nothing)', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const { code, out } = runCycle(repo, { DEVOS_BUILDER_MODE: 'missing-secret' });
  assert.equal(code, 1, out);
  assert.ok(out.includes('missing secret: STRIPE_SECRET_KEY'), out);
  const calls = fakeLogEntries(t.fakeLog);
  // the runner opens or updates the "Dev OS: setup needed" issue; both are valid waits
  assert.ok(calls.some((c) => c.cmd === 'gh' && c.argv[0] === 'issue' && ['create', 'comment'].includes(c.argv[1])
    && JSON.stringify(c.argv).includes('STRIPE_SECRET_KEY')), 'setup issue created or updated with the secret name');
  // no verdict written, no merge
  assert.equal(existsSync(join(repo, 'docs', 'reviews', 'T01-a1.md')), false);
  cleanupTestEnv(t);
});

test('cycle: a usage limit moves once to the next builder in the pool, then parks when the pool is spent', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { pool: [{ cli: 'claude', command: 'claude', model: 'claude-opus-5-5' }, { cli: 'cursor', command: 'agent', model: 'grok-4.7' }] });
  // the fence names the claude builder; it hits the usage limit and the runner moves once
  const fencePath = join(repo, 'devos', 'fences', 'T01.md');
  writeFileSync(fencePath, readFileSync(fencePath, 'utf8').replace('Builder: cursor grok-4.7', 'Builder: claude claude-opus-5-5'));
  const { code, out } = runCycle(repo, { DEVOS_BUILDER_MODE: 'usage-limit' });
  assert.equal(code, 0, out);
  assert.ok(out.includes('moving once to cursor grok-4.7'), out);
  assert.ok(out.includes('builder: cursor grok-4.7'), out);
  assert.ok(!existsSync(join(repo, 'devos', 'state', 'park.json')), 'second builder succeeded; nothing parked');
  cleanupTestEnv(t);
});

test('cycle: a usage limit with no other builder parks and resumes later (exit 1 — never a fake green)', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { pool: [{ cli: 'claude', command: 'claude', model: 'claude-opus-5-5' }] });
  const fencePath = join(repo, 'devos', 'fences', 'T01.md');
  writeFileSync(fencePath, readFileSync(fencePath, 'utf8').replace('Builder: cursor grok-4.7', 'Builder: claude claude-opus-5-5'));
  const { code, out } = runCycle(repo, { DEVOS_BUILDER_MODE: 'usage-limit' });
  assert.equal(code, 1, out);
  assert.ok(out.includes('Parked on usage limit'), out);
  const park = JSON.parse(readFileSync(join(repo, 'devos', 'state', 'park.json'), 'utf8'));
  assert.equal(park.task, 'T01');
  assert.equal(park.reason, 'usage limit');
  cleanupTestEnv(t);
});

test('cycle: an id outside the pool falls back to the default builder, and the run log says why', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const fence = join(repo, 'devos', 'fences', 'T01.md');
  writeFileSync(fence, readFileSync(fence, 'utf8').replace('Builder: cursor grok-4.7', 'Builder: gemini gemini-2.5-pro'));
  const { code, out } = runCycle(repo);
  assert.equal(code, 0, out);
  assert.ok(out.includes('outside the pool; falling back to the default builder cursor grok-4.7'), out);
  cleanupTestEnv(t);
});

// ---------- pre-flight: the two walls that wasted the user's first real run ----------

test('cycle: a mapped-but-empty agent secret waits with a setup issue instead of burning an attempt (exit 1)', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  // The workflow maps CURSOR_API_KEY from secrets; GitHub holds no value, so the
  // env var arrives present-but-empty — exactly what Actions sends.
  const { code, out } = runCycle(repo, { CURSOR_API_KEY: '' });
  assert.equal(code, 1, out);
  assert.ok(out.includes('secret CURSOR_API_KEY has no value on GitHub'), out);
  const calls = fakeLogEntries(t.fakeLog);
  // init_github already opened a setup issue for the missing secrets, so the
  // cycle COMMENTS on it (naming the secret) instead of creating a duplicate.
  assert.ok(
    calls.some((c) => c.cmd === 'gh' && c.argv[0] === 'issue' && ['create', 'comment'].includes(c.argv[1])),
    'the setup issue names the secret',
  );
  const comment = calls.find((c) => c.cmd === 'gh' && c.argv[0] === 'issue' && c.argv[1] === 'comment');
  if (comment) assert.ok(JSON.stringify(comment.argv).includes('CURSOR_API_KEY'), 'the comment names CURSOR_API_KEY');
  assert.ok(!calls.some((c) => c.cmd === 'agent'), 'the builder never ran without its credential');
  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /not-done/, 'no attempt was consumed while waiting');
  cleanupTestEnv(t);
});

test('cycle: a missing CLI binary fails with the install-clis fix, not "exited with code null"', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { builder: { cli: 'custom:mybuilder', command: 'mybuilder', model: 'custom-x' } });
  const { code, out } = runCycle(repo);
  assert.equal(code, 1, out);
  assert.ok(out.includes('is not installed on this runner'), out);
  assert.ok(out.includes('node scripts/devos/install-clis.mjs'), out);
  assert.ok(!out.includes('exited with code null'), out);
  assert.ok(!fakeLogEntries(t.fakeLog).some((c) => c.cmd === 'agent'), 'the reviewer was not started either');
  cleanupTestEnv(t);
});

test('install-clis: --print shows the plan from devos/project.json without touching the network', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const r = spawnSync('node', ['scripts/devos/install-clis.mjs', '--print'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('would install cursor'), r.stdout);
  assert.ok(r.stdout.includes('would install claude'), r.stdout);
  cleanupTestEnv(t);
});

test('install-clis: --print skips a custom tool with a line that says so', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t, { builder: { cli: 'custom:mybuilder', command: 'mybuilder', model: 'custom-x' } });
  const r = spawnSync('node', ['scripts/devos/install-clis.mjs', '--print'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('would skip custom:mybuilder'), r.stdout);
  cleanupTestEnv(t);
});

// ---------- v2: the details the reference build shows and the old cycle never did ----------

test('cycle v2: a PASS opens a PR, comments the builder outcome and the verdict, and sets devos/checks + devos/verdict statuses', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const { code, out } = runCycle(repo);
  assert.equal(code, 0, out);
  const calls = fakeLogEntries(t.fakeLog);
  // the PR is opened for the attempt — created when none exists, reused when the
  // fake (like a re-run) already lists one for the branch
  assert.ok(
    calls.some((c) => c.cmd === 'gh' && c.argv[0] === 'pr' && (c.argv[1] === 'create' || c.argv[1] === 'list')),
    'a pull request is opened (or reused) for the attempt',
  );
  const comments = calls.filter((c) => c.cmd === 'gh' && c.argv[0] === 'pr' && c.argv[1] === 'comment');
  assert.ok(comments.length >= 2, 'the builder outcome AND the verdict land as PR comments');
  assert.ok(comments.some((c) => JSON.stringify(c.argv).includes('Builder outcome')), 'the builder outcome comment');
  assert.ok(comments.some((c) => JSON.stringify(c.argv).includes('Verdict: PASS')), 'the verdict comment');
  // the two commit statuses the human gate tells the developer to trust
  const statuses = calls.filter((c) => c.cmd === 'gh' && c.argv[0] === 'api' && String(c.argv[1] || '').includes('/statuses/'));
  assert.ok(statuses.some((c) => JSON.stringify(c.argv).includes('devos/checks')), 'devos/checks status is set');
  assert.ok(statuses.some((c) => JSON.stringify(c.argv).includes('devos/verdict') && JSON.stringify(c.argv).includes('state=success')), 'devos/verdict is green on PASS');
  // the runner state folder never reaches the repository
  const gitignore = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /devos\/state\/?/, 'devos/state/ is gitignored by the cycle itself');
  cleanupTestEnv(t);
});

test('cycle v2: the workflow phases run as separate processes and hand state over via devos/state/attempt.json', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  const runPhase = (phase, env = {}) => spawnSync('node', ['scripts/devos/cycle.mjs', phase], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'octodev/app', GH_TOKEN: 'fake-runner-token', ...env },
  });
  const start = runPhase('start');
  assert.equal(start.status, 0, `${start.stdout}${start.stderr}`);
  assert.ok(start.stdout.includes('task T01: First vertical slice'), start.stdout);
  assert.ok(start.stdout.includes('attempt 1 of 3'), start.stdout);
  const st = JSON.parse(readFileSync(join(repo, 'devos', 'state', 'attempt.json'), 'utf8'));
  assert.equal(st.todo, true);
  assert.equal(st.taskId, 'T01');
  assert.equal(st.branch, 'task/T01');
  const build = runPhase('build');
  assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
  assert.ok(build.stdout.includes('builder: cursor grok-4.7'), build.stdout);
  const checks = runPhase('checks');
  assert.equal(checks.status, 0, `${checks.stdout}${checks.stderr}`);
  assert.ok(checks.stdout.includes('all green'), checks.stdout);
  const review = runPhase('review');
  assert.equal(review.status, 0, `${review.stdout}${review.stderr}`);
  const verdict = runPhase('verdict');
  assert.equal(verdict.status, 0, `${verdict.stdout}${verdict.stderr}`);
  assert.ok(verdict.stdout.includes('PASS with no human gate'), verdict.stdout);
  const phases = readFileSync(join(repo, 'docs', 'PHASES.md'), 'utf8');
  assert.match(phases, /\|\s*T01\s*\|[^|]*\|\s*done\s*\|/);
  // an unknown phase is refused, not silently ignored
  const bad = runPhase('nonsense');
  assert.equal(bad.status, 2, bad.stdout);
  cleanupTestEnv(t);
});

test('cycle v2: a red checks run comments the failing output on the PR and still hands the evidence to the reviewer', () => {
  const t = makeTestEnv({});
  const repo = makeRepo(t);
  // make the required test check red (requiredChecks carries the commands, not npm scripts)
  const cfg = JSON.parse(readFileSync(join(repo, 'devos', 'project.json'), 'utf8'));
  cfg.requiredChecks.test = 'node -e "console.error(\'ERR: 3 tests fail\'); process.exit(1)"';
  writeFileSync(join(repo, 'devos', 'project.json'), JSON.stringify(cfg, null, 2));
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'red test');
  const { code, out } = runCycle(repo, { DEVOS_FAKE_VERDICT: 'FAIL' });
  // checks red + verdict FAIL = the attempt fails, the fence is rewritten, the next attempt is dispatched
  assert.equal(code, 0, out);
  const calls = fakeLogEntries(t.fakeLog);
  const comments = calls.filter((c) => c.cmd === 'gh' && c.argv[0] === 'pr' && c.argv[1] === 'comment');
  assert.ok(comments.some((c) => JSON.stringify(c.argv).includes('devos/checks: red')), 'the checks comment names what is red');
  assert.ok(comments.some((c) => JSON.stringify(c.argv).includes('3 tests fail')), 'the failing output itself is on the PR');
  const statuses = calls.filter((c) => c.cmd === 'gh' && c.argv[0] === 'api' && String(c.argv[1] || '').includes('/statuses/'));
  assert.ok(statuses.some((c) => JSON.stringify(c.argv).includes('devos/checks') && JSON.stringify(c.argv).includes('state=failure')), 'devos/checks is red');
  assert.ok(statuses.some((c) => JSON.stringify(c.argv).includes('devos/verdict') && JSON.stringify(c.argv).includes('state=failure')), 'devos/verdict is red on FAIL');
  cleanupTestEnv(t);
});
