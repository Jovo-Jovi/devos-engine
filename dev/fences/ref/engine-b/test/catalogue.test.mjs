import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft } from './helpers.mjs';
import { loadCatalogue, loadStack } from '../lib/catalogue.mjs';

test('catalogue: 16 types, every framework, all 16 modules', () => {
  const c = loadCatalogue();
  const typeIds = ['saas', 'web-app', 'marketing', 'dashboard', 'marketplace', 'commerce', 'api', 'mobile', 'ai-product', 'realtime', 'docs', 'cli', 'library', 'worker', 'extension', 'full'];
  assert.deepEqual(c.types.map((t) => t.id), typeIds);
  assert.equal(c.modules.length, 16);
  const moduleIds = ['language', 'styling', 'ui-kit', 'database', 'auth', 'storage', 'payments', 'email', 'jobs', 'search', 'product-ai', 'i18n', 'testing', 'hosting', 'observability', 'automation'];
  assert.deepEqual(c.modules.map((m) => m.id), moduleIds);
  for (const fw of c.frameworks) {
    const s = loadStack(fw);
    assert.ok(s, `stack file payload/stacks/${fw}.json missing`);
    for (const cmd of ['install', 'typecheck', 'lint', 'test', 'build']) {
      assert.equal(typeof s.commands[cmd], 'string', `${fw} missing ${cmd}`);
    }
    assert.ok(Array.isArray(s.fits) && s.fits.length, `${fw} has no fits`);
  }
});

test('catalogue: web-app fits web stacks; firebase pairs across database, auth, and storage; payments has more than one', () => {
  const c = loadCatalogue();
  const mod = (id) => c.modules.find((m) => m.id === id);
  // Web app: the web frameworks fit it, docs-only Starlight does not.
  for (const fw of ['next', 'nuxt', 'sveltekit', 'remix', 'astro', 'vite-react', 'vite-vue', 'solid']) {
    const s = loadStack(fw);
    assert.ok(s.fits.includes('web-app'), `${fw} should fit web-app`);
  }
  assert.equal(loadStack('starlight').fits.includes('web-app'), false, 'starlight stays docs-only');
  assert.equal(loadStack('expo').fits.includes('web-app'), false, 'expo stays mobile');
  // Firebase: database provider, auth implementation, storage provider.
  assert.ok(mod('database').providers.some((p) => p.id === 'firebase'), 'firebase database provider');
  assert.ok(mod('auth').implProviders.some((p) => p.id === 'firebase-auth'), 'firebase auth implementation');
  assert.ok(mod('storage').providers.some((p) => p.id === 'firebase-storage'), 'firebase storage provider');
  assert.ok(mod('storage').providers.some((p) => p.id === 'supabase-storage'), 'supabase storage provider');
  // Supabase and Firebase providers carry needs so the UI can gate them.
  assert.equal(mod('storage').providers.find((p) => p.id === 'supabase-storage').needs, 'supabase');
  assert.equal(mod('auth').implProviders.find((p) => p.id === 'firebase-auth').needs, 'firebase');
  // Payments: more than one paid provider.
  const paid = mod('payments').providers.filter((p) => p.id !== 'none');
  assert.ok(paid.length > 1, `payments needs several providers, has ${paid.map((p) => p.id).join(',')}`);
  assert.deepEqual(paid.map((p) => p.id), ['stripe', 'paddle', 'lemonsqueezy', 'paypal', 'revenuecat']);
});

test('wizard: firebase auth and storage refuse without the firebase database; supabase storage refuses without supabase', async () => {
  const { validateModules } = await import('../lib/wizard.mjs');
  const d = saasDraft();
  d.modules.database = { on: true, provider: 'firebase' };
  d.modules.auth = { on: true, provider: 'email', impl: 'firebase-auth' };
  d.modules.storage = { on: true, provider: 'firebase-storage' };
  assert.equal(validateModules(d).ok, true, 'firebase pairs are valid together');
  const d2 = saasDraft(); // supabase database
  d2.modules.storage = { on: true, provider: 'firebase-storage' };
  assert.equal(validateModules(d2).ok, false, 'firebase storage needs the firebase database');
  const d3 = saasDraft();
  d3.modules.database = { on: true, provider: 'firebase' };
  d3.modules.auth = { on: true, provider: 'email', impl: 'supabase-auth' };
  assert.equal(validateModules(d3).ok, false, 'supabase auth needs the supabase database');
  // Postgres full text search accepts the generic postgres host too.
  const d4 = saasDraft();
  d4.modules.database = { on: true, provider: 'postgres' };
  d4.modules.search = { on: true, provider: 'postgres-fts' };
  assert.equal(validateModules(d4).ok, true, 'postgres-fts works with generic postgres');
  // And still refuses without a Postgres database.
  const d5 = saasDraft();
  d5.modules.database = { on: true, provider: 'mongodb' };
  d5.modules.search = { on: true, provider: 'postgres-fts' };
  assert.equal(validateModules(d5).ok, false, 'postgres-fts needs Postgres');
});

