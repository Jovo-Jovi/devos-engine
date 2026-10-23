import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountInfo } from './accounts.mjs';
import { runToolSync } from './spawn.mjs';
import { which as findCommand } from './which.mjs';

function loadCatalogue() {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'data', 'tools.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function which(cmd) {
  const found = findCommand(cmd);
  return found ? found.path : null;
}

function run(cmd, args) {
  const r = runToolSync(cmd, args, { encoding: 'utf8', timeout: 15000 });
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

// Seeded model ids keep the catalogue label (the id). An id the CLI itself reports is marked.
export function modelLabel(model) {
  if (model.available || model.reported) return `${model.id} — on your account`;
  return model.id;
}

// Group classifier: puts a model id into a family subgroup.
export function familyOf(modelId) {
  const id = String(modelId).toLowerCase();
  if (id.startsWith('grok')) return 'grok';
  if (id.startsWith('claude') || id.startsWith('anthropic') || id.startsWith('fable')) return 'claude';
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('chatgpt') || id.startsWith('codex')) return 'gpt';
  if (id.startsWith('gemini')) return 'gemini';
  if (id.startsWith('composer')) return 'composer';
  if (id.startsWith('glm') || id.startsWith('zai')) return 'glm';
  if (id.startsWith('muse')) return 'muse';
  return 'other';
}

// Union of seeded ids and ids the CLI itself reported. Reported ids keep reported:true.
// Every model the CLI itself listed also carries available:true — that id is enabled on
// THIS account, which is exactly what the user should pick first. Groups sort available
// models to the top (stable: seeds keep their relative order otherwise).
export function groupModels(seedGroups, reportedIds) {
  const groups = new Map();
  for (const g of seedGroups) {
    groups.set(g.id, { id: g.id, label: g.label, models: g.models.map((m) => ({ id: m, reported: false, available: false })) });
  }
  const seeded = new Set([...groups.values()].flatMap((g) => g.models.map((m) => m.id)));
  const reportedSet = new Set(reportedIds.map((s) => String(s).trim()).filter(Boolean));
  for (const raw of reportedIds) {
    const id = String(raw).trim();
    if (!id) continue;
    if (seeded.has(id)) {
      for (const g of groups.values()) {
        const m = g.models.find((x) => x.id === id);
        if (m) m.available = true;
      }
      continue;
    }
    const fam = familyOf(id);
    if (!groups.has(fam)) groups.set(fam, { id: fam, label: fam === 'other' ? 'Other families reported by the CLI' : fam, models: [] });
    groups.get(fam).models.push({ id, reported: true, available: true });
  }
  for (const g of groups.values()) {
    for (const m of g.models) if (m.available && reportedSet.has(m.id) && !seeded.has(m.id)) m.reported = true;
    g.models.sort((a, b) => (b.available ? 1 : 0) - (a.available ? 1 : 0));
  }
  return [...groups.values()];
}

function authState(tool, cmd, env) {
  // Heuristic, recorded in DECISIONS.md: run the tool's auth probe when it has one;
  // otherwise treat the tool's credential env var as the sign-in signal.
  if (tool.authProbe === 'auth-status' && cmd) {
    const r = run(cmd, ['auth', 'status']);
    if (r.code === 0) return true;
    if (/not logged in|logged out|no api key|unauthenticated/i.test(r.out + r.err)) return false;
    return r.code === 0;
  }
  if (tool.authProbe === 'login-status' && cmd) {
    const r = run(cmd, ['login', 'status']);
    if (r.code === 0 && /logged (in|out)/i.test(r.out + r.err)) return !/logged out/i.test(r.out + r.err);
    return r.code === 0;
  }
  const secret = (tool.githubSecrets || [])[0];
  if (secret && env[secret]) return true;
  return Boolean(cmd);
}

// Detect every known agent CLI on this computer and, where supported, its model list.
export function detectAgents(env = process.env) {
  const catalogue = loadCatalogue();
  const agents = [];
  for (const tool of catalogue.tools) {
    let found = which(tool.command);
    if (!found) {
      for (const alt of tool.altCommands || []) {
        found = which(alt);
        if (found) break;
      }
    }
    const base = {
      toolId: tool.id,
      label: tool.label,
      command: found || tool.command,
      status: found ? 'installed' : 'missing',
      version: '',
      signedIn: false,
      githubCapable: Boolean(found) && tool.githubCapable === true,
      githubSecrets: tool.githubSecrets || [],
      promptTemplate: tool.prompt?.template || null,
      seedGroups: tool.seedGroups || [],
      reportedIds: [],
      groups: [],
      account: null,
      notInstalledMessage: tool.notInstalledMessage || null,
      optional: Boolean(tool.optional),
    };
    if (!found) {
      agents.push(base);
      continue;
    }
    const v = run(found, tool.versionArgs || ['--version']);
    base.version = (v.out || v.err).split('\n')[0].trim();
    base.signedIn = authState(tool, found, env);
    base.account = accountInfo(tool, found);
    if (tool.modelsArgs) {
      const m = run(found, tool.modelsArgs);
      if (m.code === 0 && m.out.trim()) {
        base.reportedIds = m.out.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
      }
    }
    base.groups = groupModels(base.seedGroups, base.reportedIds);
    agents.push(base);
  }
  return agents;
}

// A custom tool registered from the "Add another tool" card.
export function customAgent(fields) {
  const hasPrompt = Boolean(fields.promptTemplate);
  return {
    toolId: 'custom:' + (fields.command || fields.displayName || 'tool'),
    label: fields.displayName || fields.command || 'Custom tool',
    command: fields.command,
    status: which(fields.command) ? 'installed' : 'missing',
    version: '',
    signedIn: true,
    githubCapable: hasPrompt && Boolean(fields.secretName),
    githubSecrets: fields.secretName ? [fields.secretName] : [],
    promptTemplate: fields.promptTemplate || null,
    modelFlag: fields.modelFlag || '--model',
    usageLimitPattern: fields.usageLimitPattern || null,
    groups: [],
    localOnly: !hasPrompt,
    note: hasPrompt ? null : 'No non-interactive prompt template: this tool is This computer only.',
  };
}
