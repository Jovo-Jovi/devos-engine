// Splash check: the first paint must already show the animated splash (no blank
// page while /api/state probes the CLIs), and the splash must be replaced by the
// machine step once the state lands. /api/state is artificially delayed so both
// moments are observable on any machine. Run: node scripts/ui-splash-smoke.mjs
import { chromium } from 'playwright';
import { startServer } from '../lib/server.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'bin');
process.env.PATH = `${fixtures}:${process.env.PATH}`;
const home = '/tmp/devos-ui-splash-home';
const ws = '/tmp/devos-ui-splash-ws';
rmSync(home, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });

const { url, server } = await startServer({ home, workspace: ws, port: 7817 });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// Slow /api/state down so the cold-start window is reproducible (the real one is
// seconds on Windows while the CLIs are probed; 1200 ms is enough to observe).
await page.route('**/api/state', async (route) => {
  await new Promise((r) => setTimeout(r, 1200));
  await route.continue();
});

await page.goto(url, { waitUntil: 'commit' });
// During the (delayed) state fetch the splash must be on screen with its ring.
const splashEarly = await page.waitForSelector('#splash', { timeout: 5_000 }).catch(() => null);
ok(splashEarly, 'the splash is on the page at first paint (no blank start)');
const ringEarly = await page.waitForSelector('.splash-ring', { timeout: 5_000 }).catch(() => null);
ok(ringEarly, 'the animated ring is part of the splash');
const ringBox = ringEarly ? JSON.stringify(await ringEarly.boundingBox()) : null;
ok(ringEarly && !ringBox.includes('"height":0'), `the ring has a drawn size (${ringBox})`);

// Once the state lands, the splash is replaced by the real first step.
await page.waitForSelector('#splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
const splashGone = !(await page.$('#splash'));
const h1 = await page.$('h1');
ok(splashGone, 'the splash is replaced once the engine answers');
ok(h1 && (await h1.textContent()).trim() === 'Machine check', `the real UI took over (${h1 ? await h1.textContent() : 'nothing'})`);

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
ok(!pageErrors.length, 'no page errors');

await browser.close();
server.close();
if (fails.length) { console.log(`SPLASH SMOKE FAILED: ${fails.join(' | ')}`); process.exit(1); }
console.log('SPLASH SMOKE ALL GREEN');
