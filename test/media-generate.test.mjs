import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { requestSha, runMedia, verifyBytes } from "../payload/files/scripts/devos/media.mjs";
import { keyName } from "../payload/files/scripts/devos/media-providers/index.mjs";
import { STAGES } from "../payload/files/scripts/devos/usage.mjs";

// E53c1 (PR-80): generation within a budget, made once, through a provider. No key and no network: fetch is a stub.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const KEY = "not-a-real-media-key";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(8)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(10)]);
const alt = { en: "A harbour at dawn" };
const IMAGE = { id: "hero", kind: "image", use: "Home: hero", file: "public/media/hero.jpg", prompt: "A harbour at dawn", aspect_ratio: "16:9", resolution: "1k", alt, status: "planned" };
const VIDEO = { id: "intro", kind: "video", use: "Home: intro", file: "public/media/intro.mp4", prompt: "Boats at dawn", aspect_ratio: "16:9", resolution: "720p", duration: 8, audio: false, alt, status: "planned" };
const VOICE = { id: "welcome", kind: "voice", use: "Home: welcome", file: "public/media/welcome.mp3", text: "Welcome.", language: "en", voice: "eve", status: "planned" };

function project(items) {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-media-gen-"));
  mkdirSync(path.join(dir, "devos"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "design"), { recursive: true });
  writeFileSync(path.join(dir, "devos", "answers.json"), `${JSON.stringify({ modules: { media: "xai" }, media_kinds: ["image", "video", "voice"], languages: ["en"] })}\n`);
  writeFileSync(path.join(dir, "docs", "design", "media.json"), `${JSON.stringify({ version: 1, provider: "xai", items }, null, 2)}\n`);
  return dir;
}

const planOf = (dir) => JSON.parse(readFileSync(path.join(dir, "docs", "design", "media.json"), "utf8"));
const row = (dir, id) => planOf(dir).items.find((item) => item.id === id);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A stub of the xAI API. `video` is the list of poll answers, the last one repeated. */
function api({ image = () => json({ data: [{ b64_json: JPEG.toString("base64") }] }), video = [{ status: "done", video: { url: "https://vidgen.x.ai/a/video.mp4", duration: 8 }, model: "grok-imagine-video-1.5-lite" }], voice = () => new Response(MP3) } = {}) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", auth: init.headers?.Authorization ?? "", body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/images/generations")) return image(calls.length);
    if (url.endsWith("/videos/generations")) return json({ request_id: "req-1" });
    if (url.includes("/videos/req-")) return json(video[Math.min(polls++, video.length - 1)]);
    if (url.startsWith("https://vidgen.x.ai/")) return new Response(MP4);
    if (url.endsWith("/tts")) return voice();
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, calls };
}

const run = (dir, options) => runMedia({ root: dir, env: { [keyName("xai")]: KEY }, sleep: async () => {}, now: () => NOW, ...options });

