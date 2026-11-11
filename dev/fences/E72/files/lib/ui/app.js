// DEV_OS guided setup: the page that `devos ui` serves.
// It talks only to its own server: /api/state, /api/plan, /api/start, /api/events, /api/answer and /api/stop, and
// /api/models for a started project's models (E25b), /api/hub and /api/clone for a current project's page (E26a),
// /api/adopt/check and /api/adopt/start to add DEV_OS to an existing project (E39).
// Every /api/ call carries the run's token in the X-DEVOS-Token header.
// A key is never kept: it goes from its field to /api/answer, and the field is cleared before the request is sent.
// The page writes no inline style and no inline script (the server's CSP forbids both).

const TOKEN_KEY = "devos.token";
const DRAFT_KEY = "devos.draft";
const THEME_KEY = "devos.theme";
const KEY_RE = /^[A-Z][A-Z0-9-]{1,31}$/;
const LANGUAGE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
// PR-59, PR-60: documents for the blueprint, and full-quality images of designs the developer likes (kept in
// docs/design/references/). Each file is sent alone (POST /api/file), so many large images fit.
const TEXT_EXT = [".md", ".txt", ".csv", ".json", ".yaml", ".yml"];
const PDF_EXT = [".pdf"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const ATTACH_EXT = [...TEXT_EXT, ...PDF_EXT, ...IMAGE_EXT];
const MIB = 1024 * 1024;
const LIMITS = { text: MIB, pdf: 20 * MIB, image: 20 * MIB };
const ATTACH_MAX = 30;
const TOTAL_LIMIT = 200 * MIB;
const kindOf = (name) => {
  const lower = name.toLowerCase();
  if (TEXT_EXT.some((ext) => lower.endsWith(ext))) return "text";
  if (PDF_EXT.some((ext) => lower.endsWith(ext))) return "pdf";
  if (IMAGE_EXT.some((ext) => lower.endsWith(ext))) return "image";
  return null;
};
const NS = "http://www.w3.org/2000/svg";

const STEPS = [
  { id: "machine", group: "choices", label: "This computer" },
  { id: "contract", group: "choices", label: "Contract" },
  { id: "reviewers", group: "choices", label: "Reviewers" },
  { id: "builders", group: "choices", label: "Builders" },
  { id: "blueprint-agent", group: "choices", label: "Blueprint agent" },
  { id: "type", group: "choices", label: "Project type" },
  { id: "stack", group: "choices", label: "Stack" },
  { id: "modules", group: "choices", label: "Modules" },
  { id: "scope", group: "choices", label: "Scope" },
  { id: "details", group: "choices", label: "Project details" },
  { id: "documents", group: "choices", label: "Documents" },
  { id: "review", group: "choices", label: "Review" },
  { id: "drafting", group: "build", label: "Blueprint" },
  { id: "approve", group: "build", label: "Approve" },
  { id: "keys", group: "github", label: "Keys" },
  { id: "github", group: "github", label: "GitHub" },
  { id: "backup", group: "github", label: "Backup" },
  { id: "finish", group: "github", label: "Finish" },
];
const GROUPS = [["choices", "Your choices"], ["build", "The blueprint"], ["github", "GitHub"]];
// E71: an adoption's own steps, in the order devos adopt asks them (never the new project's).
const ADOPT_STEPS = [
  { id: "machine", group: "project", label: "This computer" },
  { id: "adopt", group: "project", label: "Project and survey" },
  { id: "brief", group: "project", label: "Brief" },
  { id: "contract", group: "devos", label: "Contract" },
  { id: "link", group: "devos", label: "Control Tower" },
  { id: "agents", group: "devos", label: "Cycle agents" },
  { id: "deploy", group: "devos", label: "Deploy" },
  { id: "write", group: "devos", label: "Add DEV_OS" },
  { id: "keys", group: "github", label: "Keys" },
  { id: "publish", group: "github", label: "Pull request" },
  { id: "finish", group: "github", label: "Done" },
];
const ADOPT_GROUPS = [["project", "Your project"], ["devos", "DEV_OS"], ["github", "GitHub"]];
// E72: opening a current project has its own three steps (never the new project's).
const CURRENT_STEPS = [
  { id: "machine", group: "open", label: "This computer" },
  { id: "current", group: "open", label: "Find the project" },
  { id: "hub", group: "open", label: "Project page" },
];
const CURRENT_GROUPS = [["open", "Current project"]];
const LIVE = new Set(["drafting", "approve", "keys", "github", "backup", "finish"]);
// E72: the documents every blueprint writes; the drafting screen ticks each one when the agent writes it.
const BLUEPRINT_DOCS = [["docs/PHASES.md", "Phases and tasks"], ["docs/GLOSSARY.md", "Words the project uses"], ["docs/fences/T01.md", "First task: the skeleton"]];
const LOCAL_STAGES = [["handover", "Hand the project over"], ["commit", "Commit the project"], ["backup", "GitHub backup (optional)"]];
const SETUP_STAGES = [
  ["commit", "Commit the project"],
  ["repository", "Create the repository and push"],
  ["permissions", "Set workflow permissions"],
  ["variables", "Set the variables"],
  ["secrets", "Upload the keys as secrets"],
  ["check", "Check the setup"],
  ["cycle", "Start the first cycle"],
];
const EARLY_SETUP = new Set(["owner", "setup", "keys"]);
const EFFORT_LEVELS = [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"]];
// PR-86: Claude Code's --effort also takes max; Codex stops at extra high.
const MAX_EFFORT = ["max", "Max"];
const EFFORT_FLAG_TOOLS = new Set(["claude", "codex"]);
const PINNED_EFFORT = /-(?:low|medium|high|xhigh)(?:-fast)?$|-fast(?:-(?:low|medium|high|xhigh))?$/;
const BUILDER_EFFORT_OPTIONS = [
  ["", "Reviewer chooses for each task"],
  ["low", "Low, every task"],
  ["medium", "Medium, every task"],
  ["high", "High, every task"],
  ["xhigh", "Extra high, every task"],
];

// ---------- small helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value);
    else if (typeof value === "boolean" || name === "value") node[name] = value;
    else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

function put(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const ICONS = {
  check: ["M4 12.5l5 5L20 6.5"],
  cross: ["M6 6l12 12M18 6L6 18"],
  dash: ["M6 12h12"],
  info: ["M12 8v.01M12 11v6", "circle:12:12:9"],
  alert: ["M12 8v5M12 16.5v.01", "M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5.5 11h13v9.5h-13z"],
  plus: ["M12 5v14M5 12h14"],
  remove: ["M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"],
  done: ["circle:32:32:26", "M20 33l8 8 17-18"],
  stop: ["circle:32:32:26", "M24 24h16v16H24z"],
  fail: ["circle:32:32:26", "M32 20v15M32 42v.01"],
};

function icon(name, cls = "", box = name === "done" || name === "stop" || name === "fail" ? 64 : 24) {
  const node = svg("svg", { viewBox: `0 0 ${box} ${box}`, "aria-hidden": "true", class: cls || null });
  // E72: a finish mark draws itself; one unit long, its stroke animates from the CSS.
  const length = box === 64 ? "1" : null;
  for (const part of ICONS[name] ?? []) {
    if (part.startsWith("circle:")) {
      const [, cx, cy, r] = part.split(":");
      node.append(svg("circle", { cx, cy, r, pathLength: length }));
    } else {
      node.append(svg("path", { d: part, pathLength: length }));
    }
  }
  return node;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode: the draft lives in memory only */ }
}

function slugText(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function agentId(tool, model) {
  const prefix = `${tool}-`;
  const rest = String(model).toLowerCase().startsWith(prefix) ? String(model).slice(prefix.length) : model;
  return `${tool}-${slugText(rest)}`;
}

function keyFromName(name) {
  let key = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[A-Z]/.test(key)) key = `P-${key}`;
  return key.slice(0, 32).replace(/-+$/g, "");
}

function parseLanguages(text) {
  return String(text).split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

function absolutePath(text) {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(String(text));
}

function joinPath(parent, name) {
  const sep = String(parent).includes("\\") ? "\\" : "/";
  return `${String(parent).replace(/[\\/]+$/, "")}${sep}${name}`;
}

function quoted(folder) {
  return /\s/.test(folder) ? `"${folder}"` : folder;
}

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

// E72: a method text may name a precedent ("(PR-29)"); the page shows it without the id.
function plain(text) {
  return String(text ?? "").replace(/,\s*PR-\d+\)/g, ")").replace(/\s*\(PR-\d+\)/g, "");
}

// Text with URLs and `code` spans, built as nodes (never as HTML).
function richText(text) {
  text = plain(text);
  const out = [];
  const pattern = /(https?:\/\/[^\s)]+)|`([^`]+)`/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1]) {
      const url = match[1].replace(/[.,;]+$/, "");
      out.push(el("a", { href: url, target: "_blank", rel: "noreferrer noopener", text: url }));
      out.push(match[1].slice(url.length));
    } else {
      out.push(el("code", { text: match[2] }));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- token and API ----------

function readToken() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("t") ?? "";
  if (fromUrl) {
    storageSet(TOKEN_KEY, fromUrl);
    history.replaceState(null, "", "/");
    return fromUrl;
  }
  return storageGet(TOKEN_KEY) ?? "";
}

const TOKEN = readToken();

async function api(path, { method = "GET", body } = {}) {
  const headers = { "X-DEVOS-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { status: 0, data: null };
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { status: response.status, data };
}

/** Send one attachment to the engine (PR-60). True when it was stored. */
async function upload(file) {
  try {
    const response = await fetch("/api/file", {
      method: "POST",
      headers: { "X-DEVOS-Token": TOKEN, "X-DEVOS-Name": file.name, "Content-Type": "application/octet-stream" },
      body: file,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------- app state ----------

const app = {
  state: null,
  step: "machine",
  draft: null,
  files: [],
  fileErrors: [],
  own: [],
  ownErrors: [],
  uploading: 0,
  review: null,
  reviewing: false,
  starting: false,
  run: freshRun(),
  given: { create: null },
  listening: false,
  stopping: false,
  screenKey: "",
  live: null,
  timer: 0,
  sent: false,
  error: "",
};

function freshRun() {
  return {
    started: false,
    logs: [],
    phase: "",
    round: 0,
    roundAt: 0,
    ask: null,
    setupNow: "",
    setupDone: new Set(),
    done: null,
    now: null,
    activity: [],
    mode: "",
    asks: 0,
    at: "",
    adopt: {},
  };
}

function clockText(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min`;
}

function catalogue() {
  return app.state.catalogue;
}

function typeOf(id) {
  return catalogue().types.find((type) => type.id === id);
}

function stacksFor(typeId) {
  return catalogue().stacks.filter((stack) => stack.runs === true && stack.fits.includes(typeId));
}

function stackOf(id) {
  return catalogue().stacks.find((stack) => stack.id === id);
}

function modulesFor(typeId) {
  const defaults = typeOf(typeId)?.defaults ?? {};
  return catalogue().modules
    .filter((module) => Object.hasOwn(defaults, module.id))
    .map((module) => ({ ...module, default: defaults[module.id] }));
}

function mediaModule(typeId) {
  return modulesFor(typeId).find((module) => module.id === "media") ?? null;
}

function ambitionsList() {
  return catalogue().ambitions ?? [];
}

function defaultAmbition() {
  return ambitionsList().find((item) => item.default === true)?.id ?? "";
}

function providersFor(module, stackId) {
  const limited = stackOf(stackId)?.toolchain !== "node";
  return limited ? module.providers.filter((provider) => !provider.method) : module.providers;
}

function defaultModules(typeId, stackId) {
  const chosen = {};
  for (const module of modulesFor(typeId)) {
    const allowed = providersFor(module, stackId);
    chosen[module.id] = allowed.some((provider) => provider.id === module.default) ? module.default : "none";
  }
  return chosen;
}

function prepareFor(typeId) {
  const byId = new Map(catalogue().documents.map((doc) => [doc.id, doc]));
  return (typeOf(typeId)?.prepare ?? []).map((id) => byId.get(id)).filter(Boolean);
}

function choosing() {
  return app.state?.choose === true;
}

// The project folder: the one devos ui was started with, or, when the page chooses it, the projects folder plus the
// project name.
function projectFolder() {
  if (app.continuing) return app.continuing;
  if (!choosing()) return app.state?.folder ?? "";
  const name = slugText(app.draft?.fields.name ?? "");
  if (name) return joinPath(app.draft.fields.parent || app.state.suggest || "", name);
  return app.state.folder ?? "";
}

function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const button = document.getElementById("theme");
  const label = currentTheme() === "light" ? "Switch to the dark theme" : "Switch to the light theme";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function toolInfo(id) {
  return app.state.tools.find((tool) => tool.id === id) ?? { id, label: id, cycle: false };
}

function detected(id) {
  return app.state.agents.find((agent) => agent.toolId === id);
}

function readiness(id) {
  const agent = detected(id);
  if (!agent || agent.status !== "installed") return "missing";
  return agent.signedIn === true ? "ready" : "half";
}

function readinessText(id) {
  const state = readiness(id);
  if (state === "ready") return "Signed in here";
  if (state === "half") return "Installed, not signed in";
  return "Not installed here";
}

function modelGroups(toolId) {
  const agent = detected(toolId);
  if (agent && Array.isArray(agent.groups) && agent.groups.length > 0) {
    return agent.groups.map((group) => ({
      label: group.label || group.id,
      models: group.models.map((model) => ({ id: model.id, mine: Boolean(model.available || model.reported) })),
    }));
  }
  return (agent?.seedGroups ?? []).map((group) => ({
    label: group.label,
    models: group.models.map((id) => ({ id, mine: false })),
  }));
}

function firstModel(toolId) {
  const groups = modelGroups(toolId);
  const mine = groups.flatMap((group) => group.models).find((model) => model.mine);
  return mine?.id ?? groups[0]?.models[0]?.id ?? "";
}

function hasModel(toolId, model) {
  return modelGroups(toolId).some((group) => group.models.some((item) => item.id === model));
}

function cycleTools() {
  return app.state.tools.filter((tool) => tool.cycle === true);
}

function readyTools() {
  return app.state.tools.filter((tool) => readiness(tool.id) === "ready");
}

function strengthsFromNote(note) {
  const text = String(note ?? "");
  if (!text.startsWith("strengths: ")) return [];
  return text.slice("strengths: ".length).split(",").map((part) => part.trim()).filter(Boolean);
}

function defaultDraft() {
  const st = app.state;
  const roster = st.defaults;
  const first = st.catalogue.types[0];
  const draft = {
    version: st.contractVersion,
    cycle: "github",
    accepted: false,
    // E10a: the Control Tower link has no default; the developer chooses yes or no.
    link: null,
    reviewer: { tool: roster.reviewer.tool, model: roster.reviewer.model },
    light: roster.reviewer_light ? { tool: roster.reviewer_light.tool, model: roster.reviewer_light.model } : null,
    pool: roster.pool.map((item) => ({
      tool: item.tool,
      model: item.model,
      strengths: strengthsFromNote(item.note),
      isDefault: item.default === true,
    })),
    policy: roster.policy,
    blueprint: null,
    type: first.id,
    stack: first.stack,
    modules: {},
    scope: "mvp",
    media_kinds: ["image"],
    ambition: defaultAmbition(),
    fields: { name: "", brief: "", users: "", languages: "en", visibility: st.visibility === "public" ? "public" : "private", parent: st.suggest ?? "" },
  };
  draft.modules = defaultModules(draft.type, draft.stack);
  draft.blueprint = defaultBlueprint(draft);
  return withRemembered(draft, st.choices);
}

const agentPair = (item) => (item && typeof item.tool === "string" && item.tool !== "" && typeof item.model === "string" && item.model !== "" ? { tool: item.tool, model: item.model } : null);

// The choices of the last project started here (~/.devos/choices.json): a new start begins where the last one
// left off. Only what this computer and the catalogue still offer is taken.
function withRemembered(draft, saved) {
  if (!saved || typeof saved !== "object") return draft;
  const d = { ...draft, fields: { ...draft.fields } };
  const agents = saved.agents ?? {};
  if (agentPair(agents.reviewer)) d.reviewer = agentPair(agents.reviewer);
  if (Object.hasOwn(agents, "reviewer_light")) d.light = agentPair(agents.reviewer_light);
  const pool = (Array.isArray(agents.pool) ? agents.pool : []).filter(agentPair);
  if (pool.length > 0) d.pool = pool.map((item) => ({ ...agentPair(item), strengths: strengthsFromNote(item.note), isDefault: item.default === true }));
  if (typeof agents.policy === "string" && agents.policy !== "") d.policy = agents.policy;
  const project = saved.project ?? {};
  if (typeOf(project.type) && stacksFor(project.type).some((stack) => stack.id === project.stack)) {
    d.type = project.type;
    d.stack = project.stack;
    d.modules = { ...defaultModules(project.type, project.stack) };
    for (const module of modulesFor(project.type)) {
      const pick = project.modules?.[module.id];
      if (providersFor(module, project.stack).some((provider) => provider.id === pick)) d.modules[module.id] = pick;
    }
  }
  if (project.scope === "mvp" || project.scope === "full") d.scope = project.scope;
  const kinds = (mediaModule(d.type)?.kinds ?? []).map((kind) => kind.id);
  if (Array.isArray(project.media_kinds) && project.media_kinds.length > 0 && project.media_kinds.every((kind) => kinds.includes(kind))) d.media_kinds = [...project.media_kinds];
  if (ambitionsList().some((item) => item.id === project.ambition)) d.ambition = project.ambition;
  const fields = saved.fields ?? {};
  if (Array.isArray(fields.languages) && fields.languages.length > 0) d.fields.languages = fields.languages.join(", ");
  if (fields.visibility === "private" || fields.visibility === "public") d.fields.visibility = fields.visibility;
  if (typeof saved.parent === "string" && saved.parent !== "") d.fields.parent = saved.parent;
  const blueprint = agentPair(saved.blueprint);
  if (blueprint && readiness(blueprint.tool) === "ready") d.blueprint = blueprint;
  return d;
}

// While a started project continues, the page shows that project's own saved choices (devos/answers.json),
// not the page's last draft.
function withChoices(draft, choices, folder) {
  const d = { ...draft, fields: { ...draft.fields } };
  if (typeOf(choices.type)) d.type = choices.type;
  if (stackOf(choices.stack)) d.stack = choices.stack;
  d.modules = { ...(choices.modules ?? {}) };
  if (choices.scope === "mvp" || choices.scope === "full") d.scope = choices.scope;
  if (Array.isArray(choices.media_kinds) && choices.media_kinds.length > 0) d.media_kinds = [...choices.media_kinds];
  if (ambitionsList().some((item) => item.id === choices.visual_ambition)) d.ambition = choices.visual_ambition;
  if (choices.name) d.fields.name = choices.name;
  if (Array.isArray(choices.languages) && choices.languages.length > 0) d.fields.languages = choices.languages.join(", ");
  if (choices.visibility === "private" || choices.visibility === "public") d.fields.visibility = choices.visibility;
  if (agentPair(choices.blueprint)) d.blueprint = agentPair(choices.blueprint);
  d.cycle = choices.cycle === "local" ? "local" : "github";
  const cut = Math.max(folder.lastIndexOf("/"), folder.lastIndexOf("\\"));
  if (cut > 0) d.fields.parent = folder.slice(0, cut);
  return d;
}

function defaultBlueprint(draft) {
  const ready = readyTools();
  if (ready.length === 0) return null;
  const sameTool = ready.find((tool) => tool.id === draft.reviewer.tool);
  if (sameTool && hasModel(sameTool.id, draft.reviewer.model)) return { tool: sameTool.id, model: draft.reviewer.model };
  const tool = sameTool ?? ready[0];
  return { tool: tool.id, model: firstModel(tool.id) };
}

function loadDraft() {
  const fallback = defaultDraft();
  const raw = storageGet(DRAFT_KEY);
  if (!raw) return { draft: fallback, step: "machine" };
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.draft?.version !== app.state.contractVersion || !typeOf(saved.draft.type)) {
      return { draft: fallback, step: "machine" };
    }
    const draft = { ...fallback, ...saved.draft, fields: { ...fallback.fields, ...saved.draft.fields } };
    if (draft.cycle !== "github" && draft.cycle !== "local") draft.cycle = "github";
    if (draft.blueprint && readiness(draft.blueprint.tool) !== "ready") draft.blueprint = defaultBlueprint(draft);
    const step = STEPS.some((item) => item.id === saved.step) && !LIVE.has(saved.step) ? saved.step : "machine";
    return { draft, step: step === "review" ? "documents" : step };
  } catch {
    return { draft: fallback, step: "machine" };
  }
}

function saveDraft() {
  storageSet(DRAFT_KEY, JSON.stringify({ draft: app.draft, step: app.step }));
}

function knownIds() {
  const roster = app.state.defaults;
  return [roster.reviewer, roster.reviewer_light, ...roster.pool].filter(Boolean);
}

function idFor(tool, model) {
  return knownIds().find((item) => item.tool === tool && item.model === model)?.id ?? agentId(tool, model);
}

function localDraft() {
  return app.draft?.cycle === "local";
}

function flowSteps() {
  if (adoptMode()) return ADOPT_STEPS;
  if (currentMode()) return choosing() ? CURRENT_STEPS : CURRENT_STEPS.filter((step) => step.id !== "current");
  if (localDraft()) return STEPS.filter((step) => step.id !== "keys" && step.id !== "github");
  return STEPS.filter((step) => step.id !== "backup");
}

function buildPlan() {
  const d = app.draft;
  const plan = {
    accepted: d.accepted === true,
    contract_version: app.state.contractVersion,
    link: d.link === true ? true : d.link === false ? false : null,
    agents: {
      reviewer: { id: idFor(d.reviewer.tool, d.reviewer.model), tool: d.reviewer.tool, model: d.reviewer.model },
      reviewer_light: d.light ? { id: idFor(d.light.tool, d.light.model), tool: d.light.tool, model: d.light.model } : null,
      pool: d.pool.map((item) => ({
        id: idFor(item.tool, item.model),
        tool: item.tool,
        model: item.model,
        default: item.isDefault === true,
        note: item.strengths.length > 0 ? `strengths: ${item.strengths.join(", ")}` : "default builder",
        ...(item.effort ? { effort: item.effort } : {}),
        ...(item.effort && item.fast === true ? { fast: true } : {}),
      })),
      policy: d.policy,
    },
    blueprint: {
      tool: d.blueprint?.tool ?? "",
      model: d.blueprint?.model ?? "",
      ...(EFFORT_FLAG_TOOLS.has(d.blueprint?.tool) ? { effort: d.blueprint?.effort ?? "high" } : {}),
    },
    project: {
      type: d.type,
      stack: d.stack,
      modules: { ...d.modules },
      scope: d.scope,
      ...(mediaModule(d.type) && d.modules.media !== "none" ? { media_kinds: [...d.media_kinds] } : {}),
      ...(mediaModule(d.type) ? { ambition: d.ambition } : {}),
    },
    fields: {
      name: d.fields.name.trim(),
      brief: d.fields.brief.trim(),
      users: d.fields.users.trim(),
      languages: parseLanguages(d.fields.languages),
      visibility: d.fields.visibility,
    },
    attachments: app.files.map((file) => ({ name: file.name })),
    ...(mediaModule(d.type) && app.own.length ? { own_images: app.own.map((file) => ({ name: file.name })) } : {}),
    ...(choosing() ? { folder: projectFolder() } : {}),
  };
  if (!localDraft()) return plan;
  plan.link = false;
  plan.fields.visibility = "private";
  if (Object.hasOwn(plan.project.modules, "hosting")) plan.project.modules.hosting = "none";
  return { ...plan, cycle: "local" };
}

