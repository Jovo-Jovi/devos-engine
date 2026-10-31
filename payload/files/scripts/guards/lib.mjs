// Shared helpers for the guards (Dev OS v2 §8). Dependency-free.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = (...p) => join(ROOT, ...p);
export const read = (rel) => readFileSync(P(rel), "utf8");
export const exists = (rel) => existsSync(P(rel));

/** Repository files that git would commit (tracked + untracked, minus ignored). */
export function repoFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
    return out.split("\0").filter(Boolean).filter((f) => existsSync(P(f)));
  } catch {
    return walk("").filter((f) => !/^(node_modules|\.next|\.git|\.devos)\//.test(f));
  }
}

export function walk(relDir) {
  const abs = P(relDir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === ".git") continue;
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(P(rel));
    if (st.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

export const srcFiles = (exts) => repoFiles().filter((f) => f.startsWith("src/") && exts.some((e) => f.endsWith(e)));
export const hasSrc = () => exists("src");

export const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** Scan files line by line with regexes. Returns findings "file:line — label: excerpt". */
export function scan(files, rules, { skipComments = true } = {}) {
  const findings = [];
  for (const f of files) {
    const lines = read(f).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (skipComments && isComment(line)) return;
      for (const { re, label } of rules) {
        re.lastIndex = 0;
        if (re.test(line)) findings.push(`${f}:${i + 1} — ${label}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return findings;
}

export const result = (status, findings = [], note = "") => ({ status, findings, note });
export { relative, sep };

// ---------- The baseline of a project DEV_OS was added to (PR-68, D-E13) ----------
// `devos/baseline.json` holds the findings of the code that existed when DEV_OS was added, for these guards only.
// A finding it holds is known: the same guard, file, rule and line text, up to its count, wherever the line moved.
// Every other finding fails as before, so new or changed code must pass. secrets, boundary, data, services and the
// method's own guards are never baselined.
export const BASELINE_FILE = "devos/baseline.json";
export const BASELINE_SCHEMA = "devos-baseline/1";
export const BASELINE_GUARDS = ["naming", "design", "i18n", "literals", "imports"];

/** A finding without its line number ("src/a.ts:12 — x" → "src/a.ts — x"). */
export const fingerprint = (finding) => String(finding).replace(/^(\S+?):\d+ — /, "$1 — ");

/** The project's baseline: null when there is none, { error } when it cannot be used. */
export function readBaseline() {
  if (!exists(BASELINE_FILE)) return null;
  let data;
  try {
    data = JSON.parse(read(BASELINE_FILE));
  } catch (e) {
    return { error: `${BASELINE_FILE} is not valid JSON: ${e.message}` };
  }
  if (!data || data.schema !== BASELINE_SCHEMA || !data.guards || typeof data.guards !== "object" || Array.isArray(data.guards)) {
    return { error: `${BASELINE_FILE} is not a ${BASELINE_SCHEMA} baseline` };
  }
  for (const [name, entries] of Object.entries(data.guards)) {
    if (!BASELINE_GUARDS.includes(name)) return { error: `${BASELINE_FILE} holds findings of ${name}, which are never baselined` };
    if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.values(entries).some((n) => !Number.isInteger(n) || n < 1)) {
      return { error: `${BASELINE_FILE} ${name}: every entry needs a count of 1 or more` };
    }
  }
  return data;
}

function counts(findings) {
  const out = {};
  for (const f of findings) out[fingerprint(f)] = (out[fingerprint(f)] ?? 0) + 1;
  return out;
}

/** True when a guard did not run to the end: its findings say nothing about the code. */
export const crashed = (r) => Boolean(r) && r.findings.some((f) => String(f).startsWith("guard crashed:"));

/**
 * A new baseline from the guards' results: their findings, by guard and fingerprint, for the baselined guards. A
 * guard that crashed is left out, so it keeps failing until it runs.
 */
export function baselineFrom(results, written) {
  const guards = {};
  for (const name of BASELINE_GUARDS) {
    const r = results[name];
    if (r?.status !== "FAIL" || crashed(r)) continue;
    if (r.findings.length > 0) guards[name] = counts(r.findings);
  }
  return {
    schema: BASELINE_SCHEMA,
    $comment: "Written once, when DEV_OS was added to this project. It only shrinks: node scripts/guards/run-all.mjs --shrink-baseline. Never edit it by hand.",
    written,
    guards,
  };
}

/** The results with known findings accepted: a guard whose every finding is known passes, noting how many. */
export function applyBaseline(results, baseline) {
  const out = {};
  for (const [name, r] of Object.entries(results)) {
    const known = baseline.guards[name];
    if (!known || r.status !== "FAIL") {
      out[name] = r;
      continue;
    }
    const left = { ...known };
    const fresh = [];
    let accepted = 0;
    for (const f of r.findings) {
      const key = fingerprint(f);
      if ((left[key] ?? 0) > 0) {
        left[key] -= 1;
        accepted += 1;
      } else fresh.push(f);
    }
    const note = `${accepted} known (baseline)${r.note ? `; ${r.note}` : ""}`;
    out[name] = { status: fresh.length > 0 ? "FAIL" : "PASS", findings: fresh, note };
  }
  return out;
}

/** The baseline without what is fixed: each count drops to what the guards still find, and nothing is added. */
export function shrinkBaseline(baseline, results) {
  const guards = {};
  let removed = 0;
  for (const [name, known] of Object.entries(baseline.guards)) {
    const found = counts(results[name]?.status === "FAIL" ? results[name].findings : []);
    const kept = {};
    for (const [key, n] of Object.entries(known)) {
      const still = Math.min(n, found[key] ?? 0);
      removed += n - still;
      if (still > 0) kept[key] = still;
    }
    if (Object.keys(kept).length > 0) guards[name] = kept;
  }
  return { baseline: { ...baseline, guards }, removed };
}
