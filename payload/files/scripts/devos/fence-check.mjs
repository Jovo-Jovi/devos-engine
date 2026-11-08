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

/** The ids on the fence's `- Media:` line (PR-81), or null when it has none. */
export function fenceMedia(text) {
  const line = /^- Media:[ \t]*(.*)$/m.exec(headOf(text));
  return line ? backticked(line[1]) : null;
}

/** The `- Dependencies:` line's text (PR-85), or null when the fence has none. */
function dependencyLine(text) {
  const line = /^- Dependencies:[ \t]*(.*)$/m.exec(headOf(text));
  return line ? line[1].trim() : null;
}

const MAX_PAGES = 10;

/** The launch task's `- Launch:` line (PR-88): the main pages its readiness checks visit, or `none`; { found, none, paths, errors }. */
export function launchLine(fenceText) {
  const line = String(fenceText ?? "").split(/\r?\n/).find((row) => /^- Launch:/.test(row));
  if (line === undefined) return { found: false, none: false, paths: [], errors: [] };
  const value = line.slice("- Launch:".length).trim();
  if (/^none$/i.test(value)) return { found: true, none: true, paths: [], errors: [] };
  const paths = value.split(/\s*[·,]\s*|\s+/).filter(Boolean);
  const errors = [];
  if (paths.length === 0) errors.push("names no page: give the main pages (`- Launch: / · /pricing`) or `none`");
  for (const item of paths) if (!/^\/[^\s?#]*$/.test(item)) errors.push(`"${item}" is not a page path (it starts with / and has no query)`);
  if (new Set(paths).size !== paths.length) errors.push("names a page twice");
  if (paths.length > MAX_PAGES) errors.push(`names ${paths.length} pages; ${MAX_PAGES} at most`);
  return { found: true, none: false, paths, errors };
}

/** The packages the fence's `- Dependencies:` line names (PR-85): [] for `none` and for no line at all. */
export function fenceDependencies(text) {
  const line = dependencyLine(text);
  return line === null || /^none$/i.test(line) ? [] : backticked(line);
}

// An npm package name: lower case, an optional @scope/, no leading dot or underscore.
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** The items of docs/design/media.json (PR-79), or null when there is no readable plan. */
export function mediaItems() {
  try {
    const items = JSON.parse(readFileSync(P("docs/design/media.json"), "utf8")).items;
    return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : null;
  } catch {
    return null;
  }
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

function fixedEffort(id) {
  try {
    const pool = config().agents?.pool;
    if (!Array.isArray(pool)) return null;
    const item = pool.find((entry) => entry?.id === id);
    if (!item || !item.effort) return null;
    return { effort: item.effort, fast: item.fast === true ? "yes" : "no" };
  } catch {
    return null;
  }
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
    const fixed = fixedEffort(builder[1]);
    if (fixed && (builder[2] !== fixed.effort || builder[3] !== fixed.fast)) {
      findings.push(`builder \`${builder[1]}\` has a fixed effort in devos.config.json: the line must say \`Effort: ${fixed.effort} · Fast: ${fixed.fast}\` (PR-78)`);
    }
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

  // PR-81: the media a task's screens show, made before its builder.
  const media = fenceMedia(text);
  if (media !== null) {
    const items = mediaItems();
    if (media.length === 0) findings.push("the `- Media:` line names no item");
    else if (items === null) findings.push("a `- Media:` line needs docs/design/media.json, the media plan (PR-79)");
    else for (const id of media) if (!items.some((item) => item.id === id)) findings.push(`media item \`${id}\` is not in docs/design/media.json`);
  }

  // PR-85: the packages the task may add to a manifest, or `none`.
  const dependencies = dependencyLine(text);
  if (dependencies !== null) {
    const names = fenceDependencies(text);
    if (names.length === 0 && !/^none$/i.test(dependencies)) findings.push("the `- Dependencies:` line names no package: name each in backticks, or write `none` (PR-85)");
    for (const name of names) if (name.length > 214 || !PACKAGE_NAME.test(name)) findings.push(`dependency \`${name}\` is not a package name (such as \`zod\` or \`@scope/name\`)`);
    for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i))) findings.push(`dependency \`${name}\` is named twice`);
  }

  // PR-88: the launch task names the main pages its readiness checks visit, or `none`.
  for (const error of launchLine(head).errors) findings.push(`the \`- Launch:\` line ${error} (PR-88)`);

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
