import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET = /\b(ghp_|gho_|github_pat_|sk-|AKIA[0-9A-Z]{8})|-----BEGIN /;
const ORDER = ["github_owner", "visibility", "default_stack", "cursor_accounts", "claude_accounts"];

const RULES = {
  github_owner: {
    rule: "a GitHub owner (letters, digits, hyphen, 1-39)",
    ok: (value) => /^[A-Za-z0-9-]{1,39}$/.test(value),
    store: (value) => value,
  },
  visibility: {
    rule: "private or public",
    ok: (value) => value === "private" || value === "public",
    store: (value) => value,
  },
  default_stack: {
    rule: "a string",
    ok: () => true,
    store: (value) => value,
  },
  cursor_accounts: {
    rule: "1 or 2",
    ok: (value) => value === "1" || value === "2",
    store: (value) => Number(value),
  },
  claude_accounts: {
    rule: "1 or 2",
    ok: (value) => value === "1" || value === "2",
    store: (value) => Number(value),
  },
};

export function devosHome() {
  const env = process.env.DEVOS_HOME;
  if (typeof env === "string" && env.length > 0) return env;
  return os.homedir();
}

function profilePath() {
  return path.join(devosHome(), ".devos", "profile.json");
}

function readProfile() {
  const file = profilePath();
  if (!existsSync(file)) return {};
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("profile file is not an object");
  }
  return data;
}

function writeProfile(data) {
  const file = profilePath();
  const ordered = {};
  for (const key of ORDER) {
    if (Object.hasOwn(data, key)) ordered[key] = data[key];
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
}

export function profileCommand(args) {
  if (args[0] === "show" && args.length === 1) {
    let data = {};
    try {
      data = readProfile();
    } catch {
      console.log("devos: profile file is not JSON");
      return 1;
    }
    const ordered = {};
    for (const key of ORDER) {
      if (Object.hasOwn(data, key)) ordered[key] = data[key];
    }
    process.stdout.write(`${JSON.stringify(ordered, null, 2)}\n`);
    return 0;
  }
  if (args[0] === "set" && args.length === 3) {
    const key = args[1];
    const value = args[2];
    if (!Object.hasOwn(RULES, key)) {
      console.log(`devos: profile key ${key} is not allowed`);
      return 1;
    }
    if (SECRET.test(value)) {
      console.log("devos: profile refused a value-like string");
      return 1;
    }
    const rule = RULES[key];
    if (!rule.ok(value)) {
      console.log(`devos: profile ${key} must be ${rule.rule}`);
      return 1;
    }
    let data;
    try {
      data = readProfile();
    } catch {
      console.log("devos: profile file is not JSON");
      return 1;
    }
    data[key] = rule.store(value);
    writeProfile(data);
    return 0;
  }
  console.log("devos: unknown command profile");
  return 2;
}