test("media-generate.test.mjs (a) a budget of 0 lists each estimate and calls nothing", async () => {
  const dir = project([IMAGE, VIDEO, VOICE]);
  try {
    const result = await run(dir, { budget: "0", fetch: async () => assert.fail("no call at a budget of 0") });
    assert.equal(result.code, 0);
    assert.deepEqual(result.lines, [
      "media: xai · budget $0.00 · 3 to make, estimated $0.28 · 0 already made",
      "- hero (image): estimated $0.04",
      "- intro (video): estimated $0.24",
      "- welcome (voice): estimated $0.00",
      "media: the budget is $0, so nothing is generated; set a budget to make these items",
    ]);
    assert.equal(existsSync(path.join(dir, "public")), false);
    const unset = await runMedia({ root: dir, env: {}, fetch: async () => assert.fail("no call without a budget") });
    assert.equal(unset.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (b) each kind is made, checked, recorded with its provenance and cost, and the key stays out", async () => {
  const dir = project([IMAGE, VIDEO, VOICE]);
  try {
    const { fetch, calls } = api({ video: [{ status: "pending" }, { status: "done", video: { url: "https://vidgen.x.ai/a/video.mp4", duration: 8 }, model: "grok-imagine-video-1.5-lite" }] });
    const result = await run(dir, { budget: "1", fetch });
    assert.equal(result.code, 0, result.lines.join("\n"));
    assert.deepEqual(readFileSync(path.join(dir, "public/media/hero.jpg")), JPEG);
    assert.deepEqual(readFileSync(path.join(dir, "public/media/intro.mp4")), MP4);
    assert.deepEqual(readFileSync(path.join(dir, "public/media/welcome.mp3")), MP3);
    const hero = row(dir, "hero");
    assert.deepEqual(
      { status: hero.status, model: hero.model, generated_on: hero.generated_on, terms_url: hero.terms_url, cost_usd: hero.cost_usd, cost_source: hero.cost_source, prompt_sha: hero.prompt_sha },
      { status: "generated", model: "grok-imagine-image-2.0", generated_on: "2026-11-05", terms_url: "https://x.ai/legal/terms-of-service", cost_usd: 0.04, cost_source: "price list", prompt_sha: requestSha(IMAGE) },
    );
    assert.equal(row(dir, "intro").cost_usd, 0.24);
    assert.equal(row(dir, "intro").model, "grok-imagine-video-1.5-lite");
    assert.equal(row(dir, "welcome").cost_usd, 0.0001);
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace("https://api.x.ai/v1", "")}`), [
      "POST /images/generations", "POST /videos/generations", "GET /videos/req-1", "GET /videos/req-1", "GET https://vidgen.x.ai/a/video.mp4", "POST /tts",
    ]);
    assert.deepEqual(calls[0].body, { model: "grok-imagine-image-2.0", prompt: "A harbour at dawn", n: 1, aspect_ratio: "16:9", resolution: "1k", quality: "low", response_format: "b64_json" });
    assert.deepEqual(calls[5].body, { text: "Welcome.", language: "en", voice_id: "eve", output_format: { codec: "mp3" } });
    assert.equal(calls.filter((call) => call.url.startsWith("https://api.x.ai/")).every((call) => call.auth === `Bearer ${KEY}`), true);
    const ledger = readFileSync(path.join(dir, "docs/usage/media.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(ledger.map((line) => [line.stage, line.tool, line.item, line.cost_usd]), [["media", "xai", "hero", 0.04], ["media", "xai", "intro", 0.24], ["media", "xai", "welcome", 0.0001]]);
    assert.equal(result.lines.at(-1), "media: 3 made, 0 failed, 0 over budget, 0 pending · spent $0.28 of $1.00");
    for (const text of [result.lines.join("\n"), readFileSync(path.join(dir, "docs/design/media.json"), "utf8"), readFileSync(path.join(dir, "docs/usage/media.jsonl"), "utf8")]) {
      assert.equal(text.includes(KEY), false);
    }
    assert.equal(existsSync(path.join(dir, "public/media/hero.jpg.part")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (c) a made item is never made again, and a changed request makes only that item", async () => {
  const dir = project([IMAGE, VOICE]);
  try {
    await run(dir, { budget: "1", fetch: api().fetch });
    const again = await run(dir, { budget: "1", fetch: async () => assert.fail("nothing to make") });
    assert.equal(again.code, 0);
    assert.equal(again.lines[0], "media: xai · budget $1.00 · 0 to make, estimated $0.00 · 2 already made");
    const plan = planOf(dir);
    plan.items[0].prompt = "A harbour at dusk";
    writeFileSync(path.join(dir, "docs/design/media.json"), `${JSON.stringify(plan, null, 2)}\n`);
    const { fetch, calls } = api();
    const changed = await run(dir, { budget: "1", fetch });
    assert.equal(changed.code, 0);
    assert.deepEqual(calls.map((call) => call.url.replace("https://api.x.ai/v1", "")), ["/images/generations"]);
    assert.equal(row(dir, "hero").prompt_sha, requestSha({ ...IMAGE, prompt: "A harbour at dusk" }));
    rmSync(path.join(dir, "public/media/welcome.mp3"));
    const missing = await run(dir, { budget: "1", fetch: api().fetch });
    assert.equal(missing.lines.some((line) => line.startsWith("- welcome (voice): made")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (d) the budget stops before an item that does not fit, which stays planned", async () => {
  const dir = project([IMAGE, VIDEO]);
  try {
    const { fetch, calls } = api();
    const result = await run(dir, { budget: "0.05", fetch });
    assert.equal(result.code, 0);
    assert.equal(result.lines.includes("- intro (video): over budget (estimated $0.24, $0.01 left)"), true, result.lines.join("\n"));
    assert.equal(row(dir, "intro").status, "planned");
    assert.equal(calls.some((call) => call.url.includes("/videos")), false);
    assert.equal(result.lines.at(-1), "media: 1 made, 0 failed, 1 over budget, 0 pending · spent $0.04 of $0.05");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (e) 429 and 5xx are tried again, a refusal is recorded without the key, and the run goes on", async () => {
  const dir = project([IMAGE, VOICE]);
  try {
    const waits = [];
    let tries = 0;
    const { fetch } = api({
      image: () => (++tries <= 2 ? json({ error: "busy" }, tries === 1 ? 429 : 503) : json({ data: [{ b64_json: JPEG.toString("base64") }] })),
      voice: () => json({ error: { message: `blocked for key ${KEY}` } }, 400),
    });
    const result = await runMedia({ root: dir, env: { DEVOS_MEDIA_XAI_KEY: KEY }, budget: "1", fetch, sleep: async (ms) => waits.push(ms), now: () => NOW });
    assert.deepEqual(waits, [2000, 4000]);
    assert.equal(row(dir, "hero").status, "generated");
    assert.equal(result.code, 1);
    assert.equal(row(dir, "welcome").status, "planned");
    assert.equal(row(dir, "welcome").last_error, "voice: HTTP 400: blocked for key [key]");
    assert.equal(result.lines.join("\n").includes(KEY), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (f) a video not done in time keeps its request, and the next run resumes it without paying again", async () => {
  const dir = project([VIDEO]);
  try {
    const first = await run(dir, { budget: "1", fetch: api({ video: [{ status: "pending" }] }).fetch });
    assert.equal(first.code, 0);
    assert.equal(first.lines.includes("- intro (video): still being made; the next run resumes request req-1"), true, first.lines.join("\n"));
    assert.equal(row(dir, "intro").request_id, "req-1");
    assert.equal(row(dir, "intro").requested_on, "2026-11-05T12:00:00.000Z");
    const { fetch, calls } = api();
    const second = await run(dir, { budget: "1", fetch });
    assert.equal(second.code, 0);
    assert.equal(second.lines[0], "media: xai · budget $1.00 · 1 to make, estimated $0.00 · 0 already made");
    assert.equal(calls.some((call) => call.url.endsWith("/videos/generations")), false);
    assert.equal(row(dir, "intro").status, "generated");
    assert.equal(Object.hasOwn(row(dir, "intro"), "request_id"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (g) a file that is not what its name says is refused, and a name the provider cannot make costs nothing", async () => {
  assert.equal(verifyBytes("a.jpg", JPEG), true);
  assert.equal(verifyBytes("a.jpg", PNG), false);
  assert.equal(verifyBytes("a.mp4", MP4), true);
  assert.equal(verifyBytes("a.mp3", Buffer.alloc(0)), false);
  const dir = project([IMAGE, { ...IMAGE, id: "texture", file: "public/media/texture.webp" }]);
  try {
    const { fetch, calls } = api({ image: () => json({ data: [{ b64_json: PNG.toString("base64") }] }) });
    const result = await run(dir, { budget: "1", fetch });
    assert.equal(result.code, 1);
    assert.equal(row(dir, "hero").last_error, "the provider's file is not a .jpg file");
    assert.equal(existsSync(path.join(dir, "public/media/hero.jpg")), false);
    assert.equal(existsSync(path.join(dir, "public/media/hero.jpg.part")), false);
    assert.equal(result.lines.includes("- texture (image): cannot be made: xai makes image files ending .jpg or .jpeg; rename public/media/texture.webp in the plan"), true, result.lines.join("\n"));
    assert.equal(calls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (h) a paid run without the key, an unknown item or a bad budget stops before any call", async () => {
  const dir = project([IMAGE]);
  try {
    const never = async () => assert.fail("no call");
    const nokey = await runMedia({ root: dir, env: {}, budget: "1", fetch: never });
    assert.equal(nokey.code, 2);
    assert.equal(nokey.lines.at(-1), "media: DEVOS_MEDIA_XAI_KEY is not set; it is read from the environment only");
    assert.equal((await run(dir, { budget: "1", only: "nope", fetch: never })).lines.at(-1), "media: not in docs/design/media.json: nope");
    assert.equal((await run(dir, { budget: "-1", fetch: never })).code, 2);
    assert.equal((await runMedia({ root: dir, env: { DEVOS_MEDIA_BUDGET: "lots" }, fetch: never })).code, 2);
    rmSync(path.join(dir, "docs/design/media.json"));
    assert.equal((await run(dir, { budget: "1", fetch: never })).lines.at(-1), "media: no docs/design/media.json; generated media is planned by the blueprint (PR-79)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (i) devos media estimates without a budget, asks before it pays, and needs the key from the shell", () => {
  const dir = project([IMAGE]);
  try {
    // The project's runner scripts, as an install leaves them (media.mjs reads the fence's line through fence-check.mjs, PR-81).
    cpSync(path.join(root, "payload/files/scripts/devos"), path.join(dir, "scripts", "devos"), { recursive: true });
    const env = { ...process.env };
    delete env.DEVOS_MEDIA_XAI_KEY;
    delete env.DEVOS_MEDIA_BUDGET;
    const devos = (args, input = "") => spawnSync(process.execPath, [bin, "media", dir, ...args], { encoding: "utf8", input, env, windowsHide: true });
    const estimate = devos([]);
    assert.equal(estimate.status, 0, estimate.stdout + estimate.stderr);
    assert.equal(estimate.stdout.includes("- hero (image): estimated $0.04"), true, estimate.stdout);
    assert.equal(estimate.stdout.includes("devos media: nothing was generated. Add --budget <usd> to make these items"), true, estimate.stdout);
    const declined = devos(["--budget", "0.10"], "no\n");
    assert.equal(declined.status, 1, declined.stdout);
    assert.equal(declined.stdout.includes("Generate within a budget of $0.10? This is paid by your provider account. Type yes to go on:"), true, declined.stdout);
    assert.equal(declined.stdout.includes("devos media: nothing was generated"), true, declined.stdout);
    const nokey = devos(["--budget", "0.10", "--yes"]);
    assert.equal(nokey.status, 2, nokey.stdout);
    assert.equal(nokey.stdout.includes("media: DEVOS_MEDIA_XAI_KEY is not set; it is read from the environment only"), true, nokey.stdout);
    assert.equal(row(dir, "hero").status, "planned");
    const usage = spawnSync(process.execPath, [bin, "media", "--budget"], { encoding: "utf8", env, windowsHide: true });
    assert.equal(usage.status, 2);
    assert.equal(usage.stdout.trim(), "devos: usage: devos media [folder] [--budget <usd>] [--only <id,id>] [--yes]");
    const help = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8", windowsHide: true });
    assert.equal(help.stdout.includes("devos media [folder] [--budget <usd>] [--only <id,id>] [--yes]\n"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media-generate.test.mjs (j) the method generates media only within a budget, and only once (PR-80)", () => {
  const has = (file, sentence) => assert.equal(readFileSync(path.join(root, file), "utf8").includes(sentence), true, `${file}: ${sentence}`);
  has("payload/files/docs/method/PRECEDENTS.md", "| PR-80 | **Media is generated only within a budget the developer sets, and only once.**");
  has("payload/files/docs/method/AUTOMATION.md", "| `media.mjs` · `media-providers/` | generated media (PR-80):");
  has("payload/files/docs/method/DESIGN_METHOD.md", "**Generation** (PR-80) is `scripts/devos/media.mjs`, or `devos media` on the developer's computer.");
  has("README.md", "| `devos media [folder] [--budget <usd>] [--only <id,…>] [--yes]` |");
  has("lib/setup.mjs", "from your shell, never from a file. Without \\`--budget\\` it only estimates.");
  assert.equal(STAGES.includes("media"), true);
  assert.equal(keyName("xai"), "DEVOS_MEDIA_XAI_KEY");
});
