// Live progress for the configuration-model stage. Why this exists:
// the run can sit silent for minutes (a big write, a model retrying its
// connection), and a silent terminal looks like a dead engine. This module turns
// the SAME run events that already flow to the UI into a todo checklist, a
// percentage, counters, and a liveness signal ("last output 8s ago"), so the
// developer always sees what is happening and how far along it is.
//
// It is a pure reducer: applyEvent(state, evt) mutates the state,
// progressSnapshot(state) renders it. The server feeds it every broadcast event,
// pushes snapshots to the browser as `progress` SSE events, and prints compact
// status lines in the terminal. No timers of its own — tests inject `now`.

const RECONNECT_RE = /\bre ?connect|\bretry|reconnecting|attempt \d+\b/i;

export function createProgressState({ now = () => Date.now() } = {}) {
  return {
    now,
    startedAt: null,     // first event timestamp
    phase: 'starting',   // starting|writing|repairing|github|failed|stopping|stopped
    failKind: null,      // usage-limit|trust-gate|plan-restriction|error
    files: 0,
    modulesCount: 0,
    lines: 0,
    reconnects: 0,
    rounds: 0,
    githubDone: false,
    percent: 2,
    cyclePercent: null,  // REAL percent, from the cycle run's own steps (GitHub)
    lastLineAt: null,
    lastLine: null,
    final: null,
  };
}

// Percent is deliberately honest: it advances on real milestones (files,
// modules, repair rounds, GitHub), has a slow time floor so a silent-but-working
// model still shows motion, and freezes on failure instead of pretending.
function computePercent(state, now) {
  if (state.final) return state.final.ok ? 100 : state.percent;
  // Failed, stopping, and stopped runs keep the honest number — no fake motion.
  if (state.phase === 'stopping' || state.phase === 'stopped' || state.phase === 'failed') return state.percent;
  // A cycle watch feeds the REAL percentage (the run's own completed steps,
  // from GitHub). It replaces the time-based estimate entirely — the field
  // question "why 10% and time stops" was exactly this estimate lying. The
  // number still only moves forward, and caps below 100 until the run lands.
  if (state.cyclePercent != null) {
    return Math.max(state.percent, Math.min(97, state.cyclePercent));
  }
  const started = state.startedAt || now;
  const elapsedMin = Math.max(0, (now - started) / 60000);
  const eventP = 6 + state.files * 2 + state.modulesCount + state.rounds * 4;
  const timeP = 6 + Math.floor(elapsedMin * 3); // +3% per minute, capped low
  let p = Math.max(state.percent, Math.min(84, eventP), Math.min(70, timeP));
  if (state.phase === 'github') p = Math.max(p, 88);
  if (state.githubDone) p = Math.max(p, 95);
  const cap = state.githubDone ? 95 : state.phase === 'github' ? 88 : 84;
  return Math.min(cap, p);
}

export function applyEvent(state, evt) {
  if (!evt || !evt.type) return state;
  const now = state.now();
  if (!state.startedAt) state.startedAt = now;
  try {
    switch (evt.type) {
      case 'phase': {
        const map = {
          'writing-project': 'writing', repairing: 'repairing', 'creating-github': 'github',
          assessing: 'assessing', installing: 'installing',
          'usage-limit': 'failed', 'trust-gate': 'failed', 'plan-restriction': 'failed',
          error: 'failed', stopping: 'stopping', stopped: 'stopped',
        };
        if (map[evt.name]) state.phase = map[evt.name];
        if (evt.name === 'usage-limit' || evt.name === 'trust-gate' || evt.name === 'plan-restriction' || evt.name === 'error') state.failKind = evt.name;
        if (evt.name === 'repairing') state.rounds = evt.round || state.rounds + 1;
        if (evt.name === 'writing-project') state.activeStep = 'write';
        if (evt.name === 'repairing') state.activeStep = 'verify';
        if (evt.name === 'creating-github') state.activeStep = 'github';
        // failed/stopping/stopped keep the last active step, so the todo can mark
        // exactly where the run ended instead of failing the whole list.
        break;
      }
      case 'file':
        state.files += 1;
        state.lastLineAt = now;
        state.lastLine = `wrote ${String(evt.path || '').slice(0, 160)}`;
        break;
      case 'module':
        state.modulesCount += 1;
        state.lastLineAt = now;
        state.lastLine = `module ${evt.id} included`;
        break;
      case 'log':
        state.lines += 1;
        state.lastLineAt = now;
        state.lastLine = String(evt.line || '').slice(0, 160);
        if (RECONNECT_RE.test(evt.line || '')) state.reconnects += 1;
        break;
      case 'cycle-progress': {
        // The watcher's REAL step-level progress (percent + active step name).
        const p = Number(evt.percent);
        if (Number.isFinite(p)) state.cyclePercent = Math.max(0, Math.min(97, p));
        state.lastLineAt = now;
        state.lastLine = evt.step ? `cycle step: ${String(evt.step).slice(0, 120)}` : 'cycle running';
        break;
      }
      case 'github':
        state.githubDone = true;
        break;
      case 'final':
        state.final = evt;
        break;
      default:
        break; // progress replays and unknown types never corrupt the state
    }
    state.percent = computePercent(state, now);
  } catch { /* a bad event must never break a running init */ }
  return state;
}

