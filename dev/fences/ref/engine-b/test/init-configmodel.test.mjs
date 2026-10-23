import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit, resumeInit, createProjectFolder } = await import('../lib/init.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  return { t, runInit, resumeInit, createProjectFolder, readFileSync, existsSync, join };
}

test('init: fake configuration model writes a saas bootstrap and calls init_github', async () => {
  const { t, runInit, existsSync, join } = await fresh();
  const events = [];
  const { result, projectDir, answers } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: (e) => events.push(e) });

  assert.equal(result.ok, true, `runner failed: ${result.message || ''}`);
  assert.equal(result.finalLine, 'devos init: octodev/order-desk is set up; devos-cycle dispatched.');
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'writing-project'));
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'creating-github'));
  assert.ok(events.some((e) => e.type === 'github'));
  assert.ok(events.some((e) => e.type === 'file' && e.path === 'package.json'));
  assert.ok(events.some((e) => e.type === 'module' && e.id === 'database'));

  // stack config for the chosen framework
  for (const f of ['package.json', 'next.config.ts', 'tsconfig.json', '.env.example', '.gitignore', '.editorconfig']) {
    assert.equal(existsSync(join(projectDir, f)), true, `${f} exists`);
  }
  // architecture
  for (const f of ['docs/ARCHITECTURE.md', 'src/app/page.tsx', 'src/app/api/health/route.ts', 'src/components', 'src/lib', 'src/features', 'src/server', 'tests/architecture.test.mjs']) {
    assert.equal(existsSync(join(projectDir, f)), true, `${f} exists`);
  }
  // active module files; automation
  for (const f of ['src/server/database.ts', 'src/server/auth.ts', 'src/server/email.ts', 'supabase/config.toml', 'supabase/migrations/0001_init.sql', 'vercel.json', 'playwright.config.ts', 'devos/project.json', '.github/workflows/devos-cycle.yml', 'devos/fences/T01.md', 'docs/PHASES.md', 'SETUP.md', 'docs/DECISIONS.md']) {
    assert.equal(existsSync(join(projectDir, f)), true, `${f} exists`);
  }
  // inactive modules leave no folders
  assert.equal(existsSync(join(projectDir, 'src/server/storage.ts')), false);
  assert.equal(existsSync(join(projectDir, 'src/server/payments.ts')), false);

  const cfg = JSON.parse(await import('node:fs').then((m) => m.readFileSync(join(projectDir, 'devos', 'project.json'), 'utf8')));
  assert.equal(cfg.reviewer.cli, 'claude');
  assert.equal(cfg.reviewer.model, 'claude-opus-5-5');
  assert.equal(cfg.builder.cli, 'cursor');
  assert.equal(cfg.builder.model, 'grok-4.7');
  assert.equal(cfg.configurationModel.stage, 'configuration-only');
  assert.equal(cfg.base, 'main');
  assert.equal(cfg.maxAttempts, 3);

  // init_github is the only GitHub write; it ran once and dispatched the cycle
  const ghCalls = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'gh');
  assert.ok(ghCalls.some((c) => c.argv[0] === 'repo' && c.argv[1] === 'create'));
  assert.ok(ghCalls.some((c) => c.argv[0] === 'workflow' && c.argv[1] === 'run' && c.argv[2] === 'devos-cycle.yml'));
  assert.ok(ghCalls.some((c) => c.argv[0] === 'variable' && c.argv[1] === 'set' && c.argv[2] === 'DEVOS_ACTIVE_MODULES'));
  // second call is refused
  const { runInitGithub } = await import('../lib/initgithub.mjs');
  assert.throws(() => runInitGithub({ projectDir }), /already/);

  // secret handoff: gh secret set NAME without --body; the value never transits the engine
  const secretSets = ghCalls.filter((c) => c.argv[0] === 'secret' && c.argv[1] === 'set');
  assert.ok(secretSets.some((c) => c.argv[2] === 'ANTHROPIC_API_KEY' || c.argv[2] === 'CLAUDE_CODE_OAUTH_TOKEN'), 'reviewer tool secret requested');
  assert.ok(secretSets.some((c) => c.argv[2] === 'CURSOR_API_KEY'), 'builder tool secret requested');
  for (const s of secretSets) assert.ok(!s.argv.includes('--body'), 'no --body in secret handoff');
  const leaked = JSON.stringify(events).includes('SUPERSECRETVALUE');
  assert.equal(leaked, false, 'no secret value in engine events');

  cleanupTestEnv(t);
});

