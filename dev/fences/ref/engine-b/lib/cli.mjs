import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { lastProjectFile } from './paths.mjs';

const HELP = `devos — a local developer tool. Two stages: you configure once; GitHub Actions continues with your reviewer and builder.

devos init                 Open the guided configuration UI and create a new project.
                           While the model writes, every line it prints appears live
                           ([agent] …) under a progress percentage and todo list. Stop
                           it with Ctrl+C (kills the model process cleanly) or the Stop
                           button in the UI; resume later with init --continue.
devos continue [<folder>] [--model auto] [--cli <tool>] [--wait-keys|--no-wait-keys]
                           [--keys-mode local|model] [--no-browser]
                           The smart resume for a project that already started — after an
                           error, a usage limit, or a Stop you did not mean to press.
                           Prints what is done and what is missing, then continues the
                           next steps itself: the model only when the tree still fails
                           the guards, npm install by the engine, init_github by the
                           engine (a repository that already exists is adopted, never
                           recreated), and the keys stage: the organized where-to-get
                           guide, the local fill-in file, and the upload to GitHub.
                           In a terminal it OPENS THE BROWSER WINDOW (the guided UI on
                           127.0.0.1): the run mirrors there live, and missing keys
                           open the Missing keys card — type each value there and the
                           engine uploads it to GitHub itself (a value never reaches
                           the model); the card re-opens for anything still missing
                           until GitHub confirms every key, then the fresh cycle run
                           starts on its own. devos/secrets.local.json and gh's hidden
                           prompt stay open as the terminal doors. If a step still
                           fails, the configuration model proposes a fix and you
                           approve it here with y/N.
                           --wait-keys forces the file-wait in a non-interactive shell;
                           --no-wait-keys prints the steps and exits (what the UI does);
                           --no-browser skips the live window (scripts).
                           --keys-mode local (paste values into devos/secrets.local.json,
                           the engine uploads) or model (the configuration model walks
                           you through every key — you type each value into gh's hidden
                           prompt). Without the flag, devos asks once and remembers
                           the choice for the next run.
devos init --continue <folder> [--model auto] [--cli <tool>]
                           Same smart resume as devos continue (kept for old habits):
                           check for misses first, then finish the missing steps —
                           --model auto lets Cursor pick (the only model Free plans run);
                           --cli switches the tool, e.g. --cli claude.
devos doctor [--json]      Show what this computer has: Node, git, gh, and every agent CLI.
                           --json prints the same check as JSON.
devos status [<folder>]    Show the saved models, active modules, and the latest cycle run.
devos agents detect        Print every detected agent CLI and its model list as JSON.
devos accounts             Show which account and plan each CLI is signed in with, which
                           models each account reports as available, and verify the gh
                           login and token scopes needed to create the repository.
devos verify [<folder>]    Audit everything between here and a fully configured stack on
                           GitHub: machine, gh credentials, CLI accounts and the models
                           each account can run, project guards, repository, workflows,
                           secrets. Every problem prints its fix and who applies it —
                           you (logins, plans, key values) or the model (project files).
devos fix [<folder>] [--cli <tool>] [--model <id>]
                           Send the model-fixable problems back to the configuration
                           model inside the project folder, then verify again. Login,
                           plan, and key steps never go to a model — those print for you.
devos watch [<folder>] [--interval <sec>] [--once] [--json]
                           Test everything at once — the full verify audit — then keep
                           re-testing every <sec> seconds (default 15) until a pass is
                           all green. Fixes you or devos fix apply are picked up on the
                           next pass automatically. --once runs a single pass; --json
                           prints each pass as JSON.
devos keys [--check] [--push]
                           The keys moment. Without flags: write the guides, create
                           devos/secrets.local.json (the file the values go into), and
                           print the organized steps. --check compares GitHub's own
                           secret list with what the project needs. --push uploads
                           every value already in devos/secrets.local.json and reports
                           what is left. Values live only in that gitignored file or
                           gh's own hidden prompt — never in chat, never with a model.
devos upgrade              Update engine files in a project on a branch, as a pull request.
devos report [<folder>]    Read the latest devos-cycle run on GitHub and report it in plain
                           English: green = what happens next; failed = the failing step's
                           own last log lines plus the likely cause; still running = watch
                           it here until the outcome lands. Reports only — never restarts.
devos ui                   Open the guided UI for a draft without running init.
devos --help               Show this help.

Nothing is created in a project folder and nothing is created on GitHub until you confirm the summary. Secret values are typed only into gh's own prompt.`;

export function printHelp() {
  console.log(HELP);
}

function openBrowser(url) {
  // Several attempts per platform; a spawn that never errors still may open
  // nothing, so the caller always prints the address as a fallback.
  const attempts = process.platform === 'darwin' ? [['open', [url]]]
    : process.platform === 'win32' ? [
        ['cmd', ['/c', 'start', '', url]],
        ['rundll32', ['url.dll,FileProtocolHandler', url]],
      ]
    : [['xdg-open', [url]], ['x-www-browser', [url]], ['sensible-browser', [url]]];
  for (const [cmd, args] of attempts) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch { /* try next */ }
  }
  return false;
}

