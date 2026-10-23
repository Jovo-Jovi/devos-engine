import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';
import { runStart } from '../lib/start.mjs';
import { PassThrough } from 'node:stream';

function capture() {
  const lines = [];
  const stdout = { write: (s) => { lines.push(s); return true; } };
  return { lines, stdout };
}

function readyCheck() {
  return {
    ready: true,
    blocks: [],
    rows: [
      { label: 'Node', detail: process.versions.node, state: 'ready' },
      { label: 'git', detail: 'installed', state: 'ready' },
      { label: 'gh', detail: 'installed and signed in', state: 'ready' },
    ],
    agents: [{ label: 'Claude Code', status: 'installed', signedIn: true }],
  };
}

function blockedCheck() {
  return {
    ready: false,
    blocks: ['git is missing. Install git, then run devos init again.'],
    rows: [
      { label: 'Node', detail: process.versions.node, state: 'ready' },
      { label: 'git', detail: 'missing', state: 'blocked' },
      { label: 'gh', detail: 'missing', state: 'blocked' },
    ],
    agents: [],
  };
}

test('start: --check prints the checklist and exits 0 without any prompt', async () => {
  makeTestEnv({});
  const { lines, stdout } = capture();
  const launched = [];
  const code = await runStart({ argv: ['--check'], stdin: new PassThrough(), stdout, check: readyCheck, launch: async () => launched.push(1) });
  assert.equal(code, 0);
  assert.ok(launched.length === 0, '--check must not launch the setup');
  const text = lines.join('');
  assert.match(text, /Your computer:/);
  assert.match(text, /Node: /);
  assert.match(text, /Everything DEV_OS needs is on this computer\./);
  assert.match(text, /Check only \(--check\): nothing was started\./);
  cleanupTestEnv({});
});

test('start: a blocked machine lists the fix and never prompts or launches', async () => {
  makeTestEnv({});
  const { lines, stdout } = capture();
  const launched = [];
  const stdin = new PassThrough();
  const code = await runStart({ argv: [], stdin, stdout, check: blockedCheck, launch: async () => launched.push(1) });
  assert.equal(code, 1);
  assert.ok(launched.length === 0, 'a blocked machine must not launch');
  const text = lines.join('');
  assert.match(text, /Fix these, then open this file again:/);
  assert.match(text, /1\. git is missing\./);
  assert.match(text, /https:\/\/git-scm\.com\/downloads/);
  assert.match(text, /Nothing on your computer was changed\./);
  assert.ok(!text.includes('Start the guided setup now?'), 'no approval prompt while blocked');
  cleanupTestEnv({});
});

test('start: Enter or y approves and opens the guided setup; n starts nothing', async () => {
  makeTestEnv({});
  // Approval: an Enter (empty line) counts as yes.
  {
    const { lines, stdout } = capture();
    const launched = [];
    const stdin = new PassThrough();
    stdin.isTTY = true; // the launcher prompts only a real terminal; a fake one counts
    stdin.end('\n');
    const code = await runStart({ argv: [], stdin, stdout, check: readyCheck, launch: async () => launched.push(1) });
    assert.equal(code, 0);
    assert.equal(launched.length, 1, 'Enter must approve and launch');
    assert.match(lines.join(''), /Opening the guided setup\./);
  }
  // Decline: n starts nothing.
  {
    const { lines, stdout } = capture();
    const launched = [];
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.end('n\n');
    const code = await runStart({ argv: [], stdin, stdout, check: readyCheck, launch: async () => launched.push(1) });
    assert.equal(code, 0);
    assert.ok(launched.length === 0, 'n must not launch');
    assert.match(lines.join(''), /Nothing was started\. Open this file again any time\./);
  }
  // A ready machine with zero signed-in agents warns but still offers to start.
  {
    const { lines, stdout } = capture();
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.end('n\n');
    await runStart({
      argv: [], stdin, stdout,
      check: () => ({ ready: true, blocks: [], rows: readyCheck().rows, agents: [{ label: 'Claude Code', status: 'installed', signedIn: false }] }),
      launch: async () => {},
    });
    const text = lines.join('');
    assert.match(text, /no AI CLI is signed in yet/);
    assert.match(text, /Everything DEV_OS needs is on this computer\./);
  }
  cleanupTestEnv({});
});

test('start: the shipped start files call the launcher; doctor --json parses', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = join(new URL('..', import.meta.url).pathname);
  assert.match(readFileSync(join(root, 'start.sh'), 'utf8'), /node bin\/start\.mjs "\$@"/);
  assert.match(readFileSync(join(root, 'start.bat'), 'utf8'), /node bin\\start\.mjs %\*/);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['bin/devos.mjs', 'doctor', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.rows) && parsed.rows.length >= 3, 'doctor --json reports Node, git, gh rows');
  assert.ok(parsed.rows.some((row) => row.label === 'Node' && row.state === 'ready'));
});
