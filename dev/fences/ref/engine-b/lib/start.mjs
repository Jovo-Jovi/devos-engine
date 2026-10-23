import readline from 'node:readline/promises';

// The one-file launcher. It checks the computer, shows what is missing, and
// starts the guided setup only after the user approves. start.sh and
// start.bat open this; --check runs the checklist without any prompt.

async function defaultLaunch() {
  const { cmdInit } = await import('./cli.mjs');
  const { devosHome } = await import('./paths.mjs');
  await cmdInit([], { home: devosHome(), workspace: process.cwd(), cwd: process.cwd() });
}

const PAD = '           ';
const MARKS = {
  ready: 'ready     ',
  blocked: 'MISSING   ',
  'signed-out': 'signed out',
  missing: 'optional  ',
};

export async function runStart({ argv = [], stdin = process.stdin, stdout = process.stdout, check, launch } = {}) {
  const say = (s = '') => stdout.write(`${s}\n`);
  const { machineCheck } = await import('./doctor.mjs');
  const machine = check ? check() : machineCheck();
  const checkOnly = argv.includes('--check');

  const { renderLogo } = await import('./logo.mjs');
  stdout.write(renderLogo(stdout));
  say('DEV_OS — start here.');
  say('This file checks the computer, shows what is missing, and starts the guided setup only after you approve.');
  say('');
  say('Your computer:');
  for (const r of machine.rows) {
    say(`  ${MARKS[r.state] || PAD}  ${r.label}: ${r.detail}`);
  }

  if (!machine.ready) {
    say('');
    say('Fix these, then open this file again:');
    machine.blocks.forEach((b, i) => say(`  ${i + 1}. ${b}`));
    say('   Node 22+ comes from https://nodejs.org (pick the LTS).');
    say('   git comes from https://git-scm.com/downloads.');
    say('   The GitHub CLI comes from https://cli.github.com — then run: gh auth login');
    say('');
    say('Nothing on your computer was changed.');
    return 1;
  }

  const signedIn = (machine.agents || []).filter((a) => a.status !== 'missing' && a.signedIn);
  if (signedIn.length === 0) {
    say('');
    say('Note: no AI CLI is signed in yet. DEV_OS needs one to pick your reviewer and builder.');
    say('  Sign one in — Claude Code, Cursor Agent, Codex, or Gemini CLI — then open this file again.');
  }

  say('');
  say('Everything DEV_OS needs is on this computer.');
  say('Nothing has been created or changed yet.');

  if (checkOnly) {
    say('Check only (--check): nothing was started.');
    return 0;
  }
  if (!stdin.isTTY) {
    say('Run this file again in a terminal to approve and start.');
    return 0;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('Start the guided setup now? [Y/n] ')).trim().toLowerCase();
  rl.close();
  if (answer && answer !== 'y' && answer !== 'yes') {
    say('Nothing was started. Open this file again any time.');
    return 0;
  }
  say('Opening the guided setup. You can stop any time with Ctrl+C.');
  await (launch || defaultLaunch)();
  return 0;
}
