// guard:naming — no forbidden bare noun as a type, route segment or content field (GLOSSARY §3).
import { existsSync, readFileSync } from "node:fs";
import { read, exists, hasSrc, srcFiles, walk, result } from "./lib.mjs";
import { P } from "../devos/lib.mjs";

function allowRoutes() {
  const file = existsSync(P("devos.config.json")) ? "devos.config.json" : "devos/engine.defaults.json";
  let cur = JSON.parse(readFileSync(P(file), "utf8"));
  for (const key of ["guards", "naming", "allow_routes"]) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, key)) throw new Error("config: guards.naming.allow_routes missing");
    cur = cur[key];
  }
  if (!Array.isArray(cur)) throw new Error("config: guards.naming.allow_routes missing");
  return new Set(cur.map((name) => String(name).toLowerCase()));
}

export function forbiddenNouns() {
  const g = read("docs/GLOSSARY.md");
  const sec = g.split(/^## 3\./m)[1] ?? "";
  const block = /```\s*\n([\s\S]*?)```/.exec(sec);
  if (!block) throw new Error("docs/GLOSSARY.md §3 has no fenced list of forbidden nouns");
  return new Set(block[1].split(/[\s·.,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean));
}

function contentKeys(value, path, out) {
  if (Array.isArray(value)) value.forEach((v, i) => contentKeys(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.push([k, `${path}.${k}`]); contentKeys(v, `${path}.${k}`, out); }
  }
}

export default function naming() {
  const ALLOW_ROUTES = allowRoutes();
  const forbidden = forbiddenNouns();
  const findings = [];

  for (const f of walk("content").filter((f) => f.endsWith(".json"))) {
    const keys = [];
    contentKeys(JSON.parse(read(f)), f, keys);
    for (const [k, where] of keys) if (forbidden.has(k.toLowerCase())) findings.push(`${where} — bare field name "${k}"`);
  }

  if (!hasSrc()) return result(findings.length ? "FAIL" : "N/A", findings, "src/ does not exist yet");

  for (const f of srcFiles([".ts", ".tsx"])) {
    read(f).split(/\r?\n/).forEach((line, i) => {
      const re = /\b(?:type|interface|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
      let m;
      while ((m = re.exec(line))) {
        if (forbidden.has(m[1].toLowerCase())) findings.push(`${f}:${i + 1} — bare type name "${m[1]}"`);
      }
    });
  }

  const dirs = new Set();
  for (const f of walk("src/app")) {
    const parts = f.split("/").slice(2, -1);
    parts.forEach((_, i) => dirs.add(parts.slice(0, i + 1).join("/")));
  }
  for (const d of dirs) {
    const seg = d.split("/").pop().replace(/^[[(]+|[\])]+$/g, "").replace(/^\.\.\./, "");
    if (forbidden.has(seg.toLowerCase()) && !ALLOW_ROUTES.has(seg.toLowerCase())) findings.push(`src/app/${d} — bare route segment "${seg}"`);
  }

  return result(findings.length ? "FAIL" : "PASS", findings);
}
