import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cleanup, flow, init, stage } from "./harness.mjs";

// E53b (PR-79): the media plan, docs/design/media.json, and the visual ambition in the design contract.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const PLAN = path.join("docs", "design", "media.json");

function project(answers) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-media-plan-"));
  const installed = spawnSync(process.execPath, [bin, "install", dir, "--key", "DEMO"], { encoding: "utf8", windowsHide: true });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  if (answers) writeFileSync(path.join(dir, "devos", "answers.json"), `${JSON.stringify(answers, null, 2)}\n`);
  return dir;
}

function write(dir, rel, body) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
}

function media(dir) {
  const run = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "media", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true });
  const parsed = JSON.parse(run.stdout);
  return parsed.media;
}

const ANSWERS = { modules: { media: "xai" }, media_kinds: ["image", "video", "voice"], visual_ambition: "showcase", languages: ["en", "ar"] };
const alt = { en: "A harbour at dawn", ar: "ميناء عند الفجر" };
const IMAGE = { id: "hero", kind: "image", use: "Home: hero", file: "public/media/hero.webp", prompt: "A harbour at dawn", aspect_ratio: "16:9", resolution: "2k", alt, status: "planned" };
const VIDEO = { id: "intro", kind: "video", use: "Home: intro", file: "public/media/intro.mp4", prompt: "Boats leaving at dawn", aspect_ratio: "16:9", resolution: "720p", duration: 8, audio: false, alt, status: "planned" };
const VOICE = { id: "welcome", kind: "voice", use: "Home: welcome", file: "public/media/welcome.mp3", text: "Welcome.", language: "en", voice: "eve", status: "planned" };
const plan = (items) => ({ version: 1, provider: "xai", items });

test("media-plan.test.mjs (a) guard:media is N/A without answers or choices, and needs the ambition line once the design contract exists", () => {
  const bare = project(null);
  const none = project({ modules: { database: "none" } });
  const calm = project({ modules: { media: "none" }, visual_ambition: "calm", languages: ["en"] });
  try {
    assert.equal(media(bare).status, "N/A");
    assert.equal(media(none).status, "N/A");
    assert.equal(media(calm).status, "PASS");
    write(calm, "docs/DESIGN_SYSTEM.md", "# Design system\n");
    assert.deepEqual(media(calm).findings, ['docs/DESIGN_SYSTEM.md: no "Visual ambition: calm" line (PR-79)']);
    write(calm, "docs/DESIGN_SYSTEM.md", "# Design system\n\n- **Visual ambition:** Showcase\n");
    assert.deepEqual(media(calm).findings, ["docs/DESIGN_SYSTEM.md: the visual ambition is showcase, devos/answers.json says calm"]);
    write(calm, "docs/DESIGN_SYSTEM.md", "# Design system\n\nVisual ambition: calm\n");
    assert.equal(media(calm).status, "PASS");
    write(calm, PLAN, plan([IMAGE]));
    assert.deepEqual(media(calm).findings, ["docs/design/media.json: generated media is None in devos/answers.json"]);
  } finally {
    for (const dir of [bare, none, calm]) cleanup(dir);
  }
});

test("media-plan.test.mjs (b) a chosen provider needs the plan, and a valid plan of each kind passes", () => {
  const dir = project(ANSWERS);
  try {
    write(dir, "docs/DESIGN_SYSTEM.md", "# Design system\n\nVisual ambition: showcase\n");
    assert.deepEqual(media(dir).findings, ["docs/design/media.json is missing: generated media is chosen (PR-79)"]);
    write(dir, PLAN, plan([IMAGE, VIDEO, VOICE, { ...IMAGE, id: "texture", file: "public/media/texture.png", decorative: true, alt: undefined }]));
    const passed = media(dir);
    assert.equal(passed.status, "PASS", passed.findings.join("\n"));
    assert.equal(passed.note, "4 items, 0 generated");
  } finally {
    cleanup(dir);
  }
});

