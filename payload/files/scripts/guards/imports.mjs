// guard:imports — code outside a feature module imports it only through its public entry (PR-58), so a
// change inside one module cannot break another through its internals. The modules are declared in
// devos/project.json `structure.modules` ({ "<name>": { "dir": "<folder>", "public": ["<entry>"] } }),
// which the blueprint writes from the stack's convention (`stack.scaffold.modules`). Imports are read for
// JavaScript and TypeScript (with `structure.aliases` and tsconfig.json or jsconfig.json `paths`), Python,
// Go and Dart. Tests (`structure.exempt`) may reach inside a module. N/A while no module is declared.
import path from "node:path";
import { exists, read, repoFiles, result } from "./lib.mjs";
import { config, matchesAny } from "../devos/lib.mjs";

const JS = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|go|dart)$/;
const EXT = /\.(?:d\.ts|[cm]?[jt]sx?|vue|svelte|astro|py|go|dart)$/;
const ENTRY = new Set(["index", "__init__"]);
const posix = path.posix;
const strip = (rel) => rel.replace(EXT, "");
const norm = (rel) => posix.normalize(String(rel ?? "").replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "");

/**
 * Blank out comments, keeping every offset and line break, so an import in a comment is not read. Strings are
 * skipped whole, so a `//` or `/*` inside one is not a comment. `hash` reads `#` comments (Python).
 */
