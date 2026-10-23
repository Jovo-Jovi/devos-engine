import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyCatalog, keysNotesMarkdown, checkKeys, writeKeysNotes } from '../lib/keys.mjs';
import { recommendedConfiguration } from '../lib/wizard.mjs';
import { finalizeAnswers } from '../lib/answers.mjs';
import { writeIntakeDocs } from '../lib/init.mjs';
import { buildConfigPrompt } from '../lib/prompt.mjs';
import { validateBootstrap } from '../lib/guards.mjs';
import { renderLogo } from '../lib/logo.mjs';
import { collectDocs } from '../lib/docs.mjs';

function sampleAnswers() {
  return {
    schema: 'devos/answers@1',
    models: {
      reviewer: { cli: 'claude', model: 'claude-fable-5-1' },
      builder: { cli: 'cursor', model: 'grok-4.7' },
      extraBuilders: [],
      lightReviewer: { same: true, cli: null, model: null },
      pickPolicy: 'reviewer-picks',
      configurationModel: { cli: 'claude', model: 'claude-fable-5-1' },
    },
    project: { name: 'Order Desk', slug: 'octodev/order-desk', brief: 'x', audience: 'y', visibility: 'private' },
    type: 'saas',
    framework: 'next',
    modules: {
      automation: { on: true },
      language: { on: true, provider: 'typescript' },
      testing: { on: true, unit: true, playwright: true },
      database: { on: true, provider: 'supabase' },
      auth: { on: true, provider: 'email', impl: 'better-auth' },
      hosting: { on: true, provider: 'vercel' },
      email: { on: false, provider: 'none' },
    },
    languages: ['en'],
  };
}

test('keys: the catalog lists every needed name once, with a source', () => {
  const keys = keyCatalog(sampleAnswers());
  const names = keys.map((k) => k.name);
  for (const expected of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'BETTER_AUTH_SECRET', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
    assert.ok(names.includes(expected), `${expected} in catalog`);
  }
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  for (const k of keys) assert.ok(k.where.length > 10, `${k.name} says where to get it`);
});

test('keys: the guide holds names, sources, and commands — never a value', () => {
  const md = keysNotesMarkdown(sampleAnswers(), { repo: 'octodev/order-desk' });
  assert.ok(md.includes('# Keys and tokens — Order Desk'));
  assert.ok(md.includes('Nothing in chat'), 'the never-in-chat rule is stated');
  for (const name of keyCatalog(sampleAnswers()).map((k) => k.name)) {
    assert.ok(md.includes(`### ${name}`), `${name} has its own section`);
    assert.ok(md.includes(`gh secret set ${name} --repo octodev/order-desk`), `${name} has its command`);
  }
  assert.ok(md.includes('Get-Content'), 'a PowerShell pipe example is shown');
  assert.ok(md.includes('devos keys --check'), 'the verify command is shown');
  assert.ok(!/sk-[A-Za-z0-9]|ghp_[A-Za-z0-9]/.test(md), 'no placeholder-looking values');
});