// ---------- validity per step ----------

function problems(step) {
  const d = app.draft;
  const st = app.state;
  switch (step) {
    case "machine": {
      const out = [];
      const localNew = localDraft() && !st.started && !(st.choose && app.entry && app.entry !== "new");
      if (localNew) {
        if (!st.doctor?.local) out.push("The engine check failed. Run devos doctor --local in a terminal to see why.");
      } else if (!st.doctor?.ok) out.push("The engine check failed. Run devos doctor in a terminal to see why.");
      if (!st.choose && !st.empty && !st.started) out.push("This folder is not empty. DEV_OS starts a project in an empty folder.");
      if (readyTools().length === 0) out.push("No AI tool is signed in on this computer. The blueprint needs one.");
      return out;
    }
    case "contract": {
      const out = [];
      if (!d.accepted) out.push("Accept the contract to continue.");
      if (localDraft()) return out;
      if (d.link !== true && d.link !== false) out.push("Choose whether to link this project to the DEV_OS Control Tower.");
      return out;
    }
    case "builders": {
      const out = [];
      if (d.pool.length === 0) out.push("Add at least one builder.");
      const seen = new Set();
      for (const item of d.pool) {
        const key = `${item.tool}/${item.model}`;
        if (seen.has(key)) out.push("Each builder must be a different model.");
        seen.add(key);
      }
      if (d.pool.filter((item) => item.isDefault).length !== 1) out.push("Choose one default builder.");
      return [...new Set(out)];
    }
    case "blueprint-agent":
      return d.blueprint && readiness(d.blueprint.tool) === "ready" && d.blueprint.model ? [] : ["Choose a tool that is signed in on this computer."];
    case "details": {
      const out = [];
      const name = d.fields.name.trim();
      if (name === "" || !KEY_RE.test(keyFromName(name))) out.push("Give the project a name of at least two letters or digits.");
      if (d.fields.brief.trim() === "") out.push("Write a short brief.");
      if (d.fields.users.trim() === "") out.push("Say who uses it.");
      const languages = parseLanguages(d.fields.languages);
      if (languages.length === 0 || languages.some((code) => !LANGUAGE_RE.test(code))) out.push("List language codes such as en, fr or pt-BR.");
      if (choosing() && !absolutePath(d.fields.parent.trim())) out.push("Give the full path of the folder that holds your projects.");
      return out;
    }
    default:
      return [];
  }
}

// ---------- navigation ----------

function stepIndex(id) {
  return flowSteps().findIndex((step) => step.id === id);
}

function liveScreen() {
  const run = app.run;
  if (run.mode === "adopt") return "adopting";
  if (run.done !== null) return "finish";
  if (run.ask?.kind === "approve") return "approve";
  if (run.ask?.kind === "key") return "keys";
  if (run.ask?.kind === "create") return "github";
  if (run.ask?.kind === "backup") return "backup";
  if (run.phase === "setup") {
    if (localDraft()) return "finish";
    if (run.setupNow === "" || EARLY_SETUP.has(run.setupNow)) return "keys";
    return "finish";
  }
  if (run.phase === "continue") return "finish";
  return "drafting";
}

function current() {
  return app.run.started ? liveScreen() : app.step;
}

function go(step) {
  if (app.run.started) return;
  app.dir = stepIndex(step) < stepIndex(app.step) ? "back" : "fwd";
  app.step = step;
  app.error = "";
  if (step === "review") app.review = null;
  saveDraft();
  render(true);
  const stage = document.getElementById("stage");
  stage.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function next() {
  // E72: after a Change from the review, Continue on the block's last step goes back to it.
  if (app.returnAfter && app.step === app.returnAfter) {
    app.returnAfter = "";
    go("review");
    return;
  }
  const steps = flowSteps();
  const at = stepIndex(app.step);
  const target = steps[at + 1];
  if (target && !LIVE.has(target.id)) go(target.id);
}

function back() {
  const steps = flowSteps();
  const at = stepIndex(app.step);
  if (at > 0) go(steps[at - 1].id);
}

// ---------- rendering: rail ----------

function renderRail() {
  const rail = document.getElementById("rail");
  const adopting = adoptMode();
  const opening = currentMode();
  const now = adopting ? adoptNow() : current();
  const steps = flowSteps();
  // E26a: the current-project screens are not steps of a new project; the rail stays on step 1.
  const nowAt = Math.max(0, stepIndex(now));
  rail.replaceChildren();
  app.ticked ??= new Set();

  const mobile = el("div", { class: "rail-mobile" });
  const progress = el("div", { class: "progress", role: "progressbar", "aria-valuemin": "1", "aria-valuemax": String(steps.length), "aria-valuenow": String(nowAt + 1), "aria-label": "Setup progress" }, el("span"));
  // E72: the bar fills from where it was.
  const fill = `${Math.round(((nowAt + 1) / steps.length) * 100)}%`;
  const bar = progress.firstChild;
  bar.style.setProperty("--p", app.lastFill ?? fill);
  if (app.lastFill !== fill) requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty("--p", fill)));
  app.lastFill = fill;
  mobile.append(
    el("div", { class: "rail-mobile-top" }, el("strong", { text: steps[nowAt]?.label ?? "" }), el("span", { text: `Step ${nowAt + 1} of ${steps.length}` })),
    progress,
  );
  rail.append(mobile);

  for (const [group, title] of adopting ? ADOPT_GROUPS : (opening ? CURRENT_GROUPS : GROUPS)) {
    const heading = group === "github" && localDraft() && !adopting ? "This computer" : title;
    const list = el("ol", { class: "rail-list" });
    for (const step of steps.filter((item) => item.group === group)) {
      const at = stepIndex(step.id);
      let state = at < nowAt ? "done" : (at === nowAt ? "current" : "todo");
      if (app.run.done === 0 && at === nowAt) state = "done";
      if (app.run.started && at < nowAt) state = "done-locked";
      const clickable = state === "done" && !app.run.started;
      const button = el("button", {
        class: "rail-step",
        type: "button",
        "data-state": state === "done-locked" ? "done" : state,
        "aria-current": state === "current" ? "step" : null,
        disabled: !clickable && state !== "current",
        onclick: clickable ? () => go(step.id) : null,
      },
      el("span", { class: "rail-num" }, state.startsWith("done") ? icon("check") : String(at + 1)),
      el("span", { class: "rail-label", text: step.label }));
      if (state === "done-locked") button.classList.add("is-locked");
      // E72: a step's tick draws in once, when the step is first done.
      const tickKey = `${opening ? "open" : (adopting ? "adopt" : "new")}:${step.id}`;
      if (state.startsWith("done") && !app.ticked.has(tickKey)) {
        app.ticked.add(tickKey);
        if (app.ticked.size > 1) {
          button.classList.add("is-fresh");
          button.querySelector("path")?.setAttribute("pathLength", "1");
        }
      }
      list.append(el("li", {}, button));
    }
    rail.append(el("div", { class: "rail-group" }, el("p", { class: "rail-title", text: heading }), list));
  }
  if (stepIndex(now) >= 0 && !opening) rail.append(adopting ? adoptBlock() : titleBlock());
}

// E71: the adoption's title block: the project the survey found, and its stage and stack.
function adoptBlock() {
  const lines = adoptState().lines ?? [];
  const value = (label) => lines.map((line) => new RegExp(`^${label}: (.+)$`).exec(line)?.[1]).find(Boolean) ?? "";
  const rows = [];
  const add = (label, text) => rows.push(el("dt", { text: label }), el("dd", { class: text ? null : "is-empty", text: text || "Not yet", title: text || null }));
  add("Project", (lines[0] ?? "").split(" · ").slice(1).join(" · "));
  add("Stage", value("Stage").split(" — ")[0]);
  add("Stack", value("Stack").split(" · ")[0]);
  return el("section", { class: "tblock", "aria-label": "The project" },
    el("div", { class: "tblock-head" }, el("strong", { text: "Title block" }), el("span", { text: "Adoption" })),
    el("dl", {}, rows));
}

function titleBlock() {
  const d = app.draft;
  const rows = [];
  const add = (label, value) => rows.push(el("dt", { text: label }), el("dd", { class: value ? null : "is-empty", text: value || "Not yet", title: value || null }));
  add("Project", d.fields.name.trim());
  add("Type", app.step === "machine" && !app.run.started ? "" : typeOf(d.type)?.label);
  add("Stack", stepIndex(current()) > stepIndex("stack") || app.run.started ? stackOf(d.stack)?.label.replace(/\s*\(.*\)$/, "") : "");
  add("Scope", stepIndex(current()) > stepIndex("scope") || app.run.started ? (d.scope === "full" ? "Full product" : "MVP") : "");
  return el("section", { class: "tblock", "aria-label": "Your answers so far" },
    el("div", { class: "tblock-head" }, el("strong", { text: "Title block" }), el("span", { text: app.run.round > 0 ? `Round ${app.run.round}` : "Draft" })),
    el("dl", {}, rows));
}

// ---------- rendering: stage ----------

function scheduleRender() {
  if (app.renderQueued) return;
  app.renderQueued = true;
  requestAnimationFrame(() => {
    app.renderQueued = false;
    render(false);
  });
}

function render(force) {
  renderRail();
  renderBar();
  const step = current();
  const run = app.run;
  // E72: what makes a new screen (it arrives with motion): the step, a new question of the adoption, or the run's end.
  const identity = step === "adopting" ? `adopting#${run.asks ?? 0}#${run.done ?? ""}` : (step === "finish" ? `finish#${run.done ?? ""}` : step);
  const key = [identity, run.ask ? `${run.ask.kind}:${run.ask.name ?? ""}:${run.ask.round ?? ""}:${run.ask.index ?? ""}` : "", step === "drafting" ? run.round : "", run.done ?? "", app.sent ? "sent" : "", step === "finish" ? run.setupNow : "", step === "keys" ? run.setupNow : "", run.mode === "adopt" ? String(run.asks ?? 0) : ""].join("|");
  if (!force && key === app.screenKey && app.live) {
    app.live();
    return;
  }
  const moved = key.split("|")[0] !== app.screenKey.split("|")[0];
  app.screenKey = key;
  app.live = null;
  const stage = document.getElementById("stage");
  const screen = SCREENS[step]?.() ?? el("div");
  // E72: a new screen arrives from the side it comes from; the same screen drawn again does not move.
  screen.classList.add(moved ? (app.dir === "back" ? "is-back" : "is-fwd") : "is-still");
  app.dir = "fwd";
  stage.replaceChildren(screen);
  if (moved) window.scrollTo({ top: 0 });
}

function renderBar() {
  const where = document.getElementById("where");
  const stop = document.getElementById("stop");
  const screen = current();
  const entry = app.state?.choose === true && screen === "machine" ? app.entry : "";
  if (entry === "existing") where.replaceChildren("Adding DEV_OS to an existing project");
  else if (entry === "current") where.replaceChildren("Opening a current project");
  else if (app.state && screen === "hub" && app.hub?.data?.folder) where.replaceChildren("Project ", el("code", { text: app.hub.data.folder }));
  else if (app.state && (screen === "adopt" || screen === "adopting")) where.replaceChildren("Adding DEV_OS to an existing project");
  else if (app.state && (screen === "hub" || screen === "current")) where.replaceChildren("Opening a current project");
  else if (app.state) {
    const folder = projectFolder();
    if (folder) where.replaceChildren("Setting up ", el("code", { text: folder }));
    else where.replaceChildren("Setting up a new project");
  }
  const running = app.run.started && app.run.done === null;
  stop.hidden = !running;
  stop.disabled = app.stopping;
  stop.textContent = app.stopping ? "Stopping…" : "Stop run";
}

function head(step, title, lede, counted = true) {
  const at = stepIndex(step);
  return el("header", { class: "step-head" },
    counted ? el("p", { class: "step-count", text: `Step ${at + 1} of ${flowSteps().length}` }) : null,
    el("h1", { class: "step-title", text: title }),
    lede ? el("p", { class: "step-lede" }, lede) : null);
}

function foot({ primary = "Continue", onPrimary = next, check = () => [], backable = true, extra = null } = {}) {
  const note = el("p", { class: "foot-note", "aria-live": "polite" });
  const button = el("button", { class: "btn btn-primary", type: "button", text: primary });
  const refresh = () => {
    const found = check();
    button.disabled = found.length > 0;
    note.textContent = found[0] ?? "";
  };
  button.addEventListener("click", () => {
    if (check().length === 0) onPrimary();
  });
  refresh();
  const node = el("footer", { class: "step-foot" },
    backable ? el("button", { class: "btn btn-quiet", type: "button", text: "Back", onclick: back }) : null,
    el("span", { class: "spacer" }),
    note,
    extra,
    button);
  node.refresh = refresh;
  return node;
}

// E72: a short explanation behind a disclosure.
function helpBox(title, paragraphs) {
  return el("details", { class: "disclose help" }, el("summary", { text: title }), paragraphs.map((text) => el("p", { class: "hint", text })));
}

function notice(kind, title, items = []) {
  const name = kind === "bad" ? "alert" : (kind === "ok" ? "check" : "info");
  return el("div", { class: `notice notice-${kind}`, role: kind === "bad" ? "alert" : null },
    icon(name),
    el("div", {}, title, items.length ? el("ul", {}, items.map((item) => el("li", {}, item))) : null));
}

function choice({ name, value, checked, title, desc, tag, big = false, disabled = false, onChange }) {
  const input = el("input", { type: "radio", name, value, checked: Boolean(checked), disabled });
  input.addEventListener("change", () => { if (input.checked) onChange(value); });
  return el("label", { class: big ? "choice choice-big" : "choice" },
    input,
    el("span", { class: "choice-mark", "aria-hidden": "true" }),
    el("span", { class: "choice-title" }, title, tag ? el("span", { class: "choice-tag", text: tag }) : null),
    desc ? el("span", { class: "choice-desc", text: desc }) : null);
}

function step(id, title, lede, body, footer, wide = false) {
  return el("section", { class: wide ? "step step-wide" : "step", "aria-labelledby": `title-${id}` },
    (() => { const h = head(id, title, lede, stepIndex(id) >= 0); h.querySelector("h1").id = `title-${id}`; return h; })(),
    el("div", { class: "step-body" }, body),
    footer);
}

// ---------- screens: your choices ----------

const SCREENS = {};

SCREENS.machine = () => {
  const st = app.state;
  const ready = readyTools();
  const opening = st.choose && app.entry === "current";
  const existing = st.choose && app.entry === "existing";
  const localNew = localDraft() && !st.started && !opening && !existing;
  const engineOk = localNew ? Boolean(st.doctor?.local) : Boolean(st.doctor?.ok);
  const engineDetail = localNew
    ? (engineOk ? "Node.js 22 and git are ready. Local development needs nothing else." : "Run devos doctor --local in a terminal to see what is missing.")
    : (engineOk ? "Node, git and the GitHub CLI are ready." : "Run devos doctor in a terminal to see what is missing.");
  const tools = el("div", { class: "tools" }, st.tools.map((tool) => {
    const state = readiness(tool.id);
    return el("div", { class: "tool" },
      el("span", { class: `dot ${state === "ready" ? "dot-ready" : (state === "half" ? "dot-half" : "")}`, "aria-hidden": "true" }),
      el("span", { class: "tool-name", text: tool.label }),
      el("span", { class: "tool-state", text: state === "ready" ? "Signed in" : (state === "half" ? "Sign in" : "Not found") }));
  }));
  const rows = [
    checkRow(engineOk ? "ok" : "bad", "Engine", engineDetail, engineOk ? "Ready" : "Needs attention"),
    st.choose
      ? (existing
        ? checkRow("ok", "Project folder", "Your project's own folder: you pick it, or clone it from GitHub, in the next step.", "Yours")
        : (opening
          ? checkRow("ok", "Project folder", "A DEV_OS project's folder: you pick it, or clone it from GitHub, in the next step.", "Started")
          : checkRow("ok", "Project folder", "A new folder, named after your project in step 10.", "New")))
      : (st.started
        ? checkRow("ok", "Project folder", el("code", { text: st.folder }), "Started")
        : checkRow(st.empty ? "ok" : "bad", "Project folder", el("code", { text: st.folder }), st.empty ? "Empty" : "Not empty")),
    checkRow(ready.length > 0 ? "ok" : "bad", "AI tools on this computer", ready.length > 0 ? `${ready.map((tool) => tool.label).join(", ")} can write the blueprint here.` : "Sign in to one of these tools in a terminal, then reload this page.", ready.length > 0 ? `${ready.length} signed in` : "None signed in"),
  ];
  const issues = problems("machine");
  if (st.started) {
    return step("machine", "A DEV_OS project is here", "This folder holds a DEV_OS project. Open it to see its setup, its version, its models and its Control Tower link.",
      [el("div", { class: "checks" }, rows.slice(0, 2), rows[2], tools),
        app.error ? notice("bad", app.error) : null],
      foot({ primary: "Open this project", onPrimary: () => openHub(""), check: () => (st.doctor?.ok ? [] : [issues[0]]), backable: false }));
  }
  // E26a: a new project, or a current one. E39: or an existing project, to add DEV_OS to it.
  const pick = (value) => { app.entry = value; render(true); };
  const pickCycle = (value) => {
    app.draft.cycle = value;
    if (value === "local" && Object.hasOwn(app.draft.modules, "hosting")) app.draft.modules.hosting = "none";
    saveDraft();
    render(true);
  };
  const cycle = !opening && !existing
    ? el("div", { class: "section" },
      el("h2", { class: "section-title", text: "How will it be built?" }),
      el("div", { class: "choices choices-2", role: "radiogroup", "aria-label": "Automated development on GitHub, or local development on this computer" },
        choice({ name: "cycle", value: "github", checked: !localDraft(), big: true, title: "Automated development (GitHub)", desc: "AI agents build and review each task on GitHub, and you merge each one. Needs the GitHub CLI, signed in.", onChange: pickCycle }),
        choice({ name: "cycle", value: "local", checked: localDraft(), big: true, title: "Local development (this computer)", desc: "DEV_OS writes the plan with you, then hands the project over: you build it your own way, from its fences. Needs only Node.js 22 and git. A private GitHub backup is optional, and devos adopt brings DEV_OS back later.", onChange: pickCycle })))
    : null;
  const entry = st.choose
    ? el("div", { class: "section" },
      el("h2", { class: "section-title", text: "What would you like to do?" }),
      el("div", { class: "choices choices-2", role: "radiogroup", "aria-label": "A new project, a current one, or an existing one" },
        choice({ name: "entry", value: "new", checked: !opening && !existing, big: true, title: "New project", desc: "Turn an empty folder into a GitHub project that AI agents build and review, with you approving each step.", onChange: pick }),
        choice({ name: "entry", value: "current", checked: opening, big: true, title: "Current project", desc: "Open a DEV_OS project from this computer or from GitHub: its setup, its version, its models and its Control Tower link.", onChange: pick }),
        choice({ name: "entry", value: "existing", checked: existing, big: true, title: "Existing project", desc: "Add DEV_OS to a project you already have, on this computer or on GitHub. Nothing changes in it until you merge DEV_OS's pull request.", onChange: pick })),
      app.error ? notice("bad", app.error) : null)
    : null;
  const gated = opening || existing;
  const blocking = gated ? (st.doctor?.ok ? [] : [issues[0]]) : issues;
  const primary = existing ? "Add DEV_OS" : (opening ? "Open a project" : "Begin");
  const onPrimary = existing ? () => go("adopt") : (opening ? () => go("current") : next);
  const [title, lede] = existing
    ? ["Add DEV_OS to your project", "DEV_OS surveys a project you already have, writes its plan with you, and opens one pull request. Nothing changes in the project until you merge it. First, a quick look at this computer."]
    : (opening
      ? ["Open a DEV_OS project", "See a project's setup, its tasks, its last cycle run and its Control Tower link. Opening a project changes nothing in it. First, a quick look at this computer."]
      : ["Let’s set up your project", "DEV_OS turns an empty folder into a project that AI agents build and review, with you approving each step. First, a quick look at this computer."]);
  return step("machine", title, lede,
    [el("div", { class: "checks" }, rows.slice(0, 2), rows[2], tools),
      blocking.length ? notice("bad", "Fix this before you continue.", blocking) : null,
      entry,
      cycle,
      !opening && !existing ? howItWorks() : null],
    foot({ primary, onPrimary, check: () => (gated ? blocking : problems("machine")), backable: false }));
};

// E72: how a new project goes, before anything is chosen.
function howItWorks() {
  const local = localDraft();
  const items = local
    ? [["Your choices.", " Twelve short steps: the contract, the agents, the product and its modules. Nothing is written yet."],
      ["The blueprint.", " Your AI tool drafts the phases, the glossary and the first task in your folder; you approve them or ask for another round."],
      ["The hand-over.", " DEV_OS commits the plan and leaves the project to you, to build your own way."]]
    : [["Your choices.", " Twelve short steps: the contract, the agents, the product and its modules. Nothing is written yet."],
      ["The blueprint.", " Your AI tool drafts the phases, the glossary and the first task in your folder; you approve them or ask for another round, up to five in all."],
      ["Keys and the repository.", " You paste the keys the cycle uses (each goes straight to GitHub as a secret), and DEV_OS creates the repository."],
      ["The cycle.", " Agents build and review each task on GitHub, and you merge each one."]];
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "How it works" }),
    el("ol", { class: "next" }, items.map(([lead, rest]) => el("li", {}, el("strong", { text: lead }), rest))));
}

// ---------- a current project (E26a) ----------
// Open a DEV_OS project from this computer, or clone one from GitHub (POST /api/clone), then read its page
// (GET /api/hub): its setup, its version, its models and its Control Tower link. Opening a project changes nothing.

SCREENS.current = () => {
  const st = app.state;
  const listed = Array.isArray(st.projects) ? st.projects : [];
  const input = el("input", { class: "input", id: "repo-url", type: "text", spellcheck: "false", autocomplete: "off", placeholder: "https://github.com/you/your-app" });
  const result = el("div", { class: "finder-result" });
  const button = el("button", { class: "btn", type: "button", text: "Clone and open" });
  const cloneIt = async () => {
    const url = input.value.trim();
    if (!url) return;
    button.disabled = true;
    put(result, el("p", { class: "hint", role: "status", text: "Checking the repository on GitHub, then cloning it…" }));
    const { status, data } = await api("/api/clone", { method: "POST", body: { url } });
    button.disabled = false;
    if (status !== 200 || !data?.ok) {
      put(result, notice("bad", data?.errors?.[0] ?? "The repository could not be cloned."));
      return;
    }
    openHub(data.folder, data.reused ? `${data.slug} was already on this computer, in ${data.folder}.` : `${data.slug} is cloned into ${data.folder}.`);
  };
  button.addEventListener("click", cloneIt);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); cloneIt(); } });
  return step("current", "Open a current project", "Pick a DEV_OS project on this computer, or bring one from GitHub. Opening a project changes nothing in it.",
    [el("div", { class: "section" },
      el("h2", { class: "section-title", text: "On this computer" }),
      listed.length ? el("div", { class: "keys" }, listed.map((project) => el("div", { class: "key-item project-item" },
        el("div", { class: "key-top" },
          el("span", { class: "project-name", text: project.name }),
          el("span", { class: project.approved ? "badge badge-ok" : "badge", text: project.approved ? "Blueprint approved" : "Blueprint to finish" })),
        project.step ? el("p", { class: "hint", text: `It picks up at: ${project.step}.` }) : null,
        projectRow(project.folder)))) : el("p", { class: "hint", text: "Your projects folder holds no started project yet." }),
      folderFinder()),
    el("div", { class: "section" },
      el("h2", { class: "section-title", text: "From GitHub" }),
      el("div", { class: "field" },
        el("label", { class: "label", for: "repo-url", text: "The repository’s address" }),
        el("div", { class: "finder" }, input, button),
        el("p", { class: "hint", text: "Your GitHub account (the gh sign-in) must own or administer it. DEV_OS checks that it is a DEV_OS project, then clones it into your projects folder." }),
        result)),
    app.error ? notice("bad", app.error) : null],
    backFoot("machine"));
};

