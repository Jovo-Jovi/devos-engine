import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "../lib/contract.mjs";
import { ambitions, defaultAmbition, loadCatalogue, mediaModule } from "../lib/catalogue.mjs";
import { validatePlan } from "../lib/plan.mjs";
import { cleanup, flow, init, stage } from "./harness.mjs";

// E53a: generated media and the visual ambition, chosen at setup. Nothing is generated yet.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA_TYPES = ["saas", "web-app", "marketing", "dashboard", "marketplace", "commerce", "mobile", "ai-product", "realtime", "docs", "extension", "full"];
const signedIn = [{ toolId: "claude", status: "installed", signedIn: true }];
const KINDS_MESSAGE = "Generated media makes at least one of: image, video, voice.";
const AMBITION_MESSAGE = "The visual ambition is calm, expressive or showcase.";

function validPlan(project) {
  return {
    accepted: true,
    contract_version: CONTRACT_VERSION,
    link: false,
    agents: {
      reviewer: { id: "claude-deep", tool: "claude", model: "claude-opus-5-5" },
      reviewer_light: null,
      pool: [{ id: "claude-builder", tool: "claude", model: "claude-sonnet-5-5", default: true, note: "default builder" }],
      policy: "always-default",
    },
    blueprint: { tool: "claude", model: "claude-opus-5-5" },
    project: { type: "saas", stack: "next", modules: { database: "none", auth: "none", email: "none" }, scope: "mvp", ...project },
    fields: { name: "Demo Shop", brief: "A small shop.", users: "Customers", languages: ["en"], visibility: "private" },
    attachments: [],
  };
}

test("media.test.mjs (a) the catalogue offers generated media and the visual ambition to every type with screens", () => {
  const catalogue = loadCatalogue();
  const module = catalogue.modules.find((item) => item.id === "media");
  assert.deepEqual(module.providers.map((item) => item.id), ["none", "xai"]);
  assert.deepEqual(module.kinds.map((item) => item.id), ["image", "video", "voice"]);
  for (const provider of module.providers) {
    assert.equal(Object.hasOwn(provider, "method"), false, provider.id);
    assert.equal(Object.hasOwn(provider, "env"), false, provider.id);
  }
  assert.deepEqual(catalogue.types.filter((type) => Object.hasOwn(type.defaults, "media")).map((type) => type.id), MEDIA_TYPES);
  for (const id of MEDIA_TYPES) assert.equal(mediaModule(id).default, "none", id);
  for (const id of ["api", "cli", "library", "worker"]) assert.equal(mediaModule(id), null, id);
  assert.deepEqual(ambitions().map((item) => item.id), ["calm", "expressive", "showcase"]);
  assert.equal(defaultAmbition(), "expressive");
  assert.deepEqual(Object.keys(catalogue), ["$comment", "version", "types", "stacks", "modules", "ambitions", "documents"]);
});

test("media.test.mjs (b) init asks what to generate only after a provider, then the visual ambition after the scope", () => {
  const staged = stage();
  try {
    const result = init(staged, flow({ modules: ["database none", "", "auth none", "", "email none", "", "", "xai", "1, 3"], ambition: "showcase" }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const at = (text) => result.stdout.indexOf(text);
    assert.ok(at("Generated media — ") > 0);
    assert.ok(at("Media to generate") > at("Generated media — "));
    assert.ok(at("Visual ambition") > at("Scope"));
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.modules.media, "xai");
    assert.deepEqual(answers.media_kinds, ["image", "voice"]);
    assert.equal(answers.visual_ambition, "showcase");
    assert.deepEqual(Object.keys(answers).slice(Object.keys(answers).indexOf("scope"), Object.keys(answers).indexOf("scope") + 3), ["scope", "media_kinds", "visual_ambition"]);
    assert.equal(result.stdout.includes("Media to generate: image, voice"), true);
    assert.equal(result.stdout.includes("Visual ambition: showcase"), true);
  } finally {
    cleanup(staged.parent);
  }
});

test("media.test.mjs (c) without a provider nothing more is asked, and a type with no screens has neither question", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("Media to generate"), false);
    const answers = JSON.parse(readFileSync(path.join(staged.project, "devos", "answers.json"), "utf8"));
    assert.equal(answers.modules.media, "none");
    assert.equal(Object.hasOwn(answers, "media_kinds"), false);
    assert.equal(answers.visual_ambition, "expressive");
  } finally {
    cleanup(staged.parent);
  }
  const cli = stage();
  try {
    const result = init(cli, flow({ type: "cli", modules: [] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes("Visual ambition"), false);
    const answers = JSON.parse(readFileSync(path.join(cli.project, "devos", "answers.json"), "utf8"));
    assert.equal(Object.hasOwn(answers.modules, "media"), false);
    assert.equal(Object.hasOwn(answers, "media_kinds"), false);
    assert.equal(Object.hasOwn(answers, "visual_ambition"), false);
  } finally {
    cleanup(cli.parent);
  }
});

