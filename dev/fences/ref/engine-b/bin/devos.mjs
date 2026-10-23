#!/usr/bin/env node
// devos — DEV_OS Engine CLI. Node 22+, ESM, no dependencies.
import { devosHome } from '../lib/paths.mjs';
import { printHelp } from '../lib/cli.mjs';

const [, , cmd, ...args] = process.argv;
const home = devosHome();
const cwd = process.cwd();
// The workspace for new projects: where devos init was run.
const workspace = cwd;

const internal = cmd && cmd.startsWith('internal:');

async function main() {
  if (cmd === 'internal:init-github') {
    const idx = args.indexOf('--project');
    const projectDir = idx >= 0 ? args[idx + 1] : cwd;
    const { runInitGithub } = await import('../lib/initgithub.mjs');
    try {
      const state = runInitGithub({ projectDir });
      // The model sees a concise success line; full state lands in devos/state/init.json.
      console.log(`github ready: ${state.repo}`);
      process.exitCode = 0;
    } catch (e) {
      // On failure, show the tool's own message and exit code.
      console.error(e.toolMessage || e.message);
      console.error(`exit code: ${e.exitCode || 1}`);
      process.exitCode = e.exitCode && Number.isInteger(e.exitCode) ? e.exitCode : 1;
    }
    return;
  }
  if (cmd === 'internal:request-secret') {
    const nameArg = args.find((a) => /^[A-Z][A-Z0-9_]*$/.test(a));
    const idx = args.indexOf('--project');
    const projectDir = idx >= 0 ? args[idx + 1] : cwd;
    const { runRequestSecret } = await import('../lib/secret.mjs');
    let result;
    try {
      result = runRequestSecret({ projectDir, name: nameArg || 'INVALID_NAME' });
    } catch (e) {
      result = { ok: false, result: 'missing', message: e.message };
    }
    // The model receives only set or missing. Anything else goes to stderr.
    if (result.message) console.error(result.message);
    console.log(result.result === 'set' ? 'set' : 'missing');
    return;
  }

  switch (cmd) {
    case undefined:
    case '--help':
    case 'help':
      printHelp();
      break;
    case 'init':
      (await import('../lib/cli.mjs')).cmdInit(args, { home, workspace, cwd });
      break;
    case 'continue':
      (await import('../lib/cli.mjs')).cmdContinue(args, { home, cwd });
      break;
    case 'doctor':
      (await import('../lib/cli.mjs')).cmdDoctor(args);
      break;
    case 'status':
      (await import('../lib/cli.mjs')).cmdStatus(args, { home, cwd });
      break;
    case 'agents':
      if (args[0] === 'detect') (await import('../lib/cli.mjs')).cmdAgentsDetect();
      else printHelp();
      break;
    case 'accounts':
      (await import('../lib/cli.mjs')).cmdAccounts();
      break;
    case 'verify':
      (await import('../lib/cli.mjs')).cmdVerify(args, { home, cwd });
      break;
    case 'fix':
      (await import('../lib/cli.mjs')).cmdFix(args, { home, cwd });
      break;
    case 'watch':
      (await import('../lib/cli.mjs')).cmdWatch(args, { home, cwd });
      break;
    case 'upgrade':
      (await import('../lib/cli.mjs')).cmdUpgrade(args, { cwd });
      break;
    case 'report':
      (await import('../lib/cli.mjs')).cmdReport(args, { home, cwd });
      break;
    case 'keys':
      (await import('../lib/cli.mjs')).cmdKeys(args, { cwd, home });
      break;
    case 'ui':
      (await import('../lib/cli.mjs')).cmdUi(args, { home, workspace });
      break;
    default:
      console.error(`Unknown command "${cmd}".`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exitCode = 1;
});