// ---------- an existing project (E39) ----------
// Add DEV_OS to a project that is not one yet: a folder or a GitHub address, the survey, then devos adopt.
// The page never answers by itself. A pull-request line becomes a link only when the rest is one pull request.
const PULL_REQUEST = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[0-9]+$/;
const PULL_PREFIX = "devos: the pull request is ";
const ADOPT_TOOLS = ["claude", "cursor", "codex", "gemini"];

function adoptState() {
  if (!app.adopt) app.adopt = { folder: "", url: "", lines: null, survey: null, surveyed: "", agent: "", busy: false, note: "", error: "", status: "" };
  return app.adopt;
}

async function startAdopt() {
  const adopt = adoptState();
  if (adopt.survey?.ready !== true || adopt.busy || app.run.started) return;
  if (adopt.folder.trim() !== adopt.surveyed) return;
  adopt.busy = true;
  adopt.error = "";
  app.error = "";
  render(true);
  const body = { folder: adopt.folder.trim() };
  if (adopt.agent) body.agent = adopt.agent;
  const { status, data } = await api("/api/adopt/start", { method: "POST", body });
  adopt.busy = false;
  if (status !== 202) {
    app.error = data?.errors?.[0] ?? "The adoption did not start.";
    render(true);
    return;
  }
  app.run = freshRun();
  app.run.started = true;
  app.run.mode = "adopt";
  render(true);
  listen();
}

function lineQuestion(last) {
  const field = el("input", { class: "input", id: "adopt-line", type: "text", autocomplete: "off", spellcheck: "false" });
  const send = () => {
    const value = field.value;
    field.value = "";
    answer("line", value);
  };
  field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); send(); } });
  const quick = (value) => el("button", { class: "btn", type: "button", text: value, onclick: () => answer("line", value) });
  const found = [];
  if (last.includes("(yes/no)") || last.includes("Type yes or no")) found.push(quick("yes"), quick("no"));
  else if (last.includes("Type yes to")) found.push(quick("yes"));
  else if (last.includes("Type accept")) found.push(quick("accept"));
  else if (last.includes("Choose 1 or 2")) found.push(quick("1"), quick("2"));
  return [
    found.length ? el("div", { class: "vault-actions" }, found) : null,
    el("div", { class: "field" },
      el("label", { class: "label", for: "adopt-line", text: "Your answer" }),
      el("div", { class: "finder" }, field, el("button", { class: "btn btn-primary", type: "button", text: "Send", onclick: send })),
      el("p", { class: "hint", text: "An empty Send uses the default, or stops where the question says an empty line stops." })),
  ];
}

function adoptKey(ask) {
  const err = el("div");
  let field;
  let save;
  const skip = el("button", { class: "btn", type: "button", text: ask.optional ? "Skip" : "Skip for now", onclick: () => answer("key", "") });
  if (ask.file) {
    field = el("input", { class: "input", type: "file", id: "adopt-key", name: ask.name, accept: ".json,application/json" });
    save = el("button", { class: "btn btn-primary", type: "button", text: "Upload key", disabled: true });
    field.addEventListener("change", () => { save.disabled = !field.files?.length; err.replaceChildren(); });
    save.addEventListener("click", async () => {
      const file = field.files?.[0];
      field.value = "";
      save.disabled = true;
      if (!file) return;
      let bytes = new Uint8Array(await file.arrayBuffer());
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        bytes = null;
        put(err, notice("bad", "That file is not JSON. Choose the key file you downloaded."));
        return;
      }
      const encoded = bytesToBase64(bytes);
      bytes = null;
      answer("key", encoded);
    });
  } else {
    field = el("input", { class: "input input-mono", type: "password", id: "adopt-key", name: ask.name, autocomplete: "off", spellcheck: "false" });
    save = el("button", { class: "btn btn-primary", type: "button", text: "Save key", disabled: true });
    field.addEventListener("input", () => { save.disabled = field.value.trim() === ""; });
    const send = () => {
      const value = field.value.trim();
      field.value = "";
      if (value !== "") answer("key", value);
    };
    save.addEventListener("click", send);
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); send(); } });
  }
  queueMicrotask(() => field.focus());
  return el("div", { class: "vault" },
    el("div", { class: "key-top" }, el("p", { class: "vault-name", text: ask.name }), el("span", {}, richText(ask.where ?? ""))),
    el("div", { class: "field" }, el("label", { class: "label", for: "adopt-key", text: ask.file ? "Key file (JSON)" : "Value" }), field),
    err,
    el("p", { class: "trust" }, icon("lock"), el("span", { text: "Sent once to GitHub as a repository secret, over the engine’s standard input. It is not saved, shown, logged or given to any model." })),
    el("div", { class: "vault-actions" }, save, skip));
}

SCREENS.adopt = () => {
  const adopt = adoptState();
  const folder = el("input", {
    class: "input", id: "adopt-folder", type: "text", spellcheck: "false", autocomplete: "off", value: adopt.folder,
    placeholder: app.state.suggest ? `${app.state.suggest}${app.state.suggest.includes("\\") ? "\\" : "/"}my-app` : "",
  });
  folder.addEventListener("input", () => {
    const next = folder.value;
    const changed = next.trim() !== adopt.folder.trim();
    adopt.folder = next;
    if (!changed || !adopt.survey) return;
    adopt.lines = null;
    adopt.survey = null;
    adopt.surveyed = "";
    const at = folder.selectionStart;
    render(true);
    const again = document.getElementById("adopt-folder");
    if (again) {
      again.focus();
      again.setSelectionRange(at, at);
    }
  });
  const choose = el("button", { class: "btn btn-primary", type: "button", text: "Choose a folder…", disabled: adopt.busy });
  choose.addEventListener("click", async () => {
    if (adopt.busy) return;
    choose.disabled = true;
    adopt.status = "A folder dialog is open on this computer. It may be behind this window.";
    render(true);
    const { status, data } = await api("/api/pick-folder", { method: "POST", body: {} });
    adopt.status = "";
    if (status === 200 && data?.ok && typeof data.folder === "string") {
      adopt.folder = data.folder;
      adopt.lines = null;
      adopt.survey = null;
      adopt.surveyed = "";
      adopt.note = "";
      adopt.error = "";
      render(true);
      return;
    }
    adopt.error = data?.cancelled ? "" : (data?.errors?.[0] ?? "The folder dialog did not open. Paste the folder’s full path instead.");
    render(true);
  });
  const url = el("input", { class: "input", id: "adopt-url", type: "text", spellcheck: "false", autocomplete: "off", value: adopt.url, placeholder: "https://github.com/you/your-app" });
  url.addEventListener("input", () => { adopt.url = url.value; });
  const cloneIt = async () => {
    const address = adopt.url.trim();
    if (!address || adopt.busy) return;
    adopt.busy = true;
    adopt.error = "";
    adopt.note = "";
    adopt.status = "Checking the repository on GitHub, then cloning it…";
    render(true);
    const { status, data } = await api("/api/clone", { method: "POST", body: { url: address, adopt: true } });
    adopt.busy = false;
    adopt.status = "";
    if (status !== 200 || !data?.ok) {
      adopt.error = data?.errors?.[0] ?? "The repository could not be cloned.";
      render(true);
      return;
    }
    adopt.folder = data.folder;
    adopt.lines = null;
    adopt.survey = null;
    adopt.surveyed = "";
    adopt.error = "";
    adopt.note = data.reused ? `${data.slug} was already on this computer, in ${data.folder}.` : `${data.slug} is cloned into ${data.folder}.`;
    render(true);
  };
  const clone = el("button", { class: "btn", type: "button", text: "Clone", disabled: adopt.busy, onclick: cloneIt });
  url.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); cloneIt(); } });
  const surveyIt = async () => {
    const asked = adopt.folder.trim();
    if (!asked || adopt.busy) return;
    adopt.busy = true;
    adopt.error = "";
    adopt.status = "";
    render(true);
    const { status, data } = await api("/api/adopt/check", { method: "POST", body: { folder: asked } });
    adopt.busy = false;
    if (status !== 200 || !data?.ok) {
      adopt.lines = null;
      adopt.survey = null;
      adopt.surveyed = "";
      adopt.error = data?.errors?.[0] ?? "The survey did not run.";
      render(true);
      return;
    }
    adopt.lines = Array.isArray(data.lines) ? data.lines.map((line) => String(line)) : [];
    adopt.survey = data.survey && typeof data.survey === "object" ? data.survey : null;
    adopt.surveyed = asked;
    adopt.error = "";
    render(true);
  };
  const ready = adopt.survey?.ready === true && adopt.folder.trim() === adopt.surveyed;
  const tools = readyTools().filter((tool) => ADOPT_TOOLS.includes(tool.id));
  if (adopt.agent !== "" && !tools.some((tool) => tool.id === adopt.agent)) adopt.agent = "";
  const agents = ready
    ? el("div", { class: "section" },
      el("h2", { class: "section-title", text: "The AI tool that writes the brief" }),
      el("div", { class: "choices choices-2", role: "radiogroup", "aria-label": "The AI tool that writes the brief" },
        choice({ name: "adopt-agent", value: "", checked: adopt.agent === "", title: "devos's choice", desc: "The signed-in tool DEV_OS would use in a terminal.", onChange: (value) => { adopt.agent = value; } }),
        tools.map((tool) => choice({ name: "adopt-agent", value: tool.id, checked: adopt.agent === tool.id, title: tool.label, desc: "This tool writes the brief.", onChange: (value) => { adopt.agent = value; } }))))
    : null;
  // E71: how it goes, before anything is chosen.
  const how = adopt.survey ? null : el("div", { class: "section" },
    el("h2", { class: "section-title", text: "How adding DEV_OS works" }),
    el("ol", { class: "next" },
      el("li", {}, el("strong", { text: "A survey." }), " DEV_OS reads the project's stack, services, workflows and deploys, and changes nothing."),
      el("li", {}, el("strong", { text: "A brief." }), " Your own AI tool writes what the project is from a copy of its files; you keep it or ask for changes."),
      el("li", {}, el("strong", { text: "DEV_OS on a branch." }), " You accept the contract and choose the Control Tower link, the cycle's agents and your keys; DEV_OS adds its files on devos/adopt."),
      el("li", {}, el("strong", { text: "A pull request you merge." }), " Nothing reaches main, or GitHub at all, until you say yes.")));
  const facts = adopt.lines ? surveyFacts(adopt.lines) : null;
  return step("adopt", "Add DEV_OS to your project", "Pick the project on this computer, or clone it from GitHub, then survey it. Nothing changes in it until you merge DEV_OS's pull request.",
    [how,
    el("div", { class: "section" },
      el("h2", { class: "section-title", text: "On this computer" }),
      el("div", { class: "vault-actions" }, choose),
      el("label", { class: "hint", for: "adopt-folder", text: "Or paste the project folder’s full path:" }),
      el("div", { class: "finder" }, folder)),
    el("div", { class: "section" },
      el("h2", { class: "section-title", text: "From GitHub" }),
      el("div", { class: "field" },
        el("label", { class: "label", for: "adopt-url", text: "The repository’s address" }),
        el("div", { class: "finder" }, url, clone))),
    adopt.status ? el("p", { class: "hint", role: "status", text: adopt.status }) : null,
    adopt.note ? notice("ok", adopt.note) : null,
    el("div", { class: "vault-actions" }, el("button", { class: "btn btn-primary", type: "button", text: adopt.busy ? "Working…" : "Survey it", disabled: adopt.busy, onclick: surveyIt })),
    facts ? el("div", { class: "section" }, el("h2", { class: "section-title", text: (adopt.lines[0] ?? "The survey").replace(/^devos adopt --check · /, "The survey · ") }), facts) : null,
    adopt.lines ? el("details", { class: "disclose" }, el("summary", { text: "The survey's full text" }),
      el("div", { class: "log", role: "log", "aria-label": "Survey", tabindex: "0" }, adopt.lines.map((line) => el("div", { class: "log-line", text: line })))) : null,
    adopt.survey && !ready ? notice("bad", "The survey is not ready, so nothing goes on.") : null,
    ready ? notice("ok", "Ready. Choose the AI tool that writes the brief, then write it.") : null,
    agents,
    adopt.error ? notice("bad", adopt.error) : null,
    app.error ? notice("bad", app.error) : null],
    el("footer", { class: "step-foot" },
      el("button", { class: "btn btn-quiet", type: "button", text: "Back", onclick: () => go("machine") }),
      el("span", { class: "spacer" }),
      el("button", { class: "btn btn-primary", type: "button", text: "Write the brief", disabled: adopt.busy || !ready, onclick: () => { if (ready) startAdopt(); } })));
};

// ---------- E71: the adoption, guided like a new project ----------
// devos adopt asks each question with the form the page draws (menu.mjs showOnPage, adopt.mjs uiReader) and says
// where it is (`::devos-step {"step":"adopt","at":…}`). Every answer is still one line, as a terminal would type it,
// so the page draws and the developer answers; the page never answers by itself.

// E72: opening a current project (its folder, a clone, its page): not a step of a new project.
function currentMode() {
  if (app.run.started) return false;
  return app.step === "current" || app.step === "hub" || (app.step === "machine" && app.state?.choose === true && app.entry === "current");
}

function adoptMode() {
  if (app.run.started) return app.run.mode === "adopt";
  return app.step === "adopt" || (app.step === "machine" && app.state?.choose === true && app.entry === "existing");
}

// The step of the adoption the rail marks: the question's own, else where the engine said it is.
function adoptNow() {
  const run = app.run;
  if (!run.started || run.mode !== "adopt") return app.step === "machine" ? "machine" : "adopt";
  if (run.done !== null) return "finish";
  if (run.ask?.step) return run.ask.step;
  return run.at || "brief";
}

// The survey's lines as facts: "Stage: in-development — …" becomes Stage and its value.
function surveyFacts(lines) {
  const rows = [];
  for (const line of lines.slice(1)) {
    const match = /^([A-Z][A-Za-z_ -]{1,24}): (.+)$/.exec(line);
    if (!match) continue;
    rows.push(el("div", { class: "fact" }, el("dt", { text: match[1] }), el("dd", { text: match[2] })));
  }
  rows.forEach((row, index) => row.style.setProperty("--i", String(index)));
  return rows.length ? el("dl", { class: "facts", "aria-label": "What the survey found" }, rows) : null;
}

function adoptLogLine(line) {
  if (line.startsWith(PULL_PREFIX)) {
    const rest = line.slice(PULL_PREFIX.length);
    if (PULL_REQUEST.test(rest)) {
      return el("div", { class: "log-line" }, "devos: the pull request is ", el("a", { href: rest, target: "_blank", rel: "noopener noreferrer", text: rest }));
    }
  }
  return el("div", { class: "log-line", text: line });
}

// The engine's whole output (E71: kept whole, closed by default; it fills only while it is open).
function adoptLog(open = false) {
  // E72: a log scrolls, so a keyboard reaches it too.
  const box = el("div", { class: "log log-tall", role: "log", "aria-label": "Engine output", tabindex: "0" });
  const details = el("details", { class: "disclose", open }, el("summary", { text: `Engine output (${app.run.logs.length} lines)` }), box);
  const fill = () => {
    details.firstChild.textContent = `Engine output (${app.run.logs.length} lines)`;
    if (!details.open) return;
    const lines = app.run.logs;
    if (box.childElementCount === lines.length && box.lastChild?.textContent === lines.at(-1)) return;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    put(box, lines.map(adoptLogLine));
    if (stick) box.scrollTop = box.scrollHeight;
  };
  details.addEventListener("toggle", () => {
    fill();
    if (details.open) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  });
  fill();
  details.fill = fill;
  return details;
}

// A brief or the contract as headings, lists and paragraphs; text only, never markup.
function textDoc(text, label) {
  const doc = el("article", { class: "doc", tabindex: "0", "aria-label": label });
  let list = null;
  for (const raw of String(text).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const item = /^\s*[-*] (.*)$/.exec(line);
    if (item) {
      if (!list) {
        list = el("ul");
        doc.append(list);
      }
      list.append(el("li", {}, richText(item[1])));
      continue;
    }
    list = null;
    if (line.trim() === "") continue;
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) doc.append(el(heading[1].length === 1 ? "h2" : "h3", { text: heading[2] }));
    else doc.append(el("p", {}, richText(line)));
  }
  return doc;
}

// One question, drawn from its form; the footer sends the line the terminal would read.
function adoptQuestion(ask, log) {
  const at = adoptNow();
  if (ask.form === "choice" || ask.form === "choices") return adoptPick(ask, at, log);
  if (ask.form === "brief") return adoptBriefScreen(ask, log);
  if (ask.form === "contract") return adoptContract(ask, log);
  if (ask.form === "confirm") return adoptConfirm(ask, at, log);
  return step(at, "The engine asks", "Answer as you would in a terminal.", [log, lineQuestion(app.run.logs.at(-1) ?? "")], null);
}

const STEP_LEDES = {
  agents: "The agents the cycle runs on GitHub, with your keys: they need not be installed on this computer.",
  deploy: "Who puts main into production once DEV_OS is added.",
};

// A choice from a list, every option shown (E71: no list is cut). Options are grouped by tool, and a search narrows them.
function adoptPick(ask, at, log) {
  const multi = ask.form === "choices";
  const labels = Array.isArray(ask.options) ? ask.options.map((option) => String(option)) : [];
  const chosen = new Set(multi ? (ask.defaults ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= labels.length) : []);
  let one = !multi && Number.isInteger(ask.default) && ask.default >= 1 && ask.default <= labels.length ? ask.default : 1;
  const [name, ...rest] = String(ask.title ?? "Choose").split(" — ");
  const list = el("div", { class: "pick-list", role: multi ? "group" : "radiogroup", "aria-label": name });
  const search = el("input", { class: "input pick-search", type: "search", placeholder: `Search ${labels.length} options`, "aria-label": "Search the options", autocomplete: "off", spellcheck: "false" });
  const count = el("p", { class: "hint", "aria-live": "polite" });
  let footer;
  const draw = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const groups = new Map();
    labels.forEach((label, index) => {
      if (words.length && !words.every((word) => label.toLowerCase().includes(word))) return;
      const [group, ...tail] = label.split(" · ");
      const key = tail.length ? group : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([index + 1, tail.length ? tail.join(" · ") : label]);
    });
    const blocks = [];
    for (const [group, items] of groups) {
      if (group) blocks.push(el("p", { class: "pick-group", text: group }));
      for (const [number, text] of items) {
        const mine = text.endsWith(" — on your account");
        const shown = mine ? text.slice(0, -" — on your account".length) : text;
        const input = el("input", { type: multi ? "checkbox" : "radio", name: "adopt-pick", value: String(number), checked: multi ? chosen.has(number) : one === number });
        input.addEventListener("change", () => {
          if (multi) {
            if (input.checked) chosen.add(number);
            else chosen.delete(number);
          } else if (input.checked) one = number;
          footer.refresh();
        });
        blocks.push(el("label", { class: "pick-item" }, input, el("span", { class: "pick-mark", "aria-hidden": "true" }),
          el("span", { class: "pick-text", text: shown }), mine ? el("span", { class: "badge badge-brass", text: "On your account" }) : null));
      }
    }
    put(list, blocks.length ? blocks : el("p", { class: "hint", text: "No option matches the search." }));
    const shownCount = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
    count.textContent = words.length ? `${shownCount} of ${labels.length} options` : `${labels.length} options${multi ? `, ${chosen.size} chosen` : ""}`;
  };
  search.addEventListener("input", draw);
  const send = () => {
    if (!multi) return answer("line", String(one));
    // multiSelect reads an empty line as its defaults, so an empty choice is sent as "," (none, where none is allowed).
    const picked = [...chosen].sort((a, b) => a - b);
    return answer("line", picked.length ? picked.join(", ") : ",");
  };
  footer = foot({
    primary: "Continue",
    onPrimary: send,
    backable: false,
    check: () => (multi && chosen.size === 0 && ask.empty !== true ? ["Choose at least one."] : []),
  });
  draw();
  const lede = rest.length ? rest.join(" — ") : (STEP_LEDES[at] ?? "");
  const top = rest.length && STEP_LEDES[at] ? el("p", { class: "hint", text: STEP_LEDES[at] }) : null;
  return step(at, name, lede ? lede.charAt(0).toUpperCase() + lede.slice(1) : null,
    [top, ask.note ? el("p", { class: "hint", text: String(ask.note) }) : null, search, count, list, app.error ? notice("bad", app.error) : null, log],
    footer);
}

function adoptBriefScreen(ask, log) {
  const changes = ask.changes === true;
  const box = el("textarea", { class: "input textarea", id: "brief-changes", rows: "4", placeholder: "For example: the stage is production; payments use Stripe, not PayPal." });
  const ask4 = el("button", { class: "btn", type: "button", text: "Ask for these changes", disabled: true });
  box.addEventListener("input", () => { ask4.disabled = box.value.trim() === ""; });
  ask4.addEventListener("click", () => {
    const text = box.value.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean).join(" ");
    if (text !== "") answer("line", text);
  });
  const round = Number.isInteger(ask.round) && ask.round > 1 ? ` Round ${ask.round}.` : "";
  return step("brief", "Read the adoption brief",
    changes
      ? `Your AI tool wrote it from a copy of the project; the project itself was not touched.${round} Keep it, or say what to change and it writes another round.`
      : "It comes from the project's own plan, with no AI tool. Keep it to go on.",
    [textDoc(ask.brief ?? "", "Adoption brief"),
      changes ? el("div", { class: "field" },
        el("label", { class: "label", for: "brief-changes", text: "What should change?" }),
        box,
        el("div", { class: "vault-actions" }, ask4)) : null,
      app.error ? notice("bad", app.error) : null,
      log],
    el("footer", { class: "step-foot" },
      el("button", { class: "btn btn-quiet", type: "button", text: "Stop here", onclick: () => answer("line", changes ? "" : "no") }),
      el("span", { class: "spacer" }),
      el("p", { class: "foot-note", text: "Nothing in your project changes yet." }),
      el("button", { class: "btn btn-primary", type: "button", text: "Keep this brief", onclick: () => answer("line", "yes") })));
}

