import { execFileSync, spawnSync } from 'node:child_process';
import { detectAgents } from './probes.mjs';
import { ghPreflight } from './accounts.mjs';

function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

function ghSignedIn() {
  // Kept for backward compatibility; machineCheck uses the full ghPreflight.
  try {
    const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 15000 });
    if (r.status === 0) return true;
    return /logged in to/i.test(String(r.stdout || '') + String(r.stderr || ''));
  } catch {
    return false;
  }
}

function accountDetail(a) {
  const acc = a.account;
  if (a.status === 'missing') return a.notInstalledMessage || 'not installed';
  if (!acc || acc.signedIn !== true) return `installed${a.signedIn ? ', signed in' : ', signed out'}`;
  const who = [acc.email, acc.plan ? `${acc.plan} plan` : null].filter(Boolean).join(' · ');
  return `installed, signed in${who ? ` as ${who}` : ''}`;
}

function commandExists(cmd) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'sh';
    const args = process.platform === 'win32' ? [cmd] : ['-c', `command -v '${String(cmd).replace(/'/g, '')}'`];
    const r = spawnSync(probe, args, { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function machineCheck(env = process.env) {
  const nodeOk = nodeMajor() >= 22;
  const gitOk = commandExists('git');
  const ghInstalled = commandExists('gh');
  const pf = ghInstalled ? ghPreflight(env) : null;
  const ghOk = ghInstalled && pf.signedIn && pf.ok;
  const agents = detectAgents(env);
  const blocks = [];
  if (!nodeOk) blocks.push(`Node is ${process.versions.node}; DEV_OS needs Node 22 or newer.`);
  if (!gitOk) blocks.push('git is missing. Install git, then run devos init again.');
  if (!ghInstalled) blocks.push('gh is missing. Install the GitHub CLI, then run gh auth login.');
  if (ghInstalled && pf && !pf.signedIn) blocks.push('gh is not logged in. Run gh auth login, then continue.');
  if (pf && pf.signedIn) {
    for (let i = 0; i < pf.problems.length; i++) {
      blocks.push(`${pf.problems[i]} ${pf.fixes[i] || ''}`.trim());
    }
  }
  const ghDetail = !ghInstalled
    ? 'missing'
    : !pf.signedIn
      ? 'installed, not signed in'
      : `signed in as ${pf.login || 'unknown account'}${pf.scopes.length ? ` · scopes: ${pf.scopes.join(', ')}` : ''}${pf.tokenWorks ? '' : ' · TOKEN REJECTED BY THE API'}`;
  const rows = [
    { label: 'Node', detail: process.versions.node, state: nodeOk ? 'ready' : 'blocked' },
    { label: 'git', detail: gitOk ? 'installed' : 'missing', state: gitOk ? 'ready' : 'blocked' },
    { label: 'gh', detail: ghDetail, state: ghOk ? 'ready' : 'blocked' },
  ];
  for (const a of agents) {
    rows.push({
      label: a.label,
      detail: accountDetail(a),
      state: a.status === 'missing' ? 'missing' : (a.signedIn ? 'ready' : 'signed-out'),
    });
  }
  return { ready: blocks.length === 0, blocks, rows, agents };
}

export function printDoctor() {
  const c = machineCheck();
  const lines = [];
  for (const r of c.rows) lines.push(`${r.state === 'ready' ? 'ready' : r.state.padEnd(10)}  ${r.label}: ${r.detail}`);
  if (c.ready) {
    lines.push('');
    lines.push('This machine can run devos init. The reviewer and builder run on GitHub after the repository exists.');
  } else {
    lines.push('');
    for (const b of c.blocks) lines.push(`Blocker: ${b}`);
  }
  return lines.join('\n');
}
