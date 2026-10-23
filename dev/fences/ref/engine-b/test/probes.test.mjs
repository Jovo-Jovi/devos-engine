import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv } from './helpers.mjs';

test('probes: cursor subgroups appear from seeds plus reported ids; reported ids are labeled', async () => {
  makeTestEnv({});
  const { detectAgents } = await import('../lib/probes.mjs');
  const agents = detectAgents();
  const cursor = agents.find((a) => a.toolId === 'cursor');
  assert.equal(cursor.status, 'installed');
  assert.equal(cursor.githubCapable, true);
  const groupIds = cursor.groups.map((g) => g.id);
  for (const fam of ['grok', 'claude', 'gpt', 'gemini', 'composer', 'other']) {
    assert.ok(groupIds.includes(fam), `cursor groups must include ${fam}: ${groupIds.join(',')}`);
  }
  const grok = cursor.groups.find((g) => g.id === 'grok');
  assert.ok(grok.models.some((m) => m.id === 'grok-4.7' && !m.reported), 'grok-4.7 is seeded');
  const claudeOnCursor = cursor.groups.find((g) => g.id === 'claude');
  assert.ok(claudeOnCursor.models.some((m) => m.id === 'claude-fable-5-1' && !m.reported), 'claude-fable-5-1 is seeded on cursor');
  const composer = cursor.groups.find((g) => g.id === 'composer');
  assert.ok(composer.models.some((m) => m.id === 'composer-2.5' && !m.reported), 'composer-2.5 is seeded');
  const other = cursor.groups.find((g) => g.id === 'other');
  assert.ok(other.models.some((m) => m.id === 'weird-model-9' && m.reported), 'unseeded ids appear labeled reported by the CLI');
  // Every offered id comes from the seed or from the CLI's own report: never invented.
  const offered = cursor.groups.flatMap((g) => g.models.map((m) => m.id));
  const { readFileSync } = await import('node:fs');
  const cat = JSON.parse(readFileSync(new URL('../payload/catalogue.json', import.meta.url), 'utf8'));
  const seeded = cat.tools.find((t) => t.id === 'cursor').seedGroups.flatMap((g) => g.models);
  assert.deepEqual(offered.filter((id) => !seeded.includes(id)), ['gpt-5.1', 'gemini-2.5-pro', 'weird-model-9']);
});

test('probes: claude seeds used when the CLI accepts them; signed-in detection works', async () => {
  makeTestEnv({});
  const { detectAgents } = await import('../lib/probes.mjs');
  const claude = detectAgents().find((a) => a.toolId === 'claude');
  assert.equal(claude.status, 'installed');
  assert.equal(claude.signedIn, true);
  const ids = claude.groups.flatMap((g) => g.models.map((m) => m.id));
  for (const seed of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
    assert.ok(ids.includes(seed), `claude seed ${seed} offered`);
  }
});

test('probes: codex and gemini are GitHub-capable; glm prints its ids', async () => {
  makeTestEnv({});
  const { detectAgents } = await import('../lib/probes.mjs');
  const agents = detectAgents();
  const codex = agents.find((a) => a.toolId === 'codex');
  assert.equal(codex.githubCapable, true);
  assert.deepEqual(codex.githubSecrets, ['OPENAI_API_KEY']);
  const gemini = agents.find((a) => a.toolId === 'gemini');
  assert.equal(gemini.githubCapable, true);
  const z = agents.find((a) => a.toolId === 'glm');
  assert.equal(z.status, 'installed');
  const zIds = z.groups.flatMap((g) => g.models.map((m) => m.id));
  assert.ok(zIds.includes('glm-4.6') && zIds.includes('glm-5'));
});

test('probes: Muse stays disabled when muse is absent; no invented Muse id appears', async () => {
  makeTestEnv({});
  const { detectAgents } = await import('../lib/probes.mjs');
  const muse = detectAgents().find((a) => a.toolId === 'muse');
  assert.equal(muse.status, 'missing');
  assert.equal(muse.notInstalledMessage, 'Muse is not installed');
  assert.equal(muse.groups.length, 0);
  assert.equal(muse.reportedIds.length, 0);
  const text = JSON.stringify(muse);
  assert.ok(!/muse-\d/.test(text), 'no invented Muse model id');
});

test('probes: a Muse that exists can list models; custom tool without prompt template is This computer only', async () => {
  const t = makeTestEnv({});
  // put muse on PATH
  const extra = t.home;
  const { writeFileSync, chmodSync } = await import('node:fs');
  const { join } = await import('node:path');
  const museSh = join(extra, 'muse');
  writeFileSync(museSh, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "muse 0.9"; exit 0; fi\nif [ "$1" = "models" ]; then printf "muse-1\\nmuse-2\\n"; exit 0; fi\nexit 1\n');
  chmodSync(museSh, 0o755);
  process.env.PATH = `${extra}:${process.env.PATH}`;
  const { detectAgents, customAgent } = await import('../lib/probes.mjs');
  const muse = detectAgents().find((a) => a.toolId === 'muse');
  assert.equal(muse.status, 'installed');
  // CLI-reported ids (muse-1, muse-2) sort ahead of the seed (muse-wonder): what the
  // account can actually run comes first in every dropdown.
  assert.deepEqual(muse.groups.flatMap((g) => g.models.map((m) => m.id)), ['muse-1', 'muse-2', 'muse-wonder']);

  const localOnly = customAgent({ command: 'mytool', displayName: 'My Tool' });
  assert.equal(localOnly.localOnly, true);
  assert.equal(localOnly.githubCapable, false);
  cleanupTestEnv(t);
});
