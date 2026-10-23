import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalogue, loadStack, getType, getModule } from './catalogue.mjs';
import { draftFile, defaultsFile, answersDir } from './paths.mjs';

export function defaultDraft(defaults = null) {
  const catalogue = loadCatalogue();
  const full = catalogue.types.find((t) => t.id === 'full'); // "full" starts selected
  const draft = {
    schema: 'devos/draft@1',
    theme: 'dark',
    models: {
      reviewer: { cli: null, model: null },
      builder: { cli: null, model: null },
      extraBuilders: [],
      lightReviewer: { same: true, cli: null, model: null },
      pickPolicy: 'reviewer-picks',
      configurationModel: { cli: null, model: null },
    },
    saveDefaults: false,
    project: {
      name: '',
      slug: '',
      brief: '',
      audience: '',
      visibility: (defaults && defaults.visibility) || 'private',
    },
    type: full.id,
    framework: full.framework,
    customCommands: { install: '', typecheck: '', lint: '', test: '', build: '', e2e: '' },
    modules: {},
    languages: ['en'],
    touched: { framework: false, modules: false },
  };
  return applyModuleRecommendations(draft, full.id);
}

export function applyModuleRecommendations(draft, typeId) {
  const catalogue = loadCatalogue();
  const type = getType(catalogue, typeId);
  const rec = new Set(type.modules || []);
  const modules = {};
  for (const m of catalogue.modules) {
    if (m.id === 'automation') { modules[m.id] = { on: true, locked: true }; continue; }
    if (m.id === 'language') {
      const stack = loadStack(draft.framework);
      modules[m.id] = { on: true, provider: preferredLanguage(stack) };
      continue;
    }
    if (m.id === 'testing') {
      modules[m.id] = { on: true, unit: true, playwright: Boolean(type.ui) };
      continue;
    }
    if (m.id === 'hosting') {
      modules[m.id] = { on: (type.hosting && type.hosting !== 'none') || rec.has('hosting'), provider: type.hosting || 'none' };
      continue;
    }
    if (m.id === 'product-ai') {
      modules[m.id] = { on: rec.has('product-ai'), provider: rec.has('product-ai') ? 'chat' : 'none', impl: rec.has('product-ai') ? 'claude' : 'none' };
      continue;
    }
    if (m.id === 'auth') {
      const on = rec.has('auth');
      modules[m.id] = { on, provider: on ? 'email' : 'none', impl: on ? 'better-auth' : 'none' };
      continue;
    }
    if (m.id === 'i18n') { modules[m.id] = { on: false }; continue; }
    const on = rec.has(m.id);
    const first = (m.providers || []).find((p) => p.id !== 'none');
    modules[m.id] = { on, provider: on && first ? first.id : 'none' };
  }
  draft.modules = modules;
  return draft;
}

function preferredLanguage(stack) {
  const langs = stack?.languages || ['typescript'];
  return langs[0];
}

export function applyType(draft, typeId) {
  const catalogue = loadCatalogue();
  const type = getType(catalogue, typeId);
  draft.type = typeId;
  if (!draft.touched.framework) {
    draft.framework = type.framework;
    if (draft.modules.language) draft.modules.language.provider = preferredLanguage(loadStack(type.framework));
  }
  if (!draft.touched.modules) applyModuleRecommendations(draft, typeId);
  return draft;
}

