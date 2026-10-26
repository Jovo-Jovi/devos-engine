// DEV_OS guided setup: the page that `devos ui` serves.
// It talks only to its own server: /api/state, /api/plan, /api/start, /api/events, /api/answer and /api/stop.
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
  { id: "finish", group: "github", label: "Finish" },
];
const GROUPS = [["choices", "Your choices"], ["build", "The blueprint"], ["github", "GitHub"]];
const LIVE = new Set(["drafting", "approve", "keys", "github", "finish"]);
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
  for (const part of ICONS[name] ?? []) {
    if (part.startsWith("circle:")) {
      const [, cx, cy, r] = part.split(":");
      node.append(svg("circle", { cx, cy, r }));
    } else {
      node.append(svg("path", { d: part }));
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

// Text with URLs and `code` spans, built as nodes (never as HTML).
function richText(text) {
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
  if (choices.name) d.fields.name = choices.name;
  if (Array.isArray(choices.languages) && choices.languages.length > 0) d.fields.languages = choices.languages.join(", ");
  if (choices.visibility === "private" || choices.visibility === "public") d.fields.visibility = choices.visibility;
  if (agentPair(choices.blueprint)) d.blueprint = agentPair(choices.blueprint);
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

function buildPlan() {
  const d = app.draft;
  return {
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
      })),
      policy: d.policy,
    },
    blueprint: { tool: d.blueprint?.tool ?? "", model: d.blueprint?.model ?? "" },
    project: { type: d.type, stack: d.stack, modules: { ...d.modules }, scope: d.scope },
    fields: {
      name: d.fields.name.trim(),
      brief: d.fields.brief.trim(),
      users: d.fields.users.trim(),
      languages: parseLanguages(d.fields.languages),
      visibility: d.fields.visibility,
    },
    attachments: app.files.map((file) => ({ name: file.name })),
    ...(choosing() ? { folder: projectFolder() } : {}),
  };
}

// ---------- validity per step ----------

