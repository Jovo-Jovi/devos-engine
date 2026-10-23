// devos fix — the model-executed half of the verify -> fix loop.
// The audit splits every problem into "you fix" (logins, plans, key values — never
// sent anywhere) and "model fixes" (problems inside the project folder). Only the
// second group goes back to the configuration model, in the same restricted
// environment init used. Afterwards the project is re-audited and whatever remains
// is reported with its owner, so the loop always ends in a step list, never a dead end.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAgents } from './probes.mjs';
import { runRepairModel } from './configmodel.mjs';
import { auditSetup, buildRepairPrompt } from './verify.mjs';

function resolveAgent(cliId) {
  if (String(cliId).startsWith('custom:')) return null;
  const agents = detectAgents();
  return agents.find((a) => a.toolId === cliId) || null;
}

export async function runFix({ projectDir, overrides = {}, emit = () => {}, env = process.env, shouldStop = null }) {
  const answersPath = join(projectDir, 'devos', 'answers.json');
  if (!existsSync(answersPath)) {
    throw new Error(`No answer file at ${answersPath}. devos fix repairs an existing DEV_OS project.`);
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

  const before = auditSetup({ projectDir, answers });
  if (!before.modelSteps.length) {
    return {
      ok: before.ready, modelRan: false, before, after: before, answers, projectDir,
      message: before.ready
        ? 'Everything is already in place — nothing to fix.'
        : 'Nothing here needs the model. The remaining steps are yours (logins, plans, or key values) — see the list above.',
    };
  }

  const prompt = buildRepairPrompt({ projectDir, answers, audit: before });
  const result = await runRepairModel({ projectDir, answers, agent, prompt, emit, env, shouldStop });
  const after = auditSetup({ projectDir, answers });
  return {
    ok: Boolean(result.ok) && after.modelSteps.length === 0,
    modelRan: true,
    result,
    before,
    after,
    answers,
    projectDir,
    message: result.ok
      ? `The model finished its repair pass. ${after.modelSteps.length ? 'Re-audit found more model-fixable work — run devos fix again.' : 'Re-audit: no model-fixable problems remain.'}`
      : result.message,
  };
}

// Text report for the terminal: before -> what the model did -> what remains.
export function printFixReport(fixResult) {
  const { before, after, modelRan } = fixResult;
  const lines = [];
  lines.push('DEVOS fix — before:');
  lines.push(printBlock(before));
  if (modelRan) {
    lines.push('');
    lines.push(`Model repair pass: ${fixResult.result.ok ? 'finished' : `stopped — ${fixResult.message}`}`);
  } else {
    lines.push('');
    lines.push(`No model run: ${fixResult.message}`);
  }
  lines.push('');
  lines.push('DEVOS fix — after:');
  lines.push(printBlock(after));
  return lines.join('\n');

  function printBlock(audit) {
    if (audit.ready) return '  Ready. Nothing blocks a fully configured stack and repository.';
    const out = [];
    for (const s of [...audit.youSteps, ...audit.modelSteps]) {
      out.push(`  [${s.who === 'model' ? 'model' : 'you'}] ${s.label}: ${s.detail}`);
      if (s.fix) out.push(`      fix: ${s.fix}`);
    }
    return out.join('\n');
  }
}
