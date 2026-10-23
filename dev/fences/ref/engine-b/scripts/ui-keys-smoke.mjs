// Headless UI smoke for the keys intake card — the user's ask: "make user enter
// missed keys in the ui and then the model takes them without seeing them and
// then it submit and check again for any miss and if okay its done and if not
// make this steps again until all done and cycle workflow is okay."
// A started project (repo done, keys missing) is continued from the resume card;
// the Missing keys card opens in the run view; a partial submit re-opens it with
// only the still-missing names; the second submit completes the keys and the run
// continues on its own into the cycle round and the final card. No value is ever
// visible in the page. Run: node scripts/ui-keys-smoke.mjs
import { chromium } from 'playwright';
import { startServer } from '../lib/server.mjs';
import { mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures', 'bin');
process.env.PATH = `${fixtures}:${process.env.PATH}`;
process.env.DEVOS_FAKE_LOG = '/tmp/devos-ui-keys-smoke-fake.log';
process.env.DEVOS_GIT_FAKE_PUSH = '1';
process.env.DEVOS_GH_STATE = '/tmp/devos-ui-keys-smoke-gh-state.json';

const home = '/tmp/devos-ui-keys-home';
const ws = '/tmp/devos-ui-keys-ws';
rmSync(home, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });

// The started project: full answers + a copied bootstrap, repository DONE
// (init.json), dependencies installed — the continue goes straight to keys.
const { finalizeAnswers } = await import('../lib/answers.mjs');
const { validateBootstrap } = await import('../lib/guards.mjs');
const { spawnSync } = await import('node:child_process');
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
mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
writeFileSync(join(projectDir, 'devos', 'answers.json'), JSON.stringify(answers, null, 2));
const payload = join(root, 'payload');
const w = spawnSync(process.execPath, [join(fixtures, 'bootstrap-writer.mjs')], {
  env: { ...process.env, DEVOS_PROJECT_DIR: projectDir, DEVOS_ANSWERS: join(projectDir, 'devos', 'answers.json'), DEVOS_PAYLOAD: payload, DEVOS_FAKE_MODE: 'no-github-reject' },
  encoding: 'utf8',
});
if (w.status !== 0) { console.error('bootstrap-writer failed:', w.stderr); process.exit(1); }
const guard = validateBootstrap(projectDir, answers, { engineRoot: root });
if (!guard.ok) { console.error('fixture tree fails guards:', guard.report.slice(0, 4)); process.exit(1); }
// repository done + deps installed: the resume runs the keys stage immediately
writeFileSync(join(projectDir, 'devos', 'state', 'init.json'),
  JSON.stringify({ status: 'done', repo: 'octodev/order-desk' }, null, 2));
mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(home, 'last-project.json'), JSON.stringify({ path: projectDir, slug: 'octodev/order-desk', at: new Date().toISOString() }, null, 2));

const { keyCatalog } = await import('../lib/keys.mjs');
const keyNames = keyCatalog(answers).map((k) => k.name);
const VALUES = {};
for (const n of keyNames) VALUES[n] = `ui-smoke-secret-${n.toLowerCase()}-b7d`;

const { url, server } = await startServer({ home, workspace: ws, port: 7813 });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fails = [];
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('#resume-continue').click();

// The Missing keys card opens in the run view, one password field per key.
await page.waitForSelector('.keys-card', { timeout: 90_000 });
ok(true, 'the Missing keys card opened in the run view');
const cardText = await page.locator('.keys-card').textContent();
ok(keyNames.every((n) => cardText.includes(n)), `the card lists every selected key (${keyNames.length})`);
const inputCount = await page.locator('.keys-card input[type="password"]').count();
ok(inputCount === keyNames.length, `one password field per key (${inputCount})`);
let autocompleteOff = true;
for (const n of keyNames) {
  if ((await page.locator(`#key-input-${n}`).getAttribute('autocomplete')) !== 'off') autocompleteOff = false;
}
ok(autocompleteOff, 'autocomplete is off on every field');
let body = await page.textContent('body');
for (const [, v] of Object.entries(VALUES)) ok(!body.includes(v), 'the page never shows a value');
await page.screenshot({ path: 'download/ui-keys-card.png', fullPage: false });

// Partial submit: only the FIRST key — the card must re-open with the rest.
await page.locator(`#key-input-${keyNames[0]}`).fill(VALUES[keyNames[0]]);
await page.locator('#keys-submit').click();
await page.waitForFunction(() => {
  const el = document.querySelector('.keys-card');
  return el && !el.textContent.includes('CURSOR_API_KEY'.slice(0, 0)) && el.querySelectorAll('input[type="password"]').length < 10;
}, { timeout: 30_000 }).catch(() => {});
const againCount = await page.locator('.keys-card input[type="password"]').count();
ok(againCount === keyNames.length - 1, `the card re-opened with only the still-missing keys (${againCount})`);
const againText = await page.locator('.keys-card').textContent();
ok(againText.includes('Submitted') || againText.includes('still misses') || againText.includes('did not fix it'), 'the card says the first submit was checked');
ok(!againText.includes(keyNames[0]), `the uploaded key left the card (${keyNames[0]})`);

// Second submit: the rest — the run continues on its own to the final card.
for (const n of keyNames.slice(1)) await page.locator(`#key-input-${n}`).fill(VALUES[n]);
await page.locator('#keys-submit').click();
// Read the run log BEFORE the final card replaces the run view (#log lives only there).
await page.waitForFunction((total) => {
  const el = document.getElementById('log');
  return el && (el.textContent.includes(`All ${total} key(s) are on GitHub now`) || el.textContent.includes('uploaded'));
}, keyNames.length, { timeout: 60_000 }).catch(() => {});
const logText = await page.locator('#log').textContent();
await page.waitForSelector('.final-links', { timeout: 120_000 });
ok(true, 'the run reached the final card');
const finalText = await page.locator('.final-links').textContent();
ok(finalText.includes('octodev/order-desk'), 'the final card names the project');
ok(finalText.includes('the first cycle run is green') || finalText.includes('fully set up'), `the goal line: ${finalText.slice(0, 140)}`);
body = await page.textContent('body');
for (const [, v] of Object.entries(VALUES)) ok(!body.includes(v), 'no value ever reached the page (final included)');
for (const [, v] of Object.entries(VALUES)) ok(!logText.includes(v), 'no value ever reached the run log');
ok(logText.includes('keys') && (logText.includes('uploaded') || logText.includes(`All ${keyNames.length} key(s)`)), 'the log tells the upload story');
await page.screenshot({ path: 'download/ui-keys-final.png', fullPage: false });
ok(pageErrors.length === 0, `no page errors${pageErrors.length ? ` — ${pageErrors.join(' | ')}` : ''}`);

// The engine's own records: every key set from the UI intake.
const { readFileSync } = await import('node:fs');
const st = JSON.parse(readFileSync(join(projectDir, 'devos', 'state', 'secrets.json'), 'utf8'));
ok(keyNames.every((n) => st.entries[n]?.status === 'set' && st.entries[n]?.via === 'ui-intake'), 'every key recorded via the UI intake');

await browser.close();
server.close();
console.log(fails.length ? `KEYS SMOKE FAILED: ${fails.length}` : 'KEYS SMOKE ALL GREEN');
process.exit(fails.length ? 1 : 0);
