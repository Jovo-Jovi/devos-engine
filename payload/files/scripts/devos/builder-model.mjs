#!/usr/bin/env node
// Resolve the Cursor model id for this task.
// The reviewer chooses effort and speed in the fence header:
//     - Builder: grok-4.7 · Effort: high · Fast: no
// A workflow input can override either. The id is then checked against `agent models`, because
// Cursor names effort/fast variants in the id (e.g. grok-4.7-high) and the naming can change.
// PR-86: when the account lists no normal-speed id at the chosen effort, the Fast id at that same effort runs; when it
// lists neither, the configured model runs, and a changed effort is said in the run (a warning) and in the evidence.
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
const NAMED_EFFORT = /-(low|medium|high|xhigh)(?:-fast)?$|-fast(?:-(low|medium|high|xhigh))?$/;
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
  // PR-86: normal speed first, then the Fast id at the same effort, before any other effort.
  if (!fast) return [`${base}-${effort}`, ...(effort === (b.default_effort ?? "high") ? [base] : []), `${base}-${effort}-fast`, `${base}-fast-${effort}`];
  return [`${base}-${effort}-fast`, `${base}-fast-${effort}`, `${base}-${effort}`];
}

/** The effort and speed a model id runs at: named in the id, or the family's default effort at normal speed. */
export function idEffort(id) {
  const named = NAMED_EFFORT.exec(String(id ?? ""));
  return named ? { effort: named[1] || named[2] || b.default_effort || "high", fast: named[0].includes("fast") } : { effort: b.default_effort || "high", fast: false };
}

export function resolve({ task, effortIn = "fence", fastIn = "fence", modelsText = "" }) {
  const family = process.env.DEVOS_BUILDER_FAMILY || "";
  const named = NAMED_EFFORT.exec(family);
  if (named) {
    return {
      model: family,
      effort: named[1] || named[2] || b.default_effort || "high",
      fast: named[0].includes("fast"),
      source: "builder model",
      note: `the pool's model ${family} names its own effort; the fence's Effort and Fast are not used`,
    };
  }
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
  let changed = "";
  if (modelsText.trim()) {
    const hit = cands.find(listed);
    if (hit) {
      model = hit;
      if (fast && !/fast/i.test(hit)) notes.push(`no Fast variant of ${effort} is listed; running ${hit} at normal speed`);
      if (!fast && /fast/i.test(hit)) {
        notes.push(`no ${effort} id at normal speed is listed; running ${hit}, the same effort at Fast speed`);
        fast = true;
      }
    }
    else {
      const family = b.model_family || "grok-4.7";
      const base = process.env.DEVOS_BUILDER_FAMILY || family;
      const fallback = base === family ? b.model : base;
      const runs = idEffort(fallback);
      // PR-86: the effort the fallback runs at is the one reported; a different one is never quiet.
      if (runs.effort !== effort) {
        const way = EFFORTS.indexOf(runs.effort) < EFFORTS.indexOf(effort) ? "lowered" : "raised";
        changed = `the builder's effort was ${way} from ${effort} to ${runs.effort}: \`agent models\` lists none of ${cands.join(", ")}, so ${fallback} runs`;
        notes.push(changed);
      } else {
        notes.push(`none of ${cands.join(", ")} is listed by \`agent models\`; using ${fallback}`);
      }
      if (fast && !runs.fast) notes.push("fast mode was requested but no fast id was found");
      model = fallback;
      effort = runs.effort;
      fast = runs.fast;
    }
  } else {
    notes.push("model list unavailable; id not verified");
  }
  return { model, effort, fast, source, note: notes.join("; "), changed };
}

if (process.argv[1]?.endsWith("builder-model.mjs")) {
  const modelsFile = arg("models-file", ".devos/models.txt");
  const modelsText = existsSync(P(modelsFile)) ? readFileSync(P(modelsFile), "utf8") : "";
  const r = resolve({ task: arg("task"), effortIn: arg("effort", "fence"), fastIn: arg("fast", "fence"), modelsText });
  if (r.changed) console.log(`::warning title=Dev OS::${r.changed} (PR-86)`);
  emit({ model: r.model, effort: r.effort, fast: r.fast ? "yes" : "no", source: r.source, note: r.note });
}
