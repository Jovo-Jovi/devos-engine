// devos continue — the smart resume. Why this exists: a configuration run can end
// in every kind of middle (the model hit a usage limit, the user stopped it, the
// CLI rejected its commands, the laptop slept). Whatever is already on disk is
// KEPT, and the next `devos continue` (or `devos init --continue`, same flow now)
// must do three things in order:
//   1. Check what is done and what is missing (a printed checklist, no guessing).
//   2. Continue the next steps itself — the ENGINE runs npm install and init_github
//      built-in; a repository that already exists is adopted, never recreated. The
//      configuration model is only resumed when the tree still fails the guards.
//   3. List the secrets that only the developer can type (names, never values).
// This is the built-in answer to "the agent could not run commands": the engine
// stops depending on the model for anything that is not model work.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { validateBootstrap } from './guards.mjs';
import { engineRoot, lastProjectFile } from './paths.mjs';
import { readInitState } from './secret.mjs';
import { checkKeys, readAnswersFromProject, selectedToolSecrets, keySource } from './keys.mjs';
import { keyStatus, pushSecret, KEEP_VALUE } from './secretsflow.mjs';
import { recordSecretStatus } from './secret.mjs';
import { repairWorkflowSecrets, verifyWorkflowOnGithub, syncCycleV2 } from './wfsecrets.mjs';
import { detectAgents } from './probes.mjs';
import { runConfigurationModel } from './configmodel.mjs';
import { runInitGithub, syncRepoPush } from './initgithub.mjs';
import { consultModel } from './consult.mjs';
import { spawnTool, runToolSync } from './spawn.mjs';
import { dispatchCycle, findNewCycleRun, watchCycleRun, latestCycleRun, cycleFailedLog, diagnoseCycleLog, runKeyPresence, buildCycleReport } from './watchcycle.mjs';

const CONTINUE_STATE = join('devos', 'state', 'continue.json');

function readContinueState(projectDir) {
  try {
    return JSON.parse(readFileSync(join(projectDir, CONTINUE_STATE), 'utf8'));
  } catch { return { schema: 'devos/continue@1', steps: {} }; }
}

function recordStep(projectDir, id, extra = {}) {
  const st = readContinueState(projectDir);
  st.steps = st.steps || {};
  st.steps[id] = { at: new Date().toISOString(), ...extra };
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(join(projectDir, CONTINUE_STATE), JSON.stringify(st, null, 2));
}

// The cycle-round ledger: every dispatch or watch this engine ever did for the
// first-run goal, kept for the story it tells. Informational only — an entry
// here never blocks or skips a later round.
function appendAttempt(projectDir, entry) {
  const st = readContinueState(projectDir);
  st.steps = st.steps || {};
  const prev = st.steps['cycle-attempts'];
  const attempts = Array.isArray(prev && prev.attempts) ? prev.attempts : [];
  attempts.push({ at: new Date().toISOString(), ...entry });
  st.steps['cycle-attempts'] = { at: new Date().toISOString(), attempts };
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(join(projectDir, CONTINUE_STATE), JSON.stringify(st, null, 2));
}

const step = (id, label, state, detail = null, extra = {}) => ({ id, label, state, detail, ...extra });

// Dependency install for the written stack. The manifest must exist (the guards
// already enforce stack config files); the "installed" signal is the package
// manager's own marker, or the engine's continue-state record for managers that
// cache outside the project (go). While the tree still fails the guards the step
// WAITS — installing against a half-written tree would be wrong. Returns null
// when the stack has no install step.
function depsStep(projectDir, answers, treeOk) {
  const stack = answers.stack || {};
  const installCmd = String(stack.commands?.install || '').trim();
  const pm = String(stack.packageManager || 'npm');
  if (!installCmd) return step('deps', 'dependencies', 'done', 'no install step for this stack');
  if (!treeOk) return step('deps', 'dependencies', 'wait', 'installed after the tree passes the guards');
  const manifest = pm === 'go' ? join(projectDir, 'go.mod') : join(projectDir, 'package.json');
  if (!existsSync(manifest)) return step('deps', 'dependencies', 'done', 'no manifest in the tree — nothing to install');
  const marker = pm === 'go' ? null : join(projectDir, 'node_modules');
  const installed = (marker && existsSync(marker)) || Boolean(readContinueState(projectDir).steps?.install);
  return installed
    ? step('deps', 'dependencies', 'done', installCmd)
    : step('deps', 'dependencies', 'todo', installCmd, { who: 'devos', install: installCmd });
}

// The continue checklist: every step between "answers exist" and "fully set up",
// each with done/todo and WHO finishes it. `gh: false` keeps the check local-only
// (no gh spawns) for UI listings; the continue run itself always re-checks.
export function assessProject({ projectDir, answers = null, gh = true } = {}) {
  const steps = [];
  if (!answers) {
    answers = existsSync(join(projectDir, 'devos', 'answers.json')) ? readAnswersFromProject(projectDir) : null;
  }
  if (!answers) {
    return {
      started: false,
      steps: [step('answers', 'answers saved (devos/answers.json)', 'blocked', 'missing or not valid JSON', { who: 'you' })],
      doneCount: 0, todoCount: 1, slug: null,
    };
  }
  const slug = answers.project?.slug || 'unknown/repo';
  steps.push(step('answers', 'answers saved (devos/answers.json)', 'done'));

  const guard = validateBootstrap(projectDir, answers, { engineRoot: engineRoot() });
  steps.push(guard.ok
    ? step('tree', 'project tree passes the guards', 'done')
    : step('tree', 'project tree passes the guards', 'todo',
      `${guard.report.length} guard problem${guard.report.length > 1 ? 's' : ''}`,
      { who: 'model', report: guard.report.slice(0, 6) }));

  steps.push(depsStep(projectDir, answers, guard.ok));

  const init = readInitState(projectDir);
  steps.push(init && init.status === 'done'
    ? step('github', 'GitHub repository + first cycle', 'done', init.repo)
    : step('github', 'GitHub repository + first cycle', 'todo',
      'init_github has not completed — devos runs it itself and adopts a repository that already exists',
      { who: 'devos' }));

  if (init && init.status === 'done' && gh) {
    const keys = checkKeys({ repo: init.repo || slug, answers });
    steps.push(!keys.ok
      ? step('secrets', 'GitHub secrets', 'wait', `could not list secrets: ${keys.error}`, { who: 'you' })
      : keys.missing.length
        ? step('secrets', `GitHub secrets (${keys.missing.length} missing)`, 'todo', `missing: ${keys.missing.join(', ')}`, { who: 'you', missing: keys.missing })
        : step('secrets', 'GitHub secrets', 'done', `${keys.setCount} set`));
  } else {
    steps.push(step('secrets', 'GitHub secrets', 'wait', gh ? 'checked once the repository is ready' : 'checked when the continue run starts'));
  }

  const doneCount = steps.filter((s) => s.state === 'done').length;
  const todoCount = steps.filter((s) => s.state === 'todo').length;
  return { started: true, steps, doneCount, todoCount, slug, answers };
}

