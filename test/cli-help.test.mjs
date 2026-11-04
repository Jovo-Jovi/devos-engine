import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "devos.mjs");
const INIT_HELP = `devos init: set up a new project in a new or empty folder (the current folder when none is given)

  devos init [folder]
    Automated development (GitHub): AI agents build and review each task on GitHub, and you merge.
    Needs the GitHub CLI, signed in with gh auth login.
  devos init --local [folder]
    Local development (this computer): you build each task in your IDE from its fence, on its own
    branch, and it is reviewed before you merge. Needs only Node.js 22 or newer and git.
    No Control Tower link, visibility or hosting question. The project ends with the approved
    blueprint, README.md, SETUP.md and the first commit. A last question can add a private GitHub
    repository as a backup, where only CI runs (DEVOS_PAUSED is set to true before the first push).
  devos init --continue [folder]
    Pick up a started project where it stopped, as devos continue does.
  devos init --plan <file> [folder]
    Set up from a plan file, as the guided page does.

devos ui offers the same two ways of working on its first screen.
`;

function run(dir, args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
  });
}

function linesOf(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

test("cli-help.test.mjs (a) devos help, --help and -h print the usage, and a bare devos still exits 2", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-help-"));
  try {
    const bare = run(dir, []);
    assert.equal(bare.status, 2, bare.stderr);
    for (const args of [["help"], ["--help"], ["-h"]]) {
      const result = run(dir, args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, bare.stdout);
      const lines = linesOf(result.stdout);
      assert.equal(lines[1], "devos help");
      assert.equal(lines.at(-1), "devos models reset <reviewer|light|builder> [folder]");
      assert.equal(result.stdout.includes("devos init [--local] [--continue] [folder]"), true);
      assert.equal(result.stdout.includes("devos doctor [--local]"), true);
      assert.equal(result.stdout.includes("devos init --help"), true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli-help.test.mjs (b) devos init --help explains --local and writes nothing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-init-help-"));
  const folder = path.join(dir, "new-project");
  try {
    for (const args of [["init", "--help"], ["init", "-h"], ["init", "--local", "--help"], ["init", folder, "--help"]]) {
      const result = run(dir, args);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout, INIT_HELP);
      assert.deepEqual(readdirSync(dir), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli-help.test.mjs (c) an unknown init option is refused before anything is written", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "devos-init-nope-"));
  try {
    const result = run(dir, ["init", "--nope"]);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(result.stdout, "devos: unknown option --nope; run devos init --help\n");
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
