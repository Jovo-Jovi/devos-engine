import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { CONTRACT_VERSION, contractText } from "./contract.mjs";
import { doctorCommand } from "./doctor.mjs";
import { installInto, keyFromName } from "./install.mjs";
import { devosHome } from "./profile.mjs";
import { which, run } from "./which.mjs";

const REQUIRED_DOCS = ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md"];
const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;

function lineReader(input) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = [];
  let done = false;
  let waiting = null;
  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
      return;
    }
    pending.push(line);
  });
  rl.on("close", () => {
    done = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });
  return () => {
    if (pending.length > 0) return Promise.resolve(pending.shift());
    if (done) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };
}

function isEmptyFolder(folder) {
  if (!existsSync(folder)) return true;
  if (!statSync(folder).isDirectory()) return false;
  return readdirSync(folder).length === 0;
}

function profileVisibility() {
  try {
    const file = path.join(devosHome(), ".devos", "profile.json");
    if (!existsSync(file)) return "private";
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data && (data.visibility === "private" || data.visibility === "public")) return data.visibility;
  } catch {
    /* a missing or unreadable profile uses private */
  }
  return "private";
}

async function ask(read, prompt, question, accept) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    process.stdout.write(prompt);
    const line = await read();
    if (line === null) return null;
    const value = accept(line);
    if (value !== undefined) return value;
  }
  console.log(`devos: no valid answer for ${question}`);
  return undefined;
}

function ended() {
  console.log("devos: input ended before setup finished");
  return 1;
}

function docsUnder(folder) {
  const docs = path.join(folder, "docs");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else found.push(path.relative(folder, abs).split(path.sep).join("/"));
    }
  };
  if (existsSync(docs)) walk(docs);
  found.sort();
  return found;
}

