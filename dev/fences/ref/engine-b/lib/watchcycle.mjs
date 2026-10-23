// The cycle watcher and reporter. Why this exists: restarting a failed devos-cycle
// run used to be the end of the story — a link, and the developer staring at the
// Actions list wondering whether anything happened (a rerun reuses the SAME run
// entry, so nothing new appears). The engine's philosophy is detect → report →
// fix, so now the engine DISPATCHES a fresh, visible run, WATCHES it to the end,
// and turns the outcome into a plain-English report: green = what happens next;
// failed = the failing step's own last log lines plus the likely cause; still
// running = how to get the report the moment it lands. Nothing here reads or
// writes secret values — only run statuses, job names, and GitHub's own
// (already-masked) log output.
import { runToolSync } from './spawn.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gh(args, timeout = 25_000) {
  try {
    const r = runToolSync('gh', args, { encoding: 'utf8', timeout });
    if (r.status !== 0) return null;
    return String(r.stdout || '');
  } catch { return null; }
}

// A fresh dispatch instead of `run rerun`: a rerun replays the OLD run entry
// (no new row in Actions — it reads as "nothing happened"), while a dispatch
// creates a new, visible run against the current main.
export function dispatchCycle(repo) {
  return gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', 'main']) !== null;
}

// Confirm the dispatch actually created a run: poll the run list for a run
// created after `afterMs` that is not the old failed one. gh indexes new runs
// within seconds; a short, bounded poll keeps this honest without hanging.
export async function findNewCycleRun(repo, afterMs, excludeId, { tries = 8, gapMs = 2500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const out = gh(['run', 'list', '--workflow', 'devos-cycle.yml', '--limit', '10', '--repo', repo,
      '--json', 'databaseId,status,conclusion,createdAt,url']);
    if (out && out.trim()) {
      try {
        const runs = JSON.parse(out);
        const fresh = (Array.isArray(runs) ? runs : []).find((x) => {
          if (String(x.databaseId) === String(excludeId)) return false;
          const at = x.createdAt ? new Date(x.createdAt).getTime() : 0;
          return !at || at >= afterMs - 5000;
        });
        if (fresh) {
          return {
            id: String(fresh.databaseId),
            url: fresh.url || `https://github.com/${repo}/actions/runs/${fresh.databaseId}`,
            status: fresh.status || '',
          };
        }
      } catch { /* a partial reply — try again */ }
    }
    if (i < tries - 1) await sleep(gapMs);
  }
  return null;
}

// The newest devos-cycle run of ANY status — the first-run loop works from it:
// live -> watch it, green -> the job is done, failed -> diagnose + fresh round.
export function latestCycleRun(repo) {
  const out = gh(['run', 'list', '--workflow', 'devos-cycle.yml', '--limit', '1', '--repo', repo,
    '--json', 'databaseId,status,conclusion,url']);
  if (!out || !out.trim()) return null;
  try {
    const run = (JSON.parse(out) || [])[0] || null;
    if (!run || !run.databaseId) return null;
    return {
      id: String(run.databaseId),
      url: run.url || `https://github.com/${repo}/actions/runs/${run.databaseId}`,
      status: run.status || '',
      conclusion: run.conclusion || null,
    };
  } catch { return null; }
}

export function getCycleRun(repo, runId) {
  const out = gh(['run', 'view', String(runId), '--repo', repo,
    '--json', 'status,conclusion,url,jobs']);
  if (!out || !out.trim()) return null;
  try { return JSON.parse(out); } catch { return null; }
}

// The failed run's log — the FULL log (every step, succeeded ones included).
// Why not `--log-failed` only: the engine-managed key-echo step is built to
// SUCCEED (if: always()), so its output — the only proof of WHICH keys the run
// saw — never appears in a failed-steps-only view. The field round kept
// dispatching blind exactly because of that: the presence scan saw nothing, the
// diagnosis said "never echoed", and the five stale names in the failing step's
// own group were all the evidence there was. The full log carries the echo.
export function cycleFailedLog(repo, runId) {
  let out = gh(['run', 'view', String(runId), '--repo', repo, '--log'], 60_000);
  if (out && out.trim()) {
    return out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  }
  // A startup failure (the workflow itself is broken) has no step logs at all —
  // the failed-steps view is the only witness left.
  out = gh(['run', 'view', String(runId), '--repo', repo, '--log-failed'], 45_000);
  if (!out) return [];
  return out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
}