test('wizard: reviewer and builder lists are GitHub-capable only; configuration model may be local-only', async () => {
  const { reviewerOptions, builderOptions, configurationModelOptions, modelsReadiness, selfGradingWarning } = await import('../lib/wizard.mjs');
  const agents = [
    { toolId: 'claude', label: 'Claude Code', status: 'installed', githubCapable: true, promptTemplate: 'claude -p' },
    { toolId: 'cursor', label: 'Cursor CLI', status: 'installed', githubCapable: true, promptTemplate: 'agent -p' },
    { toolId: 'local-only', label: 'Local Tool', status: 'installed', githubCapable: false, promptTemplate: null },
  ];
  const ghIds = reviewerOptions(agents).map((a) => a.toolId);
  assert.deepEqual(ghIds, ['claude', 'cursor']);
  assert.deepEqual(builderOptions(agents).map((a) => a.toolId), ['claude', 'cursor']);
  assert.deepEqual(configurationModelOptions(agents).map((a) => a.toolId), ['claude', 'cursor', 'local-only']);
});

test('wizard: Next stays disabled until reviewer, builder, and configuration model rows are complete', async () => {
  const { modelsReadiness } = await import('../lib/wizard.mjs');
  const d = saasDraft();
  assert.equal(modelsReadiness(d).ready, true);
  const d2 = saasDraft();
  d2.models.builder = { cli: 'agent', model: null };
  const r = modelsReadiness(d2);
  assert.equal(r.ready, false);
  assert.ok(r.problems.join(' ').includes('builder'));
  const d3 = saasDraft();
  d3.models.configurationModel = { cli: null, model: null };
  assert.equal(modelsReadiness(d3).ready, false);
  const d4 = saasDraft();
  d4.models.extraBuilders.push({ cli: null, model: null, strength: 'ui' });
  assert.equal(modelsReadiness(d4).ready, false);
});

test('wizard: builder equal to reviewer warns but does not block', async () => {
  const { selfGradingWarning } = await import('../lib/wizard.mjs');
  const d = saasDraft();
  d.models.builder = { cli: 'claude', model: 'claude-opus-5-5' };
  assert.equal(selfGradingWarning(d), 'This model would be grading its own work. You can continue.');
});

test('wizard: light reviewer defaults to same as the reviewer; pick policy defaults to reviewer picks', () => {
  const d = saasDraft();
  assert.equal(d.models.lightReviewer.same, true);
  assert.equal(d.models.pickPolicy, 'reviewer-picks');
});

test('answers: before confirm no project folder exists; answer file carries no secrets', async () => {
  const t = {};
  makeTestEnv(t);
  const { finalizeAnswers, writeAnswers, assertNoSecrets } = await import('../lib/answers.mjs');
  const { createProjectFolder } = await import('../lib/init.mjs');
  const { existsSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const answers = finalizeAnswers(saasDraft());
  assertNoSecrets(answers);
  const p = writeAnswers(t.home, answers);
  assert.ok(p.includes(t.home), 'answer file lives under ~/.devos');
  assert.equal(existsSync(join(t.workspace, 'order-desk')), false, 'no project folder before confirm');

  const dir = createProjectFolder(t.workspace, 'octodev/order-desk'); // confirm is the first moment
  assert.equal(existsSync(dir), true);
  cleanupTestEnv(t);
});

test('answers: required secrets match the reviewer tool, the builder tool, and active modules only', async () => {
  const { requiredSecretNames } = await import('../lib/wizard.mjs');
  const d = saasDraft(); // reviewer claude, builder agent(cursor), supabase+auth+email+vercel on
  const names = requiredSecretNames(d, []);
  assert.ok(names.includes('CLAUDE_CODE_OAUTH_TOKEN') || names.includes('ANTHROPIC_API_KEY'), 'reviewer secret present');
  assert.ok(names.includes('CURSOR_API_KEY'), 'builder secret present');
  assert.ok(names.includes('SUPABASE_ACCESS_TOKEN'));
  assert.ok(names.includes('RESEND_API_KEY'));
  assert.ok(names.includes('VERCEL_TOKEN'));

  // A Claude-only reviewer and builder do not require CURSOR_API_KEY.
  const d2 = saasDraft();
  d2.models.builder = { cli: 'claude', model: 'claude-sonnet-5-5' };
  const names2 = requiredSecretNames(d2, []);
  assert.ok(!names2.includes('CURSOR_API_KEY'));

  // A Cursor-only reviewer and builder do not require a Claude token.
  const d3 = saasDraft();
  d3.models.reviewer = { cli: 'agent', model: 'grok-4.7' };
  const names3 = requiredSecretNames(d3, []);
  assert.ok(!names3.includes('CLAUDE_CODE_OAUTH_TOKEN') && !names3.includes('ANTHROPIC_API_KEY'));

  // Hosting none does not ask for a host token.
  const d4 = saasDraft();
  d4.modules.hosting = { on: false, provider: 'none' };
  const names4 = requiredSecretNames(d4, []);
  assert.ok(!names4.includes('VERCEL_TOKEN'));
});

test('answers: save defaults stores model ids only', async () => {
  const t = {};
  makeTestEnv(t);
  const { saveDefaults, readDefaults } = await import('../lib/answers.mjs');
  saveDefaults(t.home, saasDraft());
  const defaults = readDefaults(t.home);
  assert.equal(defaults.models.reviewer.model, 'claude-opus-5-5');
  assert.equal(defaults.visibility, 'private');
  const text = JSON.stringify(defaults);
  assert.ok(!/sk_live|BEGIN.*PRIVATE KEY/i.test(text));
  cleanupTestEnv(t);
});

test('answers: visibility defaults from the machine profile, otherwise private', async () => {
  const { defaultDraft } = await import('../lib/answers.mjs');
  assert.equal(defaultDraft(null).project.visibility, 'private');
  assert.equal(defaultDraft({ visibility: 'public' }).project.visibility, 'public');
});
