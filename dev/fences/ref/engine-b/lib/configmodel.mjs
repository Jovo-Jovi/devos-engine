import { spawnTool, killPidTree } from './spawn.mjs';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { getAdapter, looksLikeUsageLimit, looksLikeTrustGate, looksLikePlanRestriction, looksLikeCommandRejection } from './adapters.mjs';
import { createStreamJsonInterpreter } from './streamjson.mjs';
import { buildConfigPrompt } from './prompt.mjs';
import { validateBootstrap } from './guards.mjs';
import { engineRoot, payloadPath } from './paths.mjs';
import { readInitState, recordModelRun } from './secret.mjs';

// One slot for the model process that is running right now. The Stop button
// (browser), Ctrl+C (terminal), and future callers all end the SAME child through
// killActiveChild(); run loops notice via their shouldStop() callback and return
// a clean `stopped` result instead of misreading the kill as a model failure.
const activeChild = { proc: null };

export function killActiveChild(reason = 'stop requested') {
  const child = activeChild.proc;
  if (!child || !child.pid) return false;
  return killPidTree(child.pid);
}

function makeShims(projectDir) {
  // Restricted-tool shims. The configuration model's only engine tools are init_github and
  // request_secret, exposed as PATH executables that call back into the engine. No raw
  // shell, git, gh, curl, wget, or rm is provided, and no secret value ever transits here.
  const dir = mkdtempSync(join(tmpdir(), 'devos-shims-'));
  const bin = join(engineRoot(), 'bin', 'devos.mjs');
  const sh = (name, args) => `#!/bin/sh\nexec "${process.execPath}" "${bin}" ${args} --project "${projectDir}" "$@"\n`;
  const cmd = (name, args) => `@echo off\n"${process.execPath}" "${bin}" ${args} --project "${projectDir}" %*\n`;
  writeFileSync(join(dir, 'init_github'), sh('init_github', 'internal:init-github'));
  chmodSync(join(dir, 'init_github'), 0o755);
  writeFileSync(join(dir, 'init_github.cmd'), cmd('init_github', 'internal:init-github'));
  writeFileSync(join(dir, 'request_secret'), sh('request_secret', 'internal:request-secret'));
  chmodSync(join(dir, 'request_secret'), 0o755);
  writeFileSync(join(dir, 'request_secret.cmd'), cmd('request_secret', 'internal:request-secret'));
  return dir;
}

