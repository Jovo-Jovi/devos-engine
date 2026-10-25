#!/usr/bin/env node
// The fence's machine-read parts, checked the same way whatever agent wrote it (PR-58). Every agent
// that writes a fence (the blueprint, the reviewer, intake, revise) runs it and fixes every finding;
// the builder runs it before its first edit and HALTs on a finding (a fence defect is the
// reviewer's, PR-09); `guard:fences` runs it on the fence of the task being built.
//
// Usage: node scripts/devos/fence-check.mjs docs/fences/T07.md [more fences] [--json]
// Prints each finding, then `fence-check: <path> OK` or `fence-check: <path> N finding(s)`; exits 1 on any.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { P, config, globToRegExp, matchesAny } from "./lib.mjs";
import { isMethodFence, layerNames } from "./skills.mjs";

export const EFFORTS = ["low", "medium", "high", "xhigh"];
// devos-fence-writing §1: one builder run holds about 12 Done-when items and 12 files.
export const ONE_RUN = 12;
// What a task may always change besides its Paths (guard:scope).
export const ALWAYS_ALLOWED = (task) => [`docs/reports/${task}.md`, "docs/SESSION_CONTEXT.md", "docs/DEVELOPMENT_JOURNAL.md"];
// A lockfile may change with the manifest beside it.
export const LOCKFILES = {
  "pnpm-lock.yaml": "package.json",
  "package-lock.json": "package.json",
  "yarn.lock": "package.json",
  "uv.lock": "pyproject.toml",
  "poetry.lock": "pyproject.toml",
  "go.sum": "go.mod",
  "pubspec.lock": "pubspec.yaml",
};

