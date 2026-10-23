import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestEnv, cleanupTestEnv, saasDraft, fakeLogEntries } from './helpers.mjs';

async function fresh() {
  const t = makeTestEnv({});
  const { runInit } = await import('../lib/init.mjs');
  const { finalizeAnswers } = await import('../lib/answers.mjs');
  const { auditSetup, printVerify, remainingSteps, buildRepairPrompt, resolveProjectFolder } = await import('../lib/verify.mjs');
  const { runFix } = await import('../lib/fix.mjs');
  const { keyCatalog } = await import('../lib/keys.mjs');
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  return { t, runInit, finalizeAnswers, auditSetup, printVerify, remainingSteps, buildRepairPrompt, resolveProjectFolder, runFix, keyCatalog, mkdirSync, writeFileSync, existsSync, join };
}

function halfWrittenProject(t, answers, mkdirSync, writeFileSync, join) {
  const projectDir = join(t.workspace, 'half-written');
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify(answers, null, 2));
  return projectDir;
}

test('verify: machine and GitHub sections are ready with healthy fakes; a Claude weekly limit reads as a usage limit', async () => {
  const { t, auditSetup } = await fresh();
  const audit = auditSetup({});
  assert.equal(audit.ready, true, audit.rows.filter((r) => r.state === 'block').map((r) => r.label).join(' | '));
  const labels = audit.rows.map((r) => `${r.section}/${r.label}`);
  assert.ok(labels.some((l) => l.startsWith('machine/Node')), labels.join(','));
  assert.ok(labels.some((l) => l === 'github/gh login'), labels.join(','));
  const login = audit.rows.find((r) => r.label === 'gh login');
  assert.ok(login.detail.includes('octodev'), login.detail);
  const cursorRow = audit.rows.find((r) => r.section === 'agents' && r.label === 'Cursor CLI');
  assert.ok(cursorRow && cursorRow.state === 'ok', JSON.stringify(cursorRow));
  const { looksLikeUsageLimit } = await import('../lib/adapters.mjs');
  assert.equal(looksLikeUsageLimit("You've hit your weekly usage limit. Your limit will reset on Monday."), true);
  assert.equal(looksLikeUsageLimit('limit resets on Oct 30'), true);
  assert.equal(looksLikeUsageLimit('all tests passed'), false);
  cleanupTestEnv(t);
});

test('verify: a chosen Cursor model the account does not report raises a warn row with the account-switch fix', async () => {
  const { t, finalizeAnswers, auditSetup } = await fresh();
  process.env.DEVOS_FAKE_MODELS = 'auto\ngrok-4.7';
  const answers = finalizeAnswers(saasDraft());
  answers.models.configurationModel = { cli: 'cursor', model: 'grok-4.7-xhigh' };
  const audit = auditSetup({ answers });
  delete process.env.DEVOS_FAKE_MODELS;
  const row = audit.rows.find((r) => r.label === 'Cursor model "grok-4.7-xhigh"');
  assert.ok(row, audit.rows.map((r) => r.label).join(' | '));
  assert.equal(row.state, 'warn');
  assert.equal(row.who, 'you');
  assert.ok(row.fix.includes('logout'), row.fix);
  assert.ok(row.fix.includes('login'), row.fix);
  assert.ok(row.fix.includes('--model auto'), row.fix);
  assert.ok(row.detail.includes('Named models unavailable'), row.detail);
  cleanupTestEnv(t);
});

test('verify: a completed model run proves availability — the "unverified — you fix" row clears itself', async () => {
  const { t, finalizeAnswers, auditSetup, mkdirSync, writeFileSync, join } = await fresh();
  const answers = finalizeAnswers(saasDraft());
  answers.models.configurationModel = { cli: 'cursor', model: 'grok-4.7-high' };
  const projectDir = halfWrittenProject(t, answers, mkdirSync, writeFileSync, join);
  // The models probe errors out exactly like the user's Cursor build: no answer,
  // so availability is unverified and the row is a warn on you.
  process.env.DEVOS_AGENT_MODELS_FAIL = '1';
  const before = auditSetup({ projectDir, answers }).rows.find((r) => r.label === 'Cursor model "grok-4.7-high"');
  assert.ok(before, 'the availability row exists');
  assert.equal(before.state, 'warn', JSON.stringify(before));
  assert.equal(before.who, 'you');
  assert.ok(before.detail.includes('unverified'), before.detail);
  // The engine records proof after any completed model run (devos/state/model-run.json):
  // the CLI exited 0 while driving this exact model — practice outranks the missing list.
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(join(projectDir, 'devos', 'state', 'model-run.json'), JSON.stringify({ cli: null, model: 'grok-4.7-high', at: new Date().toISOString() }, null, 2));
  const after = auditSetup({ projectDir, answers }).rows.find((r) => r.label === 'Cursor model "grok-4.7-high"');
  assert.equal(after.state, 'ok', JSON.stringify(after));
  assert.ok(after.detail.includes('verified in practice'), after.detail);
  assert.ok(!after.fix, 'a verified model carries no fix instruction');
  delete process.env.DEVOS_AGENT_MODELS_FAIL;
  cleanupTestEnv(t);
});

