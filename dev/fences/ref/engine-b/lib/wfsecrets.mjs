// Workflow secret-mapping proof and repair. Why this exists: a fresh cycle run
// kept failing with every key EMPTY even though `gh secret list` showed the keys
// set — the model-written workflow in the repository mapped the agent credentials
// on the wrong step (or not at all), so the runner saw UNDEFINED env vars and the
// agent CLIs died on their own auth wall. The engine now applies its detect →
// report → fix philosophy to the workflow file itself: it reads the repository's
// own devos-cycle.yml, proves which SELECTED keys the workflow actually maps,
// and repairs the mapping deterministically — a top-level `env:` block is the
// one scope every step inherits (echo, checks, cycle script, builder, reviewer).
// Names and mapping lines only — a secret VALUE never appears here or anywhere.
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolSync } from './spawn.mjs';

// The engine's own copy of the project template (workflows + runner scripts).
// Shipped inside the engine package, so an installed engine can upgrade an
// existing project's automation in place.
export function engineTemplateDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'payload', 'modules', 'automation', 'template');
}

// The v2 marker: the five-step cycle workflow (resolve → build → checks →
// review → verdict) and its phase runner. A repository whose cycle workflow
// lacks the marker still runs the old single-step "Run node
// scripts/devos/cycle.mjs" — one opaque step, no PR comments, no statuses.
// That is exactly what the field saw on the tinytasks repo ("only this
// appears… no details appears in any pr or issue").
const CYCLE_V2_MARK = 'devos:cycle-v2';

export function cycleWorkflowIsV2(projectDir) {
  const text = readTextOrNull(cycleWorkflowPath(projectDir));
  return Boolean(text && text.includes(CYCLE_V2_MARK));
}