function runOnce({ adapter, model, prompt, projectDir, answersPath, round, emit, env }) {
  return new Promise((resolve) => {
    const promptFile = join(projectDir, 'devos', 'state', 'config-prompt.md');
    mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
    writeFileSync(promptFile, prompt);

    // 'arg' delivery means the prompt TEXT is the last argv token (POSIX-safe;
    // every built-in adapter hands the prompt over stdin, which has no size or
    // escaping limits). Passing promptFile here was a bug: the model received a
    // file path where its instructions should be.
    const args = adapter.buildArgs(model, adapter.promptDelivery === 'arg' ? prompt : promptFile);
    const childEnv = { ...env };
    delete childEnv.GH_TOKEN;
    delete childEnv.GITHUB_TOKEN;
    childEnv.PATH = `${shimsCache.dir}${require_path_delimiter()}${env.PATH || process.env.PATH || ''}`;
    childEnv.DEVOS_PROJECT_DIR = projectDir;
    childEnv.DEVOS_ANSWERS = answersPath;
    childEnv.DEVOS_PAYLOAD = payloadPath();
    childEnv.DEVOS_REPAIR_ROUND = String(round);

    const child = spawnTool(adapter.command, args, {
      cwd: projectDir,
      env: childEnv,
    });
    activeChild.proc = child;

    // In stream-json mode the same file can be reported twice: the model's own
    // contract line {"event":"file"} AND the CLI's completed write tool call.
    // Dedupe by absolute path so progress counts each write once.
    const seenFiles = new Set();
    const seenModules = new Set();
    const emitOnce = (evt) => {
      try {
        if (evt && evt.type === 'file' && evt.path) {
          const p = isAbsolute(evt.path) ? evt.path : join(projectDir, evt.path);
          if (seenFiles.has(p)) return;
          seenFiles.add(p);
        }
        if (evt && evt.type === 'module' && evt.id) {
          if (seenModules.has(evt.id)) return;
          seenModules.add(evt.id);
        }
      } catch { /* dedupe must never drop the event stream */ }
      emit(evt);
    };

    const lines = [];
    let stdoutBuf = '';
    let stderrBuf = '';
    const pushLine = (line, stream) => {
      lines.push(line);
      emit({ type: 'log', line, stream });
    };
    // streamJson adapters (Cursor) speak NDJSON: one event per line as the model
    // works. The interpreter turns those into the SAME live events everything
    // downstream already understands (log/file/module), so the conversation,
    // tool calls, and file writes appear as they happen instead of in one
    // buffered dump when the CLI exits. Plain and stderr lines always push raw.
    const interpreter = adapter.streamJson ? createStreamJsonInterpreter() : null;
    const pushStdoutLine = (line) => {
      lines.push(line);
      if (interpreter) {
        for (const evt of interpreter.feed(line)) emitOnce(evt);
        return;
      }
      emitOnce({ type: 'log', line, stream: 'stdout' });
      try {
        const evt = JSON.parse(line);
        if (evt && evt.event === 'file') emit({ type: 'file', path: evt.path });
        if (evt && evt.event === 'module') emit({ type: 'module', id: evt.id });
      } catch { /* plain sentence, not an event */ }
    };

    child.stdout.on('data', (d) => {
      stdoutBuf += String(d);
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        pushStdoutLine(stdoutBuf.slice(0, idx));
        stdoutBuf = stdoutBuf.slice(idx + 1);
      }
    });
    child.stderr.on('data', (d) => {
      stderrBuf += String(d);
      let idx;
      while ((idx = stderrBuf.indexOf('\n')) >= 0) {
        pushLine(stderrBuf.slice(0, idx), 'stderr');
        stderrBuf = stderrBuf.slice(idx + 1);
      }
    });

    // Watch the engine-side init state so the UI can show "Creating GitHub repository."
    const poll = setInterval(() => {
      const st = readInitState(projectDir);
      if (st && st.status === 'running' && !poll.seenRunning) {
        poll.seenRunning = true;
        emit({ type: 'phase', name: 'creating-github' });
      }
      if (st && st.status === 'done' && !poll.seenDone) {
        poll.seenDone = true;
        emit({ type: 'github', state: st });
      }
    }, 500);

    if (adapter.promptDelivery === 'stdin') child.stdin.end(prompt);
    else child.stdin.end();

    child.on('error', (err) => {
      if (activeChild.proc === child) activeChild.proc = null;
      clearInterval(poll);
      resolve({ code: -1, lines: [`Failed to start ${adapter.command}: ${err.message}`], out: '', err: String(err.message) });
    });
    child.on('close', (code) => {
      if (activeChild.proc === child) activeChild.proc = null;
      clearInterval(poll);
      if (stdoutBuf.trim()) {
        const rest = stdoutBuf.trim();
        stdoutBuf = '';
        let idx;
        let start = 0;
        while ((idx = rest.indexOf('\n', start)) >= 0) {
          pushStdoutLine(rest.slice(start, idx));
          start = idx + 1;
        }
        if (rest.slice(start).trim()) pushStdoutLine(rest.slice(start));
      }
      if (stderrBuf.trim()) pushLine(stderrBuf.trim(), 'stderr');
      const st = readInitState(projectDir);
      if (st && st.status === 'done') {
        if (!poll.seenRunning) emit({ type: 'phase', name: 'creating-github' });
        if (!poll.seenDone) emit({ type: 'github', state: st });
      }
      resolve({ code, lines, out: stdoutBuf, err: stderrBuf });
    });
    poll.unref?.();
  });
}