function printEvent(evt) {
  switch (evt.type) {
    case 'file': console.log(`wrote ${evt.path}`); break;
    case 'module': console.log(`module ${evt.id} included`); break;
    case 'phase':
      if (evt.name === 'creating-github') console.log('Creating GitHub repository.');
      if (evt.name === 'writing-project') console.log('Writing project.');
      if (evt.name === 'assessing') console.log('Checking what is already done and what is missing…');
      if (evt.name === 'installing') console.log('Installing dependencies…');
      if (evt.name === 'consulting') console.log('The engine could not finish the step by itself. The configuration model is asked for a fix proposal…');
      if (evt.name === 'keys-guide') console.log('The configuration model is writing the keys guide — devos/SECRETS_GUIDE.md…');
      if (evt.name === 'waiting-keys') console.log('Waiting for the key values in devos/secrets.local.json — save the file as you fill it; Ctrl+C is a safe pause.');
      if (evt.name === 'applying-fix') console.log('Applying the fix you approved…');
      if (evt.name === 'repairing') console.log(`Guard failed. Automatic repair round ${evt.round} of 5, including the guard output.`);
      if (evt.name === 'stopping') console.log('Stopping — killing the model process…');
      if (evt.name === 'stopped') console.log('Stopped. Everything written so far is saved in the project folder.');
      if (evt.name === 'usage-limit') console.log('A usage limit is a wait, not a failed task. Resume with devos continue <folder>.');
      if (evt.name === 'plan-restriction') console.log('The plan behind this CLI refused the named model. Resume with devos continue <folder> --model auto, or switch tools with --cli <tool>.');
      if (evt.name === 'trust-gate') console.log('The CLI wants a one-time trust confirmation for the project folder. Run it once interactively, answer Yes, then resume with devos continue <folder>.');
      break;
    case 'log':
      // Engine sentences keep the engine voice; the model's own lines are
      // prefixed so the two speakers can never be confused in the scrollback.
      // Install output (devos continue runs npm install itself) gets its own tag,
      // and so do the approved fix commands ([fix]).
      if (evt.stream === 'install') { console.log(`[deps] ${evt.line}`); break; }
      if (evt.stream === 'repair') { console.log(`[fix] ${evt.line}`); break; }
      console.log(evt.stream && evt.stream !== 'engine' ? `[agent] ${evt.line}` : evt.line);
      break;
    case 'proposal': {
      const p = evt.proposal || {};
      console.log('');
      console.log('The configuration model proposes this fix:');
      if (p.diagnosis) console.log(`  Why: ${p.diagnosis}`);
      for (const c of p.commands || []) console.log(`  Run: ${c.run}${c.why ? `   (${c.why})` : ''}`);
      for (const s of p.userSteps || []) console.log(`  You: ${s}`);
      break;
    }
    case 'proposal-decision':
      if (evt.stopped) console.log('The run was stopped — the proposal was not applied.');
      else if (evt.approve) console.log('Approved — applying the fix, then retrying the step.');
      else console.log('Declined — nothing was applied.');
      break;
    case 'github': break; // final screen prints the links
    default: break;
  }
}

export function printFinalScreen(result, answers) {
  console.log('');
  console.log(result.finalLine || `devos init: ${answers.project.slug} is set up; devos-cycle dispatched.`);
  if (result.ok) {
    console.log(`Repository: ${result.init.repoUrl}`);
    console.log(`Actions: ${result.init.actionsUrl}`);
    if (result.init.setupIssueUrl) console.log(`Setup issue: ${result.init.setupIssueUrl}`);
    console.log('The configuration model only wakes when a step needs it — tree repairs and the keys guide.');
    if (result.firstRunGreen) {
      console.log('The first cycle run is green with the selected keys — the configuration model\'s job is done.');
      console.log('Your job from here: merge pull requests labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green. Any issue continues on GitHub — not in this engine.');
    } else {
      console.log('Your job: merge pull requests labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green, and add anything the setup issue lists.');
    }
    const keysMissing = result.keysMissing || [];
    if (result.keysPushed?.length) console.log(`Keys: ${result.keysPushed.join(', ')} uploaded from devos/secrets.local.json.`);
    if (keysMissing.length) {
      console.log(`Keys: ${keysMissing.length} still missing — ${keysMissing.join(', ')}.`);
      console.log('  1. Open devos/SECRETS_GUIDE.md (or run devos keys) — where each key comes from, step by step.');
      console.log('  2. Paste each value into devos/secrets.local.json (gitignored — it never leaves this folder).');
      console.log('  3. Run devos continue — it waits and uploads; or devos keys --push to upload without waiting.');
    } else {
      console.log('Keys: devos keys shows where each token comes from; devos keys --check confirms every needed key is set on GitHub.');
    }
  } else if (result.stopped) {
    // A stop is a decision, not a failure: say exactly what survives and how to
    // pick the work back up.
    console.log(result.message || 'Stopped by you.');
    console.log('Nothing is lost — resume when you are ready: devos continue <folder>');
  } else {
    console.log(`The configuration stage failed: ${result.message}`);
    console.log('Fix the message above, then run: devos continue <folder>');
  }
}

