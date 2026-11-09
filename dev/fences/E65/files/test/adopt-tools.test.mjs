// E65 (audit H2 and L1, the owner's D5 (a)): every AI tool stays selectable for an adoption, and each is made safe; one
// list of secret files. The arguments and permission files are checked here; the adoption flows in adopt.test.mjs and
// adopt-install.test.mjs check that they reach the tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADOPT_CURSOR_DENY, ADOPT_GEMINI_POLICY, ADOPT_IGNORE, ROUND_CONFIG, SECRET_EXAMPLES, SECRET_GLOBS, adoptAgentStop, adoptArgs, adoptClaudeSettings,
  adoptCursorBriefKit, adoptCursorDocKit, adoptDocArgs, checkAdoptDocs, claudeVersionStop, clearRoundConfig, secretFile, toolConfigStop, writeAdoptFence,
} from "../lib/adopt.mjs";
import { blueprintArgs } from "../lib/init.mjs";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintKit = () => JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "roles", "cursor-blueprint", "cli.json"), "utf8"));
const GEMINI_TAIL = ["--output-format", "json", "-p", "Follow the instructions given on standard input exactly."];

test("adopt-tools.test.mjs (a) one list of secret files: never read or copied, refused to the tools, ignored by git", () => {
  const secret = [".env", "app/.env.local", ".env.production", ".envrc", "certs/server.pem", "a.KEY", "store.jks", "id_ed25519", "ops/id_rsa", "proj-firebase-adminsdk-x1.json",
    "ci-service-account.json", "serviceAccountKey.json", "credentials.json", "credentials-prod.json", "gcp-credentials.json", "infra/prod.tfvars", "terraform.tfstate",
    "infra/terraform.tfstate.backup", ".npmrc", "web/.npmrc", ".netrc", ".pgpass"];
  const plain = [".env.example", "app/.env.sample", ".env.template", ".env.dist", ".envrc.example", "package.json", "keys.md", "README.key.md", "docs/credentials.md", "terraform.tf"];
  for (const file of secret) assert.equal(secretFile(file), true, file);
  for (const file of plain) assert.equal(secretFile(file), false, file);
  // The engine's .gitignore head is the toolchain-free part DEV_OS merges into a project: the list, then the examples.
  assert.deepEqual(ADOPT_IGNORE.slice(-SECRET_GLOBS.length - SECRET_EXAMPLES.length), [...SECRET_GLOBS, ...SECRET_EXAMPLES.map((name) => `!${name}`)]);
  const head = readFileSync(path.join(root, "payload", "files", "dot-gitignore"), "utf8").split("# Node / Next.js")[0];
  assert.deepEqual(head.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")), ADOPT_IGNORE);
  // git reads the list as secretFile does (case aside: git matches case as core.ignorecase says, secretFile ignores it).
  const repo = mkdtempSync(path.join(tmpdir(), "devos-ignore-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
    assert.equal(spawnSync("git", ["config", "core.ignorecase", "false"], { cwd: repo }).status, 0);
    writeFileSync(path.join(repo, ".gitignore"), `${ADOPT_IGNORE.join("\n")}\n`);
    const files = [...secret, ...plain].filter((file) => file !== "a.KEY");
    const ignored = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: repo, input: files.join("\n"), encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
    assert.deepEqual(ignored, secret.filter((file) => file !== "a.KEY"));
  } finally {
    cleanup(repo);
  }
});

test("adopt-tools.test.mjs (b) Claude Code in an adoption: files only, reads kept to its folder, no secret file, no project settings or CLAUDE.md", () => {
  assert.deepEqual(adoptClaudeSettings(), {
    permissions: { blockReadsOutsideWorkingDirectories: true, deny: ["Bash", "PowerShell", "WebFetch", "WebSearch", ...SECRET_GLOBS.map((glob) => `Read(**/${glob})`)] },
    claudeMdExcludes: ["**/CLAUDE.md", "**/CLAUDE.local.md", "**/.claude/rules/**"],
  });
  const safe = ["--allowedTools", "Read,Glob,Grep,Write,Edit", "--disallowedTools", "Bash,PowerShell,WebFetch,WebSearch", "--setting-sources", "user", "--strict-mcp-config", "--settings", "/s.fence/claude-settings.json"];
  assert.deepEqual(adoptArgs("claude", "claude-opus-5-5", false, "", "/s.fence/claude-settings.json"),
    ["-p", "--model", "claude-opus-5-5", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--max-turns", "120", ...safe]);
  assert.deepEqual(adoptDocArgs("claude", "claude-opus-5-5", 2, "", true, "/s.fence/claude-settings.json"),
    ["-p", "--model", "claude-opus-5-5", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--max-turns", "200", ...safe, "--continue"]);
  // The reads are kept to the folder from Claude Code 2.1.257 on; an older one stops the adoption, an unknown one does not.
  const old = "devos: Claude Code 2.1.256 cannot keep its reads to the project's copy in an adoption; update it to 2.1.257 or later (claude update), or choose another tool with --agent";
  assert.equal(claudeVersionStop("2.1.256 (Claude Code)"), old);
  for (const version of ["2.1.257 (Claude Code)", "2.2.0", "3.0.1", "", undefined]) assert.equal(claudeVersionStop(version), "", String(version));
  assert.equal(claudeVersionStop("1.99.999"), "devos: Claude Code 1.99.999 cannot keep its reads to the project's copy in an adoption; update it to 2.1.257 or later (claude update), or choose another tool with --agent");
  assert.equal(adoptAgentStop({ tool: "claude" }, [{ toolId: "claude", version: "2.1.256 (Claude Code)" }], []), old);
  assert.equal(adoptAgentStop({ tool: "cursor" }, [{ toolId: "claude", version: "2.1.256 (Claude Code)" }], []), "");
  // devos init, on the developer's own words, keeps the blueprint's web research and its two commands.
  const init = blueprintArgs("claude", "claude-opus-5-5", 1);
  assert.match(init[init.indexOf("--allowedTools") + 1], /WebFetch,WebSearch,Bash\(node scripts\/devos\/config\.mjs --write\)/);
});

test("adopt-tools.test.mjs (c) Cursor in an adoption has no shell, web page or MCP server, and reads no secret file in the documents rounds", () => {
  // Shell(*), with the commands named too in case a glob is not read, then no web page and no MCP server.
  assert.deepEqual(ADOPT_CURSOR_DENY, ["Shell(*)", "Shell(git)", "Shell(gh)", "Shell(curl)", "Shell(wget)", "Shell(rm)", "Shell(sudo)", "Shell(node)", "Shell(npm)",
    "Shell(npx)", "Shell(ls)", "Shell(cat)", "Shell(bash)", "Shell(sh)", "Shell(zsh)", "Shell(pwsh)", "Shell(powershell)", "Shell(cmd)", "Shell(python)", "Shell(python3)",
    "WebFetch(*)", "Mcp(*:*)"]);
  const brief = adoptCursorBriefKit().permissions;
  assert.deepEqual(brief.allow, ["Read(**)", "Write(brief/**)"]);
  assert.deepEqual(brief.deny, [...ADOPT_CURSOR_DENY, "Write(workspace/**)", "Write(survey.json)", "Write(adopt-input.md)", "Write(adopt-next.md)", "Write(.cursor/**)"]);
  for (const own of [false, true]) {
    const kit = adoptCursorDocKit(blueprintKit(), own).permissions;
    assert.deepEqual(kit.allow.filter((rule) => rule.startsWith("Shell(") || rule.startsWith("WebFetch(") || rule.startsWith("Mcp(")), []);
    assert.deepEqual(kit.deny.slice(0, ADOPT_CURSOR_DENY.length), ADOPT_CURSOR_DENY);
    assert.equal(new Set(kit.deny).size, kit.deny.length);
    for (const glob of SECRET_GLOBS) assert.equal(kit.deny.includes(`Read(**/${glob})`), true, glob);
    assert.equal(kit.allow.includes("Write(.devos/adopt/CLAUDE.md)"), true);
    assert.equal(kit.allow.includes("Write(CLAUDE.md)"), !own);
    assert.equal(kit.deny.includes("Write(CLAUDE.md)"), own);
    for (const rule of ["Write(.github/**)", "Write(scripts/**)", "Write(.cursor/cli.json)", "Read(.env*)"]) assert.equal(kit.deny.includes(rule), true, rule);
  }
  // The payload's kit, which devos init uses, is unchanged.
  assert.equal(blueprintKit().permissions.allow.includes("Shell(node)"), true);
  assert.deepEqual(adoptDocArgs("cursor", "grok-4.7", 2, "s-1", true), blueprintArgs("cursor", "grok-4.7", 2, "s-1", true));
});

test("adopt-tools.test.mjs (d) Gemini edits files only (auto_edit, never yolo) under a policy with no shell or web; Codex keeps its workspace sandbox", () => {
  const policy = ["--admin-policy", "/s.fence/gemini-policy.toml"];
  assert.deepEqual(adoptDocArgs("gemini", "gemini-2.5-pro", 1, "", false, "/s.fence/gemini-policy.toml"), ["--model", "gemini-2.5-pro", "--approval-mode", "auto_edit", ...policy, ...GEMINI_TAIL]);
  assert.deepEqual(adoptArgs("gemini", "gemini-2.5-pro", false, "", "/s.fence/gemini-policy.toml"), ["--model", "gemini-2.5-pro", "--approval-mode", "auto_edit", ...policy, ...GEMINI_TAIL]);
  assert.deepEqual(adoptArgs("gemini", "gemini-2.5-pro", false), ["--model", "gemini-2.5-pro", "--approval-mode", "auto_edit", ...GEMINI_TAIL]);
  assert.equal(ADOPT_GEMINI_POLICY, [
    "# devos adopt: the project's text may not be the developer's own, so Gemini reads and writes files only.",
    "[[rule]]",
    'toolName = ["run_shell_command", "web_fetch", "google_web_search"]',
    'decision = "deny"',
    "priority = 999",
    "",
  ].join("\n"));
  assert.deepEqual(blueprintArgs("gemini", "gemini-2.5-pro", 1), ["--model", "gemini-2.5-pro", "--approval-mode", "yolo", ...GEMINI_TAIL]);
  assert.deepEqual(adoptDocArgs("codex", "gpt-5.1-codex", 1), ["exec", "--model", "gpt-5.1-codex", "--sandbox", "workspace-write", "--json"]);
  assert.deepEqual(adoptArgs("codex", "gpt-5.1-codex", false), ["exec", "--model", "gpt-5.1-codex", "--sandbox", "workspace-write", "--json"]);
});

test("adopt-tools.test.mjs (e) devos writes devos.config.json from devos/project.json after each documents round", () => {
  const tree = mkdtempSync(path.join(tmpdir(), "devos-adopt-docs-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", tree]).status, 0);
    const install = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "install", tree, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(install.status, 0, install.stdout + install.stderr);
    cpSync(path.join(root, "test", "fixtures", "docs"), path.join(tree, "docs"), { recursive: true });
    mkdirSync(path.join(tree, "docs", "fences"), { recursive: true });
    cpSync(path.join(root, "test", "fixtures", "fences", "T01.md"), path.join(tree, "docs", "fences", "T01.md"));
    mkdirSync(path.join(tree, ".devos", "adopt"), { recursive: true });
    writeFileSync(path.join(tree, ".devos", "adopt", "CLAUDE.md"), "# CLAUDE.md\n");
    const projectFile = path.join(tree, "devos", "project.json");
    const project = JSON.parse(readFileSync(projectFile, "utf8"));
    writeFileSync(projectFile, `${JSON.stringify({ ...project, max_attempts: 4 }, null, 2)}\n`);
    const passed = checkAdoptDocs(tree);
    assert.equal(passed.ok, true, passed.detail);
    assert.equal(JSON.parse(readFileSync(path.join(tree, "devos.config.json"), "utf8")).max_attempts, 4);
    // A devos/project.json devos cannot read is the tool's to fix in its next round, and is said so.
    writeFileSync(projectFile, "{ not json\n");
    const failed = checkAdoptDocs(tree);
    assert.equal(failed.ok, false);
    assert.match(failed.detail, /^devos\.config\.json could not be written from devos\/project\.json:\n/m);
  } finally {
    cleanup(tree);
  }
});

test("adopt-tools.test.mjs (f) the fence file sits beside the staging folder, out of the tool's reach; a project's own tool configuration stops the adoption", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "devos-adopt-fence-"));
  try {
    const staging = path.join(parent, "devtest__demo-app");
    mkdirSync(staging);
    const settings = writeAdoptFence("claude", staging);
    assert.equal(settings, path.join(parent, "devtest__demo-app.fence", "claude-settings.json"));
    assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), adoptClaudeSettings());
    const policy = writeAdoptFence("gemini", staging);
    assert.equal(policy, path.join(parent, "devtest__demo-app.fence", "gemini-policy.toml"));
    assert.equal(readFileSync(policy, "utf8"), ADOPT_GEMINI_POLICY);
    // Each adoption writes it afresh.
    assert.equal(existsSync(settings), false);
    assert.equal(writeAdoptFence("cursor", staging), "");
    assert.equal(writeAdoptFence("codex", staging), "");
  } finally {
    cleanup(parent);
  }
  const files = [".cursor/mcp.json", ".cursor/rules/a.mdc", ".gemini/settings.json", ".gemini/extensions/x/gemini-extension.json", ".codex/config.toml", "app/page.tsx"];
  assert.equal(toolConfigStop("cursor", files), "devos: the project tracks .cursor/mcp.json, which Cursor would load and run while it writes the adoption; adopt with --agent claude, or remove it from the project first");
  assert.equal(toolConfigStop("gemini", files), "devos: the project tracks .gemini/settings.json, .gemini/extensions/x/gemini-extension.json, which Gemini CLI would load and run while it writes the adoption; adopt with --agent claude, or remove them from the project first");
  assert.equal(toolConfigStop("codex", files), "devos: the project tracks .codex/config.toml, which Codex would load and run while it writes the adoption; adopt with --agent claude, or remove it from the project first");
  assert.equal(toolConfigStop("claude", files), "");
  assert.equal(toolConfigStop("cursor", [".cursor/rules/a.mdc", ".cursor/mcp.example.json"]), "");
  assert.equal(adoptAgentStop({ tool: "gemini" }, [], files), toolConfigStop("gemini", files));
  // Case aside (Windows and macOS read .GEMINI as .gemini), and a tracked link in the folder's place.
  assert.equal(toolConfigStop("gemini", [".GEMINI/settings.json"]), "devos: the project tracks .GEMINI/settings.json, which Gemini CLI would load and run while it writes the adoption; adopt with --agent claude, or remove it from the project first");
  assert.equal(toolConfigStop("codex", [".codex"]), "devos: the project tracks .codex, which Codex would load and run while it writes the adoption; adopt with --agent claude, or remove it from the project first");
  assert.equal(toolConfigStop("cursor", [".Cursor/MCP.json"]).startsWith("devos: the project tracks .Cursor/MCP.json,"), true);
  assert.equal(toolConfigStop("gemini", [".geminirc", "docs/.gemini/x"]), "");
  // What a tool could leave in the brief's folder for its next round is removed before each round; the rest stays.
  const brief = mkdtempSync(path.join(tmpdir(), "devos-adopt-round-"));
  try {
    for (const file of [".gemini/settings.json", ".codex/config.toml", ".claude/settings.json", ".mcp.json", ".cursor/mcp.json", ".cursor/hooks.json", ".cursor/hooks/a.mjs", ".cursor/cli.json", "brief/brief.md"]) {
      mkdirSync(path.dirname(path.join(brief, file)), { recursive: true });
      writeFileSync(path.join(brief, file), "x\n");
    }
    clearRoundConfig(brief);
    for (const entry of ROUND_CONFIG) assert.equal(existsSync(path.join(brief, entry)), false, entry);
    assert.equal(existsSync(path.join(brief, ".cursor", "cli.json")), true);
    assert.equal(existsSync(path.join(brief, "brief", "brief.md")), true);
  } finally {
    cleanup(brief);
  }
});

test("adopt-tools.test.mjs (g) the adoption's instructions say the tool runs no command, and devos runs what it needs", () => {
  const text = readFileSync(path.join(root, "lib", "data", "adopt-blueprint.md"), "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.includes("0. **You run no command and open no web page.**"));
  assert.ok(text.includes("after each round devos writes `devos.config.json` from `devos/project.json`, runs `fence-check` on T01 and\n   DEV_OS's document guards, and gives you what fails."));
  assert.ok(text.includes("   - `devos/project.json` (devos writes `devos.config.json` from it);"));
  assert.equal(text.includes("then `node scripts/devos/config.mjs --write`"), false);
});