// The display tail: the failing step's own last lines (what the report quotes).
export function failedLogTail(repo, runId, maxLines = 12) {
  return cycleFailedLog(repo, runId).slice(-maxLines);
}

// REAL progress, read from GitHub's own view of the run: how many of the run's
// workflow steps are completed, and which one is running right now. Why this
// exists: the old status line advanced a time-based estimate (+3%/min) that had
// nothing to do with the actual run — the field question was exactly that:
// "why 10% and time stops". The percentage is now the run's own steps; the
// active step's name is shown while it runs. No value ever appears here.
export function cycleJobProgress(run) {
  const jobs = Array.isArray(run && run.jobs) ? run.jobs : [];
  let total = 0;
  let done = 0;
  let active = null;
  let job = null;
  for (const j of jobs) {
    const steps = Array.isArray(j && j.steps) ? j.steps : [];
    for (const s of steps) {
      if (!s || !s.status) continue;
      total += 1;
      if (s.status === 'completed') done += 1;
      else if (!active && s.status === 'in_progress') {
        active = s.name || 'unnamed step';
        job = j.name || null;
      }
    }
    // A job whose steps GitHub has not reported yet still shows its name while
    // it runs (a queued run reports no steps at all).
    if (!active && j && j.status === 'in_progress') {
      active = j.name || 'running';
      job = j.name || null;
    }
  }
  const percent = total ? Math.min(97, Math.round((done / total) * 100)) : null;
  return { percent, active, job, total, done };
}

const WATCH_HEARTBEAT_MS = 120_000;

// Which keys did the run actually SEE? The workflow's own env-echo group prints
// each key name; GitHub masks a present value as ***, and an EMPTY value prints
// nothing after the colon. Names and masked presence only — never a value.
export function runKeyPresence(lines) {
  const found = new Map();
  for (const line of lines) {
    const m = /(?:^|\s)([A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET)):\s?(\S*)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const state = (m[2] || '').includes('*') ? 'set' : 'empty';
    // A masked line outweighs an empty one (masking can differ between groups).
    if (!found.has(name) || found.get(name) === 'empty') found.set(name, state);
  }
  return [...found].map(([name, state]) => ({ name, state }));
}

