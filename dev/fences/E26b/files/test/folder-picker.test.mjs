import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dialogCommands, launchDialog, pickFolder } from "../lib/folder-picker.mjs";
import { startUiServer } from "../lib/ui-server.mjs";
import { cleanup, stage } from "./harness.mjs";

// E26b: "A project in another folder" opens the system's folder dialog through the local page server, which returns
// only the path the developer chose. No real dialog opens in a test: the dialog runner is given by the test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = "Choose the DEV_OS project folder";

function runner(results) {
  const calls = [];
  const launch = async (cmd, args) => {
    calls.push([cmd, args]);
    return results.shift() ?? null;
  };
  return { calls, launch };
}

test("folder-picker.test.mjs (a) each system's dialog, a chosen folder, a closed dialog and no dialog", async () => {
  const [windows] = dialogCommands("win32");
  assert.deepEqual([windows.cmd, windows.args.slice(0, 4)], ["powershell", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"]]);
  const script = Buffer.from(windows.args[4], "base64").toString("utf16le");
  for (const text of ["System.Windows.Forms.FolderBrowserDialog", `$dialog.Description = '${PROMPT}'`, "[Console]::Out.Write($dialog.SelectedPath)"]) {
    assert.equal(script.includes(text), true, text);
  }
  assert.deepEqual(dialogCommands("darwin"), [{ cmd: "osascript", args: ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`] }]);
  assert.deepEqual(dialogCommands("linux").map((entry) => [entry.cmd, entry.args.slice(0, 2)]), [["zenity", ["--file-selection", "--directory"]], ["kdialog", ["--getexistingdirectory", dialogCommands("linux")[1].args[1]]]]);

  assert.deepEqual(await pickFolder({ platform: "win32", launch: runner([{ status: 0, stdout: "C:\\Users\\dev\\shop" }]).launch }), { ok: true, folder: "C:\\Users\\dev\\shop" });
  assert.deepEqual(await pickFolder({ platform: "win32", launch: runner([{ status: 0, stdout: "" }]).launch }), { ok: false, cancelled: true });
  assert.deepEqual(await pickFolder({ platform: "win32", launch: runner([]).launch }), { ok: false, error: "The folder dialog did not open. Paste the folder's full path instead." });
  assert.deepEqual(await pickFolder({ platform: "darwin", launch: runner([{ status: 0, stdout: "/Users/dev/shop/\n" }]).launch }), { ok: true, folder: "/Users/dev/shop" });
  assert.deepEqual(await pickFolder({ platform: "darwin", launch: runner([{ status: 0, stdout: "/\n" }]).launch }), { ok: true, folder: "/" });
  assert.deepEqual(await pickFolder({ platform: "darwin", launch: runner([{ status: 1, stdout: "" }]).launch }), { ok: false, cancelled: true });

  const linux = runner([null, { status: 0, stdout: "/home/dev/shop\n" }]);
  assert.deepEqual(await pickFolder({ platform: "linux", launch: linux.launch }), { ok: true, folder: "/home/dev/shop" });
  assert.deepEqual(linux.calls.map(([cmd]) => cmd), ["zenity", "kdialog"]);
  assert.deepEqual(await pickFolder({ platform: "linux", launch: runner([]).launch }), { ok: false, error: "This computer has no folder dialog (zenity or kdialog). Paste the folder's full path instead." });
  assert.deepEqual(await pickFolder({ platform: "linux", launch: runner([{ status: 0, stdout: "shop\n" }]).launch }), { ok: false, error: "The folder dialog did not give a full path. Paste the folder's full path instead." });
});

test("folder-picker.test.mjs (b) a dialog runs as its own program, never through a shell, and stops at its time limit", async () => {
  assert.equal(await launchDialog("devos-no-such-dialog", []), null);
  assert.deepEqual(await launchDialog("node", ["-e", "process.stdout.write('/home/dev/shop\\n')"]), { status: 0, stdout: "/home/dev/shop\n" });
  assert.deepEqual(await launchDialog("node", ["-e", "process.exit(1)"]), { status: 1, stdout: "" });
  assert.deepEqual(await launchDialog("node", ["-e", "setTimeout(() => {}, 20000)"], 300), { status: null, stdout: "" });
});

test("folder-picker.test.mjs (c) the server opens one dialog at a time and returns only the chosen path; the page fills it in", async () => {
  const staged = stage();
  const home = path.join(staged.parent, "home-dir");
  mkdirSync(home);
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  let release;
  const results = [
    () => ({ ok: true, folder: "/home/dev/shop" }),
    () => ({ ok: false, cancelled: true }),
    () => ({ ok: false, error: "This computer has no folder dialog (zenity or kdialog). Paste the folder's full path instead." }),
    () => { throw new Error("boom"); },
    () => new Promise((done) => { release = () => done({ ok: true, folder: "/home/dev/slow" }); }),
  ];
  const server = await startUiServer({ folder: null, port: 0, picker: async () => results.shift()() });
  const address = `http://127.0.0.1:${server.port}`;
  const post = async (headers = { "X-DEVOS-Token": server.token, Origin: address }) => {
    const response = await fetch(`${address}/api/pick-folder`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.deepEqual(await post(), { status: 200, body: { ok: true, folder: "/home/dev/shop" } });
    assert.deepEqual(await post(), { status: 200, body: { ok: false, cancelled: true } });
    assert.deepEqual(await post(), { status: 200, body: { ok: false, errors: ["This computer has no folder dialog (zenity or kdialog). Paste the folder's full path instead."] } });
    assert.deepEqual(await post(), { status: 200, body: { ok: false, errors: ["The folder dialog did not open. Paste the folder's full path instead."] } });
    const slow = post();
    while (!release) await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(await post(), { status: 409, body: { ok: false, errors: ["A folder dialog is already open on this computer."] } });
    release();
    assert.deepEqual(await slow, { status: 200, body: { ok: true, folder: "/home/dev/slow" } });
    assert.equal((await post({ Origin: address })).status, 401);
    assert.equal((await post({ "X-DEVOS-Token": server.token })).status, 403);
    assert.equal(results.length, 0);
  } finally {
    await server.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanup(staged.parent);
  }
  const js = readFileSync(path.join(root, "lib", "ui", "app.js"), "utf8");
  for (const text of ["\"/api/pick-folder\", { method: \"POST\", body: {} }", "text: \"Choose a folder…\"", "Or paste the project folder’s full path:", "input.value = data.folder;"]) {
    assert.equal(js.includes(text), true, text);
  }
});
