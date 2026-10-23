import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ENGINE = new URL('..', import.meta.url).pathname;
const TPL = join(ENGINE, 'payload', 'modules', 'automation', 'template');

const hash = (text) => createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
}

function makeProject(t) {
  const repo = join(t.workspace, 'app');
  mkdirSync(join(repo, 'devos'), { recursive: true });
  cpSync(join(TPL, 'scripts'), join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
  cpSync(join(TPL, '.github', 'workflows'), join(repo, '.github', 'workflows'), { recursive: true });
  cpSync(join(TPL, 'devos', 'prompts'), join(repo, 'devos', 'prompts'), { recursive: true });
  W2(join(ENGINE, 'package.json'), join(repo, 'devos', 'engine-package.json')); // for --version default
  // baseline hashes for the files as they shipped
  const files = collectEngineFiles(repo);
  const baselines = {};
  for (const rel of files) baselines[rel] = hash(readFileSync(join(repo, rel), 'utf8'));
  writeFileSync(join(repo, 'devos', 'engine-hashes.json'), JSON.stringify(baselines, null, 2));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'bootstrap');
  return repo;
}

function W2(src, dst) { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); }

function collectEngineFiles(repo) {
  const out = [];
  const walk = (base, rel = '') => {
    const dir = join(repo, base, rel);
    for (const name of existsSync(dir) ? execFileSync('/usr/bin/ls', [dir], { encoding: 'utf8' }).split('\n').filter(Boolean) : []) {
      const relPath = rel ? `${rel}/${name}` : name;
      if (!existsSync(join(dir, name))) continue;
      if (execFileSync('/usr/bin/stat', ['-c', '%F', join(dir, name)], { encoding: 'utf8' }).trim() === 'directory') {
        walk(base, relPath);
      } else {
        out.push(`${base}/${relPath}`);
      }
    }
  };
  walk('scripts/devos'); walk('scripts/guards'); walk('.github/workflows'); walk('devos/prompts');
  return out.filter((f) => !f.includes('engine-package'));
}

function makeSource(t, mutate) {
  const src = join(t.workspace, 'new-engine');
  mkdirSync(src, { recursive: true });
  cpSync(join(ENGINE, 'package.json'), join(src, 'package.json'));
  cpSync(join(TPL, 'scripts'), join(src, 'scripts'), { recursive: true });
  mkdirSync(join(src, '.github', 'workflows'), { recursive: true });
  cpSync(join(TPL, '.github', 'workflows'), join(src, '.github', 'workflows'), { recursive: true });
  cpSync(join(TPL, 'devos', 'prompts'), join(src, 'devos', 'prompts'), { recursive: true });
  if (mutate) mutate(src);
  return src;
}

test('upgrade: updates engine files on a branch and lists developer-edited files as conflicts', async () => {
  const t = makeTestEnv({});
  const repo = makeProject(t);
  // the developer edited one engine file and committed the change
  writeFileSync(join(repo, 'scripts', 'devos', 'intake.mjs'), '// developer override\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'developer edit');
  const src = makeSource(t, (s) => {
    writeFileSync(join(s, 'scripts', 'devos', 'common.mjs'), readFileSync(join(s, 'scripts', 'devos', 'common.mjs'), 'utf8') + '\n// engine v0.2 change\n');
  });
  const { runUpgrade } = await import('../lib/upgrade.mjs');
  const result = await runUpgrade({ projectDir: repo, sourceDir: src, version: '0.2.0' });
  assert.equal(result.ok, true, result.message);
  assert.ok(result.message.includes('devos/upgrade-0.2.0'));
  assert.ok(result.conflicts.includes('scripts/devos/intake.mjs'), 'edited file listed as conflict');
  assert.equal(readFileSync(join(repo, 'scripts', 'devos', 'intake.mjs'), 'utf8'), '// developer override\n', 'conflict left untouched');
  assert.ok(readFileSync(join(repo, 'scripts', 'devos', 'common.mjs'), 'utf8').includes('engine v0.2 change'));
  const branches = git(repo, 'branch', '--list', 'devos/upgrade-0.2.0');
  assert.ok(branches.includes('devos/upgrade-0.2.0'));
  cleanupTestEnv(t);
});

test('upgrade: a failed commit rolls back to a clean tree', async () => {
  const t = makeTestEnv({});
  const repo = makeProject(t);
  const src = makeSource(t, (s) => {
    writeFileSync(join(s, 'scripts', 'devos', 'common.mjs'), readFileSync(join(s, 'scripts', 'devos', 'common.mjs'), 'utf8') + '\n// engine v0.3 change\n');
  });
  const { runUpgrade } = await import('../lib/upgrade.mjs');
  process.env.DEVOS_GIT_FAIL_COMMIT = '1';
  const result = await runUpgrade({ projectDir: repo, sourceDir: src, version: '0.3.0' });
  delete process.env.DEVOS_GIT_FAIL_COMMIT;
  assert.equal(result.ok, false);
  assert.equal(result.message, 'devos: upgrade failed; rolled back, nothing changed.');
  const status = git(repo, 'status', '--porcelain');
  assert.equal(status.trim(), '', 'clean tree after rollback');
  const branches = git(repo, 'branch', '--list', 'devos/upgrade-0.3.0');
  assert.ok(!branches.includes('devos/upgrade-0.3.0'), 'the empty upgrade branch is deleted');
  assert.ok(!readFileSync(join(repo, 'scripts', 'devos', 'common.mjs'), 'utf8').includes('engine v0.3 change'), 'no engine change survived');
  cleanupTestEnv(t);
});

test('upgrade: a CRLF working copy does not fail the hash check that follows the LF form in git', async () => {
  const t = makeTestEnv({});
  const repo = makeProject(t);
  // rewrite a shipped file with Windows line endings; content is otherwise identical.
  // The developer commits the working copy, so the tree is clean when upgrade runs.
  const p = join(repo, 'scripts', 'devos', 'resume.mjs');
  const original = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(p, original.replace(/\n/g, '\r\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'windows checkout');
  const src = makeSource(t, null); // identical content upstream: nothing to update
  const { runUpgrade } = await import('../lib/upgrade.mjs');
  const result = await runUpgrade({ projectDir: repo, sourceDir: src, version: '0.4.0' });
  assert.equal(result.ok, true, result.message);
  assert.ok(!result.message.includes('Conflicts'), `no conflicts from CRLF: ${result.message}`);
  assert.ok(result.message.includes('already at'), 'CRLF copy is recognized as the shipped file');
  cleanupTestEnv(t);
});
