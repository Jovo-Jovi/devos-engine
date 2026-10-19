import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", windowsHide: true });
}

test("config-guard.test.mjs stages, writes, and checks config", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-config-"));
  try {
    const staged = spawnSync(process.execPath, [path.join(root, "tools", "stage.mjs"), dir], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(staged.status, 0, staged.stderr);
    const template = readFileSync(path.join(root, "payload", "templates", "devos", "project.json"), "utf8");
    writeFileSync(path.join(dir, "devos", "project.json"), template.replaceAll("__PROJECT_KEY__", "DEMO"));
    const written = run(path.join(dir, "scripts", "devos", "config.mjs"), ["--write"], dir);
    assert.equal(written.status, 0, written.stderr);
    const guards = path.join(dir, "scripts", "guards", "run-all.mjs");
    const ok = run(guards, ["--only", "config,manual", "--json"], dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const okJson = JSON.parse(ok.stdout);
    assert.equal(okJson.config.status, "PASS");
    assert.equal(okJson.manual.status, "PASS");

    const generated = JSON.parse(readFileSync(path.join(dir, "devos.config.json"), "utf8"));
    generated.project = "CHANGED";
    writeFileSync(path.join(dir, "devos.config.json"), `${JSON.stringify(generated, null, 2)}\n`);
    const failed = run(guards, ["--only", "config", "--json"], dir);
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).config.status, "FAIL");

    rmSync(path.join(dir, "devos", "project.json"));
    const absent = run(guards, ["--only", "config", "--json"], dir);
    assert.equal(absent.status, 0, absent.stdout);
    assert.equal(JSON.parse(absent.stdout).config.status, "N/A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
