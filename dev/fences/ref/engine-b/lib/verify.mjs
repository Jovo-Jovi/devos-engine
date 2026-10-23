// The verify -> fix loop. `devos verify` audits everything that stands between the
// developer and a fully configured stack on GitHub: machine prereqs, gh credentials,
// per-CLI accounts and the models each account can actually run, the project tree
// against the bootstrap guards, the repository, the workflows, and the secrets.
// Every problem row carries its exact fix and WHO applies it:
//   you   — logins, plan switches, secret values: never sent to any model
//   model — problems inside the project folder: `devos fix` hands them back to the
//           configuration model in the same restricted environment as init
//   devos — the engine resolves it automatically on the next run
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ghPreflight } from './accounts.mjs';
import { detectAgents } from './probes.mjs';
import { validateBootstrap } from './guards.mjs';
import { readInitState, readModelRun } from './secret.mjs';
import { checkKeys } from './keys.mjs';
import { engineRoot, lastProjectFile } from './paths.mjs';

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

const row = (section, label, state, detail, fix = null, who = null) => ({ section, label, state, detail, fix, who });

function machineRows() {
  const rows = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  rows.push(nodeMajor >= 22
    ? row('machine', 'Node.js', 'ok', `v${process.versions.node}`)
    : row('machine', 'Node.js', 'block', `v${process.versions.node} — DEV_OS needs Node 22+`, 'Install Node 22 or newer from nodejs.org, then re-run this check.', 'you'));
  rows.push(commandExists('git')
    ? row('machine', 'git', 'ok', 'installed')
    : row('machine', 'git', 'block', 'missing', 'Install git (git-scm.com), then re-run this check.', 'you'));
  return rows;
}

function githubRows() {
  const rows = [];
  if (!commandExists('gh')) {
    return [row('github', 'gh (GitHub CLI)', 'block', 'not installed', 'Install the GitHub CLI (cli.github.com), then run gh auth login.', 'you')];
  }
  const pf = ghPreflight();
  if (!pf.signedIn) {
    return [row('github', 'gh (GitHub CLI)', 'block', 'not signed in', 'Run: gh auth login', 'you')];
  }
  rows.push(row('github', 'gh login', pf.tokenWorks ? 'ok' : 'block',
    `signed in as ${pf.login || 'unknown account'}${pf.tokenWorks ? '' : ' — the token was rejected by the GitHub API'}`,
    pf.tokenWorks ? null : 'Run: gh auth login (sign in to the same account), then re-run this check.', 'you'));
  const missing = ['repo', 'workflow'].filter((s) => !pf.scopes.includes(s));
  rows.push(missing.length
    ? row('github', 'gh token scopes', 'block', `missing: ${missing.join(', ')}`,
      `Run: gh auth refresh -h github.com -s ${missing.join(',')}`, 'you')
    : row('github', 'gh token scopes', 'ok', pf.scopes.join(', ')));
  return rows;
}

// The chosen configuration model must be one the SIGNED-IN account can actually run.
// Cursor's account answers `agent models`; a model outside that list is refused with
// "Named models unavailable" — the exact wall this row predicts.
function availabilityRow(agent, model, projectDir) {
  if (!agent || agent.status !== 'installed') return null;
  const reported = (agent.reportedIds || []).map((s) => String(s).trim()).filter(Boolean);
  if (agent.toolId === 'cursor') {
    if (model === 'auto') {
      return row('agents', 'Cursor model availability', 'ok', 'Auto — Cursor picks; every plan can run it');
    }
    // Proof of run: the CLI exited 0 while driving this exact model on this
    // machine. Several Cursor builds never answer `agent models`, which used to
    // park a demonstrably working model at "unverified — you fix" forever. A
    // real completed run outranks the missing list.
    const proof = projectDir ? readModelRun(projectDir) : null;
    if (proof && proof.model === model && (!proof.cli || proof.cli === agent.command)) {
      return row('agents', `Cursor model "${model}"`, 'ok',
        `ran successfully on this machine — verified in practice${proof.at ? ` (last run ${String(proof.at).slice(0, 10)})` : ''}`);
    }
    if (reported.length && !reported.includes(model)) {
      const resume = projectDir ? `devos continue ${projectDir} --model auto` : 'resume with --model auto';
      return row('agents', `Cursor model "${model}"`, 'warn',
        `the signed-in account (${agent.account?.email || 'account unknown'}${agent.account?.plan ? `, ${agent.account?.plan} plan` : ''}) does not list it in \`agent models\` — the run would be refused ("Named models unavailable")`,
        `Two Cursor accounts on this machine? Switch the CLI to the right one: "${agent.command}" logout, then "${agent.command}" login (sign in as the Pro user in the browser). Or resume with Auto: ${resume}. Or pick a model the list does contain (${reported.slice(0, 4).join(', ')}…).`,
        'you');
    }
    return reported.length
      ? row('agents', `Cursor model "${model}"`, 'ok', `in the account's model list (${reported.length} models available)`)
      : row('agents', `Cursor model "${model}"`, 'warn',
        'the CLI did not answer `agent models`, so availability is unverified — a Free-plan account refuses every named model (once one run completes, devos records the proof and this row clears itself)',
        projectDir ? `If the run is refused, resume with: devos continue ${projectDir} --model auto` : 'If the run is refused, resume with --model auto', 'you');
  }
  if (agent.toolId === 'claude' && agent.account?.signedIn === true) {
    return row('agents', 'Claude Code account', 'ok',
      `${agent.account?.email || 'signed in'}${agent.account?.plan ? ` · ${agent.account.plan} plan` : ''} — weekly limits reset automatically; a stopped run resumes with devos continue`);
  }
  return null;
}