// Started projects near the user: the last project first, then a shallow scan of
// the workspace `devos init` was run from. Powers the continue pointer in init
// and the resume candidates in the UI. Cheap and local — no gh, no network.
export function findStartedProjects({ home, workspace }) {
  const found = new Map();
  const add = (dir) => {
    try {
      const p = resolve(dir);
      const ap = join(p, 'devos', 'answers.json');
      if (!existsSync(ap) || found.has(p)) return;
      let slug = null;
      try { slug = JSON.parse(readFileSync(ap, 'utf8')).project?.slug || null; } catch { /* broken answers still list, without a slug */ }
      found.set(p, { path: p, slug });
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
  } catch { /* workspace unreadable: only the last project is offered */ }
  return [...found.values()].slice(0, 3);
}

// The terminal half of the consultation: show the proposal, ask for approval.
// Never auto-approves — a closed or piped-EOF stdin counts as a decline, so a
// CI run can never silently apply model-proposed commands.
export async function confirmProposal(proposal, { input = process.stdin, output = process.stderr } = {}) {
  const p = proposal || {};
  output.write('\nThe configuration model proposes this fix:\n');
  if (p.diagnosis) output.write(`  Why: ${p.diagnosis}\n`);
  for (const c of p.commands || []) output.write(`  Run: ${c.run}${c.why ? `   (${c.why})` : ''}\n`);
  for (const s of p.userSteps || []) output.write(`  You: ${s}\n`);
  if (!p.commands || !p.commands.length) output.write('  (no commands — the model only lists steps for you)\n');
  if (!input || !input.readable) {
    output.write('No interactive input available — the proposal was declined. Run devos continue again in a terminal to decide.\n');
    return false;
  }
  const rl = createInterface({ input, output, terminal: false });
  const answer = await new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    rl.question('Apply this fix? [y/N] ', (a) => settle(a));
    input.once('end', () => settle(null));
    input.once('close', () => settle(null));
  });
  rl.close();
  if (answer == null) {
    output.write('No answer — the proposal was declined. Run devos continue again to decide.\n');
    return false;
  }
  return /^[yt]/i.test(String(answer).trim());
}

// The keys-mode question, asked once in the terminal. EOF/piped stdin answers
// null → the default (local file) wins, so scripts never hang on the question.
export async function chooseKeysMode(question, { input = process.stdin, output = process.stderr } = {}) {
  output.write(`\n${question}\n`);
  if (!input || !input.readable) {
    output.write('No interactive input available — the local-file mode is used.\n');
    return null;
  }
  const rl = createInterface({ input, output, terminal: false });
  const answer = await new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    rl.question('', (a) => settle(a));
    input.once('end', () => settle(null));
    input.once('close', () => settle(null));
  });
  rl.close();
  if (answer == null) {
    output.write('No answer — the local-file mode is used.\n');
    return null;
  }
  return String(answer).trim() || null;
}