function resolveAgentFor(answers) {
  const cm = answers.models?.configurationModel;
  if (!cm || !cm.cli) return null;
  if (String(cm.cli).startsWith('custom:')) return cm.agent ? { ...cm.agent, status: 'installed' } : null;
  const agents = detectAgents();
  return agents.find((a) => a.toolId === cm.cli) || null;
}

// One streamed install (npm/pnpm/yarn/bun/go). Lines go out as stream:'install'
// so terminals and the UI can prefix them distinctly from model conversation.
function runInstallStream({ install, projectDir, env, emit }) {
  const [command, ...args] = install.split(/\s+/).filter(Boolean);
  return new Promise((resolve) => {
    const lines = [];
    const feed = (buf) => {
      for (const line of String(buf).split('\n')) {
        if (!line.trim()) continue;
        lines.push(line);
        emit({ type: 'log', line, stream: 'install' });
      }
    };
    const child = spawnTool(command, args, { cwd: projectDir, env });
    child.stdout?.on('data', (d) => feed(d));
    child.stderr?.on('data', (d) => feed(d));
    child.on('error', (err) => resolve({ code: -1, lines: [...lines, `Failed to start ${command}: ${err.message}`] }));
    child.on('close', (code) => resolve({ code: code ?? -1, lines }));
  });
}

// The last mile nobody should have to discover by hand: when a fresh dispatch
// cannot be CONFIRMED (old gh, indexing delay, dispatch rights), re-running the
// failed run itself is the fallback — same workflow, one more attempt.
function rerunCycleRun(repo, runId) {
  try {
    const r = runToolSync('gh', ['run', 'rerun', runId, '--repo', repo], { encoding: 'utf8', timeout: 20_000 });
    if (r.status === 0) return true;
    // An older gh without `run rerun` (or a rerun it refuses): dispatch a fresh
    // cycle instead — same workflow, current main, one more attempt.
    const r2 = runToolSync('gh', ['workflow', 'run', 'devos-cycle.yml', '--repo', repo], { encoding: 'utf8', timeout: 20_000 });
    return r2.status === 0;
  } catch { return false; }
}

// THE KEY-FIX ROUND — the Missing keys card, opened from the FAILED RUN's own
// evidence. Why it exists beside the secrets stage: GitHub's secret list can say
// a key is set while the run just proved it had NO working value (a stale,
// wrong, or expired value — the list shows NAMES, never validity). When a failed
// run died on a selected key's auth wall, saw it EMPTY, or never echoed it at
// all, the card opens with that key listed as "suspected": re-typing the value
// there OVERWRITES the GitHub secret safely. The values travel browser → engine
// → gh over stdin and are never logged, echoed, or sent to any model. Returns
// 'fixed' (at least one value uploaded), 'skipped' (nothing usable), or
// 'stopped'.
async function keyFixRound({ repo, projectDir, answers, selectedKeys, suspected = [], note = '', round = 1, emit, shouldStop = null, requestValues }) {
  const say = (line) => emit({ type: 'log', line, stream: 'engine' });
  if (typeof requestValues !== 'function') return 'skipped';
  const status = keyStatus({ repo, answers, projectDir });
  const missing = status.ok ? status.missing.filter((n) => selectedKeys.includes(n)) : [];
  const unconfirmed = status.ok ? status.unconfirmed.filter((n) => selectedKeys.includes(n) && !missing.includes(n)) : [];
  const suspect = suspected.filter((n) => selectedKeys.includes(n) && !missing.includes(n) && !unconfirmed.includes(n));
  const want = [...missing, ...unconfirmed, ...suspect];
  if (!want.length) return 'skipped';
  emit({ type: 'phase', name: 'keys-intake' });
  say(`The Missing keys card is open in the browser window (${want.join(', ')}) — the last run had no working value for ${suspect.length ? suspect.join(', ') : 'these key(s)'}; re-typing a value there overwrites the GitHub secret, and the engine uploads it itself.`);
  const values = await requestValues({
    missing, unconfirmed, suspected: suspect, repo, round, total: selectedKeys.length,
    sources: Object.fromEntries(want.map((n) => [n, keySource(n)])),
    note,
  });
  if (shouldStop && shouldStop()) return 'stopped';
  if (!values || typeof values !== 'object' || Array.isArray(values)) return 'skipped';
  let got = 0;
  for (const [name, raw] of Object.entries(values)) {
    if (!want.includes(name)) continue; // only keys this project actually selected
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v || v === KEEP_VALUE) continue; // the fix round overwrites; keep/skip means leave it as it is
    const up = await pushSecret({ name, value: v, repo, projectDir });
    if (!up.ok) { say(`could not upload ${name}: ${up.error}`); continue; }
    recordSecretStatus(projectDir, name, 'set', { via: 'key-fix' });
    say(`uploaded ${name} to GitHub — the value went straight into the secret; it is in no log, no chat, no model.`);
    got += 1;
  }
  return got > 0 ? 'fixed' : 'skipped';
}