function adoptContract(ask, log) {
  let footer;
  const box = el("input", { type: "checkbox" });
  box.addEventListener("change", () => footer.refresh());
  footer = foot({ primary: "Accept and continue", onPrimary: () => answer("line", "accept"), backable: false, check: () => (box.checked ? [] : ["Accept the contract to continue."]),
    extra: el("button", { class: "btn btn-quiet", type: "button", text: "Decline", onclick: () => answer("line", "decline") }) });
  const version = String(ask.version ?? app.state.contractVersion);
  return step("contract", "Read the contract",
    `Version ${version}. It says what the engine is, what the private Control Tower is, what an optional link sends, and what is never sent. Declining stops here, with nothing written.`,
    [markdownDoc(app.state.contract), el("label", { class: "check" }, box, el("span", { text: "I have read the contract and I accept it." })), app.error ? notice("bad", app.error) : null, log],
    footer);
}

function adoptConfirm(ask, at, log) {
  const text = (Array.isArray(ask.text) ? ask.text : [String(ask.text ?? "")]).filter(Boolean);
  const yes = String(ask.yes ?? "yes");
  const no = String(ask.no ?? "no");
  const extra = [];
  if (at === "publish") extra.push(adoptKeyOverview(), adoptHostList());
  // E72: the push as one card; the engine's own lines, with every name, behind a disclosure.
  const sum = at === "publish" && ask.summary && typeof ask.summary === "object" ? ask.summary : null;
  const lines = text.map((line) => el("p", { class: "step-para" }, richText(line)));
  const paras = sum ? [publishCard(sum), el("details", { class: "disclose" }, el("summary", { text: "Every name the push sets" }), lines)] : lines;
  if (ask.choose === true) {
    // E10a: neither answer is chosen for the developer; Continue waits for one.
    let picked = "";
    let footer;
    const pick = (value) => { picked = value; footer.refresh(); };
    footer = foot({ primary: "Continue", onPrimary: () => answer("line", picked), backable: false, check: () => (picked ? [] : ["Choose yes or no."]) });
    return step(at, String(ask.title ?? "Choose"), null,
      [...paras,
        el("div", { class: "choices choices-2", role: "radiogroup", "aria-label": String(ask.title ?? "Choose") },
          choice({ name: "adopt-confirm", value: yes, checked: false, title: String(ask.yesLabel ?? "Yes"), onChange: pick }),
          choice({ name: "adopt-confirm", value: no, checked: false, title: String(ask.noLabel ?? "No"), onChange: pick })),
        ...extra, app.error ? notice("bad", app.error) : null, log],
      footer);
  }
  return step(at, String(ask.title ?? "Continue?"), null,
    [...paras, ...extra, app.error ? notice("bad", app.error) : null, log],
    el("footer", { class: "step-foot" },
      el("button", { class: "btn btn-quiet", type: "button", text: String(ask.noLabel ?? "No"), onclick: () => answer("line", no) }),
      el("span", { class: "spacer" }),
      el("button", { class: "btn btn-primary", type: "button", text: String(ask.yesLabel ?? "Yes"), onclick: () => answer("line", yes) })));
}

// E72: what the push does, in four facts and the Actions permission.
function publishCard(sum) {
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  const slug = String(sum.slug ?? "");
  const facts = [
    ["Repository", `${slug}, ${sum.visibility === "public" ? "public" : "private"}`],
    ["Pull request", `${String(sum.branch ?? "devos/adopt")} into main. Nothing reaches main until you merge it.`],
    ["Keys", `${count(sum.present)} already on GitHub · ${count(sum.upload)} to upload · ${count(sum.later)} to set later`],
    ["Settings", `${count(sum.labels)} labels and ${count(sum.variables)} variables for the cycle`],
  ];
  return el("div", { class: "repo" },
    el("div", { class: "key-top" }, el("span", { class: "repo-slug", text: slug }), el("span", { class: "badge", text: sum.visibility === "public" ? "Public" : "Private" })),
    el("dl", { class: "repo-facts" }, facts.map(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })])),
    notice("info", `GitHub Actions may create and approve pull requests on ${slug}. The cycle needs it, and it applies to every workflow of the repository, yours too. Your workflows' default permissions stay ${String(sum.defaults ?? "as they are")}.`));
}

// Every key the cycle needs: on GitHub already, or asked now (names only).
function adoptKeyOverview() {
  return keyOverview(app.run.adopt?.keys?.keys, app.run.ask?.kind === "key" ? app.run.ask.name : "");
}

// What the project's host keeps (Vercel's Production variables): DEV_OS never sees them, so you set them there.
function adoptHostList() {
  return hostList(app.run.adopt?.keys?.host ?? app.run.adopt?.finish?.result?.host);
}

function adoptKeyScreen(ask, log) {
  const total = ask.total ?? 1;
  const index = ask.index ?? 0;
  const ticks = el("div", { class: "ticks", "aria-hidden": "true" }, Array.from({ length: total }, (_, at) => el("span", { class: at < index ? "is-done" : (at === index ? "is-now" : null) })));
  return step("keys", "Keys for the cycle",
    "Each key becomes a GitHub secret the cycle uses. Keys already on GitHub keep their values. A skipped key can be added later in the repository's settings.",
    [el("div", { class: "vault-top" }, el("span", { class: "step-count", text: `Key ${index + 1} of ${total}` }), ticks),
      adoptKey(ask), adoptKeyOverview(), adoptHostList(), app.error ? notice("bad", app.error) : null, log],
    null);
}

const ADOPT_WORK = {
  adopt: ["Starting", "DEV_OS surveys the project again before anything else."],
  brief: ["Writing the brief", "Your AI tool reads a copy of the tracked files and writes what the project is, how it is built, what is done and open, and its risks. Your project is not touched."],
  write: ["Adding DEV_OS on a branch", "DEV_OS places its files on a new branch, devos/adopt, in a copy beside your checkout; your AI tool writes the documents from the brief; then every guard runs and DEV_OS commits once."],
  keys: ["Checking the keys on GitHub", "Names only: DEV_OS reads which keys and variables the repository already has, never a value."],
  publish: ["Pushing and opening the pull request", "Then DEV_OS sets the labels and variables the cycle needs and checks the setup again."],
};

function adoptWorking(at, log) {
  const run = app.run;
  const [title, lede] = ADOPT_WORK[at] ?? ["Working", "The engine is on the next step."];
  const info = run.adopt?.[at] ?? {};
  const who = info.tool ? `${toolLabel(info.tool)} · ${info.model}` : "DEV_OS";
  const now = el("div", { class: "agent-now" });
  const drawNow = () => {
    const recent = run.activity.slice(0, -1).slice(-5).reverse();
    const since = run.now ? Math.max(0, Math.round((Date.now() - run.now.at) / 1000)) : 0;
    now.classList.toggle("is-quiet", since >= 120);
    put(now, [
      el("div", { class: "now-head" },
        el("span", { class: "now-pulse", "aria-hidden": "true" }),
        el("span", { class: "now-label", text: `${who} is working` }),
        el("span", { class: "now-time", text: run.now ? (since < 5 ? "just now" : `last step ${clockText(since)} ago`) : "" })),
      el("p", { class: "now-text", text: run.now ? run.now.text : (run.logs.at(-1) ?? "Starting…") }),
      recent.length ? el("ol", { class: "now-list", "aria-label": "Earlier steps" }, recent.map((item) => el("li", { class: `now-item is-${item.kind}`, text: item.text }))) : null]);
  };
  drawNow();
  clearInterval(app.timer);
  app.timer = setInterval(drawNow, 1000);
  app.live = () => { drawNow(); log.fill(); };
  const round = Number.isInteger(info.round) && info.round > 1 ? ` Round ${info.round}: your changes.` : "";
  return step(ADOPT_STEPS.some((item) => item.id === at) ? at : "brief", title, `${lede}${round}`,
    [now, at === "keys" ? adoptKeyOverview() : null, log],
    el("footer", { class: "step-foot" }, el("p", { class: "foot-note", text: "Stopping keeps your project as it is." }), el("span", { class: "spacer" }),
      el("button", { class: "btn btn-danger", type: "button", onclick: stopRun, text: app.stopping ? "Stopping…" : "Stop run" })));
}

function adoptFinish(log) {
  const run = app.run;
  const result = run.adopt?.finish?.result ?? null;
  const folder = adoptState().surveyed || adoptState().folder;
  const again = () => {
    app.run = freshRun();
    app.adopt = null;
    go("adopt");
  };
  const tail = el("div", { class: "vault-actions finish-more" },
    el("button", { class: "btn", type: "button", text: "Adopt another project", onclick: again }),
    el("button", { class: "btn btn-quiet", type: "button", text: "Close DEV_OS", onclick: closeApp }));
  const prCard = (url) => el("a", { class: "pr-card", href: url, target: "_blank", rel: "noopener noreferrer" },
    el("span", { class: "pr-kicker", text: "Pull request" }), el("span", { class: "pr-url", text: url }), el("span", { class: "pr-go", text: "Open it on GitHub →" }));
  const hub = folder ? el("button", { class: "btn", type: "button", text: "Open the project's page", onclick: () => { app.run = freshRun(); openHub(folder); } }) : null;
  let mark = icon("done", "final-mark is-ok");
  let title;
  let lede;
  const body = [];
  if (result?.pushed && result.ready && PULL_REQUEST.test(String(result.pr ?? ""))) {
    title = "DEV_OS is ready on your project";
    lede = "The pull request holds everything DEV_OS adds. Nothing reaches main until you merge it.";
    body.push(prCard(result.pr), el("div", { class: "section" },
      el("h2", { class: "section-title", text: "What happens next" }),
      el("ol", { class: "next" },
        el("li", {}, el("strong", { text: "Read the pull request." }), " Its description summarises the brief, the checks' baseline and what the cycle needs."),
        el("li", {}, el("strong", { text: "Merge it yourself on GitHub." }), " Your merge is the gate: the cycle never merges into main on its own."),
        result.first
          ? el("li", {}, el("strong", { text: `${result.first} starts after the merge.` }), " The supervisor starts it within half an hour; to start at once, run this in the project's folder:", commandBox(String(result.start ?? "")))
          : el("li", {}, el("strong", { text: "Every task is built." }), " A change request (the Dev OS change request form) plans the next."))));
  } else if (result?.pushed && PULL_REQUEST.test(String(result.pr ?? ""))) {
    mark = icon("stop", "final-mark is-stop");
    title = "Pushed, but the cycle still needs settings";
    lede = "The pull request is open. Add what is missing before you merge it, then check again with the command below.";
    body.push(prCard(result.pr), Array.isArray(result.missing) && result.missing.length
      ? notice("bad", "Still missing", result.missing.map((line) => String(line))) : null,
    commandBox(String(result.command ?? "")));
  } else if (result && result.pushed === false) {
    mark = icon("stop", "final-mark is-stop");
    title = "Nothing was pushed";
    lede = `${result.branch ?? "devos/adopt"} stays on this computer, committed. Push it and open its pull request when you are ready, with this command:`;
    body.push(commandBox(String(result.command ?? "")));
  } else if (run.done === 0) {
    mark = icon("stop", "final-mark is-stop");
    title = "Stopped, nothing changed";
    lede = run.logs.at(-1) ?? "The adoption ended before DEV_OS was added.";
  } else {
    mark = icon("fail", "final-mark is-bad");
    title = "The adoption stopped";
    lede = "The engine's last lines say why. Your checkout is as it was.";
    body.push(notice("bad", "The engine's last lines", run.logs.slice(-6)));
  }
  if (Array.isArray(result?.later) && result.later.length) {
    body.push(el("div", { class: "section" }, el("h2", { class: "section-title", text: "Keys to set later" }),
      el("p", { class: "hint", text: "GitHub → the repository → Settings → Secrets and variables → Actions → New repository secret." }),
      el("ul", { class: "repo-list" }, result.later.map((name) => el("li", { text: String(name) })))));
  }
  if (result?.pushed) body.push(adoptHostList());
  app.live = () => log.fill();
  return el("section", { class: "step final", "aria-labelledby": "title-finish" },
    mark,
    (() => { const h = head("finish", title, lede, false); h.querySelector("h1").id = "title-finish"; return h; })(),
    body,
    app.error ? notice("bad", app.error) : null,
    hub ? el("div", { class: "vault-actions" }, hub) : null,
    tail,
    log);
}

SCREENS.adopting = () => {
  const run = app.run;
  const log = adoptLog(run.done !== null && run.done !== 0);
  app.live = () => log.fill();
  if (run.done !== null) {
    clearInterval(app.timer);
    return adoptFinish(log);
  }
  const asking = !app.sent ? run.ask : null;
  if (asking?.kind === "key") {
    clearInterval(app.timer);
    return adoptKeyScreen(asking, log);
  }
  if (asking?.kind === "line") {
    clearInterval(app.timer);
    return adoptQuestion(asking, log);
  }
  return adoptWorking(adoptNow(), log);
};

function backFoot(target) {
  return el("footer", { class: "step-foot" },
    el("button", { class: "btn btn-quiet", type: "button", text: "Back", onclick: () => go(target) }),
    el("span", { class: "spacer" }));
}

// Opens a started project's page; `note` is one line shown above it (after a clone).
function openHub(folder, note = "") {
  app.hub = { folder, note, fail: null, pull: "", connecting: false, busy: false, data: null, loading: false };
  go("hub");
}

async function loadHub(hub) {
  if (hub.loading || hub.data) return;
  hub.loading = true;
  const query = hub.folder ? `?folder=${encodeURIComponent(hub.folder)}` : "";
  const { status, data } = await api(`/api/hub${query}`);
  hub.loading = false;
  hub.data = status === 200 && data ? data : { ok: false, errors: [data?.errors?.[0] ?? "The project could not be read."] };
  if (app.hub === hub && current() === "hub") render(true);
}

function compareVersions(left, right) {
  const parse = (value) => (/^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split(".").map(Number) : null);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// The version row: the project's (in this folder and on GitHub), this engine's and the latest release, and what to do.
function versionRow(v, a = {}) {
  const github = a.github && a.github !== v.project ? `, ${a.github} on GitHub` : "";
  const detail = `This project ${v.project || "—"}${github} · this engine ${v.engine} · the latest release ${v.latest || "unknown"}.`;
  const p = a.github || v.project;
  if (!p) return checkRow("bad", "Version", `${detail} The project has no engine version (devos/engine.lock.json).`, "Unknown");
  if (v.latest && compareVersions(v.engine, v.latest) < 0) return checkRow("warn", "Version", `${detail} Update this engine first, then upgrade the project.`, "Engine behind");
  const project = compareVersions(p, v.engine);
  if (project < 0) return checkRow("warn", "Version", `${detail} Upgrade it by pull request, below.`, "Upgrade");
  if (project > 0) return checkRow("bad", "Version", `${detail} The project is newer than this engine: update the engine.`, "Engine behind");
  if (!v.latest) return checkRow("warn", "Version", `${detail} The latest release could not be read from GitHub.`, "Not checked");
  if (a.github && v.project !== a.github) return checkRow("warn", "Version", `${detail} Bring this folder up to date, below.`, "Folder behind");
  return checkRow("ok", "Version", detail, "Up to date");
}

// ---------- a project's upgrade and Control Tower link (E26b) ----------
// POST /api/upgrade, /api/pull, /api/connect and (E28) /api/ask-tower. The server reads the page's facts again and
// runs only what they allow.

function pullLink(url) {
  return el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: url });
}

async function hubAction(hub, route, body = {}) {
  if (hub.busy) return;
  hub.busy = true;
  render(true);
  const sent = { ...body };
  if (hub.folder) sent.folder = hub.folder;
  const { status, data } = await api(route, { method: "POST", body: sent });
  const done = status === 200 && data?.ok;
  if (done && route === "/api/ask-tower") hub.asked = true;
  hub.busy = false;
  hub.note = done ? data.message : "";
  hub.fail = done ? null : { text: data?.errors?.[0] ?? "The action was refused.", output: Array.isArray(data?.output) ? data.output : [] };
  hub.pull = typeof data?.pull === "string" ? data.pull : "";
  hub.connecting = false;
  hub.data = null;
  if (app.hub === hub && current() === "hub") render(true);
}

function hubButton(hub, text, route, body = {}, primary = false) {
  return el("button", { class: primary ? "btn btn-primary" : "btn", type: "button", text: hub.busy ? "Working…" : text, disabled: hub.busy, onclick: () => hubAction(hub, route, body) });
}

// Upgrade by pull request, or bring the folder up to date; otherwise why not, when something is behind.
function versionSection(hub, v, a) {
  if (!a?.upgrade) return null;
  const p = a.github || v.project;
  const items = [];
  const buttons = [];
  if (a.upgrade.can) buttons.push(hubButton(hub, `Upgrade to ${v.engine} by pull request`, "/api/upgrade", {}, true));
  else if (compareVersions(p, v.engine) < 0) items.push(el("p", { class: "hint", text: a.upgrade.why }));
  if (a.pull.can) buttons.push(hubButton(hub, "Bring this folder up to date", "/api/pull"));
  else if (a.github && v.project && a.github !== v.project) items.push(el("p", { class: "hint", text: a.pull.why }));
  if (a.pulls?.upgrade) items.push(el("p", { class: "hint" }, "The upgrade pull request: ", pullLink(a.pulls.upgrade)));
  if (!buttons.length && !items.length) return null;
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "Version" }),
    el("p", { class: "hint", text: "The upgrade is a pull request on GitHub: you read it and merge it there. Then bring this folder up to date." }),
    ...items,
    buttons.length ? el("div", { class: "vault-actions" }, buttons) : null);
}

// E28 (PR-65): the link is on. A devos-cycle run asks the Control Tower; with no run going, ask now (a link run).
function askSection(hub, data) {
  const a = data.actions;
  if (!a?.ask || !data.repository || data.reporting !== "on") return null;
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "The Control Tower link" }),
    el("p", { class: "hint", text: "DEVOS_REPORTING is on. A devos-cycle run asks the Control Tower to link this repository, and its operator approves it once; from then on each step sends one event. When no run is going, ask now: a link run builds nothing and, once the link is approved, sends the project's tasks, so ask once more after the approval. To stop, set DEVOS_REPORTING to off." }),
    a.pulls?.connect ? el("p", { class: "hint" }, "The link pull request: ", pullLink(a.pulls.connect)) : null,
    hub.asked
      ? el("p", { class: "hint", text: "Asked. The link run's report job shows the Control Tower's answer, and the tasks it sent, in the repository's Actions tab." })
      : a.ask.can
        ? el("div", { class: "vault-actions" }, hubButton(hub, "Ask the Control Tower now", "/api/ask-tower", {}, true))
        : el("p", { class: "hint", text: a.ask.why }));
}

// Connect to the Control Tower: the contract this engine ships and an explicit yes, then a pull request.
// E29: a linked project that accepted an older contract reads this one and accepts it again, by the same pull request;
// otherwise the link section. Either way, with the link on, the ask section follows. The page lists the sections.
function towerSection(hub, data) {
  const renew = data.reporting === "on" && data.contractVersion !== app.state.contractVersion;
  if (data.reporting === "on" && !renew) return [askSection(hub, data)];
  const connect = connectSection(hub, data, renew);
  return renew ? [connect, askSection(hub, data)] : [connect];
}

function connectSection(hub, data, renew) {
  const a = data.actions;
  if (!a?.connect || !data.repository) return null;
  const title = el("h2", { class: "section-title", text: renew ? `Accept the contract's version ${app.state.contractVersion}` : "Connect to the Control Tower" });
  if (!a.connect.can) {
    return el("div", { class: "section" }, title,
      el("p", { class: "hint", text: a.connect.why }),
      a.pulls?.connect ? el("p", { class: "hint" }, "The link pull request: ", pullLink(a.pulls.connect)) : null);
  }
  const intro = renew
    ? el("p", { class: "hint", text: `This project accepted the contract's version ${data.contractVersion || "—"}. Version ${app.state.contractVersion} adds one thing: after approval, a link run also sends the project's plan, one event for each task, with the same fields. Read it and say yes: a pull request records your answer in devos/answers.json, and DEVOS_REPORTING stays on. Until then, nothing more than before is sent.` })
    : el("p", { class: "hint", text: "Optional. The Control Tower is a private service operated by Jovo-Jovi, not part of the engine, and you get no access to it. Yes: a pull request records your answer in devos/answers.json, and the repository variable DEVOS_REPORTING turns on. Each cycle run then asks the Control Tower to link the repository and, once its operator approves, sends one event per step (the contract lists every field). To stop, set DEVOS_REPORTING to off." });
  if (!hub.connecting) {
    return el("div", { class: "section" }, title, intro,
      el("div", { class: "vault-actions" },
        el("button", { class: "btn", type: "button", text: "Read the contract", onclick: () => { hub.connecting = true; render(true); } })));
  }
  const box = el("input", { type: "checkbox" });
  const connect = hubButton(hub, renew ? "Accept by pull request" : "Connect by pull request", "/api/connect", { accept: true, contract: app.state.contractVersion }, true);
  connect.disabled = true;
  box.addEventListener("change", () => { connect.disabled = hub.busy || !box.checked; });
  return el("div", { class: "section" }, title, intro,
    markdownDoc(app.state.contract),
    el("label", { class: "check" }, box, el("span", { text: `I have read the contract (version ${app.state.contractVersion}), and I want this project linked to the Control Tower.` })),
    el("div", { class: "vault-actions" }, connect,
      el("button", { class: "btn btn-quiet", type: "button", text: "Not now", onclick: () => { hub.connecting = false; render(true); } })));
}

SCREENS.hub = () => {
  const hub = app.hub;
  const back = backFoot(choosing() ? "current" : "machine");
  if (!hub) return step("hub", "No project is open", "", [notice("bad", "Go back and pick a project.")], back);
  if (!hub.data) {
    loadHub(hub);
    return step("hub", "Opening the project", "", [el("p", { class: "hint", role: "status", text: "Reading its folder and GitHub…" })], back);
  }
  const data = hub.data;
  if (!data.ok) return step("hub", "The project could not be opened", "", [notice("bad", data.errors?.[0] ?? "The project could not be read.")], back);
  const setup = data.committed
    ? checkRow("ok", "Setup", data.repository ? el("span", {}, "On GitHub as ", el("code", { text: data.repository }), ".") : "Committed; no GitHub repository yet.", "Done")
    : checkRow("warn", "Setup", `Not finished. It picks up at: ${data.step}.`, "To finish");
  let tower;
  if (!data.repository) tower = checkRow("warn", "Control Tower link", "The project has no GitHub repository yet.", "Not linked");
  else if (data.reportingError) tower = checkRow("bad", "Control Tower link", data.reportingError, "Unknown");
  else if (data.reporting === "on") tower = checkRow("ok", "Control Tower link", "On by your choice: DEVOS_REPORTING is on. A devos-cycle run asks the Control Tower to link this repository, and its operator approves it once.", "On");
  else tower = checkRow("warn", "Control Tower link", "Not linked: DEVOS_REPORTING is off, so nothing is sent.", "Off");
  return step("hub", data.name, el("span", {}, el("code", { text: data.folder })),
    [hub.note ? notice("ok", hub.note, hub.pull ? [pullLink(hub.pull)] : []) : null,
      hub.fail ? notice("bad", hub.fail.text, hub.fail.output.slice(-6)) : null,
      el("div", { class: "checks" }, setup, tasksRow(data.tasks), versionRow(data.versions, data.actions), tower, ...cycleRows(data)),
      data.repository ? repoLinks(data) : null,
      data.committed ? null : el("div", { class: "vault-actions" },
        el("button", { class: "btn btn-primary", type: "button", text: "Continue this project", onclick: () => resume(hub.folder) })),
      versionSection(hub, data.versions, data.actions),
      ...towerSection(hub, data),
      data.repository ? modelsSection(hub.folder) : null,
      app.error ? notice("bad", app.error) : null],
    back);
};

