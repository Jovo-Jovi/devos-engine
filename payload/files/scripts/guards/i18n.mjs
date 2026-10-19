// guard:i18n — every catalogue exists with identical keys and no empty values; no hardcoded lang (I18N_MODEL §3).
import { existsSync, readFileSync } from "node:fs";
import { read, exists, hasSrc, srcFiles, scan, result } from "./lib.mjs";
import { P } from "../devos/lib.mjs";

function catalogues() {
  const file = existsSync(P("devos.config.json")) ? "devos.config.json" : "devos/engine.defaults.json";
  let cur = JSON.parse(readFileSync(P(file), "utf8"));
  for (const key of ["guards", "i18n", "catalogues"]) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, key)) throw new Error(`config: guards.i18n.catalogues missing`);
    cur = cur[key];
  }
  if (cur === null || typeof cur !== "object" || Array.isArray(cur)) throw new Error("config: guards.i18n.catalogues missing");
  return cur;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export default function i18n() {
  if (!hasSrc()) return result("N/A", [], "src/ does not exist yet");
  const findings = [];
  const flat = {};
  for (const [loc, file] of Object.entries(catalogues())) {
    if (!exists(file)) { findings.push(`${file} — missing catalogue`); continue; }
    try { flat[loc] = flatten(JSON.parse(read(file))); } catch (e) { findings.push(`${file} — invalid JSON: ${e.message}`); }
  }
  const locs = Object.keys(flat);
  for (const a of locs) for (const b of locs) if (a !== b) for (const k of Object.keys(flat[a])) if (!(k in flat[b])) findings.push(`${b}.json missing key ${k}`);
  for (const [loc, m] of Object.entries(flat)) for (const [k, v] of Object.entries(m)) {
    if (typeof v !== "string" || !v.trim()) findings.push(`${loc}.json ${k} — empty or non-string value`);
  }
  findings.push(...scan(srcFiles([".tsx"]), [{ re: /\blang=["'](ar|en)["']/, label: "hardcoded lang attribute (derive it from the URL locale)" }]));
  const keys = flat.en ? Object.keys(flat.en).length : 0;
  return result(findings.length ? "FAIL" : "PASS", findings, `${keys} keys per locale`);
}