// The smart resume shared by `devos continue` and `devos init --continue` (the
// same flow now: check for misses, then finish the missing steps itself).
async function runContinueCommand({ folder, args, home, cwd }) {
  const readFlag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const overrides = {};
  if (readFlag('--cli')) overrides.cli = readFlag('--cli');
  if (readFlag('--model')) overrides.model = readFlag('--model');
  // The keys wait: default is 'auto' (wait in a real terminal only). --wait-keys
  // forces the wait (CI with an operator watching), --no-wait-keys prints the
  // steps and exits — the UI passes the same no-wait choice.
  const waitKeys = args.includes('--wait-keys') ? true : args.includes('--no-wait-keys') ? false : 'auto';
  const keysModeIdx = args.indexOf('--keys-mode');
  const keysModeRaw = keysModeIdx >= 0 ? String(args[keysModeIdx + 1] || '').trim() : null;
  const keysMode = keysModeRaw === 'local' || keysModeRaw === 'model' ? keysModeRaw : null;
  const projectDir = resolve(cwd, folder);
  if (!existsSync(join(projectDir, 'devos', 'answers.json'))) {
    console.error(`No answer file in ${projectDir}. Run devos init for a new project.`);
    process.exitCode = 1;
    return;
  }

  // THE LIVE WINDOW: the Missing keys card must be a WINDOW, not a memory.
  // When a human is at the terminal, `devos continue` hosts the wizard UI on
  // 127.0.0.1 and opens it: the browser mirrors every engine line live and the
  // Missing keys card (and the Stop button) work there — the exact promise the
  // reports make. Scripts and piped output stay browserless (nothing to show).
  const noBrowser = args.includes('--no-browser') || process.env.DEVOS_NO_BROWSER === '1';
  const wantWindow = !noBrowser && Boolean(process.stdout.isTTY) && !args.includes('--no-wait-keys');
  let win = null;
  let winStop = false;
  if (wantWindow) {
    try {
      const { startServer } = await import('./server.mjs');
      const started = await startServer({ home, workspace: dirname(projectDir), port: Number(process.env.DEVOS_PORT || 7788) });
      win = started.attachRun({ onStop: () => { winStop = true; } });
      openBrowser(started.url);
      console.log(`The live window is at ${started.url} — the same run mirrors there, and the Missing keys card opens in it when keys are missing.`);
      console.log('A key value is typed ONLY into that card (browser → GitHub directly), devos/secrets.local.json, or gh\'s hidden prompt — never into chat.');
    } catch (e) {
      console.log(`The browser window could not be opened (${e.message}) — the terminal continues on its own; the Missing keys card lives in the wizard UI (devos ui).`);
      win = null;
    }
  }

  const { runContinue } = await import('./continue.mjs');
  const { killActiveChild } = await import('./configmodel.mjs');
  const interrupt = stopOnCtrlC({ onFirst: () => killActiveChild('Ctrl+C') });
  const emit = (evt) => {
    printEvent(evt);
    if (win) { try { win.emit(evt); } catch { /* the terminal still shows it */ } }
  };
  const result = await runContinue({
    projectDir, home, overrides, emit,
    shouldStop: () => interrupt.shouldStop() || winStop,
    decide: (proposal) => confirmProposal(proposal), waitKeys,
    choose: (question) => chooseKeysMode(question),
    keysMode,
    // The intake door: the Missing keys card in the live window. Names go out,
    // values come back once — the engine pipes each straight into gh secret set.
    ...(win ? { requestValues: (ask) => win.requestValues(ask) } : {}),
  })
    .catch((e) => ({ ok: false, message: e.message }));
  interrupt.done();
  if (win) {
    try { win.finish(result); } catch { /* the terminal final screen still prints */ }
  }
  printFinalScreen(result, { project: { slug: result.slug || folder } });
  if (!result.ok) {
    // Never end on a dead end: list everything that still stands between the
    // developer and a finished setup, each with its fix and its owner.
    try {
      const { auditSetup, printRemainingSteps } = await import('./verify.mjs');
      printRemainingSteps(auditSetup({ projectDir }), projectDir);
    } catch { /* the failure message above still stands */ }
  }
  if (!result.ok) process.exitCode = result.stopped ? 130 : 1;
}

export async function cmdContinue(args, { home, cwd }) {
  const { resolveProjectFolder } = await import('./verify.mjs');
  const folder = resolveProjectFolder(args, home, cwd);
  if (!folder || !existsSync(join(folder, 'devos', 'answers.json'))) {
    console.error('No DEV_OS project found. Pass the project folder: devos continue <folder> — or run devos init for a new project.');
    process.exitCode = 1;
    return;
  }
  await runContinueCommand({ folder, args, home, cwd });
}

// One Ctrl+C policy for every long model run (continue, terminal wizard, fix):
// the first Ctrl+C kills the model process tree and lets the run return a clean
// `stopped` result; a second Ctrl+C force-quits immediately.
export function stopOnCtrlC({ onFirst }) {
  let presses = 0;
  const handler = () => {
    presses += 1;
    if (presses === 1) {
      console.log('\nStopping — killing the model process… (press Ctrl+C again to force-quit)');
      if (onFirst) onFirst();
      return;
    }
    console.log('\nForce quit.');
    process.exit(130);
  };
  process.on('SIGINT', handler);
  return {
    shouldStop: () => presses > 0,
    done: () => process.removeListener('SIGINT', handler),
  };
}