test('keys: writeKeysNotes lands in devos/KEYS-NOTES.example.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devos-keys-'));
  try {
    const file = writeKeysNotes(dir, sampleAnswers());
    assert.ok(existsSync(file));
    assert.ok(file.endsWith(join('devos', 'KEYS-NOTES.example.md')));
    assert.ok(readFileSync(file, 'utf8').includes('Order Desk'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('keys: --check compares gh secret list with the catalog (injected runner)', () => {
  const answers = sampleAnswers();
  const setNames = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CURSOR_API_KEY'];
  const run = (cmd, args) => {
    assert.equal(cmd, 'gh');
    assert.deepEqual(args, ['secret', 'list', '--repo', 'octodev/order-desk', '--json', 'name']);
    return { code: 0, out: JSON.stringify(setNames.map((name) => ({ name }))), err: '' };
  };
  const result = checkKeys({ repo: 'octodev/order-desk', answers, run });
  assert.equal(result.ok, true);
  assert.equal(result.setCount, 3);
  assert.ok(result.missing.includes('SUPABASE_ACCESS_TOKEN'));
  assert.ok(!result.missing.includes('CLAUDE_CODE_OAUTH_TOKEN'));

  const fail = checkKeys({ repo: 'octodev/order-desk', answers, run: () => ({ code: 1, out: '', err: 'gh not logged in' }) });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /not logged in/);
});

test('recommendation: the strongest signed-in reasoning model is picked', () => {
  const agents = (list) => list.map(([toolId, models]) => ({
    toolId, status: 'installed',
    groups: [{ id: 'x', label: 'x', models: models.map((id) => ({ id, reported: false })) }],
  }));
  const both = recommendedConfiguration(agents([
    ['cursor', ['grok-4.7-xhigh', 'claude-fable-5-1', 'composer-2.5']],
    ['claude', ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']],
  ]));
  assert.deepEqual({ cli: both.cli, model: both.model }, { cli: 'claude', model: 'claude-fable-5-1' });

  const cursorOnly = recommendedConfiguration(agents([['cursor', ['grok-4.7', 'composer-2.5', 'claude-fable-5']]]));
  assert.equal(cursorOnly.model, 'claude-fable-5', 'fable on cursor beats grok');

  const geminiOnly = recommendedConfiguration(agents([['gemini', ['gemini-2.5-pro', 'gemini-4-argon']]]));
  assert.equal(geminiOnly.model, 'gemini-4-argon');

  assert.equal(recommendedConfiguration(agents([['glm', ['glm-4.6']]])).model, 'glm-4.6');
  assert.equal(recommendedConfiguration([]), null);
});

test('docs: attached documents travel through answers into devos/intake-docs/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devos-docs-'));
  try {
    const draft = { ...sampleAnswers(), project: { ...sampleAnswers().project, docs: [
      { name: 'spec.md', size: 12, content: '# Spec\nPhone orders first.' },
      { name: '../evil.md', size: 5, content: 'nope' },
      { name: '', size: 4, content: 'drop me' },
    ] } };
    const answers = finalizeAnswers(draft);
    assert.equal(answers.project.docs.length, 2, 'empty-name doc dropped');
    assert.equal(answers.project.docs[0].name, 'spec.md');
    assert.equal(answers.project.docs[1].name, '..-evil.md', 'path parts flattened');
    const n = writeIntakeDocs(dir, answers.project.docs);
    assert.equal(n, 2);
    const written = readdirSync(join(dir, 'devos', 'intake-docs'));
    assert.deepEqual(written.sort(), ['-evil.md', 'spec.md'], 'leading dots stripped on write');
    assert.equal(writeIntakeDocs(dir, null), 0, 'no docs is a no-op');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('docs: the configuration prompt points at intake-docs and OPEN_QUESTIONS only when docs exist', () => {
  const withDocs = buildConfigPrompt({
    answers: { ...sampleAnswers(), project: { ...sampleAnswers().project, docs: [{ name: 'spec.md', content: '# Spec' }] } },
    answersPath: '/x/devos/answers.json',
    projectDir: '/proj',
    payloadDir: '/payload',
  });
  assert.ok(withDocs.includes('REFERENCE DOCUMENTATION'));
  assert.ok(withDocs.includes('devos/intake-docs/spec.md'));
  assert.ok(withDocs.includes('devos/OPEN_QUESTIONS.md'));
  assert.ok(withDocs.includes('the answers win'));

  const withoutDocs = buildConfigPrompt({
    answers: sampleAnswers(),
    answersPath: '/x/devos/answers.json',
    projectDir: '/proj',
    payloadDir: '/payload',
  });
  assert.ok(!withoutDocs.includes('REFERENCE DOCUMENTATION'));
});

test('docs: the bootstrap guard demands OPEN_QUESTIONS.md when documentation was attached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devos-guard-'));
  try {
    mkdirSync(join(dir, 'devos'), { recursive: true });
    const answers = { ...sampleAnswers(), project: { ...sampleAnswers().project, docs: [{ name: 'spec.md', content: '# Spec' }] } };
    const report = validateBootstrap(dir, answers).report;
    assert.ok(report.some((l) => l.includes('OPEN_QUESTIONS')), `guard reports OPEN_QUESTIONS: ${report.join(' | ')}`);
    writeFileSync(join(dir, 'devos', 'OPEN_QUESTIONS.md'), 'No open questions.');
    const report2 = validateBootstrap(dir, answers).report;
    assert.ok(!report2.some((l) => l.includes('OPEN_QUESTIONS')), 'written file clears the problem');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('docs: collectDocs reads text files from a folder, skips binaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devos-collect-'));
  try {
    writeFileSync(join(dir, 'a.md'), '# A');
    writeFileSync(join(dir, 'b.txt'), 'notes');
    writeFileSync(join(dir, 'c.pdf'), '%PDF-1.4 fake');
    writeFileSync(join(dir, 'd.json'), '{"price": 9}');
    const out = collectDocs(dir);
    assert.deepEqual(out.docs.map((d) => d.name).sort(), ['a.md', 'b.txt', 'd.json']);
    assert.ok(out.skipped.some((s) => s.includes('c.pdf')));
    assert.equal(collectDocs(join(dir, 'a.md')).docs.length, 1, 'a single file path works');
    assert.equal(collectDocs(join(dir, 'nope.md')).errors.length, 1, 'missing path reports an error');
    assert.equal(collectDocs('').docs.length, 0, 'empty input is a no-op');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('logo: block-glyph wordmark, plain when the stream is not a TTY', () => {
  const plain = renderLogo({ isTTY: false });
  assert.ok(plain.includes('██████╗'), 'the wordmark is drawn');
  assert.ok(plain.includes('build once here'), 'tagline present');
  assert.ok(!plain.includes('\x1b['), 'no escape codes without a TTY');
  assert.ok(!plain.includes('D E V'), 'letters are joined, not spaced');
});
