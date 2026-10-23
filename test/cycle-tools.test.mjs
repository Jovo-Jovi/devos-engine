import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { validate } from "../payload/files/scripts/devos/agents.mjs";
import { cliArgs, normalize } from "../payload/files/scripts/devos/agent-cli.mjs";
import { looksLikeLimit } from "../payload/files/scripts/devos/limits.mjs";
import { blueprintEnv } from "../lib/init.mjs";
import { checkRoster } from "../lib/roster.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipWindows = process.platform === "win32";

function agent(tool, id = "a") {
  return { id, tool, model: "m" };
}

function poolItem(tool, id = "p", isDefault = true) {
  return { id, tool, model: "m", default: isDefault, note: "" };
}

function agentsFor(tool) {
  return {
    reviewer: agent(tool, "r"),
    reviewer_light: agent(tool, "l"),
    pool: [poolItem(tool)],
    policy: "reviewer-picks",
  };
}

function stage(dir) {
  const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(staged.status, 0, staged.stderr);
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function repo(dir) {
  assert.equal(git(["init"], dir).status, 0);
  assert.equal(git(["config", "maintenance.auto", "false"], dir).status, 0);
  assert.equal(git(["config", "gc.auto", "0"], dir).status, 0);
  assert.equal(git(["config", "user.email", "devos@example.com"], dir).status, 0);
  assert.equal(git(["config", "user.name", "devos"], dir).status, 0);
  assert.equal(git(["config", "core.autocrlf", "false"], dir).status, 0);
  assert.equal(git(["add", "-A"], dir).status, 0);
  const committed = git(["commit", "-m", "init"], dir);
  assert.equal(committed.status, 0, committed.stderr);
}

test("cycle-tools.test.mjs (a) validate accepts codex and gemini", () => {
  validate(agentsFor("codex"));
  validate(agentsFor("gemini"));
  assert.throws(
    () => validate({
      reviewer: agent("claude", "r"),
      reviewer_light: null,
      pool: [poolItem("glm")],
      policy: "reviewer-picks",
    }),
    /agents: pool item tool must be cursor, claude, codex or gemini/,
  );
});

test("cycle-tools.test.mjs (b) tools lists the agents in use", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-cycle-"));
  try {
    stage(dir);
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    const project = {
      ...JSON.parse(template.replaceAll("__PROJECT_KEY__", "DEMO")),
      agents: {
        reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
        reviewer_light: { id: "cursor-light", tool: "cursor", model: "grok-4.7" },
        pool: [{ id: "codex-gpt", tool: "codex", model: "gpt-5.1-codex", default: true, note: "" }],
        policy: "reviewer-picks",
      },
    };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(written.status, 0, written.stderr);
    const tools = spawnSync(process.execPath, ["scripts/devos/agents.mjs", "tools"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(tools.status, 0, tools.stderr);
    assert.equal(tools.stdout.trim(), "tools=claude codex cursor");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (c) codex builder arguments", () => {
  assert.deepEqual(cliArgs({ tool: "codex", role: "builder", model: "M", effort: "low", last: "last.md" }), [
    "codex", "exec", "--model", "M", "--sandbox", "workspace-write",
    "-c", "sandbox_workspace_write.network_access=true",
    "-c", "model_reasoning_effort=\"low\"",
    "-c", "mcp_servers.context7.url=\"https://mcp.context7.com/mcp\"",
    "--json", "-o", "last.md",
  ]);
  assert.deepEqual(cliArgs({ tool: "codex", role: "builder", model: "M", effort: "max", last: "last.md" }), [
    "codex", "exec", "--model", "M", "--sandbox", "workspace-write",
    "-c", "sandbox_workspace_write.network_access=true",
    "-c", "model_reasoning_effort=\"high\"",
    "-c", "mcp_servers.context7.url=\"https://mcp.context7.com/mcp\"",
    "--json", "-o", "last.md",
  ]);
});

test("cycle-tools.test.mjs (d) codex reviewer arguments", () => {
  assert.deepEqual(cliArgs({ tool: "codex", role: "reviewer", model: "M", effort: "xhigh", last: "last.md" }), [
    "codex", "exec", "--model", "M", "--sandbox", "workspace-write",
    "-c", "model_reasoning_effort=\"xhigh\"",
    "-c", "mcp_servers.context7.url=\"https://mcp.context7.com/mcp\"",
    "--json", "-o", "last.md",
  ]);
});

test("cycle-tools.test.mjs (e) gemini arguments", () => {
  const expected = ["gemini", "--model", "M", "--approval-mode", "yolo", "--output-format", "json", "-p"];
  assert.deepEqual(cliArgs({ tool: "gemini", role: "builder", model: "M", effort: "low", last: "last.md" }), expected);
  assert.deepEqual(cliArgs({ tool: "gemini", role: "reviewer", model: "M", effort: "max", last: "last.md" }), expected);
});

test("cycle-tools.test.mjs (f) codex normalize prefers the stream", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-norm-"));
  try {
    const raw = path.join(dir, "raw.jsonl");
    const stream = `${raw}.stream.jsonl`;
    const last = path.join(dir, "last.md");
    const out = path.join(dir, "out.json");
    const streamEvents = [
      { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } },
      { type: "item.completed", item: { type: "agent_message", text: "partial" } },
      { type: "turn.completed", usage: { input_tokens: 50, output_tokens: 5 } },
    ];
    writeFileSync(stream, `${streamEvents.map((event) => JSON.stringify(event)).join("\n")}\n`);
    writeFileSync(raw, `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`);
    writeFileSync(last, "DONE\n");
    const result = spawnSync(process.execPath, [
      path.join(root, "payload", "files", "scripts", "devos", "agent-cli.mjs"),
      "normalize", "--tool", "codex", "--raw", raw, "--last", last, "--out", out,
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(parsed.result, "DONE");
    assert.equal(parsed.is_error, false);
    assert.deepEqual(parsed.usage, { input_tokens: 150, output_tokens: 25 });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (g) codex limit text is an error result", () => {
  const raw = `${JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit." } })}\n`;
  const parsed = normalize({ tool: "codex", rawText: raw, lastText: "" });
  assert.equal(parsed.is_error, true);
  assert.equal(looksLikeLimit(parsed.result), true);
});

test("cycle-tools.test.mjs (h) gemini normalize", () => {
  const ok = normalize({
    tool: "gemini",
    rawText: JSON.stringify({ response: "ok", stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 10, candidates: 3 } } } } }),
    lastText: "",
  });
  assert.equal(ok.result, "ok");
  assert.equal(ok.is_error, false);
  assert.deepEqual(ok.usage, { input_tokens: 10, output_tokens: 3 });
  const quota = normalize({ tool: "gemini", rawText: "{\"error\":{\"message\":\"Quota exceeded\"}}", lastText: "" });
  assert.equal(quota.is_error, true);
  const text = normalize({ tool: "gemini", rawText: "not json", lastText: "" });
  assert.equal(text.is_error, true);
});