function checkBlueprint(folder) {
  const missing = REQUIRED_DOCS.filter((rel) => !existsSync(path.join(folder, ...rel.split("/"))));
  const guard = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "phases,naming"], {
    cwd: folder,
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${guard.stdout ?? ""}${guard.stderr ?? ""}`;
  const detail = [...missing.map((rel) => `missing ${rel}`), output].filter((part) => part !== "").join("\n");
  return { ok: missing.length === 0 && guard.status === 0, detail };
}

function printClaude(stdout) {
  let text = stdout ?? "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.result === "string") text = parsed.result;
  } catch {
    /* not JSON: print the raw stdout */
  }
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function claudeArgs(round) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    "200",
    "--allowedTools",
    "Read,Glob,Grep,Write,Edit,WebFetch,WebSearch,Bash(node scripts/devos/config.mjs --write)",
    "--disallowedTools",
    "Bash(git *),Bash(gh *),Bash(curl *),Bash(wget *),Bash(rm *)",
  ];
  if (round > 1) args.push("--continue");
  return args;
}

function finish(folder, held) {
  const bytes = held[".claude/settings.json"];
  const dest = path.join(folder, ".claude", "settings.json");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  console.log(`devos init: blueprint approved in ${folder}`);
  console.log("devos: next — the GitHub repository, secrets and the first cycle are the next part of setup (not in this version)");
  return 0;
}

export async function initCommand(args) {
  const folder = path.resolve(args[0] ?? process.cwd());
  if (!isEmptyFolder(folder)) {
    console.log(`devos: ${folder} is not empty; devos init starts from an empty folder`);
    return 1;
  }
  if (doctorCommand() !== 0) return 1;
  if (which("claude") === null) {
    console.log("devos: claude is not installed. Install Claude Code, then run: claude setup-token");
    return 1;
  }

  const read = lineReader(process.stdin);
  const text = contractText();
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  process.stdout.write("Type accept to continue: ");
  const acceptLine = await read();
  if (acceptLine === null) return ended();
  if (acceptLine.trim().toLowerCase() !== "accept") {
    console.log("devos: contract declined — nothing was written or sent");
    return 1;
  }

  const name = await ask(read, "Project name: ", "Project name", (line) => {
    const value = line.trim();
    return value === "" ? undefined : value;
  });
  if (name === null) return ended();
  if (name === undefined) return 1;

  const brief = await ask(read, "One-paragraph brief: ", "One-paragraph brief", (line) => {
    const value = line.trim();
    return value === "" ? undefined : value;
  });
  if (brief === null) return ended();
  if (brief === undefined) return 1;

  const users = await ask(read, "Who uses it: ", "Who uses it", (line) => {
    const value = line.trim();
    return value === "" ? undefined : value;
  });
  if (users === null) return ended();
  if (users === undefined) return 1;

  const stores = await ask(read, "Does it store data? (yes/no) [no]: ", "Does it store data? (yes/no)", (line) => {
    const value = line.trim() === "" ? "no" : line.trim().toLowerCase();
    return value === "yes" || value === "no" ? value : undefined;
  });
  if (stores === null) return ended();
  if (stores === undefined) return 1;

  const signIn = await ask(read, "Sign-in (none/email/oauth) [none]: ", "Sign-in (none/email/oauth)", (line) => {
    const value = line.trim() === "" ? "none" : line.trim().toLowerCase();
    return value === "none" || value === "email" || value === "oauth" ? value : undefined;
  });
  if (signIn === null) return ended();
  if (signIn === undefined) return 1;

  const languages = await ask(read, "Languages, comma-separated [en]: ", "Languages, comma-separated", (line) => {
    if (line.trim() === "") return ["en"];
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => !LANGUAGE.test(part))) return undefined;
    return parts;
  });
  if (languages === null) return ended();
  if (languages === undefined) return 1;

  const deploy = await ask(read, "Deploy target (vercel/none) [vercel]: ", "Deploy target (vercel/none)", (line) => {
    const value = line.trim() === "" ? "vercel" : line.trim().toLowerCase();
    return value === "vercel" || value === "none" ? value : undefined;
  });
  if (deploy === null) return ended();
  if (deploy === undefined) return 1;

  const visibilityDefault = profileVisibility();
  const visibility = await ask(
    read,
    `Repository visibility (private/public) [${visibilityDefault}]: `,
    "Repository visibility (private/public)",
    (line) => {
      const value = line.trim() === "" ? visibilityDefault : line.trim().toLowerCase();
      return value === "private" || value === "public" ? value : undefined;
    },
  );
  if (visibility === null) return ended();
  if (visibility === undefined) return 1;

  const key = keyFromName(name);
  mkdirSync(folder, { recursive: true });
  const installed = installInto(folder, key, { hold: [".claude/settings.json"] });
  if (installed.code !== 0) return 1;

  const answers = {
    $comment: "Your answers to devos init. The blueprint reads them; change them here and ask for changes.",
    name,
    key,
    brief,
    users,
    stores_data: stores === "yes",
    sign_in: signIn,
    languages,
    deploy,
    visibility,
    contract_version: CONTRACT_VERSION,
  };
  writeFileSync(path.join(folder, "devos", "answers.json"), `${JSON.stringify(answers, null, 2)}\n`);

  let next = { kind: "blueprint" };
  for (let round = 1; round <= 5; round += 1) {
    let input;
    if (next.kind === "blueprint") input = readFileSync(path.join(folder, "devos", "prompts", "blueprint.md"), "utf8");
    else if (next.kind === "repair") input = next.text;
    else {
      input = `The developer asks for these changes:\n${next.text}\n\nApply them to the documents and fence T01, keeping every rule of devos/prompts/blueprint.md.`;
    }
    const result = run("claude", claudeArgs(round), { cwd: folder, input, timeout: 3600000 });
    if (!result || result.status !== 0) {
      if (result?.stderr) process.stderr.write(result.stderr);
      console.log(`devos: the blueprint failed; delete ${folder} and run devos init again`);
      return 1;
    }
    printClaude(result.stdout);
    const check = checkBlueprint(folder);
    if (!check.ok) {
      if (round === 5) {
        console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
        return 1;
      }
      next = { kind: "repair", text: check.detail };
      continue;
    }
    console.log("Blueprint written:");
    for (const file of docsUnder(folder)) console.log(file);
    process.stdout.write("Type approve, or describe the changes you want: ");
    const decision = await read();
    if (decision === null) return ended();
    if (decision.trim().toLowerCase() === "approve") return finish(folder, installed.held);
    if (round === 5) {
      console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
      return 1;
    }
    next = { kind: "changes", text: decision.trim() };
  }
  console.log("devos: no approved blueprint after 5 rounds; the folder keeps the last one");
  return 1;
}
