// E66 (PR-93): every tool at a pinned version (audit M3), no agent's raw output in an artifact (D9), the main ruleset
// at setup, best effort (D4), the dark theme's faint text (L3) and the Windows command line (L4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeVersionStop } from "../lib/adopt.mjs";
import { ensureMainRuleset, mainRuleset } from "../lib/setup.mjs";
import { winQuote } from "../lib/spawn.mjs";
import { PACKAGES, pin } from "../payload/files/scripts/devos/pins.mjs";
import { cleanup } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payload = path.join(root, "payload", "files");
const workflows = path.join(payload, "dot-github", "workflows");
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const defaults = JSON.parse(read(path.join(payload, "devos", "engine.defaults.json")));
const count = (text, needle) => text.split(needle).length - 1;

test("hygiene.test.mjs (a) pins.mjs gives each tool's exact version from devos.config.json, and refuses anything else", () => {
  const specs = Object.fromEntries(Object.keys(PACKAGES).map((tool) => [tool, pin(defaults, tool)]));
  assert.deepEqual(specs, {
    claude: "@anthropic-ai/claude-code@2.1.310",
    codex: "@openai/codex@0.164.0",
    gemini: "@google/gemini-cli@0.65.0",
    firebase: "firebase-tools@15.34.1",
    vercel: "vercel@65.2.0",
    pnpm: "pnpm@10.34.9",
  });
  assert.equal(pin(defaults, "cursor"), "2026.11.05-86047df 170b77786cbf4c93064d64fff12b71a178b968730561c64afc2e8e752535442e");
  // The pinned Claude Code keeps an adoption's reads to its folder (E65).
  assert.equal(claudeVersionStop(defaults.tool_versions.claude), "");
  // A project's own pin wins; anything but an exact version is refused.
  assert.equal(pin({ tool_versions: { ...defaults.tool_versions, claude: "2.1.320" } }, "claude"), "@anthropic-ai/claude-code@2.1.320");
  for (const bad of ["latest", "^2.1.0", "2.1", "2.1.310 || 3", "2.1.310; curl x", "", undefined]) {
    assert.throws(() => pin({ tool_versions: { claude: bad } }, "claude"), /^Error: pins: tool_versions\.claude must be an exact version such as 1\.2\.3/, String(bad));
  }
  assert.throws(() => pin(defaults, "npm"), /^Error: pins: no tool npm; one of claude, codex, gemini, firebase, vercel, pnpm, cursor$/);
  assert.throws(() => pin({ tool_versions: { cursor: { version: "2026.11.05-86047df" } } }, "cursor"), /^Error: pins: tool_versions\.cursor needs a version/);
  assert.throws(() => pin({ tool_versions: { cursor: { version: "latest", sha256_linux_x64: "0".repeat(64) } } }, "cursor"), /^Error: pins: tool_versions\.cursor/);
});

test("hygiene.test.mjs (b) in an installed project, pins.mjs reads the devos.config.json beside its own scripts/ folder", () => {
  const project = mkdtempSync(path.join(tmpdir(), "devos-pins-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", project]).status, 0);
    const install = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "install", project, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const script = path.join(project, "scripts", "devos", "pins.mjs");
    // From anywhere: a trusted job runs main's copy ($T) from another folder.
    const run = (args) => spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: "utf8", windowsHide: true });
    assert.deepEqual([run(["claude"]).status, run(["claude"]).stdout], [0, "@anthropic-ai/claude-code@2.1.310\n"]);
    assert.equal(run(["vercel"]).stdout, "vercel@65.2.0\n");
    const other = path.join(project, "other.json");
    writeFileSync(other, JSON.stringify({ tool_versions: { pnpm: "latest" } }));
    const refused = run(["pnpm", "--config", other]);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /^pins: tool_versions\.pnpm must be an exact version such as 1\.2\.3, not "latest"/);
    const missing = run(["pnpm", "--config", path.join(project, "none.json")]);
    assert.deepEqual([missing.status, missing.stderr], [1, `pins: ${path.join(project, "none.json")} does not exist\n`]);
  } finally {
    cleanup(project);
  }
});

