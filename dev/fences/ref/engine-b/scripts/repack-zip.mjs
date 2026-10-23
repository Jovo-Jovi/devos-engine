#!/usr/bin/env node
// Repackage download/devos-engine.zip with the explicit shipping manifest:
// bin, lib, ui, payload, test, scripts (gen/patch helpers only — no logs),
// start.bat/sh, package.json, README, QUICKSTART, MANUAL, ARCHITECTURE,
// DECISIONS, LICENSE. Excludes node_modules, .env, worklog, download itself,
// tool-results, upload, skills. Idempotent; prints the final size + count.
import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'download', 'devos-engine.zip');
const TOPS = ['bin', 'lib', 'ui', 'payload', 'test', 'scripts'];
const FILES = ['start.bat', 'start.sh', 'package.json', 'README.md', 'QUICKSTART.md', 'MANUAL.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'LICENSE'];
const EXCLUDE = /node_modules|\.env|worklog\.md|tool-results|\/logs\/|ui-server\.log|test-run\.log|debug-stop\.mjs|ui-smoke\.mjs|gen-modules\.mjs|gen-stacks\.mjs|patch-stack-fits\.mjs/;

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (EXCLUDE.test(`/${rel}`)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, rel));
    else out.push(rel);
  }
  return out;
}

const entries = [...TOPS.flatMap((t) => walk(join(ROOT, t), t)).filter(Boolean), ...FILES.filter((f) => existsSync(join(ROOT, f)))];
try { execFileSync('rm', ['-f', OUT]); } catch {}
// zip via the system binary (deterministic listing, keeps unix perms)
execFileSync('zip', ['-q', '-r', '-X', OUT, ...entries], { cwd: ROOT, stdio: 'inherit' });
const list = execFileSync('unzip', ['-l', OUT], { encoding: 'utf8' });
const m = list.match(/(\d+)\s+files/);
console.log(`devos-engine.zip: ${entries.length} entries, ${m ? m[1] : '?'} files listed, ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
