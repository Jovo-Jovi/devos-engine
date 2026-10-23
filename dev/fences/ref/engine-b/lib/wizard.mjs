import { loadCatalogue, loadStack, getType, getModule } from './catalogue.mjs';

export const STEPS = [
  { id: 'machine', title: 'Machine check' },
  { id: 'intro', title: 'How this works' },
  { id: 'models', title: 'Models' },
  { id: 'project', title: 'Project' },
  { id: 'type', title: 'Project type' },
  { id: 'framework', title: 'Framework' },
  { id: 'modules', title: 'Core modules' },
  { id: 'languages', title: 'Languages' },
  { id: 'summary', title: 'Summary' },
];

// A row is required when its "Next" gate must block. Reviewer, builder and configuration
// model each need a tool and a model id before the wizard can leave the models step.
export function modelsReadiness(draft) {
  const m = draft.models || {};
  const rowOk = (r) => Boolean(r && r.cli && r.model);
  const problems = [];
  if (!rowOk(m.reviewer)) problems.push('Pick a reviewer tool and model.');
  if (!rowOk(m.builder)) problems.push('Pick a builder tool and model.');
  if (!rowOk(m.configurationModel)) problems.push('Pick a configuration model.');
  for (const eb of m.extraBuilders || []) {
    if (!eb.cli || !eb.model) problems.push('Every extra builder needs a tool and a model id.');
  }
  return { ready: problems.length === 0, problems };
}

export function reviewerOptions(agents) {
  // GitHub-capable tools only: after GitHub exists, the reviewer must run there.
  return agents.filter((a) => a.status === 'installed' && a.githubCapable && a.promptTemplate);
}

export function builderOptions(agents) {
  return reviewerOptions(agents);
}

export function configurationModelOptions(agents) {
  // Any installed tool may be the configuration model, including local-only tools
  // without a non-interactive prompt template. Only GitHub-capable tools may be the
  // reviewer or the builder.
  return agents.filter((a) => a.status === 'installed');
}

// The configuration model runs once and writes the whole project, so it should be
// the strongest reasoning model signed in on this computer. Preference follows the
// vendors' own positioning (Fable for autonomous work, then the top coding tiers);
// every candidate must be in the tool's visible groups so the id is real.
const CONFIG_PICKS = [
  ['claude', ['claude-fable-5-1', 'claude-fable-5-1-thinking-high', 'claude-fable-5', 'claude-opus-5-5']],
  ['cursor', ['claude-fable-5-1', 'claude-fable-5', 'grok-4.7-xhigh', 'grok-4.7']],
  ['codex', ['gpt-5.1-codex', 'gpt-5-codex', 'gpt-5.6-sol']],
  ['gemini', ['gemini-4-argon', 'gemini-3.1-pro']],
  ['glm', ['glm-5', 'glm-4.6']],
  ['muse', ['muse-wonder']],
];

export function recommendedConfiguration(agents) {
  for (const [cli, models] of CONFIG_PICKS) {
    const a = agents.find((x) => x.status === 'installed' && x.toolId === cli);
    if (!a) continue;
    const ids = (a.groups || []).flatMap((g) => g.models.map((m) => m.id));
    const id = models.find((m) => ids.includes(m));
    if (id) return { cli, model: id, label: a.label };
  }
  return null;
}

export function selfGradingWarning(draft) {
  const r = draft.models?.reviewer;
  const b = draft.models?.builder;
  if (r?.cli && b?.cli && r.cli === b.cli && r.model === b.model) {
    return 'This model would be grading its own work. You can continue.';
  }
  return null;
}

export function validateProject(draft) {
  const errors = [];
  const p = draft.project || {};
  if (!p.name || !String(p.name).trim()) errors.push('Project name is required.');
  const slug = String(p.slug || '');
  if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(slug)) errors.push('Slug must look like owner/name.');
  if (!p.brief || String(p.brief).trim().length < 20) errors.push('Write a one-paragraph brief (at least 20 characters).');
  if (!p.audience || !String(p.audience).trim()) errors.push('Say who the product is for.');
  if (!['private', 'public'].includes(p.visibility)) errors.push('Visibility must be private or public.');
  return { ok: errors.length === 0, errors };
}

