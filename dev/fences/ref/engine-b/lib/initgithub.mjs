import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runToolSync } from './spawn.mjs';
import { readInitState, initStateFile, stateDir, readSecretsState } from './secret.mjs';
import { ensureGitignored } from './secretsflow.mjs';

function gh(args, cwd, allowFail = false) {
  // runToolSync avoids the deprecated args-array + shell:true spawn on Windows
  // and still runs npm-style .cmd shims there.
  const r = runToolSync('gh', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    const err = new Error(`gh ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
    err.exitCode = r.status;
    err.toolMessage = (r.stderr || r.stdout || '').trim();
    throw err;
  }
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

const REPO_NOT_FOUND_RE = /Could not resolve to a Repository|Not Found/i;

// `gh repo create` has NEVER had a --visibility flag (that is `gh repo edit`);
// every build accepts --public / --private instead. The user's run died exactly
// here: "unknown flag: --visibility" aborted both create attempts, so the
// repository never existed and main never got an origin. A third, flagless
// attempt is the last resort for any build that rejects even these (the
// account's default visibility applies).
function ghCreate(target, visibility, extra, cwd) {
  const visFlag = visibility === 'public' ? '--public' : '--private';
  let r = gh(['repo', 'create', target, visFlag, ...extra], cwd, true);
  if (r.code !== 0 && /unknown flag|flag provided|unrecognized/i.test((r.err || r.out || ''))) {
    r = gh(['repo', 'create', target, ...extra], cwd, true);
  }
  return r;
}

// Aim the origin remote at exactly this repository (add, or re-point if it is
// currently aimed somewhere else — e.g. a half-finished earlier attempt).
function aimRemote(projectDir, repoFull) {
  const url = `https://github.com/${repoFull}.git`;
  const remotes = git(['remote'], projectDir, true);
  if (/\borigin\b/.test(remotes.out)) {
    const shown = git(['remote', 'get-url', 'origin'], projectDir, true);
    if (shown.code !== 0 || !shown.out.includes(repoFull)) git(['remote', 'set-url', 'origin', url], projectDir);
  } else {
    git(['remote', 'add', 'origin', url], projectDir);
  }
}

// Push main, winning the unrelated-histories case: a hand-created repo holding
// an auto README rejects a plain push, so our commits are replayed on top of it
// with our project tree winning conflicts (-X theirs). The repo is never recreated.
function pushMain(projectDir) {
  let pushed = git(['push', '-u', 'origin', 'main'], projectDir, true);
  if (pushed.code !== 0) {
    const fetched = git(['fetch', 'origin', 'main'], projectDir, true);
    if (fetched.code === 0) {
      const rb = git(['rebase', '-X', 'theirs', 'origin/main'], projectDir, true);
      if (rb.code === 0) pushed = git(['push', '-u', 'origin', 'main'], projectDir, true);
      else git(['rebase', '--abort'], projectDir, true); // leave the tree as the model wrote it
    }
  }
  return pushed;
}

// The slug's owner is typed in the wizard and can differ from the account gh is
// actually signed in with — then "Could not resolve to a Repository" means the
// repo may live under the real login's namespace, or under a slightly different
// name. One local lookup pass (no writes):
//   1. gh api user -> the real login; if it differs, view <login>/<name>.
//   2. gh repo list -> a case/separator-insensitive name match.
// Returns the adoptable nameWithOwner, or null when nothing matches.
function findOwnedRepo({ repo, name, cwd }) {
  const me = gh(['api', 'user', '--jq', '.login'], cwd, true);
  let login = String(me.out || '').trim();
  if (login.startsWith('{')) {
    try { login = String(JSON.parse(login).login || ''); } catch { login = ''; }
  }
  if (login && !repo.startsWith(`${login}/`)) {
    const alt = `${login}/${name}`;
    const v = gh(['repo', 'view', alt, '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd, true);
    if (v.code === 0 && v.out.trim()) return v.out.includes('/') ? v.out.trim() : alt;
  }
  const list = gh(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner'], cwd, true);
  if (list.code === 0) {
    try {
      const rows = JSON.parse(list.out || '[]');
      const norm = (s) => String(s).toLowerCase().replace(/[-_.\s]+/g, '');
      const hit = rows.map((r) => r.nameWithOwner).find((n) => {
        const nm = String(n).split('/')[1] || '';
        return (nm && nm.toLowerCase() === name.toLowerCase()) || (nm && norm(nm) === norm(name));
      });
      if (hit) return hit;
    } catch { /* listing is best-effort */ }
  }
  return null;
}

function git(args, cwd, allowFail = false) {
  const r = runToolSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    const err = new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 400)}`);
    err.exitCode = r.status;
    err.toolMessage = (r.stderr || '').trim();
    throw err;
  }
  return { code: r.status, out: String(r.stdout || '') };
}

// Push the repaired tree when init_github has already completed. Repairs after
// the repository exists would otherwise live only on the developer's disk —
// init_github runs once — and the GitHub-side cycle would keep running against
// the stale tree. Same adopt-the-remote, win-unrelated-histories push as init.
// The refspec is HEAD:main ON PURPOSE: the repair commit lands on whatever
// branch the checkout happens to be on, and `push origin main` would then ship
// a STALE main while the report said "repaired and pushed" (the field failure
// that kept the same red round repeating). HEAD:main always ships the current
// commits to the branch the cycle dispatch runs.
export function syncRepoPush({ projectDir }) {
  // The local values file may exist by now — it must never ride along a push.
  ensureGitignored(projectDir);
  git(['add', '-A'], projectDir);
  git(['commit', '-m', 'devos: sync the repaired bootstrap to the repository', '--allow-empty'], projectDir, true);
  const pushed = pushHeadToMain(projectDir);
  if (pushed.code !== 0) {
    const err = new Error(`git push failed (exit ${pushed.code}): ${((pushed.stderr || pushed.out || '')).trim().slice(0, 300)}`);
    err.exitCode = pushed.code || 1;
    err.toolMessage = 'Pushing the repaired tree to the repository was rejected. Check the remote state of the repository, then run devos continue again — the sync retries itself.';
    throw err;
  }
  return true;
}

// push origin HEAD:main, winning the unrelated-histories case the same way
// pushMain does (fetch + rebase -X theirs, our tree wins). No -u: the upstream
// of the CURRENT branch is not this function's business.
function pushHeadToMain(projectDir) {
  let pushed = git(['push', 'origin', 'HEAD:main'], projectDir, true);
  if (pushed.code !== 0) {
    const fetched = git(['fetch', 'origin', 'main'], projectDir, true);
    if (fetched.code === 0) {
      const rb = git(['rebase', '-X', 'theirs', 'origin/main'], projectDir, true);
      if (rb.code === 0) pushed = git(['push', 'origin', 'HEAD:main'], projectDir, true);
      else git(['rebase', '--abort'], projectDir, true); // leave the tree as the model wrote it
    }
  }
  return pushed;
}

// init_github — the only GitHub write of the configuration stage. Uses the developer's
// existing gh login. Creates the repo at the chosen visibility, pushes main, writes
// repository variables for active modules, dispatches devos-cycle, opens the setup issue.
export function runInitGithub({ projectDir }) {
  const existing = readInitState(projectDir);
  if (existing && existing.status === 'done') {
    const err = new Error('init_github has already run for this project. It runs once.');
    err.alreadyDone = true;
    throw err;
  }
  const answers = JSON.parse(readFileSync(join(projectDir, 'devos', 'answers.json'), 'utf8'));
  const [owner, slug] = String(answers.project.slug).split('/');
  const repo = `${owner}/${slug}`;
  const visibility = answers.project.visibility === 'public' ? 'public' : 'private';

  mkdirSync(stateDir(projectDir), { recursive: true });
  writeFileSync(initStateFile(projectDir), JSON.stringify({ status: 'running', repo, startedAt: new Date().toISOString() }, null, 2));

  try {
    return runGithubFlow();
  } catch (e) {
    // Leave an honest state behind: 'running' would make later phases poll for
    // a completion that never came, and assess would say nothing useful.
    try { writeFileSync(initStateFile(projectDir), JSON.stringify({ status: 'error', repo, error: String(e.toolMessage || e.message).slice(0, 300), at: new Date().toISOString() }, null, 2)); } catch { /* the throw below still stands */ }
    throw e;
  }

  function runGithubFlow() {
  if (!existsSync(join(projectDir, '.git'))) git(['init', '-b', 'main'], projectDir);
  // The local values file may already hold pasted keys — gitignore it BEFORE
  // the first add, so a value can never enter the bootstrap commit.
  ensureGitignored(projectDir);
  git(['add', '-A'], projectDir);
  const commit = git(['commit', '-m', 'devos: bootstrap from the configuration stage', '--allow-empty'], projectDir, true);
  if (commit.code !== 0 && !/nothing to commit/.test(commit.out)) {
    // commit may fail only because there is nothing to commit; anything else is real
  }

  let repoFull = repo;
  let adoptedFrom = null;
  const created = ghCreate(repo, visibility, ['--source', projectDir, '--remote', 'origin', '--push'], projectDir);
  if (created.code !== 0) {
    const createError = ((created.err || created.out || '')).trim();
    // The repository already exists (created by hand, or by a half-finished earlier
    // attempt): adopt it — verify it is visible, aim the remote, push main.
    const view = gh(['repo', 'view', repoFull, '--json', 'nameWithOwner', '-q', '.nameWithOwner'], projectDir, true);
    if (view.code === 0) {
      aimRemote(projectDir, repoFull);
      finishPush(projectDir, repoFull, { stderr: (pushed) => `git push to ${repoFull} failed (exit ${pushed.code}): ${(pushed.stderr || pushed.out || '').trim().slice(0, 400)}` });
    } else if (REPO_NOT_FOUND_RE.test(view.err || view.out || '')) {
      // gh cannot resolve the name at all: the repo lives under a different
      // owner/name, or does not exist yet. Find it and adopt it, or create it
      // for real. "Could not resolve" must never dead-end the setup.
      const found = findOwnedRepo({ repo: repoFull, name: slug, cwd: projectDir });
      if (found) {
        adoptedFrom = repoFull;
        repoFull = found;
        aimRemote(projectDir, repoFull);
        finishPush(projectDir, repoFull, { stderr: (pushed) => `git push to ${repoFull} failed (exit ${pushed.code}): ${(pushed.stderr || pushed.out || '').trim().slice(0, 400)}` });
      } else {
        const retry = ghCreate(repoFull, visibility, [], projectDir);
        if (retry.code !== 0) {
          const err = new Error(`gh repo create failed twice — first: ${createError.slice(0, 200)}; retry: ${((retry.err || retry.out || '')).trim().slice(0, 200)}`);
          err.exitCode = retry.code || 1;
          err.toolMessage = [
            `The repository ${repoFull} could not be found and could not be created.`,
            `First create said: ${createError.slice(0, 160)}`, `Retry said: ${((retry.err || retry.out || '')).trim().slice(0, 160)}.`,
            'Check gh auth (gh auth status), the token scopes (repo, workflow), and that the account in the project slug is the one gh is signed in with.',
            'Then run devos continue again — the engine retries this itself.',
          ].join(' ');
          throw err;
        }
        aimRemote(projectDir, repoFull);
        finishPush(projectDir, repoFull, { stderr: (pushed) => `git push to ${repoFull} failed (exit ${pushed.code}): ${(pushed.stderr || pushed.out || '').trim().slice(0, 400)}` });
      }
    } else {
      // The view failed for another reason (auth, network). Say both messages.
      const err = new Error(`gh repo view ${repoFull} failed (exit ${view.code}): ${((view.err || view.out || '')).trim().slice(0, 200)}`);
      err.exitCode = view.code || 1;
      err.toolMessage = [
        `The repository state could not be checked after the create attempt failed.`,
        `Create said: ${createError.slice(0, 160)}. View said: ${((view.err || view.out || '')).trim().slice(0, 160)}.`,
        'Check gh auth (gh auth status), then run devos continue again — the engine retries this itself.',
      ].join(' ');
      throw err;
    }
  }

  const activeModules = Object.entries(answers.modules).filter(([, v]) => v.on).map(([k]) => k).join(',');
  gh(['variable', 'set', 'DEVOS_ACTIVE_MODULES', '--body', activeModules, '--repo', repoFull], projectDir);
  gh(['variable', 'set', 'DEVOS_TYPE', '--body', answers.type, '--repo', repoFull], projectDir);
  gh(['variable', 'set', 'DEVOS_FRAMEWORK', '--body', answers.framework, '--repo', repoFull], projectDir);

  gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repoFull, '--ref', 'main'], projectDir);

  // Setup issue: names of secrets still missing. Names only, never values.
  let setupIssueUrl = null;
  const secrets = readSecretsState(projectDir);
  const missing = Object.entries(secrets.entries || {}).filter(([, v]) => v.status !== 'set').map(([k]) => k);
  if (missing.length) {
    const body = ['The configuration stage needs these secret values. Type them with `gh secret set NAME --repo ' + repoFull + '`:',
      '', ...missing.map((m) => `- ${m}`), '',
      'When done, re-run the devos-cycle workflow or push to main.'].join('\n');
    const issue = gh(['issue', 'create', '--title', 'Dev OS: setup needed', '--body', body, '--repo', repoFull], projectDir, true);
    if (issue.code === 0) setupIssueUrl = issue.out.trim().split('\n').pop();
  }

  const runList = gh(['run', 'list', '--workflow', 'devos-cycle.yml', '--limit', '1', '--repo', repoFull, '--json', 'url', '-q', '.[0].url'], projectDir, true);
  const runUrl = runList.out.trim();

  // Record the repository in devos/project.json so devos status can find cycle runs.
  const projPath = join(projectDir, 'devos', 'project.json');
  if (existsSync(projPath)) {
    try {
      const cfg = JSON.parse(readFileSync(projPath, 'utf8'));
      cfg.repo = repoFull;
      writeFileSync(projPath, JSON.stringify(cfg, null, 2));
    } catch { /* keep going; status falls back to the init state */ }
  }

  const finalState = {
    status: 'done',
    repo: repoFull,
    repoUrl: `https://github.com/${repoFull}`,
    actionsUrl: `https://github.com/${repoFull}/actions`,
    setupIssueUrl,
    runUrl,
    visibility,
    dispatchedAt: new Date().toISOString(),
  };
  if (adoptedFrom) finalState.adoptedFrom = adoptedFrom;
  writeFileSync(initStateFile(projectDir), JSON.stringify(finalState, null, 2));
  return finalState;
  }

  // pushMain + one clear error shape; kept as a named helper so all three paths
  // (adopt as named, adopt under another name, after a fresh create) share it.
  function finishPush(dir, repoName, { stderr }) {
    const pushed = pushMain(dir);
    if (pushed.code !== 0) {
      const err = new Error(stderr(pushed));
      err.exitCode = pushed.code || 1;
      err.toolMessage = `Pushing main to the existing repository ${repoName} was rejected. Check the branch protection or remote state of github.com/${repoName}, then run devos continue again.`;
      throw err;
    }
  }
}