export function uncomment(text, hash = false) {
  const out = String(text).split("");
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " "; };
  while (i < out.length) {
    const c = out[i];
    const next = out[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < out.length && out[j] !== c && !(c !== "`" && out[j] === "\n")) j += out[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else if (hash ? c === "#" : c === "/" && next === "/") {
      let j = i;
      while (j < out.length && out[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
    } else if (!hash && c === "/" && next === "*") {
      const end = String(text).indexOf("*/", i + 2);
      const j = end < 0 ? out.length : end + 2;
      blank(i, j);
      i = j;
    } else i += 1;
  }
  return out.join("");
}

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** Every import specifier in a source file, with its line. */
export function importsOf(file, text) {
  const found = [];
  const add = (spec, index, body) => found.push({ spec, line: lineAt(body, index) });
  if (JS.test(file)) {
    const body = uncomment(text, false);
    const patterns = [
      /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']/g,
      /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"'\n]+)["']/g,
      /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
      /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    ];
    for (const re of patterns) for (const hit of body.matchAll(re)) add(hit[1], hit.index, body);
  } else if (file.endsWith(".py")) {
    const body = uncomment(text, true);
    for (const hit of body.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm)) add(hit[1], hit.index, body);
    for (const hit of body.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm)) {
      for (const part of hit[1].split(",")) add(part.trim().split(/\s+/)[0], hit.index, body);
    }
  } else if (file.endsWith(".go")) {
    const body = uncomment(text, false);
    for (const hit of body.matchAll(/^import[ \t]*\(([\s\S]*?)\)/gm)) {
      const start = hit.index + hit[0].indexOf("(") + 1;
      for (const spec of hit[1].matchAll(/"([^"\n]+)"/g)) add(spec[1], start + spec.index, body);
    }
    for (const hit of body.matchAll(/^import[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/gm)) add(hit[1], hit.index, body);
  } else if (file.endsWith(".dart")) {
    const body = uncomment(text, false);
    for (const hit of body.matchAll(/^[ \t]*(?:import|export)[ \t]+["']([^"'\n]+)["']/gm)) add(hit[1], hit.index, body);
  }
  return found.sort((a, b) => a.line - b.line);
}

function readJsonc(rel) {
  try {
    const text = uncomment(read(rel), false).replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Alias prefixes to repository folders: `structure.aliases`, then tsconfig.json or jsconfig.json `paths`. */
export function aliasesOf(structure = {}) {
  const map = Object.entries(structure.aliases ?? {}).map(([from, to]) => [from, norm(to)]);
  for (const rel of ["tsconfig.json", "jsconfig.json"]) {
    if (!exists(rel)) continue;
    const options = readJsonc(rel)?.compilerOptions ?? {};
    const baseUrl = norm(options.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const target = Array.isArray(targets) ? targets[0] : null;
      if (!target || !pattern.endsWith("*") || !target.endsWith("*")) continue;
      map.push([pattern.slice(0, -1), norm(posix.join(baseUrl === "." ? "" : baseUrl, target.slice(0, -1)))]);
    }
  }
  return map.sort((a, b) => b[0].length - a[0].length);
}

/** The repository path (no extension) an import names, or null when it names a package outside the repository. */
export function resolver(structure = {}) {
  const aliases = aliasesOf(structure);
  const goModule = exists("go.mod") ? /^module[ \t]+(\S+)/m.exec(read("go.mod"))?.[1] ?? null : null;
  const dartName = exists("pubspec.yaml") ? /^name:[ \t]*(\S+)/m.exec(read("pubspec.yaml"))?.[1] ?? null : null;
  return (file, spec) => {
    const dir = posix.dirname(file);
    if (file.endsWith(".py")) {
      const dots = /^\.*/.exec(spec)[0].length;
      const rest = spec.slice(dots).replaceAll(".", "/");
      if (dots === 0) {
        // A source root such as `src/` is named in structure.aliases ({ "mypkg.": "src/mypkg/" }).
        for (const [from, to] of aliases) if (spec.startsWith(from)) return norm(posix.join(to, spec.slice(from.length).replaceAll(".", "/")));
        return norm(rest);
      }
      let base = dir;
      for (let i = 1; i < dots; i += 1) base = posix.dirname(base);
      return norm(posix.join(base, rest));
    }
    if (file.endsWith(".go")) {
      if (!goModule || !(spec === goModule || spec.startsWith(`${goModule}/`))) return null;
      return norm(spec.slice(goModule.length + 1));
    }
    if (file.endsWith(".dart")) {
      if (spec.startsWith("package:")) return dartName && spec.startsWith(`package:${dartName}/`) ? strip(norm(`lib/${spec.slice(`package:${dartName}/`.length)}`)) : null;
      if (spec.startsWith("dart:")) return null;
      return strip(norm(posix.join(dir, spec)));
    }
    for (const [from, to] of aliases) if (spec.startsWith(from)) return strip(norm(posix.join(to, spec.slice(from.length))));
    if (spec.startsWith("./") || spec.startsWith("../")) return strip(norm(posix.join(dir, spec)));
    return null;
  };
}

const inside = (rel, dir) => rel === dir || rel.startsWith(`${dir}/`);

/** The declared module a path belongs to (the deepest folder that holds it), or null. */
const ownerOf = (rel, modules) => modules.filter((mod) => inside(rel, mod.dir)).sort((a, b) => b.dir.length - a.dir.length)[0] ?? null;

/** The import forms that reach a module through its public entry: the entry, and its folder when the entry is an index. */
function publicForms(mod) {
  const forms = new Set();
  for (const entry of mod.public) {
    const bare = strip(entry);
    forms.add(bare);
    if (ENTRY.has(posix.basename(bare))) forms.add(posix.dirname(bare));
  }
  return forms;
}

export default function imports() {
  const structure = config().structure ?? {};
  const declared = Object.entries(structure.modules ?? {});
  if (declared.length === 0) return result("N/A", [], "no module in devos.config.json structure.modules");
  const findings = [];
  const modules = declared.map(([name, mod]) => ({ name, dir: norm(mod?.dir), public: (Array.isArray(mod?.public) ? mod.public : []).map(norm) }));
  for (const mod of modules) {
    if (!mod.dir) findings.push(`structure.modules.${mod.name}: no dir`);
    if (mod.public.length === 0) findings.push(`structure.modules.${mod.name}: no public entry`);
    for (const entry of mod.public) if (mod.dir && !inside(entry, mod.dir)) findings.push(`structure.modules.${mod.name}: public entry ${entry} is outside ${mod.dir}`);
  }
  const valid = modules.filter((mod) => mod.dir && mod.public.length > 0);
  const present = valid.filter((mod) => exists(mod.dir));
  for (const mod of present) {
    for (const entry of mod.public) if (!exists(entry)) findings.push(`structure.modules.${mod.name}: public entry ${entry} does not exist`);
  }
  const forms = new Map(valid.map((mod) => [mod.name, publicForms(mod)]));
  const resolve = resolver(structure);
  const exempt = structure.exempt ?? [];
  let checked = 0;
  for (const file of repoFiles().filter((rel) => SOURCE.test(rel) && !matchesAny(rel, exempt)).sort()) {
    const own = ownerOf(file, valid);
    for (const { spec, line } of importsOf(file, read(file))) {
      const target = resolve(file, spec);
      if (!target) continue;
      const dest = ownerOf(target, valid);
      if (!dest || dest === own) continue;
      checked += 1;
      if (!forms.get(dest.name).has(target)) findings.push(`${file}:${line} — imports ${spec}, inside module ${dest.name}; import it through ${dest.public.join(" or ")}`);
    }
  }
  const note = `${present.length} of ${valid.length} module folder(s) present, ${checked} cross-module import(s) checked`;
  return result(findings.length ? "FAIL" : "PASS", findings, note);
}
