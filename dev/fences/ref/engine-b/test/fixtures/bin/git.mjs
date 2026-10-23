#!/usr/bin/env node
// fake git: delegates to the real git binary, but can fail commits on demand for the
// upgrade rollback test. Logs every call.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const logFile = process.env.DEVOS_FAKE_LOG || '/tmp/devos-fake-git.log';
try { appendFileSync(logFile, JSON.stringify({ cmd: 'git', argv, at: Date.now() }) + '\n'); } catch {}

if (process.env.DEVOS_GIT_FAIL_COMMIT === '1' && argv[0] === 'commit') {
  process.stderr.write('fake git: commit failed on purpose\n');
  process.exit(1);
}
// DEVOS_GIT_FAKE_PUSH=1: the network verbs (push/fetch/rebase) are virtualized —
// real git would need a live remote. Used by the devos continue tests that prove
// the adoption path (repo already exists -> remote add -> push). DEVOS_GIT_FAIL_PUSH=1
// makes push fail with a realistic rejection so the failure message is tested too.
if (process.env.DEVOS_GIT_FAKE_PUSH === '1' && ['push', 'fetch', 'rebase'].includes(argv[0])) {
  if (argv[0] === 'push' && process.env.DEVOS_GIT_FAIL_PUSH === '1') {
    process.stderr.write(' ! [rejected]        main -> main (non-fast-forward)\n');
    process.exit(1);
  }
  if (argv[0] === 'push') process.stdout.write('To https://github.com/fake/remote.git\n * [new branch]      main -> main\n');
  process.exit(0);
}
const real = process.env.DEVOS_REAL_GIT || '/usr/bin/git';
const r = spawnSync(real, argv, { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
