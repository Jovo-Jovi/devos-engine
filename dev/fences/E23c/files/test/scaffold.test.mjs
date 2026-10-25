import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "../lib/catalogue.mjs";
import { merge } from "../payload/files/scripts/devos/config.mjs";
import { cleanup, flow, init, stage } from "./harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYS = ["create", "health", "logger", "tests", "architecture", "modules"];

test("scaffold.test.mjs (a) every stack has a recipe", () => {
  let healthRoutes = 0;
  for (const stack of loadCatalogue().stacks) {
    const recipe = stack.scaffold;
    assert.deepEqual(Object.keys(recipe), KEYS, stack.id);
    assert.equal(Array.isArray(recipe.create) && recipe.create.length > 0 && recipe.create.every((line) => typeof line === "string"), true, stack.id);
    assert.equal(typeof recipe.architecture === "string" && recipe.architecture.length > 0, true, stack.id);
    assert.equal(recipe.health === "" || recipe.health.startsWith("/"), true, stack.id);
    if (recipe.health !== "") healthRoutes += 1;
  }
  assert.equal(healthRoutes, 11);
});

test("scaffold.test.mjs (b) a default init writes the Next recipe", () => {
  const staged = stage();
  try {
    const result = init(staged, flow());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const project = JSON.parse(readFileSync(path.join(staged.project, "devos", "project.json"), "utf8"));
    const config = JSON.parse(readFileSync(path.join(staged.project, "devos.config.json"), "utf8"));
    for (const file of [project, config]) {
      assert.equal(file.stack.scaffold.create[0].startsWith("pnpm create next-app@latest ."), true);
      assert.equal(file.stack.scaffold.health, "/api/health");
      assert.equal(file.stack.scaffold.logger, "pino");
      assert.equal(file.stack.scaffold.tests, "vitest");
      assert.equal(file.stack.preview, "pnpm exec next start -H 127.0.0.1 -p {port}");
    }
  } finally {
    cleanup(staged.parent);
  }
});

test("scaffold.test.mjs (c) merge keeps the recipe array and an empty health route", () => {
  const defaults = JSON.parse(readFileSync(path.join(root, "payload", "files", "devos", "engine.defaults.json"), "utf8"));
  const merged = merge(defaults, { stack: { scaffold: { create: ["x"], health: "" } } });
  assert.deepEqual(merged.stack.scaffold.create, ["x"]);
  assert.equal(merged.stack.scaffold.health, "");
});

test("scaffold.test.mjs (d) a stack that serves a web interface has a preview command", () => {
  const catalogue = loadCatalogue();
  const ui = new Set(catalogue.types.filter((type) => type.ui).map((type) => type.id));
  let previews = 0;
  for (const stack of catalogue.stacks) {
    assert.equal(typeof stack.preview, "string", stack.id);
    assert.equal(stack.preview !== "", stack.fits.some((type) => ui.has(type)), stack.id);
    if (stack.preview !== "") previews += 1;
  }
  assert.equal(previews, 9);
});