// E72: the project's tasks, from its docs/PHASES.md.
function tasksRow(tasks) {
  if (!tasks || !Number.isInteger(tasks.total) || tasks.total === 0) return null;
  const nextTask = tasks.next ? `Next: ${tasks.next.task}, ${tasks.next.name}.` : "Every task is built.";
  return checkRow("ok", "Tasks", `${tasks.done} of ${tasks.total} built. ${nextTask}`, `${tasks.done} of ${tasks.total}`);
}

// E72: how a finished cycle run ended, in words: its row's kind and label.
const RUN_ENDS = {
  success: ["ok", "Passed"],
  cancelled: ["warn", "Cancelled"],
  skipped: ["warn", "Skipped"],
  neutral: ["warn", "Ended"],
  action_required: ["warn", "Waiting for approval"],
  timed_out: ["bad", "Timed out"],
  startup_failure: ["bad", "Did not start"],
};

// E72: the last devos-cycle run and the setup check's issue, as GitHub has them (names only, never a value).
function cycleRows(data) {
  if (!data.repository) return [];
  const link = (url, text) => el("a", { href: url, target: "_blank", rel: "noreferrer noopener", text });
  const last = data.lastRun;
  let run;
  if (!last) run = checkRow("warn", "Last cycle run", "No devos-cycle run yet, or GitHub could not be read.", "None");
  else {
    const when = Number.isNaN(Date.parse(last.at)) ? "" : new Date(last.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const open = last.url ? [" ", link(last.url, "Open the run")] : [];
    const [kind, label] = last.status !== "completed" ? ["ok", "Running"] : (RUN_ENDS[last.conclusion] ?? ["bad", "Failed"]);
    const detail = last.status !== "completed" ? `Started ${when || "recently"}.` : `${label}${when ? `, ${when}` : ""}.`;
    run = checkRow(kind, "Last cycle run", el("span", {}, detail, open), label);
  }
  const setupIssue = data.setupIssue
    ? checkRow("bad", "Settings on GitHub", el("span", {}, "The setup check lists what is missing: ", link(data.setupIssue, "its issue"), ". Add those, then the cycle resumes."), "Missing")
    : checkRow("ok", "Settings on GitHub", "No open “Dev OS: setup needed” issue.", "None open");
  return [run, setupIssue];
}

// E72: the repository, its cycle runs and its open pull requests, on GitHub.
function repoLinks(data) {
  const base = `https://github.com/${data.repository}`;
  const pulls = Number.isInteger(data.openPulls) ? ` (${data.openPulls} open)` : "";
  const link = (href, text) => el("a", { class: "btn", href, target: "_blank", rel: "noreferrer noopener", text });
  return el("div", { class: "vault-actions" },
    link(base, "Repository"), link(`${base}/actions/workflows/devos-cycle.yml`, "Cycle runs"), link(`${base}/pulls`, `Pull requests${pulls}`));
}

// Where a started project picks up: GET /api/project (local files only).
async function lookUp(folder) {
  const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  const { status, data } = await api(`/api/project${query}`);
  if (status === 200 && data?.ok) return data;
  return { ok: false, error: data?.errors?.[0] ?? "That folder could not be read." };
}

function folderFinder() {
  const input = el("input", { class: "input", id: "resume-folder", type: "text", spellcheck: "false", autocomplete: "off", placeholder: app.state.suggest ? `${app.state.suggest}${app.state.suggest.includes("\\") ? "\\" : "/"}my-app` : "" });
  const found = el("div", { class: "finder-result" });
  const find = el("button", { class: "btn", type: "button", text: "Find it" });
  const search = async () => {
    const folder = input.value.trim();
    if (!folder) return;
    find.disabled = true;
    const got = await lookUp(folder);
    find.disabled = false;
    if (!got.ok) {
      put(found, notice("bad", got.error));
      return;
    }
    put(found, el("div", { class: "key-item project-item" },
      el("div", { class: "key-top" },
        el("span", { class: "project-name", text: got.name }),
        el("span", { class: got.approved ? "badge badge-ok" : "badge", text: got.approved ? "Blueprint approved" : "Blueprint to finish" })),
      el("p", { class: "hint", text: `It picks up at: ${got.step}.` }),
      projectRow(got.folder)));
  };
  // E26b: the system's folder dialog (POST /api/pick-folder) fills the path and looks it up.
  const choose = el("button", { class: "btn btn-primary", type: "button", text: "Choose a folder…" });
  const pick = async () => {
    choose.disabled = true;
    put(found, el("p", { class: "hint", role: "status", text: "A folder dialog is open on this computer. It may be behind this window." }));
    const { status, data } = await api("/api/pick-folder", { method: "POST", body: {} });
    choose.disabled = false;
    if (status === 200 && data?.ok) {
      input.value = data.folder;
      await search();
      return;
    }
    put(found, data?.cancelled ? null : notice("bad", data?.errors?.[0] ?? "The folder dialog did not open. Paste the folder’s full path instead."));
  };
  choose.addEventListener("click", pick);
  find.addEventListener("click", search);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); search(); } });
  return el("div", { class: "field" },
    el("p", { class: "label", text: "A project in another folder" }),
    el("div", { class: "vault-actions" }, choose),
    el("label", { class: "hint", for: "resume-folder", text: "Or paste the project folder’s full path:" }),
    el("div", { class: "finder" }, input, find),
    el("p", { class: "hint", text: "DEV_OS reads where the project stopped; Open shows the project’s page." }),
    found);
}

// ---------- a started project's models (E25b, PR-63) ----------
// The reviewer's, the light reviewer's and the default builder's model, and the repository variable that changes each
// one from the next cycle run: GET and POST /api/models. The server calls gh only; nothing is committed.

const ROLE_LABELS = { reviewer: "Reviewer", light: "Light reviewer", builder: "Builder" };

// A started project's path and Open, which shows the project's page (E26a).
function projectRow(folder) {
  return el("div", { class: "project-row" },
    el("code", { class: "project-path", text: folder }),
    el("div", { class: "project-actions" },
      el("button", { class: "btn btn-quiet", type: "button", text: "Open", onclick: () => openHub(folder) })));
}

// A project's Models button, on its page; the panel opens under it.
function modelsSection(folder) {
  const slot = el("div", { class: "models-slot" });
  const models = el("button", { class: "btn", type: "button", text: "Models of this project", "aria-expanded": "false" });
  models.addEventListener("click", () => toggleModels(models, slot, folder));
  return el("div", { class: "section" }, el("div", { class: "vault-actions" }, models), slot);
}

function toggleModels(button, slot, folder) {
  if (slot.childElementCount > 0) {
    slot.replaceChildren();
    button.setAttribute("aria-expanded", "false");
    return;
  }
  button.setAttribute("aria-expanded", "true");
  showModels(slot, folder);
}

async function showModels(slot, folder, note = null) {
  put(slot, el("p", { class: "hint", role: "status", text: "Reading the project’s models…" }));
  const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  const { status, data } = await api(`/api/models${query}`);
  if (status !== 200 || !data?.ok) {
    put(slot, notice("bad", data?.errors?.[0] ?? "The project’s models could not be read."));
    return;
  }
  put(slot, el("div", { class: "models" },
    el("h2", { class: "section-title", text: `Models of ${data.slug}` }),
    el("p", { class: "hint", text: "Each cycle run reads these when it starts. Use this model sets a repository variable on GitHub, with no commit. Next models opens a pull request: they apply once you merge it." }),
    note,
    el("div", { class: "keys" }, data.roles.map((role) => modelRow(slot, folder, role)))));
}

function modelRow(slot, folder, role) {
  const label = ROLE_LABELS[role.role] ?? role.role;
  const select = el("select", { class: "select", "aria-label": `${label} model` });
  const groups = modelGroups(role.tool);
  if (!hasModel(role.tool, role.effective)) select.append(el("option", { value: role.effective, text: role.effective }));
  for (const group of groups) {
    const optgroup = el("optgroup", { label: group.label });
    for (const model of group.models) optgroup.append(el("option", { value: model.id, text: model.mine ? `${model.id} (on your account)` : model.id }));
    select.append(optgroup);
  }
  select.value = role.effective;
  const use = el("button", { class: "btn", type: "button", text: "Use this model" });
  use.addEventListener("click", () => changeModel(slot, folder, role.role, select.value, [use]));
  const back = role.override ? el("button", { class: "btn btn-quiet", type: "button", text: "Back to the configured model" }) : null;
  if (back) back.addEventListener("click", () => changeModel(slot, folder, role.role, null, [use, back]));
  const where = role.override
    ? `Set by ${role.name}; configured: ${role.configured}.`
    : (role.inherited ? "The reviewer reviews light tasks too." : "The configured model.");
  // E26c2 (PR-64): the models tried after this one at a usage limit, changed by pull request.
  const fallbacks = Array.isArray(role.fallbacks) ? role.fallbacks : [];
  const shared = role.role === "light" && role.inherited;
  const next = el("p", { class: "hint", text: shared
    ? `Next models: the reviewer's${fallbacks.length ? ` (${fallbacks.join(", then ")})` : ", none"}.`
    : `Next models at a usage limit: ${fallbacks.length ? fallbacks.join(", then ") : "none"}.` });
  const editor = el("div", { class: "fallbacks-slot" });
  const edit = shared ? null : el("button", { class: "btn btn-quiet", type: "button", text: "Next models", "aria-expanded": "false" });
  // E60 (PR-86): another tool and model for the role, by pull request.
  const move = shared ? null : el("button", { class: "btn btn-quiet", type: "button", text: "Another tool", "aria-expanded": "false" });
  const toggle = (button, other, make) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-expanded") === "true") {
        editor.replaceChildren();
        button.setAttribute("aria-expanded", "false");
        return;
      }
      other?.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-expanded", "true");
      put(editor, make());
    });
  };
  if (edit) toggle(edit, move, () => fallbacksEditor(slot, folder, role, label));
  if (move) toggle(move, edit, () => toolEditor(slot, folder, role, label));
  return el("div", { class: "key-item model-item" },
    el("div", { class: "key-top" },
      el("span", { class: "project-name", text: label }),
      el("span", { class: role.override ? "badge badge-brass" : "badge", text: role.override ? "Variable" : "Configured" })),
    el("p", { class: "hint", text: `${toolLabel(role.tool)} · ${role.effective}. ${where}` }),
    next,
    el("div", { class: "model-change" }, select, use, back, edit, move),
    editor);
}

// A role's tool and model: a cycle tool, then one of its models, then a pull request (POST /api/agent). The server
// first checks that the repository has the tool's key by name. Nothing changes on GitHub until the pull request is merged.
function toolEditor(slot, folder, role, label) {
  const box = el("div", { class: "models" });
  const tools = el("select", { class: "select", "aria-label": `${label}: the tool` });
  for (const tool of cycleTools()) tools.append(el("option", { value: tool.id, text: tool.label }));
  tools.value = role.tool;
  const models = el("select", { class: "select", "aria-label": `${label}: the model` });
  const save = el("button", { class: "btn btn-primary", type: "button", text: "Save by pull request" });
  const fill = () => {
    models.replaceChildren();
    for (const group of modelGroups(tools.value)) {
      const optgroup = el("optgroup", { label: group.label });
      for (const model of group.models) optgroup.append(el("option", { value: model.id, text: model.mine ? `${model.id} (on your account)` : model.id }));
      models.append(optgroup);
    }
    if (tools.value === role.tool && hasModel(role.tool, role.configured)) models.value = role.configured;
    save.disabled = models.options.length === 0;
  };
  tools.addEventListener("change", fill);
  fill();
  save.addEventListener("click", async () => {
    save.disabled = true;
    const body = { role: role.role, tool: tools.value, model: models.value };
    if (folder) body.folder = folder;
    const { status, data } = await api("/api/agent", { method: "POST", body });
    const note = status === 200 && data?.ok
      ? notice("ok", data.message, data.pull ? [pullLink(data.pull)] : [])
      : notice("bad", data?.errors?.[0] ?? "The change was refused.");
    await showModels(slot, folder, note);
  });
  put(box,
    el("p", { class: "hint", text: `${label} runs ${toolLabel(role.tool)} · ${role.configured}. Another tool needs its key as a repository secret first, and its next models are cleared: they were the old tool's. Saving opens a pull request on GitHub: nothing changes until you merge it.` }),
    el("div", { class: "model-change" }, tools, models),
    el("div", { class: "vault-actions" }, save));
  return box;
}

// The list of next models for one role: order, remove, add from the tool's models, then a pull request
// (POST /api/fallbacks). Nothing changes on GitHub until the pull request is merged.
function fallbacksEditor(slot, folder, role, label) {
  const list = Array.isArray(role.fallbacks) ? [...role.fallbacks] : [];
  const box = el("div", { class: "models" });
  const draw = () => {
    const rows = list.map((id, index) => el("div", { class: "model-change" },
      el("code", { text: `${index + 1}. ${id}` }),
      el("button", { class: "btn btn-quiet", type: "button", text: "Move up", disabled: index === 0, "aria-label": `Move ${id} up`, onclick: () => { [list[index - 1], list[index]] = [list[index], list[index - 1]]; draw(); } }),
      el("button", { class: "btn btn-quiet", type: "button", text: "Remove", "aria-label": `Remove ${id}`, onclick: () => { list.splice(index, 1); draw(); } })));
    const select = el("select", { class: "select", "aria-label": `${label}: a model to add` });
    for (const group of modelGroups(role.tool)) {
      const optgroup = el("optgroup", { label: group.label });
      for (const model of group.models) {
        if (model.id === role.effective || list.includes(model.id)) continue;
        optgroup.append(el("option", { value: model.id, text: model.mine ? `${model.id} (on your account)` : model.id }));
      }
      if (optgroup.childElementCount > 0) select.append(optgroup);
    }
    const add = el("button", { class: "btn", type: "button", text: "Add", disabled: list.length >= 4 || select.options.length === 0 });
    add.addEventListener("click", () => {
      if (select.value && !list.includes(select.value) && list.length < 4) list.push(select.value);
      draw();
    });
    const save = el("button", { class: "btn btn-primary", type: "button", text: "Save by pull request" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      const body = { role: role.role, models: list };
      if (folder) body.folder = folder;
      const { status, data } = await api("/api/fallbacks", { method: "POST", body });
      const note = status === 200 && data?.ok
        ? notice("ok", data.message, data.pull ? [pullLink(data.pull)] : [])
        : notice("bad", data?.errors?.[0] ?? "The change was refused.");
      await showModels(slot, folder, note);
    });
    put(box,
      el("p", { class: "hint", text: `Tried in this order after ${role.effective}, each on every account of ${toolLabel(role.tool)}, at a usage limit. Up to 4. Saving opens a pull request on GitHub: nothing changes until you merge it.` }),
      ...(rows.length ? rows : [el("p", { class: "hint", text: "No next models." })]),
      el("div", { class: "model-change" }, select, add),
      el("div", { class: "vault-actions" }, save));
  };
  draw();
  return box;
}

async function changeModel(slot, folder, role, model, buttons) {
  for (const button of buttons) button.disabled = true;
  const body = { role, model };
  if (folder) body.folder = folder;
  const { status, data } = await api("/api/models", { method: "POST", body });
  const note = status === 200 && data?.ok
    ? notice("ok", data.message)
    : notice("bad", data?.errors?.[0] ?? "The change was refused.");
  await showModels(slot, folder, note);
}

function checkRow(kind, name, detail, state) {
  return el("div", { class: `check-row is-${kind}` },
    el("span", { class: "check-icon" }, icon(kind === "ok" ? "check" : (kind === "bad" ? "cross" : "dash"))),
    el("div", {}, el("p", { class: "check-name", text: name }), el("p", { class: "check-detail" }, detail)),
    el("span", { class: "check-state", text: state }));
}

function markdownDoc(text) {
  const doc = el("article", { class: "doc", tabindex: "0", "aria-label": "Contract" });
  const blocks = String(text).replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("# ")) doc.append(el("h2", { text: trimmed.slice(2) }));
    else if (trimmed.startsWith("## ")) doc.append(el("h3", { text: trimmed.slice(3) }));
    else doc.append(el("p", {}, richText(trimmed.replace(/\n/g, " "))));
  }
  return doc;
}

SCREENS.contract = () => {
  const d = app.draft;
  let footer;
  const box = el("input", { type: "checkbox", checked: d.accepted });
  box.addEventListener("change", () => {
    d.accepted = box.checked;
    saveDraft();
    footer.refresh();
  });
  const pickLink = (value) => {
    d.link = value === "yes";
    saveDraft();
    footer.refresh();
  };
  // E10a: the private Control Tower, said before anything continues; neither answer is chosen for the developer.
  const link = el("div", { class: "field", role: "group", "aria-labelledby": "link-label" },
    el("p", { class: "label", id: "link-label", text: "Link this project to the DEV_OS Control Tower?" }),
    el("p", { class: "hint", text: "Optional. The Control Tower is a private service operated by Jovo-Jovi, not part of the engine, and you get no access to it. Yes: the project's cycle asks it to link the repository and, once its operator approves, sends one event per step (the contract lists every field). No: nothing is ever sent, and the engine works the same. The repository variable DEVOS_REPORTING keeps your answer; change it any time." }),
    el("div", { class: "choices", role: "radiogroup", "aria-label": "Control Tower link" },
      choice({ name: "link", value: "yes", checked: d.link === true, title: "Yes, link it", desc: "After its operator approves, each step of the cycle sends one event, and a link run sends the plan.", onChange: pickLink }),
      choice({ name: "link", value: "no", checked: d.link === false, title: "No, keep it standalone", desc: "Nothing is ever sent.", onChange: pickLink })));
  footer = foot({ primary: "Accept and continue", check: () => problems("contract") });
  return step("contract", "Read the contract", `Version ${app.state.contractVersion}. It says what the engine is, what the private Control Tower is, what an optional link sends, and what is never sent.`,
    [markdownDoc(app.state.contract), el("label", { class: "check" }, box, el("span", { text: "I have read the contract and I accept it." })), localDraft() ? null : link],
    footer);
};

function agentPicker({ name, value, tools, onChange }) {
  const wrap = el("div", { class: "field" });
  const seg = el("div", { class: "seg", role: "radiogroup", "aria-label": "Tool" });
  const select = el("select", { class: "select", "aria-label": "Model" });
  const fill = () => {
    select.replaceChildren();
    for (const group of modelGroups(value.tool)) {
      const optgroup = el("optgroup", { label: group.label });
      for (const model of group.models) {
        optgroup.append(el("option", { value: model.id, text: model.mine ? `${model.id} (on your account)` : model.id }));
      }
      select.append(optgroup);
    }
    if (!hasModel(value.tool, value.model)) value.model = firstModel(value.tool);
    select.value = value.model;
  };
  for (const tool of tools) {
    const state = readiness(tool.id);
    const input = el("input", { type: "radio", name: `${name}-tool`, value: tool.id, checked: value.tool === tool.id });
    input.addEventListener("change", () => {
      if (!input.checked) return;
      value.tool = tool.id;
      value.model = firstModel(tool.id);
      fill();
      onChange();
    });
    seg.append(el("label", { class: "seg-item", title: readinessText(tool.id) },
      input,
      el("span", {}, el("span", { class: `dot ${state === "ready" ? "dot-ready" : (state === "half" ? "dot-half" : "")}`, "aria-hidden": "true" }), tool.label)));
  }
  select.addEventListener("change", () => {
    value.model = select.value;
    onChange();
  });
  fill();
  wrap.append(seg, select);
  return wrap;
}

SCREENS.reviewers = () => {
  const d = app.draft;
  const tools = cycleTools();
  const lightWrap = el("div", { class: "section" });
  const drawLight = () => {
    put(lightWrap,
      el("div", { class: "choices" },
        choice({ name: "light-mode", value: "same", checked: d.light === null, title: "Same as the reviewer", desc: "One model reviews every task.", onChange: () => { d.light = null; saveDraft(); drawLight(); } }),
        choice({ name: "light-mode", value: "own", checked: d.light !== null, title: "A lighter model", desc: "Small, low-risk tasks get a faster, cheaper review.", onChange: () => { d.light = { tool: d.reviewer.tool, model: firstModel(d.reviewer.tool) }; saveDraft(); drawLight(); } })),
      d.light ? agentPicker({ name: "light", value: d.light, tools, onChange: saveDraft }) : null);
  };
  drawLight();
  return step("reviewers", "Who reviews the work?",
    "The reviewer reads every task the builders finish and decides whether it can merge. These run on GitHub with your keys, so a tool does not need to be installed here.",
    [el("div", { class: "agent" },
      el("div", { class: "agent-head" }, el("span", { class: "agent-role", text: "Reviewer" }), el("span", { class: "agent-what", text: "Reviews every task" })),
      agentPicker({ name: "reviewer", value: d.reviewer, tools, onChange: () => { saveDraft(); renderRail(); } })),
    el("div", { class: "agent" },
      el("div", { class: "agent-head" }, el("span", { class: "agent-role", text: "Light reviewer" }), el("span", { class: "agent-what", text: "Risk 1 and 2 tasks" })),
      lightWrap),
    helpBox("What do the reviewers do?", [
      "The reviewer reads every changed line of a task against its fence and the project's documents, judges the evidence of its checks, and writes PASS or FAIL. A FAIL sends the task back to the builder with what must change.",
      "Each task has a risk from 1 to 3. A light reviewer, if you choose one, takes the risk 1 and 2 tasks (copy, a small screen): faster and cheaper. Risk 3 tasks (sign-in, secrets, personal data) always go to the reviewer, for a deep review.",
      "Either way, nothing reaches main until you merge it.",
    ])],
    foot());
};

function effortLabel(value) {
  return [...EFFORT_LEVELS, MAX_EFFORT].find(([level]) => level === value)?.[1] ?? "";
}

function builderEffortMode(item) {
  if (item.tool === "cursor" && PINNED_EFFORT.test(String(item.model ?? ""))) return "pinned";
  if (EFFORT_FLAG_TOOLS.has(item.tool)) return "flag";
  if (item.tool === "cursor" && EFFORT_LEVELS.some(([level]) => hasModel(item.tool, `${item.model}-${level}`))) return "variants";
  return "none";
}

