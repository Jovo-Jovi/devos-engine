import { loadCatalogue } from './catalogue.mjs';

// Builds the one-shot prompt for the configuration model. The answer file is the only
// source of product choice; the catalogue only points at templates.
export function buildConfigPrompt({ answers, answersPath, projectDir, payloadDir }) {
  const catalogue = loadCatalogue();
  const type = catalogue.types.find((t) => t.id === answers.type);
  const arch = answers.stack?.arch || 'web';
  const on = Object.entries(answers.modules).filter(([, v]) => v.on);
  const off = Object.entries(answers.modules).filter(([, v]) => !v.on);
  const reviewer = answers.models.reviewer;
  const builder = answers.models.builder;
  const configModel = answers.models.configurationModel;
  const [owner, slug] = String(answers.project.slug).split('/');

  const moduleLines = catalogue.modules.map((m) => {
    const s = answers.modules[m.id] || { on: false };
    const detail = s.provider && s.provider !== 'none' ? ` provider=${s.provider}${s.impl ? ` impl=${s.impl}` : ''}` : '';
    const impl = s.playwright !== undefined ? ` playwright=${s.playwright}` : '';
    return `- ${m.id}: ${s.on ? 'ON' : 'off'}${detail}${impl} — templates at ${payloadDir}/modules/${m.id}/`;
  }).join('\n');

  const docs = answers.project.docs || [];
  const docsSection = docs.length
    ? `
REFERENCE DOCUMENTATION (attached by the user, already saved at ${projectDir}/devos/intake-docs/):
${docs.map((d) => `- devos/intake-docs/${d.name} (${d.content.length} characters)`).join('\n')}
Read every attached document before you build. Compare the documents with the answers:
- Where a document and the answers disagree, the answers win.
- Anything the product needs that neither the answers nor the documents provide (pricing, providers, domains, integrations, languages, edge cases) goes into devos/OPEN_QUESTIONS.md — one question per line, addressed to the user — and is listed in the setup issue. Never invent product facts to fill a gap.
- The bootstrap still completes; OPEN_QUESTIONS.md is how missing information travels back to the user for an answer.
- If the documents answer everything, still write devos/OPEN_QUESTIONS.md with the single line "No open questions."
`
    : '';

  return `You are the DEV_OS configuration model. You run exactly once, now. You never build later tasks; after GitHub exists, the project's own reviewer and builder models continue inside GitHub Actions.

PROJECT DIRECTORY: ${projectDir}
Write only inside it. It already contains devos/answers.json.

ANSWER FILE: ${answersPath}
It is the only source of product choice. Never swap the framework. Never add a module the answers turned off. Never drop a module the answers turned on.

CORE MODULE TEMPLATES: ${payloadDir}/modules/<id>/
Copy a module's template files into the project only when that module is ON in the answers. Wire each active module into config, .env.example names, SETUP.md, and docs/ARCHITECTURE.md.

STACK: ${answers.framework} (${answers.stack?.label || 'custom'}), architecture family "${arch}", package manager ${answers.stack?.packageManager || 'npm'}.
Type: ${answers.type} (${type?.label || ''}). Product name: ${answers.project.name}. Audience: ${answers.project.audience}.
Brief: ${answers.project.brief}

YOUR TOOLS (the only ones):
- Write and edit files inside the project directory.
- Read the engine's core-module templates.
- init_github — call once, after the tree is complete. The engine creates the repository at ${answers.project.visibility} visibility, pushes main, writes repository variables for active modules, and dispatches devos-cycle.
- request_secret NAME — the human types the value into the terminal. You receive only "set" or "missing".

FORBIDDEN: raw shell, git, gh, curl, wget, rm, secret values, and calling any reviewer or builder CLI.

BUILD, in this order:
1. Stack configuration as real files: manifest and lockfile for ${answers.stack?.packageManager || 'npm'}; language config; lint config; test config; framework config (${(answers.stack?.configFiles || []).join(', ') || 'the matching file'}); .env.example with names only, one block per active module; .gitignore; .editorconfig with LF. Pin versions by running the package manager; never invent version numbers. If an official create command would prompt interactively, write the skeleton from the stack templates instead of hanging.
2. devos.config.json and devos/project.json from the answers: base branch main, max attempts 3, reviewer ${reviewer.cli} with exact model id ${reviewer.model}, light reviewer (${answers.models.lightReviewer.same ? 'same as the reviewer' : `${answers.models.lightReviewer.cli} ${answers.models.lightReviewer.model}`}), default builder ${builder.cli} with model ${builder.model}, builder pool ${JSON.stringify([builder, ...(answers.models.extraBuilders || [])].map((b) => ({ cli: b.cli, model: b.model })))}, pick policy ${answers.models.pickPolicy}, required checks from the stack commands, active modules, hosting ${answers.modules.hosting?.provider || 'none'}. devos/project.json stores configurationModel ${configModel.cli} ${configModel.model} with stage "configuration-only". No personal repository name and no control-tower hostname anywhere.
3. Codebase architecture that typechecks, plus docs/ARCHITECTURE.md with the folder map, the dependency direction, and which module lives in which folder. Folders and entry files for a "${arch}" project (see the templates under ${payloadDir}/architecture/${arch}/). The health route returns 200. Include the architecture test that fails if a UI file imports the database. Each present server module exports a typed function that throws a clear "not configured" error until a later task implements it. Inactive modules leave no folders.
4. Automation module (always on), copying templates from ${payloadDir}/modules/automation/: .github/workflows/ (devos-cycle.yml, devos-intake.yml, devos-advance.yml, devos-doctor.yml, devos-resume.yml, devos-setup.yml, devos-deploy.yml, ci.yml, devos-wait.yml, devos-supervisor.yml), scripts/devos/, scripts/guards/, devos/prompts/ (builder.md, reviewer.md, intake.md, revise.md), docs/PHASES.md with T01 not done, devos/fences/T01.md whose header sets "Reviewer: ${reviewer.cli} ${reviewer.model}" and "Builder: ${builder.cli} ${builder.model}" and never names the configuration model as either, issue forms for a change request and a method fix, docs/method/AUTOMATION.md naming every workflow, script, label, and variable, and SETUP.md with secret names and where to get them. T01 tells the builder to implement the first vertical slice inside the existing architecture and not to re-scaffold.
5. Product documents: docs/PRODUCT_BRIEF.md, docs/SCOPE.md, docs/DECISIONS.md, docs/GLOSSARY.md, docs/BOUNDARY_MODEL.md${type?.ui ? ', docs/DESIGN_SYSTEM.md' : ''}. DECISIONS must record the type, the framework, each active module, the reviewer id ${reviewer.model}, the builder id ${builder.model}, and the configuration-model id ${configModel.model}. The glossary uses this project's own words.
6. Report progress while you work: print one JSON line per file written: {"event":"file","path":"relative/path"} and one JSON line per module included: {"event":"module","id":"module-id"}. Print plain sentences for anything else.
7. When the tree is complete, call init_github once. Then call request_secret for each secret name the project needs: only secrets for the GitHub reviewer tool (${(answers.models.reviewer.cli)}), the GitHub builder tool (${answers.models.builder.cli}), and modules that are ON. Never request a secret for yourself (${configModel.model}); you do not run on GitHub. The human types each value into the terminal; you never see one. If a request_secret comes back "missing" or the human is away, do not retry more than once: continue the bootstrap, list the missing names in SETUP.md and in the setup issue, and tell the user to run devos keys --check after setting them.
8. End your run with exactly this line:
devos init: ${owner}/${slug} is set up; devos-cycle dispatched.

MODULE STATE:
${moduleLines}
${docsSection}
Modules that are OFF (leave no folders, no env names, no docs claims): ${off.map(([id]) => id).join(', ') || 'none'}.

ANSWERS (verbatim):
${JSON.stringify(answers, null, 2)}
`;
}
