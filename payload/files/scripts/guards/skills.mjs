// guard:skills — the skills the agents read are pinned, licensed for their use, reviewed for trust, mapped to
// their layers, roles, priorities and conditions, and unchanged (docs/method/DESIGN_METHOD.md §7, PR-51, PR-55,
// PR-56). Reads devos/skills/manifest.json (the engine's) and, when the project added skills of its own,
// devos/skills/local.json (the same format). devos/skills/INDEX.md must be the one scripts/devos/skills.mjs generates
// from manifest.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exists, read, result, walk, P } from "./lib.mjs";
import { CONDITION_KEYS, PRIORITIES, renderIndex } from "../devos/skills.mjs";

const DIR = "devos/skills";
const MANIFESTS = [`${DIR}/manifest.json`, `${DIR}/local.json`];
const OWN = new Set(["README.md", "INDEX.md", "manifest.json", "local.json"]);
const CLASSES = new Set(["free", "conditions", "approval", "unsuitable"]);
const DELIVERY = new Set(["vendored", "external", "principles"]);
const ROLES = new Set(["blueprint", "builder", "reviewer"]);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sha256(rel) {
  const bytes = Buffer.from(readFileSync(P(rel)).toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  return createHash("sha256").update(bytes).digest("hex");
}

const filled = (value) => typeof value === "string" && value.trim() !== "";

/** Findings for a conditional read's `if` (PR-56): clauses of topics, modules and deep. */
function checkIf(read, where, topics) {
  const findings = [];
  const priority = read?.priority ?? "recommended";
  if (!PRIORITIES.includes(priority)) findings.push(`${where}: priority must be one of ${PRIORITIES.join(", ")}`);
  if (priority !== "conditional") {
    if (read?.if !== undefined) findings.push(`${where}: only a conditional read has if`);
    return findings;
  }
  const clauses = Array.isArray(read?.if) ? read.if : [];
  if (clauses.length === 0) findings.push(`${where}: a conditional read needs if, a list of clauses`);
  for (const clause of clauses) {
    const keys = clause && typeof clause === "object" ? Object.keys(clause) : [];
    if (keys.length === 0 || !keys.every((key) => CONDITION_KEYS.includes(key))) {
      findings.push(`${where}: each clause of if uses ${CONDITION_KEYS.join(", ")}`);
      continue;
    }
    if (keys.includes("topics") && (!Array.isArray(clause.topics) || clause.topics.length === 0 || !clause.topics.every((topic) => topics.has(topic)))) {
      findings.push(`${where}: topics must be some of the manifest's topics`);
    }
    if (keys.includes("modules") && (!Array.isArray(clause.modules) || clause.modules.length === 0 || !clause.modules.every(filled))) {
      findings.push(`${where}: modules must list module names`);
    }
    if (keys.includes("deep") && clause.deep !== true) findings.push(`${where}: deep must be true`);
  }
  return findings;
}

/** Findings for one entry's layers, stacks, modules, notes, trust and reads (PR-55, PR-56). */
function checkMapping(entry, name, known, paths, roles, topics, files) {
  const findings = [];
  const layers = Array.isArray(entry?.layers) ? entry.layers : [];
  if (layers.length === 0 || !layers.every((layer) => known.has(layer))) findings.push(`${name}: layers must be some of ${[...known].join(", ")}`);
  if (entry?.delivery !== "vendored") return findings;
  const stacks = Array.isArray(entry.stacks) ? entry.stacks : [];
  if (stacks.length === 0 || !stacks.every(filled)) findings.push(`${name}: stacks must list any, stack ids or toolchains`);
  if (entry.modules !== undefined && (!Array.isArray(entry.modules) || entry.modules.length === 0 || !entry.modules.every(filled))) {
    findings.push(`${name}: modules must list module names`);
  }
  if (entry.notes !== undefined && !files.some((file) => file?.path === entry.notes && file?.origin === "devos")) {
    findings.push(`${name}: notes must be one of its files, written by DEV_OS (origin devos)`);
  }
  const trust = entry.trust ?? {};
  if (trust.runs_code !== false) findings.push(`${name}: trust.runs_code must be false (the cycle runs no code from a skill)`);
  if (trust.fetches !== false) findings.push(`${name}: trust.fetches must be false (nothing is fetched at run time)`);
  if (!DATE.test(trust.reviewed ?? "")) findings.push(`${name}: trust.reviewed must be the date its files were read (YYYY-MM-DD)`);
  const reads = Array.isArray(entry.reads) ? entry.reads : [];
  if (reads.length === 0) findings.push(`${name}: reads must say which role reads which file, for which layers`);
  for (const item of reads) {
    const where = `${name}: reads ${item?.file ?? "(no file)"}`;
    if (!paths.has(item?.file)) findings.push(`${where}: not one of its files`);
    const itemRoles = Array.isArray(item?.roles) ? item.roles : [];
    if (itemRoles.length === 0 || !itemRoles.every((role) => roles.includes(role))) findings.push(`${where}: roles must be some of the entry's roles`);
    const itemLayers = Array.isArray(item?.layers) ? item.layers : [];
    if (itemLayers.length === 0 || !itemLayers.every((layer) => layers.includes(layer))) findings.push(`${where}: layers must be some of the entry's layers`);
    if (!filled(item?.when)) findings.push(`${where}: no when`);
    findings.push(...checkIf(item, where, topics));
  }
  return findings;
}

/** Findings for one entry; `listed` collects the files it ships. */
function checkEntry(entry, where, listed, known, topics) {
  const findings = [];
  const id = entry?.id;
  const name = `${where} ${filled(id) ? id : "(no id)"}`;
  if (!filled(id) || !ID.test(id)) findings.push(`${name}: id must match ${ID}`);
  if (!filled(entry?.source?.repo)) findings.push(`${name}: no source.repo`);
  const licence = entry?.licence ?? {};
  if (!filled(licence.spdx)) findings.push(`${name}: no licence.spdx (write "unknown" when the licence is unclear)`);
  if (!CLASSES.has(licence.class)) findings.push(`${name}: licence.class must be one of ${[...CLASSES].join(", ")}`);
  if (!DELIVERY.has(entry?.delivery)) findings.push(`${name}: delivery must be one of ${[...DELIVERY].join(", ")}`);
  const files = Array.isArray(entry?.files) ? entry.files : [];
  findings.push(...checkMapping(entry, name, known, new Set(files.map((file) => file?.path)), Array.isArray(entry?.roles) ? entry.roles : [], topics, files));
  if (entry?.delivery !== "vendored") {
    if (files.length > 0) findings.push(`${name}: only a vendored entry ships files`);
    if (!filled(entry?.reason)) findings.push(`${name}: no reason for not shipping it`);
    return findings;
  }
  if (licence.class === "unsuitable") findings.push(`${name}: an unsuitable licence is never vendored`);
  if (licence.class === "approval") {
    const approval = entry.approval ?? {};
    if (!filled(approval.by) || !filled(approval.date) || !filled(approval.reference)) {
      findings.push(`${name}: vendored under an approval-only licence without approval.by, approval.date and approval.reference`);
    }
  }
  if (!COMMIT.test(entry?.source?.commit ?? "")) findings.push(`${name}: source.commit must be a full 40-character commit`);
  if (!Array.isArray(entry.obligations) || entry.obligations.length === 0 || !entry.obligations.every(filled)) {
    findings.push(`${name}: obligations must list how each licence condition is met`);
  }
  const roles = Array.isArray(entry.roles) ? entry.roles : [];
  if (roles.length === 0 || !roles.every((role) => ROLES.has(role))) findings.push(`${name}: roles must be some of ${[...ROLES].join(", ")}`);
  if (files.length === 0) findings.push(`${name}: a vendored entry lists its files`);
  const paths = new Set(files.map((file) => file?.path));
  if (!filled(licence.file) || !paths.has(licence.file)) findings.push(`${name}: licence.file must be one of its files`);
  for (const notice of Array.isArray(licence.notices) ? licence.notices : []) {
    if (!paths.has(notice)) findings.push(`${name}: notice ${notice} must be one of its files`);
  }
  for (const file of files) {
    if (!filled(file?.path) || file.path.includes("..") || file.path.startsWith("/")) {
      findings.push(`${name}: bad file path ${JSON.stringify(file?.path)}`);
      continue;
    }
    if (!["source", "devos"].includes(file.origin)) findings.push(`${name}: ${file.path}: origin must be source or devos`);
    if (file.origin === "source" && !filled(file.from)) findings.push(`${name}: ${file.path}: no from (its path in the source)`);
    const rel = `${DIR}/${id}/${file.path}`;
    listed.add(rel);
    if (!exists(rel)) findings.push(`${rel} is listed but missing`);
    else if (sha256(rel) !== file.sha256) findings.push(`${rel} differs from its pinned copy (sha256)`);
  }
  return findings;
}

export default function skills() {
  if (!exists(`${DIR}/manifest.json`)) return result("N/A", [], "no devos/skills/manifest.json");
  const findings = [];
  const listed = new Set();
  const ids = new Set();
  let count = 0;
  let vendored = 0;
  let engine = null;
  try {
    engine = JSON.parse(read(`${DIR}/manifest.json`));
  } catch {
    engine = null;
  }
  const known = new Set(Object.keys(engine?.layers ?? {}));
  if (engine && known.size === 0) findings.push(`${DIR}/manifest.json: no layers vocabulary`);
  const topics = new Set(Object.keys(engine?.topics ?? {}));
  for (const [topic, spec] of Object.entries(engine?.topics ?? {})) {
    if (!filled(spec?.covers)) findings.push(`${DIR}/manifest.json: topic ${topic}: no covers`);
    try {
      new RegExp(spec?.match, "i");
      if (!filled(spec?.match)) throw new Error("empty");
    } catch {
      findings.push(`${DIR}/manifest.json: topic ${topic}: match must be a regular expression`);
    }
  }
  for (const rel of MANIFESTS) {
    if (!exists(rel)) continue;
    let parsed;
    try {
      parsed = JSON.parse(read(rel));
    } catch (error) {
      findings.push(`${rel}: not JSON (${error.message})`);
      continue;
    }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : null;
    if (!entries) {
      findings.push(`${rel}: no entries array`);
      continue;
    }
    for (const entry of entries) {
      count += 1;
      if (entry?.delivery === "vendored") vendored += 1;
      if (ids.has(entry?.id)) findings.push(`${rel}: id ${entry.id} is used twice`);
      ids.add(entry?.id);
      findings.push(...checkEntry(entry, rel, listed, known, topics));
    }
  }
  if (engine) {
    const index = exists(`${DIR}/INDEX.md`) ? read(`${DIR}/INDEX.md`).replaceAll("\r\n", "\n") : "";
    if (index !== renderIndex(engine)) findings.push(`${DIR}/INDEX.md is out of date: run node scripts/devos/skills.mjs index`);
  }
  for (const rel of walk(DIR)) {
    if (OWN.has(rel.slice(DIR.length + 1))) continue;
    if (!listed.has(rel)) findings.push(`${rel} is not listed in a skills manifest`);
  }
  if (findings.length > 0) return result("FAIL", findings);
  return result("PASS", [], `${count} skills checked, ${vendored} vendored`);
}