export async function cmdInit(args, { home, workspace, cwd }) {
  const continueIdx = args.indexOf('--continue');
  if (continueIdx >= 0) {
    const folder = args[continueIdx + 1];
    if (!folder) { console.error('devos init --continue needs a folder.'); process.exitCode = 1; return; }
    await runContinueCommand({ folder, args, home, cwd });
    return;
  }

  const { machineCheck } = await import('./doctor.mjs');
  const machine = machineCheck();
  if (!machine.ready) {
    for (const b of machine.blocks) console.error(`Blocker: ${b}`);
    console.error('Fix the blockers above, then run devos init again.');
    process.exitCode = 1;
    return;
  }

  // An already-started project near here gets a pointer, not a trap: init is for
  // NEW projects, and the started one is one command away from being finished.
  const started = findStartedProjects({ home, workspace });
  if (started.length) {
    console.log('');
    console.log(`A started DEV_OS project${started[0].slug ? ` (${started[0].slug})` : ''} is here: ${started[0].path}`);
    console.log(`To check it for misses and continue where it stopped: devos continue "${started[0].path}"`);
    console.log('The guided UI below offers the same continue. Starting a new project is still fine.');
    console.log('');
  }

  const { startServer } = await import('./server.mjs');
  const port = Number(process.env.DEVOS_PORT || 7788);
  const { url, stopRun, isRunning } = await startServer({ home, workspace, port });
  // Ctrl+C policy for UI mode: while a run is alive, the first Ctrl+C stops the
  // run (the same path as the Stop button); with no run it simply quits.
  let presses = 0;
  process.on('SIGINT', () => {
    presses += 1;
    if (isRunning() && presses === 1) {
      console.log('\nStopping — killing the model process… (press Ctrl+C again to force-quit)');
      stopRun();
      return;
    }
    process.exit(130);
  });
  const noBrowser = args.includes('--no-browser') || process.env.DEVOS_NO_BROWSER === '1';
  const opened = noBrowser ? false : openBrowser(url);
  const { renderLogo } = await import('./logo.mjs');
  console.log(renderLogo(process.stdout));
  console.log(`The guided UI is at ${url}`);
  console.log('');
  console.log('No browser window appeared? Copy this address into your browser:');
  console.log(`  ${url}`);
  console.log('Leave this terminal open while you answer the questions.');
  if (!opened) {
    console.error('No browser could be opened. The same steps work as a numbered list here in the terminal.');
    const { runTerminalWizard } = await import('./termwizard.mjs');
    const { runInit } = await import('./init.mjs');
    const { killActiveChild } = await import('./configmodel.mjs');
    const draft = await runTerminalWizard({ home });
    if (!draft) { console.log('Nothing was created.'); return; }
    const interrupt = stopOnCtrlC({ onFirst: () => killActiveChild('Ctrl+C') });
    const { result, answers, projectDir } = await runInit({ draft, home, workspace, emit: printEvent, shouldStop: interrupt.shouldStop });
    interrupt.done();
    printFinalScreen(result, answers);
    if (!result.ok) {
      console.log('');
      try {
        const { auditSetup, printRemainingSteps } = await import('./verify.mjs');
        printRemainingSteps(auditSetup({ projectDir, answers }), projectDir);
        console.log(`Pick all of this up later with: devos continue "${projectDir}"`);
      } catch { /* the failure message above still stands */ }
    }
    if (!result.ok) process.exitCode = result.stopped ? 130 : 1;
    return;
  }
  // UI mode: the confirm button drives the run. Stay alive while it works.
  console.log('Answer the questions there. Confirm is the first moment a project folder may exist.');
  const keep = setInterval(() => {
    // exit when a run finished and the user closed the tab (server keeps serving; CLI waits)
  }, 1 << 30);
  keep.unref();
  await new Promise(() => { /* serve until interrupted */ });
}

export async function cmdUi(args, { home, workspace }) {
  const { startServer } = await import('./server.mjs');
  const port = Number(process.env.DEVOS_PORT || 7788);
  const { url } = await startServer({ home, workspace, port });
  openBrowser(url);
  console.log(`The guided UI is at ${url} (Ctrl+C to stop)`);
  await new Promise(() => {});
}

export async function cmdDoctor(args = []) {
  const { machineCheck, printDoctor } = await import('./doctor.mjs');
  if (args.includes('--json')) {
    console.log(JSON.stringify(machineCheck(), null, 2));
    return;
  }
  console.log(printDoctor());
}

