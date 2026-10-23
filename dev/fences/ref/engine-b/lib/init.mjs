import { mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeAnswers, writeAnswers, saveDefaults } from './answers.mjs';
import { runConfigurationModel } from './configmodel.mjs';
import { detectAgents } from './probes.mjs';
import { lastProjectFile } from './paths.mjs';

// Confirm is the first moment a project folder may exist.
export function createProjectFolder(workspace, slug) {
  const name = String(slug).split('/')[1];
  if (!name) throw new Error(`Slug "${slug}" must look like owner/name.`);
  const dir = join(workspace, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveAgent(cliId) {
  if (String(cliId).startsWith('custom:')) return null; // resolved from answers.agent below
  const agents = detectAgents();
  return agents.find((a) => a.toolId === cliId) || null;
}

// The user's attached documents land in the project before the configuration
// model starts, so it can read them with its ordinary file tools.
export function writeIntakeDocs(projectDir, docs) {
  if (!Array.isArray(docs) || !docs.length) return 0;
  const dir = join(projectDir, 'devos', 'intake-docs');
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const d of docs) {
    if (!d || !d.name || !d.content) continue;
    const safe = String(d.name).replace(/[/\\]/g, '-').replace(/^\.+/, '').slice(0, 120) || `doc-${n + 1}.md`;
    writeFileSync(join(dir, safe), String(d.content));
    n += 1;
  }
  return n;
}

export async function runInit({ draft, home, workspace, emit = () => {}, shouldStop = null }) {
  const answers = finalizeAnswers(draft);
  const answersPath = writeAnswers(home, answers); // under ~/.devos, no secrets by construction
  if (draft.saveDefaults) saveDefaults(home, draft);
  const projectDir = createProjectFolder(workspace, answers.project.slug);
  mkdirSync(join(projectDir, 'devos'), { recursive: true });
  copyFileSync(answersPath, join(projectDir, 'devos', 'answers.json'));
  writeIntakeDocs(projectDir, answers.project.docs);
  writeFileSync(lastProjectFile(home), JSON.stringify({
    path: projectDir, slug: answers.project.slug, at: new Date().toISOString(),
  }, null, 2));

  const cm = answers.models.configurationModel;
  let agent = resolveAgent(cm.cli);
  if (!agent && cm.agent) agent = { ...cm.agent, status: 'installed' };
  if (!agent) throw new Error(`The configuration model CLI "${cm.cli}" is not installed on this computer.`);

  const result = await runConfigurationModel({ projectDir, answers, answersPath, agent, emit, shouldStop });
  return { result, projectDir, answers };
}

// devos init --continue <folder>: resume at the configuration model without asking again.
// overrides ({ cli, model }) patch the saved configuration-model choice first — the escape
// hatch when the saved model cannot run (plan walls, uninstalled CLI) and the answer is
// Auto or a different tool. Overrides are persisted so later resumes keep them.
export async function resumeInit({ projectDir, overrides = {}, emit = () => {}, shouldStop = null }) {
  const answersPath = join(projectDir, 'devos', 'answers.json');
  if (!existsSync(answersPath)) {
    throw new Error(`No answer file at ${answersPath}. Run devos init in an empty folder instead.`);
  }
  const answers = JSON.parse(readFileSync(answersPath, 'utf8'));
  const cm = answers.models.configurationModel;
  if (overrides.cli) cm.cli = overrides.cli;
  if (overrides.model) cm.model = overrides.model;
  if (overrides.cli || overrides.model) {
    writeFileSync(answersPath, JSON.stringify(answers, null, 2));
  }
  let agent = resolveAgent(cm.cli);
  if (!agent && cm.agent) agent = { ...cm.agent, status: 'installed' };
  if (!agent) throw new Error(`The configuration model CLI "${cm.cli}" is not installed on this computer.`);
  const result = await runConfigurationModel({ projectDir, answers, answersPath, agent, emit, shouldStop });
  return { result, projectDir, answers };
}