// Keep the shims dir alive across rounds within one process run.
const shimsCache = { dir: null, projectDir: null };
function require_path_delimiter() { return process.platform === 'win32' ? ';' : ':'; }

function ensureShims(projectDir) {
  if (!shimsCache.dir || shimsCache.projectDir !== projectDir) {
    shimsCache.dir = makeShims(projectDir);
    shimsCache.projectDir = projectDir;
  }
  return shimsCache.dir;
}

// Runs the configuration model with restricted tools, then validates the bootstrap.
// Guard failures trigger automatic repair rounds (max 5), each round includes the guard
// output in the prompt. Usage limits are reported as a wait, not a failed task.
export async function runConfigurationModel({
  projectDir, answers, answersPath, agent, emit = () => {}, maxRounds = 5, env = process.env, shouldStop = null,
}) {
  const adapter = getAdapter(agent);
  ensureShims(projectDir);
  const [owner, slug] = String(answers.project.slug).split('/');
  const finalLine = `devos init: ${owner}/${slug} is set up; devos-cycle dispatched.`;
  let prompt = buildConfigPrompt({ answers, answersPath, projectDir, payloadDir: payloadPath() });
  let round = 0;
  const files = [];
  const modules = new Set();
  const allLines = [];
  const onEvent = (evt) => {
    if (evt.type === 'file') files.push(evt.path);
    if (evt.type === 'module') modules.add(evt.id);
    emit(evt);
  };

  const stoppedResult = () => ({
    ok: false, stopped: true, exitCode: 0, finalLine, lines: allLines,
    message: `Stopped before the model finished. Everything written so far is kept in ${projectDir}. Resume when ready: devos continue ${projectDir}`,
  });

  while (true) {
    if (shouldStop && shouldStop()) {
      onEvent({ type: 'phase', name: 'stopped' });
      return stoppedResult();
    }
    onEvent({ type: 'phase', name: round === 0 ? 'writing-project' : 'repairing', round });
    const result = await runOnce({
      adapter, model: answers.models.configurationModel.model, prompt,
      projectDir, answersPath, round, emit: onEvent, env,
    });
    allLines.push(...result.lines);
    // The CLI ran this exact model to completion — proof for the audit (a CLI
    // that never answers `agent models` is still proven to work in practice).
    if (result.code === 0) recordModelRun({ projectDir, cli: adapter.command, model: answers.models.configurationModel.model });
    if (shouldStop && shouldStop()) {
      // A kill is a decision, not a model failure — unless the model had just
      // finished GitHub setup, in which case the ordinary flow judges the tree.
      const stNow = readInitState(projectDir);
      if (!(stNow && stNow.status === 'done')) {
        onEvent({ type: 'phase', name: 'stopped' });
        return {
          ok: false, stopped: true, exitCode: result.code ?? -1, finalLine, lines: allLines,
          message: `Stopped by you while the model was writing. Everything written so far is kept in ${projectDir}. Resume when ready: devos continue ${projectDir}`,
        };
      }
    }
    if (result.code !== 0) {
      const combined = result.lines.join('\n');
      if (looksLikeUsageLimit(combined, adapter)) {
        const hit = result.lines.find((l) => looksLikeUsageLimit(l, adapter)) || 'usage limit';
        onEvent({ type: 'phase', name: 'usage-limit' });
        return { ok: false, usageLimit: true, message: String(hit).trim(), exitCode: result.code, finalLine, lines: allLines };
      }
      if (looksLikeCommandRejection(combined)) {
        // The permission wall: the CLI refused the model's commands. The engine
        // passes --force automatically now; an outdated CLI build is the usual
        // remaining cause, so the fix names the update, not a dead end.
        onEvent({ type: 'phase', name: 'error' });
        return {
          ok: false, permissionIssue: true, exitCode: result.code, finalLine, lines: allLines,
          message: [
            `${adapter.command} rejected the model's commands (npm install, init_github, file edits), so nothing could be executed.`,
            `The engine passes --force automatically; if this persists, update the CLI ("${adapter.command} update") and run: devos continue ${projectDir}.`,
          ].join(' '),
        };
      }
      if (looksLikeTrustGate(combined)) {
        onEvent({ type: 'phase', name: 'trust-gate' });
        return {
          ok: false, trustIssue: true, exitCode: result.code, finalLine, lines: allLines,
          message: [
            `${adapter.command} is asking for a one-time trust confirmation of the project folder. DEV_OS created this folder, so trusting it is safe.`,
            `Fix: open a terminal in the project folder, run "${adapter.command}" once, answer the trust question with Yes, quit, then run "devos continue ${projectDir}".`,
            'Newer engine builds pass --trust automatically, so the prompt never appears again.',
          ].join(' '),
        };
      }
      if (looksLikePlanRestriction(combined)) {
        onEvent({ type: 'phase', name: 'plan-restriction' });
        return {
          ok: false, planIssue: true, exitCode: result.code, finalLine, lines: allLines,
          message: [
            `${adapter.command} refused the model "${answers.models.configurationModel.model}" — the account's plan there only runs Auto (e.g. Cursor's Free plan).`,
            `Fix (pick one): resume with Auto — "devos continue ${projectDir} --model auto"; or switch to another installed CLI — "devos continue ${projectDir} --cli claude"; or upgrade the plan and resume with "devos continue ${projectDir}".`,
          ].join(' '),
        };
      }
      const failedState = readInitState(projectDir);
      if (!(failedState && failedState.status === 'done')) {
        onEvent({ type: 'phase', name: 'error' });
        return {
          ok: false, exitCode: result.code,
          message: result.lines.slice(-8).join('\n') || `${adapter.command} exited with code ${result.code}`,
          finalLine, lines: allLines,
        };
      }
      // GitHub is already set up, so this nonzero exit is recoverable: the usual
      // cause is a repair round whose model re-called init_github, which correctly
      // refuses to run twice. The repository exists; let the guards judge the tree.
      onEvent({ type: 'log', line: 'The model stopped after GitHub was already set up. Checking the project guards…', stream: 'engine' });
    }

    const guard = validateBootstrap(projectDir, answers, { engineRoot: engineRoot() });
    if (guard.ok) {
      const init = readInitState(projectDir);
      if (!init || init.status !== 'done') {
        onEvent({ type: 'phase', name: 'error' });
        // A model that finished its turn but never created the repository most
        // often could not run commands at all (its own words say so). Say that,
        // with the real fix, instead of the generic resume hint.
        if (looksLikeCommandRejection(allLines.join('\n'))) {
          return {
            ok: false, permissionIssue: true, message: [
              'The project tree passed the guards, but init_github was never called: the CLI rejected every command the model tried to run (npm install, init_github).',
              `The engine now takes over from here — run: devos continue ${projectDir}. It installs the dependencies and runs init_github itself (an existing repository is adopted), and only wakes the model when the guards still fail.`,
            ].join(' '),
            exitCode: 0, finalLine, lines: allLines,
          };
        }
        return {
          ok: false, message: `The project tree passed the guards, but init_github was never called. Run devos continue ${projectDir} — the engine installs the dependencies and runs init_github itself, without waking the model again.`,
          exitCode: 0, finalLine, lines: allLines,
        };
      }
      onEvent({ type: 'log', line: finalLine, stream: 'engine' });
      return { ok: true, round, init, finalLine, files, modules: [...modules], lines: allLines };
    }
    if (round >= maxRounds) {
      onEvent({ type: 'phase', name: 'error' });
      return {
        ok: false, guardFailed: true,
        message: `The bootstrap failed the guards after ${maxRounds} repair rounds.`,
        report: guard.report, exitCode: 0, finalLine, lines: allLines,
      };
    }
    round += 1;
    onEvent({ type: 'phase', name: 'repairing', round, report: guard.report });
    prompt = buildConfigPrompt({ answers, answersPath, projectDir, payloadDir: payloadPath() })
      + `\n\nREPAIR ROUND ${round} of ${maxRounds}. Your previous run did not pass these bootstrap checks. Fix exactly these problems inside the project directory, then call init_github only if it has not completed yet, and end with the final line:\n\n`
      + guard.report.map((l) => `- ${l}`).join('\n') + '\n';
  }
}