test('init: choosing marketing plus Astro writes no database and no auth; saas writes both', async () => {
  const { t, runInit, existsSync, join, readFileSync } = await fresh();
  const draft = saasDraft();
  draft.type = 'marketing';
  draft.framework = 'astro';
  draft.project.slug = 'octodev/quote-page';
  draft.project.name = 'Quote Page';
  draft.modules.database = { on: false, provider: 'none' };
  draft.modules.auth = { on: false, provider: 'none' };
  draft.modules.email = { on: false, provider: 'none' };
  draft.modules.hosting = { on: true, provider: 'vercel' };
  draft.modules.testing = { on: true, unit: true, playwright: true };

  const { result, projectDir } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(result.ok, true, result.message || '');
  assert.equal(existsSync(join(projectDir, 'src/server/database.ts')), false, 'no database module');
  assert.equal(existsSync(join(projectDir, 'src/server/auth.ts')), false, 'no auth module');
  assert.equal(existsSync(join(projectDir, 'supabase')), false);
  assert.equal(existsSync(join(projectDir, 'astro.config.mjs')), true, 'astro stack config written');

  // and the saas path wrote both modules (spot-check via a second workspace)
  const { runInit: runInit2 } = { runInit };
  const t2ws = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/devos-ws2-');
  const { result: r2, projectDir: pd2 } = await runInit2({ draft: saasDraft(), home: t.home, workspace: t2ws, emit: () => {} });
  assert.equal(r2.ok, true);
  assert.equal(existsSync(join(pd2, 'src/server/database.ts')), true, 'saas writes the database module');
  assert.equal(existsSync(join(pd2, 'src/server/auth.ts')), true, 'saas writes the auth module');
  cleanupTestEnv(t);
});

test('init: a guard failure triggers one automatic repair round including the guard output', async () => {
  const { t, runInit, existsSync, join, readFileSync } = await fresh();
  process.env.DEVOS_FAKE_MODE = 'guard-fail-once';
  const events = [];
  const { result, projectDir } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: (e) => events.push(e) });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, true, result.message || '');
  assert.equal(result.round, 1, 'exactly one repair round');
  assert.ok(events.some((e) => e.type === 'phase' && e.name === 'repairing' && e.round === 1));
  const prompt = readFileSync(join(projectDir, 'devos', 'state', 'config-prompt.md'), 'utf8');
  assert.ok(prompt.includes('REPAIR ROUND 1'), 'the repair prompt includes the round');
  assert.ok(prompt.includes('guard must be') || prompt.includes('reviewer must be'), 'the repair prompt includes the guard output');
  cleanupTestEnv(t);
});

test('init: guard failures stop after five repair rounds', async () => {
  const { t, runInit } = await fresh();
  process.env.DEVOS_FAKE_MODE = 'guard-always';
  const { result } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, false);
  assert.equal(result.guardFailed, true);
  assert.ok(result.message.includes('5 repair rounds'));
  cleanupTestEnv(t);
});

test('init: a repair round that re-calls init_github does not fail the run once GitHub is set up', async () => {
  const { t, runInit } = await fresh();
  // Round 0 completes GitHub then drops a guard-required file; round 1 rebuilds
  // the tree and re-calls init_github, which refuses ("It runs once"). The run
  // must still finish ok — the repository exists, the guards decide.
  process.env.DEVOS_FAKE_MODE = 'init-twice';
  const events = [];
  const { result } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: (e) => events.push(e) });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, true, `expected a recovered run, got: ${result.message || 'ok'}`);
  assert.equal(result.round, 1, 'one repair round was used');
  assert.ok(events.some((e) => e.type === 'log' && String(e.line).includes('already set up')), 'the engine says the recovery is expected');
  cleanupTestEnv(t);
});