test("hygiene.test.mjs (c) the workflows install every tool at its pin, third-party actions by commit, GitHub's own on their major tag", () => {
  const files = readdirSync(workflows).filter((file) => file.endsWith(".yml")).map((file) => path.join(workflows, file));
  const scripts = ["review-user.sh", "vercel-deploy.sh"].map((file) => path.join(payload, "scripts", "devos", file));
  const all = Object.fromEntries([...files, ...scripts].map((file) => [path.basename(file), read(file)]));
  const thirdParty = [];
  for (const [file, text] of Object.entries(all)) {
    for (const [, action] of text.matchAll(/^\s*(?:-\s+)?uses:\s+(\S.*)$/gm)) {
      if (action.startsWith("./")) continue;
      if (action.startsWith("actions/")) {
        assert.match(action, /^actions\/[a-z-]+@(?:v\d+|[0-9a-f]{40} # v\d+\.\d+\.\d+)$/, `${file}: ${action}`);
        continue;
      }
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${file}: ${action}`);
      thirdParty.push(action);
    }
    assert.equal(/@latest\b/.test(text), false, `${file}: @latest`);
    assert.equal(/curl[^\n|]*\|\s*(?:ba)?sh\b/.test(text), false, `${file}: a piped installer`);
    for (const [line] of text.matchAll(/npm install -g[^\n]*/g)) assert.match(line, /"\$(?:spec|PINNED_FIREBASE)"/, `${file}: ${line}`);
    for (const [line] of text.matchAll(/npx --yes \S+/g)) assert.equal(line, 'npx --yes "$vercel"', `${file}: ${line}`);
  }
  assert.deepEqual([...new Set(thirdParty)].sort(), [
    "astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e # v6.8.0",
    "subosito/flutter-action@1a449444c387b1966244ae4d4f8c696479add0b2 # v2.23.0",
    "supabase/setup-cli@1dedf2c611547ede7232d26866dd3c56ab903bbb # v1.7.3",
  ]);
  assert.equal(thirdParty.length, 7);
  // Where each pin is read.
  const pins = (file, tool) => count(all[file], `$(node scripts/devos/pins.mjs ${tool})`);
  assert.deepEqual(["pnpm", "firebase"].map((tool) => [pins("devos-work.yml", tool), pins("ci.yml", tool), pins("devos-deploy.yml", tool)]), [[1, 1, 1], [1, 1, 1]]);
  assert.deepEqual([pins("devos-intake.yml", "claude"), pins("devos-supervisor.yml", "claude"), pins("devos-deploy.yml", "vercel"), pins("vercel-deploy.sh", "vercel")], [2, 1, 1, 1]);
  assert.equal(count(all["devos-work.yml"], 'spec=$(node scripts/devos/pins.mjs "$DEVOS_BUILDER_TOOL")'), 1);
  // The work job reads every pin from main's checkout, before the task branch is checked out: firebase-tools, installed
  // after it, takes the pin read then.
  const workText = all["devos-work.yml"];
  const branch = workText.indexOf("      - name: Check out the task branch");
  for (const tool of ["pnpm", "firebase"]) assert.ok(workText.indexOf(`$(node scripts/devos/pins.mjs ${tool})`) < branch, tool);
  assert.ok(workText.indexOf('spec=$(node scripts/devos/pins.mjs "$DEVOS_BUILDER_TOOL")') < branch);
  assert.equal(count(workText, 'echo "firebase=$spec" >> "$GITHUB_OUTPUT"'), 1);
  assert.equal(count(workText, "PINNED_FIREBASE: ${{ steps.pins.outputs.firebase }}"), 1);
  assert.equal(count(workText, 'npm install -g "$PINNED_FIREBASE"'), 1);
  assert.equal(count(all["review-user.sh"], 'spec=$(node "$(dirname "$0")/pins.mjs" claude)'), 1);
  // Cursor's agent package: its version's download, checked against the pinned SHA-256 before it is unpacked.
  const work = all["devos-work.yml"];
  const cursor = work.slice(work.indexOf("              cursor)\n"), work.indexOf("            esac", work.indexOf("              cursor)\n")));
  for (const line of [
    "spec=$(node scripts/devos/pins.mjs cursor)",
    'curl -fsSL --retry 3 --retry-delay 2 -o "$pkg" "https://downloads.cursor.com/lab/$version/linux/x64/agent-cli-package.tar.gz"',
    'echo "${spec#* }  $pkg" | sha256sum -c -',
    'tar --strip-components=1 -xzf "$pkg" -C "$dir"',
  ]) assert.equal(count(cursor, line), 1, line);
  assert.ok(cursor.indexOf("sha256sum -c -") < cursor.indexOf("tar --strip-components"));
});

test("hygiene.test.mjs (d) no artifact keeps an agent's raw output (D9); the journal, check logs and evidence stay", () => {
  const upload = (text, name) => {
    const at = text.indexOf(name);
    assert.ok(at >= 0, name);
    return text.slice(at, text.indexOf("if-no-files-found", at));
  };
  const doctor = upload(read(path.join(workflows, "devos-doctor.yml")), "name: devos-doctor-pr");
  assert.equal(doctor.includes("path: |\n            .devos/doctor/\n            !.devos/doctor/claude.json\n            !.devos/doctor/claude.err\n"), true, doctor);
  const supervisor = upload(read(path.join(workflows, "devos-supervisor.yml")), "name: devos-supervisor-");
  assert.equal(supervisor.includes("path: |\n            .devos/supervisor/\n            !.devos/supervisor/claude.json\n            !.devos/supervisor/claude.err\n"), true, supervisor);
  const cycle = upload(read(path.join(workflows, "devos-cycle.yml")), "name: devos-${{ needs.resolve.outputs.task }}-a${{ needs.resolve.outputs.attempt }}\n");
  for (const out of ["reviewer.json*", "reviewer.err", "**/*.stream.jsonl", "limits/**"]) assert.equal(cycle.includes(`!\${{ github.workspace }}/publish/decide/.devos/${out}\n`), true, out);
  assert.equal(cycle.includes("journal"), false);
  const work = read(path.join(workflows, "devos-work.yml"));
  const pack = work.slice(work.indexOf("      - name: Pack the bundle and the evidence"), work.indexOf("      - name: Keep the work job's output"));
  for (const out of ["! -name 'builder.json*'", "! -name 'builder.err'", "! -name 'reviewer.json*'", "! -name '*.stream.jsonl'", "! -name 'builder-last-action'", "! -name 'builder-timeline.json'", "! -path './logs/builder-*'"]) {
    assert.equal(pack.includes(out), true, out);
  }
});

test("hygiene.test.mjs (e) devos init protects main with its ruleset, best effort, and gives the workflow token read only", () => {
  assert.deepEqual(mainRuleset(), {
    name: "devos-main",
    target: "branch",
    enforcement: "active",
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "devos/verdict" }] } },
    ],
  });
  const said = [];
  const log = console.log;
  const attempt = (answers) => {
    const calls = [];
    const runner = (cmd, args, options) => {
      calls.push({ cmd, args, input: options.input });
      return answers[calls.length - 1];
    };
    said.length = 0;
    console.log = (line) => said.push(line);
    try {
      return { outcome: ensureMainRuleset("/p", "devtest/demo-shop", runner), calls };
    } finally {
      console.log = log;
    }
  };
  const present = attempt([{ status: 0, stdout: "ci-rules\ndevos-main\n" }]);
  assert.deepEqual([present.outcome, present.calls.length, said], ["present", 1, []]);
  assert.deepEqual(present.calls[0].args, ["api", "repos/devtest/demo-shop/rulesets", "--jq", ".[].name"]);
  const created = attempt([{ status: 0, stdout: "" }, { status: 0, stdout: "{}" }]);
  assert.equal(created.outcome, "created");
  assert.deepEqual(created.calls[1].args, ["api", "-X", "POST", "repos/devtest/demo-shop/rulesets", "--input", "-"]);
  assert.deepEqual(JSON.parse(created.calls[1].input), mainRuleset());
  assert.deepEqual(said, ["devos: main is protected by the ruleset devos-main: changes come by pull request with devos/verdict; you, as an admin, can bypass it"]);
  const refused = attempt([{ status: 1, stderr: "HTTP 403" }, { status: 1, stdout: "", stderr: "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)\n" }]);
  assert.equal(refused.outcome, "refused");
  assert.deepEqual(said, ["devos: main has no ruleset: GitHub refused it (gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)). Rulesets on a private repository need GitHub Pro, Team or Enterprise Cloud; setup goes on without one"]);
  const setup = read(path.join(root, "lib", "setup.mjs"));
  assert.equal(count(setup, '"default_workflow_permissions=read"'), 1);
  assert.equal(count(setup, '"default_workflow_permissions=write"'), 0);
  assert.equal(count(setup, "  ensureMainRuleset(folder, slug);\n"), 1);
});

test("hygiene.test.mjs (f) the Windows command line refuses % and a double quote, and quotes the rest (L4)", () => {
  assert.equal(winQuote("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(winQuote(""), '""');
  assert.equal(winQuote("C:\\Program Files\\x"), '"C:\\Program Files\\x"');
  assert.equal(winQuote("C:\\a b\\"), '"C:\\a b\\\\"');
  assert.equal(winQuote("Bash(node scripts/devos/config.mjs --write)"), '"Bash(node scripts/devos/config.mjs --write)"');
  assert.equal(winQuote("a&b"), '"a&b"');
  for (const bad of ["%PATH%", "50%", 'say "hi"', '"']) {
    assert.throws(() => winQuote(bad), /^Error: spawn: refusing an argument with % or " on a Windows command line: /, bad);
  }
});

test("hygiene.test.mjs (g) the dark theme's faint text reads at 4.5:1 or more on every surface (L3); the light theme is unchanged", () => {
  const css = read(path.join(root, "lib", "ui", "app.css"));
  const start = css.indexOf(":root {");
  const dark = css.slice(start, css.indexOf("}", start));
  const token = (block, name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`))[1];
  assert.equal(token(dark, "faint"), "#8a96ad");
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const surface of ["ink", "ink-raised", "ink-high", "ink-sunk"]) assert.ok(contrast("#8a96ad", token(dark, surface)) >= 4.5, surface);
  assert.equal(count(css, "--faint: #5f6c83;"), 2);
  assert.equal(count(css, "--faint:"), 3);
});
