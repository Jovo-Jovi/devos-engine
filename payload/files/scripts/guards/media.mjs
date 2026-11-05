// guard:media — the media plan (PR-79, docs/method/DESIGN_METHOD.md §8). With generated media chosen at setup,
// docs/design/media.json lists every image, video and voice item the product shows, and the design contract names
// the visual ambition. Images the developer owns (PR-82) are items with the source `own`, taken from docs/design/own/
// as they are; a project without generated media lists only those, with the provider `none`. N/A for a project that
// chose neither.
import { exists, read, result } from "./lib.mjs";

const ANSWERS = "devos/answers.json";
const PLAN = "docs/design/media.json";
const DESIGN = "docs/DESIGN_SYSTEM.md";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXTENSIONS = { image: [".png", ".jpg", ".jpeg", ".webp"], video: [".mp4"], voice: [".mp3", ".wav"], own: [".png", ".jpg", ".jpeg", ".webp", ".gif"] };
const OWN_DIR = "docs/design/own/";
const XAI = {
  image: { aspect_ratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9"], resolution: ["1k", "2k"] },
  video: { aspect_ratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"], resolution: ["480p", "720p", "1080p"] },
};
const VOICE_TEXT_MAX = 60000;

const text = (value) => typeof value === "string" && value.trim() !== "";
const extensionOf = (file) => (/\.[^./]+$/.exec(file)?.[0] ?? "").toLowerCase();

function ambitionFindings(answers) {
  const wanted = answers.visual_ambition;
  if (typeof wanted !== "string" || !exists(DESIGN)) return [];
  const line = read(DESIGN).match(/Visual ambition:\s*[*_`]*\s*([A-Za-z]+)/i);
  if (!line) return [`${DESIGN}: no "Visual ambition: ${wanted}" line (PR-79)`];
  if (line[1].toLowerCase() !== wanted) return [`${DESIGN}: the visual ambition is ${line[1].toLowerCase()}, devos/answers.json says ${wanted}`];
  return [];
}

function fileFindings(item, at, kind) {
  const file = item.file;
  if (!text(file)) return [`${at}: file is missing`];
  const out = [];
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.includes("\\") || file.split("/").includes("..")) {
    out.push(`${at}: file ${file} must be a relative path inside the project, with / and no ..`);
  }
  const extensions = EXTENSIONS[kind] ?? [];
  if (extensions.length > 0 && !extensions.some((ext) => file.toLowerCase().endsWith(ext))) {
    out.push(`${at}: file ${file} must end with ${extensions.join(", ")}`);
  }
  return out;
}

function altFindings(item, at, ctx) {
  if (item.decorative === true) return [];
  return ctx.languages.filter((language) => !text(item.alt?.[language])).map((language) => `${at}: alt.${language} is missing (or mark the item decorative)`);
}

// PR-82: an image the developer owns is shown as it is: its file is a copy of `from`, placed by the runner.
function ownFindings(item, at, ctx) {
  const out = [];
  if (item.kind !== "image") out.push(`${at}: an image you own has the kind image`);
  if (!text(item.use)) out.push(`${at}: use must say where the item appears`);
  out.push(...fileFindings(item, at, "own"));
  const from = item.from;
  if (!text(from) || !from.startsWith(OWN_DIR) || from.slice(OWN_DIR.length).includes("/") || from.length === OWN_DIR.length) {
    out.push(`${at}: from must name a file in ${OWN_DIR}`);
  } else if (!exists(from)) out.push(`${at}: ${from} does not exist`);
  else if (text(item.file) && extensionOf(item.file) !== extensionOf(from)) out.push(`${at}: file ${item.file} must keep the extension of ${from}, which is shown as it is`);
  out.push(...altFindings(item, at, ctx));
  if (item.status === "placed") {
    if (text(item.file) && !exists(item.file)) out.push(`${at}: placed, but ${item.file} does not exist`);
  } else if (item.status !== "planned") {
    out.push(`${at}: status must be planned or placed`);
  }
  return out;
}

function itemFindings(item, index, ctx) {
  const at = `${PLAN}: item ${text(item?.id) ? item.id : index + 1}`;
  if (!item || typeof item !== "object" || Array.isArray(item)) return [`${at}: not an object`];
  const out = [];
  if (!text(item.id) || !ID.test(item.id)) out.push(`${at}: id must be lower-case words joined by -`);
  else if (ctx.ids.has(item.id)) out.push(`${at}: duplicate id`);
  else ctx.ids.add(item.id);
  if (text(item.file)) {
    if (ctx.files.has(item.file)) out.push(`${at}: file ${item.file} is listed twice`);
    ctx.files.add(item.file);
  }
  if (item.source === "own") return [...out, ...ownFindings(item, at, ctx)];
  if (item.source !== undefined) out.push(`${at}: source must be own, or absent for generated media`);
  if (!ctx.generated) return [...out, `${at}: generated media is None in ${ANSWERS}: list only images you own (source own)`];
  const kind = item.kind;
  if (!ctx.kinds.includes(kind)) {
    out.push(`${at}: kind must be one of ${ctx.kinds.join(", ")} (devos/answers.json media_kinds)`);
    return out;
  }
  if (!text(item.use)) out.push(`${at}: use must say where the item appears`);
  out.push(...fileFindings(item, at, kind));
  if (kind === "image" || kind === "video") {
    if (!text(item.prompt)) out.push(`${at}: prompt is missing`);
    const allowed = ctx.provider === "xai" ? XAI[kind] : null;
    if (allowed && !allowed.aspect_ratio.includes(item.aspect_ratio)) out.push(`${at}: aspect_ratio must be one of ${allowed.aspect_ratio.join(", ")}`);
    if (allowed && !allowed.resolution.includes(item.resolution)) out.push(`${at}: resolution must be one of ${allowed.resolution.join(", ")}`);
    out.push(...altFindings(item, at, ctx));
  }
  if (kind === "video") {
    if (!Number.isInteger(item.duration) || item.duration < 1 || item.duration > 15) out.push(`${at}: duration must be a whole number of seconds from 1 to 15`);
    if (typeof item.audio !== "boolean") out.push(`${at}: audio must be true or false`);
  }
  if (kind === "voice") {
    if (!text(item.text)) out.push(`${at}: text is missing`);
    else if (item.text.length > VOICE_TEXT_MAX) out.push(`${at}: text is longer than ${VOICE_TEXT_MAX} characters`);
    if (!text(item.language)) out.push(`${at}: language is missing`);
    if (!text(item.voice)) out.push(`${at}: voice is missing`);
  }
  if (item.status === "generated") {
    if (!text(item.model)) out.push(`${at}: a generated item records its model`);
    if (!text(item.generated_on) || !DATE.test(item.generated_on)) out.push(`${at}: a generated item records generated_on as YYYY-MM-DD`);
    if (!text(item.terms_url) || !item.terms_url.startsWith("https://")) out.push(`${at}: a generated item records the provider's terms_url (https://)`);
    if (typeof item.cost_usd !== "number" || !(item.cost_usd >= 0)) out.push(`${at}: a generated item records cost_usd`);
    if (text(item.file) && !exists(item.file)) out.push(`${at}: generated, but ${item.file} does not exist`);
  } else if (item.status !== "planned") {
    out.push(`${at}: status must be planned or generated`);
  }
  return out;
}

export default function media() {
  if (!exists(ANSWERS)) return result("N/A", [], `no ${ANSWERS}`);
  let answers;
  try {
    answers = JSON.parse(read(ANSWERS));
  } catch (error) {
    return result("FAIL", [`${ANSWERS}: ${error.message}`]);
  }
  const provider = answers?.modules?.media;
  const chosen = typeof provider === "string" && provider !== "none";
  const findings = ambitionFindings(answers);
  // PR-82: without generated media, a plan may list only the images the developer owns, with the provider none.
  let ownOnly = false;
  if (!chosen && exists(PLAN)) {
    try {
      ownOnly = JSON.parse(read(PLAN))?.provider === "none";
    } catch {
      ownOnly = false;
    }
  }
  if (!chosen && !ownOnly) {
    if (exists(PLAN)) findings.push(`${PLAN}: generated media is None in ${ANSWERS}`);
    if (findings.length > 0) return result("FAIL", findings);
    if (typeof answers.visual_ambition !== "string") return result("N/A", [], "no generated media and no visual ambition");
    return result("PASS", [], exists(DESIGN) ? `ambition ${answers.visual_ambition}` : "ambition: no design contract yet");
  }
  if (!exists(PLAN)) return result("FAIL", [...findings, `${PLAN} is missing: generated media is chosen (PR-79)`]);
  let plan;
  try {
    plan = JSON.parse(read(PLAN));
  } catch (error) {
    return result("FAIL", [...findings, `${PLAN}: ${error.message}`]);
  }
  if (plan?.version !== 1) findings.push(`${PLAN}: version must be 1`);
  const expected = chosen ? provider : "none";
  if (plan?.provider !== expected) findings.push(`${PLAN}: provider must be ${expected}, as in ${ANSWERS}`);
  const items = Array.isArray(plan?.items) ? plan.items : null;
  if (!items) findings.push(`${PLAN}: items must be a list`);
  else if (items.length === 0) findings.push(`${PLAN}: no items: plan what the screens show, or choose None at setup`);
  const ctx = {
    provider,
    generated: chosen,
    kinds: Array.isArray(answers.media_kinds) && answers.media_kinds.length > 0 ? answers.media_kinds : ["image"],
    languages: Array.isArray(answers.languages) && answers.languages.length > 0 ? answers.languages : ["en"],
    ids: new Set(),
    files: new Set(),
  };
  (items ?? []).forEach((item, index) => findings.push(...itemFindings(item, index, ctx)));
  if (findings.length > 0) return result("FAIL", findings);
  const generated = items.filter((item) => item.status === "generated").length;
  const own = items.filter((item) => item.source === "own");
  const placed = own.filter((item) => item.status === "placed").length;
  return result("PASS", [], `${items.length} items, ${generated} generated${own.length > 0 ? `, ${placed} of ${own.length} own placed` : ""}`);
}
