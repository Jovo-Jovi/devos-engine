import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lintWorkflowFiles } from './yamllint.mjs';
import { loadCatalogue } from './catalogue.mjs';

export function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) listFiles(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

export function langServerInfo(answers) {
  const lang = answers.modules?.language?.provider || 'typescript';
  if (lang === 'python') return { serverDir: 'src/server', exts: ['py'] };
  if (lang === 'go') return { serverDir: 'internal/server', exts: ['go'] };
  if (lang === 'dart') return { serverDir: 'lib/server', exts: ['dart'] };
  return { serverDir: 'src/server', exts: ['ts', 'tsx', 'js', 'mjs'] };
}

const SERVER_MODULE_IDS = ['database', 'auth', 'storage', 'payments', 'email', 'jobs', 'search', 'product-ai', 'observability'];

const HOST_FILES = {
  vercel: 'vercel.json',
  'cloudflare-workers': 'wrangler.toml',
  fly: 'fly.toml',
  railway: 'railway.json',
  docker: 'Dockerfile',
};

const AUTOMATION_WORKFLOWS = [
  'devos-cycle.yml', 'devos-intake.yml', 'devos-advance.yml', 'devos-doctor.yml',
  'devos-resume.yml', 'devos-setup.yml', 'devos-deploy.yml', 'ci.yml',
  'devos-wait.yml', 'devos-supervisor.yml',
];

function readIf(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

export function moduleMarkers(answers) {
  // Returns [{id, on, mustExist: [paths or matchers], mustNotExist: [...]}]
  const mods = answers.modules || {};
  const { serverDir, exts } = langServerInfo(answers);
  const serverFile = (id) => ({ kind: 'server', id, paths: exts.map((e) => `${serverDir}/${id}.${e}`) });
  const markers = [];
  for (const [id, state] of Object.entries(mods)) {
    if (id === 'automation') {
      markers.push({ id, on: true, mustExist: AUTOMATION_WORKFLOWS.map((w) => `.github/workflows/${w}`), mustNotExist: [] });
      continue;
    }
    if (id === 'language') continue;
    const on = Boolean(state.on);
    const mustExist = [];
    const mustNotExist = [];
    if (id === 'database' && on) {
      if (state.provider === 'supabase') mustExist.push('supabase/config.toml');
      if (state.provider !== 'none') mustExist.push(serverFile('database'));
    }
    if (id === 'hosting') {
      if (on && state.provider !== 'none' && HOST_FILES[state.provider]) mustExist.push(HOST_FILES[state.provider]);
      if (!on || state.provider === 'none') mustNotExist.push(...Object.values(HOST_FILES));
    }
    if (id === 'testing') {
      if (state.playwright) mustExist.push({ kind: 'any', paths: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'] });
    }
    if (id === 'styling' && on) {
      if (state.provider === 'tailwind') {
        mustExist.push({ kind: 'any', paths: ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs'] });
      }
    }
    if (id === 'ui-kit' && on && state.provider === 'shadcn') {
      mustExist.push('components.json');
    }
    if (SERVER_MODULE_IDS.includes(id)) {
      if (on && state.provider !== 'none') mustExist.push(serverFile(id));
      if (!on || state.provider === 'none') mustNotExist.push(serverFile(id));
    }
    markers.push({ id, on, mustExist, mustNotExist });
  }
  return markers;
}

function checkMarkerPath(projectDir, entry) {
  const paths = typeof entry === 'string' ? [entry] : entry.paths;
  return paths.some((rel) => existsSync(join(projectDir, rel)));
}

// Validates the bootstrap the configuration model wrote. Every problem becomes one line
// in the report; the report is fed back to the model in an automatic repair round.
export function validateBootstrap(projectDir, answers, opts = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  const cat = loadCatalogue();
  const pf = (rel) => join(projectDir, rel);
  const rd = (rel) => readIf(pf(rel));
  const has = (rel) => existsSync(pf(rel));

  const models = answers.models || {};
  const stack = answers.stack || {};
  const type = cat.types.find((t) => t.id === answers.type) || {};

  // 1. devos/project.json
  const proj = rd('devos/project.json');
  if (!proj) p('devos/project.json is missing.');
  else {
    let cfg;
    try { cfg = JSON.parse(proj); } catch { cfg = null; }
    if (!cfg) p('devos/project.json does not parse as JSON.');
    else {
      if (cfg.base !== 'main') p('devos/project.json: base must be "main".');
      if (cfg.maxAttempts !== 3) p('devos/project.json: maxAttempts must be 3.');
      if (!cfg.reviewer || cfg.reviewer.cli !== models.reviewer?.cli || cfg.reviewer.model !== models.reviewer?.model) {
        p(`devos/project.json: reviewer must be ${models.reviewer?.cli} / ${models.reviewer?.model}.`);
      }
      if (!cfg.builder || cfg.builder.cli !== models.builder?.cli || cfg.builder.model !== models.builder?.model) {
        p(`devos/project.json: default builder must be ${models.builder?.cli} / ${models.builder?.model}.`);
      }
      if (!cfg.configurationModel || cfg.configurationModel.stage !== 'configuration-only') {
        p('devos/project.json: configurationModel.stage must be "configuration-only".');
      } else if (cfg.configurationModel.cli !== models.configurationModel?.cli || cfg.configurationModel.model !== models.configurationModel?.model) {
        p('devos/project.json: configurationModel must match the chosen configuration model.');
      }
      if (!cat.pickPolicies.some((x) => x.id === cfg.pickPolicy)) p('devos/project.json: pickPolicy is invalid.');
      const pool = cfg.builderPool || [];
      if (!pool.some((b) => b.cli === models.builder?.cli && b.model === models.builder?.model)) {
        p('devos/project.json: builderPool must contain the default builder.');
      }
      if (!cfg.requiredChecks || !cfg.requiredChecks.typecheck || !cfg.requiredChecks.test || !cfg.requiredChecks.build) {
        p('devos/project.json: requiredChecks must carry the stack typecheck, test, and build commands.');
      }
      if (cfg.configurationModel && (cfg.reviewer?.model === cfg.configurationModel.model) && cfg.configurationModel.stage !== 'configuration-only') {
        p('devos/project.json: cycle workflows must not call the configuration model.');
      }
    }
  }

  // 2. devos.config.json
  if (!rd('devos.config.json')) p('devos.config.json is missing.');

  // 3. Stack files
  if (answers.framework === 'custom') {
    if (!has('package.json')) p('Custom framework: package.json is missing.');
  } else {
    if (stack.packageManager === 'npm' && !has('package.json')) p('package.json is missing.');
    for (const f of stack.configFiles || []) if (!has(f)) p(`Stack config file ${f} is missing.`);
    const lang = answers.modules?.language?.provider || 'typescript';
    if (lang === 'typescript' && !has('tsconfig.json')) p('tsconfig.json is missing for a TypeScript project.');
    if (lang === 'python' && !has('requirements.txt') && !has('pyproject.toml')) p('Python project needs requirements.txt or pyproject.toml.');
    if (lang === 'go' && !has('go.mod')) p('go.mod is missing for a Go project.');
  }
  if (!has('.env.example')) p('.env.example is missing.');
  if (!has('.gitignore')) p('.gitignore is missing.');
  const editor = rd('.editorconfig') || '';
  if (!editor || !/end_of_line\s*=\s*lf/.test(editor)) p('.editorconfig must exist and set end_of_line = lf.');

  // 4. Automation files and docs
  for (const w of AUTOMATION_WORKFLOWS) if (!has(`.github/workflows/${w}`)) p(`Workflow .github/workflows/${w} is missing.`);
  if (!has('scripts/devos/cycle.mjs')) p('scripts/devos/cycle.mjs is missing.');
  if (!has('scripts/guards/run-all.mjs')) p('scripts/guards/run-all.mjs is missing.');
  for (const d of ['docs/ARCHITECTURE.md', 'docs/PHASES.md', 'docs/PRODUCT_BRIEF.md', 'docs/SCOPE.md', 'docs/DECISIONS.md', 'docs/GLOSSARY.md', 'docs/BOUNDARY_MODEL.md', 'docs/method/AUTOMATION.md', 'SETUP.md']) {
    if (!has(d)) p(`${d} is missing.`);
  }
  if (type.ui && !has('docs/DESIGN_SYSTEM.md')) p('docs/DESIGN_SYSTEM.md is missing for a project with a web UI.');
  if (Array.isArray(answers.project?.docs) && answers.project.docs.length && !has('devos/OPEN_QUESTIONS.md')) {
    p('Documentation was attached, so devos/OPEN_QUESTIONS.md is missing (write "No open questions." when nothing is missing).');
  }
  if (!has('devos/fences/T01.md')) p('devos/fences/T01.md is missing.');
  for (const pr of ['builder.md', 'reviewer.md', 'intake.md', 'revise.md']) {
    if (!has(`devos/prompts/${pr}`)) p(`devos/prompts/${pr} is missing.`);
  }
  for (const f of ['.github/ISSUE_TEMPLATE/change-request.yml', '.github/ISSUE_TEMPLATE/method-fix.yml']) {
    if (!has(f)) p(`${f} (issue form) is missing.`);
  }
  const phases = rd('docs/PHASES.md') || '';
  if (phases && !/T01/.test(phases)) p('docs/PHASES.md must contain the T01 row.');
  if (phases && !/not[\s-]?done/i.test(phases)) p('docs/PHASES.md must start with T01 not done.');

  // 5. Fence T01 header carries the chosen ids, never a configuration-model role
  const fence = rd('devos/fences/T01.md') || '';
  if (fence) {
    const rev = fence.match(/^Reviewer:\s*(\S+)\s+(\S+)\s*$/m);
    const bld = fence.match(/^Builder:\s*(\S+)\s+(\S+)\s*$/m);
    if (!rev || rev[1] !== models.reviewer?.cli || rev[2] !== models.reviewer?.model) {
      p(`devos/fences/T01.md header must set "Reviewer: ${models.reviewer?.cli} ${models.reviewer?.model}".`);
    }
    if (!bld || bld[1] !== models.builder?.cli || bld[2] !== models.builder?.model) {
      p(`devos/fences/T01.md header must set "Builder: ${models.builder?.cli} ${models.builder?.model}".`);
    }
    if (/^Configuration model:/m.test(fence)) {
      p('devos/fences/T01.md must not name the configuration model as a role; it only carries Reviewer and Builder.');
    }
  }

  // 6. Module parity: on-modules present, off-modules absent
  for (const marker of moduleMarkers(answers)) {
    for (const entry of marker.mustExist) {
      if (!checkMarkerPath(projectDir, entry)) {
        p(`Module ${marker.id} is ON in the answers but its file is missing (${typeof entry === 'string' ? entry : entry.paths.join(' or ')}).`);
      }
    }
    for (const entry of marker.mustNotExist) {
      if (checkMarkerPath(projectDir, entry)) {
        p(`Module ${marker.id} is OFF in the answers but ${typeof entry === 'string' ? entry : entry.paths.join(' or ')} exists.`);
      }
    }
  }

  // 7. .env.example names only, matching module state
  const envExample = rd('.env.example') || '';
  if (envExample) {
    const withValue = envExample.split('\n').map((l) => l.trim())
      .filter((l) => /^[A-Z0-9_]+=/.test(l));
    for (const line of withValue) {
      const value = line.split('=').slice(1).join('=').replace(/\s*#.*$/, '').trim();
      if (value) p(`.env.example must contain names only (found a value for ${line.split('=')[0]}).`);
    }
    for (const m of cat.modules) {
      if (['language', 'automation', 'i18n', 'testing'].includes(m.id)) continue;
      const state = answers.modules?.[m.id] || {};
      const provider = (m.providers || []).find((x) => x.id === state.provider);
      const impl = m.implProviders?.find((x) => x.id === state.impl);
      const envs = [...(provider?.env || []), ...(state.on ? (impl?.env || []) : [])];
      for (const name of envs) {
        if (state.on && state.provider !== 'none' && !new RegExp(`^\\s*#?\\s*${name}\\b`, 'm').test(envExample)) {
          p(`.env.example is missing ${name} for the ${m.id} module.`);
        }
        if ((!state.on || state.provider === 'none') && new RegExp(`^${name}=`, 'm').test(envExample)) {
          p(`.env.example lists ${name} but module ${m.id} is off.`);
        }
      }
    }
  }

  // 8. Automation must never invoke the configuration model
  const scanned = listFiles(join(projectDir, '.github')).map((f) => `.github/${f}`)
    .concat(listFiles(join(projectDir, 'scripts')).map((f) => `scripts/${f}`));
  for (const f of scanned) {
    if (!f.startsWith('.github/workflows') && !f.startsWith('scripts/devos')) continue;
    const content = readIf(pf(f)) || '';
    if (/runConfigurationModel|configurationModel\.model|internal:request-secret --model/.test(content)) {
      p(`${f} appears to invoke the configuration model; the cycle must not call it.`);
    }
  }

  // 9. Workflow YAML parses
  const wfFiles = listFiles(join(projectDir, '.github', 'workflows')).map((f) => ({
    path: `.github/workflows/${f}`,
    content: readIf(pf(`.github/workflows/${f}`)) || '',
  }));
  problems.push(...lintWorkflowFiles(wfFiles));

  // 10. Architecture on disk
  const arch = stack.arch || 'web';
  const manifestPath = opts.architectureManifest || opts.engineRoot
    ? join(opts.engineRoot || process.cwd(), 'payload', 'architecture', arch, 'manifest.json')
    : null;
  if (manifestPath && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const rel of manifest.paths || []) {
      if (!has(rel)) p(`Architecture: expected ${rel} for a ${arch} project.`);
    }
    for (const rel of manifest.absent || []) {
      if (has(rel)) p(`Architecture: ${rel} must not exist for a ${arch} project.`);
    }
    if (manifest.health) {
      const healthFiles = listFiles(projectDir).filter((f) => /health/.test(f) && /\.(ts|tsx|js|mjs|py|go)$/.test(f));
      if (!healthFiles.length) p('Architecture: a health route file is missing (it must return 200).');
    }
    if (manifest.architectureTest) {
      const testFiles = listFiles(projectDir).filter((f) => /architecture\.(test|mjs|spec)/.test(f));
      if (!testFiles.length) p('Architecture: the test that fails when a UI file imports the database is missing.');
    }
  }

  // 11. Product docs record the decisions
  const decisions = rd('docs/DECISIONS.md') || '';
  if (decisions) {
    for (const needle of [models.reviewer?.model, models.builder?.model, models.configurationModel?.model, answers.framework].filter(Boolean)) {
      if (!decisions.includes(needle)) p(`docs/DECISIONS.md must record ${needle}.`);
    }
  }

  // 12. The repository-facing files a real project needs (the bar the user's own
  // proven workflow project sets): a README that presents the repo, agent rules
  // every CLI reads automatically, and the stack decision as an ADR. Plus the
  // cycle's CLI installer — without it the Actions runner has no builder/reviewer
  // binary and the cycle dies with "exited with code null".
  const readme = rd('README.md') || '';
  if (!readme.trim()) p('README.md is missing — the repository front page must present the project.');
  else if (answers.project?.name && !readme.includes(answers.project.name)) p(`README.md must name the project (${answers.project.name}).`);
  if (!has('AGENTS.md')) p('AGENTS.md is missing — the rules every builder and reviewer follows in this repository.');
  const adrDir = join(projectDir, 'docs', 'adr');
  const adrFiles = existsSync(adrDir) ? readdirSync(adrDir).filter((f) => /^ADR-\d{3}-.*\.md$/i.test(f)) : [];
  if (!adrFiles.length) p('docs/adr/ADR-001-stack.md is missing — record the stack decision as an architecture decision record.');
  if (!has('scripts/devos/install-clis.mjs')) p('scripts/devos/install-clis.mjs is missing — the cycle workflow installs the agent CLIs with it.');
  const cycleWf = rd('.github/workflows/devos-cycle.yml') || '';
  if (cycleWf && !/install-clis/.test(cycleWf)) {
    p('.github/workflows/devos-cycle.yml must run scripts/devos/install-clis.mjs before the cycle (the runner needs the builder and reviewer CLIs installed).');
  }

  return { ok: problems.length === 0, report: problems };
}
