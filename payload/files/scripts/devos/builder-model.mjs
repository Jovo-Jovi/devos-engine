#!/usr/bin/env node
// Resolve the Cursor model id for this task.
// The reviewer chooses effort and speed in the fence header:
//     - Builder: grok-4.7 · Effort: high · Fast: no
// A workflow input can override either. The id is then checked against `agent models`, because
// Cursor names effort/fast variants in the id (e.g. grok-4.7-high) and the naming can change.
// PR-86: when the account lists no normal-speed id at the chosen effort, the Fast id at that same effort runs.
// PR-99: when it lists neither, or no effort was chosen (the fence's, the builder's fixed one or the run's input), the
// run stops and says what to choose: the engine has no builder model or effort of its own to fall back on.
//
// Usage: node scripts/devos/builder-model.mjs --task T07 [--effort fence|low|medium|high|xhigh]
//                                             [--fast fence|yes|no] [--models-file .devos/models.txt]
// Emits: model, effort, fast, source, note
import { existsSync, readFileSync } from "node:fs";
import { P, emit } from "./lib.mjs";

const arg = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
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
  const base = familyId();
  // PR-86: normal speed first, then the Fast id at the same effort, before any other effort.
  if (!fast) return [`${base}-${effort}`, `${base}-${effort}-fast`, `${base}-fast-${effort}`];
  return [`${base}-${effort}-fast`, `${base}-fast-${effort}`, `${base}-${effort}`];
}

/** PR-99: the pool builder's model: the family its effort is added to. None stops the run. */
function familyId() {
  const family = String(process.env.DEVOS_BUILDER_FAMILY || "").trim();
  if (!family) throw new Error("devos: no builder model: the pool's builder has none (devos/project.json agents.pool, PR-99)");
  return family;
}

/** The effort and speed a model id names ("" when it names none: Cursor's own for that id). */
export function idEffort(id) {
  const named = NAMED_EFFORT.exec(String(id ?? ""));
  return named ? { effort: named[1] || named[2] || "", fast: named[0].includes("fast") } : { effort: "", fast: false };
}

export function resolve({ task, effortIn = "fence", fastIn = "fence", modelsText = "" }) {
  const family = familyId();
  const named = NAMED_EFFORT.exec(family);
  if (named) {
    return {
      model: family,
      effort: named[1] || named[2] || "",
      fast: named[0].includes("fast"),
      source: "builder model",
      note: `the pool's model ${family} names its own effort; the fence's Effort and Fast are not used`,
      changed: "",
    };
  }
  const fence = readFenceChoice(task);
  let source = "";
  let effort = "";
  if (fence.effort) { effort = fence.effort; source = "fence"; }
  if (norm(effortIn)) { effort = norm(effortIn); source = "workflow input"; }
  // PR-99: no effort of the engine's by risk: the reviewer writes it in the fence (or the builder has a fixed one there).
  if (!effort) {
    throw new Error(`devos: the fence of ${task} names no builder effort; the reviewer writes "- Builder: <pool id> · Effort: <low|medium|high|xhigh> · Fast: <yes|no>" in docs/fences/${task}.md (PR-99)`);
  }

  let fast = fence.fast ?? false;
  if (fastIn === "yes") fast = true;
  if (fastIn === "no") fast = false;

  const notes = [];
  const listed = (id) => new RegExp(`(^|[\\s,|(])${id.replace(/[.]/g, "\\.")}($|[\\s,|)])`, "m").test(modelsText);
  const cands = candidates(effort, fast);
  let model = cands[0];
  if (modelsText.trim()) {
    const hit = cands.find(listed);
    // PR-99: a model the account offers with no effort in its id at all runs as the developer chose it: Cursor gives it
    // no other effort. One it offers at other efforts only stops the run: never another effort than the one chosen.
    const variants = EFFORTS.some((level) => candidates(level, false).some(listed));
    if (!hit && !variants && listed(family)) {
      notes.push(`\`agent models\` lists ${family} with no effort in its id, so it runs as Cursor runs it`);
      return { model: family, effort: "", fast: false, source, note: notes.join("; "), changed: "" };
    }
    if (!hit) {
      throw new Error(`devos: \`agent models\` on this account lists none of ${cands.join(", ")}; choose an effort it lists in the fence of ${task}, or another builder model (devos/project.json agents.pool, or the variable DEVOS_BUILDER_MODEL) (PR-99)`);
    }
    model = hit;
    if (fast && !/fast/i.test(hit)) notes.push(`no Fast variant of ${effort} is listed; running ${hit} at normal speed`);
    if (!fast && /fast/i.test(hit)) {
      notes.push(`no ${effort} id at normal speed is listed; running ${hit}, the same effort at Fast speed`);
      fast = true;
    }
  } else {
    notes.push("model list unavailable; id not verified");
  }
  return { model, effort, fast, source, note: notes.join("; "), changed: "" };
}

if (process.argv[1]?.endsWith("builder-model.mjs")) {
  const modelsFile = arg("models-file", ".devos/models.txt");
  const modelsText = existsSync(P(modelsFile)) ? readFileSync(P(modelsFile), "utf8") : "";
  let r;
  try {
    r = resolve({ task: arg("task"), effortIn: arg("effort", "fence"), fastIn: arg("fast", "fence"), modelsText });
  } catch (error) {
    console.log(`::error title=Dev OS::${error.message}`);
    process.exit(1);
  }
  emit({ model: r.model, effort: r.effort, fast: r.fast ? "yes" : "no", source: r.source, note: r.note });
}
