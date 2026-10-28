import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "./harness.mjs";

// E32: the engine's own checks stay green on a release. The release's Run workflow does not cancel the push's run, the
// tests run git without background maintenance, and devos ends only after its output is written.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const read = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const devos = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", windowsHide: true, timeout: 60000 });

test("stability.test.mjs (a) on main, a push and the release's Run workflow never cancel each other", () => {
  const ci = read(".github/workflows/engine-ci.yml");
  assert.equal(
    ci.includes(`concurrency:
  group: engine-ci-\${{ github.event_name }}-\${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}
`),
    true,
    ci,
  );
  assert.equal(ci.includes("group: engine-ci-${{ github.ref }}\n"), false);
});

test("stability.test.mjs (b) devos ends only after stdout and stderr have flushed, with its exit code", () => {
  const source = read("bin/devos.mjs");
  assert.equal((source.match(/process\.exit\(code\)/g) ?? []).length, 2, "process.exit only inside exitFlushed");
  assert.equal(/process\.exit\(\d/.test(source), false, "no exit with a bare number");
  assert.equal((source.match(/await exitFlushed\(/g) ?? []).length, 3);
  assert.equal(source.includes('process.stdout.write("", flushed);\n  process.stderr.write("", flushed);'), true);
  const pkg = JSON.parse(read("package.json"));
  const usage = devos([]);
  assert.equal(usage.status, 2, usage.stderr);
  assert.equal(usage.stdout.startsWith(`devos ${pkg.version}\n`), true, usage.stdout);
  assert.equal(usage.stdout.endsWith("devos models reset <reviewer|light|builder> [folder]\n"), true, usage.stdout);
  const version = devos(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `devos ${pkg.version}\n`);
  const unknown = devos(["nope"]);
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.equal(unknown.stdout, "devos: unknown command nope\n");
});

test("stability.test.mjs (c) every git a test starts runs without background maintenance", () => {
  for (const [key, value] of [["maintenance.auto", "false"], ["gc.auto", "0"]]) {
    const seen = spawnSync("git", ["config", "--get", key], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(seen.stdout.trim(), value, `${key}: ${seen.stdout}${seen.stderr}`);
  }
  const line = 'Object.assign(process.env, { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "maintenance.auto", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "gc.auto", GIT_CONFIG_VALUE_1: "0" });';
  for (const file of ["test/harness.mjs", "test/setup.test.mjs"]) {
    assert.equal(read(file).includes(line), true, file);
  }
});
