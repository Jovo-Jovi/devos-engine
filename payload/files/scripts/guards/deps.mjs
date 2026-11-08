// guard:deps — the dependency gate (PR-85), Node first. In a task run, the task branch against the base
// (`origin/<base>...HEAD`; the local loop sets DEVOS_SCOPE_BASE) plus the working tree:
// - every package a manifest (`package.json`) gains is named on the fence's `- Dependencies:` line; a fence without
//   the line names none. A manifest the task creates (the scaffold) holds the stack's packages, and is not named;
// - when a manifest or `pnpm-lock.yaml` changed, `pnpm audit` finds no high or critical advisory. A waived one
//   (`pnpm.auditConfig` in package.json, with the owner's recorded decision) is left out by pnpm itself;
// - an added package under a copyleft licence is a warning in the note, for the reviewer: it never fails.
// N/A outside a task run (no TASK), without the task's fence, and for a project that is not Node.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { exists, P, read, result, ROOT } from "./lib.mjs";
import { changedPaths, config } from "../devos/lib.mjs";
import { fenceDependencies } from "../devos/fence-check.mjs";

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
// SPDX ids of the copyleft licences, strong and weak (GPL-3.0-only, AGPL-3.0, LGPL-2.1, MPL-2.0, EPL-2.0, …).
export const COPYLEFT = /\b(?:A?GPL|LGPL|MPL|EPL|EUPL|CDDL|OSL|SSPL|CPAL|CC-BY-SA)\b/i;
const BLOCKING = ["critical", "high"];
const MANIFEST = /(^|\/)package\.json$/;
const LOCKFILE = /(^|\/)pnpm-lock\.yaml$/;
const VENDORED = /(^|\/)node_modules\//;

/** The package names a package.json text lists in any of its dependency sections. */
export function manifestNames(text) {
  const pkg = JSON.parse(text);
  const names = new Set();
  for (const section of SECTIONS) {
    const list = pkg?.[section];
    if (list && typeof list === "object" && !Array.isArray(list)) for (const name of Object.keys(list)) names.add(name);
  }
  return names;
}

/** A package's licence as its package.json states it ("" when it states none). */
export function licenceOf(pkg) {
  const one = (value) => (typeof value === "string" ? value : typeof value?.type === "string" ? value.type : "");
  if (pkg?.license !== undefined) return one(pkg.license);
  return Array.isArray(pkg?.licenses) ? pkg.licenses.map(one).filter(Boolean).join(" OR ") : "";
}

/**
 * The high and critical advisories of `pnpm audit --json` output: { advisories } or { error } when the output is
 * not an audit report.
 */