// devos keys — the keys-and-tokens moment. --check compares GitHub's own secret
// list with what the project needs; --push uploads every value already present in
// devos/secrets.local.json; without flags it writes the guides, creates the local
// fill-in file, and prints the organized steps. A value lives only in that
// gitignored file or gh's own hidden prompt — never in chat, never with the model.
export async function cmdKeys(args, { cwd, home }) {
  const projectIdx = args.indexOf('--project');
  let dir = projectIdx >= 0 ? resolve(cwd, args[projectIdx + 1]) : null;
  if (!dir) {
    const { lastProjectFile } = await import('./paths.mjs');
    const lp = lastProjectFile(home);
    if (existsSync(lp)) dir = JSON.parse(readFileSync(lp, 'utf8')).path;
  }
  if (!dir || !existsSync(join(dir, 'devos', 'answers.json'))) {
    console.error('No DEV_OS project found. Run devos init first, or pass --project <folder>.');
    process.exitCode = 1;
    return;
  }
  const answersPath = join(dir, 'devos', 'answers.json');
  const answers = JSON.parse(readFileSync(answersPath, 'utf8'));
  const repo = answers.project?.slug;

  if (args.includes('--check')) {
    const { checkKeys } = await import('./keys.mjs');
    if (!repo) { console.error('The answer file has no repository slug.'); process.exitCode = 1; return; }
    const result = checkKeys({ repo, answers });
    if (!result.ok) {
      console.error(`Could not read GitHub secrets: ${result.error}`);
      console.error('Check that gh is installed and signed in (gh auth login), then try again.');
      process.exitCode = 1;
      return;
    }
    console.log(`Keys on ${repo}:`);
    for (const k of result.keys) console.log(`  ${k.set ? 'ready     ' : 'MISSING   '}${k.name}`);
    if (!result.keys.length) console.log('  (none needed)');
    if (result.missing.length) {
      console.log(`${result.setCount} of ${result.keys.length} set. For each MISSING name:`);
      console.log(`  1. Open devos/SECRETS_GUIDE.md (or run devos keys) — where to get each key, step by step.`);
      console.log(`  2. Paste the value into devos/secrets.local.json -> "NAME" and save.`);
      console.log(`  3. Run: devos continue   (waits for the file and uploads) — or: devos keys --push`);
      console.log(`     Terminal habit instead: gh secret set NAME --repo ${repo}   (gh hides what you type)`);
      console.log('  4. Run devos keys --check again.');
      console.log('Never paste a key into chat, email, or an issue — the local file and gh\'s hidden prompt are the only places a value is typed.');
      process.exitCode = 1;
      return;
    }
    console.log(`All ${result.keys.length} keys are in place. The cycle workflows pick them up automatically.`);
    return;
  }

  // --push: upload every value already filled in devos/secrets.local.json, no wait.
  if (args.includes('--push')) {
    const { pushFromLocalFile } = await import('./secretsflow.mjs');
    const { readInitState } = await import('./secret.mjs');
    const target = readInitState(dir)?.repo || repo;
    if (!target) { console.error('The project has no repository yet — run devos continue first.'); process.exitCode = 1; return; }
    const out = await pushFromLocalFile({
      projectDir: dir, answers, repo: target,
      say: (l) => console.log(l),
    });
    if (!out.ok) {
      console.error(`Could not read GitHub secrets: ${out.error}`);
      console.error('Check that gh is installed and signed in (gh auth login), then try again.');
      process.exitCode = 1;
      return;
    }
    if (out.allSet) {
      console.log(`All needed keys are on ${target} now. The next devos-cycle run picks them up.`);
      return;
    }
    if (out.pushed.length) console.log(`Uploaded ${out.pushed.length} key(s): ${out.pushed.join(', ')}.`);
    else console.log('Nothing to upload yet — no value is filled in devos/secrets.local.json.');
    const left = [...out.missing, ...out.unconfirmed];
    if (left.length) {
      console.log(`Still needed (${left.length}): ${left.join(', ')}`);
      console.log(`Fill them in devos/secrets.local.json (guide: devos/SECRETS_GUIDE.md), then run devos keys --push again.`);
      process.exitCode = 1;
    }
    return;
  }

  const { writeKeysNotes, keyCatalog } = await import('./keys.mjs');
  const { ensureLocalSecretsFile, ensureGitignored } = await import('./secretsflow.mjs');
  const file = writeKeysNotes(dir, answers);
  const keys = keyCatalog(answers);
  ensureGitignored(dir);
  const local = ensureLocalSecretsFile(dir, keys.map((k) => k.name));
  console.log(`Keys guide written: ${file}`);
  console.log(`Values go here: ${local.file}  (gitignored — it never leaves this folder, the model never sees it)`);
  console.log(`This project needs ${keys.length} key(s) on GitHub: ${keys.map((k) => k.name).join(', ') || 'none'}.`);
  console.log('');
  console.log('How this works:');
  console.log(`  1. Get each key where the guide says (provider dashboards — Vercel, Supabase, Firebase, Stripe, ...).`);
  console.log(`  2. Paste each value into ${local.file} -> "NAME" and save.`);
  console.log(`  3. Upload: devos continue (waits for the file) — or devos keys --push — and verify with devos keys --check.`);
  console.log(`     Terminal habit instead: gh secret set NAME --repo ${repo || 'owner/name'}   (gh hides what you type)`);
  console.log('');
  console.log('Never put a key in chat, email, or a GitHub issue, and never give one to a model. The local file and gh\'s hidden prompt are the only places a value is typed.');
  console.log('The guides hold names and instructions only — they are safe to keep in the repository.');
}

// devos verify [<folder>] — the full-journey audit. Folder defaults to the last
// project. --json prints the rows for scripts and the UI.
export async function cmdVerify(args, { home, cwd }) {
  const { auditSetup, printVerify, resolveProjectFolder } = await import('./verify.mjs');
  const { readAnswersFromProject } = await import('./keys.mjs');
  const projectDir = resolveProjectFolder(args, home, cwd);
  const answers = projectDir ? readAnswersFromProject(projectDir) : null;
  const audit = auditSetup({ projectDir, answers });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ready: audit.ready, rows: audit.rows, youSteps: audit.youSteps, modelSteps: audit.modelSteps }, null, 2));
  } else {
    console.log(printVerify(audit, { title: projectDir ? `DEV_OS verify ${projectDir}` : 'DEV_OS verify' }));
  }
  if (!audit.ready) process.exitCode = 1;
}

