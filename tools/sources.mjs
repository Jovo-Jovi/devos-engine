import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOWER = {
  repo: "Jovo-Jovi/devos-control-tower",
  commit: "a49ca6db268b98d6558077bf3e95b8ae759d91b3",
};

export const PILOT = {
  repo: "Jovo-Jovi/devos-pilot",
  commit: "4ccbef799546315a491da86f4e3676ba46d8fa51",
};

export const METHOD_PATHS = [
  "scripts/devos",
  "scripts/guards",
  "devos",
  ".github/workflows",
  ".github/ISSUE_TEMPLATE",
  ".cursor",
  ".claude",
  "docs/method/DEV_OS_V2_REVIEWER.md",
  "docs/method/AUTOMATION.md",
  "docs/method/FULLSTACK_MODULE.md",
  "docs/method/PRECEDENTS.md",
  ".gitignore",
  ".gitattributes",
];

export const REFERENCE = [
  { root: "tower", from: "devos.config.json", to: "dev/sources/tower/devos.config.json" },
  { root: "tower", from: "CLAUDE.md", to: "dev/sources/tower/CLAUDE.md" },
  { root: "tower", from: "AGENTS.md", to: "dev/sources/tower/AGENTS.md" },
  { root: "tower", from: "SETUP.md", to: "dev/sources/tower/SETUP.md" },
  { root: "pilot", from: "devos/setup.json", to: "dev/sources/pilot/devos/setup.json" },
];

export function engineRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function gitHead(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

export function listMethodFiles(towerDir) {
  const out = execFileSync("git", ["-C", towerDir, "ls-files", "-z", "--", ...METHOD_PATHS], {
    windowsHide: true,
  });
  return out.toString("utf8").split("\0").filter(Boolean);
}

export function normalizeLf(bytes) {
  if (bytes.includes(0)) {
    throw new Error("file contains a NUL byte");
  }
  return Buffer.from(bytes.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const SOURCE_COUNT = 103;

export const LOCAL = {
  changed: {
    "scripts/guards/run-all.mjs": "E02",
    ".claude/commands/devos-new-project.md": "E03, E06",
    ".github/workflows/devos-deploy.yml": "E03, E06",
    ".github/workflows/devos-intake.yml": "E03, E06",
    "devos/prompts/builder.md": "E03",
    "devos/prompts/intake.md": "E03, E11, E06",
    "devos/prompts/method.md": "E03, E11",
    "devos/prompts/reviewer.md": "E03, E11",
    "devos/prompts/revise.md": "E03, E11",
    "devos/setup.json": "E03, E15, E17",
    "docs/method/AUTOMATION.md": "E03, E06, P1, E15, E17",
    "docs/method/FULLSTACK_MODULE.md": "E03",
    "docs/method/PRECEDENTS.md": "E03, E06, P1, E15, E17",
    "scripts/devos/doctor.mjs": "E03",
    "scripts/devos/probe.mjs": "E03",
    "scripts/devos/render-prompt.mjs": "E03, E11, E06",
    ".github/workflows/devos-cycle.yml": "E11, E12, E06, E17",
    ".github/workflows/devos-setup.yml": "E17",
    "scripts/devos/accounts.sh": "E17",
    "scripts/devos/builder-model.mjs": "E11, E06",
    "scripts/devos/review-mode.mjs": "E11",
    "scripts/guards/design.mjs": "E03",
    "scripts/guards/i18n.mjs": "E03",
    "scripts/guards/naming.mjs": "E03",
    ".cursor/rules/60-mcp-tools.mdc": "E06",
    ".github/workflows/devos-advance.yml": "E06",
    ".github/workflows/devos-resume.yml": "E06",
    "scripts/devos/guard-surfaces.mjs": "E06",
    "scripts/devos/limits.mjs": "E06",
    "scripts/devos/next-task.mjs": "E06",
    "scripts/devos/screens.mjs": "E06",
    "scripts/devos/verdict.mjs": "E06",
    "scripts/devos/supervisor.mjs": "P1",
    "scripts/devos/setup-check.mjs": "E15",
  },
  added: {
    "devos/engine.defaults.json": "E02",
    "scripts/devos/config.mjs": "E02",
    "scripts/guards/config.mjs": "E02",
    "scripts/devos/agents.mjs": "E11, E17",
    "devos/roles/cursor-reviewer/cli.json": "E12",
    "devos/roles/cursor-reviewer/rules/00-reviewer.mdc": "E12",
    "devos/roles/claude-builder/settings.json": "E12",
    "devos/roles/claude-builder/CLAUDE.md": "E12",
    "scripts/devos/role-env.mjs": "E12, E17",
    "devos/prompts/blueprint.md": "E06, E15",
    "devos/roles/cursor-blueprint/cli.json": "E15",
    "scripts/devos/run-agent.sh": "E17",
    "scripts/devos/agent-cli.mjs": "E17",
    "devos/roles/gemini/policy.toml": "E17",
  },
  removed: {
    ".cursor/rules/10-security-data.mdc": "E03",
    ".cursor/rules/30-vocabulary.mdc": "E03",
  },
};
