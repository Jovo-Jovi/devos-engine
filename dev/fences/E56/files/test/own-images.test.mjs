import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { runMedia } from "../payload/files/scripts/devos/media.mjs";
import { cleanup, flow, init, runs, stage } from "./harness.mjs";

// E56 (PR-82): images the developer owns (a logo, product photos), apart from the design references, kept as they
// are in docs/design/own/, listed in the media plan with the source `own`, and placed by the runner for free.
const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), "..");
const bin = path.join(root, "bin", "devos.mjs");
const signedIn = [{ toolId: "claude", status: "installed", signedIn: true }];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([1, 0, 1, 0, 0])]);
const PLAN = path.join("docs", "design", "media.json");
const alt = { en: "Our logo", ar: "شعارنا" };
const OWN = { id: "logo", kind: "image", source: "own", from: "docs/design/own/logo.png", use: "Header", file: "public/media/logo.png", alt, status: "planned" };

function validPlan(extra = {}) {
  return {
    accepted: true,
    contract_version: CONTRACT_VERSION,
    link: false,
    agents: {
      reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
      reviewer_light: { id: "claude-light", tool: "claude", model: "claude-sonnet-5-5" },
      pool: [{ id: "cursor-grok", tool: "cursor", model: "grok-4.7", default: true, note: "default builder" }],
      policy: "reviewer-picks",
    },
    blueprint: { tool: "claude", model: "claude-opus-5-5" },
    project: { type: "saas", stack: "next", modules: { database: "none", auth: "none", email: "none" }, scope: "mvp" },
    fields: { name: "Demo Shop", brief: "A small shop.", users: "Customers", languages: ["en"], visibility: "private" },
    attachments: [],
    ...extra,
  };
}

function scratch(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function write(dir, rel, body) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), Buffer.isBuffer(body) || typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
}

function installed(answers) {
  const dir = scratch("devos-own-");
  const result = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  write(dir, "devos/answers.json", answers);
  return dir;
}

function media(dir) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "media", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
  return JSON.parse(run.stdout).media;
}

const planOf = (dir) => JSON.parse(readFileSync(path.join(dir, PLAN), "utf8"));

async function workerPage() {
  const planned = stage();
  Object.assign(process.env, planned.env);
  let server;
  try {
    server = await startUiServer({ folder: planned.project, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const headers = { "Content-Type": "application/json", Origin: origin, "X-DEVOS-Token": server.token };
    const sent = await fetch(`${origin}/api/file`, { method: "POST", headers: { "X-DEVOS-Token": server.token, "X-DEVOS-Name": "logo.png", "Content-Type": "application/octet-stream", Origin: origin }, body: PNG });
    if (sent.status !== 200) throw new Error("the image was not stored");
    await sent.arrayBuffer();
    const note = Buffer.from("A note.\n").toString("base64");
    const body = validPlan({ attachments: [{ name: "notes.md", base64: note }], own_images: [{ name: "logo.png" }] });
    const posted = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(body) });
    const answer = await posted.json();
    if (posted.status !== 200) throw new Error(`the plan was refused: ${JSON.stringify(answer)}`);
    if (!answer.summary.includes("Attachments: notes.md") || !answer.summary.includes("Images you own: logo.png")) throw new Error(`summary: ${JSON.stringify(answer.summary)}`);
    const text = validPlan({ own_images: [{ name: "brief.md", base64: note }] });
    const refused = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(text) });
    const refusal = await refused.json();
    if (refused.status !== 400 || !refusal.errors.some((error) => error.endsWith("brief.md is not an image this engine accepts: PNG, JPEG, WebP or GIF up to 20 MB."))) {
      throw new Error(`a text file was taken as an image: ${JSON.stringify(refusal)}`);
    }
    const many = validPlan({
      attachments: Array.from({ length: 30 }, (_, i) => ({ name: `n${i}.md`, base64: note })),
      own_images: [{ name: "logo.png" }],
    });
    const full = await fetch(`${origin}/api/plan`, { method: "POST", headers, body: JSON.stringify(many) });
    const fullBody = await full.json();
    if (full.status !== 400 || !fullBody.errors.includes("A plan can hold at most 30 attachments.")) throw new Error("the images were not counted with the documents");
  } finally {
    if (server) await server.close();
    cleanup(planned.parent);
  }
}