test('verify: a half-written project lists guard problems as model-fixable and the missing repository as devos work', async () => {
  const { t, finalizeAnswers, auditSetup, mkdirSync, writeFileSync, join } = await fresh();
  const answers = finalizeAnswers(saasDraft());
  const projectDir = halfWrittenProject(t, answers, mkdirSync, writeFileSync, join);
  const audit = auditSetup({ projectDir, answers });
  const guardRow = audit.rows.find((r) => r.label === 'Bootstrap guards');
  assert.equal(guardRow.state, 'block');
  assert.equal(guardRow.who, 'model');
  assert.ok(guardRow.fix.startsWith('devos fix'), guardRow.fix);
  const repoRow = audit.rows.find((r) => r.label === 'GitHub repository');
  assert.equal(repoRow.state, 'block');
  assert.equal(repoRow.who, 'devos', 'devos continue finishes init_github itself now');
  assert.ok(repoRow.fix.includes('devos continue'), repoRow.fix);
  assert.ok(audit.modelSteps.length >= 1);
  assert.ok(!audit.youSteps.some((r) => r.label === 'GitHub repository'), 'the repository is no longer a manual step');
  assert.equal(audit.ready, false);
  cleanupTestEnv(t);
});

test('verify: after a full init the guards pass; with every secret set the audit is ready, without them the fix is yours', async () => {
  const { t, runInit, finalizeAnswers, auditSetup, keyCatalog } = await fresh();
  const { result, projectDir, answers } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(result.ok, true, result.message || '');
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(answers).map((k) => k.name).join(' ');
  const readyAudit = auditSetup({ projectDir, answers });
  const secretOk = readyAudit.rows.find((r) => r.label === 'GitHub secrets');
  assert.ok(secretOk && secretOk.state === 'ok', JSON.stringify(secretOk));
  assert.ok(readyAudit.rows.some((r) => r.label === 'Bootstrap guards' && r.state === 'ok'));
  assert.ok(readyAudit.rows.some((r) => r.label === 'First cycle run'));
  assert.equal(readyAudit.ready, true, readyAudit.rows.filter((r) => r.state === 'block').map((r) => `${r.label}: ${r.detail}`).join(' | '));

  delete process.env.DEVOS_FAKE_GH_SECRETS;
  const missingAudit = auditSetup({ projectDir, answers });
  const secretRow = missingAudit.rows.find((r) => r.label.startsWith('GitHub secrets'));
  assert.equal(secretRow.state, 'block');
  assert.equal(secretRow.who, 'you');
  assert.ok(secretRow.fix.includes('devos/secrets.local.json'), secretRow.fix);
  assert.ok(secretRow.fix.includes('devos keys --push'), secretRow.fix);
  assert.equal(missingAudit.ready, false);
  cleanupTestEnv(t);
});

test('verify: a repository the gh login cannot see is a blocker with a safe fix', async () => {
  const { t, runInit, finalizeAnswers, auditSetup, keyCatalog } = await fresh();
  const { projectDir, answers } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  process.env.DEVOS_FAKE_GH_SECRETS = keyCatalog(answers).map((k) => k.name).join(' ');
  process.env.DEVOS_GH_REPO_MISSING = '1';
  const audit = auditSetup({ projectDir, answers });
  delete process.env.DEVOS_GH_REPO_MISSING;
  delete process.env.DEVOS_FAKE_GH_SECRETS;
  const vis = audit.rows.find((r) => r.label === 'Repository visibility');
  assert.ok(vis, audit.rows.map((r) => r.label).join(' | '));
  assert.equal(vis.state, 'block');
  assert.equal(vis.who, 'you');
  assert.ok(vis.fix.includes('gh auth status'), vis.fix);
  cleanupTestEnv(t);
});

