// guard:skills — the design skills the agents read are pinned, licensed for their use and unchanged
// (docs/method/DESIGN_METHOD.md §7, PR-51). Reads devos/skills/manifest.json (the engine's) and, when the
// project added skills of its own, devos/skills/local.json (the same format).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { exists, read, result, walk, P } from "./lib.mjs";

const DIR = "devos/skills";
const MANIFESTS = [`${DIR}/manifest.json`, `${DIR}/local.json`];
const OWN = new Set(["README.md", "manifest.json", "local.json"]);
const CLASSES = new Set(["free", "conditions", "approval", "unsuitable"]);
const DELIVERY = new Set(["vendored", "external", "principles"]);
const ROLES = new Set(["blueprint", "builder", "reviewer"]);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;

function sha256(rel) {
  const bytes = Buffer.from(readFileSync(P(rel)).toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  return createHash("sha256").update(bytes).digest("hex");
}

const filled = (value) => typeof value === "string" && value.trim() !== "";

/** Findings for one entry; `listed` collects the files it ships. */
function checkEntry(entry, where, listed) {
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
      findings.push(...checkEntry(entry, rel, listed));
    }
  }
  for (const rel of walk(DIR)) {
    if (OWN.has(rel.slice(DIR.length + 1))) continue;
    if (!listed.has(rel)) findings.push(`${rel} is not listed in a skills manifest`);
  }
  if (findings.length > 0) return result("FAIL", findings);
  return result("PASS", [], `${count} skills checked, ${vendored} vendored`);
}
