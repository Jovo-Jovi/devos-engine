import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  getAdapter,
  looksLikeCommandRejection,
  looksLikeModelRejection,
  looksLikePlanRestriction,
  looksLikeTrustGate,
  looksLikeUsageLimit,
} from "../lib/adapters.mjs";
import { clearAccountCache, ghPreflight, parseAccountText } from "../lib/accounts.mjs";
import { neededKeys } from "../lib/keys.mjs";
import { customAgent, detectAgents, familyOf, groupModels, modelLabel } from "../lib/probes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "test", "fixtures", "agents");
const windows = process.platform === "win32";
const tools = JSON.parse(readFileSync(path.join(root, "lib", "data", "tools.json"), "utf8"));

function useFakes() {
  if (!windows) {
    for (const name of ["claude", "agent", "codex", "gemini", "z", "gh"]) {
      chmodSync(path.join(fixtures, name), 0o755);
    }
  }
  const previous = process.env.PATH;
  process.env.PATH = `${fixtures}${path.delimiter}${previous}`;
  return () => {
    process.env.PATH = previous;
    delete process.env.DEVOS_GH_MISSING_SCOPES;
    delete process.env.DEVOS_GH_BAD_TOKEN;
    delete process.env.DEVOS_AGENT_STATUS_FAIL;
  };
}

test("agents-kit.test.mjs familyOf groups known model ids", () => {
  assert.equal(familyOf("grok-4.7"), "grok");
  assert.equal(familyOf("claude-opus-5-5"), "claude");
  assert.equal(familyOf("fable-5"), "claude");
  assert.equal(familyOf("gpt-5.6-sol"), "gpt");
  assert.equal(familyOf("o3-mini"), "gpt");
  assert.equal(familyOf("gemini-2.5-pro"), "gemini");
  assert.equal(familyOf("composer-2.5"), "composer");
  assert.equal(familyOf("glm-4.6"), "glm");
  assert.equal(familyOf("muse-wonder"), "muse");
  assert.equal(familyOf("weird-model-9"), "other");
});

test("agents-kit.test.mjs groupModels sorts an account's models first", () => {
  const groups = groupModels(
    [{ id: "grok", label: "Grok", models: ["grok-4.7", "grok-4.5"] }],
    ["grok-4.7", "weird-model-9"],
  );
  const grok = groups.find((group) => group.id === "grok");
  assert.equal(grok.models[0].id, "grok-4.7");
  assert.equal(grok.models[0].available, true);
  assert.equal(grok.models[0].reported, false);
  assert.equal(grok.models.length, 1);
  const other = groups.find((group) => group.id === "other");
  assert.equal(other.models[0].reported, true);
  assert.equal(modelLabel(grok.models[0]), "grok-4.7 — on your account");
  assert.equal(modelLabel({ id: "grok-4.5", available: false, reported: false }), "grok-4.5");
  assert.equal(modelLabel(other.models[0]), "weird-model-9 — on your account");
});

