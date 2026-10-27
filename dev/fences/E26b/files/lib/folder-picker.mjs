// A folder dialog on this computer (E26b), for "A project in another folder" on the guided page. The browser cannot
// give a page a folder's full path, so the local page server opens the system's own dialog: PowerShell's folder browser
// on Windows, `choose folder` on macOS, zenity or kdialog on Linux. It returns only the path the developer chose;
// nothing in the folder is read here. The dialog's text is fixed: nothing from the page reaches the command.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { which } from "./which.mjs";

const PICK_TIMEOUT = 10 * 60 * 1000;
const PROMPT = "Choose the DEV_OS project folder";

const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$owner = New-Object System.Windows.Forms.Form",
  "$owner.TopMost = $true",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  `$dialog.Description = '${PROMPT}'`,
  "$dialog.ShowNewFolderButton = $false",
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  "$owner.Dispose()",
].join("\n");

/** The dialog command for a platform, in the order to try: [{ cmd, args }]. */
export function dialogCommands(platform = process.platform) {
  if (platform === "win32") {
    const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
    return [{ cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded] }];
  }
  if (platform === "darwin") return [{ cmd: "osascript", args: ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`] }];
  return [
    { cmd: "zenity", args: ["--file-selection", "--directory", `--title=${PROMPT}`] },
    { cmd: "kdialog", args: ["--getexistingdirectory", homedir(), "--title", PROMPT] },
  ];
}

/** Runs one dialog and resolves { status, stdout }, or null when the command is not installed. */
export function launchDialog(cmd, args, timeout = PICK_TIMEOUT) {
  const found = which(cmd);
  if (!found || found.viaShell) return Promise.resolve(null);
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(found.path, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      settle({ status: null, stdout: "" });
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => settle(null));
    child.on("close", (status) => settle({ status, stdout }));
  });
}

/**
 * Opens the system's folder dialog and resolves { ok: true, folder }, { ok: false, cancelled: true } when the developer
 * closes it, or { ok: false, error } when no dialog can open.
 */
export async function pickFolder({ platform = process.platform, launch = launchDialog } = {}) {
  let ran = false;
  for (const { cmd, args } of dialogCommands(platform)) {
    const result = await launch(cmd, args);
    if (result === null) continue;
    ran = true;
    let folder = String(result.stdout ?? "").replace(/[\r\n]+$/, "");
    if (result.status !== 0 || folder === "") return { ok: false, cancelled: true };
    if (platform === "darwin" && folder.length > 1) folder = folder.replace(/\/$/, "");
    const absolute = platform === "win32" ? path.win32.isAbsolute(folder) : path.posix.isAbsolute(folder);
    if (!absolute) return { ok: false, error: "The folder dialog did not give a full path. Paste the folder's full path instead." };
    return { ok: true, folder };
  }
  if (!ran && platform !== "win32" && platform !== "darwin") {
    return { ok: false, error: "This computer has no folder dialog (zenity or kdialog). Paste the folder's full path instead." };
  }
  return { ok: false, error: "The folder dialog did not open. Paste the folder's full path instead." };
}
