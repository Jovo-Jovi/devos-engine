import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { neededKeys } from "../lib/keys.mjs";
import { setupItems } from "../lib/setup.mjs";
import { runMedia } from "../payload/files/scripts/devos/media.mjs";

// E53c2 (PR-81): the cycle makes a task's planned media before its builder.
Object.assign(process.env, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "maintenance.auto", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0" });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const IMAGE = { id: "hero", kind: "image", use: "Home: hero", file: "public/media/hero.jpg", prompt: "A harbour at dawn", aspect_ratio: "16:9", resolution: "1k", alt: { en: "A harbour" }, status: "planned" };
const VOICE = { id: "welcome", kind: "voice", use: "Home: welcome", file: "public/media/welcome.mp3", text: "Welcome.", language: "en", voice: "eve", status: "planned" };
const PLAN = { version: 1, provider: "xai", items: [IMAGE, VOICE] };
const FENCE = (extra) => `## T07 — Home\n\n- Builder: grok-4.7 · Effort: high · Fast: no\n- Layers: frontend\n- Paths: \`src/app/**\`\n${extra}\n### Done when\n\n- D1. Tests pass.\n\n### Do NOT\n\n- Run git.\n`;

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-media-cycle-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  cpSync(path.join(root, "test", "fixtures", "docs"), path.join(dir, "docs"), { recursive: true });
  return dir;
}

