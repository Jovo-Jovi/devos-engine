import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ENGINE_ROOT = join(new URL('..', import.meta.url).pathname);

// Fake executables + isolated HOME/workspace per test file.
export function makeTestEnv(t) {
  const home = mkdtempSync(join(tmpdir(), 'devos-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'devos-ws-'));
  const fakeLog = join(home, 'fake-log.jsonl');
  process.env.DEVOS_HOME = home;
  process.env.DEVOS_FAKE_LOG = fakeLog;
  process.env.DEVOS_NO_BROWSER = '1';
  process.env.GITHUB_REPOSITORY = 'octodev/order-desk';
  const fixtures = join(ENGINE_ROOT, 'test', 'fixtures', 'bin');
  if (!process.env.PATH.startsWith(fixtures)) {
    process.env.PATH = `${fixtures}:${process.env.PATH}`;
  }
  t.home = home;
  t.workspace = workspace;
  t.fakeLog = fakeLog;
  return { home, workspace, fakeLog };
}

export function cleanupTestEnv(t) {
  try { rmSync(t.home, { recursive: true, force: true }); } catch { }
  try { rmSync(t.workspace, { recursive: true, force: true }); } catch { }
}

export function readFakeLog(fakeLog) {
  try {
    return require_fs().readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}
function require_fs() { return import('node:fs').then((m) => m.default || m); }

// Await the fs import properly: synchronous read helper
import { readFileSync } from 'node:fs';
export function fakeLogEntries(fakeLog) {
  try {
    return readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function saasDraft() {
  return {
    schema: 'devos/draft@1',
    theme: 'dark',
    models: {
      reviewer: { cli: 'claude', model: 'claude-opus-5-5' },
      builder: { cli: 'cursor', model: 'grok-4.7' },
      extraBuilders: [],
      lightReviewer: { same: true, cli: null, model: null },
      pickPolicy: 'reviewer-picks',
      configurationModel: { cli: 'claude', model: 'claude-opus-5-5' },
    },
    saveDefaults: false,
    project: {
      name: 'Order Desk',
      slug: 'octodev/order-desk',
      brief: 'A phone-order desk where small shops type orders and watch the queue live.',
      audience: 'Small shops that take phone orders',
      visibility: 'private',
    },
    type: 'saas',
    framework: 'next',
    customCommands: { install: '', typecheck: '', lint: '', test: '', build: '', e2e: '' },
    modules: {
      language: { on: true, provider: 'typescript' },
      styling: { on: true, provider: 'tailwind' },
      'ui-kit': { on: false, provider: 'none' },
      database: { on: true, provider: 'supabase' },
      auth: { on: true, provider: 'email', impl: 'better-auth' },
      storage: { on: false, provider: 'none' },
      payments: { on: false, provider: 'none' },
      email: { on: true, provider: 'resend' },
      jobs: { on: false, provider: 'none' },
      search: { on: false, provider: 'none' },
      'product-ai': { on: false, provider: 'none' },
      i18n: { on: false },
      testing: { on: true, unit: true, playwright: true },
      hosting: { on: true, provider: 'vercel' },
      observability: { on: false, provider: 'none' },
      automation: { on: true, locked: true },
    },
    languages: ['en'],
    touched: { framework: false, modules: false },
  };
}