function readTextOrNull(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

// The cycle-v2 upgrade: sync the engine template's cycle workflow and runner
// scripts into an existing project, then let the normal secret repair narrow
// the echo to the selected keys. Engine-managed files only — prompts, fences,
// docs/PHASES.md and anything the product owns are never touched. Deterministic
// and idempotent: a v2 project is left exactly as it is.
export function syncCycleV2(projectDir, { say = () => {} } = {}) {
  const local = readTextOrNull(cycleWorkflowPath(projectDir));
  if (local == null) return { changed: false, files: [], reason: 'no cycle workflow in the project tree' };
  if (local.includes(CYCLE_V2_MARK)) return { changed: false, files: [] };
  const tpl = engineTemplateDir();
  const pairs = [
    { from: join(tpl, '.github', 'workflows', 'devos-cycle.yml'), to: cycleWorkflowPath(projectDir) },
    { from: join(tpl, 'scripts', 'devos', 'cycle.mjs'), to: join(projectDir, 'scripts', 'devos', 'cycle.mjs') },
    { from: join(tpl, 'scripts', 'devos', 'common.mjs'), to: join(projectDir, 'scripts', 'devos', 'common.mjs') },
  ];
  const files = [];
  for (const p of pairs) {
    if (!existsSync(p.from)) return { changed: false, files: [], reason: `the engine template is missing ${p.from}` };
    mkdirSync(dirname(p.to), { recursive: true });
    copyFileSync(p.from, p.to);
    files.push(p.to);
  }
  say('The cycle workflow was one opaque step ("Run node scripts/devos/cycle.mjs") — upgraded to the full structure the reference build uses: separate Builder / Checks / Review / Verdict steps in the run, a pull request per attempt with the builder outcome, the checks and the verdict as comments, devos/checks + devos/verdict statuses, and a per-minute heartbeat while the builder or reviewer works. No key or value was touched.');
  return { changed: true, files };
}

const CYCLE_REL = join('.github', 'workflows', 'devos-cycle.yml');

export function cycleWorkflowPath(projectDir) {
  return join(projectDir, ...CYCLE_REL.split('/'));
}

export function workflowsDir(projectDir) {
  return join(projectDir, '.github', 'workflows');
}

// The top-level `env:` block of a workflow (column-0 `env:`), as { name, line }
// entries. Nested (job/step) env blocks are ignored — they do not reach every
// step, which is exactly the bug this module repairs.
export function topLevelEnvMappings(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^env:\s*(#.*)?$/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (m) { out.push({ name: m[1], line }); continue; }
    break; // a less-indented line ends the top-level env block
  }
  return out;
}

// The mapping lines a top-level env block needs for `names`, minus the ones
// already mapped. Returned ready to paste at 2-space indent.
function missingEnvLines(text, names) {
  const have = new Set(topLevelEnvMappings(text).map((m) => m.name));
  return names.filter((n) => !have.has(n)).map((n) => `  ${n}: \${{ secrets.${n} }}`);
}

// Ensure every name is mapped from its own repository secret at the TOP level,
// so every step of every job inherits it. Additive and idempotent: existing
// top-level mappings are respected, nested ones stay (same value anyway).
// Returns { text, changed, added } — changed=false when nothing was missing
// or the file has no top-level `jobs:` anchor to insert before.
export function ensureTopLevelEnvMappings(text, names) {
  const src = String(text || '');
  if (!names.length) return { text: src, changed: false, added: [] };
  const add = missingEnvLines(src, names);
  if (!add.length) return { text: src, changed: false, added: [] };
  const lines = src.split('\n');
  const envIdx = lines.findIndex((l) => /^env:\s*(#.*)?$/.test(l));
  if (envIdx >= 0) {
    // extend the existing top-level block: after its last 2-space-indented entry
    let last = envIdx;
    for (let i = envIdx + 1; i < lines.length; i++) {
      if (!lines[i].trim() || /^\s*#/.test(lines[i])) continue;
      if (/^ {2}[A-Za-z_][A-Za-z0-9_]*:/.test(lines[i])) last = i; else break;
    }
    lines.splice(last + 1, 0, ...add);
    return { text: lines.join('\n'), changed: true, added: add.map((l) => l.trim().split(':')[0]) };
  }
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsIdx < 0) return { text: src, changed: false, added: [] };
  lines.splice(jobsIdx, 0, 'env:', ...add, '');
  return { text: lines.join('\n'), changed: true, added: add.map((l) => l.trim().split(':')[0]) };
}

// A caller of devos-cycle via `uses:` gets NO secrets unless it passes
// `secrets: inherit` (GitHub does not forward them). Find every such step and
// insert the line when the step has no `secrets:` of its own.
export function ensureSecretsInherit(text, callee = 'devos-cycle.yml') {
  const src = String(text || '');
  const lines = src.split('\n');
  const usesRe = new RegExp(`^(\\s*)(?:-\\s+)?uses:\\s*\\./\\.github/workflows/${callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const out = [];
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = usesRe.exec(line);
    if (!m) continue;
    // `uses:` sits at the item's key column: the `-` dash column + 2. A
    // sibling key (`with:`, `secrets:`) lives at that same column.
    const isItem = /^(\s*)-\s/.test(line);
    const keyIndent = m[1].length + (isItem ? 2 : 0);
    const indent = ' '.repeat(keyIndent);
    // scan the step's remaining keys: stop at a line indented less than keyIndent
    let hasSecrets = false;
    for (let j = i + 1; j < lines.length; j++) {
      const l2 = lines[j];
      if (!l2.trim() || /^\s*#/.test(l2)) continue;
      const ind = l2.match(/^\s*/)[0].length;
      if (ind < keyIndent) break;
      if (new RegExp(`^\\s{${keyIndent}}secrets\\s*:`).test(l2)) { hasSecrets = true; break; }
    }
    if (!hasSecrets) {
      out.push(`${indent}secrets: inherit`);
      changed += 1;
    }
  }
  return changed ? { text: out.join('\n'), changed: true, fixed: changed } : { text: src, changed: false, fixed: 0 };
}

// The engine-managed key-echo step. Why it exists: a failed run's log is the
// only witness of WHICH keys the run actually saw — GitHub masks a present
// value to *** and an unset one prints empty. The model-written workflow's own
// echo (when it has one) can go stale and omit a key the builder needs
// (CURSOR_API_KEY was missing from the field workflow's echo while the builder
// died on its own auth wall) — so the engine inserts its OWN echo step, marked
// and idempotent, listing exactly the selected keys. The next failed run's log
// then proves presence or emptiness for every key that matters here.
const ECHO_MARK = 'devos:key-echo';

export function keyEchoStepText(indent, names) {
  const dash = `${indent}- `;
  return [
    `${dash}name: Key presence (devos)`,
    `${indent}  # ${ECHO_MARK} (engine-managed — devos repairs this step; names only, every value that is present is masked by GitHub)`,
    `${indent}  if: always()`,
    `${indent}  run: |`,
    ...names.map((n) => `${indent}    echo "${n}: $${n}"`),
  ];
}

export function ensureKeyEchoStep(text, names) {
  const src = String(text || '');
  if (!names.length) return { text: src, changed: false, names: [] };
  const lines = src.split('\n');
  const markIdx = lines.findIndex((l) => l.includes(ECHO_MARK));
  if (markIdx >= 0) {
    // Rewrite the existing engine-managed step to the current names. The
    // marker comment sits one level UNDER the step's `- name:` line, so the
    // nearest LIST ITEM above the marker carries the dash indent — and the
    // replaced block starts AT that name line (keyEchoStepText re-emits it).
    let nameIdx = -1;
    let dashIndent = null;
    for (let i = markIdx; i >= 0 && i > markIdx - 6; i--) {
      const m = lines[i].match(/^(\s*)- /);
      if (m) { nameIdx = i; dashIndent = m[1]; break; }
    }
    if (nameIdx < 0) return { text: src, changed: false, names: [] };
    let end = lines.length;
    for (let i = markIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      // A sibling list item (indent == dash column) or a less-indented line
      // ends this step's block.
      if (l.match(/^\s*/)[0].length <= dashIndent.length) { end = i; break; }
    }
    const out = [...lines.slice(0, nameIdx), ...keyEchoStepText(dashIndent, names), ...lines.slice(end)].join('\n');
    return { text: out, changed: out !== src, names: [...names] };
  }
  // Insert after the checkout step (the workflow's first real step) so the echo
  // runs before anything that can fail. The checkout can be written two ways —
  // the dash and `uses:` on one line, or the conventional form with `- name:`
  // and `uses:` on separate lines. The FIELD workflow used the conventional
  // form, the one-line regex missed it, and the echo step was never inserted
  // (the run log kept proving nothing about the selected keys). Find the
  // `uses:` line either way, then walk UP to the step's dash line.
  let co = lines.findIndex((l) => /^\s*-\s+uses:\s*actions\/checkout/i.test(l));
  if (co < 0) {
    const usesIdx = lines.findIndex((l) => /^\s*uses:\s*actions\/checkout/i.test(l));
    if (usesIdx >= 0) {
      // The step's dash line: the nearest line above with a list dash.
      for (let i = usesIdx; i >= 0 && i > usesIdx - 6; i--) {
        if (/^\s*-\s/.test(lines[i])) { co = i; break; }
      }
    }
  }
  if (co < 0) return { text: src, changed: false, names: [] };
  const dashIndent = lines[co].match(/^(\s*)- /)[1];
  let insertAt = lines.length;
  for (let i = co + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= dashIndent.length) { insertAt = i; break; }
  }
  lines.splice(insertAt, 0, ...keyEchoStepText(dashIndent, names));
  return { text: lines.join('\n'), changed: true, names: [...names] };
}

// The proof: which SELECTED keys does the repository's cycle workflow map at
// top level, and which callers would strip the secrets on the way in?
export function workflowSecretReport(projectDir, names) {
  const path = cycleWorkflowPath(projectDir);
  if (!existsSync(path)) return { readable: false, reason: `${CYCLE_REL} is not in the project tree`, path };
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    return { readable: false, reason: `could not read ${CYCLE_REL}: ${e.message}`, path };
  }
  const mapped = new Set(topLevelEnvMappings(text).map((m) => m.name));
  const missing = names.filter((n) => !mapped.has(n));
  const callers = [];
  const dir = workflowsDir(projectDir);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!/\.ya?ml$/.test(f) || f === 'devos-cycle.yml') continue;
      const p = join(dir, f);
      let t = '';
      try { t = readFileSync(p, 'utf8'); } catch { continue; }
      if (new RegExp(`uses:\\s*\\./\\.github/workflows/devos-cycle\\.yml`).test(t)) {
        const r = ensureSecretsInherit(t);
        if (r.changed) callers.push({ file: f, path: p, text: r.text });
      }
    }
  }
  return { readable: true, path, text, missing, callers };
}