test("media.test.mjs (d) a plan carries the media kinds and the ambition, with their defaults, and refuses others", () => {
  const plain = validatePlan(validPlan({}), signedIn);
  assert.equal(plain.ok, true, plain.errors?.join(" | "));
  assert.equal(Object.hasOwn(plain.answers, "media_kinds"), false);
  assert.equal(plain.answers.visual_ambition, "expressive");
  const media = validatePlan(validPlan({ modules: { media: "xai" } }), signedIn);
  assert.equal(media.ok, true, media.errors?.join(" | "));
  assert.deepEqual(media.answers.media_kinds, ["image"]);
  const chosen = validatePlan(validPlan({ modules: { media: "xai" }, media_kinds: ["video", "voice"], ambition: "calm" }), signedIn);
  assert.equal(chosen.ok, true, chosen.errors?.join(" | "));
  assert.deepEqual(chosen.answers.media_kinds, ["video", "voice"]);
  assert.equal(chosen.answers.visual_ambition, "calm");
  for (const kinds of [[], ["audio"], ["image", "image"], "image"]) {
    assert.deepEqual(validatePlan(validPlan({ modules: { media: "xai" }, media_kinds: kinds }), signedIn).errors, [KINDS_MESSAGE], JSON.stringify(kinds));
  }
  assert.deepEqual(validatePlan(validPlan({ ambition: "loud" }), signedIn).errors, [AMBITION_MESSAGE]);
  const cli = validatePlan(validPlan({ type: "cli", stack: "node-cli", modules: {}, ambition: "showcase" }), signedIn);
  assert.equal(cli.ok, true, cli.errors?.join(" | "));
  assert.equal(Object.hasOwn(cli.answers, "visual_ambition"), false);
});

test("media.test.mjs (e) the page asks what to generate and the visual ambition, and keeps both for the next project", async () => {
  const page = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of [
    '"aria-label": "Media to generate"',
    'el("h2", { class: "section-title", text: "Visual ambition" })',
    '["Visual ambition", ',
    '["Media to generate", ',
    "...(mediaModule(d.type) && d.modules.media !== \"none\" ? { media_kinds: [...d.media_kinds] } : {}),",
    "...(mediaModule(d.type) ? { ambition: d.ambition } : {}),",
  ]) {
    assert.equal(page.includes(text), true, text);
  }
  const home = mkdtempSync(path.join(tmpdir(), "devos-media-"));
  const saved = process.env.DEVOS_HOME;
  process.env.DEVOS_HOME = home;
  try {
    const { readChoices, rememberChoices } = await import("../lib/ui-server.mjs");
    rememberChoices({ project: { type: "saas", stack: "next", modules: { media: "xai" }, scope: "mvp", media_kinds: ["image", "video"], ambition: "showcase" } }, path.join(home, "projects", "shop"));
    const choices = readChoices();
    assert.deepEqual(choices.project.media_kinds, ["image", "video"]);
    assert.equal(choices.project.ambition, "showcase");
  } finally {
    if (saved === undefined) delete process.env.DEVOS_HOME;
    else process.env.DEVOS_HOME = saved;
    cleanup(home);
  }
});
