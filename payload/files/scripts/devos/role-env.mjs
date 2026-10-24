#!/usr/bin/env node
// Swap a tool into the other role's kit, then restore its own config byte for byte (PR-42).
// Usage: node scripts/devos/role-env.mjs swap cursor-reviewer|cursor-planner|claude-builder|codex-builder|codex-reviewer|gemini-builder|gemini-reviewer
//        node scripts/devos/role-env.mjs restore
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "./lib.mjs";

const STASH = ".devos/role-stash";
const KITS = {
  "cursor-reviewer": {
    move: [".cursor/cli.json", ".cursor/hooks.json", ".cursor/rules"],
    install: [
      { from: "devos/roles/cursor-reviewer/cli.json", to: ".cursor/cli.json" },
      { from: "devos/roles/cursor-reviewer/rules", to: ".cursor/rules" },
    ],
  },
  "cursor-planner": {
    move: [".cursor/cli.json", ".cursor/hooks.json", ".cursor/rules"],
    install: [
      { from: "devos/roles/cursor-planner/cli.json", to: ".cursor/cli.json" },
      { from: "devos/roles/cursor-planner/rules", to: ".cursor/rules" },
    ],
  },
  "claude-builder": {
    move: [".claude/settings.json", "CLAUDE.md"],
    install: [
      { from: "devos/roles/claude-builder/settings.json", to: ".claude/settings.json" },
      { from: "devos/roles/claude-builder/CLAUDE.md", to: "CLAUDE.md" },
    ],
  },
  "codex-builder": {
    move: ["AGENTS.md"],
    install: [{ from: "devos/roles/claude-builder/CLAUDE.md", to: "AGENTS.md" }],
  },
  "codex-reviewer": {
    move: ["AGENTS.md"],
    install: [{ from: "CLAUDE.md", to: "AGENTS.md" }],
  },
  "gemini-builder": {
    move: ["GEMINI.md"],
    install: [{ from: "devos/roles/claude-builder/CLAUDE.md", to: "GEMINI.md" }],
  },
  "gemini-reviewer": {
    move: ["GEMINI.md"],
    install: [{ from: "CLAUDE.md", to: "GEMINI.md" }],
  },
};

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

function swap(kit) {
  const spec = KITS[kit];
  if (!spec) {
    console.error(`role-env: unknown kit ${kit}`);
    process.exit(1);
  }
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
    status = execFileSync("git", ["status", "--porcelain", "--", ".cursor", ".claude", "CLAUDE.md", "AGENTS.md", "GEMINI.md"], {
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
const kit = process.argv[3] ?? "";
if (command === "swap") swap(kit);
else if (command === "restore") restore();
else {
  console.error("usage: role-env.mjs swap cursor-reviewer|cursor-planner|claude-builder|codex-builder|codex-reviewer|gemini-builder|gemini-reviewer | restore");
  process.exit(2);
}