// The repair: patch the cycle workflow (top-level env for every missing SELECTED
// key, plus the engine-managed key-echo step so the run log always proves which
// keys it saw) and every caller (secrets: inherit), write the files, and say
// what was done. Deterministic, additive, idempotent — no model, no values.
export function repairWorkflowSecrets(projectDir, names, { say = () => {} } = {}) {
  if (!names.length) return { changed: false, added: [], echoAdded: false, inheritFixed: 0, files: [] };
  const report = workflowSecretReport(projectDir, names);
  if (!report.readable) {
    say(`The cycle workflow could not be checked (${report.reason}) — if the next run still sees keys as empty, devos upgrade refreshes the engine files.`);
    return { changed: false, added: [], echoAdded: false, inheritFixed: 0, files: [], reason: report.reason };
  }
  const files = [];
  let added = [];
  let echoAdded = false;
  let inheritFixed = 0;
  let text = report.text;
  if (report.missing.length) {
    const r = ensureTopLevelEnvMappings(text, report.missing);
    if (r.changed) {
      text = r.text;
      added = r.added;
      say(`The cycle workflow did not map ${r.added.join(', ')} for every step — mapped them at the top level now (each from its own GitHub secret; a value is never written).`);
    }
  }
  const echo = ensureKeyEchoStep(text, names);
  if (echo.changed) {
    text = echo.text;
    echoAdded = true;
    say(`The workflow's run log now echoes every selected key (${names.join(', ')}) — the next run's log proves which keys it saw; GitHub masks every value that is present.`);
  }
  if (text !== report.text) {
    writeFileSync(report.path, text);
    files.push(report.path);
  }
  for (const c of report.callers) {
    writeFileSync(c.path, c.text);
    files.push(c.path);
    inheritFixed += 1;
    say(`${c.file} calls devos-cycle without passing secrets — added "secrets: inherit" so the called run receives the keys.`);
  }
  return { changed: files.length > 0, added, echoAdded, inheritFixed, files };
}