export function progressSnapshot(state) {
  const now = state.now();
  // Recompute on EVERY snapshot, not only when an event arrives: during a long
  // silent stretch (a model thinking for ten minutes) there are no events, and
  // a percent that only moves on events sits frozen at its starting value —
  // exactly the "6% for twelve minutes" blindness this module exists to prevent.
  // The slow time floor inside computePercent keeps the number honestly moving;
  // failed/stopping/stopped states keep it frozen (computePercent handles that).
  state.percent = computePercent(state, now);
  const done = Boolean(state.final && state.final.ok);
  const failed = Boolean(state.final && !state.final.ok);
  const ended = (failed || state.phase === 'stopped') && !done;
  const endedAt = (id) => (ended && state.activeStep === id ? 'stopped' : 'pending');
  const steps = [
    { id: 'answers', label: 'answers saved', state: 'done', detail: null },
    {
      id: 'write', label: 'model writes the project',
      state: done || state.githubDone || state.phase === 'github' ? 'done' : state.phase === 'writing' ? 'active' : endedAt('write'),
      detail: state.files || state.modulesCount ? `${state.files} files · ${state.modulesCount} modules` : null,
    },
    {
      id: 'github', label: 'create the GitHub repository + first cycle',
      state: state.githubDone ? 'done' : state.phase === 'github' ? 'active' : endedAt('github'),
      detail: null,
    },
    {
      id: 'verify', label: 'bootstrap guards & verify',
      state: done ? 'done' : state.phase === 'repairing' ? 'active' : endedAt('verify'),
      detail: state.rounds ? `repair round ${state.rounds}` : null,
    },
  ];
  return {
    percent: state.percent,
    phase: done ? 'done' : failed ? 'failed' : state.phase,
    failKind: state.failKind,
    stopping: state.phase === 'stopping',
    elapsedMs: state.startedAt ? now - state.startedAt : 0,
    lastOutputAgoMs: state.lastLineAt ? now - state.lastLineAt : null,
    counters: { files: state.files, modules: state.modulesCount, lines: state.lines, reconnects: state.reconnects, rounds: state.rounds },
    lastLine: state.lastLine,
    steps,
  };
}

export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function formatAgo(ms) {
  if (ms == null) return 'no output yet';
  if (ms < 2000) return 'just now';
  return `${formatElapsed(ms)} ago`;
}

// One compact terminal line: `[devos] ▸ 34% · 14 files · 1m 42s · last output 8s ago · writes src/app/page.tsx`
export function renderStatusLine(snap) {
  const bits = [`▸ ${snap.percent}%`];
  if (snap.counters.files) bits.push(`${snap.counters.files} files`);
  if (snap.counters.modules) bits.push(`${snap.counters.modules} modules`);
  if (snap.counters.rounds) bits.push(`round ${snap.counters.rounds}`);
  bits.push(formatElapsed(snap.elapsedMs));
  bits.push(`last output ${formatAgo(snap.lastOutputAgoMs)}`);
  if (snap.lastLine) bits.push(String(snap.lastLine).slice(0, 60));
  if (snap.counters.reconnects) bits.push(`reconnecting ×${snap.counters.reconnects}`);
  return bits.join(' · ');
}

// The todo list as one terminal line: `todo: [x] answers saved · [·] model writes …`
export function renderChecklist(snap) {
  const tick = (s) => (s === 'done' ? 'x' : s === 'active' ? '·' : s === 'stopped' ? '!' : ' ');
  return `todo: ${snap.steps.map((s) => `[${tick(s.state)}] ${s.label}${s.detail ? ` (${s.detail})` : ''}`).join(' · ')}`;
}
