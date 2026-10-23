import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// devos upgrade updates engine files only: scripts/devos/, scripts/guards/, the devos-*
// workflows and ci.yml, and devos/prompts/. Developer-edited files are listed as
// conflicts and left untouched. If anything fails before the commit, the tree is
// restored, added files are deleted, the empty branch is deleted, and nothing changed.

const ENGINE_FILE_DIRS = ['scripts/devos', 'scripts/guards'];
const WORKFLOW_DIR = join('.github', 'workflows');

function git(args, cwd, allowFail = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    const err = new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || '').trim()}`);
    err.exitCode = r.status;
    throw err;
  }
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

function listFilesRel(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFilesRel(p, base));
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

function hash(text) {
  // LF form stored in git: normalize CRLF so a Windows working copy does not fail the check.
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

export function engineFilePaths(sourceDir) {
  const files = [];
  for (const d of ENGINE_FILE_DIRS) {
    for (const rel of listFilesRel(join(sourceDir, d))) files.push({ rel: `${d}/${rel}`, src: join(sourceDir, d, rel) });
  }
  if (existsSync(join(sourceDir, WORKFLOW_DIR))) {
    for (const rel of listFilesRel(join(sourceDir, WORKFLOW_DIR))) {
      if (/^(devos-.*|ci)\.yml$/.test(rel)) files.push({ rel: `${WORKFLOW_DIR}/${rel}`, src: join(sourceDir, WORKFLOW_DIR, rel) });
    }
  }
  for (const rel of listFilesRel(join(sourceDir, 'devos', 'prompts'))) {
    files.push({ rel: `devos/prompts/${rel}`, src: join(sourceDir, 'devos', 'prompts', rel) });
  }
  return files;
}

export async function runUpgrade({ projectDir, sourceDir, version }) {
  const engineRoot = new URL('..', import.meta.url).pathname;
  const src = sourceDir || engineRoot;
  const v = version || JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version || '0.0.0';
  const branch = `devos/upgrade-${v}`;
  const added = [];
  try {
    const status = git(['status', '--porcelain'], projectDir);
    if (status.out.trim()) {
      return { ok: false, message: 'devos: upgrade needs a clean working tree. Commit or stash first.' };
    }
    const head = git(['rev-parse', 'HEAD'], projectDir).out.trim();
    git(['checkout', '-b', branch], projectDir, true); // may already exist from a previous run

    const hashesFile = join(projectDir, 'devos', 'engine-hashes.json');
    const baselines = existsSync(hashesFile) ? JSON.parse(readFileSync(hashesFile, 'utf8')) : {};

    const files = engineFilePaths(src);
    const updated = [];
    const conflicts = [];
    for (const f of files) {
      const dst = join(projectDir, f.rel);
      const newContent = readFileSync(f.src, 'utf8');
      const current = existsSync(dst) ? readFileSync(dst, 'utf8') : null;
      if (current !== null) {
        const currentHash = hash(current);
        const baseline = baselines[f.rel];
        const edited = baseline ? currentHash !== baseline : currentHash !== hash(newContent);
        if (edited && currentHash !== hash(newContent)) {
          conflicts.push(f.rel);
          continue;
        }
        if (currentHash === hash(newContent)) continue;
      } else {
        added.push(f.rel);
      }
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, newContent);
      updated.push(f.rel);
    }
    if (!updated.length && !added.length) {
      git(['checkout', head], projectDir, true);
      git(['branch', '-D', branch], projectDir, true);
      return { ok: true, message: `devos: engine files are already at ${v}.`, updated, conflicts };
    }

    // Refresh baselines for what we wrote so future edits are detected.
    const newBaselines = { ...baselines };
    for (const rel of [...updated, ...added]) {
      newBaselines[rel] = hash(readFileSync(join(projectDir, rel), 'utf8'));
    }
    mkdirSync(join(projectDir, 'devos'), { recursive: true });
    writeFileSync(hashesFile, JSON.stringify(newBaselines, null, 2));

    git(['add', '-A'], projectDir);
    const commit = git(['commit', '-m', `devos: upgrade engine files to ${v}`], projectDir, true);
    if (commit.code !== 0) throw new Error('commit failed');

    const lines = [`devos: upgrade to ${v} on branch ${branch}.`, `Updated ${updated.length + added.length} engine file(s).`];
    if (conflicts.length) {
      lines.push(`Conflicts (you edited these; left untouched): ${conflicts.join(', ')}`);
    }
    lines.push('Open the pull request when you are ready; engine files only.');
    return { ok: true, message: lines.join('\n'), updated, conflicts, branch };
  } catch (e) {
    // Rollback: restore the tree, delete files we added, delete the empty branch.
    try {
      const head = git(['rev-parse', 'HEAD'], projectDir).out.trim();
      git(['reset', '--hard', head], projectDir, true);
      for (const rel of added) {
        const p = join(projectDir, rel);
        if (existsSync(p)) rmSync(p);
      }
      git(['checkout', 'main'], projectDir, true);
      git(['branch', '-D', branch], projectDir, true);
    } catch { /* best effort */ }
    return { ok: false, message: 'devos: upgrade failed; rolled back, nothing changed.' };
  }
}