// The proof AFTER the push: read the cycle workflow back FROM GITHUB and check
// that what the next run will actually execute carries every selected key's
// top-level mapping and the engine-managed echo. Why this exists: "repaired and
// pushed" was claimed from the local git exit code while the run kept using the
// old workflow (a push that landed elsewhere, a stale local main, a raced
// dispatch) — the same red round repeated while the report said fixed. A push
// is only real when GitHub's own copy says so. Names only — the content is
// mapping lines, never a value.
export function verifyWorkflowOnGithub({ repo, projectDir, names, ref = 'main', run = null }) {
  const rel = '.github/workflows/devos-cycle.yml';
  const args = ['api', `repos/${repo}/contents/${rel}?ref=${ref}`, '--jq', '.content'];
  let out;
  try {
    const r = runToolSync('gh', args, { cwd: projectDir, encoding: 'utf8', timeout: 25_000 });
    if (r.status !== 0) {
      return { checked: false, ok: false, reason: `gh api could not read ${rel} from ${ref} (${String(r.stderr || r.stdout || '').trim().slice(0, 160)})` };
    }
    out = String(r.stdout || '');
  } catch (e) {
    return { checked: false, ok: false, reason: `gh api could not read ${rel} from ${ref} (${e.message})` };
  }
  let text = '';
  try {
    const b64 = String(out).trim().replace(/\s+/g, '');
    text = Buffer.from(b64, 'base64').toString('utf8');
  } catch (e) {
    return { checked: false, ok: false, reason: `the workflow content from GitHub could not be decoded (${e.message})` };
  }
  if (!/^\s*name:\s*devos-cycle/m.test(text) && !text.includes('devos-cycle')) {
    return { checked: true, ok: false, missingMapped: [...names], echoMissing: [...names], text };
  }
  const mapped = new Set(topLevelEnvMappings(text).map((m) => m.name));
  const missingMapped = names.filter((n) => !mapped.has(n));
  // The engine-managed echo must name every selected key.
  const markIdx = text.indexOf(ECHO_MARK);
  let echoMissing = [...names];
  if (markIdx >= 0) {
    const echoed = new Set([...text.slice(markIdx).matchAll(/echo "([A-Z][A-Z0-9_]*): /g)].map((m) => m[1]));
    echoMissing = names.filter((n) => !echoed.has(n));
  }
  return { checked: true, ok: missingMapped.length === 0 && echoMissing.length === 0, missingMapped, echoMissing, text };
}