function builderEffortField(item, index, onChange) {
  const mode = builderEffortMode(item);
  if (mode === "pinned" || mode === "none") {
    delete item.effort;
    delete item.fast;
    if (mode === "pinned") return el("p", { class: "hint", text: "This model id sets the effort for every task." });
    return null;
  }
  const select = el("select", { class: "select", id: `builder-${index}-effort` });
  for (const [value, text] of BUILDER_EFFORT_OPTIONS) select.append(el("option", { value, text }));
  if (!BUILDER_EFFORT_OPTIONS.some(([value]) => value === item.effort)) delete item.effort;
  select.value = item.effort || "";
  select.addEventListener("change", () => {
    if (select.value) item.effort = select.value;
    else delete item.effort;
    if (!(builderEffortMode(item) === "variants" && item.effort)) delete item.fast;
    onChange();
  });
  let fast = null;
  if (mode === "variants" && item.effort) {
    const box = el("input", { type: "checkbox", checked: item.fast === true });
    box.addEventListener("change", () => {
      if (box.checked) item.fast = true;
      else delete item.fast;
      onChange();
    });
    fast = el("label", { class: "check" }, box, el("span", { text: "Fast" }));
  } else delete item.fast;
  const hint = item.effort
    ? "Every task of this builder runs at this effort, and the reviewer writes it in each fence."
    : "The reviewer picks the effort in each task's fence: low for copy, high for features, extra high for risk 3.";
  return el("div", { class: "field" },
    el("label", { class: "label", for: `builder-${index}-effort`, text: "Effort" }),
    select,
    fast,
    el("p", { class: "hint", text: hint }));
}

function blueprintEffortField(agent, onChange) {
  if (!EFFORT_FLAG_TOOLS.has(agent.tool)) {
    delete agent.effort;
    if (agent.tool === "cursor") return el("p", { class: "hint", text: "Cursor's model id sets its effort, for example grok-4.7-xhigh." });
    return null;
  }
  const levels = agent.tool === "claude" ? [...EFFORT_LEVELS, MAX_EFFORT] : EFFORT_LEVELS;
  const select = el("select", { class: "select", id: "blueprint-effort" });
  for (const [value, text] of levels) select.append(el("option", { value, text }));
  if (!levels.some(([level]) => level === agent.effort)) agent.effort = "high";
  select.value = agent.effort;
  select.addEventListener("change", () => {
    agent.effort = select.value;
    onChange();
  });
  return el("div", { class: "field" },
    el("label", { class: "label", for: "blueprint-effort", text: "Effort" }),
    select,
    el("p", { class: "hint", text: "How hard the agent thinks while it drafts. High is the default; extra high takes longer and uses more of your plan." }),
    agent.tool === "claude" ? el("p", { class: "hint", text: "Max is Claude Code's alone: the longest thinking, and the most of your plan." }) : null);
}

SCREENS.builders = () => {
  const d = app.draft;
  const tools = cycleTools();
  let footer;
  const list = el("div", { class: "section" });
  const changed = () => { saveDraft(); footer?.refresh(); };
  const draw = () => {
    list.replaceChildren();
    d.pool.forEach((item, index) => {
      const strengths = el("div", { class: "agent-strengths" }, el("span", { class: "hint", text: "Good at" }),
        app.state.strengths.map((name) => {
          const on = item.strengths.includes(name);
          const button = el("button", { class: "toggle", type: "button", "aria-pressed": on ? "true" : "false", text: name });
          button.addEventListener("click", () => {
            const has = item.strengths.includes(name);
            item.strengths = has ? item.strengths.filter((part) => part !== name) : [...item.strengths, name];
            button.setAttribute("aria-pressed", has ? "false" : "true");
            changed();
          });
          return button;
        }));
      const isDefault = el("input", { type: "radio", name: "default-builder", checked: item.isDefault });
      isDefault.addEventListener("change", () => {
        d.pool.forEach((other) => { other.isDefault = other === item; });
        changed();
      });
      const same = item.model === d.reviewer.model;
      list.append(el("div", { class: "agent" },
        el("div", { class: "agent-head" },
          el("span", { class: "agent-role", text: `Builder ${index + 1}` }),
          d.pool.length > 1 ? el("button", { class: "btn btn-quiet", type: "button", "aria-label": `Remove builder ${index + 1}`, onclick: () => {
            const wasDefault = item.isDefault;
            d.pool.splice(index, 1);
            if (wasDefault && d.pool[0]) d.pool[0].isDefault = true;
            changed();
            draw();
          } }, icon("remove"), "Remove") : null),
        agentPicker({ name: `builder-${index}`, value: item, tools, onChange: () => { changed(); draw(); } }),
        builderEffortField(item, index, () => { changed(); draw(); }),
        same ? el("p", { class: "hint", text: "This is the reviewer’s model. Reviews catch more when the builder is a different model." }) : null,
        strengths,
        el("div", { class: "agent-foot" },
          el("label", { class: "check" }, isDefault, el("span", { text: "Default builder" })))));
    });
    if (d.pool.length < 6) {
      list.append(el("div", {}, el("button", { class: "btn", type: "button", onclick: () => {
        const used = new Set(d.pool.map((item) => `${item.tool}/${item.model}`));
        let pick = null;
        for (const tool of tools) {
          for (const group of modelGroups(tool.id)) {
            for (const model of group.models) {
              if (!pick && !used.has(`${tool.id}/${model.id}`) && model.id !== d.reviewer.model) pick = { tool: tool.id, model: model.id };
            }
          }
        }
        pick ??= { tool: tools[0].id, model: firstModel(tools[0].id) };
        d.pool.push({ ...pick, strengths: [], isDefault: d.pool.length === 0 });
        changed();
        draw();
      } }, icon("plus"), "Add a builder")));
    }
  };
  draw();
  footer = foot({ check: () => problems("builders") });
  const policy = el("div", { class: "section" },
    el("h2", { class: "section-title", text: "Who picks the builder for each task" }),
    el("div", { class: "choices" },
      choice({ name: "policy", value: "reviewer-picks", checked: d.policy === "reviewer-picks", title: "The reviewer picks", desc: "When it writes a task, the reviewer chooses the builder whose strengths fit.", onChange: (value) => { d.policy = value; changed(); } }),
      choice({ name: "policy", value: "always-default", checked: d.policy === "always-default", title: "Always the default builder", desc: "Every task goes to the default builder.", onChange: (value) => { d.policy = value; changed(); } })));
  return step("builders", "Who builds it?", "Builders write the code for each task on GitHub. Add a few if you have them, and mark what each is good at.", [list, policy,
    helpBox("How builders are chosen", [
      "A builder takes one task at a time: it reads the task's fence, writes the code and its tests, and proves the checks pass.",
      "With more than one builder, the reviewer picks the one whose strengths fit the task (ui for screens, security for sign-in), or every task goes to the default builder.",
      "Effort is how hard the model thinks: higher is slower and more careful. Unless you set it, the reviewer picks it in each task's fence: low for copy, high for features, extra high for risk 3.",
    ])], footer);
};

SCREENS["blueprint-agent"] = () => {
  const d = app.draft;
  const ready = readyTools();
  if (!d.blueprint) d.blueprint = defaultBlueprint(d);
  let footer;
  const effortWrap = el("div");
  const drawEffort = () => put(effortWrap, d.blueprint ? blueprintEffortField(d.blueprint, () => { saveDraft(); footer?.refresh(); }) : null);
  const body = d.blueprint
    ? [el("div", { class: "agent" },
        el("div", { class: "agent-head" }, el("span", { class: "agent-role", text: "Blueprint agent" }), el("span", { class: "agent-what", text: "Runs on this computer" })),
        agentPicker({ name: "blueprint", value: d.blueprint, tools: ready, onChange: () => { drawEffort(); saveDraft(); footer?.refresh(); } }),
        effortWrap),
      notice("info", "It writes the phases, the glossary and the first task into your folder. You read them and approve them before anything reaches GitHub."),
      helpBox("Why it runs here", [
        "The blueprint is the project's plan: its phases and tasks, the words it uses, its design system when it has screens, and the first task's fence.",
        "It is written in your folder by a tool signed in on this computer, so you can read every document before anything reaches GitHub.",
        "Higher effort takes longer and plans more carefully. You can ask for another round with your changes: up to five rounds in all.",
      ])]
    : [notice("bad", "No AI tool is signed in on this computer. Sign in to one in a terminal, then reload this page.")];
  if (d.blueprint) drawEffort();
  footer = foot({ check: () => problems("blueprint-agent") });
  return step("blueprint-agent", "Who drafts the blueprint?", "Only tools signed in on this computer are listed, because the blueprint is written here, in your folder.", body, footer);
};

SCREENS.type = () => {
  const d = app.draft;
  const list = el("div", { class: "choices choices-2", role: "radiogroup", "aria-label": "Project type" },
    catalogue().types.map((type) => choice({
      name: "type",
      value: type.id,
      checked: d.type === type.id,
      title: type.label,
      desc: type.line,
      onChange: (value) => {
        d.type = value;
        const stacks = stacksFor(value);
        d.stack = stacks.some((stack) => stack.id === typeOf(value).stack) ? typeOf(value).stack : (stacks[0]?.id ?? "");
        d.modules = defaultModules(d.type, d.stack);
        saveDraft();
        renderRail();
      },
    })));
  return step("type", "What are you building?", "Pick the closest kind of product. It sets a sensible stack and modules, which you can change next.", [list], foot(), true);
};

SCREENS.stack = () => {
  const d = app.draft;
  const stacks = stacksFor(d.type);
  const recommended = typeOf(d.type)?.stack;
  let hint;
  const drawHint = () => {
    const limited = stackOf(d.stack)?.toolchain !== "node";
    put(hint, limited ? notice("info", "Supabase, R2, Firebase and Vercel deploys work with JavaScript and TypeScript stacks for now, so the next step leaves them out.") : "");
  };
  hint = el("div");
  const list = el("div", { class: "choices", role: "radiogroup", "aria-label": "Stack" },
    stacks.map((stack) => choice({
      name: "stack",
      value: stack.id,
      checked: d.stack === stack.id,
      title: stack.label,
      tag: stack.id === recommended ? "Recommended" : null,
      desc: `${stack.languages.join(", ")}. Checks run with ${stack.toolchain === "node" ? "pnpm" : stack.toolchain}.`,
      onChange: (value) => {
        d.stack = value;
        d.modules = defaultModules(d.type, d.stack);
        saveDraft();
        drawHint();
        renderRail();
      },
    })));
  drawHint();
  return step("stack", "Which stack?", `These stacks fit a ${typeOf(d.type)?.label.toLowerCase() ?? "project"}. The first task builds its skeleton and makes every check green.`, [list, hint], foot());
};

SCREENS.modules = () => {
  const d = app.draft;
  const rows = modulesFor(d.type).filter((module) => !(localDraft() && module.id === "hosting")).map((module) => {
    const providers = providersFor(module, d.stack);
    if (!providers.some((provider) => provider.id === d.modules[module.id])) d.modules[module.id] = "none";
    const pills = el("div", { class: "pills", role: "radiogroup", "aria-label": module.label },
      providers.map((provider) => {
        const input = el("input", { type: "radio", name: `module-${module.id}`, value: provider.id, checked: d.modules[module.id] === provider.id });
        input.addEventListener("change", () => {
          if (!input.checked) return;
          d.modules[module.id] = provider.id;
          saveDraft();
          if (module.kinds) render(true);
        });
        return el("label", { class: provider.id === "none" ? "pill pill-none" : "pill" }, input, el("span", { text: provider.label }));
      }));
    return el("div", { class: "module" },
      el("div", {}, el("p", { class: "module-name", text: module.label }), module.consequence ? el("p", { class: "module-note", text: module.consequence }) : null),
      module.kinds && d.modules[module.id] !== "none" ? el("div", {}, pills, mediaKinds(module)) : pills);
  });
  return step("modules", "What does it need?", "Each module is built and wired by its own tasks. Choose None for anything the first version can do without.", [el("div", { class: "modules" }, rows)], foot(), true);
};

// E53a: what a media provider makes. One kind at least; the first is the default.
function mediaKinds(module) {
  const d = app.draft;
  const ids = module.kinds.map((kind) => kind.id);
  if (!Array.isArray(d.media_kinds) || d.media_kinds.length === 0 || d.media_kinds.some((kind) => !ids.includes(kind))) d.media_kinds = [ids[0]];
  return el("div", { class: "media-kinds", role: "group", "aria-label": "Media to generate" },
    module.kinds.map((kind) => {
      const box = el("input", { type: "checkbox", value: kind.id, checked: d.media_kinds.includes(kind.id) });
      box.addEventListener("change", () => {
        const next = ids.filter((id) => (id === kind.id ? box.checked : d.media_kinds.includes(id)));
        if (next.length === 0) {
          box.checked = true;
          return;
        }
        d.media_kinds = next;
        saveDraft();
      });
      return el("label", { class: "check" }, box, el("span", { text: kind.label }));
    }));
}

SCREENS.scope = () => {
  const d = app.draft;
  return step("scope", "How far should the first plan go?", "You can widen the plan later. Starting small keeps every task reviewable.",
    [el("div", { class: "choices", role: "radiogroup", "aria-label": "Scope" },
      choice({ name: "scope", value: "mvp", big: true, checked: d.scope === "mvp", title: "MVP", tag: "Recommended", desc: "The core flow first. Every other feature waits until you ask for it.", onChange: (value) => { d.scope = value; saveDraft(); } }),
      choice({ name: "scope", value: "full", big: true, checked: d.scope === "full", title: "Full product for production", desc: "Every feature in the brief, in phases, then a production-readiness phase.", onChange: (value) => { d.scope = value; saveDraft(); } })),
    ...(mediaModule(d.type) ? [
      el("h2", { class: "section-title", text: "Visual ambition" }),
      el("div", { class: "choices", role: "radiogroup", "aria-label": "Visual ambition" },
        ambitionsList().map((item) => choice({ name: "ambition", value: item.id, checked: d.ambition === item.id, title: item.label, desc: item.line, onChange: (value) => { d.ambition = value; saveDraft(); } }))),
    ] : [])],
    foot());
};

SCREENS.details = () => {
  const f = app.draft.fields;
  let footer;
  const keyHint = el("p", { class: "hint" });
  const whereHint = el("p", { class: "hint" });
  const drawWhere = () => {
    const folder = projectFolder();
    put(whereHint, folder && slugText(f.name) ? ["The project goes in ", el("code", { text: folder }), "."] : "Name the project to see its folder.");
    renderBar();
  };
  const drawKey = () => {
    const name = f.name.trim();
    const key = keyFromName(name);
    keyHint.className = name === "" ? "hint" : (KEY_RE.test(key) ? "hint hint-ok" : "hint hint-bad");
    keyHint.textContent = name === "" ? "The project key is made from the name." : (KEY_RE.test(key) ? `Project key: ${key}` : "Use at least two letters or digits.");
  };
  const bind = (input, field, after) => {
    input.addEventListener("input", () => {
      f[field] = input.value;
      saveDraft();
      after?.();
      footer.refresh();
      renderRailSoon();
    });
    return input;
  };
  const name = bind(el("input", { class: "input", id: "f-name", value: f.name, autocomplete: "off", spellcheck: "false", maxlength: "60", placeholder: "Demo Shop" }), "name", () => { drawKey(); if (choosing()) drawWhere(); });
  const parent = choosing() ? bind(el("input", { class: "input input-mono", id: "f-parent", value: f.parent, autocomplete: "off", spellcheck: "false" }), "parent", drawWhere) : null;
  const brief = bind(el("textarea", { class: "textarea", id: "f-brief", value: f.brief, placeholder: "What it does, for whom, and the one flow that must work." }), "brief");
  const users = bind(el("input", { class: "input", id: "f-users", value: f.users, autocomplete: "off", placeholder: "Small shop owners and their customers" }), "users");
  const languages = bind(el("input", { class: "input", id: "f-lang", value: f.languages, autocomplete: "off", spellcheck: "false", placeholder: "en" }), "languages");
  drawKey();
  if (choosing()) drawWhere();
  footer = foot({ check: () => problems("details") });
  const visibility = el("div", { class: "choices", role: "radiogroup", "aria-label": "Repository visibility" },
    choice({ name: "visibility", value: "private", checked: f.visibility === "private", title: "Private repository", desc: "Only you and the people you invite can see it.", onChange: (value) => { f.visibility = value; saveDraft(); } }),
    choice({ name: "visibility", value: "public", checked: f.visibility === "public", title: "Public repository", desc: "Anyone can see the code. Keys stay secret either way.", onChange: (value) => { f.visibility = value; saveDraft(); } }));
  return step("details", "Tell the agents about it", "Plain words work best. The blueprint agent turns this into phases and tasks.",
    [el("div", { class: "field" }, el("label", { class: "label", for: "f-name", text: "Project name" }), name, keyHint),
      parent ? el("div", { class: "field" }, el("label", { class: "label", for: "f-parent", text: "Projects folder" }), parent, whereHint) : null,
      el("div", { class: "field" }, el("label", { class: "label", for: "f-brief", text: "Brief" }), brief, el("p", { class: "hint", text: "One paragraph is enough." })),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", { class: "label", for: "f-users", text: "Who uses it" }), users),
        el("div", { class: "field" }, el("label", { class: "label", for: "f-lang", text: "Languages" }), languages, el("p", { class: "hint", text: "Codes separated by commas, such as en, fr or pt-BR." }))),
      localDraft() ? null : el("div", { class: "section" }, el("h2", { class: "section-title", text: "Repository" }), visibility)],
    footer);
};

let railTimer = 0;
function renderRailSoon() {
  clearTimeout(railTimer);
  railTimer = setTimeout(renderRail, 150);
}

SCREENS.documents = () => {
  const d = app.draft;
  const listed = prepareFor(d.type);
  // E56 (PR-82): a project with screens also takes images the developer owns (a logo, product or team photos),
  // apart from the design references; both lists count towards the same limits.
  const withOwn = Boolean(mediaModule(d.type));
  const all = () => [...app.files, ...(withOwn ? app.own : [])];
  const zone = (list, errorsKey, opts) => {
    const files = el("div", { class: "files" });
    const errors = el("div");
    let sending = 0;
    const draw = () => {
      put(files, list.map((file, index) => el("div", { class: "file" },
        el("span", { class: "file-name", text: file.name }),
        el("span", { class: "file-size", text: sizeText(file.size) }),
        el("button", { class: "btn btn-quiet", type: "button", "aria-label": `Remove ${file.name}`, onclick: () => { list.splice(index, 1); draw(); } }, "Remove"))));
      put(errors, [
        sending ? el("p", { class: "hint", text: `Sending ${sending} file${sending === 1 ? "" : "s"} to the engine…` }) : null,
        app[errorsKey].length ? notice("bad", "Some files were not added.", app[errorsKey]) : null,
      ].filter(Boolean));
    };
    const input = el("input", { type: "file", multiple: true, accept: opts.accept.join(","), "aria-label": opts.label });
    // E72: the file rules sit behind a disclosure; the drop zone stays short.
    const drop = el("div", { class: "drop" }, el("p", { class: "drop-title", text: opts.title }), input);
    const rules = el("details", { class: "disclose" }, el("summary", { text: opts.rules }), opts.hints.map((hint) => el("p", { class: "hint", text: hint })));
    const take = async (picked) => {
      app[errorsKey] = [];
      for (const file of picked) {
        const kind = kindOf(file.name);
        const total = all().reduce((sum, item) => sum + item.size, 0);
        if (all().length >= ATTACH_MAX) { app[errorsKey].push(`${file.name}: a plan holds at most ${ATTACH_MAX} files.`); continue; }
        if (!kind || !opts.kinds.includes(kind)) { app[errorsKey].push(`${file.name}: ${opts.only}`); continue; }
        if (file.size > LIMITS[kind]) { app[errorsKey].push(`${file.name}: larger than ${LIMITS[kind] / MIB} MB.`); continue; }
        if (total + file.size > TOTAL_LIMIT) { app[errorsKey].push(`${file.name}: the files would add up to more than ${TOTAL_LIMIT / MIB} MB.`); continue; }
        if (/[\\/]|\.\./.test(file.name)) { app[errorsKey].push(`${file.name}: rename the file without slashes or dots in a row.`); continue; }
        if (all().some((item) => item.name === file.name)) { app[errorsKey].push(`${file.name}: already added.`); continue; }
        app.uploading += 1;
        sending += 1;
        draw();
        const sent = await upload(file);
        app.uploading -= 1;
        sending -= 1;
        if (sent) list.push({ name: file.name, size: file.size });
        else app[errorsKey].push(`${file.name}: could not be sent to the engine; try again.`);
        draw();
      }
      draw();
    };
    input.addEventListener("change", () => { take([...input.files]); input.value = ""; });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("is-over"); take([...(event.dataTransfer?.files ?? [])]); });
    draw();
    return el("div", { class: "section" }, opts.heading ? el("h2", { class: "section-title", text: opts.heading }) : null, drop, rules, files, errors);
  };
  const documents = zone(app.files, "fileErrors", {
    accept: ATTACH_EXT,
    kinds: ["text", "pdf", "image"],
    label: "Add documents",
    title: "Drop files here, or choose them",
    rules: "What files work",
    only: "only Markdown, text, CSV, JSON, YAML, PDF, PNG, JPEG, WebP and GIF files are read.",
    hints: [
      `Documents: Markdown, text, CSV, JSON or YAML up to ${LIMITS.text / MIB} MB, PDF up to ${LIMITS.pdf / MIB} MB. Design images at full quality: PNG, JPEG, WebP or GIF up to ${LIMITS.image / MIB} MB each. Up to ${ATTACH_MAX} files, ${TOTAL_LIMIT / MIB} MB in all.`,
      "Name each file for what it holds (brief.md, brand-guide.pdf), and each image for the reference it shows (ref-checkout-stripe.png, flow-sign-up.png): the agents cite them by name.",
    ],
  });
  const own = withOwn ? zone(app.own, "ownErrors", {
    accept: IMAGE_EXT,
    kinds: ["image"],
    label: "Add images you own",
    heading: "Images you own",
    title: "Drop your own images here, or choose them",
    rules: "What images work",
    only: "an image you own is a PNG, JPEG, WebP or GIF file.",
    hints: [
      `A logo, product or team photos: the product shows them as they are, never regenerated. PNG, JPEG, WebP or GIF up to ${LIMITS.image / MIB} MB each, counted with the documents.`,
      "Name each one for what it shows (logo.png, product-front.jpg): the media plan lists it by name.",
    ],
  }) : null;
  return step("documents", "Anything the agents should read?", "Documents make the blueprint closer to what you have in mind. All of them are optional.",
    [listed.length ? el("div", { class: "section" }, el("h2", { class: "section-title", text: `Useful for a ${typeOf(d.type)?.label.toLowerCase()}` }),
      el("div", { class: "prepare" }, listed.map((doc) => el("div", { class: "prepare-item" }, el("p", { class: "prepare-name", text: doc.label }), el("p", { class: "prepare-why", text: doc.why }))))) : null,
    documents,
    own,
    helpBox("Where the files go", [`Files stay on this computer. They are copied into the project folder for the blueprint agent, and removed from the engine’s temporary folder when the run ends. Images are kept as the project’s design references, in docs/design/references/, and are part of the repository: the blueprint draws a direction of the project’s own from them, never a copy.${withOwn ? " Images you own are kept as they are, in docs/design/own/: the media plan lists each one, and the product shows it." : ""}`])],
    foot({ primary: all().length ? "Continue" : "Continue without documents", check: () => (app.uploading > 0 ? ["Wait until every file is sent."] : []) }));
};

function agentText(agent) {
  return agent ? `${agent.model} on ${toolLabel(agent.tool)}` : "None";
}

