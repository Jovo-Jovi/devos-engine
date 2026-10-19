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
