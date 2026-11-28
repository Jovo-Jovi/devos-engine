#!/usr/bin/env node
// Swap a tool into the other role's kit, then restore its own config byte for byte (PR-42). E86 (PR-106): each tool's
// kits are in its devos/agents/<id>.json `kits` (tools.mjs); a role a tool has no kit for leaves the tree as it is.
// Usage: node scripts/devos/role-env.mjs swap <tool> builder|reviewer|planner
//        node scripts/devos/role-env.mjs restore
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "./lib.mjs";
import { ROLES, toolIds, tool as toolFile } from "./tools.mjs";

const STASH = ".devos/role-stash";

function markerPath() {
  return P(STASH, "manifest.json");
}

function moveAside(rel, moved) {
  const from = P(rel);
  if (!existsSync(from)) return;
  const destRel = `${STASH}/orig/${rel}`;
  mkdirSync(path.dirname(P(destRel)), { recursive: true });
  renameSync(from, P(destRel));
  moved.push({ rel, destRel });
}

function swap(id, role) {
  const t = toolFile(id);
  if (!t || !ROLES.includes(role)) {
    console.error(`role-env: no tool ${id || "named"} or no role ${role || "named"}; swap <tool> ${ROLES.join("|")}`);
    process.exit(1);
  }
  const spec = t.kits?.[role];
  if (!spec) return;
  const kit = `${id}-${role}`;
  if (existsSync(markerPath())) {
    const current = JSON.parse(readFileSync(markerPath(), "utf8"));
    if (current.kit === kit) return;
    console.error(`role-env: ${current.kit} is already swapped`);
    process.exit(1);
  }
  mkdirSync(P(STASH), { recursive: true });
  const moved = [];
  for (const rel of spec.move) moveAside(rel, moved);
  const installed = [];
  for (const item of spec.install) {
    mkdirSync(path.dirname(P(item.to)), { recursive: true });
    cpSync(P(item.from), P(item.to), { recursive: true });
    installed.push(item.to);
  }
  writeFileSync(markerPath(), `${JSON.stringify({ kit, moved, installed }, null, 2)}\n`);
}

function restore() {
  if (!existsSync(markerPath())) return;
  const { moved, installed } = JSON.parse(readFileSync(markerPath(), "utf8"));
  for (const rel of installed) rmSync(P(rel), { recursive: true, force: true });
  for (const item of moved) {
    mkdirSync(path.dirname(P(item.rel)), { recursive: true });
    renameSync(P(item.destRel), P(item.rel));
  }
  rmSync(P(STASH), { recursive: true, force: true });
  let status = "";
  try {
    // The top folder or file of every path any tool's kit swaps (.claude, .cursor, CLAUDE.md, AGENTS.md, GEMINI.md).
    const watched = [...new Set(toolIds().flatMap((id) => Object.values(toolFile(id).kits ?? {}).flatMap((kit) => [...kit.move, ...kit.install.map((item) => item.to)])).map((rel) => rel.split("/")[0]))].sort();
    status = execFileSync("git", ["status", "--porcelain", "--", ...watched], {
      cwd: P("."),
      encoding: "utf8",
    });
  } catch (error) {
    console.error(error.stderr || error.message);
    process.exit(1);
  }
  if (status.trim()) {
    const paths = status.trim().split(/\n/).map((line) => line.slice(3).trim()).filter(Boolean);
    console.error(`role-env: restore left changes in ${paths.join(", ")}`);
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === "swap") swap(process.argv[3] ?? "", process.argv[4] ?? "");
else if (command === "restore") restore();
else {
  console.error(`usage: role-env.mjs swap <tool> ${ROLES.join("|")} | restore`);
  process.exit(2);
}