// One line of "what this actually means" for the most common cycle failures.
// Ordered by specificity; a miss returns null and the report says the log lines
// are the failing step's own words. Never guesses at secret values — the log gh
// returns is already masked by GitHub. `selectedNames` narrows every key
// judgment to the tools the user actually picked: an unselected tool's empty
// key is not this project's problem and must not drive the cause.
// `context` carries what the LOG cannot prove: `missingOnGithub` (the selected
// keys GitHub's own secret list reports as unset) turns "the log mentions an
// API key" into the one truth that matters — the run never had the value.
export function diagnoseCycleLog(lines, keyPresence = null, selectedNames = null, context = {}) {
  const text = lines.join('\n');
  const chosen = (list) => (Array.isArray(selectedNames) ? list.filter((n) => selectedNames.includes(n)) : list);
  const presence = keyPresence || runKeyPresence(lines);
  const missingOnGithub = Array.isArray(context.missingOnGithub) ? context.missingOnGithub : [];
  if (/usage limit|rate limit|HTTP 429/i.test(text)) {
    return 'the agent hit a usage or rate limit — a wait, not a broken project; dispatching again later retries it.';
  }
  // The builder's own auth wall names the credential it wants. Say exactly why
  // the run did not have it: not on GitHub, never echoed (mapping/echo gap),
  // or seen EMPTY.
  const auth = /Authentication required[\s\S]{0,160}?set ([A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET))/.exec(text);
  if (auth) {
    const name = auth[1];
    const isSelected = !Array.isArray(selectedNames) || selectedNames.includes(name);
    if (isSelected) {
      if (missingOnGithub.includes(name)) {
        return `the builder needs ${name}, and ${name} is not on GitHub yet — type its value into the Missing keys card in the browser window (devos continue opens it; the engine uploads the value itself and starts the fresh round). A value never reaches the model.`;
      }
      const seen = presence.find((k) => k.name === name);
      if (!seen) {
        return `the builder needs ${name}, but the run's log never echoed it — the workflow may not map it, or the value on GitHub is stale. devos continue repairs BOTH itself (top-level mapping + the engine-managed key-echo step, verified on GitHub) and the Missing keys card opens right in this flow: re-typing the value there overwrites a stale one (a value never reaches the model), then the fresh round starts.`;
      }
      if (seen.state === 'empty') {
        return `the builder needs ${name}, and the run saw it EMPTY — either the value is not on GitHub (the intake opens with devos continue) or the workflow mapping is broken (devos continue repairs the mapping itself).`;
      }
      return `the builder needs ${name}, and the run had it (masked) — the value itself is being refused by the provider; check the token's validity/expiry on the provider dashboard and paste the fresh value into the intake (devos continue opens it).`;
    }
  }
  if (/exited with code null/.test(text)) {
    const empty = chosen(presence.filter((k) => k.state === 'empty').map((k) => k.name));
    if (empty.length) {
      return `the agent CLI died without an exit code, and the run saw these selected keys as EMPTY: ${empty.join(', ')} — the run started before the keys were uploaded (a fresh run picks them up), a value is still missing on GitHub, or the workflow never mapped them ("gh secret list -R <repo>" proves what is there; devos continue checks and repairs the workflow mapping itself).`;
    }
    return 'an agent CLI died without an exit code — the usual cause is an empty API key in the run environment; "gh secret list -R <repo>" proves exactly which names the run can see.';
  }
  if (/Invalid workflow file|startup_failure|is not well-formed|unrecognized key/i.test(text)) {
    return 'the workflow file itself is broken or outdated — "devos upgrade <folder>" refreshes the engine files, then "devos continue" dispatches a fresh cycle.';
  }
  if (/npm ERR!/i.test(text)) {
    return 'a dependency install failed on the runner — a bad lockfile is the usual cause; the next cycle round re-runs the install.';
  }
  if (/error TS\d+|Type error/i.test(text)) {
    return 'TypeScript errors — the builder receives them as its task input and fixes them in the following round.';
  }
  if (/\d+ (tests?|specs?) fail|FAIL\s+\S+/i.test(text)) {
    return 'failing tests — the reviewer/builder round receives the failure and repairs it in its next attempt.';
  }
  if (/secret|api[ _-]?key|token/i.test(text)) {
    if (missingOnGithub.length) {
      return `the run did not have the selected key(s) ${missingOnGithub.join(', ')} — they are not on GitHub yet. The intake opens with the next devos continue: type the values into the Missing keys card in the browser window (or devos/secrets.local.json) and the engine uploads them, then starts the fresh round.`;
    }
    const empty = chosen(presence.filter((k) => k.state === 'empty').map((k) => k.name));
    if (empty.length) {
      return `the selected key(s) ${empty.join(', ')} were EMPTY in the run — put the real values in (devos continue offers the intake and uploads them; a value never reaches the model), or let the model walk you through gh's hidden prompt. If GitHub already holds them, the workflow may not map them — devos continue checks and repairs the mapping itself.`;
    }
    // Only claim "present (masked)" when the log actually PROVES it for every
    // selected key. A log that never echoes a selected key proves nothing —
    // claiming presence there was the report lying to itself (the field bug:
    // "none appeared" and "every key present" printed in the same report).
    if (Array.isArray(selectedNames) && selectedNames.length) {
      const seen = presence.filter((k) => selectedNames.includes(k.name));
      if (!seen.length) {
        return `the run's log never echoed any key this project selected (${selectedNames.join(', ')}) — the workflow may not map or echo them. devos continue repairs the mapping AND adds the key-echo step itself; if the next run still fails this way, the key is likely not on GitHub — "devos keys --check" proves it.`;
      }
    }
    return 'the log mentions an API key, and every key this project selected was present in the run (masked) — the agent\'s own words above name the real problem.';
  }
  return null;
}

function failingJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((j) => j && j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped')
    .map((j) => j.name || 'unnamed job');
}