/** The fence's header: everything before its Prompt heading (all of it when there is none). */
export function headOf(text) {
  return String(text).split(/^#{2,4} Prompt\b/m)[0];
}

const backticked = (line) => [...line.matchAll(/`([^`]+)`/g)].map((hit) => hit[1].trim()).filter(Boolean);

/** The globs on the fence's `- Paths:` line, or null when it has none. */
export function fencePaths(text) {
  const line = /^- Paths:[ \t]*(.*)$/m.exec(headOf(text));
  return line ? backticked(line[1]) : null;
}

/** True when `file` is one the fence lets the task change: its Paths, the always-allowed files, a lockfile beside an allowed manifest. */
export function inScope(file, paths, task) {
  if (matchesAny(file, paths) || ALWAYS_ALLOWED(task).includes(file)) return true;
  const base = path.posix.basename(file);
  if (!LOCKFILES[base]) return false;
  const manifest = path.posix.join(path.posix.dirname(file), LOCKFILES[base]);
  return matchesAny(manifest, paths);
}

function section(text, name) {
  const lines = String(text).split(/\r?\n/);
  const heading = new RegExp(`^#{2,4}[ \\t]+${name}\\b`, "i");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{2,4} /.test(lines[i]) && !/^#{3,4} Stage \d/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

const hasPart = (text, name) => new RegExp(`^(?:#{2,4}[ \\t]+|[-*][ \\t]+(?:\\*\\*)?)${name}\\b`, "im").test(text);

/** A path the builder may never change, for this kind of fence. */
function denied(entry, method) {
  let deny = [];
  try {
    const surfaces = config().surfaces ?? {};
    deny = (method ? surfaces.builder_method?.deny : surfaces.builder?.deny) ?? surfaces.builder?.deny ?? [];
  } catch {
    return false;
  }
  const wild = entry.search(/[*?]/);
  const sample = wild < 0 ? entry : `${entry.slice(0, wild)}x`;
  return matchesAny(sample, deny);
}

/** Findings for one fence's text. `file` names it (its task id comes from the name). */
export function checkFence(text, file) {
  const findings = [];
  const task = /T\d{2}/.exec(path.basename(file))?.[0] ?? "";
  const head = headOf(text);
  const method = isMethodFence(text);

  const title = String(text).split(/\r?\n/).find((line) => /^#{1,3} /.test(line)) ?? "";
  if (!task || !new RegExp(`\\b${task}\\b`).test(title)) findings.push(`the first heading does not name ${task || "the task"} (\`## ${task || "Tnn"} — <name>\`)`);

  const builder = /^[ \t]*- Builder:[ \t]*(\S+)[ \t]*·[ \t]*Effort:[ \t]*(\S+)[ \t]*·[ \t]*Fast:[ \t]*(\S+)/m.exec(head);
  if (!builder) findings.push("no builder line `- Builder: <pool id> · Effort: <low|medium|high|xhigh> · Fast: <yes|no>`");
  else {
    if (!EFFORTS.includes(builder[2])) findings.push(`Effort \`${builder[2]}\` is not one of ${EFFORTS.join(", ")}`);
    if (!["yes", "no"].includes(builder[3])) findings.push(`Fast \`${builder[3]}\` is not yes or no`);
  }

  if (!method) {
    const line = /^- Layers:[ \t]*(.*)$/m.exec(head);
    if (!line) findings.push("no `- Layers:` line (the layers of devos/skills/INDEX.md the task touches, PR-55)");
    else {
      const known = layerNames();
      const named = line[1].replaceAll("`", "").split(/[·,]/).map((part) => part.trim().toLowerCase()).filter(Boolean);
      if (named.length === 0) findings.push("the `- Layers:` line names no layer");
      for (const name of named) if (!known.includes(name)) findings.push(`layer \`${name}\` is not in devos/skills/INDEX.md (${known.join(", ")})`);
    }
  }

  const paths = fencePaths(text);
  if (paths === null) findings.push("no `- Paths:` line: every file or folder the task may change, each in backticks (guard:scope, PR-58)");
  else {
    if (paths.length === 0) findings.push("the `- Paths:` line names no path");
    for (const entry of paths) {
      if (entry.startsWith("/") || entry.includes("\\") || /(^|\/)\.\.(\/|$)/.test(entry)) findings.push(`path \`${entry}\` must be relative to the repository root, with / and no ..`);
      else if (globToRegExp(entry).test("any/file.txt") && globToRegExp(entry).test("x")) findings.push(`path \`${entry}\` allows every file`);
      else if (denied(entry, method)) findings.push(`path \`${entry}\` is one the builder may never change (devos.config.json surfaces)`);
    }
  }

  if (!hasPart(text, "Done when")) findings.push("no Done when section");
  if (!hasPart(text, "Do NOT")) findings.push("no Do NOT section");

  const stagesLine = /^- Stages:[ \t]*(\S+)/m.exec(head);
  const stages = stagesLine ? Number(stagesLine[1]) : 1;
  const blocks = [...String(text).matchAll(/^#{3,4} Stage (\d+)\b/gm)].map((hit) => Number(hit[1]));
  if (stagesLine) {
    if (!Number.isInteger(stages) || stages < 2 || stages > 4) findings.push(`\`- Stages: ${stagesLine[1]}\` must be 2, 3 or 4 (PR-38)`);
    else if (blocks.join(",") !== Array.from({ length: stages }, (_, i) => i + 1).join(",")) findings.push(`\`- Stages: ${stages}\` needs the blocks \`### Stage 1\` to \`### Stage ${stages}\` in order; found ${blocks.length ? blocks.join(", ") : "none"}`);
  } else if (blocks.length > 0) findings.push("`### Stage` blocks without a `- Stages: N` line");

  const done = section(text, "Done when");
  if (done) {
    const items = done.filter((line) => /^(?:[-*]|\d+\.)[ \t]/.test(line)).length;
    if (items > ONE_RUN * stages) findings.push(`${items} Done-when items: more than ${ONE_RUN * stages} is more than ${stages === 1 ? "one builder run; split it with `- Stages: N` (PR-38)" : `${stages} stages hold`}`);
  }
  if (paths && paths.length > ONE_RUN * stages) findings.push(`${paths.length} Paths entries: more than ${ONE_RUN * stages} is more than ${stages === 1 ? "one builder run; split it with `- Stages: N` (PR-38)" : `${stages} stages hold`}`);
  return findings;
}

/** Findings for a fence file on disk (repository-relative path). */
export function checkFile(rel) {
  if (!existsSync(P(rel))) return [`${rel} does not exist`];
  return checkFence(readFileSync(P(rel), "utf8"), rel);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    console.error("usage: fence-check.mjs docs/fences/Tnn.md [more fences] [--json]");
    process.exit(2);
  }
  const results = files.map((file) => ({ file, findings: checkFile(file) }));
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else {
    for (const { file, findings } of results) {
      for (const finding of findings) console.log(`${file}: ${finding}`);
      console.log(`fence-check: ${file} ${findings.length === 0 ? "OK" : `${findings.length} finding(s)`}`);
    }
  }
  process.exit(results.some((item) => item.findings.length > 0) ? 1 : 0);
}
