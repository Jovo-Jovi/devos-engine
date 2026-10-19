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
  assert.deepEqual(stripDollar(merged), stripDollar(tower));
});