function problems(step) {
  const d = app.draft;
  const st = app.state;
  switch (step) {
    case "machine": {
      const out = [];
      if (!st.doctor?.ok) out.push("The engine check failed. Run devos doctor in a terminal to see why.");
      if (!st.choose && !st.empty && !st.started) out.push("This folder is not empty. DEV_OS starts a project in an empty folder.");
      if (readyTools().length === 0) out.push("No AI tool is signed in on this computer. The blueprint needs one.");
      return out;
    }
    case "contract": {
      const out = [];
      if (!d.accepted) out.push("Accept the contract to continue.");
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
  return STEPS.findIndex((step) => step.id === id);
}

function liveScreen() {
  const run = app.run;
  if (run.done !== null) return "finish";
  if (run.ask?.kind === "approve") return "approve";
  if (run.ask?.kind === "key") return "keys";
  if (run.ask?.kind === "create") return "github";
  if (run.phase === "setup") {
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
  const at = stepIndex(app.step);
  const target = STEPS[at + 1];
  if (target && !LIVE.has(target.id)) go(target.id);
}

function back() {
  const at = stepIndex(app.step);
  if (at > 0) go(STEPS[at - 1].id);
}

// ---------- rendering: rail ----------

function renderRail() {
  const rail = document.getElementById("rail");
  const now = current();
  const nowAt = stepIndex(now);
  rail.replaceChildren();

  const mobile = el("div", { class: "rail-mobile" });
  const progress = el("div", { class: "progress", role: "progressbar", "aria-valuemin": "1", "aria-valuemax": String(STEPS.length), "aria-valuenow": String(nowAt + 1), "aria-label": "Setup progress" }, el("span"));
  progress.firstChild.style.setProperty("--p", `${Math.round(((nowAt + 1) / STEPS.length) * 100)}%`);
  mobile.append(
    el("div", { class: "rail-mobile-top" }, el("strong", { text: STEPS[nowAt]?.label ?? "" }), el("span", { text: `Step ${nowAt + 1} of ${STEPS.length}` })),
    progress,
  );
  rail.append(mobile);

  for (const [group, title] of GROUPS) {
    const list = el("ol", { class: "rail-list" });
    for (const step of STEPS.filter((item) => item.group === group)) {
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
      list.append(el("li", {}, button));
    }
    rail.append(el("div", { class: "rail-group" }, el("p", { class: "rail-title", text: title }), list));
  }
  rail.append(titleBlock());
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
  const key = [step, run.ask ? `${run.ask.kind}:${run.ask.name ?? ""}:${run.ask.round ?? ""}:${run.ask.index ?? ""}` : "", step === "drafting" ? run.round : "", run.done ?? "", app.sent ? "sent" : "", step === "finish" ? run.setupNow : "", step === "keys" ? run.setupNow : ""].join("|");
  if (!force && key === app.screenKey && app.live) {
    app.live();
    return;
  }
  const moved = key.split("|")[0] !== app.screenKey.split("|")[0];
  app.screenKey = key;
  app.live = null;
  const stage = document.getElementById("stage");
  const screen = SCREENS[step]?.() ?? el("div");
  stage.replaceChildren(screen);
  if (moved) window.scrollTo({ top: 0 });
}

function renderBar() {
  const where = document.getElementById("where");
  const stop = document.getElementById("stop");
  if (app.state) {
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
    counted ? el("p", { class: "step-count", text: `Step ${at + 1} of ${STEPS.length}` }) : null,
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
    (() => { const h = head(id, title, lede); h.querySelector("h1").id = `title-${id}`; return h; })(),
    el("div", { class: "step-body" }, body),
    footer);
}

// ---------- screens: your choices ----------

const SCREENS = {};

SCREENS.machine = () => {
  const st = app.state;
  const ready = readyTools();
  const tools = el("div", { class: "tools" }, st.tools.map((tool) => {
    const state = readiness(tool.id);
    return el("div", { class: "tool" },
      el("span", { class: `dot ${state === "ready" ? "dot-ready" : (state === "half" ? "dot-half" : "")}`, "aria-hidden": "true" }),
      el("span", { class: "tool-name", text: tool.label }),
      el("span", { class: "tool-state", text: state === "ready" ? "Signed in" : (state === "half" ? "Sign in" : "Not found") }));
  }));
  const rows = [
    checkRow(st.doctor?.ok ? "ok" : "bad", "Engine", st.doctor?.ok ? "Node, git and the GitHub CLI are ready." : "Run devos doctor in a terminal to see what is missing.", st.doctor?.ok ? "Ready" : "Needs attention"),
    st.choose
      ? checkRow("ok", "Project folder", "A new folder, named after your project in step 10.", "New")
      : (st.started
        ? checkRow("ok", "Project folder", el("code", { text: st.folder }), "Started")
        : checkRow(st.empty ? "ok" : "bad", "Project folder", el("code", { text: st.folder }), st.empty ? "Empty" : "Not empty")),
    checkRow(ready.length > 0 ? "ok" : "bad", "AI tools on this computer", ready.length > 0 ? `${ready.map((tool) => tool.label).join(", ")} can write the blueprint here.` : "Sign in to one of these tools in a terminal, then reload this page.", ready.length > 0 ? `${ready.length} signed in` : "None signed in"),
  ];
  const issues = problems("machine");
  if (st.started) {
    const where = el("p", { class: "hint" });
    lookUp("").then((found) => { if (found.ok) put(where, `It picks up at: ${found.step}.`); });
    return step("machine", "Pick up where it stopped", "This folder holds a DEV_OS project that was started here. The engine checks what is done and continues from the first open step.",
      [el("div", { class: "checks" }, rows.slice(0, 2), rows[2], tools), where,
        app.error ? notice("bad", app.error) : null],
      foot({ primary: "Continue this project", onPrimary: () => resume(""), check: () => (st.doctor?.ok ? [] : [issues[0]]), backable: false }));
  }
  const listed = Array.isArray(st.projects) ? st.projects : [];
  const projects = st.choose
    ? el("div", { class: "section" },
      el("h2", { class: "section-title", text: "Or continue a project" }),
      listed.length ? el("div", { class: "keys" }, listed.map((project) => el("div", { class: "key-item project-item" },
        el("div", { class: "key-top" },
          el("span", { class: "project-name", text: project.name }),
          el("span", { class: project.approved ? "badge badge-ok" : "badge", text: project.approved ? "Blueprint approved" : "Blueprint to finish" })),
        project.step ? el("p", { class: "hint", text: `It picks up at: ${project.step}.` }) : null,
        el("div", { class: "project-row" },
          el("code", { class: "project-path", text: project.folder }),
          el("button", { class: "btn btn-quiet", type: "button", text: "Continue", onclick: () => resume(project.folder) }))))) : null,
      folderFinder(),
      app.error ? notice("bad", app.error) : null)
    : null;
  return step("machine", "Let’s set up your project", "DEV_OS turns an empty folder into a GitHub project that AI agents build and review, with you approving each step. First, a quick look at this computer.",
    [el("div", { class: "checks" }, rows.slice(0, 2), rows[2], tools),
      issues.length ? notice("bad", "Fix this before you continue.", issues) : null,
      projects],
    foot({ primary: "Begin", check: () => problems("machine"), backable: false }));
};

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
      el("div", { class: "project-row" },
        el("code", { class: "project-path", text: got.folder }),
        el("button", { class: "btn btn-quiet", type: "button", text: "Continue", onclick: () => resume(got.folder) }))));
  };
  find.addEventListener("click", search);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); search(); } });
  return el("div", { class: "field" },
    el("label", { class: "label", for: "resume-folder", text: "A project in another folder" }),
    el("div", { class: "finder" }, input, find),
    el("p", { class: "hint", text: "Paste the project folder’s full path. DEV_OS reads where it stopped and picks up from there." }),
    found);
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
      choice({ name: "link", value: "yes", checked: d.link === true, title: "Yes, link it", desc: "After its operator approves, each step of the cycle sends one event.", onChange: pickLink }),
      choice({ name: "link", value: "no", checked: d.link === false, title: "No, keep it standalone", desc: "Nothing is ever sent.", onChange: pickLink })));
  footer = foot({ primary: "Accept and continue", check: () => problems("contract") });
  return step("contract", "Read the contract", `Version ${app.state.contractVersion}. It says what the engine is, what the private Control Tower is, what an optional link sends, and what is never sent.`,
    [markdownDoc(app.state.contract), el("label", { class: "check" }, box, el("span", { text: "I have read the contract and I accept it." })), link],
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
      lightWrap)],
    foot());
};

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
  return step("builders", "Who builds it?", "Builders write the code for each task on GitHub. Add a few if you have them, and mark what each is good at.", [list, policy], footer);
};