test('fix: with nothing model-fixable the model is never invoked', async () => {
  const { t, runInit, runFix, keyCatalog } = await fresh();
  const { result, projectDir, answers } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  assert.equal(result.ok, true);
  const promptInvocations = () => fakeLogEntries(t.fakeLog).filter((e) => (e.argv || []).includes('-p') || (e.argv || []).includes('exec')).length;
  const before = promptInvocations();
  const out = await runFix({ projectDir });
  assert.equal(out.modelRan, false);
  assert.equal(promptInvocations(), before, 'no model run when nothing is model-fixable');
  assert.ok(out.message.includes('Nothing here needs the model'), out.message);
  // secrets are still missing, so the report names them as YOUR steps
  assert.ok(out.after.youSteps.some((r) => r.label.startsWith('GitHub secrets')));
  void keyCatalog;
  cleanupTestEnv(t);
});

test('fix: a half-written bootstrap is repaired end to end by the model, then re-audited', async () => {
  const { t, finalizeAnswers, runFix, mkdirSync, writeFileSync, existsSync, join } = await fresh();
  const answers = finalizeAnswers(saasDraft());
  const projectDir = halfWrittenProject(t, answers, mkdirSync, writeFileSync, join);
  const out = await runFix({ projectDir });
  assert.equal(out.modelRan, true);
  assert.equal(out.result.ok, true, out.message || '');
  assert.ok(out.before.modelSteps.length >= 1, 'guards were model-fixable before');
  assert.equal(out.after.modelSteps.length, 0, 'no model-fixable problems after the repair');
  assert.equal(out.ok, true);
  assert.equal(existsSync(join(projectDir, '.github/workflows/devos-cycle.yml')), true, 'the model wrote the automation');
  assert.equal(existsSync(join(projectDir, 'package.json')), true);
  const prompt = (await import('node:fs')).readFileSync(join(projectDir, 'devos', 'state', 'config-prompt.md'), 'utf8');
  assert.ok(prompt.includes('Problems to fix'), prompt.slice(0, 400));
  assert.ok(prompt.includes('Bootstrap guards'), 'the prompt carries the audit problems');
  cleanupTestEnv(t);
});

test('fix: a usage limit during the repair pass is a wait, not a crash', async () => {
  const { t, finalizeAnswers, runFix, mkdirSync, writeFileSync, join } = await fresh();
  process.env.DEVOS_FAKE_MODE = 'usage-limit';
  const answers = finalizeAnswers(saasDraft());
  const projectDir = halfWrittenProject(t, answers, mkdirSync, writeFileSync, join);
  const out = await runFix({ projectDir });
  delete process.env.DEVOS_FAKE_MODE;
  assert.equal(out.modelRan, true);
  assert.equal(out.result.usageLimit, true);
  assert.ok(out.result.message.toLowerCase().includes('usage limit'), out.result.message);
  assert.equal(out.ok, false);
  cleanupTestEnv(t);
});

test('fix: the repair prompt carries model rows and never secret steps', async () => {
  const { t, runInit, auditSetup, buildRepairPrompt, keyCatalog } = await fresh();
  const { projectDir, answers } = await runInit({ draft: saasDraft(), home: t.home, workspace: t.workspace, emit: () => {} });
  // secrets deliberately not set: their rows are yours and must stay out of any prompt
  const audit = auditSetup({ projectDir, answers });
  assert.ok(audit.youSteps.some((r) => r.label.startsWith('GitHub secrets')));
  const prompt = buildRepairPrompt({ projectDir, answers, audit });
  // The real policy: no secret NAME and no secret row ever enters a model prompt.
  for (const k of keyCatalog(answers)) assert.ok(!prompt.includes(k.name), `secret name ${k.name} leaked into the prompt`);
  assert.ok(!prompt.includes('GitHub secrets'), 'secret rows never enter a model prompt');
  assert.ok(prompt.includes('Do NOT invent, print, or move any secret value'));
  cleanupTestEnv(t);
});

test('verify: report text, remaining steps, and folder resolution', async () => {
  const { t, finalizeAnswers, auditSetup, printVerify, remainingSteps, resolveProjectFolder, mkdirSync, writeFileSync, join } = await fresh();
  const answers = finalizeAnswers(saasDraft());
  const projectDir = halfWrittenProject(t, answers, mkdirSync, writeFileSync, join);
  const audit = auditSetup({ projectDir, answers });
  const text = printVerify(audit);
  assert.ok(text.includes('STOP'), text);
  assert.ok(text.includes('model fixes (devos fix)'), text);
  assert.ok(text.includes('devos handles it'), text);
  assert.ok(text.includes('Not ready'));
  const steps = remainingSteps(audit);
  assert.ok(steps.length >= 2);
  for (const s of steps) {
    assert.ok(['you', 'model', 'devos', null].includes(s.who), JSON.stringify(s));
    assert.ok(s.label && s.detail);
  }
  assert.equal(resolveProjectFolder([projectDir], t.home, t.workspace), projectDir);
  cleanupTestEnv(t);
});
