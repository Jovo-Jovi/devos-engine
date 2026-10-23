#!/usr/bin/env node
// The fake model used by tests. It models what a real configuration model must do:
// write the bootstrap from the answers, report progress as JSON lines, call init_github
// once after the tree is complete, and request secrets by name. It never sees a value.
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectDir = process.env.DEVOS_PROJECT_DIR || process.cwd();
const answersPath = process.env.DEVOS_ANSWERS;
const payload = process.env.DEVOS_PAYLOAD;
const mode = process.env.DEVOS_FAKE_MODE || 'normal';
const role = process.env.DEVOS_ROLE || 'configuration';
const repairRound = Number(process.env.DEVOS_REPAIR_ROUND || 0);

const say = (s) => process.stdout.write(`${s}\n`);
const fileEvent = (rel) => say(JSON.stringify({ event: 'file', path: rel }));
const moduleEvent = (id) => say(JSON.stringify({ event: 'module', id }));

const W = (rel, content) => {
  const p = join(projectDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : readFileSync(content, 'utf8'));
  fileEvent(rel);
};

// ---------------- roles: builder / reviewer (cycle tests) ----------------
if (role === 'builder') {
  const taskId = process.env.DEVOS_TASK_ID || 'T01';
  const attempt = process.env.DEVOS_ATTEMPT || '1';
  if (process.env.DEVOS_BUILDER_MODE === 'missing-secret') {
    say('DEVOS_MISSING_SECRET: STRIPE_SECRET_KEY');
    process.exit(0);
  }
  if (process.env.DEVOS_BUILDER_MODE === 'usage-limit'
    && (process.env.DEVOS_CLI_ID || 'claude') === (process.env.DEVOS_USAGE_CLI || 'claude')) {
    process.stderr.write('usage limit reached for this account\n');
    process.exit(1);
  }
  W('src/features/checkout/page.ts', '// builder wrote this\n');
  W(`docs/reports/${taskId}-a${attempt}.md`, `# Report ${taskId} attempt ${attempt}\n\nImplemented the slice. All done-when rows met.\n`);
  say('builder finished');
  process.exit(0);
}
if (role === 'reviewer') {
  const taskId = process.env.DEVOS_TASK_ID || 'T01';
  const attempt = process.env.DEVOS_ATTEMPT || '1';
  const verdict = process.env.DEVOS_FAKE_VERDICT || 'PASS';
  const fencePath = join(projectDir, 'devos', 'fences', `${taskId}.md`);
  const fence = readFileSync(fencePath, 'utf8');
  const rows = [...fence.matchAll(/^-\s\[( |x)\]\s(.+)$/gm)].map((m) => m[2].trim());
  const body = [`# Review ${taskId} attempt ${attempt}`, '',
    ...rows.map((r) => `- [${verdict === 'PASS' ? 'x' : ' '}] ${r} — ${verdict}`), '',
    verdict === 'PASS' ? '' : 'Reasons: the slice is not complete; see checks.', '',
    `VERDICT: ${verdict}`, ''];
  W(`docs/reviews/${taskId}-a${attempt}.md`, body.join('\n'));
  say('reviewer finished');
  process.exit(0);
}

// ---------------- role: configuration model ----------------
const answers = JSON.parse(readFileSync(answersPath, 'utf8'));
const [owner, slug] = String(answers.project.slug).split('/');
const finalLine = `devos init: ${owner}/${slug} is set up; devos-cycle dispatched.`;

const cat = JSON.parse(readFileSync(join(payload, 'catalogue.json'), 'utf8'));
const stack = answers.stack || {};
const arch = stack.arch || 'web';
const lang = answers.modules?.language?.provider || 'typescript';
const isTS = lang === 'typescript';
const isPy = lang === 'python';
const isGo = lang === 'go';
const ext = isPy ? 'py' : isGo ? 'go' : 'ts';
const serverExt = isGo ? 'go' : ext;
const feature = (String(answers.project.brief || 'orders').toLowerCase().match(/[a-z]{4,}/) || ['orders'])[0];