// The plain-English report. Every line is something the developer can act on or
// quote back to the engine — no links-only hand-waving. `selectedNames` (the
// keys of the tools the user picked) keeps the key verdict honest: only the
// selected keys are judged; the rest are named once as irrelevant.
// `missingOnGithub` is what the log cannot prove — the selected keys GitHub's
// own secret list reports as unset — and turns the "Next" line into the intake.
export function buildCycleReport({ repo, runId, url, conclusion, jobs = [], logLines = [], projectDir = null, keyPresence = null, selectedNames = null, missingOnGithub = null }) {
  const link = url || `https://github.com/${repo}/actions/runs/${runId}`;
  const out = [];
  if (conclusion === 'success') {
    out.push(`The cycle run finished GREEN — the keys in place did their job: ${link}`);
    out.push('Next: the cycle works the tasks on its own. Merge pull requests labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green.');
    return out;
  }
  out.push(`The cycle run FAILED (${conclusion || 'unknown outcome'}): ${link}`);
  const bad = failingJobs(jobs);
  if (bad.length) out.push(`Failing step: ${bad.join(', ')}.`);
  if (logLines.length) {
    out.push('What the failing step printed (its own last lines):');
    for (const l of logLines) out.push(`  | ${l}`);
  }
  const presence = keyPresence || runKeyPresence(logLines);
  const filtered = Array.isArray(selectedNames);
  const selected = filtered ? presence.filter((k) => selectedNames.includes(k.name)) : presence;
  const others = filtered ? presence.filter((k) => !selectedNames.includes(k.name)) : [];
  if (presence.length && logLines.length) {
    if (!filtered) {
      out.push(`Keys the run actually saw: ${presence.map((k) => `${k.name} — ${k.state === 'set' ? 'present (masked by GitHub)' : 'EMPTY'}`).join('; ')}.`);
    } else if (selected.length) {
      out.push(`Keys the run actually saw — the ones this project selected: ${selected.map((k) => `${k.name} — ${k.state === 'set' ? 'present (masked by GitHub)' : 'EMPTY'}`).join('; ')}.`);
    } else {
      out.push(`None of the keys this project selected (${selectedNames.join(', ')}) appeared in the run log — the workflow may not map or echo them (devos continue repairs both, and the next run's log proves it).`);
    }
  }
  if (others.length && logLines.length) {
    out.push(`Not selected for this project (keys of tools you did not pick): ${others.map((k) => k.name).join(', ')} — they do not matter here.`);
  }
  const missingNow = Array.isArray(missingOnGithub) ? missingOnGithub : [];
  const cause = diagnoseCycleLog(logLines, presence, filtered ? selectedNames : null, { missingOnGithub: missingNow });
  out.push(cause ? `Likely cause: ${cause}` : 'The lines above are the failing step\'s own words — they name the real problem.');
  const emptySelected = selected.filter((k) => k.state === 'empty').map((k) => k.name);
  out.push(filtered && (emptySelected.length || missingNow.length)
    ? `Next: put the real value(s) in — run devos continue${projectDir ? ` ${projectDir}` : ''}: the Missing keys card opens in the browser window, the engine uploads the values itself (a value never reaches the model), re-checks GitHub, and starts the next fresh round. The engine keeps going until the FIRST cycle run is green.`
    : `Next: fix what this report names (a missing key: devos keys; an outdated engine: devos upgrade), then run devos continue${projectDir ? ` ${projectDir}` : ''} — the engine starts another fresh round and keeps going until the FIRST cycle run is green.`);
  return out;
}