export function applyFramework(draft, frameworkId) {
  draft.framework = frameworkId;
  draft.touched.framework = true;
  if (draft.modules.language) {
    draft.modules.language.provider = preferredLanguage(loadStack(frameworkId));
  }
  return draft;
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// The answer file: the only source of product choice for the configuration model.
export function finalizeAnswers(draft, owner) {
  const catalogue = loadCatalogue();
  const stack = loadStack(draft.framework);
  const modules = {};
  for (const m of catalogue.modules) {
    const state = draft.modules[m.id] || { on: false };
    if (m.id === 'automation') { modules[m.id] = { on: true }; continue; }
    if (m.id === 'i18n') { modules[m.id] = { on: (draft.languages || []).length > 1 }; continue; }
    modules[m.id] = {
      on: m.id === 'testing' ? true : Boolean(state.on) && state.provider !== 'none',
      provider: state.provider || 'none',
    };
    if (m.id === 'testing') {
      modules[m.id] = { on: true, unit: true, playwright: Boolean(state.playwright) };
    }
    if (m.id === 'language') modules[m.id].provider = state.provider || 'typescript';
    if (m.id === 'auth' && state.on) modules[m.id].impl = state.impl || 'better-auth';
    if (m.id === 'product-ai' && state.on) modules[m.id].impl = state.impl || 'claude';
  }
  const framework = draft.framework === 'custom'
    ? { ...stack, id: 'custom', commands: { ...draft.customCommands } }
    : stack;
  const models = JSON.parse(JSON.stringify(draft.models));
  // Attach adapter fields for custom tools so the runner can launch them without a re-detect.
  const tools = draft.customTools || [];
  const attach = (row) => {
    if (!row || !String(row.cli || '').startsWith('custom:')) return row;
    const fields = tools.find((t) => `custom:${t.command}` === row.cli || t.displayName === row.cli);
    if (!fields) return row;
    return {
      ...row,
      agent: {
        toolId: `custom:${fields.command}`,
        label: fields.displayName || fields.command,
        command: fields.command,
        modelFlag: fields.modelFlag || '--model',
        promptTemplate: fields.promptTemplate || null,
        usageLimitPattern: fields.usageLimitPattern || null,
        githubCapable: Boolean(fields.promptTemplate && fields.secretName),
        localOnly: !fields.promptTemplate,
      },
    };
  };
  models.reviewer = attach(models.reviewer);
  models.builder = attach(models.builder);
  models.lightReviewer = models.lightReviewer?.same ? { ...models.lightReviewer } : attach(models.lightReviewer);
  models.extraBuilders = (models.extraBuilders || []).map(attach);
  models.configurationModel = attach(models.configurationModel);
  return {
    schema: 'devos/answers@1',
    createdAt: new Date().toISOString(),
    models,
    saveDefaults: Boolean(draft.saveDefaults),
    project: {
      name: draft.project.name,
      slug: draft.project.slug, // owner/slug
      owner: owner || String(draft.project.slug || '').split('/')[0],
      brief: draft.project.brief,
      audience: draft.project.audience,
      visibility: draft.project.visibility || 'private',
      // Attached documentation travels with the answers; the engine writes these
      // into devos/intake-docs/ before the configuration model starts.
      docs: (draft.project.docs || [])
        .filter((d) => d && d.name && d.content)
        .slice(0, 8)
        .map((d) => ({ name: String(d.name).replace(/[/\\]/g, '-'), content: String(d.content).slice(0, 120_000) })),
    },
    type: draft.type,
    typeLabel: (getType(catalogue, draft.type) || {}).label,
    framework: draft.framework,
    stack,
    customCommands: { ...draft.customCommands },
    modules,
    languages: [...(draft.languages || ['en'])],
  };
}

const SECRET_KEY_PATTERN = /secret|token|password|credential|api[-_]?key|value/i;

export function assertNoSecrets(obj, label = 'answer file') {
  const walk = (node, path) => {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (SECRET_KEY_PATTERN.test(k) && !['githubSecrets', 'env'].includes(k)) {
          // Field names that *reference* secret names are fine; values are not stored here.
          if (typeof v === 'string' && v.length > 0 && !/^[A-Z0-9_]+$/.test(v)) {
            throw new Error(`${label}: field "${path}${k}" looks like it holds a secret value`);
          }
        }
        walk(v, `${path}${k}.`);
      }
    }
  };
  walk(obj, '');
  return true;
}

export function writeDraft(home, draft) {
  mkdirSync(home, { recursive: true });
  assertNoSecrets(draft, 'draft');
  writeFileSync(draftFile(home), JSON.stringify(draft, null, 2));
  return draftFile(home);
}

export function readDraft(home) {
  const p = draftFile(home);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveDefaults(home, draft) {
  // Model ids and preferences only. Never secrets.
  const defaults = {
    schema: 'devos/defaults@1',
    savedAt: new Date().toISOString(),
    models: JSON.parse(JSON.stringify(draft.models)),
    visibility: draft.project.visibility || 'private',
    languages: [...(draft.languages || ['en'])],
    saveDefaults: true,
  };
  mkdirSync(home, { recursive: true });
  assertNoSecrets(defaults, 'defaults');
  writeFileSync(defaultsFile(home), JSON.stringify(defaults, null, 2));
  return defaultsFile(home);
}

export function readDefaults(home) {
  const p = defaultsFile(home);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function writeAnswers(home, answers) {
  const dir = answersDir(home);
  mkdirSync(dir, { recursive: true });
  assertNoSecrets(answers);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = String(answers.project?.slug || 'project').replace('/', '-');
  const p = join(dir, `${slug}-${stamp}.json`);
  writeFileSync(p, JSON.stringify(answers, null, 2));
  return p;
}