test("media-plan.test.mjs (c) guard:media names each broken field of the plan", () => {
  const dir = project({ ...ANSWERS, media_kinds: ["image", "video"] });
  try {
    write(dir, PLAN, { version: 2, provider: "openai", items: [
      { ...IMAGE, id: "Hero", file: "../hero.gif", aspect_ratio: "5:4", resolution: "4k", alt: { en: "x" } },
      { ...VIDEO, duration: 20, audio: "no", prompt: "" },
      { ...VOICE },
      { ...IMAGE, id: "intro", status: "done" },
      { ...IMAGE, id: "hero-2" },
    ] });
    assert.deepEqual(media(dir).findings, [
      "docs/design/media.json: version must be 1",
      "docs/design/media.json: provider must be xai, as in devos/answers.json",
      "docs/design/media.json: item Hero: id must be lower-case words joined by -",
      "docs/design/media.json: item Hero: file ../hero.gif must be a relative path inside the project, with / and no ..",
      "docs/design/media.json: item Hero: file ../hero.gif must end with .png, .jpg, .jpeg, .webp",
      "docs/design/media.json: item Hero: aspect_ratio must be one of 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 21:9",
      "docs/design/media.json: item Hero: resolution must be one of 1k, 2k",
      "docs/design/media.json: item Hero: alt.ar is missing (or mark the item decorative)",
      "docs/design/media.json: item intro: prompt is missing",
      "docs/design/media.json: item intro: duration must be a whole number of seconds from 1 to 15",
      "docs/design/media.json: item intro: audio must be true or false",
      "docs/design/media.json: item welcome: kind must be one of image, video (devos/answers.json media_kinds)",
      "docs/design/media.json: item intro: duplicate id",
      "docs/design/media.json: item intro: status must be planned or generated",
      "docs/design/media.json: item hero-2: file public/media/hero.webp is listed twice",
    ]);
  } finally {
    cleanup(dir);
  }
});

test("media-plan.test.mjs (d) a generated item records its provenance and its file exists", () => {
  const dir = project(ANSWERS);
  try {
    write(dir, PLAN, plan([{ ...IMAGE, status: "generated" }]));
    assert.deepEqual(media(dir).findings, [
      "docs/design/media.json: item hero: a generated item records its model",
      "docs/design/media.json: item hero: a generated item records generated_on as YYYY-MM-DD",
      "docs/design/media.json: item hero: a generated item records the provider's terms_url (https://)",
      "docs/design/media.json: item hero: a generated item records cost_usd",
      "docs/design/media.json: item hero: generated, but public/media/hero.webp does not exist",
    ]);
    write(dir, PLAN, plan([{ ...IMAGE, status: "generated", model: "grok-imagine-image-2.0", generated_on: "2026-11-05", terms_url: "https://x.ai/legal/terms-of-service", cost_usd: 0.06 }]));
    write(dir, "public/media/hero.webp", "webp");
    const passed = media(dir);
    assert.equal(passed.status, "PASS", passed.findings.join("\n"));
    assert.equal(passed.note, "1 items, 1 generated");
  } finally {
    cleanup(dir);
  }
});

test("media-plan.test.mjs (e) the blueprint check runs guard:media: a stub blueprint that plans the media is approved", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ modules: ["database none", "", "auth none", "", "email none", "", "", "xai", "1, 2"], ambition: "calm" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const planned = JSON.parse(readFileSync(path.join(staged.project, PLAN), "utf8"));
    assert.deepEqual(planned.items.map((item) => item.kind), ["image", "video"]);
    assert.equal(readFileSync(path.join(staged.project, "docs", "DESIGN_SYSTEM.md"), "utf8").includes("Visual ambition: calm"), true);
    const guard = spawnSync(process.execPath, ["scripts/guards/run-all.mjs", "--only", "media"], { cwd: staged.project, encoding: "utf8", windowsHide: true });
    assert.equal(guard.status, 0, guard.stdout + guard.stderr);
  } finally {
    cleanup(staged.parent);
  }
});

test("media-plan.test.mjs (f) the method plans media before it is shown (PR-79)", () => {
  const has = (file, sentence) => assert.equal(readFileSync(path.join(root, file), "utf8").includes(sentence), true, `${file}: ${sentence}`);
  has("lib/init.mjs", '"--only", "phases,naming,design-spec,media"');
  has("payload/files/scripts/guards/run-all.mjs", "GUARDS.media = media;");
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-79 | **Generated media is planned before it is shown.**");
  has("payload/files/docs/method/DESIGN_METHOD.md", "## 8. Visual ambition and the media plan");
  has("payload/files/docs/method/AUTOMATION.md", "· `media` (with generated media chosen at setup, `docs/design/media.json` plans every image, video and voice item");
  has("payload/files/devos/prompts/blueprint.md", "When `modules.media` is not `none`, also write `docs/design/media.json`, the media plan of §8 (PR-79)");
  has("payload/files/devos/prompts/builder.md", "- **Media (PR-79).** A screen that shows an item of `docs/design/media.json` uses its `file` path and");
  has("payload/files/devos/prompts/reviewer.md", "**Media (PR-79):** a screen that shows an item of `docs/design/media.json` uses its `file` path and");
  has("payload/files/docs/method/DEV_OS_V2_REVIEWER.md", "- **Media is planned (PR-79).**");
  has("payload/files/dot-cursor/rules/00-project.mdc", "never add, replace or delete a planned file (PR-79).");
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  assert.equal(defaults.surfaces.intake.allow.includes("docs/design/media.json"), true);
  assert.equal(defaults.surfaces.builder.deny.includes("docs/design/**"), true);
});
