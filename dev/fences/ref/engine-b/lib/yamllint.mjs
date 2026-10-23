// Minimal structural YAML lint, no dependencies. It is enough for the guard's purpose:
// workflow files must parse, block scalars must be indented, and no step body may sit at
// column 0 inside a run: | block. A full YAML parser is deliberately not bundled.
export function lintYaml(text, file = 'workflow.yml') {
  const problems = [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let inBlockScalar = false;
  let blockIndent = 0;
  let blockKey = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes('\t')) problems.push(`${file}:${i + 1}: tab character in YAML`);
    const line = raw.replace(/\r$/, '');
    if (inBlockScalar) {
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent < blockIndent) {
        if (indent === 0) problems.push(`${file}:${i + 1}: step body sits at column 0 inside a ${blockKey} block`);
        inBlockScalar = false;
        // fall through to normal handling below
      } else {
        continue;
      }
    }
    const m = line.match(/^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+|["'][^"']+["'])(\s*):(\s*\|[-+]?|\s*>[-+]?)?\s*$/u) ||
              line.match(/^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+|["'][^"']+["'])(\s*):(\s*\|[-+]?\s*#.*)?$/u);
    if (m && (m[4] || '').trim().startsWith('|')) {
      inBlockScalar = true;
      blockKey = m[2];
      blockIndent = m[1].length + 1; // body must be deeper than the key line's content start
      continue;
    }
    if (/^\S/.test(line) && !/^[A-Za-z0-9_"'-]+:/.test(line) && line.trim() !== '---' && !line.startsWith('#')) {
      problems.push(`${file}:${i + 1}: unexpected top-level content: ${line.slice(0, 40)}`);
    }
  }
  return problems;
}

export function lintWorkflowFiles(files) {
  // files: [{path, content}]
  const out = [];
  for (const f of files) out.push(...lintYaml(f.content, f.path));
  return out;
}