test("agents-kit.test.mjs cursor groups come from seeds plus reported ids", () => {
  const restore = useFakes();
  try {
    const cursor = detectAgents().find((agent) => agent.toolId === "cursor");
    assert.equal(cursor.status, "installed");
    assert.equal(cursor.githubCapable, true);
    const groupIds = cursor.groups.map((group) => group.id);
    for (const fam of ["grok", "claude", "gpt", "gemini", "composer", "other"]) {
      assert.equal(groupIds.includes(fam), true, groupIds.join(","));
    }
    const grok = cursor.groups.find((group) => group.id === "grok");
    assert.equal(grok.models.some((model) => model.id === "grok-4.7" && !model.reported), true);
    const claudeOnCursor = cursor.groups.find((group) => group.id === "claude");
    assert.deepEqual(claudeOnCursor.models.map((model) => model.id), ["claude-sonnet-5-5"]);
    assert.equal(cursor.groups.every((group) => group.models.every((model) => model.available)), true);
    const other = cursor.groups.find((group) => group.id === "other");
    assert.equal(other.models.some((model) => model.id === "weird-model-9" && model.reported), true);
    const offered = cursor.groups.flatMap((group) => group.models.map((model) => model.id));
    const seeded = tools.tools.find((tool) => tool.id === "cursor").seedGroups.flatMap((group) => group.models);
    assert.deepEqual(offered.filter((id) => !seeded.includes(id)), ["gpt-5.1", "gemini-2.5-pro", "weird-model-9"]);
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs claude seeds stay offered when the CLI is signed in", () => {
  const restore = useFakes();
  try {
    const claude = detectAgents().find((agent) => agent.toolId === "claude");
    assert.equal(claude.status, "installed");
    assert.equal(claude.signedIn, true);
    const ids = claude.groups.flatMap((group) => group.models.map((model) => model.id));
    for (const seed of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      assert.equal(ids.includes(seed), true, seed);
    }
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs codex and gemini are GitHub-capable and glm lists its ids", () => {
  const restore = useFakes();
  try {
    const agents = detectAgents();
    const codex = agents.find((agent) => agent.toolId === "codex");
    assert.equal(codex.githubCapable, true);
    assert.deepEqual(codex.githubSecrets, ["OPENAI_API_KEY"]);
    const gemini = agents.find((agent) => agent.toolId === "gemini");
    assert.equal(gemini.githubCapable, true);
    const glm = agents.find((agent) => agent.toolId === "glm");
    assert.equal(glm.status, "installed");
    const ids = glm.groups.flatMap((group) => group.models.map((model) => model.id));
    assert.equal(ids.includes("glm-4.6") && ids.includes("glm-5"), true);
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs muse stays missing and invents no model id", () => {
  const restore = useFakes();
  try {
    const muse = detectAgents().find((agent) => agent.toolId === "muse");
    assert.equal(muse.status, "missing");
    assert.equal(muse.notInstalledMessage, "Muse is not installed");
    assert.equal(muse.groups.length, 0);
    assert.equal(muse.reportedIds.length, 0);
    assert.equal(/muse-\d/.test(JSON.stringify(muse)), false);
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs an installed muse lists its models and a custom tool without a prompt stays local", () => {
  const restore = useFakes();
  const extra = mkdtempSync(path.join(tmpdir(), "devos-muse-"));
  const previous = process.env.PATH;
  try {
    const script = [
      "const argv = process.argv.slice(2);",
      "if (argv.includes('--version')) { console.log('muse 0.9'); process.exit(0); }",
      "if (argv[0] === 'models') { console.log('muse-1'); console.log('muse-2'); process.exit(0); }",
      "process.exit(1);",
    ].join("\n");
    writeFileSync(path.join(extra, "muse.mjs"), `${script}\n`);
    if (windows) writeFileSync(path.join(extra, "muse.cmd"), "@node \"%~dp0muse.mjs\" %*\r\n");
    else {
      const file = path.join(extra, "muse");
      writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
      chmodSync(file, 0o755);
    }
    process.env.PATH = `${extra}${path.delimiter}${previous}`;
    const muse = detectAgents().find((agent) => agent.toolId === "muse");
    assert.equal(muse.status, "installed");
    assert.deepEqual(muse.groups.flatMap((group) => group.models.map((model) => model.id)), ["muse-1", "muse-2"]);
    const localOnly = customAgent({ command: "mytool", displayName: "My Tool" });
    assert.equal(localOnly.localOnly, true);
    assert.equal(localOnly.githubCapable, false);
  } finally {
    process.env.PATH = previous;
    restore();
    rmSync(extra, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("agents-kit.test.mjs ghPreflight reads the login, the scopes, and a working token", () => {
  const restore = useFakes();
  try {
    const preflight = ghPreflight();
    assert.equal(preflight.signedIn, true);
    assert.equal(preflight.login, "octodev");
    assert.equal(preflight.scopes.includes("repo"), true);
    assert.equal(preflight.scopes.includes("workflow"), true);
    assert.equal(preflight.tokenWorks, true);
    assert.equal(preflight.ok, true, preflight.problems.join(" | "));
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs a token missing the workflow scope names the refresh fix", () => {
  const restore = useFakes();
  try {
    process.env.DEVOS_GH_MISSING_SCOPES = "1";
    const preflight = ghPreflight();
    assert.equal(preflight.ok, false);
    assert.equal(preflight.problems.join(" ").includes("workflow"), true, preflight.problems.join(" | "));
    assert.equal(preflight.fixes.join(" ").includes("gh auth refresh -h github.com -s workflow"), true, preflight.fixes.join(" | "));
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs a token the API rejects is a problem", () => {
  const restore = useFakes();
  try {
    process.env.DEVOS_GH_BAD_TOKEN = "1";
    const preflight = ghPreflight();
    assert.equal(preflight.signedIn, true);
    assert.equal(preflight.tokenWorks, false);
    assert.equal(preflight.ok, false);
    assert.equal(preflight.fixes.join(" ").includes("gh auth login"), true, preflight.fixes.join(" | "));
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs ghPreflight reports a missing gh", () => {
  const previous = process.env.PATH;
  try {
    process.env.PATH = "";
    const preflight = ghPreflight();
    assert.equal(preflight.installed, false);
    assert.equal(preflight.ok, false);
  } finally {
    process.env.PATH = previous;
  }
});

test("agents-kit.test.mjs cursor reports its account and plan and available models sort first", () => {
  const restore = useFakes();
  try {
    clearAccountCache();
    const cursor = detectAgents().find((agent) => agent.toolId === "cursor");
    assert.equal(cursor.account.signedIn, true);
    assert.equal(cursor.account.email, "marco@example.com");
    assert.equal(cursor.account.plan, "pro");
    const grok = cursor.groups.find((group) => group.id === "grok");
    assert.equal(grok.models[0].available, true);
    const claudeGroup = cursor.groups.find((group) => group.id === "claude");
    assert.equal(claudeGroup.models.length > 0, true);
    assert.equal(claudeGroup.models.every((model) => model.available), true);
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs an unreadable account probe is unknown", () => {
  const restore = useFakes();
  try {
    clearAccountCache();
    process.env.DEVOS_AGENT_STATUS_FAIL = "1";
    const cursor = detectAgents().find((agent) => agent.toolId === "cursor");
    assert.equal(cursor.account.signedIn, "unknown");
    assert.equal(cursor.account.email, null);
  } finally {
    restore();
  }
});

test("agents-kit.test.mjs parseAccountText picks email and plan variants", () => {
  assert.equal(parseAccountText("Signed in as a.b+x@sub.example.co.uk (Pro plan)").email, "a.b+x@sub.example.co.uk");
  assert.equal(parseAccountText("Signed in as a.b+x@sub.example.co.uk (Pro plan)").plan, "pro");
  assert.equal(parseAccountText("plan: Ultra").plan, "ultra");
  assert.equal(parseAccountText("Logged in using ChatGPT\nAccount: dev@x.io (Pro)").email, "dev@x.io");
  assert.equal(parseAccountText("no info here").plan, null);
  assert.equal(parseAccountText("no info here").email, null);
});

test("agents-kit.test.mjs usage limit classifier", () => {
  assert.equal(looksLikeUsageLimit("You've hit your weekly usage limit. Your limit will reset on Monday."), true);
  assert.equal(looksLikeUsageLimit("limit resets on Oct 30"), true);
  assert.equal(looksLikeUsageLimit("all tests passed"), false);
});

test("agents-kit.test.mjs trust gate classifier", () => {
  assert.equal(looksLikeTrustGate("Do you trust the contents of this directory?"), true);
  assert.equal(looksLikeTrustGate("Pass --trust if you trust this directory"), true);
  assert.equal(looksLikeTrustGate("all tests passed"), false);
});

test("agents-kit.test.mjs plan restriction classifier", () => {
  assert.equal(looksLikePlanRestriction("ActionRequiredError: Named models unavailable"), true);
  assert.equal(looksLikePlanRestriction("Free plans can only use Auto. Switch to Auto or upgrade plans to continue."), true);
  assert.equal(looksLikePlanRestriction("all tests passed"), false);
});

test("agents-kit.test.mjs command rejection classifier", () => {
  assert.equal(looksLikeCommandRejection("Command execution was rejected on every attempt, including `npm install` and `init_github`."), true);
  assert.equal(looksLikeCommandRejection("the command was rejected by the user"), true);
  assert.equal(looksLikeCommandRejection("All checks passed; the tree is green."), false);
  assert.equal(looksLikeCommandRejection("Do you trust the contents of this directory?"), false);
});

test("agents-kit.test.mjs model rejection classifier", () => {
  assert.equal(looksLikeModelRejection("Cannot use this model: grok-4.7-xhigh-fast - Grok 4.7 Extra High Fast"), true);
  assert.equal(looksLikeModelRejection("There's an issue with the selected model (claude-x). It may not exist or you may not have access to it."), true);
  assert.equal(looksLikeModelRejection("The 'gpt-x' model is not supported when using Codex with a ChatGPT account."), true);
  assert.equal(looksLikeModelRejection("models/gemini-x is not found for API version v1beta"), true);
  assert.equal(looksLikeModelRejection("The data model is not found in docs/GLOSSARY.md yet."), false);
  assert.equal(looksLikeModelRejection("All checks passed; the tree is green."), false);
});

test("agents-kit.test.mjs claude adapter does not allow init_github or request_secret", () => {
  const args = getAdapter({ toolId: "claude" }).buildArgs("claude-opus-5-5");
  assert.equal(args.includes("Bash(init_github:*)"), false);
  assert.equal(args.includes("Bash(request_secret:*)"), false);
  assert.equal(args.includes("--model"), true);
  assert.equal(args.includes("claude-opus-5-5"), true);
});

test("agents-kit.test.mjs cursor auto sends no model and a named model does", () => {
  const cursor = getAdapter({ toolId: "cursor" });
  assert.deepEqual(cursor.buildArgs("auto"), ["--trust", "--force", "-p", "--output-format", "stream-json"]);
  assert.deepEqual(cursor.buildArgs("grok-4.7"), ["--trust", "--force", "-p", "--model", "grok-4.7", "--output-format", "stream-json"]);
});

test("agents-kit.test.mjs (v) neededKeys follows the tools and vercel", () => {
  const setup = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "setup.json"), "utf8"));
  const claude = {
    reviewer: { tool: "claude" },
    reviewer_light: { tool: "claude" },
    pool: [{ tool: "claude" }],
  };
  const both = {
    reviewer: { tool: "claude" },
    reviewer_light: null,
    pool: [{ tool: "cursor" }, { tool: "claude" }],
  };
  assert.deepEqual(neededKeys(setup, { deploy: "none" }, claude).map((key) => key.name), ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_2"]);
  assert.deepEqual(neededKeys(setup, { deploy: "none" }, both).map((key) => key.name), ["CURSOR_API_KEY", "CURSOR_API_KEY_2", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_2"]);
  assert.deepEqual(
    neededKeys(setup, { deploy: "vercel" }, both).map((key) => [key.name, key.optional]),
    [
      ["CURSOR_API_KEY", false],
      ["CURSOR_API_KEY_2", true],
      ["CLAUDE_CODE_OAUTH_TOKEN", false],
      ["CLAUDE_CODE_OAUTH_TOKEN_2", true],
      ["VERCEL_TOKEN", true],
      ["VERCEL_ORG_ID", true],
      ["VERCEL_PROJECT_ID", true],
    ],
  );
});

test("agents-kit.test.mjs codex and gemini put the prompt on stdin", () => {
  const codex = getAdapter({ toolId: "codex" });
  assert.equal(codex.promptDelivery, "stdin");
  assert.deepEqual(codex.buildArgs("gpt-5.6-sol"), ["exec", "--model", "gpt-5.6-sol", "-"]);
  const gemini = getAdapter({ toolId: "gemini" });
  assert.equal(gemini.promptDelivery, "stdin");
  assert.deepEqual(gemini.buildArgs("gemini-2.5-pro"), ["-p", "--model", "gemini-2.5-pro"]);
});