function planSummary({ editable = false } = {}) {
  const d = app.draft;
  const chosen = modulesFor(d.type)
    .map((module) => [module.label, module.providers.find((provider) => provider.id === d.modules[module.id])])
    .filter(([, provider]) => provider && provider.id !== "none");
  // E72: Change opens the block's step; after it, Continue comes back here (the build's steps go through again).
  const change = { Team: ["reviewers", "blueprint-agent"], Product: ["details", "details"], Build: ["type", ""] };
  const card = (title, rows) => el("section", { class: "sheet-card" },
    el("div", { class: "sheet-head" }, el("h3", { text: title }),
      editable && change[title] ? el("button", { class: "btn btn-quiet btn-small", type: "button", text: "Change", "aria-label": `Change ${title.toLowerCase()}`, onclick: () => { app.returnAfter = change[title][1]; go(change[title][0]); } }) : null),
    el("dl", {}, rows.map(([label, value]) => [el("dt", { text: label }), el("dd", {}, value)])));
  const many = d.pool.length > 1;
  return el("div", { class: "summary" },
    card("Team", [
      ["Reviewer", agentText(d.reviewer)],
      ["Light reviewer", d.light ? agentText(d.light) : "Same as the reviewer"],
      ...d.pool.map((item, index) => [many ? `Builder ${index + 1}` : "Builder",
        `${agentText(item)}${item.effort ? `, ${effortLabel(item.effort).toLowerCase()} effort every task${item.fast === true ? ", fast" : ""}` : ""}${many && item.isDefault ? " (default)" : ""}${item.strengths.length ? `. Good at ${item.strengths.join(", ")}.` : ""}`]),
      ["Picks builders", d.policy === "reviewer-picks" ? "The reviewer" : "Always the default builder"],
      ["Blueprint", `${agentText(d.blueprint)}${d.blueprint?.effort ? `, ${effortLabel(d.blueprint.effort).toLowerCase()} effort` : ""}`],
    ]),
    card("Product", [
      ["Name", d.fields.name.trim()],
      ["Key", keyFromName(d.fields.name)],
      ["Brief", d.fields.brief.trim()],
      ["Users", d.fields.users.trim()],
      ["Languages", parseLanguages(d.fields.languages).join(", ")],
      localDraft() ? ["Development", "Local, on this computer"] : ["Repository", d.fields.visibility === "public" ? "Public" : "Private"],
    ]),
    card("Build", [
      ["Type", typeOf(d.type)?.label ?? d.type],
      ["Stack", stackOf(d.stack)?.label ?? d.stack],
      ["Scope", d.scope === "full" ? "Full product for production" : "MVP"],
      ...(mediaModule(d.type) ? [["Visual ambition", ambitionsList().find((item) => item.id === d.ambition)?.label ?? d.ambition]] : []),
      ...(mediaModule(d.type) && d.modules.media !== "none" ? [["Media to generate", mediaModule(d.type).kinds.filter((kind) => d.media_kinds.includes(kind.id)).map((kind) => kind.label).join(", ")]] : []),
      ["Modules", chosen.length ? el("ul", { class: "dd-list" }, chosen.map(([label, provider]) => el("li", { text: `${label}: ${provider.label}` }))) : "None"],
      ["Documents", app.files.length ? app.files.map((file) => file.name).join(", ") : "None"],
      ...(mediaModule(d.type) && app.own.length ? [["Images you own", app.own.map((file) => file.name).join(", ")]] : []),
    ]));
}

function keyList(keys) {
  if (!keys?.length) return null;
  return el("div", { class: "keys" }, keys.map((key) => el("div", { class: "key-item" },
    el("div", { class: "key-top" },
      el("span", { class: "key-name", text: key.name }),
      key.optional ? el("span", { class: "badge", text: "Optional" }) : el("span", { class: "badge badge-brass", text: "Needed" }),
      key.file ? el("span", { class: "badge", text: "JSON file" }) : null),
    el("p", { class: "key-where" }, richText(key.where)))));
}

SCREENS.review = () => {
  const body = el("div", { class: "section" });
  let footer;
  const draw = () => {
    if (app.reviewing) {
      put(body, el("p", { class: "step-lede", text: "Checking your answers…" }));
    } else if (!app.review) {
      put(body, notice("bad", "The engine did not answer. Check that devos ui is still running in your terminal."));
    } else if (!app.review.ok) {
      put(body, notice("bad", "The engine found answers to fix.", app.review.errors ?? []));
    } else {
      put(body,
        planSummary({ editable: true }),
        app.review.keys?.length ? el("div", { class: "section" },
          el("h2", { class: "section-title", text: "Keys you will paste after approving" }),
          el("p", { class: "section-lede", text: "Get them ready while the blueprint is drafted. Each goes straight to GitHub as a secret." }),
          keyList(app.review.keys)) : null,
        app.error ? notice("bad", app.error) : null);
    }
    footer?.refresh();
  };
  footer = foot({
    primary: app.starting ? "Starting…" : "Start building",
    check: () => (app.reviewing || app.starting || !app.review?.ok ? [" "] : []),
    onPrimary: start,
  });
  if (!app.review && !app.reviewing) {
    app.reviewing = true;
    api("/api/plan", { method: "POST", body: buildPlan() }).then(({ status, data }) => {
      app.reviewing = false;
      app.review = status === 200 && data?.ok ? data : (data && Array.isArray(data.errors) ? { ok: false, errors: data.errors } : null);
      if (status === 409) app.review = { ok: false, errors: ["A run is already active. Reload the page to follow it."] };
      draw();
    });
  }
  draw();
  return step("review", "Check your answers", "Nothing is written until you start. After that, your folder fills in and the engine asks for you again at each gate.", [body], footer, true);
};

async function start() {
  app.starting = true;
  app.error = "";
  render(true);
  const { status } = await api("/api/start", { method: "POST" });
  app.starting = false;
  if (status !== 202) {
    app.error = status === 409 ? "The engine has no checked plan, or a run is already active. Go back one step and return." : "The run did not start. Check the terminal where devos ui runs.";
    app.review = app.review ?? null;
    render(true);
    return;
  }
  app.run = freshRun();
  app.run.started = true;
  app.run.phase = "install";
  saveDraft();
  render(true);
  listen();
}

// ---------- the run ----------

async function listen() {
  if (app.listening) return;
  app.listening = true;
  for (;;) {
    let response = null;
    try {
      response = await fetch("/api/events", { headers: { "X-DEVOS-Token": TOKEN }, cache: "no-store" });
    } catch {
      response = null;
    }
    if (!response || response.status !== 200 || !response.body) {
      await wait(1500);
      continue;
    }
    const keep = { roundAt: app.run.roundAt, phase: app.run.phase === "continue" ? "continue" : "", mode: app.run.mode === "adopt" ? "adopt" : "" };
    app.run = freshRun();
    app.run.started = true;
    app.run.roundAt = keep.roundAt;
    app.run.phase = keep.phase;
    if (keep.mode) app.run.mode = keep.mode;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          try { take(JSON.parse(line.slice(6))); } catch { /* a broken event is skipped */ }
        }
        scheduleRender();
        if (done) break;
      }
    } catch {
      /* the stream dropped; it is opened again below */
    }
    if (app.run.done !== null) {
      app.listening = false;
      app.stopping = false;
      scheduleRender();
      return;
    }
    await wait(1000);
  }
}

function take(event) {
  const run = app.run;
  // The agent's live steps (stream-json): shown on the drafting screen, never an answer or a phase.
  if (event.type === "step" && event.step === "activity") {
    run.now = { kind: event.kind, text: event.text, at: Date.now() };
    run.activity.push(run.now);
    if (run.activity.length > 40) run.activity.shift();
    if (event.kind === "write") for (const [file] of BLUEPRINT_DOCS) if (String(event.text ?? "").includes(file)) (run.wrote ??= new Set()).add(file);
    return;
  }
  if (event.type !== "log") app.sent = false;
  if (event.type === "log") {
    run.logs.push(event.text);
    // E71: an adoption keeps its whole output (a model list is hundreds of lines); a new project keeps the last 500.
    if (run.logs.length > (run.mode === "adopt" ? 5000 : 500)) run.logs.shift();
    return;
  }
  if (event.type === "done") {
    run.done = event.code;
    run.ask = null;
    return;
  }
  if (event.type === "ask") {
    run.ask = event;
    run.asks = (run.asks ?? 0) + 1;
    if (run.mode === "adopt" && typeof event.step === "string") run.at = event.step;
    if (event.kind === "create") app.createInfo = event;
    if (event.kind === "approve") {
      run.round = event.round ?? run.round;
      run.phase = "approve";
    }
    return;
  }
  // E71: where the adoption is, and what that step shows (the keys, the result).
  if (event.type === "step" && event.step === "adopt") {
    run.ask = null;
    run.at = String(event.at ?? "");
    run.adopt = { ...(run.adopt ?? {}), [run.at]: event };
    run.asks = (run.asks ?? 0) + 1;
    return;
  }
  if (event.type === "step") {
    run.ask = null;
    // E72: setup's keys step: every key it asks for, and what the project's host keeps (names only).
    if (event.step === "keys" && Array.isArray(event.keys)) run.keyPlan = { keys: event.keys, host: Array.isArray(event.host) ? event.host : [] };
    if (event.step === "install") run.phase = "install";
    else if (event.step === "blueprint") {
      run.phase = "blueprint";
      run.draftAt = Date.now();
      if (event.round !== run.round || !run.roundAt) run.roundAt = Date.now();
      run.round = event.round ?? run.round;
    } else if (event.step === "approved") {
      run.phase = "setup";
    } else {
      run.phase = "setup";
      if (run.setupNow) run.setupDone.add(run.setupNow);
      run.setupNow = event.step;
    }
  }
}

async function answer(kind, value) {
  app.error = "";
  // E72: which key this answers, saved or skipped, for the keys overview (never the value); undone if refused.
  const keyName = kind === "key" && app.run.ask?.kind === "key" ? String(app.run.ask.name ?? "") : "";
  if (keyName) (app.run.keysGiven ??= {})[keyName] = value === "" ? "skipped" : "saved";
  app.sent = true;
  render(true);
  const { status, data } = await api("/api/answer", { method: "POST", body: { kind, value } });
  value = "";
  if (status === 204) {
    if (kind === "create") app.given.create = app.lastCreate;
    return true;
  }
  if (keyName) delete app.run.keysGiven[keyName];
  app.sent = false;
  app.error = status === 409 ? "The engine is not waiting for this answer any more." : (data?.errors?.[0] ?? "The engine did not take the answer.");
  render(true);
  return false;
}

async function stopRun() {
  if (app.stopping) return;
  app.stopping = true;
  renderBar();
  const { status } = await api("/api/stop", { method: "POST" });
  if (status !== 204) app.stopping = false;
  renderBar();
}

function logPanel(open = false) {
  // E72: a log scrolls, so a keyboard reaches it too.
  const box = el("div", { class: "log", role: "log", "aria-label": "Engine output", tabindex: "0" });
  const fill = () => {
    const lines = app.run.logs.slice(-200);
    if (box.childElementCount === lines.length && box.lastChild?.textContent === lines.at(-1)) return;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    put(box, lines.map((line) => el("div", { class: "log-line", text: line })));
    if (stick) box.scrollTop = box.scrollHeight;
  };
  fill();
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  const details = el("details", { class: "disclose", open }, el("summary", { text: "Engine output" }), box);
  details.fill = fill;
  return details;
}

function phaseList(items) {
  return el("ol", { class: "phase" }, items.map(([label, state]) => el("li", { class: `phase-item ${state ? `is-${state}` : ""}`, text: label })));
}

