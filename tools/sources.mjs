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
    "scripts/guards/run-all.mjs": "E02, E08, E14",
    ".claude/commands/devos-new-project.md": "E03, E06",
    ".github/workflows/devos-deploy.yml": "E03, E06",
    ".github/workflows/devos-intake.yml": "E03, E06, E24, E22h, E22i",
    "devos/prompts/builder.md": "E03, E23a, E14, E22i",
    "devos/prompts/intake.md": "E03, E11, E06, E08",
    "devos/prompts/method.md": "E03, E11, E22h",
    "devos/prompts/reviewer.md": "E03, E11, E23a, E08, E14, E22h",
    "devos/prompts/revise.md": "E03, E11",
    "devos/setup.json": "E03, E15, E17, E22h",
    "docs/method/AUTOMATION.md": "E03, E06, P1, E15, E17, E18, E23a, E19, E20, E08, E14, E24, E22h, E22i",
    "docs/method/FULLSTACK_MODULE.md": "E03",
    "docs/method/PRECEDENTS.md": "E03, E06, P1, E15, E17, E18, E23a, E19, E20, E08, E14, E24, E22h, E22i",
    "scripts/devos/doctor.mjs": "E03, E22h",
    "scripts/devos/probe.mjs": "E03",
    "scripts/devos/render-prompt.mjs": "E03, E11, E06, E22i",
    ".github/workflows/devos-cycle.yml": "E11, E12, E06, E17, E23a, E19, E14, E24, E22h, E22i",
    ".github/workflows/ci.yml": "E19",
    "scripts/devos/run-checks.mjs": "E19, E20",
    ".cursor/rules/40-environment.mdc": "E19",
    ".cursor/skills/devos-execute-fence/SKILL.md": "E19",
    ".claude/skills/devos-fence-writing/SKILL.md": "E19",
    ".gitignore": "E19",
    ".github/workflows/devos-setup.yml": "E17",
    "scripts/devos/accounts.sh": "E17",
    "scripts/devos/builder-model.mjs": "E11, E06",
    "scripts/devos/review-mode.mjs": "E11, E22h",
    "scripts/guards/design.mjs": "E03",
    "scripts/guards/i18n.mjs": "E03",
    "scripts/guards/naming.mjs": "E03",
    ".cursor/rules/60-mcp-tools.mdc": "E06",
    ".github/workflows/devos-advance.yml": "E06",
    ".github/workflows/devos-resume.yml": "E06",
    "scripts/devos/guard-surfaces.mjs": "E06",
    "scripts/devos/limits.mjs": "E06, E22i",
    "scripts/devos/next-task.mjs": "E06, E22h",
    "scripts/devos/screens.mjs": "E06, E14",
    "scripts/devos/verdict.mjs": "E06, E22i",
    "scripts/devos/supervisor.mjs": "P1",
    "scripts/devos/setup-check.mjs": "E15, E22h",
    "scripts/devos/screens.test.mjs": "E14",
    ".cursor/skills/devos-compose-ui/SKILL.md": "E14",
    "scripts/devos/agent-watchdog.sh": "E24",
    "scripts/devos/sync-main.sh": "E24",
    ".github/workflows/devos-doctor.yml": "E24, E22h",
    ".github/workflows/devos-supervisor.yml": "E24, E22h",
    ".gitattributes": "E24",
    ".cursor/cli.json": "E24",
    "scripts/devos/modules.mjs": "E22h",
    "scripts/devos/limit-check.mjs": "E22i",
    "scripts/devos/lib.mjs": "E22h",
    "scripts/devos/loop.mjs": "E22h",
    "devos/prompts/supervisor.md": "E22h",
  },
  added: {
    "devos/engine.defaults.json": "E02, E19, E20, E14, E24",
    "scripts/devos/config.mjs": "E02",
    "scripts/guards/config.mjs": "E02",
    "scripts/devos/agents.mjs": "E11, E17, E22h",
    "devos/roles/cursor-reviewer/cli.json": "E12",
    "devos/roles/cursor-reviewer/rules/00-reviewer.mdc": "E12",
    "devos/roles/claude-builder/settings.json": "E12, E24",
    "devos/roles/claude-builder/CLAUDE.md": "E12",
    "scripts/devos/role-env.mjs": "E12, E17, E22h",
    "devos/prompts/blueprint.md": "E06, E15, E18, E23a, E19, E20, E08, E14",
    "scripts/guards/design-spec.mjs": "E08",
    "docs/method/DESIGN_METHOD.md": "E08, E14",
    "devos/roles/cursor-blueprint/cli.json": "E15",
    "scripts/devos/run-agent.sh": "E17, E23a, E24",
    "scripts/devos/agent-cli.mjs": "E17, E23a",
    "devos/roles/gemini/policy.toml": "E17",
    "devos/ci/mcp.claude.json": "E23a",
    "devos/roles/gemini/settings.json": "E23a",
    "scripts/devos/ui-evidence.mjs": "E14",
    "scripts/guards/skills.mjs": "E14",
    "devos/skills/README.md": "E14",
    "devos/skills/emil-design-eng/LICENSE": "E14",
    "devos/skills/emil-design-eng/SKILL.md": "E14",
    "devos/skills/fixing-accessibility/LICENSE": "E14",
    "devos/skills/fixing-accessibility/SKILL.md": "E14",
    "devos/skills/frontend-design/LICENSE.txt": "E14",
    "devos/skills/frontend-design/SKILL.md": "E14",
    "devos/skills/impeccable/LICENSE": "E14",
    "devos/skills/impeccable/NOTICE.md": "E14",
    "devos/skills/impeccable/reference/adapt.md": "E14",
    "devos/skills/impeccable/reference/animate.md": "E14",
    "devos/skills/impeccable/reference/audit.md": "E14",
    "devos/skills/impeccable/reference/clarify.md": "E14",
    "devos/skills/impeccable/reference/colorize.md": "E14",
    "devos/skills/impeccable/reference/craft-floor.md": "E14",
    "devos/skills/impeccable/reference/harden.md": "E14",
    "devos/skills/impeccable/reference/layout.md": "E14",
    "devos/skills/impeccable/reference/onboard.md": "E14",
    "devos/skills/impeccable/reference/operate.md": "E14",
    "devos/skills/impeccable/reference/typeset.md": "E14",
    "devos/skills/manifest.json": "E14",
    "devos/skills/review-animations/LICENSE": "E14",
    "devos/skills/review-animations/SKILL.md": "E14",
    "devos/skills/review-animations/STANDARDS.md": "E14",
    "devos/skills/taste/LICENSE": "E14",
    "devos/skills/taste/references/colour.md": "E14",
    "devos/skills/taste/references/critique.md": "E14",
    "devos/skills/taste/references/layout.md": "E14",
    "devos/skills/taste/references/tells.md": "E14",
    "devos/skills/taste/references/type.md": "E14",
    "devos/skills/web-interface-guidelines/LICENSE": "E14",
    "devos/skills/web-interface-guidelines/SKILL.md": "E14",
    "devos/skills/web-interface-guidelines/command.md": "E14",
    "scripts/devos/usage.mjs": "E24",
    "scripts/devos/plan-agent.sh": "E22h",
    "devos/roles/cursor-planner/cli.json": "E22h",
    "devos/roles/cursor-planner/rules/00-planner.mdc": "E22h",
  },
  removed: {
    ".cursor/rules/10-security-data.mdc": "E03",
    ".cursor/rules/30-vocabulary.mdc": "E03",
  },
};
