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
    "docs/method/AUTOMATION.md": "E02",
    "docs/method/PRECEDENTS.md": "E02",
  },
  added: {
    "devos/engine.defaults.json": "E02",
    "scripts/devos/config.mjs": "E02",
    "scripts/guards/config.mjs": "E02",
  },
};
