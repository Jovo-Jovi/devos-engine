#!/usr/bin/env node
// fake gh — records every invocation to $DEVOS_FAKE_LOG (JSONL) and implements the
// subset of gh that the engine and the runner scripts use. Never touches a network.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const logFile = process.env.DEVOS_FAKE_LOG || '/tmp/devos-fake-gh.log';
try { appendFileSync(logFile, JSON.stringify({ cmd: 'gh', argv, cwd: process.cwd(), at: Date.now() }) + '\n'); } catch {}

const out = (s) => process.stdout.write(`${s}\n`);
const die = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };

// Per-repo miss/failure counters (DEVOS_GH_STATE file) let a test flip behavior
// between attempts — e.g. the first `repo view` misses with the GraphQL
// "Could not resolve" reply and the retry after an approved fix finds it.
const stateFile = process.env.DEVOS_GH_STATE || '';
function bumpCount(key) {
  if (!stateFile) return 0;
  let st = {};
  try { st = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { }
  const n = (st[key] || 0) + 1;
  st[key] = n;
  try { writeFileSync(stateFile, JSON.stringify(st)); } catch { }
  return n;
}
function peekCount(key) {
  if (!stateFile) return 0;
  try { return JSON.parse(readFileSync(stateFile, 'utf8'))[key] || 0; } catch { return 0; }
}
const NOT_FOUND = (t) => `GraphQL: Could not resolve to a Repository with the name '${t}'. (repository)`;

if (argv[0] === 'auth' && argv[1] === 'status') {
  if (process.env.DEVOS_GH_SIGNED_OUT === '1') die('gh: not logged in', 1);
  const scopes = process.env.DEVOS_GH_MISSING_SCOPES === '1'
    ? "'gist', 'read:org', 'repo'"
    : "'gist', 'repo', 'workflow'";
  out('github.com');
  out('  ✓ Logged in to github.com account octodev (keyring)');
  out('  - Active account: true');
  out('  - Token: gho_****');
  out(`  - Token scopes: ${scopes}`);
  process.exit(0);
}
if (argv[0] === 'repo' && argv[1] === 'create') {
  // DEVOS_GH_REPO_EXISTS=1: the repository already exists on GitHub (created by
  // hand or by a half-finished attempt) — gh repo create fails exactly like the
  // real one, so the engine's adoption fallback (view + remote + push) is tested.
  if (process.env.DEVOS_GH_REPO_EXISTS === '1') {
    die(`gh: Could not create repository: ${argv[2]} already exists on github.com`, 1);
  }
  // DEVOS_GH_CREATE_FAIL_FIRST=1: the first create fails (any cause), the retry
  // succeeds — proves the engine's second-chance create after "Could not resolve".
  if (process.env.DEVOS_GH_CREATE_FAIL_FIRST === '1' && peekCount('create') === 0) {
    bumpCount('create');
    die(`gh: Could not create repository: ${argv[2]} failed this time`, 1);
  }
  const slug = argv[2];
  out(`https://github.com/${slug}`);
  process.exit(0);
}
if (argv[0] === 'repo' && argv[1] === 'view') {
  const target = argv[2] || '';
  // DEVOS_GH_REPO_MISSING=1 (older flag): every view misses.
  if (process.env.DEVOS_GH_REPO_MISSING === '1') die(NOT_FOUND(target), 1);
  // DEVOS_GH_VIEW_MISS=<name>,<name>: those exact repositories are NOT visible
  // to gh — the exact real-world reply that dead-ended the user's continue run.
  const missList = String(process.env.DEVOS_GH_VIEW_MISS || '').split(',').map((s) => s.trim()).filter(Boolean);
  // DEVOS_GH_VIEW_MISS_FIRST=1: only the FIRST view misses; later views resolve.
  if (process.env.DEVOS_GH_VIEW_MISS_FIRST === '1' && peekCount('view') === 0) {
    bumpCount('view');
    die(NOT_FOUND(target), 1);
  }
  if (missList.includes(target)) die(NOT_FOUND(target), 1);
  // the engine asks for nameWithOwner, so the fake answers with the full name
  out(target); process.exit(0);
}
if (argv[0] === 'repo' && argv[1] === 'list') {
  // DEVOS_GH_REPO_LIST: JSON array of {nameWithOwner} the engine fuzzy-matches.
  out(process.env.DEVOS_GH_REPO_LIST || '[]'); process.exit(0);
}
if (argv[0] === 'variable' && argv[1] === 'set') { process.exit(0); }
if (argv[0] === 'secret' && argv[1] === 'set') {
  if (argv.includes('--body')) die('fake gh: --body is not allowed in the DEV_OS secret handoff', 1);
  // The engine pipes the value on stdin; the fake records the NAME only, so a
  // later `secret list` reflects the upload (never the value — it is not read).
  const name = argv[2];
  if (stateFile && name) {
    let st = {};
    try { st = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { }
    st.secrets = Array.isArray(st.secrets) ? st.secrets : [];
    if (!st.secrets.includes(name)) st.secrets.push(name);
    try { writeFileSync(stateFile, JSON.stringify(st)); } catch { }
  }
  process.exit(0);
}
if (argv[0] === 'secret' && argv[1] === 'list') {
  // Every list call is counted (stateFile), so a test can stage flakiness or
  // drift: DEVOS_GH_SECRET_LIST_FAIL_FIRST=<n> makes exactly the n-th call fail
  // (gh was flaky for a moment); DEVOS_GH_SECRETS_HIDDEN="NAME ..." removes
  // those names from every list AFTER the first (the value was never really
  // there / vanished mid-run — the drift the failure-path intake catches).
  const nth = stateFile ? bumpCount('secret-list') : 0;
  const failFirst = String(process.env.DEVOS_GH_SECRET_LIST_FAIL_FIRST || '');
  if (failFirst && failFirst === String(nth)) {
    die('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable', 1);
  }
  if (process.env.DEVOS_GH_SECRET_LIST_FAIL_ALL === '1') {
    die('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable', 1);
  }
  const names = new Set((process.env.DEVOS_FAKE_GH_SECRETS || '').split(' ').filter(Boolean));
  // Mid-run drift: after the engine read a failed run's log, these names are
  // gone from GitHub's list (deleted, or never really there).
  const hideAfterLog = String(process.env.DEVOS_GH_SECRETS_HIDE_AFTER_LOGFAILED || '').split(' ').filter(Boolean);
  if (hideAfterLog.length && stateFile) {
    try { if (JSON.parse(readFileSync(stateFile, 'utf8')).logfailedSeen === '1') for (const h of hideAfterLog) names.delete(h); } catch { }
  }
  if (stateFile) {
    try { for (const n of JSON.parse(readFileSync(stateFile, 'utf8')).secrets || []) names.add(n); } catch { }
  }
  out(JSON.stringify([...names].map((n) => ({ name: n }))));
  process.exit(0);
}
if (argv[0] === 'workflow' && argv[1] === 'run') {
  // A dispatch is stateful: once one happens, `run list` can show the world
  // AFTER the dispatch (DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH) — the engine's
  // find-the-new-run step needs a fresh run to discover.
  if (stateFile) bumpCount('dispatch');
  process.exit(0);
}
if (argv[0] === 'run' && argv[1] === 'rerun') { process.exit(0); }
if (argv[0] === 'run' && argv[1] === 'list') {
  // DEVOS_FAKE_GH_RUNS: a JSON array of cycle runs (databaseId/conclusion/status/url),
  // so tests can stage "the last cycle failed while the keys were missing".
  const afterDispatch = process.env.DEVOS_FAKE_GH_RUNS_AFTER_DISPATCH;
  if (afterDispatch && peekCount('dispatch') > 0) {
    try {
      const runs = JSON.parse(afterDispatch).map((x) => ({ createdAt: new Date().toISOString(), ...x }));
      out(JSON.stringify(runs));
      process.exit(0);
    } catch { /* fall through to the static staging below */ }
  }
  if (process.env.DEVOS_FAKE_GH_RUNS) { out(process.env.DEVOS_FAKE_GH_RUNS); process.exit(0); }
  out('[{"databaseId":1,"url":"https://github.com/octodev/app/actions/runs/1","displayTitle":"devos-cycle","status":"queued"}]'); process.exit(0);
}
if (argv[0] === 'run' && argv[1] === 'view') {
  // Every run view is counted (separate key — the repo-view counter stays
  // independent), so the by-poll progress staging can move a run forward.
  if (stateFile) bumpCount('runview');
  // --log: the FULL run log (succeeded steps included). The engine's diagnosis
  // reads it because the key-echo step is built to SUCCEED — its output (the
  // only proof of which keys the run saw) never appears in --log-failed.
  if (argv.includes('--log')) {
    out(process.env.DEVOS_FAKE_GH_LOG || process.env.DEVOS_FAKE_GH_LOG_FAILED || ''); process.exit(0);
  }
  // --log-failed: the failing step's own last lines (DEVOS_FAKE_GH_LOG_FAILED).
  // Reading it is also a timeline marker: DEVOS_GH_SECRETS_HIDE_AFTER_LOGFAILED
  // names secrets that vanish from `secret list` from this moment on — the
  // deterministic way to stage "the value disappeared mid-run" for the
  // failure-path intake test (the diagnosis reads the log, THEN re-checks keys).
  if (argv.includes('--log-failed')) {
    if (process.env.DEVOS_GH_SECRETS_HIDE_AFTER_LOGFAILED && stateFile) {
      let st = {};
      try { st = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { }
      st.logfailedSeen = '1';
      try { writeFileSync(stateFile, JSON.stringify(st)); } catch { }
    }
    out(process.env.DEVOS_FAKE_GH_LOG_FAILED || ''); process.exit(0);
  }
  // Status/conclusion/jobs (DEVOS_FAKE_GH_VIEW); a completed success by default,
  // so a watcher without staging sees the run finish on its first poll.
  // DEVOS_FAKE_GH_VIEW_BY_DISPATCH: one view JSON PER dispatch (fail, then
  // green, ...) — the hold-open loop watches a fresh run after every fix round.
  const byDispatch = process.env.DEVOS_FAKE_GH_VIEW_BY_DISPATCH;
  if (byDispatch) {
    try {
      const seq = JSON.parse(byDispatch);
      const n = peekCount('dispatch');
      const idx = Math.max(0, Math.min((n || 1) - 1, seq.length - 1));
      out(JSON.stringify({ url: `https://github.com/octodev/app/actions/runs/${1000 + n}`, ...seq[idx] }));
      process.exit(0);
    } catch { /* fall through to the static staging */ }
  }
  // DEVOS_FAKE_GH_VIEW_BY_POLL: one view JSON PER `run view` call — the
  // step-level progress test stages a run that moves (steps completing) before
  // it lands green, without needing a dispatch between polls.
  const byPoll = process.env.DEVOS_FAKE_GH_VIEW_BY_POLL;
  if (byPoll) {
    try {
      const seq = JSON.parse(byPoll);
      const n = peekCount('runview');
      const idx = Math.max(0, Math.min((n || 1) - 1, seq.length - 1));
      out(JSON.stringify({ url: `https://github.com/octodev/app/actions/runs/3000`, ...seq[idx] }));
      process.exit(0);
    } catch { /* fall through to the static staging */ }
  }
  out(process.env.DEVOS_FAKE_GH_VIEW || JSON.stringify({
    status: 'completed', conclusion: 'success',
    url: 'https://github.com/octodev/app/actions/runs/2',
    jobs: [{ name: 'build', conclusion: 'success' }],
  }));
  process.exit(0);
}
if (argv[0] === 'issue' && argv[1] === 'create') { out(`https://github.com/octodev/app/issues/${1 + Math.floor(Math.random() * 90)}`); process.exit(0); }
if (argv[0] === 'issue' && argv[1] === 'list') {
  // emit the known setup issue only when the query actually looks for it
  if (JSON.stringify(argv).includes('Dev OS: setup needed')) { out('7'); process.exit(0); }
  process.exit(0);
}
if (argv[0] === 'issue' && (argv[1] === 'comment' || argv[1] === 'close' || argv[1] === 'view')) { if (argv[1] === 'view') out('{"title":"t","body":"b","labels":["devos:change-request"]}'); process.exit(0); }
if (argv[0] === 'pr' && argv[1] === 'create') { out('https://github.com/octodev/app/pull/12'); process.exit(0); }
if (argv[0] === 'pr' && (argv[1] === 'edit' || argv[1] === 'list')) { if (argv[1] === 'list') out('12'); process.exit(0); }
if (argv[0] === 'label' && argv[1] === 'create') { process.exit(0); }
if (argv[0] === 'api') {
  if (process.env.DEVOS_GH_BAD_TOKEN === '1') die('gh: REST API 401 (Bad credentials)', 1);
  // repos/<owner>/<repo>/contents/<path>?ref=<ref> — the engine's push
  // verification: it reads the workflow BACK from GitHub and checks the repair
  // actually landed on main. The fake serves the LOCAL file at that relative
  // path (tests push = the file on disk), or a staged stale text so the
  // not-verified path is testable.
  if (/^repos\/[^/]+\/[^/]+\/contents\//.test(argv[1] || '')) {
    const relPath = String(argv[1]).split('/contents/')[1].split('?')[0];
    const staleUntil = process.env.DEVOS_GH_API_STALE_UNTIL_DISPATCH === '1' && peekCount('dispatch') === 0;
    const stale = process.env.DEVOS_GH_API_STALE_TEXT != null && (staleUntil || process.env.DEVOS_GH_API_STALE_ALWAYS === '1');
    if (stale) {
      out(Buffer.from(String(process.env.DEVOS_GH_API_STALE_TEXT)).toString('base64'));
      process.exit(0);
    }
    const f = join(process.cwd(), relPath);
    if (!existsSync(f)) die(`gh: Not Found (fake api contents) ${relPath}`, 1);
    out(Buffer.from(readFileSync(f, 'utf8')).toString('base64'));
    process.exit(0);
  }
  // DEVOS_GH_LOGIN: the account gh is actually signed in with (the wizard's slug
  // owner can differ — the owner-mismatch adoption path). `user` is the login probe.
  if (argv[1] === 'user') { out(JSON.stringify({ login: process.env.DEVOS_GH_LOGIN || 'octodev' })); process.exit(0); }
  out('{"login":"octodev"}');
  process.exit(0);
}
die(`fake gh: unhandled command ${argv.join(' ')}`, 1);