// One targeted model run for `devos fix`: the audit's model-fixable problems go in
// as a plain prompt; the model repairs the tree with the SAME restricted tools as
// the configuration model (Read/Edit/Write + the init_github/request_secret shims,
// nothing else). No bootstrap contract, no repair loop — the caller re-audits after.
// Usage limits, trust gates, and plan walls are classified exactly like init runs.
export async function runRepairModel({
  projectDir, answers, agent, prompt, emit = () => {}, env = process.env, shouldStop = null,
}) {
  const adapter = getAdapter(agent);
  ensureShims(projectDir);
  const answersPath = join(projectDir, 'devos', 'answers.json');
  const result = await runOnce({
    adapter, model: answers.models.configurationModel.model, prompt,
    projectDir, answersPath, round: 0, emit, env,
  });
  // Same proof as the init path: a completed consultation also verifies the model.
  if (result.code === 0) recordModelRun({ projectDir, cli: adapter.command, model: answers.models.configurationModel.model });
  if (shouldStop && shouldStop()) {
    emit({ type: 'phase', name: 'stopped' });
    return { ok: false, stopped: true, exitCode: result.code ?? -1, lines: result.lines, message: 'Stopped by you. Nothing further was changed by this repair pass.' };
  }
  const combined = result.lines.join('\n');
  if (result.code !== 0) {
    if (looksLikeUsageLimit(combined, adapter)) {
      const hit = result.lines.find((l) => looksLikeUsageLimit(l, adapter)) || 'usage limit';
      emit({ type: 'phase', name: 'usage-limit' });
      return { ok: false, usageLimit: true, message: String(hit).trim(), exitCode: result.code, lines: result.lines };
    }
    if (looksLikeCommandRejection(combined)) {
      emit({ type: 'phase', name: 'error' });
      return {
        ok: false, permissionIssue: true, exitCode: result.code, lines: result.lines,
        message: `${adapter.command} rejected the model's commands, so the repair could not run. The engine passes --force automatically; if this persists, update the CLI ("${adapter.command} update"), then run devos fix again.`,
      };
    }
    if (looksLikeTrustGate(combined)) {
      emit({ type: 'phase', name: 'trust-gate' });
      return {
        ok: false, trustIssue: true, exitCode: result.code, lines: result.lines,
        message: `${adapter.command} is asking for a one-time trust confirmation of the project folder. Run "${adapter.command}" once interactively in the folder, answer Yes, quit, then run devos fix again.`,
      };
    }
    if (looksLikePlanRestriction(combined)) {
      emit({ type: 'phase', name: 'plan-restriction' });
      return {
        ok: false, planIssue: true, exitCode: result.code, lines: result.lines,
        message: `${adapter.command} refused the model "${answers.models.configurationModel.model}" — the account's plan there only runs Auto. Fix: devos continue ${projectDir} --model auto (then devos fix), or switch tools with --cli <tool>.`,
      };
    }
    return { ok: false, exitCode: result.code, message: result.lines.slice(-8).join('\n') || `${adapter.command} exited with code ${result.code}`, lines: result.lines };
  }
  return { ok: true, exitCode: 0, lines: result.lines };
}
