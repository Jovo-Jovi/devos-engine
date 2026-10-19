import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../tools/build-manifest.mjs";
import { LOCAL, SOURCE_COUNT, normalizeLf, sha256Hex } from "../tools/sources.mjs";

const fileCount = SOURCE_COUNT - Object.keys(LOCAL.removed).length + Object.keys(LOCAL.added).length;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("two in-memory builds are deep-equal", () => {
  assert.deepEqual(buildManifest(), buildManifest());
});

test("manifest entry count follows the source plus local additions", () => {
  assert.equal(buildManifest().files.length, fileCount);
});

test("manifest paths are sorted and use POSIX separators", () => {
  const { files } = buildManifest();
  for (let index = 1; index < files.length; index += 1) {
    assert.ok(files[index - 1].path < files[index].path);
  }
  for (const file of files) {
    assert.equal(file.path.includes("\\"), false);
    assert.equal(file.stored.includes("\\"), false);
  }
});

test("every stored file exists and its hash matches", () => {
  for (const file of buildManifest().files) {
    assert.equal(file.owner, "engine");
    const abs = path.join(root, "payload", "files", ...file.stored.split("/"));
    const bytes = normalizeLf(readFileSync(abs));
    const hash = sha256Hex(bytes);
    assert.equal(hash, file.sha256);
  }
});

test("engine_version equals package.json", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(buildManifest().engine_version, pkg.version);
});