test('init: a usage limit shows the tool message; --continue resumes at the configuration model', async () => {
  const { t, runInit, resumeInit, existsSync, join } = await fresh();
  process.env.DEVOS_FAKE_MODE = 'usage-limit';
  const first = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(first.result.ok, false);
  assert.equal(first.result.usageLimit, true);
  assert.ok(first.result.message.toLowerCase().includes('usage limit'), `tool message shown: ${first.result.message}`);

  const { result } = await resumeInit({ projectDir: first.projectDir, emit: () => {} });
  assert.equal(result.ok, true, result.message || '');
  assert.equal(result.finalLine, 'devos init: octodev/order-desk is set up; devos-cycle dispatched.');
  assert.equal(existsSync(join(first.projectDir, 'devos', 'project.json')), true);
  cleanupTestEnv(t);
});

test('init: a model that never calls init_github fails with a resume hint', async () => {
  const { t, runInit } = await fresh();
  process.env.DEVOS_FAKE_MODE = 'guard-always';
  // guard-always never passes guards, so use a mode that passes guards but skips github:
  process.env.DEVOS_FAKE_MODE = 'no-github';
  const { result } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('init_github'), result.message);
  cleanupTestEnv(t);
});

test('init: the cursor configuration model runs behind the cursor trust gate (--trust is passed)', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  // untrusted mode: the fake agent refuses any invocation without --trust, exactly like
  // Cursor's real directory-trust gate. The run must still succeed.
  process.env.DEVOS_FAKE_MODE = 'untrusted';
  const { result } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, true, `expected the run to pass the trust gate, got: ${result.message || 'ok'}`);
  const promptRuns = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'agent' && e.argv.includes('-p'));
  assert.ok(promptRuns.length > 0, 'the fake agent ran in prompt mode');
  assert.ok(promptRuns.every((c) => c.argv.includes('--trust')), 'every cursor prompt invocation passes --trust');
  cleanupTestEnv(t);
});

test('init: a cursor trust refusal comes back as trustIssue with the one-time fix', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  // A pre-trust-gate adapter: 'agent -p' with no --trust, exactly what an older engine sent.
  draft.models.configurationModel = {
    cli: 'legacy-cursor', model: 'grok-4.7',
    agent: { toolId: 'legacy-cursor', command: 'agent', promptTemplate: 'agent -p' },
  };
  process.env.DEVOS_FAKE_MODE = 'untrusted';
  const { result } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, false);
  assert.equal(result.trustIssue, true, `expected trustIssue, got: ${result.message || 'ok'}`);
  assert.ok(result.message.includes('trust'), result.message);
  assert.ok(result.message.includes("devos continue"), result.message);
  cleanupTestEnv(t);
});

test('init: cursor "auto" runs on a Free plan (no --model flag is sent)', async () => {
  const { t, runInit } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'auto' };
  // plan-restricted mode: the fake agent refuses any named model (--model present),
  // exactly like Cursor's "Named models unavailable" Free-plan wall.
  process.env.DEVOS_FAKE_MODE = 'plan-restricted';
  const { result } = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(result.ok, true, `expected auto to run on the free plan, got: ${result.message || 'ok'}`);
  const runs = fakeLogEntries(t.fakeLog).filter((e) => e.cmd === 'agent' && e.argv.includes('-p'));
  assert.ok(runs.length > 0, 'the fake agent ran in prompt mode');
  assert.ok(runs.every((c) => !c.argv.includes('--model')), 'auto sends no --model flag');
  cleanupTestEnv(t);
});

test('init: a named model on a Free plan returns planIssue; --model auto resume succeeds', async () => {
  const { t, runInit, resumeInit, join } = await fresh();
  const draft = saasDraft();
  draft.models.configurationModel = { cli: 'cursor', model: 'grok-4.7' };
  process.env.DEVOS_FAKE_MODE = 'plan-restricted';
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(first.result.ok, false);
  assert.equal(first.result.planIssue, true, `expected planIssue, got: ${first.result.message || 'ok'}`);
  assert.ok(first.result.message.includes('--model auto'), first.result.message);
  assert.ok(first.result.message.includes('devos continue'), first.result.message);
  // resume with the override: the saved answer is patched to auto and the run completes
  const second = await resumeInit({ projectDir: first.projectDir, overrides: { model: 'auto' }, emit: () => {} });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(second.result.ok, true, second.result.message || '');
  const saved = JSON.parse((await import('node:fs')).readFileSync(join(first.projectDir, 'devos', 'answers.json'), 'utf8'));
  assert.equal(saved.models.configurationModel.model, 'auto', 'the override is persisted in answers.json');
  cleanupTestEnv(t);
});