if (process.env.DEVOS_OWN_WORKER === "page") {
  workerPage().then(() => process.exit(0)).catch((error) => {
    console.error(error && error.message ? error.message : "worker failed");
    process.exit(1);
  });
} else {
  test("own-images.test.mjs (a) a plan takes images you own apart from the documents, for a project with screens, within the same limits", () => {
    const dir = scratch("devos-own-plan-");
    try {
      write(dir, "logo.png", PNG);
      write(dir, "brief.md", "# Brief\n");
      const logo = path.join(dir, "logo.png");
      const brief = path.join(dir, "brief.md");
      const plain = validatePlan(validPlan(), signedIn);
      assert.equal(plain.ok, true, plain.errors?.join(" | "));
      assert.equal(Object.hasOwn(plain.answers, "own_images"), false);
      assert.deepEqual(plain.own, []);
      const taken = validatePlan(validPlan({ attachments: [brief], own_images: [logo] }), signedIn);
      assert.equal(taken.ok, true, taken.errors?.join(" | "));
      assert.deepEqual(taken.answers.attachments, ["brief.md"]);
      assert.deepEqual(taken.answers.own_images, ["logo.png"]);
      assert.deepEqual(Object.keys(taken.answers).slice(-2), ["attachments", "own_images"]);
      assert.deepEqual(taken.own, [{ filePath: logo, name: "logo.png" }]);
      const errors = (extra) => validatePlan(validPlan(extra), signedIn).errors ?? [];
      assert.deepEqual(errors({ own_images: [brief] }), [`${brief} is not an image this engine accepts: PNG, JPEG, WebP or GIF up to 20 MB.`]);
      assert.deepEqual(errors({ attachments: [logo], own_images: [logo] }), ["Two attachments would be saved under the same name."]);
      assert.equal(errors({ attachments: Array(30).fill(brief), own_images: [logo] }).includes("A plan holds at most 30 attachments."), true);
      const cli = validPlan({ own_images: [logo] });
      cli.project = { type: "cli", stack: "node-cli", modules: {}, scope: "mvp" };
      assert.equal(validatePlan(cli, signedIn).errors.includes("Images you own are for a project with screens."), true);
    } finally {
      cleanup(dir);
    }
  });

  test("own-images.test.mjs (b) devos init asks for images you own after the documents, keeps them in docs/design/own/, and the plan must list each", () => {
    const staged = stage();
    try {
      write(staged.parent, "logo.png", PNG);
      const result = init(staged, flow({ own: path.join(staged.parent, "logo.png") }));
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const at = (text) => result.stdout.indexOf(text);
      assert.ok(at("Images you own that the product shows as they are") > at("Documents (Markdown"));
      assert.ok(at("Images you own: logo.png") > 0);
      assert.equal(readFileSync(path.join(staged.project, "docs", "design", "own", "logo.png")).equals(PNG), true);
      assert.equal(existsSync(path.join(staged.project, "docs", "design", "references", "logo.png")), false);
      const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
      assert.deepEqual(answers.own_images, ["logo.png"]);
      const plan = planOf(staged.project);
      assert.equal(plan.provider, "none");
      assert.deepEqual(plan.items.map((item) => [item.id, item.source, item.from]), [["own-logo", "own", "docs/design/own/logo.png"]]);
    } finally {
      cleanup(staged.parent);
    }
    const unlisted = stage({ mode: "own-unlisted-then-good" });
    try {
      write(unlisted.parent, "logo.png", PNG);
      const result = init(unlisted, flow({ own: path.join(unlisted.parent, "logo.png") }));
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const repair = runs(unlisted.parent).find((run) => run.args.includes("--continue"));
      assert.ok(repair, "no repair round");
      assert.equal(repair.stdin.includes("docs/design/media.json does not list docs/design/own/logo.png as an image you own"), true, repair.stdin);
    } finally {
      cleanup(unlisted.parent);
    }
    const cli = stage();
    try {
      const result = init(cli, flow({ type: "cli", modules: [] }));
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout.includes("Images you own"), false);
    } finally {
      cleanup(cli.parent);
    }
  });

  test("own-images.test.mjs (c) guard:media checks an image you own, with or without generated media", () => {
    const none = installed({ modules: { media: "none" }, visual_ambition: "calm", languages: ["en", "ar"] });
    const xai = installed({ modules: { media: "xai" }, media_kinds: ["video"], visual_ambition: "showcase", languages: ["en", "ar"] });
    try {
      write(none, "docs/DESIGN_SYSTEM.md", "# Design system\n\nVisual ambition: calm\n");
      write(none, "docs/design/own/logo.png", PNG);
      write(none, PLAN, { version: 1, provider: "none", items: [OWN] });
      const passed = media(none);
      assert.equal(passed.status, "PASS", passed.findings.join("\n"));
      assert.equal(passed.note, "1 items, 0 generated, 0 of 1 own placed");
      const generated = { id: "hero", kind: "image", use: "Home: hero", file: "public/media/hero.jpg", prompt: "A harbour", aspect_ratio: "16:9", resolution: "1k", alt, status: "planned" };
      write(none, PLAN, { version: 1, provider: "none", items: [OWN, generated] });
      assert.deepEqual(media(none).findings, ["docs/design/media.json: item hero: generated media is None in devos/answers.json: list only images you own (source own)"]);
      write(none, PLAN, { version: 1, provider: "none", items: [
        { ...OWN, from: "docs/design/references/logo.png" },
        { ...OWN, id: "photo", from: "docs/design/own/photo.png", file: "public/media/photo.png" },
        { ...OWN, id: "mark", file: "public/media/mark.webp" },
        { ...OWN, id: "clip", kind: "video", file: "public/media/clip.png", status: "generated" },
        { ...OWN, id: "badge", file: "public/media/badge.png", status: "placed", alt: { en: "A badge" } },
        { ...OWN, id: "odd", source: "mine", file: "public/media/odd.png" },
      ] });
      assert.deepEqual(media(none).findings, [
        "docs/design/media.json: item logo: from must name a file in docs/design/own/",
        "docs/design/media.json: item photo: docs/design/own/photo.png does not exist",
        "docs/design/media.json: item mark: file public/media/mark.webp must keep the extension of docs/design/own/logo.png, which is shown as it is",
        "docs/design/media.json: item clip: an image you own has the kind image",
        "docs/design/media.json: item clip: status must be planned or placed",
        "docs/design/media.json: item badge: alt.ar is missing (or mark the item decorative)",
        "docs/design/media.json: item badge: placed, but public/media/badge.png does not exist",
        "docs/design/media.json: item odd: source must be own, or absent for generated media",
        "docs/design/media.json: item odd: generated media is None in devos/answers.json: list only images you own (source own)",
      ]);
      write(none, PLAN, { version: 1, provider: "xai", items: [OWN] });
      assert.deepEqual(media(none).findings, ["docs/design/media.json: generated media is None in devos/answers.json"]);
      write(xai, "docs/DESIGN_SYSTEM.md", "# Design system\n\nVisual ambition: showcase\n");
      write(xai, "docs/design/own/logo.png", PNG);
      const video = { id: "intro", kind: "video", use: "Home: intro", file: "public/media/intro.mp4", prompt: "Boats at dawn", aspect_ratio: "16:9", resolution: "720p", duration: 8, audio: false, alt, status: "planned" };
      write(xai, PLAN, { version: 1, provider: "xai", items: [video, OWN] });
      const mixed = media(xai);
      assert.equal(mixed.status, "PASS", mixed.findings.join("\n"));
      assert.equal(mixed.note, "2 items, 0 generated, 0 of 1 own placed");
    } finally {
      cleanup(none);
      cleanup(xai);
    }
  });

  test("own-images.test.mjs (d) media.mjs places an image you own as it is, free, with no provider, key or budget, and keeps it while it matches", async () => {
    const dir = scratch("devos-own-place-");
    const noFetch = async () => assert.fail("an image you own needs no provider");
    try {
      write(dir, "devos/answers.json", { modules: { media: "none" }, languages: ["en", "ar"] });
      write(dir, "docs/design/own/logo.png", PNG);
      write(dir, "docs/design/own/wave.gif", GIF);
      const wave = { ...OWN, id: "wave", from: "docs/design/own/wave.gif", file: "public/media/wave.gif" };
      write(dir, PLAN, { version: 1, provider: "none", items: [OWN, wave] });
      const first = await runMedia({ root: dir, env: {}, fetch: noFetch });
      assert.equal(first.code, 0, first.lines.join("\n"));
      assert.deepEqual(first.lines, [
        "media: images you own · 2 to place · 0 in place",
        "- logo (own image): placed public/media/logo.png from docs/design/own/logo.png",
        "- wave (own image): placed public/media/wave.gif from docs/design/own/wave.gif",
        "media: 2 placed, 0 failed · nothing to generate",
      ]);
      assert.deepEqual(first.changed, ["docs/design/media.json", "public/media/logo.png", "public/media/wave.gif"]);
      assert.equal(readFileSync(path.join(dir, "public", "media", "logo.png")).equals(PNG), true);
      assert.deepEqual(planOf(dir).items.map((item) => item.status), ["placed", "placed"]);
      assert.equal(existsSync(path.join(dir, "docs", "usage", "media.jsonl")), false);
      const again = await runMedia({ root: dir, env: {}, budget: "5", fetch: noFetch });
      assert.deepEqual(again.lines, ["media: images you own · 0 to place · 2 in place", "media: 0 placed, 0 failed · nothing to generate"]);
      assert.deepEqual(again.changed, []);
      const newer = Buffer.concat([PNG, Buffer.from([9])]);
      write(dir, "docs/design/own/logo.png", newer);
      const replaced = await runMedia({ root: dir, env: {}, only: "logo", fetch: noFetch });
      assert.deepEqual(replaced.changed, ["docs/design/media.json", "public/media/logo.png"]);
      assert.equal(readFileSync(path.join(dir, "public", "media", "logo.png")).equals(newer), true);
      write(dir, "docs/design/own/logo.png", "not an image\n");
      const broken = await runMedia({ root: dir, env: {}, only: "logo", fetch: noFetch });
      assert.equal(broken.code, 1);
      assert.equal(broken.lines[1], "- logo (own image): failed: docs/design/own/logo.png is not a .png file");
      assert.equal(readFileSync(path.join(dir, "public", "media", "logo.png")).equals(newer), true);
      write(dir, PLAN, { version: 1, provider: "none", items: [{ ...OWN, from: "../logo.png" }] });
      const outside = await runMedia({ root: dir, env: {}, fetch: noFetch });
      assert.equal(outside.lines[1], "- logo (own image): failed: from must name a file in docs/design/own/");
    } finally {
      cleanup(dir);
    }
  });

  test("own-images.test.mjs (e) the cycle's step places the images a fence names, and a fence that names no media makes nothing, even without a plan", async () => {
    const dir = scratch("devos-own-cycle-");
    try {
      write(dir, "docs/fences/T02.md", "## T02 — The header\n\n- Phase: 1\n");
      const quiet = await runMedia({ root: dir, env: {}, fence: "docs/fences/T02.md" });
      assert.deepEqual([quiet.code, quiet.lines], [0, ["media: docs/fences/T02.md names no media"]]);
      write(dir, "devos/answers.json", { modules: { media: "xai" }, media_kinds: ["image"], languages: ["en", "ar"] });
      write(dir, "docs/design/own/logo.png", PNG);
      const hero = { id: "hero", kind: "image", use: "Home: hero", file: "public/media/hero.jpg", prompt: "A harbour", aspect_ratio: "16:9", resolution: "1k", alt, status: "planned" };
      write(dir, PLAN, { version: 1, provider: "xai", items: [hero, OWN] });
      write(dir, "docs/fences/T03.md", "## T03 — The home screen\n\n- Phase: 1\n- Media: `logo` · `hero`\n");
      const named = await runMedia({ root: dir, env: {}, fence: "docs/fences/T03.md", fetch: async () => assert.fail("the budget is 0") });
      assert.equal(named.code, 0, named.lines.join("\n"));
      assert.deepEqual(named.lines.slice(0, 3), [
        "media: images you own · 1 to place · 0 in place",
        "- logo (own image): placed public/media/logo.png from docs/design/own/logo.png",
        "media: xai · budget $0.00 · 1 to make, estimated $0.04 · 0 already made",
      ]);
      assert.deepEqual(named.changed, ["docs/design/media.json", "public/media/logo.png"]);
    } finally {
      cleanup(dir);
    }
    const project = installed({ modules: { media: "none" }, languages: ["en", "ar"] });
    try {
      write(project, "docs/design/own/logo.png", PNG);
      write(project, PLAN, { version: 1, provider: "none", items: [OWN] });
      const result = spawnSync(process.execPath, [bin, "media", project], { encoding: "utf8", windowsHide: true, env: { ...process.env, DEVOS_MEDIA_XAI_KEY: "", DEVOS_MEDIA_BUDGET: "" } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout.includes("- logo (own image): placed public/media/logo.png from docs/design/own/logo.png"), true, result.stdout);
      assert.equal(result.stdout.includes("devos media: nothing to generate. Review the files placed from docs/design/own/ and docs/design/media.json, then commit them."), true, result.stdout);
      assert.equal(readFileSync(path.join(project, "public", "media", "logo.png")).equals(PNG), true);
    } finally {
      cleanup(project);
    }
  });

  test("own-images.test.mjs (f) the guided page takes images you own in a drop zone of their own and sends them apart", { timeout: 180000 }, () => {
    const result = spawnSync(process.execPath, [here], { encoding: "utf8", windowsHide: true, timeout: 170000, env: { ...process.env, DEVOS_OWN_WORKER: "page" } });
    assert.equal(result.status, 0, result.stderr);
    const app = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
    for (const needle of [
      'const withOwn = Boolean(mediaModule(d.type));',
      'heading: "Images you own",',
      'label: "Add images you own",',
      '...(mediaModule(d.type) && app.own.length ? { own_images: app.own.map((file) => ({ name: file.name })) } : {}),',
      '...(mediaModule(d.type) && app.own.length ? [["Images you own", app.own.map((file) => file.name).join(", ")]] : []),',
    ]) assert.equal(app.includes(needle), true, needle);
  });

  test("own-images.test.mjs (g) the method says so (PR-82), and the engine's own files ignore PowerShell's cache and allow secret names to gitleaks", () => {
    const has = (rel, needle) => assert.equal(readFileSync(path.join(root, rel), "utf8").includes(needle), true, `${rel}: ${needle}`);
    has("payload/files/docs/method/PRECEDENTS.md", "**Live maximum: PR-82.**");
    has("payload/files/docs/method/PRECEDENTS.md", "| PR-82 | **Images the developer owns are shown as they are.**");
    has("payload/files/docs/method/DESIGN_METHOD.md", "**Images you own** (PR-82) are the developer's own");
    has("payload/files/docs/method/AUTOMATION.md", "An image the developer owns (source `own`, PR-82) is placed first");
    has("payload/files/docs/method/DEV_OS_V2_REVIEWER.md", "generated media: the source `own`, its `from` in `docs/design/own/`, shown as it is (PR-82).");
    has("payload/files/devos/prompts/blueprint.md", "Every image in `docs/design/own/` is an item of that plan too, whatever `modules.media` says (PR-82)");
    has("payload/files/devos/prompts/reviewer.md", "An image the developer owns (source `own`, PR-82) is shown as it is");
    has(".gitignore", "\n/Microsoft/\n");
    const toml = readFileSync(path.join(root, ".gitleaks.toml"), "utf8");
    const pattern = /^regexes = \['''(.+)'''\]$/m.exec(toml)?.[1];
    assert.ok(pattern, "no secret-name allowlist");
    const names = new RegExp(pattern);
    for (const name of ["ANTHROPIC_API_KEY_2", "secrets.ANTHROPIC_API_KEY_2", "CURSOR_API_KEY_2", "CLAUDE_CODE_OAUTH_TOKEN", "DEVOS_MEDIA_XAI_KEY", "BETTER_AUTH_SECRET"]) {
      assert.equal(names.test(name), true, name);
    }
    for (const value of ["not-a-name", "lower_case_key", "Mixed_Case_KEY", "1PASSWORD_KEY", "ANTHROPIC_API_KEY=value", "ABCDEF123456", "KEY"]) {
      assert.equal(names.test(value), false, value);
    }
  });
}
