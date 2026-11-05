// xAI, the first media provider (PR-80): Grok Imagine images and video, and text to speech.
// Endpoints and prices from docs.x.ai, 2026-11-05. A response that reports its cost wins over the price list.
const API = "https://api.x.ai/v1";
const TERMS = "https://x.ai/legal/terms-of-service";
const IMAGE_MODEL = "grok-imagine-image-2.0";
const VIDEO_MODEL = "grok-imagine-video-1.5-lite";
const TTS_MODEL = "tts";
// USD per image by resolution and quality; per second of video by resolution; per character of speech.
const IMAGE_PRICE = { "1k": { low: 0.04, medium: 0.06 }, "2k": { low: 0.06, medium: 0.08 } };
const VIDEO_PRICE = { "480p": 0.02, "720p": 0.03, "1080p": 0.14 };
const TTS_PRICE = 15 / 1e6;
const POLL_EVERY_MS = 5000;
const POLLS = 120;

export class Pending extends Error {
  constructor(requestId) {
    super("the video is still being made");
    this.requestId = requestId;
  }
}

const quality = (item) => (item.quality === "medium" ? "medium" : "low");
const round = (usd) => Math.round(usd * 10000) / 10000;

function estimate(item) {
  if (item.kind === "image") return IMAGE_PRICE[item.resolution]?.[quality(item)] ?? IMAGE_PRICE["1k"].low;
  if (item.kind === "video") return round((VIDEO_PRICE[item.resolution] ?? VIDEO_PRICE["480p"]) * Number(item.duration ?? 0));
  if (item.kind === "voice") return round(String(item.text ?? "").length * TTS_PRICE);
  return 0;
}

/** The cost a response reports, in USD, or null. xAI reports usage cost in ticks of 1e-10 USD. */
function reportedCost(body) {
  const ticks = body?.usage?.cost_in_usd_ticks;
  return typeof ticks === "number" && Number.isFinite(ticks) && ticks >= 0 ? round(ticks / 1e10) : null;
}

async function failure(response, what) {
  let message = "";
  try {
    const body = await response.json();
    message = typeof body?.error === "string" ? body.error : (body?.error?.message ?? body?.message ?? "");
  } catch {
    /* no JSON body */
  }
  const error = new Error(`${what}: HTTP ${response.status}${message ? `: ${String(message).slice(0, 200)}` : ""}`);
  error.status = response.status;
  return error;
}

async function postJson(ctx, path, payload, what) {
  const response = await ctx.fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await failure(response, what);
  return response;
}

async function image(item, ctx) {
  const response = await postJson(ctx, "/images/generations", {
    model: IMAGE_MODEL,
    prompt: item.prompt,
    n: 1,
    aspect_ratio: item.aspect_ratio,
    resolution: item.resolution,
    quality: quality(item),
    response_format: "b64_json",
  }, "image");
  const body = await response.json();
  const data = body?.data?.[0];
  if (data?.respect_moderation === false) throw Object.assign(new Error("image: refused by the provider's moderation"), { status: 400 });
  if (typeof data?.b64_json !== "string" || data.b64_json === "") throw new Error("image: the response holds no image");
  const reported = reportedCost(body);
  return { bytes: Buffer.from(data.b64_json, "base64"), model: IMAGE_MODEL, cost_usd: reported ?? estimate(item), cost_source: reported === null ? "price list" : "reported" };
}

async function video(item, ctx) {
  let requestId = item.request_id;
  if (typeof requestId !== "string" || requestId === "") {
    const started = await (await postJson(ctx, "/videos/generations", {
      model: VIDEO_MODEL,
      prompt: item.prompt,
      duration: item.duration,
      aspect_ratio: item.aspect_ratio,
      resolution: item.resolution,
      generate_audio: item.audio === true,
    }, "video")).json();
    requestId = started?.request_id;
    if (typeof requestId !== "string" || requestId === "") throw new Error("video: the response holds no request_id");
    ctx.started?.(requestId);
  }
  for (let poll = 0; poll < POLLS; poll += 1) {
    const response = await ctx.fetch(`${API}/videos/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${ctx.key}` } });
    if (!response.ok) throw await failure(response, "video");
    const body = await response.json();
    if (body?.status === "failed") throw Object.assign(new Error(`video: ${String(body?.error?.message ?? "failed").slice(0, 200)}`), { status: 400 });
    if (body?.status === "done") {
      if (body?.video?.respect_moderation === false) throw Object.assign(new Error("video: refused by the provider's moderation"), { status: 400 });
      const url = body?.video?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("video: the response holds no video URL");
      const file = await ctx.fetch(url);
      if (!file.ok) throw await failure(file, "video download");
      const seconds = Number(body?.video?.duration);
      const reported = reportedCost(body);
      const listed = round((VIDEO_PRICE[item.resolution] ?? VIDEO_PRICE["480p"]) * (Number.isFinite(seconds) && seconds > 0 ? seconds : Number(item.duration)));
      return { bytes: Buffer.from(await file.arrayBuffer()), model: body?.model || VIDEO_MODEL, cost_usd: reported ?? listed, cost_source: reported === null ? "price list" : "reported" };
    }
    await ctx.sleep(POLL_EVERY_MS);
  }
  throw new Pending(requestId);
}

async function voice(item, ctx) {
  const codec = String(item.file ?? "").toLowerCase().endsWith(".wav") ? "wav" : "mp3";
  const response = await postJson(ctx, "/tts", {
    text: item.text,
    language: item.language,
    voice_id: item.voice,
    output_format: { codec },
  }, "voice");
  return { bytes: Buffer.from(await response.arrayBuffer()), model: TTS_MODEL, cost_usd: estimate(item), cost_source: "price list" };
}

export default {
  id: "xai",
  kinds: ["image", "video", "voice"],
  terms_url: TERMS,
  models: { image: IMAGE_MODEL, video: VIDEO_MODEL, voice: TTS_MODEL },
  formats: { image: [".jpg", ".jpeg"], video: [".mp4"], voice: [".mp3", ".wav"] },
  estimate,
  async generate(item, ctx) {
    if (item.kind === "image") return image(item, ctx);
    if (item.kind === "video") return video(item, ctx);
    if (item.kind === "voice") return voice(item, ctx);
    throw new Error(`xai makes no ${item.kind}`);
  },
};