function agentRows(answers, projectDir) {
  const rows = [];
  const agents = detectAgents();
  const cm = answers?.models?.configurationModel || null;
  const chosen = cm && cm.cli
    ? agents.find((a) => a.toolId === cm.cli || cm.cli === `custom:${a.toolId}`)
    : null;
  // Only the CHOSEN configuration model is an action item. CLIs the developer
  // never selected are not steps on the way to a finished setup — listing them
  // as "you fix" made a clean machine look blocked with installs nobody asked
  // for. With a choice made, unselected CLIs get no rows at all; without one,
  // they appear as quiet info rows that never carry a fix or an owner.
  if (cm && cm.cli) {
    if (!chosen) return rows; // custom tool: nothing to probe locally, run-time checks cover it
    if (chosen.status === 'missing') {
      rows.push(row('agents', chosen.label, 'block', 'not installed',
        `Install ${chosen.label}, or switch the configuration model: devos continue ${projectDir || '<folder>'} --cli <installed-tool>`, 'you'));
      return rows;
    }
    const acc = chosen.account || {};
    if (acc.signedIn === false) {
      rows.push(row('agents', chosen.label, 'block', 'installed but signed out',
        `Open ${chosen.label} once interactively and sign in${chosen.toolId === 'cursor' ? ` (or: "${chosen.command}" login)` : ''}.`, 'you'));
    } else {
      const who = acc.signedIn === true
        ? [acc.email, acc.plan ? `${acc.plan} plan` : null].filter(Boolean).join(' · ')
        : null;
      rows.push(row('agents', chosen.label, 'ok', who ? `signed in as ${who}` : 'installed (account details unavailable)'));
    }
    const av = availabilityRow(chosen, cm.model, projectDir);
    if (av) rows.push(av);
    return rows;
  }
  for (const a of agents) {
    if (a.status === 'missing') {
      rows.push(row('agents', a.label, 'ok', 'not installed — only matters if you pick it as the configuration model'));
      continue;
    }
    const acc = a.account || {};
    const who = acc.signedIn === true
      ? [acc.email, acc.plan ? `${acc.plan} plan` : null].filter(Boolean).join(' · ')
      : null;
    const note = acc.signedIn === false ? ' (installed, signed out)' : '';
    rows.push(row('agents', a.label, 'ok', `${who ? `signed in as ${who}` : 'installed'}${note} — becomes an action item only when you pick it`));
  }
  return rows;
}

const REQUIRED_WORKFLOWS = ['.github/workflows/devos-cycle.yml'];

