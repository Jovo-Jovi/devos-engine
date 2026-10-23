import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

// Collects the documentation the user attaches at the Project step.
// Text formats only; binary formats are skipped with a note, never guessed at.
const OK_EXT = new Set(['.md', '.markdown', '.txt', '.text', '.rst', '.adoc', '.csv', '.tsv', '.json', '.yaml', '.yml', '.log', '.html', '.xml', '.tex']);
const SKIP_EXT = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.exe', '.bin']);

export function collectDocs(input, { limit = 8, charLimit = 120_000 } = {}) {
  const out = { docs: [], skipped: [], errors: [] };
  let p = String(input || '').trim().replace(/^"|"$/g, '');
  if (!p) return out;
  let st;
  try { st = statSync(p); } catch { out.errors.push(`${p} does not exist.`); return out; }

  const files = [];
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      try { if (statSync(full).isFile()) files.push(full); } catch { /* unreadable entry */ }
    }
  } else {
    files.push(p);
  }

  for (const f of files) {
    if (out.docs.length >= limit) { out.skipped.push(`${basename(f)} (file limit ${limit} reached)`); continue; }
    const ext = extname(f).toLowerCase();
    if (SKIP_EXT.has(ext)) { out.skipped.push(`${basename(f)} (binary format — export it as .md or .txt first)`); continue; }
    if (ext && !OK_EXT.has(ext)) { out.skipped.push(`${basename(f)} (not a text format)`); continue; }
    try {
      const content = readFileSync(f, 'utf8');
      if (!content.trim()) { out.skipped.push(`${basename(f)} (empty)`); continue; }
      out.docs.push({ name: basename(f), size: Math.min(content.length, charLimit), content: content.slice(0, charLimit), truncated: content.length > charLimit });
    } catch (e) {
      out.errors.push(`${basename(f)}: ${e.message}`);
    }
  }
  return out;
}