// devos watch [<folder>] — the full audit over and over until it is all green. Each
// pass re-reads the answer file and re-probes machine + GitHub + accounts, so fixes
// by you (logins, secrets) or by the model (devos fix) are visible on the next pass.
// The watch ends on the first all-green pass; Ctrl+C stops it politely.
export async function cmdWatch(args, { home, cwd }) {
  const verify = await import('./verify.mjs');
  const { runWatch } = await import('./watch.mjs');
  const projectDir = verify.resolveProjectFolder(args, home, cwd);
  const readFlag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const sec = Math.max(3, Number(readFlag('--interval')) || 15);
  const maxFlag = readFlag('--max-passes');
  const maxPasses = maxFlag ? Math.max(1, Number(maxFlag) || 1) : (args.includes('--once') ? 1 : Infinity);
  const json = args.includes('--json');
  console.log(`DEV_OS watch — the full audit every ${sec}s${projectDir ? ` on ${projectDir}` : ''}.`);
  console.log('Fixes you or devos fix apply are picked up on the next pass. Ctrl+C stops; the watch ends on the first all-green pass.');
  console.log('');
  process.on('SIGINT', () => {
    console.log('\nWatch stopped. Run devos verify for the full report any time.');
    process.exit(0);
  });
  const result = await runWatch({
    projectDir,
    intervalMs: sec * 1000,
    maxPasses,
    onPass: json
      ? (p) => console.log(JSON.stringify({ pass: p.pass, final: p.final, ready: p.audit.ready, changed: p.changed.map((r) => `${r.section}/${r.label}`), rows: p.audit.rows }, null, 2))
      : null,
    out: json ? null : (line) => console.log(line),
  }).catch((e) => ({ ready: false, passes: 0, audit: { rows: [], youSteps: [], modelSteps: [] }, error: e.message }));
  if (json && result.error) console.log(JSON.stringify({ error: result.error }, null, 2));
  if (!json && result.error) console.log(`Watch failed: ${result.error}`);
  if (!result.ready) process.exitCode = 1;
}

// devos report [<folder>] — the outcome of the latest devos-cycle run, in plain
// English, without restarting anything. A running run is watched here until it
// completes (bounded); a finished run is read on the spot: the failing step's
// own log lines and the likely cause on failure, next steps on green.
export async function cmdReport(args, { home, cwd }) {
  const { resolveProjectFolder } = await import('./verify.mjs');
  const { readAnswersFromProject } = await import('./keys.mjs');
  const projectDir = resolveProjectFolder(args, home, cwd);
  if (!projectDir || !existsSync(join(projectDir, 'devos', 'answers.json'))) {
    console.error('No DEV_OS project found. Pass the project folder: devos report <folder>');
    process.exitCode = 1;
    return;
  }
  const answers = readAnswersFromProject(projectDir);
  const repo = answers?.project?.slug;
  if (!repo) {
    console.error('The answer file does not name a repository (devos/answers.json -> project.slug).');
    process.exitCode = 1;
    return;
  }
  const { reportLatestCycleRun } = await import('./watchcycle.mjs');
  const { selectedToolSecrets } = await import('./keys.mjs');
  const selectedKeys = selectedToolSecrets(answers || {});
  console.log(`DEV_OS report — the latest devos-cycle run on ${repo}. Nothing is restarted.`);
  console.log('');
  const outcome = await reportLatestCycleRun({ repo, projectDir, emit: (e) => { if (e.type === 'log') console.log(e.line); }, pollMs: 15_000, maxMs: 30 * 60_000, selectedNames: selectedKeys.length ? selectedKeys : null });
  console.log('');
  for (const line of outcome.report || []) console.log(line);
  if (outcome.status === 'stopped') console.log('Stopped while watching — the run continues on GitHub; run devos report again any time.');
}

// devos fix [<folder>] — hand the model-fixable problems to the configuration model.
export async function cmdFix(args, { home, cwd }) {
  const { runFix, printFixReport } = await import('./fix.mjs');
  const { resolveProjectFolder } = await import('./verify.mjs');
  const projectDir = resolveProjectFolder(args, home, cwd);
  if (!projectDir || !existsSync(join(projectDir, 'devos', 'answers.json'))) {
    console.error('No DEV_OS project found. Run devos init first, or pass the project folder: devos fix <folder>');
    process.exitCode = 1;
    return;
  }
  const readFlag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const overrides = {};
  if (readFlag('--cli')) overrides.cli = readFlag('--cli');
  if (readFlag('--model')) overrides.model = readFlag('--model');
  console.log(`Repairing ${projectDir} with the configuration model. Only project-file problems are sent; logins, plans, and key values stay with you.`);
  console.log('');
  const { killActiveChild } = await import('./configmodel.mjs');
  const interrupt = stopOnCtrlC({ onFirst: () => killActiveChild('Ctrl+C') });
  const out = await runFix({ projectDir, overrides, emit: printEvent, shouldStop: interrupt.shouldStop }).catch((e) => ({ ok: false, modelRan: false, before: { ready: false, youSteps: [], modelSteps: [], rows: [] }, after: { ready: false, youSteps: [], modelSteps: [], rows: [] }, message: e.message }));
  interrupt.done();
  console.log(printFixReport(out));
  if (!out.ok) process.exitCode = 1;
}

