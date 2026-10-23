import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = new URL('..', import.meta.url).pathname;
const WF = join(ENGINE, 'payload', 'modules', 'automation', 'template', '.github', 'workflows');

test('yaml: every shipped workflow parses structurally; no step body sits at column 0 in a run: | block', async () => {
  const { lintYaml } = await import('../lib/yamllint.mjs');
  for (const f of readdirSync(WF).sort()) {
    const problems = lintYaml(readFileSync(join(WF, f), 'utf8'), f);
    assert.deepEqual(problems, [], `${f} must lint clean`);
  }
});

test('yaml: a run: | block with a step body at column 0 fails the lint', async () => {
  const { lintYaml } = await import('../lib/yamllint.mjs');
  const bad = `name: bad
on:
  push:
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - run: |
echo boom
`;
  const problems = lintYaml(bad, 'bad.yml');
  assert.ok(problems.some((p) => p.includes('column 0')), problems.join('\n'));
});

test('yaml: if: >- folded blocks and indented run blocks lint clean', async () => {
  const { lintYaml } = await import('../lib/yamllint.mjs');
  const ok = `name: ok
on:
  workflow_dispatch:
jobs:
  x:
    if: >-
      github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - run: |
          node scripts/devos/cycle.mjs
`;
  assert.deepEqual(lintYaml(ok, 'ok.yml'), []);
});

test('guards: the shipped runner guards pass on a freshly bootstrapped tree', async () => {
  const t = makeTestEnv({});
  const repo = join(t.workspace, 'app');
  const TPL = join(ENGINE, 'payload', 'modules', 'automation', 'template');
  const { cpSync, mkdirSync, writeFileSync } = await import('node:fs');
  cpSync(join(TPL, 'scripts', 'guards'), join(repo, 'scripts', 'guards'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'method'), { recursive: true });
  cpSync(join(TPL, 'docs', 'method', 'AUTOMATION.md'), join(repo, 'docs', 'method', 'AUTOMATION.md'));
  const { spawnSync } = await import('node:child_process');
  // minimal docs the guards expect
  const W = (rel, content) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), content); };
  W('docs/PHASES.md', '| id | title | status | attempt | risk | gate |\n|----|-------|--------|---------|------|------|\n| T01 | First slice | not-done | 0 | 1 | none |\n');
  W('docs/GLOSSARY.md', '# Glossary\n\n- **order**: an order.\n- **queue**: a queue.\n- **desk**: a desk.\n');
  W('docs/PRODUCT_BRIEF.md', '# Brief\n\nThe desk shows the order queue.\n');
  W('docs/SCOPE.md', '# Scope\n\nIn: the desk order queue. Out: payments.\n');
  W('docs/BOUNDARY_MODEL.md', '# Boundary\n\n- zone: src/server\n');
  W('.env.example', 'DATABASE_URL=\n');
  const r = spawnSync('node', ['scripts/guards/run-all.mjs'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  cleanupTestEnv(t);
});

test('doctor: blocks only on Node < 22, missing git, or gh missing/logged out', async () => {
  makeTestEnv({});
  process.env.DEVOS_GH_SIGNED_OUT = '1';
  const { machineCheck } = await import('../lib/doctor.mjs');
  const c = machineCheck();
  delete process.env.DEVOS_GH_SIGNED_OUT;
  assert.equal(c.ready, false, 'a logged-out gh blocks');
  assert.ok(c.blocks.some((b) => b.includes('gh auth login')));
  assert.ok(c.rows.some((r) => r.label === 'Node' && r.state === 'ready'));
  assert.ok(c.rows.some((r) => r.label === 'git' && r.state === 'ready'));
  assert.ok(c.rows.some((r) => r.label.startsWith('Cursor') || r.label.startsWith('Claude')), 'agent CLIs listed with sign-in state');
});

test('doctor: an agent CLI that is installed but signed out is shown, not blocked', async () => {
  makeTestEnv({});
  process.env.DEVOS_CLAUDE_SIGNED_OUT = '1';
  const { machineCheck } = await import('../lib/doctor.mjs');
  const c = machineCheck();
  delete process.env.DEVOS_CLAUDE_SIGNED_OUT;
  assert.equal(c.ready, true, 'agent sign-out never blocks');
  const claudeRow = c.rows.find((r) => r.label === 'Claude Code');
  assert.equal(claudeRow.state, 'signed-out');
});

test('guards: README, AGENTS, the stack ADR, install-clis, and the workflow install step are required — and pass on a real bootstrap', async () => {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { validateBootstrap } = await import('../lib/guards.mjs');
  const { finalizeAnswers } = await import('../lib/answers.mjs');
  const { rmSync, writeFileSync } = await import('node:fs');
  const { saasDraft } = await import('./helpers.mjs');
  const draft = finalizeAnswers(saasDraft());
  const first = await runInit({ draft, home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(first.result.ok, true, first.result.message || '');
  const { projectDir, answers } = first;
  const green = validateBootstrap(projectDir, answers, { engineRoot: ENGINE });
  assert.deepEqual(green.report, [], `fresh bootstrap must pass: ${green.report.join(' | ')}`);
  // Strip exactly what the user's generated repo was missing (and what the
  // control-tower bar demands): the README front page, agent rules, the stack
  // ADR, the CLI installer, and the workflow step that calls it.
  rmSync(join(projectDir, 'README.md'));
  rmSync(join(projectDir, 'AGENTS.md'));
  rmSync(join(projectDir, 'docs', 'adr'), { recursive: true, force: true });
  rmSync(join(projectDir, 'scripts', 'devos', 'install-clis.mjs'));
  const wf = join(projectDir, '.github', 'workflows', 'devos-cycle.yml');
  writeFileSync(wf, readFileSync(wf, 'utf8').replace(/^.*install-clis.*\n/m, ''));
  const guard = validateBootstrap(projectDir, answers, { engineRoot: ENGINE });
  assert.equal(guard.ok, false);
  const joined = guard.report.join('\n');
  for (const needle of [
    'README.md is missing',
    'AGENTS.md is missing',
    'docs/adr/ADR-001-stack.md is missing',
    'scripts/devos/install-clis.mjs is missing',
    'must run scripts/devos/install-clis.mjs',
  ]) {
    assert.ok(joined.includes(needle), `${needle}\nreport: ${joined}`);
  }
  cleanupTestEnv(t);
});