// Watch one run until it completes (or the cap passes). Emits:
//   - a log line on every run STATUS change (queued -> in_progress -> completed);
//   - a `cycle-progress` event whenever the step-level percent or the active
//     step changes (the UI + terminal status line show the REAL percentage);
//   - a heartbeat log line every 2 minutes of quiet, so "last output 8s ago"
//     stays truthful during a long builder step instead of freezing.
// The cap is 150 minutes — a cycle builds, checks, reviews and merges; the old
// 20-minute cap gave up while the run was still working (the field complaint:
// the watcher declared "still going after 20 minutes" and stopped).
export async function watchCycleRun({ repo, runId, url, pollMs = 15_000, maxMs = 150 * 60_000, emit = () => {}, shouldStop = null, selectedNames = null }) {
  const started = Date.now();
  let lastStatus = '';
  let lastProgressKey = '';
  let lastEmitAt = started;
  while (Date.now() - started < maxMs) {
    if (shouldStop && shouldStop()) return { watched: false, status: 'stopped', url, report: null };
    const run = getCycleRun(repo, runId);
    if (run) {
      if (run.status && run.status !== lastStatus) {
        lastStatus = run.status;
        lastEmitAt = Date.now();
        emit({ type: 'log', line: `Cycle run ${runId}: ${run.status}…`, stream: 'engine' });
      }
      const prog = cycleJobProgress(run);
      if (prog.percent != null) {
        const key = `${prog.percent}|${prog.active || ''}`;
        if (key !== lastProgressKey) {
          lastProgressKey = key;
          lastEmitAt = Date.now();
          emit({ type: 'cycle-progress', percent: prog.percent, step: prog.active, job: prog.job });
          emit({ type: 'log', line: `Cycle run ${runId}: ${prog.percent}% · step: ${prog.active || 'waiting'}${prog.total ? ` (${prog.done}/${prog.total} steps done)` : ''}`, stream: 'engine' });
        } else if (Date.now() - lastEmitAt >= WATCH_HEARTBEAT_MS) {
          lastEmitAt = Date.now();
          emit({ type: 'cycle-progress', percent: prog.percent, step: prog.active, job: prog.job });
          emit({ type: 'log', line: `Cycle run ${runId}: still running · step: ${prog.active || 'waiting'} · ${prog.percent}% · ${Math.round((Date.now() - started) / 60_000)} min elapsed`, stream: 'engine' });
        }
      }
      if (run.status === 'completed') {
        const allLines = run.conclusion === 'success' ? [] : cycleFailedLog(repo, runId);
        const logLines = allLines.slice(-12);
        const report = buildCycleReport({
          repo, runId, url: run.url || url, conclusion: run.conclusion, jobs: run.jobs, logLines,
          keyPresence: allLines.length ? runKeyPresence(allLines) : null,
          selectedNames,
        });
        return { watched: true, status: 'completed', conclusion: run.conclusion || '', url: run.url || url, report, logLines: allLines };
      }
    }
    await sleep(pollMs);
  }
  const link = url || `https://github.com/${repo}/actions/runs/${runId}`;
  const lastProg = lastProgressKey ? lastProgressKey.split('|') : [];
  const stepBit = lastProg[1] ? ` · step: ${lastProg[1]}` : '';
  const pctBit = lastProg[0] ? ` · ${lastProg[0]}% by GitHub's own step count` : '';
  return {
    watched: false, status: 'timeout', url: link,
    report: [
      `The cycle run is still going after ${Math.round((Date.now() - started) / 60_000)} minutes${stepBit}${pctBit}: ${link}`,
      'The engine stays with the project — the run keeps going on GitHub; devos report picks the outcome up the moment it lands (it watches the same run, nothing is restarted).',
    ],
  };
}

// For `devos report`: read the latest cycle run and report it WITHOUT
// restarting anything (continue owns the restart decisions).
export async function reportLatestCycleRun({ repo, projectDir = null, emit = () => {}, pollMs = 15_000, maxMs = 150 * 60_000, shouldStop = null, selectedNames = null }) {
  const latest = latestCycleRun(repo);
  if (!latest) {
    return { status: 'none', url: null, report: [`No devos-cycle run exists for ${repo} yet — dispatch one with: devos continue${projectDir ? ` ${projectDir}` : ''}`] };
  }
  if (latest.status && latest.status !== 'completed') {
    return watchCycleRun({ repo, runId: latest.id, url: latest.url, pollMs, maxMs, emit, shouldStop, selectedNames });
  }
  const view = getCycleRun(repo, latest.id) || {};
  const allLines = latest.conclusion === 'success' ? [] : cycleFailedLog(repo, latest.id);
  const report = buildCycleReport({
    repo, runId: latest.id, url: latest.url, conclusion: latest.conclusion || view.conclusion,
    jobs: view.jobs || [], logLines: allLines.slice(-12), projectDir, selectedNames,
    keyPresence: allLines.length ? runKeyPresence(allLines) : null,
  });
  return { watched: true, status: 'completed', conclusion: latest.conclusion || '', url: latest.url, report };
}