export function blockingAdvisories(stdout) {
  let report;
  try {
    report = JSON.parse(String(stdout ?? ""));
  } catch {
    return { error: "its output is not JSON" };
  }
  if (!report || typeof report.advisories !== "object" || report.advisories === null) {
    const said = typeof report?.error?.message === "string" ? report.error.message : typeof report?.error?.code === "string" ? report.error.code : "no advisories in its output";
    return { error: said };
  }
  const advisories = Object.values(report.advisories)
    .filter((item) => BLOCKING.includes(String(item?.severity ?? "").toLowerCase()))
    .map((item) => ({ name: String(item.module_name ?? "?"), severity: String(item.severity).toLowerCase(), title: String(item.title ?? "").trim(), id: String(item.github_advisory_id ?? item.url ?? item.id ?? "") }))
    .sort((a, b) => BLOCKING.indexOf(a.severity) - BLOCKING.indexOf(b.severity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { advisories };
}

function atBase(base, file) {
  try {
    return execFileSync("git", ["show", `${base}:${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** The licence of an installed package: beside its manifest's node_modules, or the root's; null when not installed. */
function installedLicence(manifest, name) {
  for (const dir of [...new Set([path.posix.dirname(manifest), "."])]) {
    const file = P(...(dir === "." ? [] : dir.split("/")), "node_modules", ...name.split("/"), "package.json");
    if (!existsSync(file)) continue;
    try {
      return licenceOf(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return "";
    }
  }
  return null;
}

/** `pnpm audit` in the repository: { advisories } or { error }; asked twice when it does not answer. */
export function audit() {
  let last = { error: "" };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const run = spawnSync("pnpm", ["audit", "--audit-level", "high", "--json"], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 180000, shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
    if (run.error) return { error: run.error.code === "ENOENT" ? "pnpm is not installed" : run.error.message };
    last = blockingAdvisories(run.stdout);
    if (!last.error) return last;
  }
  return last;
}

export default function deps() {
  const task = process.env.TASK ?? "";
  if (!/^T\d{2}$/.test(task)) return result("N/A", [], "no task in this run");
  const rel = `docs/fences/${task}.md`;
  if (!exists(rel)) return result("N/A", [], `no ${rel}`);
  const cfg = config();
  const toolchain = cfg.stack?.toolchain || "node";
  if (toolchain !== "node") return result("N/A", [], `the dependency gate covers Node projects first, and this one is ${toolchain} (PR-85)`);
  const base = process.env.DEVOS_SCOPE_BASE || `origin/${cfg.base_branch ?? "main"}`;
  let committed;
  try {
    committed = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  } catch {
    return result("FAIL", [`cannot compare the branch with ${base}: fetch it (git fetch origin ${cfg.base_branch ?? "main"})`]);
  }
  const changed = [...new Set([...committed, ...changedPaths()])].filter((file) => !VENDORED.test(file)).sort();
  const manifests = changed.filter((file) => MANIFEST.test(file) && exists(file));
  const locks = changed.filter((file) => LOCKFILE.test(file));
  if (manifests.length === 0 && locks.length === 0) return result("PASS", [], "no manifest or lockfile changed");

  const named = fenceDependencies(read(rel));
  const findings = [];
  const added = [];
  let created = 0;
  for (const file of manifests) {
    let now;
    try {
      now = manifestNames(read(file));
    } catch {
      findings.push(`${file} — not valid JSON`);
      continue;
    }
    const before = atBase(base, file);
    if (before === null) {
      // The task creates this manifest (the scaffold): its packages are the stack's, and their licences are read.
      created += 1;
      for (const name of [...now].sort()) added.push({ name, file });
      continue;
    }
    let then;
    try {
      then = manifestNames(before);
    } catch {
      then = new Set();
    }
    for (const name of [...now].sort()) {
      if (then.has(name)) continue;
      added.push({ name, file });
      if (!named.includes(name)) findings.push(`${name} — added to ${file}, and the \`- Dependencies:\` line of ${rel} does not name it (PR-85)`);
    }
  }

  // Copyleft licences are the reviewer's to judge: a warning in the note, never a failure.
  const copyleft = [];
  let unread = 0;
  for (const { name, file } of added) {
    const licence = installedLicence(file, name);
    if (licence === null) unread += 1;
    else if (COPYLEFT.test(licence)) copyleft.push(`${name} (${licence})`);
  }

  let audited = "";
  if (!existsSync(P("pnpm-lock.yaml"))) {
    findings.push("pnpm-lock.yaml — missing, and the audit reads it: run pnpm install (PR-85)");
  } else {
    const report = audit();
    if (report.error) findings.push(`pnpm audit — did not run (${report.error}); the gate needs its answer (PR-85)`);
    else {
      for (const item of report.advisories) {
        findings.push(`${item.name} — ${item.severity}: ${item.title || "an advisory"}${item.id ? ` (${item.id})` : ""}; upgrade it, or waive it in package.json pnpm.auditConfig with the owner's recorded decision (PR-85)`);
      }
      audited = `audit: ${report.advisories.length} high or critical`;
    }
  }
  const note = [
    `${added.length} package(s) added${created > 0 ? `, ${created} manifest(s) created` : ""}`,
    audited,
    copyleft.length > 0 ? `copyleft licence warning: ${copyleft.join(", ")}` : "",
    unread > 0 ? `${unread} licence(s) not read (not installed)` : "",
  ].filter(Boolean).join("; ");
  return result(findings.length ? "FAIL" : "PASS", findings, note);
}
