import readline from 'node:readline/promises';
import { loadCatalogue, stackCards, frameworksForType, getType } from './catalogue.mjs';
import { detectAgents } from './probes.mjs';
import { machineCheck } from './doctor.mjs';
import { defaultDraft, applyType, applyFramework, slugify, finalizeAnswers } from './answers.mjs';
import { modelsReadiness, validateProject, validateFramework, validateModules, validateLanguages, recommendedConfiguration } from './wizard.mjs';
import { collectDocs } from './docs.mjs';

// Terminal fallback: the same steps as the guided UI, as a numbered list.
export async function runTerminalWizard({ home, stdin = process.stdin, stdout = process.stdout }) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const say = (s) => stdout.write(`${s}\n`);
  const ask = async (q) => (await rl.question(q)).trim();
  const pick = async (label, options, allowEmpty = false) => {
    say(label);
    if (!options.length) {
      say('  (No options available.)');
      return null;
    }
    options.forEach((o, i) => say(`  ${i + 1}. ${o.text}`));
    while (true) {
      const a = await ask(`Choose 1-${options.length}${allowEmpty ? ', or Enter to skip' : ''}: `);
      if (allowEmpty && a === '') return null;
      const n = Number(a);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
      say('  Pick a number from the list.');
    }
  };

  const draft = defaultDraft();
  const catalogue = loadCatalogue();
  const machine = machineCheck();
  say('');
  say('DEV_OS — configuration stage.');
  for (const b of machine.blocks) say(`Blocker: ${b}`);
  if (!machine.ready) { rl.close(); return null; }

  say('');
  say('You choose the reviewer, the builder, and the configuration model.');
  say('You choose the project type and the core modules.');
  say('The configuration model writes the project from those answers and creates the GitHub repository.');
  say('GitHub Actions then continues with the reviewer and the builder. Secret values are typed only into gh\'s own prompt.');
  say('');

  const agents = detectAgents();
  const ghAgents = agents.filter((a) => a.status === 'installed' && a.githubCapable && a.promptTemplate);
  const anyAgents = agents.filter((a) => a.status === 'installed' && a.promptTemplate);

  const pickModelRow = async (key, label, list) => {
    say('');
    say(label);
    const tool = await pick('Tools:', list.map((a) => ({ text: `${a.label} — ${a.githubCapable ? 'Runs on GitHub' : 'This computer only'}`, a })));
    if (!tool) return null;
    const models = (tool.a.groups || []).flatMap((g) => g.models.map((m) => ({ text: `${m.id}${m.reported ? ' (reported by the CLI)' : ''} [${g.label}]`, id: m.id })));
    let model = await pick('Models:', models);
    if (!model) {
      // A CLI that reports no model list: the id is typed by hand.
      const typed = await ask('No model list available. Type a model id (Enter to cancel this row): ');
      if (!typed) return null;
      model = { id: typed };
    }
    return { cli: tool.a.toolId, model: model.id };
  };

  draft.models.reviewer = await pickModelRow('reviewer', '1. Reviewer — after GitHub exists, this model reviews every task and writes the next task. It must be able to run on GitHub.', ghAgents);
  draft.models.builder = await pickModelRow('builder', '2. Builder — after GitHub exists, this model writes the code. This row is the default builder.', ghAgents);
  const more = await ask('Add another builder? (y/N): ');
  if (/^y/i.test(more)) {
    const extra = await pickModelRow('extra', 'Extra builder:', ghAgents);
    if (extra) {
      draft.models.extraBuilders.push(extra);
      const s = await pick('Strength:', catalogue.builderStrengths.map((x) => ({ text: x, id: x })));
      if (s) draft.models.extraBuilders[0].strength = s.id;
    }
  }
  const light = await ask('3. Light reviewer — Enter keeps "same as the reviewer", or type a model id after choosing a tool (y to choose): ');
  if (/^y/i.test(light)) {
    const row = await pickModelRow('light', 'Light reviewer:', ghAgents);
    if (row) draft.models.lightReviewer = { same: false, ...row };
  }
  const policy = await pick('4. Who picks the builder on later tasks:', catalogue.pickPolicies.map((p) => ({ text: p.label, id: p.id })));
  if (policy) draft.models.pickPolicy = policy.id;
  const confTool = ghAgents.find((a) => a.toolId === draft.models.reviewer.cli);
  const rec = recommendedConfiguration(agents);
  const confDefault = rec || (confTool ? { cli: draft.models.reviewer.cli, model: draft.models.reviewer.model } : null);
  const confHint = confDefault
    ? `Enter keeps ${confDefault.cli} ${confDefault.model}${rec ? ' (recommended — best start results)' : ''}, or y to choose`
    : 'y to choose (nothing to keep yet)';
  const useDefault = await ask(`5. Configuration model — ${confHint}: `);
  if (/^y/i.test(useDefault)) {
    const picked = await pickModelRow('config', 'Configuration model — only tools installed and signed in on this computer. A local-only tool is allowed here.', anyAgents);
    if (picked) draft.models.configurationModel = picked;
  } else if (confDefault) {
    draft.models.configurationModel = { cli: confDefault.cli, model: confDefault.model };
  }
  if (draft.models.configurationModel.cli === draft.models.reviewer.cli && draft.models.configurationModel.model === draft.models.reviewer.model && draft.models.builder.cli === draft.models.reviewer.cli && draft.models.builder.model === draft.models.reviewer.model) {
    say('This model would be grading its own work. You can continue.');
  }
  const ready = modelsReadiness(draft);
  if (!ready.ready) { say(ready.problems.join(' ')); rl.close(); return null; }

  const saveD = await ask('Save these models as the default for the next project? (y/N): ');
  draft.saveDefaults = /^y/i.test(saveD);

  say('');
  draft.project.name = await ask('Project name: ');
  const slugIn = await ask('Live slug owner/name (e.g. octodev/order-desk): ');
  draft.project.slug = /\//.test(slugIn) ? slugIn : `${slugIn}`;
  draft.project.brief = await ask('One-paragraph brief: ');
  draft.project.audience = await ask('Who it is for: ');
  const vis = await pick('Visibility:', [{ text: 'private', id: 'private' }, { text: 'public', id: 'public' }]);
  if (vis) draft.project.visibility = vis.id;
  const docPathIn = await ask('Attach documentation (.md, .txt, .csv, .json — a file or a folder path; Enter to skip): ');
  if (docPathIn) {
    const found = collectDocs(docPathIn);
    draft.project.docs = found.docs;
    for (const s of found.skipped) say(`  skipped ${s}`);
    for (const e of found.errors) say(`  ${e}`);
    if (found.docs.length) {
      say(`  ${found.docs.length} document(s) attached. The configuration model reads them and collects anything missing as questions for you.`);
    }
  }
  const pv = validateProject(draft);
  if (!pv.ok) { say(pv.errors.join(' ')); rl.close(); return null; }

  const typeOpt = await pick('Project type:', catalogue.types.map((t) => ({ text: `${t.label} — ${t.line}`, id: t.id, t })));
  applyType(draft, typeOpt.id);

  const fwOpts = frameworksForType(catalogue, draft.type);
  const fw = await pick('Framework:', fwOpts.map((s) => ({ text: `${s.label} · ${s.commands.install || ''}`, id: s.id })));
  applyFramework(draft, fw.id);

  say('');
  say('Core modules. Each module off or on; turning one on shows its provider. Database, auth, and hosting are not asked again later.');
  for (const m of catalogue.modules) {
    if (m.id === 'automation') continue;
    if (m.hiddenWhenNoUi && !getType(catalogue, draft.type).ui) continue;
    if (m.id === 'language') continue;
    if (m.id === 'testing') {
      const pw = await ask(`testing: Playwright on? (Y/n): `);
      draft.modules.testing.playwright = !/^n/i.test(pw);
      continue;
    }
    const cur = draft.modules[m.id] || { on: false };
    const on = await ask(`${m.label} on? ${cur.on ? '(Y/n)' : '(y/N)'}: `);
    const isOn = cur.on ? !/^n/i.test(on) : /^y/i.test(on);
    draft.modules[m.id] = { on: isOn, provider: isOn ? (cur.provider && cur.provider !== 'none' ? cur.provider : ((m.providers || []).find((p) => p.id !== 'none') || {}).id || 'none') : 'none' };
    if (isOn && m.implProviders && (m.id === 'auth' || m.id === 'product-ai')) {
      const impl = await pick(`${m.label} implementation:`, m.implProviders.map((p) => ({ text: p.label, id: p.id })));
      draft.modules[m.id].impl = impl.id;
    }
  }

  const langs = await ask('Languages, comma-separated (default en): ');
  draft.languages = (langs || 'en').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!validateLanguages(draft).ok) draft.languages = ['en'];
  if (!validateFramework(draft).ok || !validateModules(draft).ok) { say('Answers failed validation. Run devos init again.'); rl.close(); return null; }

  const rows = finalizeAnswers(draft);
  say('');
  say('Summary');
  say(`  Reviewer: ${rows.models.reviewer.cli} ${rows.models.reviewer.model}`);
  say(`  Builder: ${rows.models.builder.cli} ${rows.models.builder.model}`);
  say(`  Configuration model: ${rows.models.configurationModel.cli} ${rows.models.configurationModel.model}`);
  say(`  Type: ${rows.type} · Framework: ${rows.framework}`);
  say(`  Name: ${rows.project.name} · ${rows.project.slug} (${rows.project.visibility})`);
  say(`  Modules: ${Object.entries(rows.modules).filter(([, v]) => v.on).map(([k]) => k).join(', ')}`);
  say(`  Languages: ${rows.languages.join(', ')}`);
  say(`  Attached docs: ${(rows.project.docs || []).length ? rows.project.docs.map((d) => d.name).join(', ') : 'none'}`);
  const ok = await ask('Confirm and create? (y/N): ');
  rl.close();
  if (!/^y/i.test(ok)) { say('Nothing was created.'); return null; }
  return draft;
}