// The orchestrator. Returns the same result shape as runConfigurationModel
// (ok/finalLine/message/stopped/usageLimit/...) plus `assessment` and `resumed`
// (which steps this run actually applied), so both terminal and UI callers can
// print one consistent story.
export async function runContinue({
  projectDir, home = null, overrides = {}, emit = () => {}, shouldStop = null, env = process.env, installFn = null, decide = null,
  waitKeys = 'auto', pollMs = null, maxWaitMs = null, choose = null, keysMode = null, requestValues = null,
  watchPollMs = 15_000, watchMaxMs = 150 * 60_000,
}) {
  const say = (line) => emit({ type: 'log', line, stream: 'engine' });
  emit({ type: 'phase', name: 'assessing' });

  const answersPath = join(projectDir, 'devos', 'answers.json');
  if (!existsSync(answersPath)) {
    throw new Error(`No answer file at ${answersPath}. devos continue resumes an existing project; run devos init for a new one.`);
  }
  let answers = readAnswersFromProject(projectDir);
  if (!answers) {
    throw new Error(`The answer file at ${answersPath} is not valid JSON. A broken answer file cannot be resumed; restore it or run devos init for a new project.`);
  }

  // Overrides patch the saved configuration-model choice first — the escape hatch
  // when the saved model cannot run. Persisted so later resumes keep them.
  const cm = answers.models.configurationModel;
  if (overrides.cli || overrides.model) {
    if (overrides.cli) cm.cli = overrides.cli;
    if (overrides.model) cm.model = overrides.model;
    writeFileSync(answersPath, JSON.stringify(answers, null, 2));
  }
  if (home) {
    writeFileSync(lastProjectFile(home), JSON.stringify({ path: projectDir, slug: answers.project.slug, at: new Date().toISOString() }, null, 2));
  }

  const slug = answers.project?.slug || 'unknown/repo';
  // The keys of the tools the user SELECTED (reviewer, builder, extra builders).
  // Every cycle-side key judgment filters through this list: a tool the user did
  // not pick must never be reported as this project's problem.
  const selectedKeys = selectedToolSecrets(answers);
  let assessment = assessProject({ projectDir, answers });
  say(`Continuing ${slug} — ${assessment.doneCount} of ${assessment.steps.length} steps already done.`);
  for (const s of assessment.steps) {
    say(`${s.state === 'done' ? 'done ' : s.state === 'todo' ? 'todo' : s.state}: ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
  }
  const resumed = [];

  // 1) Model resume — ONLY when the tree still fails the guards. A tree that
  // already passes never wakes the model again (no wasted paid run).
  if (assessment.steps.find((s) => s.id === 'tree').state === 'todo') {
    if (shouldStop && shouldStop()) {
      emit({ type: 'phase', name: 'stopped' });
      return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before any step ran. Resume with: devos continue ${projectDir}` };
    }
    say('The project tree does not pass the guards yet — resuming the configuration model.');
    const agent = resolveAgentFor(answers);
    if (!agent) throw new Error(`The configuration model CLI "${cm.cli}" is not installed on this computer.`);
    const result = await runConfigurationModel({ projectDir, answers, answersPath, agent, emit, shouldStop, env });
    if (!result.ok) {
      return { ...result, assessment: assessProject({ projectDir, answers }), projectDir, slug };
    }
    resumed.push('model');
    assessment = assessProject({ projectDir, answers });
  } else {
    say('The project tree already passes the guards — the configuration model is not needed.');
  }

  // 1b) When the model just repaired the tree and the repository already exists,
  // push the repaired files. init_github runs once, so nothing else would ship
  // them — and the GitHub-side cycle would keep running against the stale tree
  // (this is exactly how a repo ends up without its README, ADRs, or the fixed
  // workflow after a repair round).
  if (resumed.includes('model')) {
    const initNow = readInitState(projectDir);
    if (initNow && initNow.status === 'done') {
      if (shouldStop && shouldStop()) {
        emit({ type: 'phase', name: 'stopped' });
        return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the repaired tree was pushed. Resume with: devos continue ${projectDir}` };
      }
      emit({ type: 'phase', name: 'syncing-repo' });
      say('The tree was repaired after the repository was created — pushing the repaired files…');
      try {
        syncRepoPush({ projectDir });
        resumed.push('github-sync');
        // A fresh cycle on the repaired tree: the push alone does not dispatch
        // (the workflow is workflow_dispatch-only), and the last cycle may have
        // failed against the stale tree. One dispatch, allowed to fail quietly.
        try {
          const d = runToolSync('gh', ['workflow', 'run', 'devos-cycle.yml', '--repo', initNow.repo], { encoding: 'utf8', timeout: 20_000 });
          if (d.status === 0) {
            resumed.push('cycle-dispatch');
            say('A fresh devos-cycle run was dispatched on the repaired tree.');
          }
        } catch { /* the push itself already landed; the cycle can be dispatched later */ }
      } catch (e) {
        emit({ type: 'phase', name: 'error' });
        return { ok: false, githubError: true, assessment, projectDir, slug, lines: [], message: e.toolMessage || e.message };
      }
    }
  }

  // 2) Dependencies — the engine installs them itself. The model never needs to.
  const deps = assessment.steps.find((s) => s.id === 'deps');
  if (deps.state === 'todo') {
    if (shouldStop && shouldStop()) {
      emit({ type: 'phase', name: 'stopped' });
      return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the install. Resume with: devos continue ${projectDir}` };
    }
    emit({ type: 'phase', name: 'installing' });
    say(`Installing dependencies (${deps.install}) — the engine runs this itself.`);
    let r = installFn
      ? await installFn({ install: deps.install, projectDir, emit })
      : await runInstallStream({ install: deps.install, projectDir, env, emit });
    if (r.code !== 0) {
      // Do not dead-end: consult the configuration model, show its proposal to
      // the user for approval, and retry the install when a fix is approved.
      const failResult = (extra = {}) => {
        emit({ type: 'phase', name: 'error' });
        const tail = (r.lines || []).slice(-5).join(' | ');
        return {
          ok: false, installError: true, assessment, projectDir, slug, lines: (r && r.lines) || [],
          message: `${deps.install} failed (exit ${r.code}).${tail ? ` Last output: ${tail}` : ''}`,
          ...extra,
        };
      };
      const consult = await consultModel({
        projectDir, answers, agent: resolveAgentFor(answers),
        stepLabel: `dependencies (${deps.install})`,
        errorLines: (r.lines || []).slice(-12),
        tried: [`${deps.install} streamed by the engine (exit ${r.code})`],
        emit, shouldStop, env, decide,
      });
      if (!consult.consulted) return failResult();
      if (consult.usageLimit || consult.trustIssue || consult.planIssue || consult.permissionIssue) {
        return failResult({ usageLimit: consult.usageLimit, trustIssue: consult.trustIssue, planIssue: consult.planIssue, permissionIssue: consult.permissionIssue, message: consult.reason });
      }
      if (!consult.approved) return failResult({ declined: true, proposal: consult.proposal || null });
      if (!consult.commandsOk) {
        return failResult({ message: `${deps.install} failed (exit ${r.code}); the approved fix commands also failed: ${consult.commandError}` });
      }
      if (shouldStop && shouldStop()) {
        emit({ type: 'phase', name: 'stopped' });
        return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the retry. Resume with: devos continue ${projectDir}` };
      }
      emit({ type: 'phase', name: 'installing' });
      say(`Retrying ${deps.install} after the approved fix…`);
      r = installFn
        ? await installFn({ install: deps.install, projectDir, emit })
        : await runInstallStream({ install: deps.install, projectDir, env, emit });
      if (r.code !== 0) {
        return failResult({ message: `${deps.install} failed again after the approved fix (exit ${r.code}).` });
      }
    }
    recordStep(projectDir, 'install', { command: deps.install });
    resumed.push('install');
    assessment = assessProject({ projectDir, answers });
  }

  // 3) GitHub — the engine calls init_github itself. A repository created by hand
  // (or by a half-finished earlier attempt) is adopted: remote, push, variables,
  // first cycle. It is never asked to create a second one. When every built-in
  // attempt still fails, the configuration model is consulted for a fix proposal
  // and the user approves it before the engine applies anything.
  const ghStep = assessment.steps.find((s) => s.id === 'github');
  if (ghStep.state === 'todo') {
    if (shouldStop && shouldStop()) {
      emit({ type: 'phase', name: 'stopped' });
      return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before GitHub setup. Resume with: devos continue ${projectDir}` };
    }
    emit({ type: 'phase', name: 'creating-github' });
    say('Running init_github — an existing repository is adopted, not recreated.');
    const runGithubOnce = async () => {
      const init = runInitGithub({ projectDir });
      emit({ type: 'github', state: init });
      return init;
    };
    try {
      await runGithubOnce();
      resumed.push('github');
    } catch (e) {
      const failResult = (extra = {}) => {
        emit({ type: 'phase', name: 'error' });
        return {
          ok: false, githubError: true, assessment: assessProject({ projectDir, answers }), projectDir, slug, lines: [],
          message: `init_github failed: ${e.toolMessage || e.message}`,
          ...extra,
        };
      };
      const consult = await consultModel({
        projectDir, answers, agent: resolveAgentFor(answers),
        stepLabel: 'GitHub repository + first cycle',
        errorLines: String(e.toolMessage || e.message).split('\n').slice(0, 12),
        tried: [
          'gh repo create (an existing repository is adopted, never recreated)',
          'the repository is looked up under the signed-in login and by a listing match',
          'a second create + remote + push attempt',
        ],
        emit, shouldStop, env, decide,
      });
      if (!consult.consulted) return failResult();
      if (consult.usageLimit || consult.trustIssue || consult.planIssue || consult.permissionIssue) {
        return failResult({ usageLimit: consult.usageLimit, trustIssue: consult.trustIssue, planIssue: consult.planIssue, permissionIssue: consult.permissionIssue, message: consult.reason });
      }
      if (!consult.approved) {
        return failResult({
          declined: true, proposal: consult.proposal || null,
          message: `init_github failed: ${e.toolMessage || e.message}${consult.reason ? ` — no fix was applied (${consult.reason})` : ''}`,
        });
      }
      if (!consult.commandsOk) {
        return failResult({ message: `init_github failed: ${e.toolMessage || e.message} — the approved fix commands also failed: ${consult.commandError}` });
      }
      if (shouldStop && shouldStop()) {
        emit({ type: 'phase', name: 'stopped' });
        return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the GitHub retry. Resume with: devos continue ${projectDir}` };
      }
      emit({ type: 'phase', name: 'creating-github' });
      say('Retrying init_github with the fix applied…');
      try {
        await runGithubOnce();
        resumed.push('github');
      } catch (e2) {
        return failResult({ message: `init_github failed again after the approved fix: ${e2.toolMessage || e2.message}` });
      }
    }
    assessment = assessProject({ projectDir, answers });
  }

  // 4) Keys — the engine drives the WHOLE keys moment: gitignore guard for the
  // local values file, the organized where-to-get guide (the configuration model
  // writes it in an interactive terminal; the built-in catalog is the fallback),
  // the devos/secrets.local.json fill-in file, and the upload itself (gh secret
  // set, value piped on stdin). In an interactive terminal the stage WAITS for
  // the values and finishes the setup; in scripts and the UI it leaves exact
  // instructions and finishes honestly. A value never touches chat or the model.
  const initNow = readInitState(projectDir);
  const repo = initNow?.repo || slug;
  let keysMissing = Array.isArray(assessment.steps.find((s) => s.id === 'secrets')?.missing)
    ? assessment.steps.find((s) => s.id === 'secrets').missing : [];
  let keysCheckError = null; // GitHub refused the secret list — nothing key-shaped can be trusted
  const keysPushed = [];
  if (initNow && initNow.status === 'done') {
    if (shouldStop && shouldStop()) {
      emit({ type: 'phase', name: 'stopped' });
      return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the keys step. Resume with: devos continue ${projectDir}` };
    }
    const { runSecretsStage } = await import('./secretsflow.mjs');
    const stage = await runSecretsStage({
      projectDir, answers, repo, emit, shouldStop, env,
      agent: resolveAgentFor(answers), waitKeys, choose, keysMode, requestValues,
      ...(pollMs ? { pollMs } : {}),
      ...(maxWaitMs ? { maxWaitMs } : {}),
    });
    if (stage.error) say(stage.error);
    if (stage.stopped) {
      emit({ type: 'phase', name: 'stopped' });
      return {
        ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [],
        message: stage.message || `Paused while waiting for keys. Fill devos/secrets.local.json, then run: devos continue ${projectDir}`,
        keysPushed: stage.pushed || [],
      };
    }
    for (const n of stage.pushed || []) if (!keysPushed.includes(n)) keysPushed.push(n);
    if (keysPushed.length) { recordStep(projectDir, 'secrets', { pushed: keysPushed }); resumed.push('secrets'); }
    if (stage.error && !(stage.pushed || []).length) {
      // The check itself failed (gh refused the secret list, a broken local
      // file): dispatching a run now would be blind — it would fail the same
      // way. Report the exact fix instead of spending the round.
      keysCheckError = stage.error;
      say(`The keys could not be checked on GitHub (${stage.error}) — fix gh's access first: run "gh auth refresh -h github.com -s repo" (or "gh auth login" with the repo scope), then devos continue. No cycle run starts: it would fail the same way without the keys.`);
    }
    assessment = assessProject({ projectDir, answers });
    const secretsAfter = assessment.steps.find((s) => s.id === 'secrets');
    keysMissing = Array.isArray(secretsAfter?.missing) ? secretsAfter.missing : [];
    if (keysMissing.length) {
      const unconfirmed = stage.unconfirmed || [];
      const missingOnly = keysMissing.filter((n) => !unconfirmed.includes(n));
      for (const n of missingOnly) say(`key still missing: ${n}`);
      for (const n of keysMissing.filter((n) => unconfirmed.includes(n))) say(`key unconfirmed on GitHub: ${n} — paste the value into devos/secrets.local.json (or set __keep__)`);
    }
  }

  // 5) The first-run loop. The configuration model's job is not "the repository
  //    exists" — it is "the FIRST devos-cycle run is green with the selected,
  //    tested keys". Until that is proven, EVERY `devos continue` (or wizard
  //    continue — same engine) is another round, and any error report the user
  //    brings is answered by doing, not by a link:
  //      - a run already going is WATCHED to the end (never a duplicate dispatch);
  //      - a GREEN run records first-run-green — the job is DONE, and from here
  //        any issue continues on GitHub (human-gate PRs), not in this engine;
  //      - a FAILED run is diagnosed (the failing step's own words, plus WHICH
  //        keys the run saw as EMPTY — GitHub's masked log is the proof), then a
  //        FRESH run is dispatched and watched to a plain-English report.
  //    Nothing is ever "spent": every continue is a new chance, the ledger
  //    (cycle-attempts) only tells the story, and the report always names the
  //    exact fix when the engine cannot make one itself.
  let cycleRestart = null;   // the run this invocation started or watched
  let cycleReport = null;    // the plain-English outcome report
  let firstRunGreen = false; // the goal: proven at least once, remembered forever
  if (initNow && initNow.status === 'done' && !keysMissing.length && !keysCheckError) {
    const greenDone = readContinueState(projectDir).steps?.['first-run-green'];
    let latest = latestCycleRun(repo);
    if (!latest) {
      // init_github or the sync push may have dispatched seconds ago — the run
      // needs a moment to appear in GitHub's index. A short grace poll prevents
      // a pointless second dispatch alongside the run already on its way.
      const recent = await findNewCycleRun(repo, Date.now() - 120_000, null, { tries: 4, gapMs: 2500 });
      if (recent) latest = { id: recent.id, url: recent.url, status: recent.status || 'queued', conclusion: null };
    }
    if (greenDone) {
      // The goal was proven on an earlier continue: the engine's job is DONE.
      // It never babysits cycles again — GitHub is the developer's desk now.
      firstRunGreen = true;
      emit({ type: 'phase', name: 'cycle-report' });
      say(`The first cycle run is green (${greenDone.url || (latest && latest.url) || 'Actions'}), with every selected key in place — the configuration model's job is done.`);
      say('From here the project lives on GitHub: merge pull requests labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green. Any issue continues on GitHub — not in this engine.');
      cycleReport = [
        `The first cycle run finished GREEN — the goal is proven: ${(greenDone && greenDone.url) || (latest && latest.url) || 'Actions'}`,
        'Next: the cycle works the tasks on its own. Merge pull requests labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green.',
      ];
    } else if (latest && latest.status && latest.status !== 'completed') {
      // A run is already going: watch it to the end instead of starting a
      // duplicate — its outcome IS the answer to the first-run goal.
      emit({ type: 'phase', name: 'watching-cycle' });
      say(`A cycle run is already going (${latest.url}) — watching it to the end; the report comes here.`);
      resumed.push('cycle-watch');
      const outcome = await watchCycleRun({ repo, runId: latest.id, url: latest.url, pollMs: watchPollMs, maxMs: watchMaxMs, emit, shouldStop, selectedNames: selectedKeys.length ? selectedKeys : null });
      if (outcome.status === 'stopped') {
        emit({ type: 'phase', name: 'stopped' });
        return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped while watching ${outcome.url || latest.url}. The run keeps going on GitHub — devos report shows the outcome. Resume with: devos continue ${projectDir}` };
      }
      cycleRestart = { runId: latest.id, url: outcome.url || latest.url, watched: true };
      cycleRestart.conclusion = outcome.conclusion || null;
      cycleReport = outcome.report || null;
      for (const line of cycleReport || []) say(line);
      if (outcome.conclusion === 'success') {
        recordStep(projectDir, 'first-run-green', { runId: latest.id, url: cycleRestart.url });
        firstRunGreen = true;
      } else {
        appendAttempt(projectDir, { action: 'watched', runId: latest.id, url: cycleRestart.url, conclusion: outcome.conclusion || null });
      }
    } else if (latest && latest.conclusion === 'success') {
      recordStep(projectDir, 'first-run-green', { runId: latest.id, url: latest.url });
      firstRunGreen = true;
      emit({ type: 'phase', name: 'cycle-report' });
      cycleReport = buildCycleReport({ repo, runId: latest.id, url: latest.url, conclusion: 'success', jobs: [] });
      for (const line of cycleReport) say(line);
    } else if (shouldStop && shouldStop()) {
      emit({ type: 'phase', name: 'stopped' });
      return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped before the next cycle round. Resume with: devos continue ${projectDir}` };
    } else {
      // A failed run (or no run at all): diagnose it from its own log, then THE
      // FIX LOOP. The window does not finish while a key fix is pending: the
      // Missing keys card opens on EVERY key-shaped failure — a selected key
      // missing on GitHub, seen EMPTY, or the builder's own auth wall naming it
      // — EVEN when GitHub's secret list claims the key is set (a stale value
      // fails exactly like a missing one; the list shows names, never
      // validity). Values upload, the workflow repair is VERIFIED on GitHub's
      // own copy, a fresh round dispatches and is watched — and when it fails
      // on the keys again, the card re-opens. The loop ends only on GREEN, the
      // user's Skip, Stop, or the per-invocation cap; every attempt lands in
      // the ledger (cycle-attempts).
      emit({ type: 'phase', name: 'restarting-cycle' });
      // From a run's own log: which SELECTED keys did it lack a working value
      // for? Seen EMPTY, named by the builder's auth wall, or never echoed at
      // all — all three are the card's business. A log with no key-shaped
      // failure (a startup failure, an npm crash) never opens the card.
      const diagnoseLog = (logAll) => {
        const text = logAll.join('\n');
        const presence = logAll.length ? runKeyPresence(logAll) : [];
        const selectedPresence = selectedKeys.length ? presence.filter((k) => selectedKeys.includes(k.name)) : [];
        const empty = selectedPresence.filter((k) => k.state === 'empty').map((k) => k.name);
        const auth = /Authentication required[\s\S]{0,160}?set ([A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET))/.exec(text);
        const authKey = auth && auth[1] && selectedKeys.includes(auth[1]) ? auth[1] : null;
        const neverEchoed = selectedKeys.filter((n) => n !== authKey && !selectedPresence.some((k) => k.name === n));
        const keyShaped = Boolean(authKey) || empty.length > 0;
        const suspected = keyShaped ? [...new Set([...empty, ...(authKey ? [authKey] : []), ...neverEchoed])] : [];
        return { presence, selectedPresence, empty, suspected };
      };
      const githubTruth = () => {
        const st = keyStatus({ repo, answers, projectDir });
        if (!st.ok) return { error: st.error, missing: null };
        // THE TRUTH FIRST: the intake opens from GitHub's own secret list, not
        // from what the run log echoes. A log that never prints a key proves
        // nothing about it — that gap is exactly how the field run kept
        // dispatching while CURSOR_API_KEY (never echoed) was absent.
        return { error: null, missing: st.missing.filter((n) => selectedKeys.includes(n)) };
      };
      const pushResumed = (label) => { if (!resumed.includes(label)) resumed.push(label); };
      const stoppedResult = (message, extra = {}) => {
        emit({ type: 'phase', name: 'stopped' });
        return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message, ...extra };
      };

      let latestRun = latest;
      let round = 0;
      let skippedCard = false; // the user declined the card once — this invocation never nags again
      while (true) {
        round += 1;
        if (shouldStop && shouldStop()) {
          return stoppedResult(`Stopped before cycle round ${round}. Resume with: devos continue ${projectDir}`);
        }

        // ---- the evidence: GitHub's own list + the failed run's own log ------
        const truth = githubTruth();
        if (truth.error) {
          keysCheckError = keysCheckError || truth.error;
          say(`The keys could not be checked on GitHub (${truth.error}) — fix gh's access first: run "gh auth refresh -h github.com -s repo" (or "gh auth login" with the repo scope), then devos continue. No cycle run was started: without knowing the keys, it would fail the same way.`);
          break;
        }
        const missingSel = truth.missing || [];
        let suspected = [];
        let emptySeen = [];
        if (latestRun) {
          const logAll = cycleFailedLog(repo, latestRun.id);
          const diag = diagnoseLog(logAll);
          suspected = diag.suspected;
          emptySeen = diag.empty;
          if (round === 1) {
            say(`The last cycle run failed (${latestRun.conclusion || 'unknown outcome'}) — diagnosing it, then starting a FRESH run. Previous run: ${latestRun.url}`);
            const logLines = logAll.slice(-12);
            if (logLines.length) {
              say('What the failed run printed (its own last lines):');
              for (const l of logLines) say(`  | ${l}`);
            }
            if (selectedKeys.length && diag.presence.length) {
              if (diag.selectedPresence.length) {
                say(`Keys the run actually saw — the ones this project selected: ${diag.selectedPresence.map((k) => `${k.name} — ${k.state === 'set' ? 'present (masked by GitHub)' : 'EMPTY'}`).join('; ')}.`);
              } else {
                say(`None of the keys this project selected (${selectedKeys.join(', ')}) appeared in the run log — the workflow may not map or echo them (checked and repaired below).`);
              }
              const others = diag.presence.filter((k) => !selectedKeys.includes(k.name)).map((k) => k.name);
              if (others.length) say(`Not selected for this project (keys of tools you did not pick): ${others.join(', ')} — they do not matter here.`);
            }
            const cause = diagnoseCycleLog(logAll.slice(-12), diag.presence, selectedKeys.length ? selectedKeys : null, { missingOnGithub: missingSel });
            if (cause) say(`Likely cause: ${cause}`);
          }
        } else if (round === 1) {
          say('No devos-cycle run exists yet — dispatching the first one.');
        }
        // A failed run that predates the values uploaded in THIS continue is
        // stale evidence: it ran before the keys landed, so "the run had no
        // working value" proves nothing about the current values. The card
        // would nag about a key that was JUST set — the fresh dispatch below
        // is the first one that actually has it. Later rounds watch runs that
        // executed AFTER the uploads, so their evidence is never stale.
        const staleEvidence = round === 1 && keysPushed.length > 0;
        if (staleEvidence && suspected.length) {
          say(`The failed run predates the ${keysPushed.length} key(s) uploaded just now — its key evidence is stale; the fresh run below is the first one that has the current values.`);
          suspected = [];
        }
        const keyRelated = Boolean(missingSel.length || suspected.length);

        // ---- the key fix, right here in this window --------------------------
        if (keyRelated && !skippedCard) {
          if (missingSel.length) {
            // (a) A selected key has no value on GitHub — the full secrets
            //     stage, whose own intake loop re-opens the card until GitHub
            //     confirms every key. The values travel browser → engine → gh
            //     over stdin and are never logged, echoed, or sent to a model.
            say(`The selected key(s) ${missingSel.join(', ')} have no value on GitHub — type them into the Missing keys card in the browser window (the intake is open); the engine uploads them itself:`);
            say('  [browser] the Missing keys card — paste each value, press Submit; the card re-opens for anything still missing until GitHub confirms all');
            say('  [file    ] devos/secrets.local.json -> "NAME" also works — the engine uploads it (gitignored; the model never sees it)');
            const { runSecretsStage } = await import('./secretsflow.mjs');
            const stage2 = await runSecretsStage({
              projectDir, answers, repo, emit, shouldStop, env,
              agent: resolveAgentFor(answers), waitKeys, choose, keysMode, requestValues,
              ...(pollMs ? { pollMs } : {}),
              ...(maxWaitMs ? { maxWaitMs } : {}),
            });
            if (stage2.stopped) {
              return stoppedResult(stage2.message || `Paused while waiting for keys. Fill devos/secrets.local.json, then run: devos continue ${projectDir}`, { keysPushed: stage2.pushed || [] });
            }
            for (const n of stage2.pushed || []) if (!keysPushed.includes(n)) keysPushed.push(n);
            if (stage2.pushed?.length) recordStep(projectDir, 'secrets', { pushed: stage2.pushed });
            if (stage2.error && !(stage2.pushed || []).length) {
              keysCheckError = keysCheckError || stage2.error;
              say(`The keys could not be re-checked on GitHub (${stage2.error}) — fix gh's access (gh auth refresh -h github.com -s repo), then devos continue. No run was started.`);
              break;
            }
            assessment = assessProject({ projectDir, answers });
            const secretsAfter2 = assessment.steps.find((s) => s.id === 'secrets');
            keysMissing = Array.isArray(secretsAfter2?.missing) ? secretsAfter2.missing : [];
            const st3 = keyStatus({ repo, answers, projectDir });
            const stillMissingSelected = st3.ok ? st3.missing.filter((n) => selectedKeys.includes(n)) : missingSel;
            if (stillMissingSelected.length) {
              // A run without these values fails the same way — do not spend it.
              say(`Still not on GitHub: ${stillMissingSelected.join(', ')} — no fresh run starts until the values land (it would fail the same way). Type them into the Missing keys card (devos continue opens it) or devos/secrets.local.json (guide: devos/SECRETS_GUIDE.md), then run devos continue again.`);
              break;
            }
            say('Every selected key is on GitHub now — the fresh run below is the first one that has them.');
          } else {
            // (b) The values ARE on GitHub, yet the run had no working one —
            //     the card opens with the suspected keys (re-typing a value
            //     overwrites a stale one safely); the mapping repair runs
            //     either way. THIS is the round that never happened in the
            //     field: GitHub listed CURSOR_API_KEY as set, so the old flow
            //     skipped the card and dispatched blind, again and again.
            if (emptySeen.length) {
              say('The values are on GitHub, yet the run saw them EMPTY — the workflow\'s secret mapping is the suspect. Checking and repairing it now.');
            } else {
              say('The run\'s log never proved a working value for the key(s) it failed on — the workflow\'s secret mapping is the suspect, and the value itself may be stale. The mapping is checked and repaired, and the Missing keys card takes a fresh value (re-typing overwrites safely).');
            }
            const r = await keyFixRound({
              repo, projectDir, answers, selectedKeys,
              suspected,
              note: 'The last run failed on its builder key(s) — GitHub may hold a stale value; re-typing it here overwrites it safely. Skip only if you are sure every value is correct.',
              round, emit, shouldStop, requestValues,
            });
            if (r === 'stopped') {
              return stoppedResult(`Stopped during the keys fix. Resume with: devos continue ${projectDir}`);
            }
            if (r === 'skipped') {
              skippedCard = true;
              say('The values stay as they are — repairing the workflow mapping and starting the fresh round anyway.');
            }
          }
        }

        // ---- the workflow repair, VERIFIED on GitHub's own copy --------------
        if (selectedKeys.length) {
          // First the cycle-v2 upgrade: a repository still running the old
          // single-step workflow gets the five-step structure (Builder / Checks
          // / Review / Verdict steps, PR comments, statuses, heartbeats) before
          // anything is dispatched — then the secret repair narrows the echo.
          const up = syncCycleV2(projectDir, { say });
          const rep = repairWorkflowSecrets(projectDir, selectedKeys, { say });
          if (rep.changed || up.changed) {
            if (shouldStop && shouldStop()) {
              return stoppedResult(`Stopped after the workflow mapping repair (not pushed yet). Resume with: devos continue ${projectDir}`);
            }
            try {
              syncRepoPush({ projectDir });
              pushResumed('workflow-secrets-fix');
              say(up.changed && !rep.changed
                ? 'The upgraded five-step cycle workflow was pushed — the fresh run below is the first one that runs it (build, checks, review, verdict as separate steps, details on the pull request).'
                : 'The repaired workflow was pushed — the fresh run below is the first one that maps every selected key for every step.');
            } catch (e) {
              say(`The repair is in the project tree but the push failed: ${e.toolMessage || e.message} — devos continue retries the sync, then dispatches.`);
            }
          }
          // A push is only real when GitHub's own copy says so. This check ends
          // the "repaired and pushed" lie: a push that landed on the wrong
          // branch (or a raced dispatch) used to leave the SAME red round
          // repeating while the report claimed fixed.
          const v1 = verifyWorkflowOnGithub({ repo, projectDir, names: selectedKeys });
          if (v1.checked && !v1.ok) {
            const gap = [...(v1.missingMapped || []), ...(v1.echoMissing || [])].join(', ');
            say(`GitHub's copy of devos-cycle.yml on main is NOT the repaired one yet (missing there: ${gap || 'unknown'}) — pushing again and re-verifying.`);
            try { syncRepoPush({ projectDir }); } catch (e) {
              say(`The second push failed too: ${e.toolMessage || e.message}.`);
            }
            const v2 = verifyWorkflowOnGithub({ repo, projectDir, names: selectedKeys });
            if (v2.checked && !v2.ok) {
              const gap2 = [...(v2.missingMapped || []), ...(v2.echoMissing || [])].join(', ');
              say(`The fresh run would still execute the OLD workflow (GitHub's copy lacks: ${gap2}) — no run starts on that. The usual causes: branch protection rejecting the push, or the local checkout sitting on another branch. Fix those, then run devos continue — the repair and this verification run again.`);
              break;
            }
            if (v2.checked && v2.ok) say('Verified after the retry: GitHub\'s copy now maps every selected key and echoes them.');
          } else if (v1.checked && v1.ok && rep.changed) {
            say('Verified on GitHub: the workflow the fresh run will execute maps every selected key and echoes them.');
          }
        }

        // ---- the fresh round ---------------------------------------------------
        if (keysPushed.length && round === 1) say(`The ${keysPushed.length} key(s) uploaded this run are already on GitHub — the fresh run below is the first one that has them.`);
        const t0 = Date.now();
        let newRun = dispatchCycle(repo) ? await findNewCycleRun(repo, t0, latestRun ? latestRun.id : null) : null;
        if (!newRun && latestRun) {
          // The dispatch could not be confirmed (old gh, indexing delay, a
          // workflow without dispatch rights): fall back to re-running the
          // failed run itself — same workflow, one more attempt.
          say('The fresh dispatch could not be confirmed — re-running the failed run itself instead.');
          if (rerunCycleRun(repo, latestRun.id)) newRun = { id: latestRun.id, url: latestRun.url };
        }
        if (!newRun) {
          say('Could not start a cycle run automatically — open the Actions page and dispatch devos-cycle.yml once by hand; the next devos continue reports it.');
          break;
        }
        appendAttempt(projectDir, { action: 'dispatch', runId: newRun.id, url: newRun.url, after: latestRun ? latestRun.id : null, round });
        pushResumed('cycle-dispatch');
        cycleRestart = { runId: newRun.id, url: newRun.url };
        emit({ type: 'phase', name: 'watching-cycle' });
        say(`Watching the new run (${newRun.url}) until it finishes — this can take several minutes. The report comes here when it is done.`);
        const outcome = await watchCycleRun({ repo, runId: newRun.id, url: newRun.url, pollMs: watchPollMs, maxMs: watchMaxMs, emit, shouldStop, selectedNames: selectedKeys.length ? selectedKeys : null });
        if (outcome.status === 'stopped') {
          return stoppedResult(`Stopped while watching ${outcome.url || newRun.url}. The run keeps going on GitHub — devos report shows the outcome. Resume with: devos continue ${projectDir}`);
        }
        cycleRestart.conclusion = outcome.conclusion || null;
        cycleReport = outcome.report || null;
        for (const line of cycleReport || []) say(line);
        if (outcome.conclusion === 'success') {
          recordStep(projectDir, 'first-run-green', { runId: newRun.id, url: newRun.url });
          firstRunGreen = true;
          break;
        }
        if (round >= 5) {
          say('Five watched rounds in this one continue — stopping here so nothing spins without you. The report above names the fix; run devos continue for the next round.');
          break;
        }
        // Re-diagnose the run just watched: key-shaped again?
        const nextDiag = diagnoseLog(outcome.logLines || []);
        const nextTruth = githubTruth();
        const nextMissing = nextTruth.missing || [];
        if (skippedCard || !(nextMissing.length || nextDiag.suspected.length)) {
          // Not key-shaped (or the user already declined the card): the report
          // above stands, and the next devos continue is the next round.
          break;
        }
        say(`The fresh round failed on the keys again (${[...nextMissing, ...nextDiag.suspected].join(', ')}) — the Missing keys card opens again; the window stays open until the first run is green or you press Stop.`);
        latestRun = { id: newRun.id, url: outcome.url || newRun.url, status: 'completed', conclusion: outcome.conclusion || null };
      }
    }
  }

  if (shouldStop && shouldStop()) {
    emit({ type: 'phase', name: 'stopped' });
    return { ok: false, stopped: true, finalLine: `devos continue: ${slug}`, assessment, projectDir, slug, lines: [], message: `Stopped at the end of the run. Resume with: devos continue ${projectDir}` };
  }

  recordStep(projectDir, 'continue', { applied: resumed });
  // The final line tells the truth about the goal: "fully set up" only when the
  // FIRST cycle run is proven green with the keys; until then every continue is
  // another round, and the line says exactly what the next round needs.
  let finalLine;
  if (keysCheckError && !keysMissing.length) {
    finalLine = `devos continue: ${slug} is set up, but the keys could not be checked on GitHub (${keysCheckError}) — fix gh's access first: run "gh auth refresh -h github.com -s repo" (or "gh auth login" with the repo scope), then devos continue. No cycle run was started: it would fail the same way without the keys.`;
  } else if (keysMissing.length) {
    finalLine = `devos continue: ${slug} is set up; ${keysMissing.length} key(s) still need you — type them into the Missing keys card (devos continue opens it in the browser) or devos/secrets.local.json (guide: devos/SECRETS_GUIDE.md), then run devos continue or devos keys --push.`;
  } else if (firstRunGreen) {
    const greenUrl = (cycleRestart && cycleRestart.url)
      || readContinueState(projectDir).steps?.['first-run-green']?.url || 'Actions';
    finalLine = `devos continue: ${slug} is fully set up — the first cycle run is green with the selected keys: ${greenUrl}. The configuration model's job is done — from here, continue any issue on GitHub.`;
  } else if (cycleRestart && cycleReport && cycleReport[0] && cycleReport[0].includes('still going')) {
    finalLine = `devos continue: ${slug} is set up — the fresh cycle run is still going; devos report shows the outcome: ${cycleRestart.url}`;
  } else if (cycleRestart && cycleReport && cycleReport[0] && cycleReport[0].includes('FAILED')) {
    finalLine = `devos continue: ${slug} is set up — the fresh cycle run failed again. The report above names the fix; run devos continue ${projectDir} — on a key failure the Missing keys card opens right in the flow (type the values into the browser card, devos/secrets.local.json, or gh's hidden prompt — a value never reaches the model), the repaired workflow is verified on GitHub, and the engine starts the next fresh round itself — until the first cycle run is green.`;
  } else if (cycleRestart) {
    finalLine = `devos continue: ${slug} is set up — a fresh cycle run was started with the keys in place: ${cycleRestart.url}`;
  } else if (keysPushed.length) {
    finalLine = `devos continue: ${slug} is fully set up — ${keysPushed.length} key(s) set this run (model walkthrough and/or devos/secrets.local.json); the next cycle picks them up.`;
  } else if (resumed.length) {
    finalLine = `devos continue: ${slug} is set up; devos-cycle dispatched.`;
  } else {
    finalLine = `devos continue: ${slug} was already fully set up — nothing was missing.`;
  }
  if (resumed.length) say(`Continued from where it stopped: ${resumed.join(', ')}.`);
  else if (!keysMissing.length && !firstRunGreen) say('Everything was already done — no step was missing.');
  return {
    ok: true, finalLine, resumed, assessment, keysMissing, keysPushed,
    cycleRestart, cycleReport, firstRunGreen,
    init: readInitState(projectDir), projectDir, slug, lines: [],
  };
}
