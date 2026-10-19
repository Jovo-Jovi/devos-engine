#!/usr/bin/env node
// Resolve the Cursor model id for this task.
// The reviewer chooses effort and speed in the fence header:
//     - Builder: grok-4.7 · Effort: high · Fast: no
// A workflow input can override either. The id is then checked against `agent models`, because
// Cursor names effort/fast variants in the id (e.g. grok-4.7-high) and the naming can change.
//
// Usage: node scripts/devos/builder-model.mjs --task T07 [--effort fence|low|medium|high|xhigh]
//                                             [--fast fence|yes|no] [--models-file .devos/models.txt]
// Emits: model, effort, fast, source, note
import { existsSync, readFileSync } from "node:fs";
import { P, config, parsePhases, emit } from "./lib.mjs";

const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const cfg = config();
const b = cfg.builder;
const EFFORTS = ["low", "medium", "high", "xhigh"];
const norm = (e) => {
  const v = String(e || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "extrahigh" || v === "xhigh") return "xhigh";
  return EFFORTS.includes(v) ? v : "";
};

export function readFenceChoice(task) {
  const file = P(`docs/fences/${task}.md`);
  if (!existsSync(file)) return {};
  const head = readFileSync(file, "utf8").split(/\r?\n/).slice(0, 30).join("\n");
  const effort = norm(/Effort:\s*([A-Za-z -]+?)(?:\s*[·|,]|\s*$|\s*\()/m.exec(head)?.[1]);
  const fastRaw = /Fast:\s*(yes|no|true|false|on|off)/i.exec(head)?.[1]?.toLowerCase();
  const fast = fastRaw === undefined ? undefined : ["yes", "true", "on"].includes(fastRaw);
  return { effort, fast };
}

export function candidates(effort, fast) {
  const base = process.env.DEVOS_BUILDER_FAMILY || b.model_family || "grok-4.7";
  if (!fast) return [`${base}-${effort}`, ...(effort === (b.default_effort ?? "high") ? [base] : [])];
  return [`${base}-${effort}-fast`, `${base}-fast-${effort}`, `${base}-${effort}`];
}

export function resolve({ task, effortIn = "fence", fastIn = "fence", modelsText = "" }) {
  const { rows } = parsePhases();
  const row = rows.find((r) => r.task === task);
  const fence = readFenceChoice(task);
  const byRisk = b.effort_by_risk?.[String(row?.risk ?? 2)] ?? b.default_effort ?? "high";

  let source = "risk default";
  let effort = byRisk;
  if (fence.effort) { effort = fence.effort; source = "fence"; }
  if (norm(effortIn)) { effort = norm(effortIn); source = "workflow input"; }

  let fast = fence.fast ?? false;
  if (fastIn === "yes") fast = true;
  if (fastIn === "no") fast = false;

  const notes = [];
  const listed = (id) => new RegExp(`(^|[\\s,|(])${id.replace(/[.]/g, "\\.")}($|[\\s,|)])`, "m").test(modelsText);
  const cands = candidates(effort, fast);
  let model = cands[0];
  if (modelsText.trim()) {
    const hit = cands.find(listed);
    if (hit) {
      model = hit;
      if (fast && !/fast/i.test(hit)) notes.push(`no Fast variant of ${effort} is listed; running ${hit} at normal speed`);
    }
    else {
      const family = b.model_family || "grok-4.7";
      const base = process.env.DEVOS_BUILDER_FAMILY || family;
      const fallback = base === family ? b.model : base;
      notes.push(`none of ${cands.join(", ")} is listed by \`agent models\`; using ${fallback}`);
      model = fallback;
      if (fast) notes.push("fast mode was requested but no fast id was found");
    }
  } else {
    notes.push("model list unavailable; id not verified");
  }
  return { model, effort, fast, source, note: notes.join("; ") };
}

if (process.argv[1]?.endsWith("builder-model.mjs")) {
  const modelsFile = arg("models-file", ".devos/models.txt");
  const modelsText = existsSync(P(modelsFile)) ? readFileSync(P(modelsFile), "utf8") : "";
  const r = resolve({ task: arg("task"), effortIn: arg("effort", "fence"), fastIn: arg("fast", "fence"), modelsText });
  emit({ model: r.model, effort: r.effort, fast: r.fast ? "yes" : "no", source: r.source, note: r.note });
}