SCREENS["blueprint-agent"] = () => {
  const d = app.draft;
  const ready = readyTools();
  if (!d.blueprint) d.blueprint = defaultBlueprint(d);
  let footer;
  const body = d.blueprint
    ? [el("div", { class: "agent" },
        el("div", { class: "agent-head" }, el("span", { class: "agent-role", text: "Blueprint agent" }), el("span", { class: "agent-what", text: "Runs on this computer" })),
        agentPicker({ name: "blueprint", value: d.blueprint, tools: ready, onChange: () => { saveDraft(); footer?.refresh(); } })),
      notice("info", "It writes the phases, the glossary and the first task into your folder. You read them and approve them before anything reaches GitHub.")]
    : [notice("bad", "No AI tool is signed in on this computer. Sign in to one in a terminal, then reload this page.")];
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
  const rows = modulesFor(d.type).map((module) => {
    const providers = providersFor(module, d.stack);
    if (!providers.some((provider) => provider.id === d.modules[module.id])) d.modules[module.id] = "none";
    const pills = el("div", { class: "pills", role: "radiogroup", "aria-label": module.label },
      providers.map((provider) => {
        const input = el("input", { type: "radio", name: `module-${module.id}`, value: provider.id, checked: d.modules[module.id] === provider.id });
        input.addEventListener("change", () => {
          if (!input.checked) return;
          d.modules[module.id] = provider.id;
          saveDraft();
        });
        return el("label", { class: provider.id === "none" ? "pill pill-none" : "pill" }, input, el("span", { text: provider.label }));
      }));
    return el("div", { class: "module" },
      el("div", {}, el("p", { class: "module-name", text: module.label }), module.consequence ? el("p", { class: "module-note", text: module.consequence }) : null),
      pills);
  });
  return step("modules", "What does it need?", "Each module is built and wired by its own tasks. Choose None for anything the first version can do without.", [el("div", { class: "modules" }, rows)], foot(), true);
};

