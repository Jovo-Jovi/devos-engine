#!/usr/bin/env node
// E75: the engine's model lists (lib/data/tools.json, the models every new project is offered first) against what
// each tool and provider offers now, for the engine's maintainer.
//
//   node tools/models-refresh.mjs                 → per tool: the newer models its live list has that the engine's
//                                                   lacks, and the engine's models that list leaves out
//   node tools/models-refresh.mjs --write         → also adds those newer models, first in their family's group
//   node tools/models-refresh.mjs --file <path>   → another copy of tools.json (tests)
//
// It only adds: a model a live list leaves out is reported, never removed, since it may still run for other accounts.
// A model is newer when its line has no higher version in the engine's list (claude-fable-5-2 after claude-fable-5-1),
// or when it starts a line of a family the engine lists at a version no lower than that family's newest.
// The live lists: Cursor, GLM and Muse list their own models when installed and signed in; Claude Code, Codex and Gemini
// read their provider's models API with ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY (or GOOGLE_API_KEY) from
// the environment. A key is sent only to its own provider and never printed. The changed file goes to a pull request.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newerModels, offeredModels } from "../lib/model-check.mjs";
import { familyOf } from "../lib/probes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const fileAt = args.indexOf("--file");
const file = fileAt >= 0 ? path.resolve(args[fileAt + 1] ?? "") : path.join(root, "lib", "data", "tools.json");
const known = new Set(["--write", "--file"]);
if (args.some((arg, index) => arg.startsWith("--") && !known.has(arg)) || (fileAt >= 0 && !args[fileAt + 1])) {
  console.log("usage: node tools/models-refresh.mjs [--write] [--file <tools.json>]");
  process.exit(2);
}

const text = readFileSync(file, "utf8");
const catalogue = JSON.parse(text);
let added = 0;
for (const tool of catalogue.tools ?? []) {
  const offered = await offeredModels(tool.id, { tools: catalogue.tools });
  if (!offered.live) {
    console.log(`${tool.id}: not checked (${offered.note || "no live list"})`);
    continue;
  }
  const seeds = [...new Set((tool.seedGroups ?? []).flatMap((group) => group.models ?? []))];
  const fresh = newerModels(seeds, offered.ids);
  const missing = seeds.filter((id) => id !== "auto" && !offered.ids.includes(id));
  console.log(`${tool.id}: ${offered.label}, ${offered.ids.length} models; newer: ${fresh.length ? fresh.join(", ") : "none"}${missing.length ? `; not listed now: ${missing.join(", ")}` : ""}`);
  if (!write || fresh.length === 0) continue;
  for (const id of [...fresh].reverse()) {
    const family = familyOf(id);
    let group = tool.seedGroups.find((entry) => entry.id === family);
    if (!group) {
      group = { id: family, label: family, models: [] };
      tool.seedGroups.push(group);
    }
    group.models.unshift(id);
    added += 1;
  }
}
if (write && added > 0) {
  writeFileSync(file, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`models-refresh: ${added} model${added === 1 ? "" : "s"} added to ${path.relative(root, file) || file}; review the diff and open a pull request`);
} else if (write) {
  console.log("models-refresh: nothing to add");
}