function projectRows(projectDir, answers) {
  const rows = [];
  if (!projectDir) return rows;
  const answersFile = join(projectDir, 'devos', 'answers.json');
  if (!existsSync(answersFile)) {
    return [row('project', 'DEV_OS project', 'ok', 'no project folder given (machine, GitHub, and CLI checks only)')];
  }
  if (!answers) {
    return [row('project', 'devos/answers.json', 'block', 'exists but is not valid JSON',
      'Restore the file (a broken answer file cannot be resumed); otherwise run devos init for a new project.', 'you')];
  }
  const slug = answers.project?.slug || 'unknown/repo';

  // Bootstrap guards: the same checks the configuration model must pass. A failure
  // here is exactly what a repair round fixes, so these rows belong to the model.
  const guard = validateBootstrap(projectDir, answers, { engineRoot: engineRoot() });
  if (!guard.ok) {
    rows.push(row('project', 'Bootstrap guards', 'block',
      `${guard.report.length} problem${guard.report.length > 1 ? 's' : ''}: ${guard.report.slice(0, 4).join(' | ')}${guard.report.length > 4 ? ' …' : ''}`,
      `devos fix ${projectDir}`, 'model'));
  } else {
    rows.push(row('project', 'Bootstrap guards', 'ok', 'the written tree passes every check'));
  }

  const init = readInitState(projectDir);
  if (!init || init.status !== 'done') {
    rows.push(row('project', 'GitHub repository', 'block',
      'init_github has not completed yet — devos continue finishes it itself (a repository that already exists is adopted, not recreated)',
      `devos continue ${projectDir}`, 'devos'));
    return rows; // repo/workflow/secrets checks need the repository
  }

  rows.push(row('project', 'GitHub repository', 'ok', `created (${init.repo || slug})`));

  // Is the repository actually visible with this gh login?
  const rv = spawnSync('gh', ['repo', 'view', init.repo || slug, '--json', 'name'], { encoding: 'utf8', timeout: 15000 });
  if (rv.status !== 0) {
    rows.push(row('project', 'Repository visibility', 'block',
      `gh cannot see ${init.repo || slug} with the current login (${String(rv.stderr || '').trim().split('\n')[0] || 'not found'})`,
      'Confirm the gh account (gh auth status) owns the repository, or resume: devos continue is safe — an existing repository is adopted, init_github never runs twice.', 'you'));
  }

  for (const wf of REQUIRED_WORKFLOWS) {
    rows.push(existsSync(join(projectDir, wf))
      ? row('project', `Workflow ${wf.replace('.github/workflows/', '')}`, 'ok', 'present')
      : row('project', `Workflow ${wf.replace('.github/workflows/', '')}`, 'block', 'missing from the project tree',
        `devos fix ${projectDir} — the model rewrites the automation files`, 'model'));
  }

  // Secrets: names only. A key value is typed only into gh's own prompt, so these
  // steps are always yours — the model never receives them.
  const repo = init.repo || slug;
  const keys = checkKeys({ repo, answers });
  if (!keys.ok) {
    rows.push(row('project', 'GitHub secrets', 'warn', `could not list secrets: ${keys.error}`,
      'Check gh auth login, then run: devos keys --check', 'you'));
  } else if (keys.missing.length) {
    rows.push(row('project', `GitHub secrets (${keys.missing.length} missing)`, 'block',
      `missing: ${keys.missing.join(', ')}`,
      `For each name: get the key (devos keys / devos/SECRETS_GUIDE.md), paste the value into devos/secrets.local.json, then devos continue or devos keys --push uploads it`, 'you'));
  } else {
    rows.push(row('project', 'GitHub secrets', 'ok', `${keys.setCount} set`));
  }

  // The first cycle run: the last mile of "fully configured".
  const rl = spawnSync('gh', ['run', 'list', '--workflow', 'devos-cycle.yml', '--limit', '1', '--repo', repo, '--json', 'status,conclusion,url'], { encoding: 'utf8', timeout: 15000 });
  if (rl.status === 0 && rl.stdout.trim()) {
    try {
      const run = JSON.parse(rl.stdout)[0];
      if (run) {
        const done = run.status === 'completed';
        const failed = done && run.conclusion && run.conclusion !== 'success';
        rows.push(row('project', 'First cycle run', failed ? 'warn' : 'ok',
          `${run.status}${run.conclusion ? ` (${run.conclusion})` : ''} — ${run.url}`,
          failed ? 'The cycle self-reports its own failures on the run page; a stopped cycle resumes with: gh workflow run devos-cycle.yml --repo ' + repo : null,
          failed ? 'you' : null));
      }
    } catch { /* tolerate unexpected output */ }
  }
  return rows;
}

// The full audit. Synchronous on purpose (spawnSync like every other probe) so CLI
// and server paths can call it without ceremony.
export function auditSetup({ projectDir = null, answers = null } = {}) {
  const rows = [
    ...machineRows(),
    ...githubRows(),
    ...agentRows(answers, projectDir),
    ...projectRows(projectDir, answers),
  ];
  const blockers = rows.filter((r) => r.state === 'block');
  return {
    ready: blockers.length === 0,
    rows,
    youSteps: rows.filter((r) => r.state !== 'ok' && r.who === 'you'),
    modelSteps: rows.filter((r) => r.state !== 'ok' && r.who === 'model'),
  };
}

// Compact shape for the UI final card and the server event.
export function remainingSteps(audit) {
  return audit.rows
    .filter((r) => r.state !== 'ok')
    .slice(0, 10)
    .map((r) => ({ label: r.label, detail: r.detail, fix: r.fix, who: r.who, state: r.state }));
}