export function validateFramework(draft) {
  if (draft.framework === 'custom') {
    const c = draft.customCommands || {};
    const missing = ['install', 'typecheck', 'lint', 'test', 'build'].filter((k) => !String(c[k] || '').trim());
    if (missing.length) return { ok: false, errors: [`Custom framework needs commands: ${missing.join(', ')}.`] };
    return { ok: true, errors: [] };
  }
  const stack = loadStack(draft.framework);
  if (!stack) return { ok: false, errors: [`Unknown framework ${draft.framework}.`] };
  return { ok: true, errors: [] };
}

export function validateModules(draft) {
  const catalogue = loadCatalogue();
  const errors = [];
  const type = getType(catalogue, draft.type);
  const stack = loadStack(draft.framework);
  const mods = draft.modules || {};
  if (!mods.automation?.on) errors.push('The automation module is always on.');
  const lang = mods.language?.provider;
  if (lang && stack && !stack.languages.includes(lang)) {
    errors.push(`Language ${lang} does not match framework ${draft.framework} (${stack.languages.join(', ')}).`);
  }
  if (type && !type.ui) {
    if (mods.styling?.on) errors.push(`${type.label} has no web UI; turn the styling module off.`);
    if (mods['ui-kit']?.on) errors.push(`${type.label} has no web UI; turn the ui-kit module off.`);
  }
  if (mods.database?.provider === 'none' && mods.database?.on) errors.push('Database is on but its provider is none. Pick a provider or turn it off.');
  if (mods.search?.provider === 'postgres-fts') {
    const db = mods.database?.provider;
    if (!mods.database?.on || !['supabase', 'neon', 'postgres'].includes(db)) {
      errors.push('Postgres full text search needs the database module with Postgres on.');
    }
  }
  if (mods.auth?.impl === 'supabase-auth' && !(mods.database?.on && mods.database?.provider === 'supabase')) {
    errors.push('Supabase Auth is only available with the Supabase database.');
  }
  if (mods.auth?.impl === 'firebase-auth' && !(mods.database?.on && mods.database?.provider === 'firebase')) {
    errors.push('Firebase Auth is only available with the Firebase database.');
  }
  if (mods.storage?.on && mods.storage?.provider === 'supabase-storage' && !(mods.database?.on && mods.database?.provider === 'supabase')) {
    errors.push('Supabase Storage is only available with the Supabase database.');
  }
  if (mods.storage?.on && mods.storage?.provider === 'firebase-storage' && !(mods.database?.on && mods.database?.provider === 'firebase')) {
    errors.push('Firebase Storage is only available with the Firebase database.');
  }
  if (mods['ui-kit']?.provider === 'shadcn' && !['next', 'remix', 'vite-react'].includes(draft.framework)) {
    errors.push('shadcn/ui needs a React framework.');
  }
  if (mods['ui-kit']?.provider === 'skeleton' && draft.framework !== 'sveltekit') {
    errors.push('Skeleton needs SvelteKit.');
  }
  return { ok: errors.length === 0, errors };
}