test("cycle-tools.test.mjs (i) codex and gemini kits restore the original file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-kit-"));
  try {
    stage(dir);
    const agents = path.join(dir, "AGENTS.md");
    const gemini = path.join(dir, "GEMINI.md");
    writeFileSync(agents, "original agents\n");
    writeFileSync(gemini, "original gemini\n");
    writeFileSync(path.join(dir, "CLAUDE.md"), "project reviewer rules\n");
    repo(dir);
    const role = path.join(dir, "scripts", "devos", "role-env.mjs");
    const run = (args) => spawnSync(process.execPath, [role, ...args], { cwd: dir, encoding: "utf8", windowsHide: true });
    const kits = [
      ["codex-builder", agents, path.join(dir, "devos", "roles", "claude-builder", "CLAUDE.md")],
      ["codex-reviewer", agents, path.join(dir, "CLAUDE.md")],
      ["gemini-builder", gemini, path.join(dir, "devos", "roles", "claude-builder", "CLAUDE.md")],
      ["gemini-reviewer", gemini, path.join(dir, "CLAUDE.md")],
    ];
    for (const [kit, dest, source] of kits) {
      const original = readFileSync(dest);
      const swapped = run(["swap", kit]);
      assert.equal(swapped.status, 0, swapped.stderr);
      assert.deepEqual(readFileSync(dest), readFileSync(source));
      const restored = run(["restore"]);
      assert.equal(restored.status, 0, restored.stderr);
      assert.deepEqual(readFileSync(dest), original);
      assert.equal(existsSync(path.join(dir, ".devos", "role-stash")), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (j) accounts for codex and gemini", { skip: skipWindows }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-acct-"));
  try {
    stage(dir);
    const script = [
      "set -eu",
      ". scripts/devos/accounts.sh",
      "unset DEVOS_CURSOR_ACCOUNT DEVOS_CLAUDE_ACCOUNT DEVOS_CODEX_ACCOUNT DEVOS_GEMINI_ACCOUNT DEVOS_ACCOUNT_SWITCH || true",
      "unset CODEX_KEY_1 || true",
      "export CODEX_KEY_2=two",
      "export OPENAI_API_KEY=old",
      "echo \"codex=$(devos_accounts codex)\"",
      "export GEMINI_KEY_1=a GEMINI_KEY_2=b DEVOS_GEMINI_ACCOUNT=2",
      "echo \"gemini=$(devos_accounts gemini)\"",
      "export CODEX_KEY_1=one",
      "devos_use_codex 1",
      "if [ \"$CODEX_API_KEY\" = \"$CODEX_KEY_1\" ] && [ -z \"${OPENAI_API_KEY+x}\" ]; then echo use=ok; else echo use=bad; fi",
      "export CURSOR_KEY_1=c",
      "unset CURSOR_KEY_2 || true",
      "echo \"cursor=$(devos_accounts cursor)\"",
    ].join("\n");
    const result = spawnSync("bash", ["-lc", script], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^codex=2$/m);
    assert.match(result.stdout, /^gemini=2 1$/m);
    assert.match(result.stdout, /^use=ok$/m);
    assert.match(result.stdout, /^cursor=1$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (k) codex builder switches accounts", { skip: skipWindows }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-run-"));
  try {
    stage(dir);
    repo(dir);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const seen = path.join(dir, ".devos-seen-agents.md");
    writeFileSync(path.join(bin, "codex"), [
      "#!/bin/sh",
      "if [ -f AGENTS.md ]; then cp AGENTS.md \"$DEVOS_SEEN\"; fi",
      "prev=''",
      "last=''",
      "for arg in \"$@\"; do",
      "  if [ \"$prev\" = '-o' ]; then last=$arg; fi",
      "  prev=$arg",
      "done",
      "if [ \"$CODEX_API_KEY\" = 'limit-key' ]; then",
      "  echo \"You've hit your usage limit\" >&2",
      "  exit 1",
      "fi",
      "printf '%s\\n' DONE > \"$last\"",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 });
    mkdirSync(path.join(dir, ".devos"));
    writeFileSync(path.join(dir, ".devos", "builder-prompt.md"), "build\n");
    const result = spawnSync("bash", ["scripts/devos/run-agent.sh", "builder", "codex", "M", "high", ".devos/builder-prompt.md"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        CODEX_KEY_1: "limit-key",
        CODEX_KEY_2: "ok-key",
        DEVOS_WATCHDOG_TICK: "1",
        DEVOS_SEEN: seen,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const env = readFileSync(path.join(dir, ".devos", "builder-run.env"), "utf8");
    assert.match(env, /^code=0$/m);
    assert.match(env, /^used=2$/m);
    assert.equal(existsSync(path.join(dir, ".devos", "limits", "codex-1.txt")), true);
    const json = JSON.parse(readFileSync(path.join(dir, ".devos", "builder.json"), "utf8"));
    assert.equal(json.result, "DONE");
    const notes = readFileSync(path.join(dir, ".devos", "accounts.md"), "utf8");
    assert.match(notes, /Builder: Codex account 1 reached its usage limit/);
    assert.deepEqual(readFileSync(seen), readFileSync(path.join(dir, "devos", "roles", "claude-builder", "CLAUDE.md")));
    assert.equal(existsSync(path.join(dir, "AGENTS.md")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (l) gemini reviewer sees its kit and policy", { skip: skipWindows }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-gem-"));
  const home = mkdtempSync(path.join(tmpdir(), "devos-home-"));
  try {
    stage(dir);
    writeFileSync(path.join(dir, "CLAUDE.md"), "project reviewer rules\n");
    repo(dir);
    const bin = path.join(dir, "bin");
    const seen = path.join(dir, ".devos-seen");
    mkdirSync(bin);
    mkdirSync(seen);
    writeFileSync(path.join(bin, "gemini"), [
      "#!/bin/sh",
      "printf '%s' \"$GEMINI_CLI_TRUST_WORKSPACE\" > \"$DEVOS_SEEN/trust\"",
      "cp GEMINI.md \"$DEVOS_SEEN/gemini.md\"",
      "cp \"$HOME/.gemini/policies/devos.toml\" \"$DEVOS_SEEN/policy.toml\"",
      "cp \"$HOME/.gemini/settings.json\" \"$DEVOS_SEEN/settings.json\"",
      "printf '%s\\n' '{\"response\":\"ok\"}'",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 });
    mkdirSync(path.join(dir, ".devos"));
    writeFileSync(path.join(dir, ".devos", "reviewer-prompt.md"), "review\n");
    const result = spawnSync("bash", ["scripts/devos/run-agent.sh", "reviewer", "gemini", "M", "high", ".devos/reviewer-prompt.md"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        GEMINI_KEY_1: "present",
        DEVOS_SEEN: seen,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(path.join(seen, "trust"), "utf8"), "true");
    assert.deepEqual(readFileSync(path.join(seen, "gemini.md")), readFileSync(path.join(dir, "CLAUDE.md")));
    assert.deepEqual(readFileSync(path.join(seen, "policy.toml")), readFileSync(path.join(dir, "devos", "roles", "gemini", "policy.toml")));
    assert.deepEqual(readFileSync(path.join(seen, "settings.json")), readFileSync(path.join(dir, "devos", "roles", "gemini", "settings.json")));
    const env = readFileSync(path.join(dir, ".devos", "reviewer-run.env"), "utf8");
    assert.match(env, /^code=0$/m);
    assert.match(env, /^used=1$/m);
    assert.equal(existsSync(path.join(dir, "GEMINI.md")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function countOf(text, needle) {
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

test("cycle-tools.test.mjs (m) the cycle workflow keeps the proven commands and adds Codex and Gemini", () => {
  const text = readFileSync(path.join(root, "payload", "files", "dot-github", "workflows", "devos-cycle.yml"), "utf8");
  assert.equal(countOf(text, "agent -p --force --trust --approve-mcps --model \"$MODEL\" --output-format stream-json \"$(cat .devos/builder-prompt.md)\""), 2);
  assert.equal(countOf(text, "agent -p --force --trust --approve-mcps --model \"$MODEL\" --output-format stream-json \"$(cat .devos/reviewer-prompt.md)\""), 1);
  assert.equal(countOf(text, "claude -p \"$(cat .devos/builder-prompt.md)\" --model \"$MODEL\" --effort \"$EFFORT\" --output-format json --permission-mode dontAsk"), 2);
  assert.equal(countOf(text, "claude -p \"$(cat .devos/reviewer-prompt.md)\""), 1);
  assert.equal(countOf(text, "bash scripts/devos/run-agent.sh builder"), 2);
  assert.equal(countOf(text, "bash scripts/devos/run-agent.sh reviewer"), 1);
  assert.equal(countOf(text, "npm install -g @openai/codex"), 1);
  assert.equal(countOf(text, "npm install -g @google/gemini-cli"), 1);
  assert.equal(countOf(text, "--mcp-config devos/ci/mcp.claude.json"), 3);
  assert.equal(countOf(text, "Skill,mcp__context7\""), 3);
  assert.equal(countOf(text, "cp devos/ci/mcp.ci.json .cursor/mcp.json"), 2);
  for (const name of ["OPENAI_API_KEY", "OPENAI_API_KEY_2", "GEMINI_API_KEY", "GEMINI_API_KEY_2"]) {
    assert.equal(text.includes(`"${name}":"\${{ secrets.${name} != '' && '1' || '' }}"`), true, name);
  }
  assert.equal(text.includes("DEVOS_CODEX_ACCOUNT: ${{ vars.DEVOS_CODEX_ACCOUNT || '1' }}"), true);
  assert.equal(text.includes("DEVOS_GEMINI_ACCOUNT: ${{ vars.DEVOS_GEMINI_ACCOUNT || '1' }}"), true);
});

test("cycle-tools.test.mjs (n) a codex pool needs an OpenAI key for the cycle", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "devos-setup-"));
  try {
    stage(dir);
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    const project = {
      ...JSON.parse(template.replaceAll("__PROJECT_KEY__", "DEMO")),
      agents: {
        reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
        reviewer_light: { id: "cursor-light", tool: "cursor", model: "grok-4.7" },
        pool: [{ id: "codex-gpt", tool: "codex", model: "gpt-5.1-codex", default: true, note: "" }],
        policy: "reviewer-picks",
      },
    };
    writeFileSync(path.join(dir, "devos", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), [
      "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |",
      "|---|---|---|---|---|---|---|---|",
      "| T01 | 1 | 1 | One | 1 | — | [ ] | — |",
      "",
    ].join("\n"));
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(written.status, 0, written.stderr);
    const told = {
      OPENAI_API_KEY: "",
      OPENAI_API_KEY_2: "",
      CURSOR_API_KEY: "",
      CURSOR_API_KEY_2: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN_2: "",
      ANTHROPIC_API_KEY_2: "",
    };
    const missing = spawnSync(process.execPath, ["scripts/devos/setup-check.mjs", "--for", "cycle"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, SECRETS_JSON: JSON.stringify(told), VARS_JSON: "{}" },
    });
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.equal(missing.stdout.includes("OPENAI_API_KEY"), true, missing.stdout);
    const present = spawnSync(process.execPath, ["scripts/devos/setup-check.mjs", "--for", "cycle"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        SECRETS_JSON: JSON.stringify({ ...told, OPENAI_API_KEY: "1", CURSOR_API_KEY: "1", CLAUDE_CODE_OAUTH_TOKEN: "1" }),
        VARS_JSON: "{}",
      },
    });
    assert.equal(present.stdout.includes("OPENAI_API_KEY"), false, present.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (o) blueprintEnv trusts only Gemini", () => {
  assert.deepEqual(blueprintEnv("gemini", {}), { GEMINI_CLI_TRUST_WORKSPACE: "true" });
  assert.deepEqual(blueprintEnv("codex", { A: "1" }), { A: "1" });
});

test("cycle-tools.test.mjs (q) a gemini run drops a stale cursor stream", { skip: skipWindows }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-stale-"));
  const home = mkdtempSync(path.join(tmpdir(), "devos-home-"));
  try {
    stage(dir);
    repo(dir);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gemini"), [
      "#!/bin/sh",
      "printf '%s\\n' '{\"response\":\"GEMINI\",\"stats\":{\"models\":{}}}'",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 });
    const devos = path.join(dir, ".devos");
    mkdirSync(devos);
    writeFileSync(path.join(devos, "builder-prompt.md"), "build\n");
    writeFileSync(path.join(devos, "builder.json.stream.jsonl"), "{\"type\":\"result\",\"result\":\"CURSOR\"}\n");
    const result = spawnSync("bash", ["scripts/devos/run-agent.sh", "builder", "gemini", "M", "high", ".devos/builder-prompt.md"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        GEMINI_KEY_1: "present",
        DEVOS_WATCHDOG_TICK: "1",
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const json = JSON.parse(readFileSync(path.join(devos, "builder.json"), "utf8"));
    assert.equal(json.result, "GEMINI");
    assert.equal(json.is_error, false);
    assert.equal(existsSync(path.join(devos, "builder.json.stream.jsonl")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (p) the roster accepts Codex and Gemini", () => {
  const roster = checkRoster({
    reviewer: { id: "codex-review", tool: "codex", model: "gpt-5.1-codex" },
    reviewer_light: null,
    pool: [{ id: "gemini-pool", tool: "gemini", model: "gemini-2.5-pro", default: true, note: "" }],
    policy: "reviewer-picks",
  });
  assert.equal(roster.reviewer.tool, "codex");
  assert.equal(roster.pool[0].tool, "gemini");
});

test("cycle-tools.test.mjs (s) the prompts keep the work lean", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-lean-"));
  try {
    stage(dir);
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "PHASES.md"), [
      "| Task | Phase | Station | Name | Risk | Gate | Done | Verdict |",
      "|---|---|---|---|---|---|---|---|",
      "| T01 | E | 1 | One | 1 | — | [ ] | — |",
      "",
    ].join("\n"));
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    writeFileSync(path.join(dir, "devos", "project.json"), template.replaceAll("__PROJECT_KEY__", "DEMO"));
    const written = spawnSync(process.execPath, ["scripts/devos/config.mjs", "--write"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(written.status, 0, written.stderr);
    const render = (role) => spawnSync(process.execPath, ["scripts/devos/render-prompt.mjs", role, "T01", "1"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
    const builder = render("builder");
    assert.equal(builder.status, 0, builder.stderr);
    assert.equal(builder.stdout.includes("Keep it lean: make the simplest change that meets the fence."), true, builder.stdout);
    const reviewer = render("reviewer");
    assert.equal(reviewer.status, 0, reviewer.stderr);
    assert.equal(reviewer.stdout.includes("proportion (a dependency, abstraction, layer or configuration the fence does not need is scope"), true, reviewer.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("cycle-tools.test.mjs (r) every tool's Context7 config names the same server", () => {
  const files = [
    ["payload/files/devos/ci/mcp.ci.json", "url"],
    ["payload/files/devos/ci/mcp.claude.json", "url"],
    ["payload/files/devos/roles/gemini/settings.json", "httpUrl"],
  ];
  for (const [rel, key] of files) {
    const json = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
    assert.equal(json.mcpServers.context7[key], "https://mcp.context7.com/mcp", rel);
  }
});