function put(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`);
  }
}

function git(dir, args) {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return run.stdout;
}

const node = (dir, args, env = {}) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...process.env, TASK: "", ...env } });

test("media-cycle.test.mjs (a) fence-check reads the - Media: line and checks each id against the plan", () => {
  const dir = project();
  try {
    const check = () => node(dir, ["scripts/devos/fence-check.mjs", "docs/fences/T07.md"]).stdout;
    put(dir, { "docs/fences/T07.md": FENCE("- Media: `hero` · `welcome`\n") });
    assert.equal(check().includes("a `- Media:` line needs docs/design/media.json, the media plan (PR-79)"), true);
    put(dir, { "docs/design/media.json": PLAN });
    assert.equal(check().trim(), "fence-check: docs/fences/T07.md OK");
    put(dir, { "docs/fences/T07.md": FENCE("- Media: `hero` · `texture`\n") });
    assert.equal(check().includes("media item `texture` is not in docs/design/media.json"), true);
    put(dir, { "docs/fences/T07.md": FENCE("- Media:\n") });
    assert.equal(check().includes("the `- Media:` line names no item"), true);
    put(dir, { "docs/fences/T07.md": FENCE("") });
    assert.equal(check().trim(), "fence-check: docs/fences/T07.md OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-cycle.test.mjs (b) media.mjs --fence makes only the items the fence names, and nothing for a fence that names none", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-media-fence-"));
  try {
    put(dir, { "devos/answers.json": { modules: { media: "xai" }, media_kinds: ["image", "voice"] }, "docs/design/media.json": PLAN, "docs/fences/T07.md": FENCE("- Media: `welcome`\n"), "docs/fences/T08.md": FENCE("") });
    const never = async () => assert.fail("no call at a budget of 0");
    const named = await runMedia({ root: dir, env: {}, fence: "docs/fences/T07.md", fetch: never });
    assert.equal(named.code, 0);
    assert.deepEqual(named.lines.slice(0, 2), ["media: xai · budget $0.00 · 1 to make, estimated $0.00 · 0 already made", "- welcome (voice): estimated $0.00"]);
    assert.deepEqual(named.changed, []);
    const none = await runMedia({ root: dir, env: { DEVOS_MEDIA_BUDGET: "5" }, fence: "docs/fences/T08.md", fetch: never });
    assert.deepEqual(none, { code: 0, lines: ["media: docs/fences/T08.md names no media"], spent: 0, results: [], changed: [] });
    const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(10)]);
    const made = await runMedia({ root: dir, env: { DEVOS_MEDIA_XAI_KEY: "not-a-real-media-key", DEVOS_MEDIA_BUDGET: "1" }, fence: "docs/fences/T07.md", fetch: async () => new Response(MP3), sleep: async () => {} });
    assert.equal(made.code, 0, made.lines.join("\n"));
    assert.deepEqual(made.changed, ["docs/design/media.json", "docs/usage/media.jsonl", "public/media/welcome.mp3"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-cycle.test.mjs (c) guard:scope takes the named items' files as the runner's, and no other planned file", () => {
  const dir = project();
  try {
    put(dir, { "docs/fences/T07.md": FENCE("- Media: `hero`\n"), "docs/design/media.json": PLAN });
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "base"]);
    git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(dir, ["switch", "-q", "-c", "task/T07"]);
    put(dir, { "public/media/hero.jpg": "jpg", "docs/usage/media.jsonl": "{}\n", "src/app/page.tsx": "export default function Page() { return null; }\n" });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "T07 a1: media"]);
    const scope = () => JSON.parse(node(dir, ["scripts/guards/run-all.mjs", "--only", "scope", "--json"], { TASK: "T07" }).stdout).scope;
    assert.equal(scope().status, "PASS", JSON.stringify(scope()));
    put(dir, { "public/media/welcome.mp3": "mp3" });
    assert.deepEqual(scope().findings, ["public/media/welcome.mp3 — outside the Paths of docs/fences/T07.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("media-cycle.test.mjs (d) the builder's surface refuses any planned media file", () => {
  const dir = project();
  try {
    put(dir, { "docs/design/media.json": PLAN });
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "base"]);
    put(dir, { "src/app/page.tsx": "export {};\n" });
    assert.equal(node(dir, ["scripts/devos/guard-surfaces.mjs", "builder"]).status, 0);
    put(dir, { "public/media/welcome.mp3": "mp3" });
    const refused = node(dir, ["scripts/devos/guard-surfaces.mjs", "builder"]);
    assert.equal(refused.status, 1, refused.stdout);
    assert.equal(refused.stdout.includes("✗ public/media/welcome.mp3"), true, refused.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("media-cycle.test.mjs (e) setup offers DEVOS_MEDIA_XAI_KEY as an optional key only when xAI media was chosen", () => {
  const setup = JSON.parse(read("payload/files/devos/setup.json"));
  const media = { deploy: "none", modules: { media: "xai" } };
  const plain = { deploy: "none", modules: { media: "none" } };
  const item = setup.items.find((entry) => entry.id === "media-xai");
  assert.deepEqual([item.kind, item.names, item.when, item.blocks, item.level], ["secret", ["DEVOS_MEDIA_XAI_KEY"], ["media:xai"], "none", "optional"]);
  assert.equal(setupItems(setup, media).some((entry) => entry.id === "media-xai"), true);
  assert.equal(setupItems(setup, plain).some((entry) => entry.id === "media-xai"), false);
  const key = neededKeys(setup, media, {}).find((entry) => entry.name === "DEVOS_MEDIA_XAI_KEY");
  assert.equal(key.optional, true);
  assert.equal(key.where.startsWith("xAI console → https://console.x.ai → API Keys → Create"), true);
  assert.equal(neededKeys(setup, plain, {}).some((entry) => entry.name === "DEVOS_MEDIA_XAI_KEY"), false);
  assert.equal(read("payload/files/scripts/devos/setup-check.mjs").includes('if (cond.startsWith("media:")) return mediaProvider() === cond.slice(6);'), true);
  assert.equal(read("payload/files/dot-github/workflows/devos-setup.yml").includes(`"DEVOS_MEDIA_XAI_KEY":"\${{ secrets.DEVOS_MEDIA_XAI_KEY != '' && '1' || '' }}",`), true);
});

test("media-cycle.test.mjs (f) the Generated media step runs before the builder, alone holds the key and never stops the task", () => {
  const cycle = read("payload/files/dot-github/workflows/devos-cycle.yml");
  const at = (name) => cycle.indexOf(`      - name: ${name}`);
  assert.ok(at("Check out the task branch") > 0);
  assert.ok(at("Generated media (PR-81)") > at("Local module services for the builder (Supabase, storage, Firebase)"));
  assert.ok(at("Generated media (PR-81)") < at("Builder (the project's builder agent)"));
  const step = cycle.slice(at("Generated media (PR-81)"), cycle.indexOf("      - name:", at("Generated media (PR-81)") + 10));
  for (const line of [
    "        if: env.REVIEW_ONLY != 'true'",
    "        continue-on-error: true",
    "          DEVOS_MEDIA_XAI_KEY: ${{ secrets.DEVOS_MEDIA_XAI_KEY }}",
    "          DEVOS_MEDIA_BUDGET: ${{ vars.DEVOS_MEDIA_BUDGET }}",
    '          node scripts/devos/media.mjs --fence "docs/fences/$TASK.md" || echo',
    "            git add --pathspec-from-file=.devos/media-files.txt",
    '            git commit -m "$TASK a$ATTEMPT: media" || true',
  ]) {
    assert.equal(step.includes(line), true, line);
  }
  assert.equal(cycle.split("secrets.DEVOS_MEDIA_XAI_KEY").length - 1, 1);
});

test("media-cycle.test.mjs (g) the reviewer sees what was made, and the method says so (PR-81)", () => {
  const has = (file, sentence) => assert.equal(read(file).includes(sentence), true, `${file}: ${sentence}`);
  has("payload/files/scripts/devos/evidence.mjs", 'out.push("## Generated media (PR-81)", "", ...report, "");');
  has("payload/files/docs/method/PRECEDENTS.md", "**Live maximum: PR-81.**");
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-81 | **The cycle makes a task's planned media before its builder.**");
  has("payload/files/docs/method/AUTOMATION.md", "| `DEVOS_MEDIA_BUDGET` | US dollars · **0 (not set)** |");
  has("payload/files/docs/method/DEV_OS_V2_REVIEWER.md", "`- Media: \\`<id>\\` · …` (PR-81): the cycle makes those items before the builder");
  has("payload/files/devos/prompts/blueprint.md", "and, when the screen shows planned media, `- Media: \\`<id>\\` · …` (PR-81).");
  has("payload/files/devos/prompts/reviewer.md", "`## Generated media` in the evidence says what the step before the builder made (PR-81).");
  has("README.md", "| `DEVOS_MEDIA_BUDGET` | not set (0) |");
});
