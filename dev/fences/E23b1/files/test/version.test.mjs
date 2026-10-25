import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("devos --version prints devos 0.2.3", () => {
  const result = spawnSync(process.execPath, [path.join(root, "bin", "devos.mjs"), "--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "devos 0.2.3\n");
});