export async function cmdAgentsDetect() {
  const { detectAgents } = await import('./probes.mjs');
  console.log(JSON.stringify(detectAgents(), null, 2));
}

export async function cmdAccounts() {
  const { ghPreflight } = await import('./accounts.mjs');
  const { detectAgents } = await import('./probes.mjs');
  console.log('GitHub credentials (used to create the repository and push the workflows)');
  const pf = ghPreflight();
  if (!pf.installed) {
    console.log('  gh is not installed. Install the GitHub CLI, then run gh auth login.');
  } else if (!pf.signedIn) {
    console.log('  gh is not signed in. Run: gh auth login');
  } else {
    console.log(`  signed in as ${pf.login || 'unknown account'} on github.com`);
    console.log(`  token scopes: ${pf.scopes.join(', ') || '(none reported)'}`);
    console.log(`  token works against the API: ${pf.tokenWorks ? 'yes' : 'NO'}`);
    for (const p of pf.problems) console.log(`  problem: ${p}`);
    for (const f of pf.fixes) console.log(`  fix: ${f}`);
    if (pf.ok) console.log('  Creating the repository and pushing the workflows will work.');
  }
  console.log('');
  console.log('Agent CLIs: account, plan, and the models each account reports as available');
  for (const a of detectAgents()) {
    if (a.status === 'missing') { console.log(`  ${a.label}: not installed`); continue; }
    const acc = a.account || {};
    const who = [acc.email, acc.plan ? `${acc.plan} plan` : null].filter(Boolean).join(' · ');
    const state = acc.signedIn === true ? (who || 'signed in')
      : acc.signedIn === false ? 'signed out'
        : (a.signedIn ? 'signed in (account details unavailable)' : 'signed out');
    console.log(`  ${a.label}: ${state}`);
    if (a.reportedIds.length) console.log(`    models this account reports: ${a.reportedIds.join(', ')}`);
    if (a.toolId === 'cursor') {
      console.log('    guidance: the ids `agent models` lists are the ones this Cursor account can run.');
      console.log('    Free plans run only Auto; Pro unlocks the named models (Grok and Composer included).');
      console.log('    Two Cursor accounts on one machine: the CLI uses the account signed in to the');
      console.log('    editor/CLI — confirm which one at cursor.com/settings before a paid run.');
    }
    if (a.toolId === 'claude') {
      console.log('    guidance: Claude Code weekly limits reset automatically. A run that hits the limit');
      console.log('    is a wait, not a failure — or resume on another CLI: devos init --continue <folder> --cli cursor --model auto.');
    }
  }
}

export async function cmdStatus(args, { home, cwd }) {
  const { lastProjectFile } = await import('./paths.mjs');
  let dir = args[0] ? join(cwd, args[0]) : null;
  if (!dir) {
    const lp = lastProjectFile(home);
    if (existsSync(lp)) dir = JSON.parse(readFileSync(lp, 'utf8')).path;
  }
  const projFile = dir ? join(dir, 'devos', 'project.json') : null;
  if (!projFile || !existsSync(projFile)) {
    console.log('No DEV_OS project found. Run devos init first.');
    return;
  }
  const cfg = JSON.parse(readFileSync(projFile, 'utf8'));
  console.log(`Project: ${dir}`);
  console.log(`Configuration model: ${cfg.configurationModel?.cli} ${cfg.configurationModel?.model} (finished at init)`);
  console.log(`Reviewer: ${cfg.reviewer?.cli} ${cfg.reviewer?.model}`);
  console.log(`Builder: ${cfg.builder?.cli} ${cfg.builder?.model}`);
  const mods = Object.entries(cfg.modules || {}).filter(([, v]) => v.on).map(([k]) => k);
  console.log(`Active modules: ${mods.join(', ')}`);
  const repo = cfg.repo;
  if (repo) {
    try {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('gh', ['run', 'list', '--workflow', 'devos-cycle.yml', '--limit', '1', '--repo', repo, '--json', 'displayTitle,status,url'], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        const run = JSON.parse(r.stdout)[0];
        if (run) console.log(`Latest cycle run: ${run.displayTitle || ''} ${run.status} ${run.url}`);
      }
    } catch { /* gh cannot see it; that is fine */ }
  }
}

export async function cmdUpgrade(args, { cwd }) {
  const { runUpgrade } = await import('./upgrade.mjs');
  const fromIdx = args.indexOf('--from');
  const versionIdx = args.indexOf('--version');
  const result = await runUpgrade({
    projectDir: cwd,
    sourceDir: fromIdx >= 0 ? args[fromIdx + 1] : null,
    version: versionIdx >= 0 ? args[versionIdx + 1] : null,
  });
  if (!result.ok) {
    console.log(result.message);
    process.exitCode = 1;
  }
}
