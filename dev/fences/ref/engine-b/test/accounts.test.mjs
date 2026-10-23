import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';

test('accounts: ghPreflight reads the login, scopes, and verifies the token against the API', async () => {
  const t = makeTestEnv({});
  const { ghPreflight } = await import('../lib/accounts.mjs');
  const pf = ghPreflight();
  assert.equal(pf.signedIn, true);
  assert.equal(pf.login, 'octodev');
  assert.ok(pf.scopes.includes('repo'), `scopes: ${pf.scopes}`);
  assert.ok(pf.scopes.includes('workflow'), `scopes: ${pf.scopes}`);
  assert.equal(pf.tokenWorks, true);
  assert.equal(pf.ok, true, pf.problems.join(' | '));
  cleanupTestEnv(t);
});

test('accounts: a token missing the workflow scope blocks with the exact refresh fix', async () => {
  const t = makeTestEnv({});
  process.env.DEVOS_GH_MISSING_SCOPES = '1';
  const { ghPreflight } = await import('../lib/accounts.mjs');
  const pf = ghPreflight();
  delete process.env.DEVOS_GH_MISSING_SCOPES;
  assert.equal(pf.ok, false);
  assert.ok(pf.problems.join(' ').includes('workflow'), pf.problems.join(' | '));
  assert.ok(pf.fixes.join(' ').includes('gh auth refresh'), pf.fixes.join(' | '));
  cleanupTestEnv(t);
});

test('accounts: a token rejected by the API is a problem even when auth status looks fine', async () => {
  const t = makeTestEnv({});
  process.env.DEVOS_GH_BAD_TOKEN = '1';
  const { ghPreflight } = await import('../lib/accounts.mjs');
  const pf = ghPreflight();
  delete process.env.DEVOS_GH_BAD_TOKEN;
  assert.equal(pf.signedIn, true);
  assert.equal(pf.tokenWorks, false);
  assert.equal(pf.ok, false);
  assert.ok(pf.fixes.join(' ').includes('gh auth login'), pf.fixes.join(' | '));
  cleanupTestEnv(t);
});

test('accounts: machineCheck shows the gh login and scopes on the gh row', async () => {
  const t = makeTestEnv({});
  const { machineCheck } = await import('../lib/doctor.mjs');
  const c = machineCheck();
  const ghRow = c.rows.find((r) => r.label === 'gh');
  assert.equal(ghRow.state, 'ready');
  assert.ok(ghRow.detail.includes('octodev'), ghRow.detail);
  assert.ok(ghRow.detail.includes('workflow'), ghRow.detail);
  assert.equal(c.ready, true, c.blocks.join(' | '));
  cleanupTestEnv(t);
});

test('accounts: cursor reports its account and plan; available models sort first', async () => {
  const t = makeTestEnv({});
  const { detectAgents } = await import('../lib/probes.mjs');
  const cursor = detectAgents().find((a) => a.toolId === 'cursor');
  assert.equal(cursor.account.signedIn, true);
  assert.equal(cursor.account.email, 'marco@example.com');
  assert.equal(cursor.account.plan, 'pro');
  // grok-4.7 is both seeded and reported by the fake CLI: available:true, but the
  // seeded `reported` flag stays false (it means "only exists because the CLI said so").
  const grok = cursor.groups.find((g) => g.id === 'grok');
  const first = grok.models[0];
  assert.equal(first.available, true, 'reported models are marked available');
  const claudeGroup = cursor.groups.find((g) => g.id === 'claude');
  assert.equal(claudeGroup.models.some((m) => m.available), true, 'claude-sonnet-5-5 is reported by the fake CLI');
  assert.equal(claudeGroup.models.some((m) => !m.available), true, 'unreported seeds keep available:false');
  cleanupTestEnv(t);
});

test('accounts: an unreadable account probe degrades to unknown, never a guess', async () => {
  const t = makeTestEnv({});
  const { clearAccountCache } = await import('../lib/accounts.mjs');
  clearAccountCache(); // earlier tests in this process already probed with a healthy fake
  process.env.DEVOS_AGENT_STATUS_FAIL = '1';
  const { detectAgents } = await import('../lib/probes.mjs');
  const cursor = detectAgents().find((a) => a.toolId === 'cursor');
  delete process.env.DEVOS_AGENT_STATUS_FAIL;
  assert.equal(cursor.account.signedIn, 'unknown');
  assert.equal(cursor.account.email, null);
  cleanupTestEnv(t);
});

test('accounts: parseAccountText picks email and plan variants', async () => {
  const { parseAccountText } = await import('../lib/accounts.mjs');
  assert.equal(parseAccountText('Signed in as a.b+x@sub.example.co.uk (Pro plan)').email, 'a.b+x@sub.example.co.uk');
  assert.equal(parseAccountText('Signed in as a.b+x@sub.example.co.uk (Pro plan)').plan, 'pro');
  assert.equal(parseAccountText('plan: Ultra').plan, 'ultra');
  assert.equal(parseAccountText('Logged in using ChatGPT\nAccount: dev@x.io (Pro)').email, 'dev@x.io');
  assert.equal(parseAccountText('no info here').plan, null);
  assert.equal(parseAccountText('no info here').email, null);
});
