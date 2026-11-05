import test from "node:test";
import assert from "node:assert/strict";
import { searchPathWin, splitPathWin } from "../lib/spawn.mjs";

const pathext = ".COM;.EXE;.BAT;.CMD";

function isFile(paths) {
  const set = new Set(paths.map((entry) => entry.toLowerCase()));
  return (p) => set.has(p.toLowerCase());
}

test("spawn.test.mjs searchPathWin takes the .cmd, never npm's file without an extension", () => {
  const check = isFile(["C:\\npm\\claude", "C:\\npm\\claude.cmd", "C:\\npm\\claude.ps1"]);
  const found = searchPathWin("claude", "C:\\npm", pathext, check);
  assert.equal(found.path.toLowerCase(), "c:\\npm\\claude.cmd");
  assert.equal(found.viaShell, true);
});

test("spawn.test.mjs searchPathWin keeps the PATH order", () => {
  const check = isFile([
    "C:\\npm\\claude",
    "C:\\npm\\claude.cmd",
    "C:\\npm\\claude.ps1",
    "C:\\bin\\claude.exe",
  ]);
  const binFirst = searchPathWin("claude", "C:\\bin;C:\\npm", pathext, check);
  assert.equal(binFirst.path.toLowerCase(), "c:\\bin\\claude.exe");
  assert.equal(binFirst.viaShell, false);
  const npmFirst = searchPathWin("claude", "C:\\npm;C:\\bin", pathext, check);
  assert.equal(npmFirst.path.toLowerCase(), "c:\\npm\\claude.cmd");
});

test("spawn.test.mjs searchPathWin returns null without a PATHEXT match and defaults an empty PATHEXT", () => {
  assert.equal(searchPathWin("claude", "C:\\npm", pathext, isFile(["C:\\npm\\claude"])), null);
  const check = isFile(["C:\\npm\\claude", "C:\\npm\\claude.cmd", "C:\\npm\\claude.ps1"]);
  const emptyExt = searchPathWin("claude", "C:\\npm", "", check);
  assert.equal(emptyExt.path.toLowerCase(), "c:\\npm\\claude.cmd");
  const skipped = searchPathWin("claude", ";;C:\\npm;", "", check);
  assert.equal(skipped.path.toLowerCase(), "c:\\npm\\claude.cmd");
});

test("spawn.test.mjs searchPathWin takes a PATH entry in double quotes, and a quoted semicolon (E42 a2)", () => {
  const check = isFile(["C:\\Program Files\\Claude\\claude.exe", "D:\\a;b\\codex.cmd"]);
  const quoted = searchPathWin("claude", "C:\\npm;\"C:\\Program Files\\Claude\"", pathext, check);
  assert.equal(quoted.path.toLowerCase(), "c:\\program files\\claude\\claude.exe");
  const semicolon = searchPathWin("codex", "\"D:\\a;b\";C:\\npm", pathext, check);
  assert.equal(semicolon.path.toLowerCase(), "d:\\a;b\\codex.cmd");
  assert.equal(semicolon.viaShell, true);
  assert.deepEqual(splitPathWin(" C:\\npm ;;\"C:\\x y\"; \"\" ;C:\\bin"), ["C:\\npm", "C:\\x y", "C:\\bin"]);
});
