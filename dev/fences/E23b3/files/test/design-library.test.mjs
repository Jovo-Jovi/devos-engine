import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "../lib/catalogue.mjs";

// PR-59: the reference library in docs/method/DESIGN_METHOD.md §5 covers every product type, every library row has a
// licence and a default, and a project's references stay the reviewer's and the intake's, never the builder's.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = path.join(root, "payload", "files");
const method = readFileSync(path.join(files, "docs", "method", "DESIGN_METHOD.md"), "utf8");

function table(heading) {
  const lines = method.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, heading);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("### ") || line.startsWith("## ")) break;
    if (line.startsWith("|") && !line.startsWith("|---")) rows.push(line.slice(1, -1).split(" | ").map((cell) => cell.trim()));
  }
  return { header: rows[0], rows: rows.slice(1) };
}

test("design-library.test.mjs (a) every product type of the catalogue has a row in §5.2", () => {
  const { header, rows } = table("### 5.2 By product type");
  assert.deepEqual(header, ["Type", "What good looks like", "Consider", "Browse"]);
  const named = rows.flatMap((row) => [...row[0].matchAll(/`([a-z-]+)`/g)].map((hit) => hit[1]));
  assert.deepEqual([...named].sort(), loadCatalogue().types.map((type) => type.id).sort());
  for (const row of rows) assert.equal(row.length, 4, row[0]);
});

test("design-library.test.mjs (b) every library has a use, a licence and a default", () => {
  const { header, rows } = table("### 5.1 Libraries");
  assert.deepEqual(header, ["Resource", "Use", "Licence", "Default"]);
  assert.equal(rows.length, 27);
  for (const row of rows) {
    assert.equal(row.length, 4, row[0]);
    assert.notEqual(row[2], "", row[0]);
    assert.match(row[3], /^(adopt|optional|reject|Reanimated)/, row[0]);
  }
  const galleries = table("### 5.3 Galleries");
  assert.deepEqual(galleries.header, ["Gallery", "What it collects"]);
  assert.equal(galleries.rows.length, 10);
});

test("design-library.test.mjs (c) a project's references are the intake's to change and never the builder's", () => {
  const defaults = JSON.parse(readFileSync(path.join(files, "devos", "engine.defaults.json"), "utf8"));
  assert.equal(defaults.surfaces.intake.allow.includes("docs/design/REFERENCES.md"), true);
  assert.equal(defaults.surfaces.builder.deny.includes("docs/design/**"), true);
  const blueprint = readFileSync(path.join(files, "devos", "prompts", "blueprint.md"), "utf8");
  for (const needle of ["docs/design/references/", "docs/design/REFERENCES.md", "Direction and signature"]) assert.equal(blueprint.includes(needle), true, needle);
  const intake = readFileSync(path.join(files, "devos", "prompts", "intake.md"), "utf8");
  assert.equal(intake.includes("## Requests that change the look (PR-59"), true);
});
