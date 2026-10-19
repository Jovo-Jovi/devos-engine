import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LOCAL, SOURCE_COUNT } from "../tools/sources.mjs";

const fileCount = SOURCE_COUNT + Object.keys(LOCAL.added).length;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walkFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(abs));
    else if (entry.isFile()) found.push(abs);
  }
  return found;
}

function stage(dir) {
  return spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
    encoding: "utf8",
    windowsHide: true,
  });
}

test("stage copies every manifest file and keeps stored bytes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-stage-"));
  try {
    const result = stage(dir);
    assert.equal(result.status, 0);
    assert.equal(walkFiles(dir).length, fileCount);
    for (const [installed, stored] of [
      [path.join(".github", "workflows", "devos-cycle.yml"), path.join("dot-github", "workflows", "devos-cycle.yml")],
      [path.join(".claude", "settings.json"), path.join("dot-claude", "settings.json")],
    ]) {
      const staged = readFileSync(path.join(dir, installed));
      const original = readFileSync(path.join(root, "payload", "files", stored));
      assert.deepEqual(staged, original);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second stage into the same folder exits 2", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-stage-"));
  try {
    assert.equal(stage(dir).status, 0);
    const again = stage(dir);
    assert.equal(again.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
