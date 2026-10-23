// Headless UI smoke for the continue card: a started project near the workspace
// (tree written, commands were rejected, repo created by hand) must surface the
// resume view with its checklist; clicking Continue runs the smart resume to the
// final card; a reload lands back on it. Run: node scripts/ui-resume-smoke.mjs
import { chromium } from 'playwright';
import { startServer } from '../lib/server.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'bin');
process.env.PATH = `${fixtures}:${process.env.PATH}`;
process.env.DEVOS_FAKE_LOG = '/tmp/devos-ui-resume-smoke-fake.log';
process.env.DEVOS_GIT_FAKE_PUSH = '1'; // the network verbs are virtualized in the smoke
process.env.DEVOS_GH_STATE = '/tmp/devos-ui-resume-gh-state.json'; // gh secret set/list remember each other

const home = '/tmp/devos-ui-resume-home';
const ws = '/tmp/devos-ui-resume-ws';
rmSync(home, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });

// Build the started project directly: full answers + a copied bootstrap so the
// guards pass, no init state, no node_modules — exactly "already started".
const { finalizeAnswers } = await import('../lib/answers.mjs');
const { validateBootstrap } = await import('../lib/guards.mjs');
const { cpSync } = await import('node:fs');
const answers = finalizeAnswers({
  schema: 'devos/draft@1', theme: 'dark',
  models: {
    reviewer: { cli: 'claude', model: 'claude-fable-5-1' },
    builder: { cli: 'cursor', model: 'grok-4.7' },
    extraBuilders: [], lightReviewer: { same: true, cli: null, model: null },
    pickPolicy: 'reviewer-picks', configurationModel: { cli: 'cursor', model: 'grok-4.7' },
  },
  saveDefaults: false,
  project: { name: 'Order Desk', slug: 'octodev/order-desk', brief: 'A phone-order desk.', audience: 'Small shops', visibility: 'private', docs: [] },
  type: 'saas', framework: 'next',
  customCommands: { install: '', typecheck: '', lint: '', test: '', build: '', e2e: '' },
  modules: {
    language: { on: true, provider: 'typescript' }, styling: { on: true, provider: 'tailwind' },
    'ui-kit': { on: false, provider: 'none' }, database: { on: true, provider: 'supabase' },
    auth: { on: true, provider: 'email', impl: 'better-auth' }, storage: { on: false, provider: 'none' },
    payments: { on: false, provider: 'none' }, email: { on: true, provider: 'resend' },
    jobs: { on: false, provider: 'none' }, search: { on: false, provider: 'none' },
    'product-ai': { on: false, provider: 'none' }, i18n: { on: false },
    testing: { on: true, unit: true, playwright: true }, hosting: { on: true, provider: 'vercel' },
    observability: { on: false, provider: 'none' }, automation: { on: true, locked: true },
  },
  languages: ['en'], touched: { framework: false, modules: false },
});
const projectDir = join(ws, 'order-desk');
mkdirSync(join(projectDir, 'devos'), { recursive: true });
writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify(answers, null, 2));
// The bootstrap the model would have written: run the fixture writer with the
// answers in place, but WITHOUT the init_github call (mode no-github-reject).
const { spawnSync } = await import('node:child_process');
const payload = join(dirname(fileURLToPath(import.meta.url)), '..', 'payload');
const w = spawnSync(process.execPath, [join(fixtures, 'bootstrap-writer.mjs')], {
  env: { ...process.env, DEVOS_PROJECT_DIR: projectDir, DEVOS_ANSWERS: join(projectDir, 'devos', 'answers.json'), DEVOS_PAYLOAD: payload, DEVOS_FAKE_MODE: 'no-github-reject' },
  encoding: 'utf8',
});
if (w.status !== 0) { console.error('bootstrap-writer failed:', w.stderr); process.exit(1); }
const guard = validateBootstrap(projectDir, answers, { engineRoot: join(dirname(fileURLToPath(import.meta.url)), '..') });
if (!guard.ok) { console.error('fixture tree fails guards:', guard.report.slice(0, 4)); process.exit(1); }
mkdirSync(home, { recursive: true });
writeFileSync(join(home, 'last-project.json'), JSON.stringify({ path: projectDir, slug: 'octodev/order-desk', at: new Date().toISOString() }, null, 2));

const { url, server } = await startServer({ home, workspace: ws, port: 7812 });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fails = [];
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

await page.goto(url, { waitUntil: 'networkidle' });
ok(await page.locator('h1').first().textContent().then((t) => t.includes('Continue where it stopped')), 'the resume card is the first screen');
const cardText = await page.locator('.resume-card').textContent();
ok(cardText.includes('Order Desk'), 'the card names the project');
ok(cardText.includes('answers saved'), 'the checklist shows done steps');
ok(cardText.includes('GitHub repository'), 'the checklist shows the GitHub step');
await page.screenshot({ path: 'download/ui-resume.png', fullPage: false });

await page.locator('#resume-continue').click();
// The keys intake card is part of the resume flow now: the run waits until the
// values arrive from the browser. Fill the card (the smoke's stand-in for the
// developer) — the engine uploads each value and continues on its own.
await page.waitForSelector('.keys-card, .final-links', { timeout: 90_000 });
if ((await page.locator('.keys-card').count()) === 1) {
  const inputs = page.locator('.keys-card input[type="password"]');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(`resume-smoke-secret-${i}-e2c`);
  await page.locator('#keys-submit').click();
  ok(true, `the keys intake card was answered (${n} value(s) submitted from the browser)`);
}
await page.waitForSelector('.final-links', { timeout: 120_000 });
const finalText = await page.locator('.final-links').textContent();
ok(finalText.includes('devos continue: octodev/order-desk is fully set up'), `final card: ${finalText.slice(0, 160)}`);
ok(finalText.includes('https://github.com/octodev/order-desk'), 'the repository link is there');
ok(finalText.includes('dependencies installed') && finalText.includes('GitHub repository + first cycle'), 'the card says what the engine picked up');
await page.screenshot({ path: 'download/ui-resume-final.png', fullPage: false });
ok(pageErrors.length === 0, `no page errors${pageErrors.length ? ` — ${pageErrors.join(' | ')}` : ''}`);

await page.reload({ waitUntil: 'networkidle' });
ok((await page.locator('.final-links').count()) === 1, 'reload lands back on the final card');

await browser.close();
server.close();
console.log(fails.length ? `RESUME SMOKE FAILED: ${fails.length}` : 'RESUME SMOKE ALL GREEN');
process.exit(fails.length ? 1 : 0);