// The sheet: the project's own architecture, drawn in brass while the model writes.
function blueprintSheet() {
  const d = app.draft;
  const width = 720;
  const height = 440;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Blueprint sheet for ${d.fields.name || "the project"}` });
  let delay = 0;
  const later = (node, step = 90) => { node.style.setProperty("--d", `${delay}ms`); delay += step; return node; };
  const drawn = (node, step) => { node.setAttribute("pathLength", "1"); node.classList.add("draw"); return later(node, step); };
  const shown = (node, step) => { node.classList.add("appear"); return later(node, step); };

  const defs = svg("defs", {},
    svg("linearGradient", { id: "scan-fade", x1: "0", y1: "0", x2: "0", y2: "1" },
      svg("stop", { offset: "0", "stop-color": "#c9a96e", "stop-opacity": "0" }),
      svg("stop", { offset: "0.85", "stop-color": "#c9a96e", "stop-opacity": "0.10" }),
      svg("stop", { offset: "1", "stop-color": "#e2c58d", "stop-opacity": "0.35" })),
    svg("clipPath", { id: "sheet-clip" }, svg("rect", { x: 20, y: 20, width: 680, height: 400 })));
  root.append(defs);
  root.append(drawn(svg("rect", { class: "frame", x: 8, y: 8, width: 704, height: 424 }), 120));
  root.append(drawn(svg("rect", { class: "frame-inner", x: 20, y: 20, width: 680, height: 400 }), 160));
  for (let x = 40; x <= 680; x += 40) root.append(shown(svg("line", { class: "tick", x1: x, y1: 20, x2: x, y2: x % 120 === 0 ? 30 : 25 }), 6));

  const stack = stackOf(d.stack);
  const core = { x: 270, y: 176, w: 180, h: 68 };
  root.append(drawn(svg("rect", { class: "node-core", x: core.x, y: core.y, width: core.w, height: core.h, rx: 3 }), 160));
  root.append(shown(svg("text", { class: "t-label", x: core.x + 14, y: core.y + 22 }, "Application"), 40));
  root.append(shown(svg("text", { class: "t-core", x: core.x + 14, y: core.y + 50 }, (stack?.label ?? d.stack).replace(/\s*\(.*\)$/, "")), 120));

  const chosen = modulesFor(d.type)
    .map((module) => ({ module, provider: module.providers.find((item) => item.id === d.modules[module.id]) }))
    .filter((item) => item.provider && item.provider.id !== "none");
  const left = chosen.filter((_, index) => index % 2 === 0);
  const right = chosen.filter((_, index) => index % 2 === 1);
  const place = (items, side) => items.map((item, index) => {
    const span = side === "left" ? 240 : 200;
    const top = 60;
    const y = items.length === 1 ? 190 : top + (span / Math.max(1, items.length - 1)) * index;
    return { ...item, side, box: { x: side === "left" ? 44 : 496, y: Math.round(y), w: side === "left" ? 168 : 180, h: 46 } };
  });
  const satellites = [...place(left, "left"), ...place(right, "right")];
  satellites.forEach((item, index) => {
    const b = item.box;
    const fromX = item.side === "left" ? b.x + b.w : b.x;
    const fromY = b.y + b.h / 2;
    const toX = item.side === "left" ? core.x : core.x + core.w;
    const slots = satellites.filter((other) => other.side === item.side);
    const slot = slots.indexOf(item);
    const toY = core.y + 14 + ((core.h - 28) / Math.max(1, slots.length - 1)) * (slots.length === 1 ? 0.5 : slot);
    const midX = item.side === "left" ? (fromX + toX) / 2 - 6 + slot * 3 : (fromX + toX) / 2 + 6 - slot * 3;
    root.append(drawn(svg("path", { class: "ink", d: `M${fromX} ${fromY} H${midX} V${Math.round(toY)} H${toX}` }), 70));
    root.append(shown(svg("circle", { class: "ink-fill", cx: toX, cy: Math.round(toY), r: 2.6 }), 20));
    root.append(drawn(svg("rect", { class: "node", x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 }), 60));
    root.append(shown(svg("text", { class: "t-label", x: b.x + 12, y: b.y + 18 }, item.module.label), 20));
    root.append(shown(svg("text", { class: "t-name", x: b.x + 12, y: b.y + 35 }, item.provider.label.length > 24 ? `${item.provider.label.slice(0, 23)}…` : item.provider.label), 60));
    if (index === satellites.length - 1) delay += 100;
  });
  if (satellites.length === 0) {
    root.append(shown(svg("text", { class: "t-label", x: core.x, y: core.y + core.h + 28 }, "No modules yet: the first task builds the skeleton only."), 80));
  }

  const docs = ["docs/PHASES.md", "docs/GLOSSARY.md", "docs/fences/T01.md"];
  root.append(drawn(svg("path", { class: "ink-soft", d: `M${core.x + 30} ${core.y + core.h} V378 H172` }), 60));
  docs.forEach((doc, index) => root.append(shown(svg("text", { class: "t-mono", x: 44, y: 368 + index * 16 }, doc), 110)));

  const tb = { x: 470, y: 336, w: 230, h: 84 };
  root.append(drawn(svg("path", { class: "frame-inner", d: `M${tb.x} ${tb.y + tb.h} V${tb.y} H${tb.x + tb.w} M${tb.x} ${tb.y + 30} H${tb.x + tb.w} M${tb.x + 115} ${tb.y + 30} V${tb.y + tb.h}` }), 120));
  root.append(shown(svg("text", { class: "t-block-strong", x: tb.x + 12, y: tb.y + 20 }, (d.fields.name || "Project").slice(0, 26)), 40));
  root.append(shown(svg("text", { class: "t-block", x: tb.x + 12, y: tb.y + 48 }, "Round"), 20));
  const roundText = shown(svg("text", { class: "t-time", x: tb.x + 12, y: tb.y + 68 }, String(app.run.round || 1)), 20);
  root.append(roundText);
  root.append(shown(svg("text", { class: "t-block", x: tb.x + 127, y: tb.y + 48 }, "Elapsed"), 20));
  const timeText = shown(svg("text", { class: "t-time", x: tb.x + 127, y: tb.y + 68 }, "0:00"), 20);
  root.append(timeText);

  const sweep = svg("g", { "clip-path": "url(#sheet-clip)" }, svg("rect", { class: "scan sweep", x: 20, y: 0, width: 680, height: 40 }));
  root.append(sweep);

  const wrap = el("figure", { class: still ? "sheet is-still" : "sheet" }, root);
  wrap.tick = () => {
    const at = app.run.roundAt || Date.now();
    timeText.textContent = clock(Date.now() - at);
    roundText.textContent = String(app.run.round || 1);
  };
  wrap.tick();
  return wrap;
}

function toolLabel(id) {
  return toolInfo(id).label;
}

SCREENS.drafting = () => {
  const run = app.run;
  const round = run.round || 1;
  const sheet = blueprintSheet();
  const log = logPanel(false);
  const phases = el("div");
  const drawPhases = () => {
    put(phases, phaseList([
      ["Install the method", run.phase === "install" ? "now" : "done"],
      [round > 1 ? `Redraft, round ${round}` : "Draft the documents", run.phase === "blueprint" ? "now" : (run.phase === "install" ? "" : "done")],
      ["Your review", ""],
    ]));
  };
  drawPhases();
  const tool = app.draft.blueprint ? toolLabel(app.draft.blueprint.tool) : "The blueprint agent";
  // E72: the documents the blueprint must write, ticked when the agent's steps name them, and the time so far.
  const docs = el("div");
  const drawDocs = () => {
    const since = run.draftAt ? Math.max(0, Math.round((Date.now() - run.draftAt) / 1000)) : 0;
    put(docs, [phaseList(BLUEPRINT_DOCS.map(([file, label]) => [label, run.wrote?.has(file) ? "done" : ""])),
      mediaModule(app.draft.type) ? el("p", { class: "hint", text: "With screens, also the design system, the UI acceptance rules and the references." }) : null,
      run.draftAt ? el("p", { class: "hint", text: `Drafting for ${clockText(since)}. A first draft usually takes a few minutes.` }) : null]);
  };
  drawDocs();
  const side = el("aside", { class: "side" },
    el("div", { class: "side-block" }, el("h2", { class: "side-title", text: "Progress" }), phases),
    el("div", { class: "side-block" }, el("h2", { class: "side-title", text: "Documents" }), docs),
    app.review?.keys?.length ? el("div", { class: "side-block" }, el("h2", { class: "side-title", text: "While you wait" }),
      el("p", { class: "hint", text: `Get your ${app.review.keys.length === 1 ? "key" : `${app.review.keys.length} keys`} ready. You will paste them after approving.` }),
      el("ul", { class: "repo-list" }, app.review.keys.map((key) => el("li", { text: key.name })))) : null);
  const now = el("div", { class: "agent-now" });
  const drawNow = () => {
    const recent = run.activity.slice(0, -1).slice(-5).reverse();
    const since = run.now ? Math.max(0, Math.round((Date.now() - run.now.at) / 1000)) : 0;
    now.classList.toggle("is-quiet", since >= 120);
    put(now, [
      el("div", { class: "now-head" },
        el("span", { class: "now-pulse", "aria-hidden": "true" }),
        el("span", { class: "now-label", text: run.now ? `${tool} is working` : `Starting ${tool}` }),
        el("span", { class: "now-time", text: run.now ? (since < 5 ? "just now" : `last step ${clockText(since)} ago`) : "" })),
      el("p", { class: "now-text", text: run.now ? run.now.text : "Waiting for the agent’s first step…" }),
      recent.length ? el("ol", { class: "now-list", "aria-label": "Earlier steps" }, recent.map((item) => el("li", { class: `now-item is-${item.kind}`, text: item.text }))) : null]);
  };
  drawNow();
  clearInterval(app.timer);
  app.timer = setInterval(() => { sheet.tick(); drawNow(); drawDocs(); }, 1000);
  app.live = () => { sheet.tick(); log.fill(); drawPhases(); drawNow(); drawDocs(); };
  return step("drafting", round > 1 ? "Redrafting the blueprint" : "Drafting the blueprint",
    round > 1 ? `${tool} is applying your changes. Round ${round}.` : `${tool} is writing the project’s phases, glossary and first task into your folder. This usually takes a few minutes.`,
    [now, el("div", { class: "drafting" }, sheet, side), log],
    el("footer", { class: "step-foot" }, el("p", { class: "foot-note", text: "Stopping keeps everything written so far." }), el("span", { class: "spacer" }),
      el("button", { class: "btn btn-danger", type: "button", onclick: stopRun, text: app.stopping ? "Stopping…" : "Stop run" })),
    true);
};

function describeDoc(file) {
  if (file.startsWith("docs/method/")) return "Method";
  const known = {
    "README.md": "The product's README",
    "docs/PHASES.md": "Phases and tasks",
    "docs/GLOSSARY.md": "Words the project uses",
    "docs/STACK.md": "Stack and versions",
    "docs/OPEN_QUESTIONS.md": "Questions for you",
    "docs/fences/T01.md": "First task: the skeleton",
  };
  if (known[file]) return known[file];
  if (file.startsWith("docs/fences/")) return "Task";
  return "";
}

SCREENS.approve = () => {
  clearInterval(app.timer);
  const ask = app.run.ask ?? { files: [], round: app.run.round };
  const files = ask.files ?? [];
  const own = files.filter((file) => !file.startsWith("docs/method/"));
  const method = files.filter((file) => file.startsWith("docs/method/"));
  let n = 0;
  const row = (file) => {
    n += 1;
    return el("div", { class: "sheet-row" },
      el("span", { class: "sheet-no", text: `S-${String(n).padStart(2, "0")}` }),
      el("span", { class: "sheet-path", text: file }),
      el("span", { class: "sheet-what", text: describeDoc(file) }));
  };
  const sheets = el("div", { class: "sheets" },
    own.length ? [el("p", { class: "sheets-group", text: "Your project" }), own.map(row)] : null,
    method.length ? [el("p", { class: "sheets-group", text: "The method, installed unchanged" }), method.map(row)] : null);
  const changes = el("textarea", { class: "textarea", id: "changes", placeholder: "For example: split phase 2 into two phases, and use English and French." });
  const ask4 = el("button", { class: "btn", type: "button", text: "Ask for changes", disabled: true });
  changes.addEventListener("input", () => { ask4.disabled = changes.value.trim() === ""; });
  ask4.addEventListener("click", () => {
    const text = changes.value.trim();
    if (text === "") return;
    answer("approve", text);
  });
  const approve = el("button", { class: "btn btn-primary", type: "button", text: "Approve blueprint", onclick: () => answer("approve", "approve") });
  if (app.sent) { approve.disabled = true; ask4.disabled = true; approve.textContent = "Sending…"; }
  return step("approve", "Review the blueprint", "The documents are in your project folder. Read them in your editor, then approve them or say what to change.",
    [commandBox(projectFolder()), sheets,
      el("div", { class: "field" }, el("label", { class: "label", for: "changes", text: "What should change?" }), changes, el("p", { class: "hint", text: "The agent redrafts and you review again. Up to five rounds." })),
      app.error ? notice("bad", app.error) : null,
      logPanel(false)],
    el("footer", { class: "step-foot" }, el("span", { class: "foot-note", text: `Round ${ask.round ?? app.run.round ?? 1}` }), el("span", { class: "spacer" }), ask4, approve),
    true);
};

SCREENS.keys = () => {
  clearInterval(app.timer);
  const ask = app.run.ask?.kind === "key" ? app.run.ask : null;
  const log = logPanel(false);
  app.live = () => log.fill();
  if (!ask || app.sent) {
    return step("keys", app.sent ? "Saved" : "Getting GitHub ready", app.sent ? "Waiting for the engine…" : "The engine checks your GitHub sign-in and prepares the setup. Your keys come next.",
      [keyOverview(app.run.keyPlan?.keys, "", app.run.keysGiven) ?? (app.review?.keys?.length ? keyList(app.review.keys) : null), hostList(app.run.keyPlan?.host), log], null);
  }
  const total = ask.total ?? 1;
  const index = ask.index ?? 0;
  const ticks = el("div", { class: "ticks", "aria-hidden": "true" }, Array.from({ length: total }, (_, at) => el("span", { class: at < index ? "is-done" : (at === index ? "is-now" : null) })));
  const err = el("div");
  let field;
  let save;
  const skip = el("button", { class: "btn", type: "button", text: ask.optional ? "Skip" : "Skip for now", onclick: () => answer("key", "") });
  if (ask.file) {
    field = el("input", { class: "input", type: "file", id: "key-input", accept: ".json,application/json" });
    save = el("button", { class: "btn btn-primary", type: "button", text: "Upload key", disabled: true });
    field.addEventListener("change", () => { save.disabled = !field.files?.length; err.replaceChildren(); });
    save.addEventListener("click", async () => {
      const file = field.files?.[0];
      field.value = "";
      save.disabled = true;
      if (!file) return;
      let bytes = new Uint8Array(await file.arrayBuffer());
      try {
        JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        bytes = null;
        put(err, notice("bad", "That file is not JSON. Choose the key file you downloaded."));
        return;
      }
      const encoded = bytesToBase64(bytes);
      bytes = null;
      answer("key", encoded);
    });
  } else {
    field = el("input", { class: "input input-mono", type: "password", id: "key-input", autocomplete: "off", spellcheck: "false", "aria-describedby": "key-trust" });
    save = el("button", { class: "btn btn-primary", type: "button", text: "Save key", disabled: true });
    field.addEventListener("input", () => { save.disabled = field.value.trim() === ""; });
    const send = () => {
      const value = field.value.trim();
      field.value = "";
      save.disabled = true;
      if (value !== "") answer("key", value);
    };
    save.addEventListener("click", send);
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); send(); } });
  }
  queueMicrotask(() => field.focus());
  const vault = el("div", { class: "vault" },
    el("div", { class: "vault-top" }, el("span", { class: "step-count", text: `Key ${index + 1} of ${total}` }), ticks),
    el("div", {}, el("p", { class: "vault-name", text: ask.name }), el("div", { class: "key-top" }, ask.optional ? el("span", { class: "badge", text: "Optional" }) : el("span", { class: "badge badge-brass", text: "Needed for the cycle" }))),
    el("p", { class: "vault-where" }, richText(ask.where ?? "")),
    el("div", { class: "field" }, el("label", { class: "label", for: "key-input", text: ask.file ? "Key file (JSON)" : "Value" }), field,
      ask.file ? el("p", { class: "hint", text: "Choose the JSON file you downloaded. The page reads it and passes its content on; no copy is made." }) : null),
    err,
    app.error ? notice("bad", app.error) : null,
    el("p", { class: "trust", id: "key-trust" }, icon("lock"), el("span", { text: "Sent once to GitHub as a repository secret, over the engine’s standard input. It is not saved, shown, logged or given to any model." })),
    el("div", { class: "vault-actions" }, save, skip));
  return step("keys", "Paste your keys", "Each key becomes a GitHub secret the cycle uses. Skipped keys can be added later in the repository settings.", [vault, keyOverview(app.run.keyPlan?.keys, ask.name, app.run.keysGiven), hostList(app.run.keyPlan?.host), log], null);
};

SCREENS.github = () => {
  clearInterval(app.timer);
  const ask = app.run.ask?.kind === "create" ? app.run.ask : app.createInfo;
  if (!ask) return SCREENS.keys();
  const list = (title, items) => el("div", { class: "repo-list" }, el("h3", { text: title }),
    el("ul", {}, items.length ? items.map((item) => el("li", { text: item })) : el("li", { class: "is-none", text: "None" })));
  const yes = el("button", { class: "btn btn-primary", type: "button", text: app.sent ? "Creating…" : "Create repository", disabled: app.sent, onclick: () => { app.lastCreate = "yes"; answer("create", "yes"); } });
  const no = el("button", { class: "btn", type: "button", text: "Not now", disabled: app.sent, onclick: () => { app.lastCreate = "no"; answer("create", "no"); } });
  // E72: one summary; the names behind disclosures.
  const later = ask.later ?? [];
  const needed = new Set((app.run.keyPlan?.keys ?? []).filter((key) => !key.optional).map((key) => key.name));
  const missing = later.filter((name) => needed.has(name));
  const facts = [
    ["Repository", `${ask.slug}, ${ask.visibility === "public" ? "public: anyone can see the code" : "private: only you and the people you invite"}`],
    ["Keys", `${(ask.upload ?? []).length} to upload as secrets · ${later.length} to set later`],
    ["Settings", `${(ask.variables ?? []).length} variables the cycle reads (names below)`],
  ];
  return step("github", "Create the repository", "The engine creates it, pushes the project, stores your keys as secrets and starts the first cycle.",
    [el("div", { class: "repo" },
      el("div", { class: "key-top" }, el("span", { class: "repo-slug", text: ask.slug }), el("span", { class: "badge", text: ask.visibility === "public" ? "Public" : "Private" })),
      el("dl", { class: "repo-facts" }, facts.map(([label, value]) => [el("dt", { text: label }), el("dd", { text: value })])),
      el("details", { class: "disclose" }, el("summary", { text: "The names" }),
        el("div", { class: "repo-lists" }, list("Variables", ask.variables ?? []), list("Keys to upload", ask.upload ?? []), list("To set later", later)))),
    missing.length ? notice("bad", `The cycle needs ${missing.length === 1 ? "this key" : "these keys"} before it can build. The repository is created anyway; the setup check then stops and names what is missing.`, missing.map((name) => el("code", { text: name }))) : null,
    hostList(app.run.keyPlan?.host),
    notice("info", "Not now keeps everything in your folder. Nothing is created on GitHub, and you can continue later from a terminal."),
    app.error ? notice("bad", app.error) : null],
    el("footer", { class: "step-foot" }, el("span", { class: "spacer" }), no, yes));
};

// E71, E72: every key the cycle needs and where it stands: on GitHub, saved or skipped now, or still to come (names only).
function keyOverview(keys, now = "", given = {}) {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const badge = (key) => {
    if (key.present) return el("span", { class: "badge badge-ok" }, icon("check"), "On GitHub");
    if (given[key.name] === "saved") return el("span", { class: "badge badge-ok" }, icon("check"), "Saved");
    if (given[key.name] === "skipped") return el("span", { class: "badge", text: key.optional ? "Skipped" : "Skipped: set it later" });
    return key.optional ? el("span", { class: "badge", text: "Optional" }) : el("span", { class: "badge badge-brass", text: "Needed" });
  };
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "The cycle's keys" }),
    el("ul", { class: "keyrows" }, keys.map((key, index) => {
      const row = el("li", { class: `keyrow${key.name === now ? " is-now" : ""}` }, el("span", { class: "key-name", text: String(key.name) }), badge(key));
      row.style.setProperty("--i", String(index));
      return row;
    })));
}

// E72: what the project's host keeps (Vercel's Production variables): DEV_OS never reads them, so you set them there.
function hostList(host) {
  if (!Array.isArray(host) || host.length === 0) return null;
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "Set these in Vercel yourself" }),
    el("p", { class: "hint", text: "Vercel → the project → Settings → Environment Variables → Production. Names only: DEV_OS never reads a value. The deploy checks them before it moves." }),
    host.map((item) => el("div", { class: "key-item" },
      el("div", { class: "key-top" }, el("span", { class: "host-title", text: String(item.title ?? "") })),
      el("p", { class: "key-where" }, (item.names ?? []).map((name, index) => [index ? ", " : "", el("code", { text: String(name) })])),
      // The steps are plain text: a placeholder address in a step is never a link.
      Array.isArray(item.steps) && item.steps.length ? el("ol", { class: "key-steps" }, item.steps.map((line) => el("li", { text: plain(line) }))) : null)));
}

function commandBox(text) {
  const button = el("button", { class: "btn btn-quiet", type: "button", text: "Copy" });
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
  });
  return el("div", { class: "command" }, el("code", { text }), button);
}

SCREENS.backup = () => {
  const no = el("button", { class: "btn", type: "button", text: "Not now", disabled: app.sent, onclick: () => answer("backup", "no") });
  const yes = el("button", { class: "btn btn-primary", type: "button", text: "Create a private backup", disabled: app.sent, onclick: () => answer("backup", "yes") });
  return step("backup", "Add a GitHub backup?", "Your project is committed on this computer. A backup copies it to a new private repository on your GitHub account. It holds the project only: nothing runs there.",
    [notice("info", "Not now keeps everything on this computer. SETUP.md §3 has the two commands to add the backup later. A backup needs the GitHub CLI, signed in."),
      app.error ? notice("bad", app.error) : null],
    el("footer", { class: "step-foot" }, el("span", { class: "spacer" }), no, yes));
};

SCREENS.finish = () => {
  clearInterval(app.timer);
  const run = app.run;
  const log = logPanel(run.done !== null && run.done !== 0);
  const command = `devos continue ${quoted(projectFolder())}`;
  if (run.done === null) {
    const stages = el("div");
    const stageRows = localDraft() ? LOCAL_STAGES : SETUP_STAGES;
    const draw = () => {
      put(stages, phaseList(stageRows.map(([id, label]) => [label, run.setupDone.has(id) ? "done" : (run.setupNow === id ? "now" : "")])));
    };
    draw();
    app.live = () => { draw(); log.fill(); };
    if (run.phase === "continue") {
      app.live = () => log.fill();
      return step("finish", "Picking up where it stopped", "The engine checks what is done and continues from the first open step.", [log], null);
    }
    if (localDraft()) return step("finish", "Handing the project over", "Removing DEV_OS's automation, committing the plan, then one optional question.", [stages, log], null);
    return step("finish", "Setting up GitHub", "Creating the repository, uploading your keys and starting the first cycle.", [stages, log], null);
  }
  const created = app.given.create === "yes" || run.setupDone.has("repository") || run.setupNow === "cycle";
  const setUp = run.logs.map((line) => /^devos init: (\S+) is set up/.exec(line)?.[1]).find(Boolean);
  const slug = app.createInfo?.slug ?? setUp ?? "";
  const again = (label) => el("button", { class: "btn btn-primary", type: "button", text: label, onclick: () => resume(choosing() ? projectFolder() : "") });
  // Stopped or failed while the agent was drafting (not at the approval): offer another tool or model.
  const blueprintStage = run.phase === "blueprint";
  const tail = el("div", { class: "vault-actions finish-more" },
    choosing() ? el("button", { class: "btn", type: "button", text: "Start a new project", onclick: newProject }) : null,
    el("button", { class: "btn btn-quiet", type: "button", text: "Close DEV_OS", onclick: closeApp }));
  let mark;
  let title;
  let lede;
  let actions = [];
  let nextSteps = null;
  let alert = null;
  if (localDraft() && run.done === 0) {
    const backed = run.logs.map((line) => /^devos init: backup on GitHub: (\S+) \(/.exec(line)?.[1]).find(Boolean);
    mark = icon("done", "final-mark is-ok");
    title = "Your project is set up on this computer";
    lede = "The plan is yours: build task T01 your own way, from docs/fences/T01.md.";
    actions = backed ? [el("a", { class: "btn btn-primary", href: `https://github.com/${backed}`, target: "_blank", rel: "noreferrer noopener", text: "Open the backup" })] : [];
    actions.push(commandBox(projectFolder()));
    nextSteps = el("div", { class: "section" }, el("h2", { class: "section-title", text: "What happens next" }),
      el("ol", { class: "next" },
        el("li", {}, el("strong", { text: "You build task T01 your own way." }), " Open the project folder and work from the fence docs/fences/T01.md, with the stack's own commands."),
        el("li", {}, el("strong", { text: "You tick each task when it is built." }), " Its Done box in docs/PHASES.md: the plan and the scope in docs/ guide the tasks after T01."),
        el("li", {}, el("strong", { text: "DEV_OS can come back." }), " Run devos adopt in the folder when you want its agents to build the rest.")));
  } else if (run.done === 0 && created && slug) {
    mark = icon("done", "final-mark is-ok");
    title = "Your project is on GitHub";
    lede = el("span", {}, "The first cycle has started on ", el("code", { text: slug }), ".");
    actions = [el("a", { class: "btn btn-primary", href: `https://github.com/${slug}`, target: "_blank", rel: "noreferrer noopener", text: "Open the repository" }),
      el("a", { class: "btn", href: `https://github.com/${slug}/actions`, target: "_blank", rel: "noreferrer noopener", text: "Watch the cycle" })];
    nextSteps = el("div", { class: "section" }, el("h2", { class: "section-title", text: "What happens next" }),
      el("ol", { class: "next" },
        el("li", {}, el("strong", { text: "The builder takes task T01." }), " It creates the skeleton of your stack and makes every check green. It builds no feature yet."),
        el("li", {}, el("strong", { text: "The reviewer checks it." }), " It reads every changed line against the task and passes or fails it."),
        el("li", {}, el("strong", { text: "You merge." }), " Each passing task waits for your merge, and the next task starts after it.")));
    // E72: the optional keys skipped, and what the host keeps.
    const later = app.createInfo?.later ?? [];
    if (later.length || run.keyPlan?.host?.length) {
      nextSteps = el("div", { class: "stack" }, nextSteps,
        later.length ? el("div", { class: "section" }, el("h2", { class: "section-title", text: "Keys to set later" }),
          el("p", { class: "hint", text: "GitHub → the repository → Settings → Secrets and variables → Actions → New repository secret." }),
          el("ul", { class: "repo-list" }, later.map((name) => el("li", { text: name })))) : null,
        hostList(run.keyPlan?.host));
    }
  } else if (run.done !== 0 && run.done !== 130 && run.logs.some((line) => line.startsWith("devos: the cycle still needs settings"))) {
    // E72: the repository is on GitHub, but the setup check found settings missing: no cycle ran.
    const missing = run.logs.filter((line) => line.startsWith("MISSING ")).map((line) => line.slice(8).trim());
    mark = icon("stop", "final-mark is-stop");
    title = "On GitHub, but the cycle needs settings";
    lede = el("span", {}, "The repository ", slug ? el("code", { text: slug }) : null, slug ? " " : "", "is created and pushed. The first cycle starts once these are set; then check again here, or in a terminal:");
    alert = missing.length ? notice("bad", "Still missing", missing) : null;
    actions = [again("Check again"), commandBox(command)];
    nextSteps = el("div", { class: "stack" },
      slug ? el("div", { class: "section" }, el("h2", { class: "section-title", text: "Where to set them" }),
        el("ol", { class: "next" },
          el("li", {}, el("strong", { text: "Keys:" }), " GitHub → ", el("a", { href: `https://github.com/${slug}/settings/secrets/actions`, target: "_blank", rel: "noreferrer noopener", text: "the repository's secrets" }), " → New repository secret."),
          el("li", {}, el("strong", { text: "Variables:" }), " the same page, the Variables tab."))) : null,
      hostList(run.keyPlan?.host));
  } else if (run.done === 0) {
    mark = icon("stop", "final-mark is-stop");
    title = "Stopped before GitHub";
    lede = "Nothing was created on GitHub. Your folder has the approved blueprint. Continue when you are ready, here or in a terminal:";
    actions = [again("Continue to GitHub"), commandBox(command)];
  } else if (run.done === 130) {
    mark = icon("stop", "final-mark is-stop");
    title = "Run stopped";
    lede = "Your folder keeps everything written so far. Pick up where you left off, here or in a terminal:";
    actions = [again("Continue"), commandBox(command)];
    if (blueprintStage) nextSteps = modelChanger();
  } else {
    mark = icon("fail", "final-mark is-bad");
    title = "The run stopped with an error";
    lede = "Fix what the engine reported, then try again, here or in a terminal:";
    const said = [...run.logs].reverse().find((line) => line.startsWith("devos") && !line.includes("fix the cause, then run")) ?? run.logs.at(-1);
    const call = said && said.endsWith(":") ? run.logs[run.logs.lastIndexOf(said) + 1] : null;
    alert = said ? notice("bad", said, call ? [el("code", { text: call.trim() })] : undefined) : null;
    actions = [again("Try again"), commandBox(command)];
    if (blueprintStage) nextSteps = modelChanger();
  }
  return el("section", { class: "step final", "aria-labelledby": "title-finish" },
    mark,
    (() => { const h = head("finish", title, lede, false); h.querySelector("h1").id = "title-finish"; return h; })(),
    alert,
    app.error ? notice("bad", app.error) : null,
    el("div", { class: "vault-actions" }, actions),
    nextSteps,
    tail,
    log);
};

// After a failed or stopped blueprint: run it again on another tool or model.
function modelChanger() {
  const ready = readyTools();
  const value = { ...(app.draft.blueprint ?? defaultBlueprint(app.draft) ?? { tool: ready[0]?.id ?? "", model: "" }) };
  if (!ready.some((tool) => tool.id === value.tool)) {
    value.tool = ready[0]?.id ?? "";
    value.model = firstModel(value.tool);
  }
  const go = el("button", { class: "btn btn-primary", type: "button", text: "Try again with this model" });
  go.addEventListener("click", () => {
    app.draft.blueprint = { ...value };
    saveDraft();
    resume(choosing() ? projectFolder() : "", { tool: value.tool, model: value.model });
  });
  return el("div", { class: "section" },
    el("h2", { class: "section-title", text: "Or change the blueprint agent" }),
    el("p", { class: "hint", text: "The documents written so far stay. The new agent picks up from them." }),
    el("div", { class: "agent" }, agentPicker({ name: "rerun", value, tools: ready, onChange: () => {} })),
    el("div", { class: "vault-actions" }, go));
}

// Back to the first step for another project, keeping the agents chosen.
async function newProject() {
  const keep = app.draft;
  app.draft = defaultDraft();
  for (const key of ["accepted", "reviewer", "light", "pool", "policy", "blueprint"]) {
    if (keep && keep[key] !== undefined) app.draft[key] = keep[key];
  }
  app.files = [];
  app.fileErrors = [];
  app.own = [];
  app.ownErrors = [];
  app.review = null;
  app.continuing = null;
  app.given = { create: null };
  app.createInfo = null;
  app.error = "";
  app.run = freshRun();
  clearInterval(app.timer);
  app.step = "machine";
  saveDraft();
  render(true);
  // The project just run is now a started one: list it.
  const { status, data } = await api("/api/state");
  if (status === 200 && Array.isArray(data?.projects)) {
    app.state.projects = data.projects;
    if (current() === "machine") render(true);
  }
}

async function closeApp() {
  const { status } = await api("/api/quit", { method: "POST" });
  if (status !== 204) {
    app.error = "DEV_OS could not close. Press Ctrl+C in its window.";
    render(true);
    return;
  }
  clearInterval(app.timer);
  document.getElementById("rail").replaceChildren();
  document.getElementById("stage").replaceChildren(el("section", { class: "step final" },
    icon("stop", "final-mark is-stop"),
    el("h1", { class: "step-title", text: "DEV_OS is closed" }),
    el("p", { class: "step-lede", text: "You can close this tab. To start again, open DEV_OS from the engine folder." })));
}

// Continue a started project: `devos continue` under the server, followed like any run.
async function resume(folder, blueprint = null) {
  app.error = "";
  const body = choosing() && folder ? { folder } : {};
  if (blueprint) body.blueprint = blueprint;
  const { status, data } = await api("/api/continue", { method: "POST", body });
  if (status !== 202) {
    app.error = data?.errors?.[0] ?? "The engine could not continue this project.";
    render(true);
    return;
  }
  if (folder) app.continuing = folder;
  const found = await lookUp(folder);
  if (found.ok && found.choices) {
    app.draft = withChoices(app.draft, found.choices, found.folder);
    saveDraft();
  }
  app.given.create = null;
  app.createInfo = null;
  app.stopping = false;
  app.sent = false;
  app.run = freshRun();
  app.run.started = true;
  app.run.phase = "continue";
  render(true);
  listen();
}

// ---------- boot ----------

function fatal(title, lede) {
  const stage = document.getElementById("stage");
  document.getElementById("rail").replaceChildren();
  stage.replaceChildren(el("section", { class: "step final" },
    icon("fail", "final-mark is-bad"),
    el("h1", { class: "step-title", text: title }),
    el("p", { class: "step-lede", text: lede })));
}

async function boot() {
  applyTheme(storageGet(THEME_KEY));
  document.getElementById("theme").addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    storageSet(THEME_KEY, next);
    applyTheme(next);
  });
  document.getElementById("stop").addEventListener("click", stopRun);
  if (!TOKEN) {
    fatal("Open the link from your terminal", "This page needs the link that devos ui printed, which carries a one-time key for this run. Run devos ui again if you closed it.");
    return;
  }
  const { status, data } = await api("/api/state");
  if (status === 401) {
    fatal("This link has expired", "Each devos ui run has its own link. Use the one your terminal printed most recently.");
    return;
  }
  if (status !== 200 || !data) {
    fatal("The engine is not answering", "Check that devos ui is still running in your terminal, then reload this page.");
    return;
  }
  app.state = data;
  const loaded = loadDraft();
  app.draft = loaded.draft;
  app.step = loaded.step;
  if (data.run && data.run !== "idle") {
    app.run.started = true;
    if (data.runKind === "adopt") app.run.mode = "adopt";
    render(true);
    listen();
    return;
  }
  render(true);
}

boot();
