import http from 'node:http';
import { join } from 'node:path';
import { uiPath } from './paths.mjs';
import { loadCatalogue, loadStack, stackCards } from './catalogue.mjs';
import { machineCheck } from './doctor.mjs';
import { detectAgents } from './probes.mjs';
import { readDraft, writeDraft, readDefaults } from './answers.mjs';
import { STEPS, recommendedConfiguration } from './wizard.mjs';
import { runInit } from './init.mjs';
import { runContinue, assessProject } from './continue.mjs';
import { createProgressState, applyEvent, progressSnapshot, renderStatusLine, renderChecklist } from './progress.mjs';
import { killActiveChild } from './configmodel.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { lastProjectFile } from './paths.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Started projects the UI can offer to continue: the last project first, then a
// shallow scan of the workspace. Each candidate carries its local checklist
// (guards, deps, init state — no gh spawns), so the card can say exactly what
// is done and what the continue run would finish.
function resumeCandidates({ home, workspace }) {
  const found = new Map();
  const add = (dir) => {
    try {
      const p = String(dir);
      if (!p || found.has(p)) return;
      const a = assessProject({ projectDir: p, gh: false });
      if (!a.started) return;
      found.set(p, { path: p, slug: a.slug, name: a.answers?.project?.name || null, doneCount: a.doneCount, todoCount: a.todoCount, steps: a.steps });
    } catch { /* unreadable candidate is skipped */ }
  };
  try {
    const lp = lastProjectFile(home);
    if (existsSync(lp)) add(JSON.parse(readFileSync(lp, 'utf8')).path);
  } catch { /* no last project yet */ }
  try {
    for (const e of readdirSync(workspace, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') add(join(workspace, e.name));
    }
  } catch { /* workspace unreadable */ }
  return [...found.values()].slice(0, 3);
}

// The machine/agent probe and the resume scan each spawn CLIs (gh, the agent
// binaries) — seconds of work per /api/state call, and the browser cannot draw
// until it answers. A short cache keeps reloads instant; Re-check (POST
// /api/probe) still forces a fresh read, and every server instance starts cold.
const PROBE_TTL_MS = 45_000;
const RESUME_TTL_MS = 10_000;

// The guided UI server. Binds to 127.0.0.1 only. One HTML file, one CSS file, one JS file.
export function startServer({ home, workspace, port = 7788, log = () => {} }) {
  const state = {
    draft: readDraft(home) || null,
    run: null, // {events: [], listeners: Set, done: bool, result}
  };

  // Per-instance caches (a fresh server re-probes — tests never see stale data).
  const probeCache = { at: 0, agents: null, machine: null };
  const probeFresh = () => {
    probeCache.agents = detectAgents();
    probeCache.machine = machineCheck();
    probeCache.at = Date.now();
    return probeCache;
  };
  const probeCached = () => (probeCache.agents && Date.now() - probeCache.at < PROBE_TTL_MS ? probeCache : probeFresh());
  let resumeCache = { at: 0, list: null };
  const resumeCached = () => {
    if (resumeCache.list && Date.now() - resumeCache.at < RESUME_TTL_MS) return resumeCache.list;
    resumeCache = { at: Date.now(), list: resumeCandidates({ home, workspace }) };
    return resumeCache.list;
  };

  // The run's output is piped for SSE, so the command window would otherwise sit
  // silent for minutes. Mirror every event to the terminal: the developer always
  // has a second, independent view of what the configuration model is doing.
  // The model's own lines print as [agent]; engine sentences as [devos].
  const PHASE_ECHO = {
    'writing-project': 'Writing project…',
    'creating-github': 'Creating GitHub repository…',
    'syncing-repo': 'Pushing the repaired tree to the repository…',
    assessing: 'Checking what is already done and what is missing…',
    installing: 'Installing dependencies…',
    consulting: 'Asking the configuration model to propose a fix…',
    'applying-fix': 'Applying the fix you approved…',
    'restarting-cycle': 'Starting a fresh devos-cycle run with the keys in place…',
    'watching-cycle': 'Watching the fresh cycle run — the report comes when it finishes…',
    'cycle-report': 'Reading the last cycle run and writing the report…',
    'keys-intake': 'Waiting for the missing keys — the intake card is open in the browser…',
    'usage-limit': 'Usage limit reached — wait, then run: devos continue <project folder>',
    error: 'The run stopped with an error',
  };
  const echo = (evt) => {
    try {
      // An EXTERNAL run (the terminal continue hosting this window) already
      // prints every event through the CLI's own printer in its process —
      // echoing here would print every line twice.
      if (state.run && state.run.external) return;
      if (evt.type === 'phase') {
        if (evt.name === 'repairing') console.log(`[devos] Guard check failed — automatic repair round ${evt.round} of 5.`);
        else if (evt.name === 'stopping') console.log('[devos] Stopping — killing the model process…');
        else if (evt.name === 'stopped') console.log('[devos] Stopped. Everything written so far is saved in the project folder.');
        else if (PHASE_ECHO[evt.name]) console.log(`[devos] ${PHASE_ECHO[evt.name]}${evt.round ? ` (round ${evt.round})` : ''}`);
        if (state.run && state.run.progress && ['writing-project', 'repairing', 'creating-github', 'stopping', 'stopped'].includes(evt.name)) {
          console.log(`[devos] ${renderChecklist(progressSnapshot(state.run.progress))}`);
        }
      }
      else if (evt.type === 'file') console.log(`[devos] wrote ${evt.path}`);
      else if (evt.type === 'module') console.log(`[devos] module ${evt.id} included`);
      else if (evt.type === 'log') console.log(evt.stream === 'install' ? `[deps] ${evt.line}` : evt.stream === 'repair' ? `[fix] ${evt.line}` : evt.stream && evt.stream !== 'engine' ? `[agent] ${evt.line}` : `[devos] ${evt.line}`);
      else if (evt.type === 'github') console.log('[devos] GitHub repository created; the first cycle was dispatched.');
      else if (evt.type === 'keys-intake') {
        const names = [...(evt.missing || []), ...(evt.unconfirmed || [])];
        console.log(`[devos] Missing key(s): ${names.join(', ')} — the intake card is open in the browser.`);
        console.log('[devos] A value travels browser → gh secret set only; it is never logged, never sent to any model. Names only are printed here.');
      }
      else if (evt.type === 'keys-intake-done') {
        console.log(evt.stopped ? '[devos] The keys intake was closed by a stop — the run winds down.'
          : evt.skipped ? '[devos] Keys skipped for now — the run finishes with exact instructions.'
          : `[devos] ${((evt.names || []).length)} value(s) received from the browser — uploading to GitHub (names only are echoed).`);
      }
      else if (evt.type === 'proposal') {
        const p = evt.proposal || {};
        console.log('[devos] The configuration model proposes a fix:');
        if (p.diagnosis) console.log(`[devos]   why: ${p.diagnosis}`);
        for (const c of p.commands || []) console.log(`[devos]   run: ${c.run}${c.why ? `  (${c.why})` : ''}`);
        for (const s of p.userSteps || []) console.log(`[devos]   you: ${s}`);
        console.log('[devos] Approve or decline it in the browser window (the Approve/Decline card).');
      }
      else if (evt.type === 'proposal-decision') {
        console.log(evt.stopped ? '[devos] The run was stopped — the proposal was not applied.' : evt.approve ? '[devos] Approved — applying the fix, then retrying the step.' : '[devos] Declined — nothing was applied.');
      }
      else if (evt.type === 'error') console.log(`[devos] error: ${evt.message || ''}`);
      else if (evt.type === 'final') {
        if (evt.ok) console.log(`[devos] ${evt.finalLine || 'Setup finished.'}`);
        else if (evt.stopped) console.log('[devos] Stopped by you. Resume any time: devos continue <project folder>');
        else console.log(`[devos] FAILED: ${evt.message || evt.error || 'unknown error'}`);
      }
    } catch { /* the terminal echo must never break a running init */ }
  };

  // Terminal status line at most every 10 s; the browser gets a progress
  // snapshot at most every 1 s. Both are fed by the same reducer.
  const STATUS_EVERY_MS = 10_000;
  const PROGRESS_EVERY_MS = 1_000;
  const pushProgress = (snap, listeners) => {
    state.run.events.push({ type: 'progress', ...snap });
    for (const res of listeners || state.run.listeners) {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...snap })}\n\n`);
    }
  };

  const broadcast = (evt) => {
    if (!state.run) return;
    state.run.events.push(evt);
    applyEvent(state.run.progress, evt);
    echo(evt);
    try {
      const now = Date.now();
      const snap = progressSnapshot(state.run.progress);
      const important = evt.type === 'phase' || evt.type === 'final' || evt.type === 'github' || evt.type === 'error';
      if (important || now - (state.run.progressPushAt || 0) >= PROGRESS_EVERY_MS) {
        state.run.progressPushAt = now;
        pushProgress(snap);
      }
      if (!important || evt.name === 'stopping') {
        if (now - (state.run.statusAt || 0) >= STATUS_EVERY_MS) {
          state.run.statusAt = now;
          console.log(`[devos] ${renderStatusLine(snap)}`);
        }
      }
    } catch { /* progress must never break the run */ }
    for (const res of state.run.listeners) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
  };

  const json = (res, code, body) => {
    const data = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  };

  // The Stop button (browser) and Ctrl+C (terminal) both land here: flag the run
  // so the run loop winds down, and kill the model process tree right now.
  const stopRun = () => {
    if (!state.run || state.run.done) return { ok: false, running: false, error: 'No init run is in progress.' };
    state.run.stopRequested = true;
    // A Stop also answers a waiting keys intake: resolved with null, so the run
    // winds down cleanly instead of hanging on a card nobody will submit.
    if (state.run.pendingKeys) {
      const pending = state.run.pendingKeys;
      state.run.pendingKeys = null;
      try {
        broadcast({ type: 'keys-intake-done', stopped: true, names: [] });
      } catch { /* the resolve below still goes through */ }
      try { pending.resolve(null); } catch { /* already settled */ }
    }
    // A Stop also answers a waiting fix proposal: declined, so the run winds down
    // cleanly instead of hanging on a card nobody will press.
    if (state.run.pendingProposal) {
      const pending = state.run.pendingProposal;
      state.run.pendingProposal = null;
      try {
        broadcast({ type: 'proposal-decision', approve: false, stopped: true });
      } catch { /* the resolve below still goes through */ }
      try { pending.resolve(false); } catch { /* already settled */ }
    }
    try {
      broadcast({ type: 'phase', name: 'stopping' });
    } catch { /* the kill still goes through */ }
    const killed = killActiveChild('stop requested');
    return { ok: true, running: true, killed };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(readFileSync(uiPath('index.html')));
        return;
      }
      if (req.method === 'GET' && ['/app.css', '/app.js', '/hairline.js', '/hairline-custom.js', '/hairline-stage.js'].includes(url.pathname)) {
        const file = url.pathname.slice(1);
        res.writeHead(200, { 'Content-Type': MIME[join(file).match(/\.\w+$/)[0]] });
        res.end(readFileSync(uiPath(file)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const catalogue = loadCatalogue();
        const probe = probeCached();
        const agents = state.run?.agents || probe.agents;
        return json(res, 200, {
          steps: STEPS,
          draft: state.draft,
          defaults: readDefaults(home),
          machine: probe.machine,
          agents,
          recommendation: recommendedConfiguration(agents),
          types: catalogue.types,
          modules: catalogue.modules,
          stacks: stackCards(catalogue),
          tools: catalogue.tools,
          pickPolicies: catalogue.pickPolicies,
          builderStrengths: catalogue.builderStrengths,
          customTool: catalogue.customTool,
          running: Boolean(state.run && !state.run.done),
          progress: state.run && !state.run.done ? progressSnapshot(state.run.progress) : null,
          proposal: state.run && !state.run.done && state.run.pendingProposal ? state.run.pendingProposal.proposal : null,
          keysIntake: state.run && !state.run.done && state.run.pendingKeys ? state.run.pendingKeys.payload : null,
          lastRun: state.run ? { done: state.run.done, result: state.run.result } : null,
          resume: { candidates: resumeCached() },
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/draft') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
        req.on('end', () => {
          try {
            const draft = JSON.parse(body);
            state.draft = draft;
            writeDraft(home, draft);
            json(res, 200, { ok: true });
          } catch (e) {
            json(res, 400, { ok: false, error: e.message });
          }
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/probe') {
        // Re-check is always a fresh read and refreshes the cache for /api/state.
        const fresh = probeFresh();
        return json(res, 200, { agents: fresh.agents, machine: fresh.machine });
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        return json(res, 200, stopRun());
      }
      // The Approve/Decline card in the browser answers a waiting fix proposal
      // here. Approving resolves the run's decide() promise and the engine runs
      // only the listed commands, then retries the failed step.
      if (req.method === 'POST' && url.pathname === '/api/proposal') {
        if (!state.run || state.run.done || !state.run.pendingProposal) {
          return json(res, 409, { ok: false, error: 'No fix proposal is waiting for a decision.' });
        }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
        req.on('end', () => {
          try {
            const { approve } = JSON.parse(body || '{}');
            const pending = state.run.pendingProposal;
            state.run.pendingProposal = null;
            broadcast({ type: 'proposal-decision', approve: Boolean(approve) });
            pending.resolve(Boolean(approve));
            json(res, 200, { ok: true, approve: Boolean(approve) });
          } catch (e) {
            json(res, 400, { ok: false, error: e.message });
          }
        });
        return;
      }
      // The keys intake card in the browser answers the waiting run here. The
      // values travel in this request body ONLY — they are handed straight to
      // the engine's secrets stage (which pipes each one to `gh secret set` over
      // stdin), and nothing else ever happens with them: no log line, no event,
      // no echo, no storage. Only NAMES go back into the event stream.
      if (req.method === 'POST' && url.pathname === '/api/keys') {
        if (!state.run || state.run.done || !state.run.pendingKeys) {
          return json(res, 409, { ok: false, error: 'No keys intake is waiting right now.' });
        }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
        req.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const pending = state.run.pendingKeys;
            state.run.pendingKeys = null;
            if (parsed.skip) {
              broadcast({ type: 'keys-intake-done', skipped: true, names: [] });
              pending.resolve(null);
              return json(res, 200, { ok: true, skipped: true });
            }
            const values = parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
              ? parsed.values : {};
            // NAMES only — for the event, the reply, and the terminal echo.
            const names = Object.keys(values).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n) && typeof values[n] === 'string' && values[n].trim());
            broadcast({ type: 'keys-intake-done', names });
            pending.resolve(values);
            json(res, 200, { ok: true, names });
          } catch (e) {
            json(res, 400, { ok: false, error: e.message });
          }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        if (!state.run) {
          res.write('data: {"type":"error","message":"No init run in progress."}\n\n');
          res.end();
          return;
        }
        for (const evt of state.run.events) res.write(`data: ${JSON.stringify(evt)}\n\n`);
        if (state.run.done) { res.end(); return; }
        state.run.listeners.add(res);
        req.on('close', () => state.run.listeners.delete(res));
        return;
      }
      // One run at a time, whichever door it came through (Confirm = new project,
      // Continue = resume a started one). The heartbeat, progress reducer, final
      // event, and verify-attachment are identical for both.
      const beginRun = (runner) => {
        state.run = { events: [], listeners: new Set(), done: false, result: null, progress: createProgressState(), stopRequested: false, progressPushAt: 0, statusAt: 0 };
        // A heartbeat for the dead-silent stretches: every 30 s the terminal gets
        // one status line (percent, counts, elapsed, age of the last output), so
        // "nothing printed" is never ambiguous again.
        state.run.heartbeat = setInterval(() => {
          try {
            if (state.run.done) return;
            console.log(`[devos] ${renderStatusLine(progressSnapshot(state.run.progress))}`);
          } catch { /* never break the run */ }
        }, 30_000);
        state.run.heartbeat.unref?.();
        runner()
          .then(async ({ result, projectDir, answers }) => {
            state.run.done = true;
            clearInterval(state.run.heartbeat);
            resumeCache = { at: 0, list: null }; // the run changed the workspace — rescan on next ask
            // Flat shape: the UI reads ok/finalLine/repoUrl/message straight off the event.
            state.run.result = {
              ok: Boolean(result.ok), projectDir,
              slug: answers?.project?.slug || result.slug || null,
              resumed: result.resumed || null, keysMissing: result.keysMissing || null,
              ...serializeResult(result),
            };
            if (!result.ok) {
              // Never a dead end: attach what still stands between the developer and a
              // finished setup, each with its fix and its owner (you / model / devos).
              try {
                const { auditSetup, remainingSteps } = await import('./verify.mjs');
                state.run.result.verify = remainingSteps(auditSetup({ projectDir, answers: answers || null }));
              } catch { /* the failure message still stands */ }
            }
            broadcast({ type: 'final', ...state.run.result });
            for (const r of state.run.listeners) r.end();
            state.run.listeners.clear();
          })
          .catch((e) => {
            state.run.done = true;
            clearInterval(state.run.heartbeat);
            resumeCache = { at: 0, list: null }; // the run changed the workspace — rescan on next ask
            state.run.result = { ok: false, message: e.message };
            broadcast({ type: 'final', ok: false, message: e.message });
            for (const r of state.run.listeners) r.end();
            state.run.listeners.clear();
          });
      };

      if (req.method === 'POST' && url.pathname === '/api/confirm') {
        if (state.run && !state.run.done) return json(res, 409, { ok: false, error: 'An init run is already in progress.' });
        const draft = state.draft;
        beginRun(() => runInit({ draft, home, workspace, emit: broadcast, shouldStop: () => Boolean(state.run && state.run.stopRequested) }));
        return json(res, 202, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/continue') {
        if (state.run && !state.run.done) return json(res, 409, { ok: false, error: 'A run is already in progress.' });
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy(); });
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const folder = payload.folder || (resumeCached()[0] || {}).path;
            if (!folder || !existsSync(join(folder, 'devos', 'answers.json'))) {
              return json(res, 400, { ok: false, error: 'No project folder given, or it holds no devos/answers.json.' });
            }
            beginRun(() => runContinue({
              projectDir: folder, home, overrides: payload.overrides || {},
              emit: broadcast, shouldStop: () => Boolean(state.run && state.run.stopRequested),
              // The keys stage never blocks a UI run on the terminal file-wait:
              // instead the run OPENS THE INTAKE CARD in the browser (the
              // requestValues door). The user types the missing values right
              // there; the engine uploads each one to GitHub (gh secret set over
              // stdin), re-checks GitHub's own list, and re-opens the card for
              // anything still missing — until every selected key is set, and
              // then the fresh cycle round starts on its own. A value lives in
              // the POST body and the gh pipe only; events carry names only.
              waitKeys: false,
              requestValues: (ask) => new Promise((resolve) => {
                const run = state.run;
                if (!run || run.done) { resolve(null); return; }
                run.pendingKeys = { resolve, payload: ask };
                broadcast({
                  type: 'keys-intake',
                  missing: ask.missing || [],
                  unconfirmed: ask.unconfirmed || [],
                  suspected: ask.suspected || [],
                  note: ask.note || '',
                  repo: ask.repo || null,
                  round: ask.round || 1,
                  total: ask.total || 0,
                  sources: ask.sources || {},
                });
              }),
              decide: (proposal) => new Promise((resolve) => {
                if (!state.run || state.run.done) { resolve(false); return; }
                state.run.pendingProposal = { resolve, proposal };
                broadcast({ type: 'proposal', proposal });
              }),
            }).then((r) => ({ result: r, projectDir: r.projectDir || folder, answers: r.assessment?.answers || null })));
            json(res, 202, { ok: true, folder });
          } catch (e) {
            json(res, 400, { ok: false, error: e.message });
          }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/result') {
        return json(res, 200, { run: state.run ? { done: state.run.done, result: state.run.result } : null });
      }
      json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    let attempt = port;
    const tryListen = () => {
      server.once('error', () => {
        attempt += 1;
        if (attempt > port + 20) {
          throw new Error(`No free port between ${port} and ${port + 20} on 127.0.0.1.`);
        }
        tryListen();
      });
      server.listen(attempt, '127.0.0.1', () => {
        resolve({
          server, url: `http://127.0.0.1:${attempt}`, port: attempt,
          // Control surface for the CLI process (Ctrl+C wiring lives there):
          stopRun,
          isRunning: () => Boolean(state.run && !state.run.done),
          // The terminal-continue bridge: `devos continue` runs in ITS OWN
          // process, but the user's promise is "the intake opens in the
          // browser window". attachRun lets the CLI host THIS server's UI for
          // its run: the browser gets the live log mirror (SSE), the Missing
          // keys card, the Approve/Decline card, and a working Stop button —
          // all the machinery the wizard's own continue already uses. One run
          // at a time: POST /api/continue is refused while a run is attached.
          attachRun: ({ onStop = null } = {}) => {
            state.run = {
              events: [], listeners: new Set(), done: false, result: null,
              progress: createProgressState(), stopRequested: false,
              progressPushAt: 0, statusAt: 0, external: true,
            };
            state.run.heartbeat = setInterval(() => {
              try {
                if (state.run.done) return;
                console.log(`[devos] ${renderStatusLine(progressSnapshot(state.run.progress))}`);
              } catch { /* never break the run */ }
            }, 30_000);
            state.run.heartbeat.unref?.();
            return {
              // Every engine event is mirrored into the browser (and the
              // terminal echo still prints — broadcast calls echo()).
              emit: broadcast,
              // The keys door: names in, values back ONCE from POST /api/keys.
              // The values live in the POST body and the gh pipe only.
              requestValues: (ask) => new Promise((resolveP) => {
                const run = state.run;
                if (!run || run.done) { resolveP(null); return; }
                run.pendingKeys = { resolve: resolveP, payload: ask };
                broadcast({
                  type: 'keys-intake',
                  missing: ask.missing || [],
                  unconfirmed: ask.unconfirmed || [],
                  suspected: ask.suspected || [],
                  note: ask.note || '',
                  repo: ask.repo || null,
                  round: ask.round || 1,
                  total: ask.total || 0,
                  sources: ask.sources || {},
                });
              }),
              // The Stop button: flags the run (the CLI's shouldStop reads it)
              // and kills any model child this process owns.
              stop: () => {
                const r = stopRun();
                if (onStop) { try { onStop(); } catch { /* the flag below stands */ } }
                return r;
              },
              // The run is over: final card in the browser, SSE closed.
              finish: (result) => {
                const run = state.run;
                if (!run || run.done) return;
                run.done = true;
                if (run.heartbeat) clearInterval(run.heartbeat);
                run.result = {
                  ok: Boolean(result && result.ok),
                  projectDir: (result && result.projectDir) || null,
                  slug: (result && result.slug) || null,
                  ...serializeResult(result),
                };
                try { broadcast({ type: 'final', ...run.result }); } catch { /* the close below stands */ }
                for (const r of run.listeners) { try { r.end(); } catch { /* already gone */ } }
                run.listeners.clear();
              },
            };
          },
        });
      });
    };
    tryListen();
  });
}

function serializeResult(result) {
  if (!result) return null;
  const out = { ok: Boolean(result.ok), finalLine: result.finalLine, message: result.message, usageLimit: result.usageLimit, trustIssue: result.trustIssue, planIssue: result.planIssue, permissionIssue: result.permissionIssue, stopped: Boolean(result.stopped),
    firstRunGreen: Boolean(result.firstRunGreen),
    cycleRestart: result.cycleRestart || null,
    cycleReport: Array.isArray(result.cycleReport) ? result.cycleReport : null };
  if (result.init) {
    out.repoUrl = result.init.repoUrl;
    out.actionsUrl = result.init.actionsUrl;
    out.setupIssueUrl = result.init.setupIssueUrl;
    out.runUrl = result.init.runUrl;
  }
  return out;
}