SCREENS.scope = () => {
  const d = app.draft;
  return step("scope", "How far should the first plan go?", "You can widen the plan later. Starting small keeps every task reviewable.",
    [el("div", { class: "choices", role: "radiogroup", "aria-label": "Scope" },
      choice({ name: "scope", value: "mvp", big: true, checked: d.scope === "mvp", title: "MVP", tag: "Recommended", desc: "The core flow first. Every other feature waits until you ask for it.", onChange: (value) => { d.scope = value; saveDraft(); } }),
      choice({ name: "scope", value: "full", big: true, checked: d.scope === "full", title: "Full product for production", desc: "Every feature in the brief, in phases, then a production-readiness phase.", onChange: (value) => { d.scope = value; saveDraft(); } }))],
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
      el("div", { class: "section" }, el("h2", { class: "section-title", text: "Repository" }), visibility)],
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
  const files = el("div", { class: "files" });
  const errors = el("div");
  const drawFiles = () => {
    put(files, app.files.map((file, index) => el("div", { class: "file" },
      el("span", { class: "file-name", text: file.name }),
      el("span", { class: "file-size", text: sizeText(file.size) }),
      el("button", { class: "btn btn-quiet", type: "button", "aria-label": `Remove ${file.name}`, onclick: () => { app.files.splice(index, 1); drawFiles(); } }, "Remove"))));
    put(errors, [
      app.uploading ? el("p", { class: "hint", text: `Sending ${app.uploading} file${app.uploading === 1 ? "" : "s"} to the engine…` }) : null,
      app.fileErrors.length ? notice("bad", "Some files were not added.", app.fileErrors) : null,
    ].filter(Boolean));
  };
  const input = el("input", { type: "file", multiple: true, accept: ATTACH_EXT.join(","), "aria-label": "Add documents" });
  const drop = el("div", { class: "drop" },
    el("p", { class: "drop-title", text: "Drop files here, or choose them" }),
    el("p", { class: "hint", text: `Documents: Markdown, text, CSV, JSON or YAML up to ${LIMITS.text / MIB} MB, PDF up to ${LIMITS.pdf / MIB} MB. Design images at full quality: PNG, JPEG, WebP or GIF up to ${LIMITS.image / MIB} MB each. Up to ${ATTACH_MAX} files, ${TOTAL_LIMIT / MIB} MB in all.` }),
    el("p", { class: "hint", text: "Name each file for what it holds (brief.md, brand-guide.pdf), and each image for the reference it shows (ref-checkout-stripe.png, logo.png, flow-sign-up.png): the agents cite them by name." }),
    input);
  const take = async (list) => {
    app.fileErrors = [];
    for (const file of list) {
      const kind = kindOf(file.name);
      const total = app.files.reduce((sum, item) => sum + item.size, 0);
      if (app.files.length >= ATTACH_MAX) { app.fileErrors.push(`${file.name}: a plan holds at most ${ATTACH_MAX} files.`); continue; }
      if (!kind) { app.fileErrors.push(`${file.name}: only Markdown, text, CSV, JSON, YAML, PDF, PNG, JPEG, WebP and GIF files are read.`); continue; }
      if (file.size > LIMITS[kind]) { app.fileErrors.push(`${file.name}: larger than ${LIMITS[kind] / MIB} MB.`); continue; }
      if (total + file.size > TOTAL_LIMIT) { app.fileErrors.push(`${file.name}: the files would add up to more than ${TOTAL_LIMIT / MIB} MB.`); continue; }
      if (/[\\/]|\.\./.test(file.name)) { app.fileErrors.push(`${file.name}: rename the file without slashes or dots in a row.`); continue; }
      if (app.files.some((item) => item.name === file.name)) { app.fileErrors.push(`${file.name}: already added.`); continue; }
      app.uploading += 1;
      drawFiles();
      const sent = await upload(file);
      app.uploading -= 1;
      if (sent) app.files.push({ name: file.name, size: file.size });
      else app.fileErrors.push(`${file.name}: could not be sent to the engine; try again.`);
      drawFiles();
    }
  };
  input.addEventListener("change", () => { take([...input.files]); input.value = ""; });
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("is-over"); take([...(event.dataTransfer?.files ?? [])]); });
  drawFiles();
  return step("documents", "Anything the agents should read?", "Documents make the blueprint closer to what you have in mind. All of them are optional.",
    [listed.length ? el("div", { class: "section" }, el("h2", { class: "section-title", text: `Useful for a ${typeOf(d.type)?.label.toLowerCase()}` }),
      el("div", { class: "prepare" }, listed.map((doc) => el("div", { class: "prepare-item" }, el("p", { class: "prepare-name", text: doc.label }), el("p", { class: "prepare-why", text: doc.why }))))) : null,
    el("div", { class: "section" }, drop, files, errors),
    notice("info", "Files stay on this computer. They are copied into the project folder for the blueprint agent, and removed from the engine’s temporary folder when the run ends. Images are kept as the project’s design references, in docs/design/references/, and are part of the repository: the blueprint draws a direction of the project’s own from them, never a copy.")],
    foot({ primary: app.files.length ? "Continue" : "Continue without documents", check: () => (app.uploading > 0 ? ["Wait until every file is sent."] : []) }));
};

