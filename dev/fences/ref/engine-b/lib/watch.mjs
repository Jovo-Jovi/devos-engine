// devos watch — test everything at once, then keep testing until it is all green.
// One pass is the FULL audit (machine, gh, per-CLI accounts and models, project
// guards, repository, workflows, secrets) — exactly the rows `devos verify` prints.
// Between passes the engine re-reads the answer file and re-probes the machine, so
// fixes applied by you (logins, secrets, plan switches) or by the model (devos fix)
// are picked up automatically on the next pass. The watch ends on the first
// all-green pass: there is nothing left to watch. Rows whose state changed since
// the previous pass are marked with a leading `*` so the effect of a fix is visible.
import { auditSetup } from './verify.mjs';
import { readAnswersFromProject } from './keys.mjs';

export function printWatchPass({ pass, audit, changed, intervalMs, final }) {
  const lines = [];
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const changedNote = changed.length ? ` · ${changed.length} changed` : '';
  lines.push(`pass ${pass} · ${stamp}${changedNote}`);
  const changedKeys = new Set(changed.map((r) => `${r.section}/${r.label}`));
  let section = null;
  for (const r of audit.rows) {
    if (r.section !== section) {
      section = r.section;
      lines.push('');
      lines.push(`${section.toUpperCase()}`);
    }
    const mark = r.state === 'ok' ? ' ok ' : r.state === 'warn' ? 'warn' : 'STOP';
    const flag = changedKeys.has(`${r.section}/${r.label}`) ? '*' : ' ';
    lines.push(` ${flag}[${mark}] ${r.label}: ${r.detail}`);
    if (r.state !== 'ok' && r.fix) lines.push(`        fix: ${r.fix}`);
  }
  lines.push('');
  if (final && audit.ready) {
    lines.push('ALL GREEN — machine, GitHub, accounts, and the project are fully configured. Watch stops here.');
  } else if (final) {
    lines.push(`Still not ready after ${pass} pass${pass === 1 ? '' : 'es'}: ${audit.youSteps.length} for you, ${audit.modelSteps.length} for the model.`);
    if (audit.modelSteps.length) lines.push(`The model-fixable ones can be applied for you: devos fix <folder>`);
  } else {
    const wait = Math.max(1, Math.round(intervalMs / 1000));
    lines.push(`Not ready: ${audit.youSteps.length} for you, ${audit.modelSteps.length} for the model — next pass in ${wait}s (Ctrl+C to stop).`);
    if (audit.modelSteps.length) lines.push(`The model-fixable ones can be applied for you: devos fix <folder> — the watch picks the result up on its own.`);
  }
  return lines.join('\n');
}

// The watch loop. `audit`, `readAnswers`, and `sleepFn` are injectable so tests run
// instantly against fakes; the CLI path uses the real audit and a real timer.
// Returns { ready, passes, audit } — ready=true exactly when a pass had no blockers.
export async function runWatch({
  projectDir = null,
  intervalMs = 15000,
  maxPasses = Infinity,
  audit = null,
  readAnswers = null,
  sleepFn = null,
  onPass = null,
  out = (line) => console.log(line),
} = {}) {
  const sleep = sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const auditFn = audit || ((answers) => auditSetup({ projectDir, answers }));
  const answersFn = readAnswers || (() => (projectDir ? readAnswersFromProject(projectDir) : null));
  const lastState = new Map(); // section/label -> previous state
  let pass = 0;
  let last = null;
  let slept = 0;
  while (pass < maxPasses) {
    pass++;
    const answers = answersFn();
    last = await auditFn(answers);
    const changed = [];
    for (const r of last.rows) {
      const key = `${r.section}/${r.label}`;
      const prev = lastState.get(key);
      if (prev !== undefined && prev !== r.state) changed.push(r);
      lastState.set(key, r.state);
    }
    const final = last.ready || pass >= maxPasses;
    const passInfo = { pass, audit: last, changed, intervalMs, final };
    if (onPass) onPass(passInfo);
    else out(printWatchPass(passInfo));
    if (last.ready) return { ready: true, passes: pass, audit: last, slept };
    if (final) return { ready: false, passes: pass, audit: last, slept };
    await sleep(intervalMs);
    slept++;
  }
  return { ready: false, passes: pass, audit: last, slept };
}