const WHO_TAG = { you: 'you fix', model: 'model fixes (devos fix)', devos: 'devos handles it' };

export function printVerify(audit, { title = 'DEV_OS verify' } = {}) {
  const lines = [];
  lines.push(`${title} — everything between here and a fully configured stack on GitHub`);
  let section = null;
  for (const r of audit.rows) {
    if (r.section !== section) {
      section = r.section;
      lines.push('');
      lines.push(`${section.toUpperCase()}`);
    }
    const mark = r.state === 'ok' ? 'ok  ' : r.state === 'warn' ? 'warn' : 'STOP';
    lines.push(`  [${mark}] ${r.label}: ${r.detail}`);
    if (r.state !== 'ok') {
      if (r.fix) lines.push(`          fix: ${r.fix}`);
      if (r.who) lines.push(`          who: ${WHO_TAG[r.who] || r.who}`);
    }
  }
  lines.push('');
  if (audit.ready) {
    lines.push('Ready. Nothing blocks a fully configured stack and repository.');
  } else {
    const y = audit.youSteps.length;
    const m = audit.modelSteps.length;
    lines.push(`Not ready: ${y} step${y === 1 ? '' : 's'} for you, ${m} for the model.`);
    if (m) lines.push(`Hand the model-fixable ones to the model: devos fix <folder>`);
    if (y) lines.push('The steps marked "you fix" never go to a model — they are logins, plans, and key values.');
  }
  return lines.join('\n');
}

// The prompt `devos fix` sends to the configuration model. It contains ONLY the
// model-fixable rows — logins, plan switches, and secrets never enter a prompt.
export function buildRepairPrompt({ projectDir, answers, audit }) {
  const steps = audit.modelSteps;
  const lines = [];
  lines.push('You are repairing an existing DEV_OS project in place.');
  lines.push('');
  lines.push(`Project folder: ${projectDir}`);
  lines.push(`Project slug: ${answers?.project?.slug || 'unknown'}`);
  lines.push('');
  lines.push('A verification audit found these problems inside the project folder. Fix every one of them, using your ordinary file tools. Rules:');
  lines.push('1. Work only inside the project folder.');
  lines.push('2. Do NOT invent, print, or move any secret value. Secrets are set by the developer with gh secret set — never by you.');
  lines.push('3. Call init_github only if the repository does not exist yet; it refuses to run twice.');
  lines.push('4. Keep every existing answer in devos/answers.json unchanged.');
  lines.push('5. When you are done, print one line per fixed problem: "fixed: <problem>".');
  lines.push('');
  lines.push('Problems to fix:');
  for (const s of steps) {
    lines.push(`- ${s.label}: ${s.detail}`);
    if (s.fix && s.fix.startsWith('devos fix')) lines.push(`  (engine note: this row is the pointer to you; the real requirement is the problem described above)`);
  }
  lines.push('');
  lines.push('After fixing, make sure the project passes its bootstrap guards: the answers file (devos/answers.json) still matches what was built, the automation workflows exist, and the tree matches the chosen stack.');
  return lines.join('\n');
}

// Shared folder resolution for verify/fix/watch/keys-style commands. Absolute paths
// pass through untouched; a relative folder resolves against the caller's cwd. A
// value that belongs to a flag (--max-passes 2, --interval 5) is never mistaken for
// the folder: any argument directly after a --flag is skipped.
export function resolveProjectFolder(args, home, cwd) {
  const folderArg = args.find((a, i) => a && !a.startsWith('--') && !(i > 0 && String(args[i - 1]).startsWith('--')));
  if (folderArg) return resolve(cwd, folderArg);
  const lp = lastProjectFile(home);
  if (existsSync(lp)) {
    try { return JSON.parse(readFileSync(lp, 'utf8')).path || null; } catch { return null; }
  }
  return null;
}

export function printRemainingSteps(audit, projectDir) {
  const steps = remainingSteps(audit);
  if (!steps.length) return;
  const lines = ['', 'What still stands between you and a finished setup:'];
  for (const s of steps) {
    const owner = s.who === 'model' ? 'model' : s.who === 'devos' ? 'devos' : 'you';
    lines.push(`  - [${owner}] ${s.label}: ${s.detail}`);
    if (s.fix) lines.push(`      fix: ${s.fix}`);
  }
  if (audit.modelSteps.length) lines.push(`  The model-fixable steps can be applied for you: devos fix ${projectDir || '<folder>'}`);
  console.log(lines.join('\n'));
}