function agentText(agent) {
  return agent ? `${agent.model} on ${toolLabel(agent.tool)}` : "None";
}

function planSummary() {
  const d = app.draft;
  const chosen = modulesFor(d.type)
    .map((module) => [module.label, module.providers.find((provider) => provider.id === d.modules[module.id])])
    .filter(([, provider]) => provider && provider.id !== "none");
  const card = (title, rows) => el("section", { class: "sheet-card" }, el("h3", { text: title }),
    el("dl", {}, rows.map(([label, value]) => [el("dt", { text: label }), el("dd", {}, value)])));
  const many = d.pool.length > 1;
  return el("div", { class: "summary" },
    card("Team", [
      ["Reviewer", agentText(d.reviewer)],
      ["Light reviewer", d.light ? agentText(d.light) : "Same as the reviewer"],
      ...d.pool.map((item, index) => [many ? `Builder ${index + 1}` : "Builder",
        `${agentText(item)}${many && item.isDefault ? " (default)" : ""}${item.strengths.length ? `. Good at ${item.strengths.join(", ")}.` : ""}`]),
      ["Picks builders", d.policy === "reviewer-picks" ? "The reviewer" : "Always the default builder"],
      ["Blueprint", agentText(d.blueprint)],
    ]),
    card("Product", [
      ["Name", d.fields.name.trim()],
      ["Key", keyFromName(d.fields.name)],
      ["Brief", d.fields.brief.trim()],
      ["Users", d.fields.users.trim()],
      ["Languages", parseLanguages(d.fields.languages).join(", ")],
      ["Repository", d.fields.visibility === "public" ? "Public" : "Private"],
    ]),
    card("Build", [
      ["Type", typeOf(d.type)?.label ?? d.type],
      ["Stack", stackOf(d.stack)?.label ?? d.stack],
      ["Scope", d.scope === "full" ? "Full product for production" : "MVP"],
      ["Modules", chosen.length ? el("ul", { class: "dd-list" }, chosen.map(([label, provider]) => el("li", { text: `${label}: ${provider.label}` }))) : "None"],
      ["Documents", app.files.length ? app.files.map((file) => file.name).join(", ") : "None"],
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
        planSummary(),
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
    const keep = { roundAt: app.run.roundAt, phase: app.run.phase === "continue" ? "continue" : "" };
    app.run = freshRun();
    app.run.started = true;
    app.run.roundAt = keep.roundAt;
    app.run.phase = keep.phase;
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
    return;
  }
  if (event.type !== "log") app.sent = false;
  if (event.type === "log") {
    run.logs.push(event.text);
    if (run.logs.length > 500) run.logs.shift();
    return;
  }
  if (event.type === "done") {
    run.done = event.code;
    run.ask = null;
    return;
  }
  if (event.type === "ask") {
    run.ask = event;
    if (event.kind === "create") app.createInfo = event;
    if (event.kind === "approve") {
      run.round = event.round ?? run.round;
      run.phase = "approve";
    }
    return;
  }
  if (event.type === "step") {
    run.ask = null;
    if (event.step === "install") run.phase = "install";
    else if (event.step === "blueprint") {
      run.phase = "blueprint";
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
  app.sent = true;
  render(true);
  const { status, data } = await api("/api/answer", { method: "POST", body: { kind, value } });
  value = "";
  if (status === 204) {
    if (kind === "create") app.given.create = app.lastCreate;
    return true;
  }
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
  const box = el("div", { class: "log", role: "log", "aria-label": "Engine output" });
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
  const side = el("aside", { class: "side" },
    el("div", { class: "side-block" }, el("h2", { class: "side-title", text: "Progress" }), phases),
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
  app.timer = setInterval(() => { sheet.tick(); drawNow(); }, 1000);
  app.live = () => { sheet.tick(); log.fill(); drawPhases(); drawNow(); };
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
      [app.review?.keys?.length ? keyList(app.review.keys) : null, log], null);
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
  return step("keys", "Paste your keys", "Each key becomes a GitHub secret the cycle uses. Skipped keys can be added later in the repository settings.", [vault, log], null);
};

SCREENS.github = () => {
  clearInterval(app.timer);
  const ask = app.run.ask?.kind === "create" ? app.run.ask : app.createInfo;
  if (!ask) return SCREENS.keys();
  const list = (title, items) => el("div", { class: "repo-list" }, el("h3", { text: title }),
    el("ul", {}, items.length ? items.map((item) => el("li", { text: item })) : el("li", { class: "is-none", text: "None" })));
  const yes = el("button", { class: "btn btn-primary", type: "button", text: app.sent ? "Creating…" : "Create repository", disabled: app.sent, onclick: () => { app.lastCreate = "yes"; answer("create", "yes"); } });
  const no = el("button", { class: "btn", type: "button", text: "Not now", disabled: app.sent, onclick: () => { app.lastCreate = "no"; answer("create", "no"); } });
  return step("github", "Create the repository", "The engine creates it, pushes the project, stores your keys as secrets and starts the first cycle.",
    [el("div", { class: "repo" },
      el("div", { class: "key-top" }, el("span", { class: "repo-slug", text: ask.slug }), el("span", { class: "badge", text: ask.visibility === "public" ? "Public" : "Private" })),
      el("div", { class: "repo-lists" }, list("Variables", ask.variables ?? []), list("Keys to upload", ask.upload ?? []), list("To set later", ask.later ?? []))),
    notice("info", "Not now keeps everything in your folder. Nothing is created on GitHub, and you can continue later from a terminal."),
    app.error ? notice("bad", app.error) : null],
    el("footer", { class: "step-foot" }, el("span", { class: "spacer" }), no, yes));
};

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

SCREENS.finish = () => {
  clearInterval(app.timer);
  const run = app.run;
  const log = logPanel(run.done !== null && run.done !== 0);
  const command = `devos continue ${quoted(projectFolder())}`;
  if (run.done === null) {
    const stages = el("div");
    const draw = () => {
      put(stages, phaseList(SETUP_STAGES.map(([id, label]) => [label, run.setupDone.has(id) ? "done" : (run.setupNow === id ? "now" : "")])));
    };
    draw();
    app.live = () => { draw(); log.fill(); };
    if (run.phase === "continue") {
      app.live = () => log.fill();
      return step("finish", "Picking up where it stopped", "The engine checks what is done and continues from the first open step.", [log], null);
    }
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
  if (run.done === 0 && created && slug) {
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
    render(true);
    listen();
    return;
  }
  render(true);
}

boot();
