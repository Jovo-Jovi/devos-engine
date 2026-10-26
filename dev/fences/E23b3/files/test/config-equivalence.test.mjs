import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { merge } from "../payload/files/scripts/devos/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripDollar(value) {
  if (Array.isArray(value)) return value.map(stripDollar);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key.startsWith("$")) continue;
      out[key] = stripDollar(value[key]);
    }
    return out;
  }
  return value;
}

test("config-equivalence.test.mjs regenerates the Tower config", () => {
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  const project = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "tower-project.json"), "utf8"));
  const tower = JSON.parse(readFileSync(path.join(root, "dev", "sources", "tower", "devos.config.json"), "utf8"));
  const merged = merge(defaults, project);
  delete merged.guards;
  delete merged.deploy;
  delete merged.agents;
  delete merged.stack;
  // PR-58 (E23c): the product's feature modules (`structure`) are an engine addition.
  delete merged.structure;
  // PR-52 (E24, after the Tower pin was retired): the builder may not edit the usage record.
  for (const role of ["builder", "builder_method"]) {
    merged.surfaces[role].deny = merged.surfaces[role].deny.filter((p) => p !== "docs/usage/**" && p !== "docs/USAGE.md");
  }
  // PR-59 (E23b3): the intake may add design references.
  merged.surfaces.intake.allow = merged.surfaces.intake.allow.filter((p) => p !== "docs/design/REFERENCES.md");
  assert.deepEqual(stripDollar(merged), stripDollar(tower));
});