const SERVER_MODULES = ['database', 'auth', 'storage', 'payments', 'email', 'jobs', 'search', 'product-ai', 'observability'];
const on = (id) => Boolean(answers.modules?.[id]?.on) && answers.modules[id].provider !== 'none';
const TOOL_SECRETS = { claude: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'], cursor: ['CURSOR_API_KEY'], codex: ['OPENAI_API_KEY'], gemini: ['GEMINI_API_KEY'], glm: ['ZAI_API_KEY'] };

function envNames() {
  const names = [];
  for (const tool of ['reviewer', 'builder']) {
    for (const n of TOOL_SECRETS[answers.models?.[tool]?.cli] || []) if (!names.includes(n)) names.push(n);
  }
  for (const m of cat.modules) {
    if (['language', 'automation', 'i18n', 'testing'].includes(m.id)) continue;
    const st = answers.modules?.[m.id] || {};
    if (!st.on || st.provider === 'none') continue;
    const provider = (m.providers || []).find((x) => x.id === st.provider);
    for (const e of provider?.env || []) if (!names.includes(e)) names.push(e);
    if (m.id === 'auth' && st.impl) {
      const impl = (m.implProviders || []).find((x) => x.id === st.impl);
      for (const e of impl?.env || []) if (!names.includes(e)) names.push(e);
    }
    if (m.id === 'product-ai' && st.impl) {
      const impl = (m.implProviders || []).find((x) => x.id === st.impl);
      for (const e of impl?.env || []) if (!names.includes(e)) names.push(e);
    }
  }
  return names;
}

function copyModule(relTargetBase, moduleId, sub) {
  // copies a module template file or directory into the project
  const src = join(payload, 'modules', moduleId, 'files', sub || '');
  const dstBase = join(projectDir, relTargetBase);
  if (!existsSync(src)) return;
  cpSync(src, dstBase, { recursive: true });
}


if (mode === 'usage-limit') {
  process.stderr.write('usage limit reached; retry later\n');
  process.exit(1);
}
if (mode === 'guard-always') {
  // writes a tree that never passes the guards
  W('README.md', 'incomplete bootstrap\n');
  say('wrote something incomplete');
  process.exit(0);
}

const broken = (mode === 'guard-fail-once' && repairRound === 0);
if (broken) {
  // Round 0 of the repair test: a tree that fails the guards, without touching GitHub.
  W('README.md', 'bootstrap attempt with a broken project.json\n');
  W('devos/project.json', JSON.stringify({ reviewer: { cli: 'wrong-cli', model: 'wrong-model' } }, null, 2) + '\n');
  say('wrote a deliberately broken bootstrap');
  process.exit(0);
}

// 1. stack configuration
if (stack.packageManager === 'npm') {
  const depsByFramework = {
    next: { next: '15.1.6', react: '19.0.0', 'react-dom': '19.0.0' },
    astro: { astro: '5.2.0' },
    starlight: { astro: '5.2.0', '@astrojs/starlight': '0.32.0' },
    hono: { hono: '4.6.0' },
    'node-cli': {},
    'node-lib': {},
    'vite-react': { react: '19.0.0', 'react-dom': '19.0.0', vite: '6.0.0' },
  };
  const pkg = {
    name: slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    version: '0.1.0',
    private: answers.type !== 'library',
    type: 'module',
    scripts: {
      dev: 'next dev || astro dev || vite || echo dev',
      build: stack.commands.build || 'echo build',
      start: 'npm run dev',
      typecheck: stack.commands.typecheck || 'npx tsc --noEmit',
      lint: stack.commands.lint || 'npx eslint .',
      test: stack.commands.test || 'npx vitest run',
    },
    dependencies: depsByFramework[answers.framework] || {},
    devDependencies: {
      typescript: '5.7.3',
      eslint: '9.18.0',
      vitest: '2.1.8',
      ...(answers.modules?.testing?.playwright ? { '@playwright/test': '1.50.0' } : {}),
    },
  };
  W('package.json', JSON.stringify(pkg, null, 2) + '\n');
}
if (isTS) W('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, noEmit: true, jsx: 'preserve' }, include: ['src', 'tests'] }, null, 2) + '\n');

const frameworkConfigs = {
  next: ["import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n"],
  astro: ['import { defineConfig } from "astro/config";\n\nexport default defineConfig({});\n'],
  starlight: ['import { defineConfig } from "astro/config";\nimport starlight from "@astrojs/starlight";\n\nexport default defineConfig({ integrations: [starlight()] });\n'],
  hono: ['export const app = undefined; // entry lives in src/routes\n'],
};
for (const cf of stack.configFiles || []) {
  if (cf === 'tsconfig.json') continue;
  if (cf === 'package.json') continue;
  if (answers.framework === 'custom') break;
  const content = frameworkConfigs[answers.framework]?.[0] || `// ${cf}\n`;
  W(cf, content);
}
if (isPy) {
  W('requirements.txt', 'fastapi==0.115.6\nuvicorn==0.34.0\npytest==8.3.4\nruff==0.9.2\nmypy==1.14.1\n');
  W('pyproject.toml', '[project]\nname = "' + slug.split('/')[1] + '"\nversion = "0.1.0"\n');
}
if (isGo) W('go.mod', `module github.com/${owner}/${slug}\n\ngo 1.22\n`);

W('eslint.config.mjs', 'export default [{ rules: { "no-unused-vars": "warn" } }];\n');
W('vitest.config.ts', `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { include: ['tests/**/*.test.?(c|m)[jt]s?(x)'] } });\n`);

W('.gitignore', ['node_modules/', '.env', '.env.*', '!.env.example', 'dist/', '.next/', 'coverage/', '.devos/'].join('\n') + '\n');
W('.editorconfig', 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\n');

// .env.example: names only, one block per active module
const blocks = [`# ${answers.project.name} — names only. Values are typed with: gh secret set NAME --repo ${owner}/${slug}`];
for (const name of envNames()) blocks.push('', `# secret`, `${name}=`);
W('.env.example', blocks.join('\n') + '\n');

// 2. automation module: copy templates
moduleEvent('automation');
cpSync(join(payload, 'modules', 'automation', 'template', '.github'), join(projectDir, '.github'), { recursive: true });
cpSync(join(payload, 'modules', 'automation', 'template', 'scripts'), join(projectDir, 'scripts'), { recursive: true });
mkdirSync(join(projectDir, 'devos'), { recursive: true });
cpSync(join(payload, 'modules', 'automation', 'template', 'devos', 'prompts'), join(projectDir, 'devos', 'prompts'), { recursive: true });
mkdirSync(join(projectDir, 'docs', 'method'), { recursive: true });
cpSync(join(payload, 'modules', 'automation', 'template', 'docs', 'method', 'AUTOMATION.md'), join(projectDir, 'docs', 'method', 'AUTOMATION.md'));
cpSync(join(payload, 'modules', 'automation', 'template', 'docs', 'PHASES.md'), join(projectDir, 'docs', 'PHASES.md'));
cpSync(join(payload, 'modules', 'automation', 'template', 'SETUP.md'), join(projectDir, 'SETUP.md'));
for (const f of ['docs/PHASES.md', 'docs/method/AUTOMATION.md', 'SETUP.md']) fileEvent(f);

// devos/project.json + devos.config.json (unless this round is deliberately broken)
const cm = answers.models.configurationModel;
const light = answers.models.lightReviewer;
const TOOL_COMMANDS = { claude: 'claude', cursor: 'agent', codex: 'codex', gemini: 'gemini', glm: 'z', muse: 'muse' };
const cmdFor = (cli) => TOOL_COMMANDS[cli] || String(cli).replace(/^custom:/, '');
const projectJson = {
  base: 'main',
  maxAttempts: 3,
  repo: `${owner}/${slug}`,
  reviewer: { cli: answers.models.reviewer.cli, command: cmdFor(answers.models.reviewer.cli), model: answers.models.reviewer.model },
  lightReviewer: light.same ? { same: true, ...answers.models.reviewer } : { cli: light.cli, model: light.model },
  builder: { cli: answers.models.builder.cli, command: cmdFor(answers.models.builder.cli), model: answers.models.builder.model },
  builderPool: [answers.models.builder, ...(answers.models.extraBuilders || [])].map((b) => ({ cli: b.cli, command: cmdFor(b.cli), model: b.model })),
  pickPolicy: answers.models.pickPolicy,
  requiredChecks: {
    install: stack.commands?.install || 'npm install',
    typecheck: stack.commands?.typecheck || 'npx tsc --noEmit',
    lint: stack.commands?.lint || '',
    test: stack.commands?.test || 'npx vitest run',
    build: stack.commands?.build || 'npm run build',
    e2e: answers.modules?.testing?.playwright ? 'npx playwright test' : '',
  },
  modules: answers.modules,
  languages: answers.languages,
  hosting: answers.modules?.hosting?.provider || 'none',
  type: answers.type,
  framework: answers.framework,
  configurationModel: { cli: cm.cli, model: cm.model, stage: 'configuration-only' },
};
W('devos/project.json', JSON.stringify(projectJson, null, 2) + '\n');
W('devos.config.json', JSON.stringify({ ...projectJson, generatedFrom: 'devos/answers.json' }, null, 2) + '\n');

// 3. architecture
mkdirSync(join(projectDir, 'devos', 'fences'), { recursive: true });
const fenceTemplate = readFileSync(join(payload, 'modules', 'automation', 'template', 'devos', 'fences', 'T01.md'), 'utf8');
const fence = fenceTemplate
  .replace('{{REVIEWER_CLI}}', answers.models.reviewer.cli).replace('{{REVIEWER_MODEL}}', answers.models.reviewer.model)
  .replace('{{BUILDER_CLI}}', answers.models.builder.cli).replace('{{BUILDER_MODEL}}', answers.models.builder.model);
W('devos/fences/T01.md', fence);

const archManifest = JSON.parse(readFileSync(join(payload, 'architecture', arch, 'manifest.json'), 'utf8'));
for (const dir of archManifest.paths || []) mkdirSync(join(projectDir, dir), { recursive: true });
for (const dir of archManifest.paths || []) W(`${dir}/.gitkeep`, '');

if (arch === 'web') {
  W('src/app/page.tsx', `export default function Page() {\n  return <main>${answers.project.name}</main>;\n}\n`);
  W('src/app/layout.tsx', `export default function Layout({ children }: { children: React.ReactNode }) {\n  return <html lang="${answers.languages[0]}"><body>{children}</body></html>;\n}\n`);
  W('src/app/api/health/route.ts', readFileSync(join(payload, 'architecture', 'web', 'health-route.ts'), 'utf8'));
  mkdirSync(join(projectDir, 'src', 'features', feature), { recursive: true });
  W(`src/features/${feature}/index.ts`, `export const featureName = '${feature}';\n`);
  W('tests/architecture.test.mjs', readFileSync(join(payload, 'architecture', 'web', 'architecture.test.mjs'), 'utf8'));
} else if (arch === 'api') {
  W('src/routes/health.ts', readFileSync(join(payload, 'architecture', 'api', 'health-route.ts'), 'utf8'));
  W('src/routes/index.ts', "import { Hono } from 'hono';\nexport const app = new Hono();\n");
  W('tests/architecture.test.mjs', readFileSync(join(payload, 'architecture', 'web', 'architecture.test.mjs'), 'utf8'));
} else if (arch === 'cli') {
  W('src/cli.ts', readFileSync(join(payload, 'architecture', 'cli', 'cli-entry.ts'), 'utf8'));
  W('src/commands/run.ts', 'export function runCommand(cmd, args) {\n  console.log(cmd, args.join(" "));\n}\n');
} else if (arch === 'library') {
  W('src/index.ts', `export const version = '0.1.0';\n`);
  W('tests/index.test.ts', `import { test } from 'node:test';\nimport { version } from '../src/index.mjs';\n\ntest('exports a version', (t) => { if (!version) throw new Error('no version'); });\n`);
} else if (arch === 'mobile') {
  W('app/index.tsx', `import { Text } from 'react-native';\nexport default function App() { return <Text>${answers.project.name}</Text>; }\n`);
}

// server module files for active modules
for (const id of SERVER_MODULES) {
  const st = answers.modules?.[id] || {};
  moduleEvent(id);
  if (!st.on || st.provider === 'none') continue;
  const stub = join(payload, 'modules', id, 'files', 'server', isGo ? 'go.go' : isPy ? 'python.py' : 'typescript.ts');
  const target = isGo ? `internal/server/${id}.go` : `src/server/${id}.${serverExt}`;
  W(target, readFileSync(stub, 'utf8'));
  if (id === 'database' && st.provider === 'supabase') {
    cpSync(join(payload, 'modules', 'database', 'files', 'supabase'), join(projectDir, 'supabase'), { recursive: true });
    fileEvent('supabase/config.toml');
    fileEvent('supabase/migrations/0001_init.sql');
  }
}

// module extras
if (on('testing') && answers.modules.testing.playwright) {
  W('playwright.config.ts', readFileSync(join(payload, 'modules', 'testing', 'files', 'playwright.config.ts'), 'utf8'));
}
if (on('styling') && answers.modules.styling.provider === 'tailwind') {
  W('tailwind.config.ts', readFileSync(join(payload, 'modules', 'styling', 'files', 'tailwind.config.ts'), 'utf8'));
}
if (on('ui-kit') && answers.modules['ui-kit'].provider === 'shadcn') {
  W('components.json', readFileSync(join(payload, 'modules', 'ui-kit', 'files', 'components.json'), 'utf8'));
}
const HOST_FILES = { vercel: 'vercel.json', fly: 'fly.toml', 'cloudflare-workers': 'wrangler.toml', railway: 'railway.json', docker: 'Dockerfile' };
const hosting = answers.modules?.hosting || { on: false, provider: 'none' };
if (hosting.on && hosting.provider !== 'none' && HOST_FILES[hosting.provider]) {
  W(HOST_FILES[hosting.provider], readFileSync(join(payload, 'modules', 'hosting', 'files', HOST_FILES[hosting.provider]), 'utf8'));
}

// 4. product documents
const terms = [feature, 'order', 'catalog'];
const fill = (s) => String(s)
  .replace(/\{\{NAME\}\}/g, answers.project.name)
  .replace(/\{\{BRIEF\}\}/g, answers.project.brief || '')
  .replace(/\{\{SLUG\}\}/g, `${owner}/${slug}`)
  .replace(/\{\{TYPE\}\}/g, answers.type)
  .replace(/\{\{FRAMEWORK\}\}/g, answers.framework)
  .replace(/\{\{LANGUAGE\}\}/g, lang)
  .replace(/\{\{PACKAGE_MANAGER\}\}/g, stack.packageManager || 'npm')
  .replace(/\{\{REVIEWER\}\}/g, `${answers.models.reviewer.cli} ${answers.models.reviewer.model}`)
  .replace(/\{\{BUILDER\}\}/g, `${answers.models.builder.cli} ${answers.models.builder.model}`)
  .replace(/\{\{DATE\}\}/g, new Date().toISOString().slice(0, 10));
// Repository-facing docs, copied from the automation payload like a real model
// does (README front page, agent rules, the stack ADR) — the guards require them.
for (const rel of ['README.md', 'AGENTS.md', 'docs/adr/ADR-001-stack.md']) {
  W(rel, fill(readFileSync(join(payload, 'modules', 'automation', 'template', rel), 'utf8')));
}
W('docs/PRODUCT_BRIEF.md', `# ${answers.project.name} product brief\n\n${answers.project.brief}\n\nAudience: ${answers.project.audience}.\n`);
W('docs/SCOPE.md', `# Scope\n\nIn: the ${feature} path.\nOut: everything the brief does not name.\n`);
W('docs/GLOSSARY.md', `# Glossary\n\n${terms.map((t) => `- **${t}**: a word this project uses for its own concept.`).join('\n')}\n`);
W('docs/BOUNDARY_MODEL.md', `# Boundary model\n\nZones where data may live:\n\n- zone: src/server\n- zone: src/data\n- zone: supabase\n\nVisitor data never leaves these zones. UI files import none of them.\n`);
W('docs/DECISIONS.md', `# Decisions\n\n- Type: ${answers.type}\n- Framework: ${answers.framework}\n- Reviewer: ${answers.models.reviewer.cli} ${answers.models.reviewer.model}\n- Builder: ${answers.models.builder.cli} ${answers.models.builder.model}\n- Configuration model: ${cm.cli} ${cm.model} (runs once, at init; stage configuration-only)\n- Active modules: ${Object.entries(answers.modules).filter(([, v]) => v.on).map(([k]) => k).join(', ')}\n`);
if ((cat.types.find((t) => t.id === answers.type) || {}).ui) {
  W('docs/DESIGN_SYSTEM.md', `# Design system\n\nTokens in src/app/globals.css when the ui-kit lands.\n`);
}
W('docs/ARCHITECTURE.md', `# Architecture\n\n${JSON.stringify(archManifest.folderMap, null, 2)}\n\nDependency direction: ${archManifest.dependencyDirection}\nActive modules live in src/server: ${SERVER_MODULES.filter((id) => on(id)).join(', ') || 'none'}.\n`);
if (Array.isArray(answers.project.docs) && answers.project.docs.length) {
  // The guards require this file whenever documentation was attached. A real
  // model writes the questions it could not answer from the answers or docs.
  W('devos/OPEN_QUESTIONS.md', 'No open questions. The attached documents answered what the answers left out.\n');
}

// 5. progress report + GitHub
say(`wrote the bootstrap for ${answers.project.name} (${answers.framework})`);
for (const id of SERVER_MODULES) if (on(id)) moduleEvent(id);

if (mode === 'no-github') {
  say('tree complete; pretending github exists');
  process.exit(0);
}

// The permission wall in the model's own words: the tree is complete but every
// command (npm install, init_github) was refused, so no repository exists. The
// engine must recognize this and name the real fix instead of a generic hint.
if (mode === 'no-github-reject') {
  say('Command execution was rejected on every attempt, including `npm install` and `init_github`. The repository was not created.');
  say('nothing could be executed; the tree is here but GitHub is not');
  process.exit(0);
}

if (mode === 'init-twice' && repairRound === 0) {
  // Round 0 completes GitHub, then drops a guard-required file so the engine
  // must repair. Round 1 rebuilds the tree and re-calls init_github, which
  // refuses ("It runs once") — the engine must still reach a successful end.
  rmSync(join(projectDir, 'docs', 'GLOSSARY.md'));
}

const init = spawnSync('init_github', [], { stdio: 'inherit' });
if (init.status !== 0) {
  process.stderr.write('init_github failed\n');
  process.exit(init.status || 1);
}

for (const name of envNames()) {
  const r = spawnSync('request_secret', [name], { stdio: ['inherit', 'pipe', 'inherit'] });
  say(`secret ${name}: ${String(r.stdout || '').trim() === 'set' ? 'set' : 'missing'}`);
}

say(finalLine);
process.exit(0);