export function validateLanguages(draft) {
  const langs = (draft.languages || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (!langs.length) return { ok: false, errors: 'Keep at least one language code (default en).' };
  if (new Set(langs).size !== langs.length) return { ok: false, errors: 'Language codes must be unique.' };
  return { ok: true, languages: langs, errors: [] };
}

export function validateStep(stepId, draft) {
  switch (stepId) {
    case 'models': return modelsReadiness(draft);
    case 'project': return validateProject(draft);
    case 'framework': return validateFramework(draft);
    case 'modules': return validateModules(draft);
    case 'languages': return validateLanguages(draft);
    default: return { ok: true, errors: [] };
  }
}

export function summaryRows(draft) {
  const catalogue = loadCatalogue();
  const type = getType(catalogue, draft.type);
  const stack = loadStack(draft.framework);
  const m = draft.models || {};
  const rows = [
    { step: 'models', label: 'Reviewer', value: m.reviewer?.model ? `${m.reviewer.cli} · ${m.reviewer.model}` : null },
    { step: 'models', label: 'Builder (default)', value: m.builder?.model ? `${m.builder.cli} · ${m.builder.model}` : null },
    { step: 'models', label: 'Extra builders', value: (m.extraBuilders || []).length ? (m.extraBuilders || []).map((b) => `${b.cli} · ${b.model} (${b.strength || 'ui'})`).join('; ') : 'none' },
    { step: 'models', label: 'Light reviewer', value: m.lightReviewer?.same ? 'same as the reviewer' : (m.lightReviewer?.model ? `${m.lightReviewer.cli} · ${m.lightReviewer.model}` : null) },
    { step: 'models', label: 'Who picks the builder', value: (catalogue.pickPolicies.find((p) => p.id === m.pickPolicy) || catalogue.pickPolicies[0]).label },
    { step: 'models', label: 'Configuration model', value: m.configurationModel?.model ? `${m.configurationModel.cli} · ${m.configurationModel.model} (runs once, at init)` : null },
    { step: 'project', label: 'Name', value: draft.project?.name || null },
    { step: 'project', label: 'Repository', value: draft.project?.slug ? `${draft.project.slug} (${draft.project.visibility})` : null },
    { step: 'project', label: 'Brief', value: draft.project?.brief || null },
    { step: 'project', label: 'Audience', value: draft.project?.audience || null },
    { step: 'type', label: 'Project type', value: type ? `${type.label} — ${type.line}` : null },
    { step: 'framework', label: 'Framework', value: stack ? stack.label : draft.framework },
    { step: 'modules', label: 'Core modules', value: activeModuleSummary(draft) },
    { step: 'languages', label: 'Languages', value: (draft.languages || []).join(', ') },
  ];
  return rows;
}

export function activeModuleSummary(draft) {
  const catalogue = loadCatalogue();
  const out = [];
  for (const m of catalogue.modules) {
    const s = draft.modules?.[m.id];
    if (!s) continue;
    if (m.id === 'automation') { out.push('automation (always on)'); continue; }
    if (m.id === 'testing') {
      const bits = ['unit'];
      if (s.playwright) bits.push('playwright');
      out.push(`testing: ${bits.join(' + ')}`);
      continue;
    }
    if (m.id === 'i18n') {
      out.push(`languages: ${(draft.languages || []).join(', ')}`);
      continue;
    }
    if (s.on && s.provider && s.provider !== 'none') {
      const impl = s.impl && s.impl !== 'none' ? ` (${s.impl})` : '';
      out.push(`${m.id}: ${s.provider}${impl}`);
    }
  }
  return out.join(', ');
}

// Secrets the Keys moment will ask for: GitHub reviewer tool, GitHub builder tool,
// and modules that are on. The configuration model never gets an Actions secret.
export function requiredSecretNames(draft, agents) {
  const catalogue = loadCatalogue();
  const names = [];
  const toolSecrets = (cli) => {
    const tool = catalogue.tools.find((t) => t.id === cli || t.command === cli || (t.altCommands || []).includes(cli));
    return tool?.githubSecrets || [];
  };
  const reviewer = toolSecrets(draft.models?.reviewer?.cli);
  if (reviewer.length) names.push(...reviewer);
  const builder = toolSecrets(draft.models?.builder?.cli);
  for (const n of builder) if (!names.includes(n)) names.push(n);
  for (const m of catalogue.modules) {
    const s = draft.modules?.[m.id];
    if (!s?.on) continue;
    let provider = (m.providers || []).find((p) => p.id === s.provider);
    if (m.id === 'auth' && s.impl) {
      const impl = (m.implProviders || []).find((p) => p.id === s.impl);
      for (const e of impl?.env || []) if (!names.includes(e)) names.push(e);
    }
    if (m.id === 'product-ai' && s.impl) {
      const impl = (m.implProviders || []).find((p) => p.id === s.impl);
      for (const e of impl?.env || []) if (!names.includes(e)) names.push(e);
    }
    for (const e of provider?.env || []) if (!names.includes(e)) names.push(e);
  }
  const hosting = draft.modules?.hosting;
  if (hosting?.on && hosting.provider && hosting.provider !== 'none') {
    const h = getModule(catalogue, 'hosting');
    const p = (h.providers || []).find((x) => x.id === hosting.provider);
    for (const e of p?.env || []) if (!names.includes(e)) names.push(e);
  }
  return names;
}
